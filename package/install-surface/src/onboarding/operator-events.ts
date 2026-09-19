import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

export const OPERATOR_EVENT_SCHEMA = "temperance.operator-event.v1" as const;
export const MAX_OPERATOR_EVENT_LOG_BYTES = 1024 * 1024;
export const MAX_OPERATOR_EVENTS = 4096;
export const OPERATOR_EVENT_TYPES = ["started", "step", "action", "health", "completed", "cancelled", "failed"] as const;
export const OPERATOR_EVENT_SURFACES = ["tui", "agent", "health"] as const;
export const OPERATOR_EVENT_STEPS = ["host", "projects", "providers", "combos", "modules", "integrations", "review"] as const;
export const OPERATOR_EVENT_ACTIONS = ["next", "back", "refresh", "seat", "save", "confirm", "info", "project", "module", "authorize", "defer", "cancel", "apply", "toggle", "move-earlier", "move-later", "retry", "close", "health", "logs"] as const;
export const OPERATOR_EVENT_OUTCOMES = ["ok", "held", "skipped", "cancelled", "failed", "ready", "blocked", "read-only-degraded", "requested", "confirmed", "unavailable"] as const;
export const OPERATOR_EVENT_COUNT_KEYS = ["projects", "selected_projects", "modules", "selected_modules", "eligible", "blocked", "providers", "models", "combos", "checks", "passed", "failed", "warnings"] as const;

export interface OperatorEventInput {
  event_type: (typeof OPERATOR_EVENT_TYPES)[number];
  surface: (typeof OPERATOR_EVENT_SURFACES)[number];
  step?: (typeof OPERATOR_EVENT_STEPS)[number];
  action_kind?: (typeof OPERATOR_EVENT_ACTIONS)[number];
  outcome?: (typeof OPERATOR_EVENT_OUTCOMES)[number];
  duration_ms?: number;
  counts?: Partial<Record<(typeof OPERATOR_EVENT_COUNT_KEYS)[number], number>>;
}
export interface OperatorEventV1 extends OperatorEventInput {
  schema: typeof OPERATOR_EVENT_SCHEMA;
  version: { major: 1; minor: 0 };
  run_id: string;
  timestamp: string;
}
export interface OperatorEventLog {
  readonly runId: string;
  record(event: OperatorEventInput): OperatorEventV1;
  /** Oldest to newest within the last limit matching events; never creates files. */
  read(options?: { limit?: number; runId?: string }): OperatorEventV1[];
}
export class OperatorEventLogError extends Error {
  constructor(readonly code: "OPERATOR_EVENT_INVALID" | "OPERATOR_EVENT_LOG_INVALID" | "OPERATOR_EVENT_LOG_UNSAFE" | "OPERATOR_EVENT_LOG_UNAVAILABLE" | "OPERATOR_EVENT_LOG_BUSY" | "OPERATOR_EVENT_READ_OPTIONS_INVALID") {
    super(code);
    this.name = "OperatorEventLogError";
  }
}

const INPUT_KEYS = new Set(["event_type", "surface", "step", "action_kind", "outcome", "duration_ms", "counts"]);
const STORED_KEYS = new Set([...INPUT_KEYS, "schema", "version", "run_id", "timestamp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  && Reflect.ownKeys(value).every(key => typeof key === "string")
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => !("get" in descriptor) && !("set" in descriptor));
const member = (values: readonly string[], value: unknown): boolean => typeof value === "string" && values.includes(value);
const integer = (value: unknown, maximum: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

function validateInput(value: unknown, stored = false): value is OperatorEventInput {
  if (!isRecord(value) || Object.getOwnPropertyNames(value).some(key => !(stored ? STORED_KEYS : INPUT_KEYS).has(key))) return false;
  if (!member(OPERATOR_EVENT_TYPES, value.event_type) || !member(OPERATOR_EVENT_SURFACES, value.surface)) return false;
  if (value.step !== undefined && !member(OPERATOR_EVENT_STEPS, value.step)) return false;
  if (value.action_kind !== undefined && !member(OPERATOR_EVENT_ACTIONS, value.action_kind)) return false;
  if (value.outcome !== undefined && !member(OPERATOR_EVENT_OUTCOMES, value.outcome)) return false;
  if (value.duration_ms !== undefined && !integer(value.duration_ms, 86_400_000)) return false;
  if (value.counts !== undefined && (!isRecord(value.counts) || Object.getOwnPropertyNames(value.counts).some(key => !member(OPERATOR_EVENT_COUNT_KEYS, key) || !integer((value.counts as Record<string, unknown>)[key], 1_000_000)))) return false;
  return true;
}

function storedEvent(value: unknown): value is OperatorEventV1 {
  if (!isRecord(value) || !validateInput(value, true)) return false;
  if (value.schema !== OPERATOR_EVENT_SCHEMA || !isRecord(value.version) || Object.keys(value.version).length !== 2 || value.version.major !== 1 || value.version.minor !== 0) return false;
  if (typeof value.run_id !== "string" || !UUID.test(value.run_id) || typeof value.timestamp !== "string") return false;
  const time = Date.parse(value.timestamp);
  return Number.isFinite(time) && new Date(time).toISOString() === value.timestamp;
}

function missingStat(path: string): Stats | undefined {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNAVAILABLE"); }
}
function sameNode(left: Stats, right: Stats | undefined): boolean { return Boolean(right) && left.dev === right!.dev && left.ino === right!.ino; }
function owned(stat: Stats): boolean { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
function directory(stat: Stats, privateDirectory: boolean): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || (privateDirectory && (!owned(stat) || (stat.mode & 0o777) !== 0o700))) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
}
function regular(stat: Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !owned(stat) || (stat.mode & 0o777) !== 0o600) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
  if (stat.size > MAX_OPERATOR_EVENT_LOG_BYTES) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID");
}

/** Walk without following symlinks, including caller-controlled parent components. */
function existingDirectory(path: string): Stats | undefined {
  let current = parse(path).root;
  for (const component of path.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, component);
    const stat = missingStat(current);
    if (!stat) return undefined;
    directory(stat, false);
  }
  return missingStat(path);
}

function readEvents(stateRoot: string, logDirectory: string, path: string): OperatorEventV1[] {
  if (!existingDirectory(stateRoot)) return [];
  const parent = missingStat(logDirectory);
  if (!parent) return [];
  directory(parent, true);
  const before = missingStat(path);
  if (!before) return [];
  regular(before);
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    regular(opened);
    if (!sameNode(before, opened)) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
    const bytes = Buffer.alloc(MAX_OPERATOR_EVENT_LOG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_OPERATOR_EVENT_LOG_BYTES) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID");
    const after = fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || !sameNode(parent, missingStat(logDirectory))) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
    const raw = bytes.subarray(0, length).toString("utf8");
    if (!raw) return [];
    if (!raw.endsWith("\n")) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID");
    const lines = raw.slice(0, -1).split("\n");
    if (lines.length > MAX_OPERATOR_EVENTS) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID");
    const events: OperatorEventV1[] = [];
    for (const line of lines) {
      let value: unknown;
      try { value = JSON.parse(line); } catch { throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID"); }
      if (!storedEvent(value)) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_INVALID");
      events.push(value);
    }
    return events;
  } catch (error) {
    if (error instanceof OperatorEventLogError) throw error;
    throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNAVAILABLE");
  } finally { if (fd !== undefined) closeSync(fd); }
}

function prepareDirectory(stateRoot: string, logDirectory: string): Stats {
  if (!existingDirectory(stateRoot)) {
    if (!existingDirectory(dirname(stateRoot))) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNAVAILABLE");
    mkdirSync(stateRoot, { mode: 0o700 });
  }
  const rootStat = existingDirectory(stateRoot);
  if (!rootStat || !owned(rootStat)) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
  const logStat = missingStat(logDirectory);
  if (!logStat) mkdirSync(logDirectory, { mode: 0o700 });
  const result = missingStat(logDirectory)!;
  directory(result, true);
  return result;
}

/** Lazy local logging: only record() creates state; constructing/read-only --logs never does. */
export function createOperatorEventLog(stateRoot: string): OperatorEventLog {
  if (typeof stateRoot !== "string" || !isAbsolute(stateRoot) || /[\x00-\x1f\x7f]/.test(stateRoot) || resolve(stateRoot) === parse(stateRoot).root) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
  const root = resolve(stateRoot);
  const logDirectory = join(root, "operator-events");
  const path = join(logDirectory, "events.v1.jsonl");
  const lockPath = join(logDirectory, ".events.lock");
  const runId = randomUUID();

  return {
    runId,
    record(input) {
      if (!validateInput(input)) throw new OperatorEventLogError("OPERATOR_EVENT_INVALID");
      // Reconstruct a closed object: no caller fields or nested references leak into storage.
      const event: OperatorEventV1 = {
        schema: OPERATOR_EVENT_SCHEMA, version: { major: 1, minor: 0 }, run_id: runId, timestamp: new Date().toISOString(),
        event_type: input.event_type, surface: input.surface,
        ...(input.step !== undefined ? { step: input.step } : {}),
        ...(input.action_kind !== undefined ? { action_kind: input.action_kind } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.duration_ms !== undefined ? { duration_ms: input.duration_ms } : {}),
        ...(input.counts !== undefined ? { counts: { ...input.counts } } : {}),
      };
      if (!storedEvent(event)) throw new OperatorEventLogError("OPERATOR_EVENT_INVALID");
      let lockFd: number | undefined;
      let lockStat: Stats | undefined;
      let temporary: string | undefined;
      let temporaryStat: Stats | undefined;
      let temporaryFd: number | undefined;
      try {
        const parent = prepareDirectory(root, logDirectory);
        try { lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new OperatorEventLogError("OPERATOR_EVENT_LOG_BUSY"); throw error; }
        fchmodSync(lockFd, 0o600);
        lockStat = fstatSync(lockFd);
        regular(lockStat);
        const events = [...readEvents(root, logDirectory, path), event];
        let lines = events.map(value => JSON.stringify(value) + "\n");
        let bytes = lines.reduce((count, line) => count + Buffer.byteLength(line), 0);
        while (lines.length > MAX_OPERATOR_EVENTS || bytes > MAX_OPERATOR_EVENT_LOG_BYTES) bytes -= Buffer.byteLength(lines.shift()!);
        const existing = missingStat(path);
        if (existing) regular(existing);
        temporary = join(logDirectory, `.events.${randomUUID()}.tmp`);
        temporaryFd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        fchmodSync(temporaryFd, 0o600);
        temporaryStat = fstatSync(temporaryFd);
        writeFileSync(temporaryFd, lines.join(""), "utf8");
        fsyncSync(temporaryFd);
        closeSync(temporaryFd); temporaryFd = undefined;
        const current = missingStat(path);
        if (!sameNode(parent, missingStat(logDirectory)) || (existing ? !sameNode(existing, current) : current !== undefined)) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
        if (current) regular(current);
        if (!sameNode(temporaryStat, missingStat(temporary))) throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNSAFE");
        renameSync(temporary, path);
        temporary = undefined;
        return structuredClone(event);
      } catch (error) {
        if (error instanceof OperatorEventLogError) throw error;
        throw new OperatorEventLogError("OPERATOR_EVENT_LOG_UNAVAILABLE");
      } finally {
        try { if (temporaryFd !== undefined) closeSync(temporaryFd); } catch { /* Never replace a safe error with raw filesystem details. */ }
        try { if (lockFd !== undefined) closeSync(lockFd); } catch { /* Best-effort cleanup of owned descriptors. */ }
        // Never unlink a path that was replaced by another actor.
        try { if (temporary && temporaryStat && sameNode(temporaryStat, missingStat(temporary))) unlinkSync(temporary); } catch { /* Retain an uncertain path rather than overwrite it. */ }
        try { if (lockStat && sameNode(lockStat, missingStat(lockPath))) unlinkSync(lockPath); } catch { /* Next writer safely holds on a leftover lock. */ }
      }
    },
    read(options = {}) {
      if (!isRecord(options) || Object.getOwnPropertyNames(options).some(key => key !== "limit" && key !== "runId") || (options.limit !== undefined && (!integer(options.limit, 1000) || options.limit === 0)) || (options.runId !== undefined && (typeof options.runId !== "string" || !UUID.test(options.runId)))) throw new OperatorEventLogError("OPERATOR_EVENT_READ_OPTIONS_INVALID");
      const events = readEvents(root, logDirectory, path);
      return events.filter(event => options.runId === undefined || event.run_id === options.runId).slice(-(options.limit ?? 100));
    },
  };
}
