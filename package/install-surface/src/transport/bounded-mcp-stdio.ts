import type { Readable, Writable } from "node:stream";
import { types } from "node:util";

export const MCP_STDIO_CEILINGS = Object.freeze({ frameBytes: 65536, pendingBytes: 262144, pendingFrames: 256, responseBytes: 1048576, handlerMs: 30000, writeMs: 10000, eofMs: 30000 });
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type StdioReason = "eof" | "partial-eof" | "shutdown" | "signal" | "input-error" | "input-closed" | "output-error" | "output-closed" | "invalid-utf8" | "invalid-json" | "invalid-request" | "frame-limit" | "pending-limit" | "response-invalid" | "response-limit" | "handler-error" | "handler-timeout" | "write-timeout" | "eof-timeout";
export interface StdioReceipt { schema: "temperance.bounded-mcp-stdio.v1"; reason: StdioReason; requests: number; responses: number; handlerStatus: "none" | "settled" | "unsettled"; delivery: "none" | "write-completed" | "uncertain"; effectAuthority: false; }
export interface StdioOptions {
  input: Readable; output: Writable;
  handleRequest: (request: JsonValue, context: { signal: AbortSignal }) => unknown | Promise<unknown>;
  onShutdown?: (receipt: Readonly<StdioReceipt>) => void;
  invalidJsonResponse?: unknown;
  limits?: Partial<typeof MCP_STDIO_CEILINGS>;
  clock?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}

class EncodingFailure extends Error { constructor(readonly reason: "response-invalid" | "response-limit") { super(reason); } }
/** Snapshot JSON data into bounded owned bytes. Never invokes getters, toJSON or proxy traps.
 * Owner handlers must also bound their own result production. Timers cannot preempt synchronous JS.
 */
export function encodeBoundedJson(value: unknown, maximum: number): Buffer {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > MCP_STDIO_CEILINGS.responseBytes) throw new EncodingFailure("response-limit");
  const chunks: string[] = []; let batch = ""; let bytes = 0; let nodes = 0;
  const ancestors = new WeakSet<object>();
  function add(s: string) { const n = Buffer.byteLength(s); if (bytes + n > maximum) throw new EncodingFailure("response-limit"); bytes += n; batch += s; if (batch.length >= 4096) { chunks.push(batch); batch = ""; } }
  function string(s: string) {
    if (s.length > maximum - bytes) throw new EncodingFailure("response-limit");
    add('"');
    for (const c of s) { const n = c.charCodeAt(0); if (c === '"' || c === "\\") add("\\" + c); else if (n < 32 || (c.length === 1 && n >= 0xd800 && n <= 0xdfff)) add("\\u" + n.toString(16).padStart(4, "0")); else add(c); }
    add('"');
  }
  function visit(v: unknown, depth: number) {
    if (++nodes > 32768 || depth > 64) throw new EncodingFailure("response-invalid");
    if (v === null) { add("null"); return; }
    if (typeof v === "string") { string(v); return; }
    if (typeof v === "boolean") { add(v ? "true" : "false"); return; }
    if (typeof v === "number" && Number.isFinite(v)) { add(String(v)); return; }
    if (typeof v !== "object" || !v || types.isProxy(v) || ancestors.has(v)) throw new EncodingFailure("response-invalid");
    const array = Array.isArray(v); const proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new EncodingFailure("response-invalid");
    ancestors.add(v); add(array ? "[" : "{"); let first = true;
    const field = (key: string) => { const descriptor = Object.getOwnPropertyDescriptor(v, key); if (!descriptor || !("value" in descriptor)) throw new EncodingFailure("response-invalid"); return descriptor.value; };
    if (array) {
      const length = field("length"); if (!Number.isSafeInteger(length) || length > 32768) throw new EncodingFailure("response-invalid");
      for (let i = 0; i < length; i++) { if (!first) add(","); first = false; visit(field(String(i)), depth + 1); }
    } else {
      // No whole-object key-array copy; enumeration stops at the node/byte budget.
      for (const key in v) { if (!Object.hasOwn(v, key)) continue; if (!first) add(","); first = false; string(key); add(":"); visit(field(key), depth + 1); }
    }
    add(array ? "]" : "}"); ancestors.delete(v);
  }
  visit(value, 0); add("\n"); chunks.push(batch); return Buffer.from(chunks.join(""));
}

/** One owner per pair of raw-byte streams. No client ACK, cancellation or tool-effect authority is inferred. */
export function startBoundedMcpStdio(options: StdioOptions): { closed: Promise<Readonly<StdioReceipt>>; close: (reason?: "shutdown" | "signal") => void } {
  const limits = { ...MCP_STDIO_CEILINGS };
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value! <= 0 || value! > limits[key as keyof typeof limits]) throw new Error("invalid-transport-limit");
    (limits as Record<string, number>)[key] = value!;
  }
  const parseResponse = options.invalidJsonResponse === undefined ? undefined : encodeBoundedJson(options.invalidJsonResponse, limits.responseBytes);
  const clock = options.clock ?? { setTimeout, clearTimeout }; const abort = new AbortController();
  let resolveClosed!: (r: Readonly<StdioReceipt>) => void;
  const closed = new Promise<Readonly<StdioReceipt>>(resolve => { resolveClosed = resolve; });
  const stopped = Symbol("closed"); let resolveStopped!: (value: typeof stopped) => void;
  const stopping = new Promise<typeof stopped>(resolve => { resolveStopped = resolve; });
  let done = false, eof = false, running = false, partialBytes = 0, pendingBytes = 0, requests = 0, responses = 0;
  let handlerStatus: StdioReceipt["handlerStatus"] = "none", delivery: StdioReceipt["delivery"] = "none";
  let fragments: Buffer[] = []; const queue: Buffer[] = []; let terminal: StdioReason = "eof";
  const timers = new Set<ReturnType<typeof setTimeout>>(); let cancelWrite: (() => void) | undefined;
  const timer = (fn: () => void, ms: number) => { const t = clock.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clear = (t: ReturnType<typeof setTimeout>) => { timers.delete(t); clock.clearTimeout(t); };
  function finish(reason: StdioReason) {
    if (done) return; done = true; resolveStopped(stopped); abort.abort(); for (const t of timers) clock.clearTimeout(t); timers.clear(); cancelWrite?.();
    queue.length = 0; fragments = []; pendingBytes = partialBytes = 0;
    options.input.pause(); options.input.off("data", data); options.input.off("end", end);
    // Error/close listeners remain inert until owned streams are destroyed, preventing late unhandled errors.
    options.input.destroy(); options.output.destroy();
    const receipt = Object.freeze({ schema: "temperance.bounded-mcp-stdio.v1" as const, reason, requests, responses, handlerStatus, delivery, effectAuthority: false as const });
    resolveClosed(receipt); try { options.onShutdown?.(receipt); } catch { /* owner notification cannot reopen transport */ }
  }
  async function write(bytes: Buffer): Promise<boolean> {
    if (done) return false; delivery = "uncertain";
    return new Promise(resolve => {
      let settled = false, callbackDone = false, drained = false, returned = false, needsDrain = false;
      const complete = (ok: boolean) => { if (settled) return; settled = true; clear(t); options.output.off("drain", drain); cancelWrite = undefined; resolve(ok); };
      const check = () => { if (returned && callbackDone && (!needsDrain || drained)) complete(true); };
      const drain = () => { drained = true; check(); };
      const t = timer(() => { complete(false); finish("write-timeout"); }, limits.writeMs);
      cancelWrite = () => complete(false); options.output.on("drain", drain);
      try { needsDrain = !options.output.write(bytes, error => { if (error) { complete(false); finish("output-error"); return; } callbackDone = true; check(); }); returned = true; check(); }
      catch { complete(false); finish("output-error"); }
    });
  }
  async function pump() {
    if (running || done) return; running = true; options.input.pause();
    while (queue.length && !done) {
      const frame = queue.shift()!; let response: unknown; let encoded: Buffer | undefined;
      let request: JsonValue;
      try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame)); }
      catch (error) {
        if (error instanceof TypeError) { finish("invalid-utf8"); break; }
        if (!parseResponse) { finish("invalid-json"); break; } encoded = parseResponse; request = null;
      }
      if (!encoded) {
        try { encodeBoundedJson(request!, limits.frameBytes + 1); } catch { finish("invalid-request"); break; }
        let timeout!: ReturnType<typeof setTimeout>;
        const timedOut = new Promise<never>((_, reject) => { timeout = timer(() => { finish("handler-timeout"); reject(new Error("handler-timeout")); }, limits.handlerMs); });
        try { response = await Promise.race([Promise.resolve().then(() => { if (done) return stopped; requests++; handlerStatus = "unsettled"; return options.handleRequest(request!, { signal: abort.signal }); }), timedOut, stopping]); clear(timeout); if (done) break; handlerStatus = "settled"; }
        catch { clear(timeout); if (!done) { handlerStatus = "settled"; finish("handler-error"); } break; }
        if (response !== undefined) { try { encoded = encodeBoundedJson(response, limits.responseBytes); } catch (error) { finish(error instanceof EncodingFailure ? error.reason : "response-invalid"); break; } }
      }
      if (encoded) { if (!await write(encoded) || done) break; responses++; delivery = "write-completed"; }
      pendingBytes -= frame.length + 1;
    }
    running = false; if (done) return; if (eof) finish(terminal); else options.input.resume();
  }
  function data(chunk: unknown) {
    if (done || eof) return;
    if (!(chunk instanceof Uint8Array)) { finish("invalid-utf8"); return; }
    if (pendingBytes + chunk.byteLength > limits.pendingBytes) { finish("pending-limit"); return; }
    pendingBytes += chunk.byteLength; let start = 0;
    for (let i = 0; i < chunk.byteLength; i++) {
      if (chunk[i] !== 10) continue;
      const part = Buffer.from(chunk.subarray(start, i)); partialBytes += part.length;
      if (partialBytes > limits.frameBytes) { finish("frame-limit"); return; }
      fragments.push(part);
      if (queue.length + (running ? 1 : 0) >= limits.pendingFrames) { finish("pending-limit"); return; }
      queue.push(Buffer.concat(fragments, partialBytes)); fragments = []; partialBytes = 0; start = i + 1;
    }
    if (start < chunk.byteLength) { const part = chunk.subarray(start); if (partialBytes + part.length > limits.frameBytes) { finish("frame-limit"); return; } fragments.push(Buffer.from(part)); partialBytes += part.length; }
    void pump();
  }
  function end() { if (done) return; eof = true; if (partialBytes) { terminal = "partial-eof"; pendingBytes -= partialBytes; fragments = []; partialBytes = 0; } timer(() => finish("eof-timeout"), limits.eofMs); void pump(); }
  options.input.on("data", data); options.input.on("end", end);
  options.input.on("error", () => finish("input-error")); options.input.on("close", () => { if (!eof) finish("input-closed"); });
  options.output.on("error", () => finish("output-error")); options.output.on("close", () => { if (!done) finish("output-closed"); });
  if (options.input.destroyed) finish("input-closed");
  else if (options.output.destroyed) finish("output-closed");
  else if (options.input.readableEnded) end();
  return { closed, close: (reason = "shutdown") => finish(reason) };
}
