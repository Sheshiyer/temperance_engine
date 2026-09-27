import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperatorEventLog, MAX_OPERATOR_EVENT_LOG_BYTES, MAX_OPERATOR_EVENTS, OPERATOR_EVENT_COUNT_KEYS, type OperatorEventInput, type OperatorEventV1 } from "../src/onboarding/operator-events.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "temperance-operator-events-"));
  roots.push(root);
  const stateRoot = join(root, "state");
  return { root, stateRoot, directory: join(stateRoot, "operator-events"), file: join(stateRoot, "operator-events/events.v1.jsonl") };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("private metadata-only operator event log", () => {
  test("factory and missing-log reads never create state", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    expect(log.runId).toMatch(/^[a-f0-9-]{36}$/);
    expect(log.read()).toEqual([]);
    expect(log.read({ limit: 5, runId: log.runId })).toEqual([]);
    expect(existsSync(paths.stateRoot)).toBe(false);
  });

  test("records a closed versioned event with private permissions and no caller mutation", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    const input: OperatorEventInput = { event_type: "action", surface: "tui", step: "projects", action_kind: "project", outcome: "requested", duration_ms: 10, counts: { projects: 4, selected_projects: 1 } };
    const event = log.record(input);
    expect(event.schema).toBe("temperance.operator-event.v1");
    expect(event.version).toEqual({ major: 1, minor: 0 });
    expect(event.run_id).toBe(log.runId);
    expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
    input.counts!.projects = 99;
    event.counts!.selected_projects = 99;
    expect(log.read()[0]?.counts).toEqual({ projects: 4, selected_projects: 1 });
    expect(statSync(paths.directory).mode & 0o777).toBe(0o700);
    expect(statSync(paths.file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(paths.directory, ".events.lock"))).toBe(false);
    expect(readFileSync(paths.file, "utf8")).not.toContain(paths.root);
  });

  test("rejects unknown payload fields, arbitrary strings and unbounded numbers before creating files", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    const valid = { event_type: "action", surface: "tui" };
    for (const invalid of [
      { ...valid, message: "credential must never persist" }, { ...valid, path: "/private/data" },
      { ...valid, error: "private failure" }, { ...valid, token: "secret" }, { ...valid, action_id: "private-repo" },
      { ...valid, event_type: "arbitrary" }, { ...valid, surface: "other" }, { ...valid, step: "private-repo" },
      { ...valid, action_kind: "run:secret" }, { ...valid, outcome: "arbitrary failure" },
      { ...valid, duration_ms: -1 }, { ...valid, duration_ms: NaN }, { ...valid, duration_ms: Infinity },
      { ...valid, duration_ms: 86_400_001 }, { ...valid, duration_ms: 1.2 },
      { ...valid, counts: { secrets: 1 } }, { ...valid, counts: { projects: "one" } },
      { ...valid, counts: { projects: -1 } }, { ...valid, counts: { projects: 1_000_001 } },
      { ...valid, counts: [] }, { ...valid, counts: { projects: { body: "private" } } },
    ]) expect(() => log.record(invalid as OperatorEventInput)).toThrow("OPERATOR_EVENT_INVALID");
    const accessor = { ...valid, get outcome() { return "ok"; } };
    expect(() => log.record(accessor as OperatorEventInput)).toThrow("OPERATOR_EVENT_INVALID");
    expect(() => log.record({ ...valid, [Symbol("secret")]: "private" } as OperatorEventInput)).toThrow("OPERATOR_EVENT_INVALID");
    expect(existsSync(paths.stateRoot)).toBe(false);
  });

  test("fixed wizard inspection actions and health counts are supported", () => {
    const log = createOperatorEventLog(fixture().stateRoot);
    log.record({ event_type: "action", surface: "tui", step: "host", action_kind: "health" });
    log.record({ event_type: "action", surface: "tui", step: "review", action_kind: "logs" });
    log.record({ event_type: "health", surface: "health", outcome: "blocked", counts: { checks: 5, passed: 3, failed: 1, blocked: 1 } });
    expect(log.read()).toHaveLength(3);
  });

  test("run filters and limit preserve chronological metadata only", () => {
    const paths = fixture();
    const first = createOperatorEventLog(paths.stateRoot);
    const second = createOperatorEventLog(paths.stateRoot);
    first.record({ event_type: "started", surface: "agent" });
    second.record({ event_type: "started", surface: "tui" });
    first.record({ event_type: "completed", surface: "agent", outcome: "ok" });
    expect(first.read({ limit: 1 })[0]?.event_type).toBe("completed");
    expect(first.read({ runId: first.runId }).map(event => event.event_type)).toEqual(["started", "completed"]);
    expect(second.read({ runId: second.runId })).toHaveLength(1);
    for (const options of [{ limit: 0 }, { limit: -1 }, { limit: 1001 }, { limit: 1.1 }, { runId: "token" }, { path: "/private" }]) {
      expect(() => first.read(options as { limit?: number; runId?: string })).toThrow("OPERATOR_EVENT_READ_OPTIONS_INVALID");
    }
  });

  test("bounded atomic ring retains latest events within both byte and count limits", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    const sample = log.record({ event_type: "action", surface: "tui", step: "integrations", action_kind: "move-earlier", outcome: "read-only-degraded", duration_ms: 86_400_000, counts: Object.fromEntries(OPERATOR_EVENT_COUNT_KEYS.map(key => [key, 1_000_000])) });
    const oldRun = randomUUID();
    const old = JSON.stringify({ ...sample, run_id: oldRun }) + "\n";
    const count = Math.min(MAX_OPERATOR_EVENTS, Math.floor(MAX_OPERATOR_EVENT_LOG_BYTES / Buffer.byteLength(old)));
    writeFileSync(paths.file, old.repeat(count), { mode: 0o600 });
    log.record({ event_type: "action", surface: "tui", step: "integrations", action_kind: "move-earlier", outcome: "read-only-degraded", duration_ms: 86_400_000, counts: Object.fromEntries(OPERATOR_EVENT_COUNT_KEYS.map(key => [key, 1_000_000])) });
    expect(statSync(paths.file).size).toBeLessThanOrEqual(MAX_OPERATOR_EVENT_LOG_BYTES);
    const retained = readFileSync(paths.file, "utf8").trim().split("\n").map(line => JSON.parse(line) as OperatorEventV1);
    expect(retained.length).toBeLessThanOrEqual(MAX_OPERATOR_EVENTS);
    expect(retained.length).toBe(count);
    expect(retained.at(-1)?.run_id).toBe(log.runId);
  });

  test("malformed, secret-bearing, oversized or permissive logs are rejected without overwrite", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    const sample = log.record({ event_type: "started", surface: "agent" });
    for (const body of ["not JSON\n", JSON.stringify({ ...sample, message: "TOP_SECRET" }) + "\n", JSON.stringify({ ...sample, counts: { private: 1 } }) + "\n", JSON.stringify(sample), "x".repeat(MAX_OPERATOR_EVENT_LOG_BYTES + 1)]) {
      writeFileSync(paths.file, body);
      expect(() => log.read()).toThrow("OPERATOR_EVENT_LOG_INVALID");
      expect(() => log.record({ event_type: "failed", surface: "agent" })).toThrow("OPERATOR_EVENT_LOG_INVALID");
      expect(readFileSync(paths.file, "utf8")).toBe(body);
    }
    writeFileSync(paths.file, JSON.stringify(sample) + "\n");
    chmodSync(paths.file, 0o644);
    expect(() => log.read()).toThrow("OPERATOR_EVENT_LOG_UNSAFE");
    expect(() => log.record({ event_type: "failed", surface: "agent" })).toThrow("OPERATOR_EVENT_LOG_UNSAFE");
  });

  test("event-count retention also rotates a small-event log below the byte ceiling", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    const sample = log.record({ event_type: "step", surface: "tui" });
    const line = JSON.stringify({ ...sample, run_id: randomUUID() }) + "\n";
    expect(Buffer.byteLength(line) * MAX_OPERATOR_EVENTS).toBeLessThan(MAX_OPERATOR_EVENT_LOG_BYTES);
    writeFileSync(paths.file, line.repeat(MAX_OPERATOR_EVENTS));
    log.record({ event_type: "completed", surface: "tui" });
    expect(readFileSync(paths.file, "utf8").trim().split("\n")).toHaveLength(MAX_OPERATOR_EVENTS);
    expect(log.read({ limit: 1 })[0]?.event_type).toBe("completed");
  });

  test("symlink or hardlink targets cannot be read or overwritten", () => {
    for (const kind of ["root-symlink", "directory-symlink", "file-symlink", "file-hardlink"]) {
      const paths = fixture();
      const outside = join(paths.root, "outside");
      mkdirSync(outside, { mode: 0o700 });
      const outsideFile = join(outside, "original");
      writeFileSync(outsideFile, "untouched private bytes", { mode: 0o600 });
      if (kind === "root-symlink") symlinkSync(outside, paths.stateRoot);
      else {
        mkdirSync(paths.stateRoot, { mode: 0o700 });
        if (kind === "directory-symlink") symlinkSync(outside, paths.directory);
        else {
          mkdirSync(paths.directory, { mode: 0o700 });
          if (kind === "file-symlink") symlinkSync(outsideFile, paths.file); else linkSync(outsideFile, paths.file);
        }
      }
      const log = createOperatorEventLog(paths.stateRoot);
      expect(() => log.read()).toThrow("OPERATOR_EVENT_LOG_UNSAFE");
      expect(() => log.record({ event_type: "started", surface: "agent" })).toThrow("OPERATOR_EVENT_LOG_UNSAFE");
      expect(readFileSync(outsideFile, "utf8")).toBe("untouched private bytes");
    }
  });

  test("an existing lock is never replaced or removed", () => {
    const paths = fixture();
    const log = createOperatorEventLog(paths.stateRoot);
    log.record({ event_type: "started", surface: "tui" });
    const lock = join(paths.directory, ".events.lock");
    writeFileSync(lock, "other writer", { mode: 0o600 });
    expect(() => log.record({ event_type: "completed", surface: "tui" })).toThrow("OPERATOR_EVENT_LOG_BUSY");
    expect(readFileSync(lock, "utf8")).toBe("other writer");
    expect(log.read()).toHaveLength(1);
  });
});
