import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { encodeBoundedJson, startBoundedMcpStdio } from "../src/transport/bounded-mcp-stdio";
function fixture(handler: (r: any) => unknown | Promise<unknown>, extra: Record<string, any> = {}) {
  const input = new PassThrough(); let text = "";
  const output = new Writable({ write(chunk, _, callback) { text += chunk.toString(); callback(); } });
  const transport = startBoundedMcpStdio({ input, output, handleRequest: handler, ...extra });
  return { input, output, transport, text: () => text };
}
describe("bounded owner stdio", () => {
  test("fragmented UTF8, serial handlers and EOF drain", async () => {
    const seen: number[] = []; let active = 0;
    const f = fixture(async r => { expect(active++).toBe(0); await Promise.resolve(); seen.push(r.id); active--; return r; });
    const b = Buffer.from('{"id":1,"s":"☿"}\n{"id":2}\n'); const split = b.indexOf(Buffer.from("☿")) + 1;
    f.input.write(b.subarray(0, split)); f.input.end(b.subarray(split));
    expect((await f.transport.closed).reason).toBe("eof"); expect(seen).toEqual([1,2]); expect(f.text()).toBe(b.toString());
  });
  test("partial EOF holds after admitted complete responses", async () => {
    const f = fixture(r => r); f.input.end('{"id":1}\n{"id":');
    expect((await f.transport.closed).reason).toBe("partial-eof"); expect(f.text()).toBe('{"id":1}\n');
  });
  test("aggregate multi-frame overflow executes nothing", async () => {
    let calls = 0; const f = fixture(() => { calls++; }, { limits: { pendingBytes: 8 } });
    f.input.end('{}\n{}\n{}\n'); expect((await f.transport.closed).reason).toBe("pending-limit"); expect(calls).toBe(0);
  });
  test("fragment frame boundary and invalid UTF8", async () => {
    const f = fixture(r => r, { limits: { frameBytes: 8 } }); f.input.write('12345678'); f.input.end('9\n'); expect((await f.transport.closed).reason).toBe("frame-limit");
    const g = fixture(r => r); g.input.end(Buffer.from([0xff,10])); expect((await g.transport.closed).reason).toBe("invalid-utf8");
  });
  test("parse error constant uses bounded response and serial queue", async () => {
    const f = fixture(r => r, { invalidJsonResponse: { error: "parse error" } }); f.input.end('bad\n{"id":2}\n');
    const receipt = await f.transport.closed; expect(receipt.reason).toBe("eof"); expect(receipt.requests).toBe(1); expect(receipt.responses).toBe(2); expect(f.text()).toBe('{"error":"parse error"}\n{"id":2}\n');
  });
  test("malformed JSON default closes and errors are redacted", async () => {
    const f = fixture(() => { throw new Error("private sentinel"); }); f.input.end('{}\n'); const r = await f.transport.closed;
    expect(r.reason).toBe("handler-error"); expect(JSON.stringify(r)).not.toContain("private");
    const g = fixture(r => r); g.input.end('bad\n'); expect((await g.transport.closed).reason).toBe("invalid-json");
  });
  test("getter, proxy, cycles and oversized output never escape", () => {
    let touched = 0; const getter = { get value() { touched++; return 1; } };
    expect(() => encodeBoundedJson(getter, 100)).toThrow();
    expect(() => encodeBoundedJson(new Proxy({}, { ownKeys() { touched++; return []; } }),100)).toThrow();
    const cycle: any = {}; cycle.self = cycle; expect(() => encodeBoundedJson(cycle,100)).toThrow(); expect(touched).toBe(0);
    expect(() => encodeBoundedJson("x".repeat(100),16)).toThrow();
    expect(encodeBoundedJson({ s: '\ud800\n☿"' },100).toString()).toBe('{"s":"\\ud800\\u000a☿\\\""}\n');
  });
  test("handler timeout and signal close report uncertainty without replay", async () => {
    const f = fixture(() => new Promise(() => {}), { limits: { handlerMs: 5 } }); f.input.write('{}\n');
    expect((await f.transport.closed).reason).toBe("handler-timeout");
    const g = fixture(() => new Promise(() => {})); g.input.write('{}\n'); await Promise.resolve(); g.transport.close("signal");
    const r = await g.transport.closed; expect(r.reason).toBe("signal"); expect(r.handlerStatus).toBe("unsettled"); expect(r.effectAuthority).toBe(false);
  });
  test("synchronous shutdown before handler microtask admits no owner call", async () => {
    let calls = 0; const f = fixture(() => { calls++; return {}; });
    f.input.write('{}\n'); f.transport.close("signal");
    const receipt = await f.transport.closed; expect(receipt.reason).toBe("signal"); expect(receipt.requests).toBe(0); expect(receipt.handlerStatus).toBe("none"); await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(0); expect(f.text()).toBe("");
  });
  test("stalled writable closes finitely and never replays", async () => {
    let calls = 0; const output = new Writable({ highWaterMark: 1, write() {} });
    const f = fixture(() => { calls++; return { ok: true }; }, { output, limits: { writeMs: 5 } }); f.input.end('{}\n{}\n');
    const r = await f.transport.closed; expect(r.reason).toBe("write-timeout"); expect(r.delivery).toBe("uncertain"); expect(calls).toBe(1); expect(r.responses).toBe(0);
  });
  test("backpressure drains before next handler", async () => {
    const callbacks: Array<() => void> = []; let calls = 0;
    const output = new Writable({ highWaterMark: 1, write(_, __, callback) { callbacks.push(callback); } });
    const f = fixture(() => ({ id: ++calls }), { output }); f.input.end('{}\n{}\n');
    await new Promise(r => setTimeout(r, 1)); expect(calls).toBe(1); callbacks.shift()!();
    await new Promise(r => setTimeout(r, 1)); expect(calls).toBe(2); callbacks.shift()!();
    expect((await f.transport.closed).reason).toBe("eof");
  });
  test("EOF drain deadline and stream failures close finitely", async () => {
    const f = fixture(() => new Promise(() => {}), { limits: { eofMs: 5 } }); f.input.end('{}\n'); expect((await f.transport.closed).reason).toBe("eof-timeout");
    const g = fixture(r => r); g.input.emit("error", new Error("private input")); expect((await g.transport.closed).reason).toBe("input-error");
    const h = fixture(r => r); h.output.destroy(); expect((await h.transport.closed).reason).toBe("output-closed");
  });
  test("pending count and response ceilings can only decrease", async () => {
    const f = fixture(r => r, { limits: { pendingFrames: 1 } }); f.input.end('{}\n{}\n'); expect((await f.transport.closed).reason).toBe("pending-limit");
    const g = fixture(() => ({ long: "xxxxxxxx" }), { limits: { responseBytes: 8 } }); g.input.end('{}\n'); expect((await g.transport.closed).reason).toBe("response-limit");
    expect(() => fixture(r => r, { limits: { frameBytes: 65537 } })).toThrow("invalid-transport-limit");
  });
});
