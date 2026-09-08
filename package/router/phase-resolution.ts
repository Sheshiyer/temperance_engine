import { classifyTaskType } from "./task-classification";

export interface PhaseComboMap {
  readonly schema?: "temperance.phase-combo-map.v2";
  readonly algorithm_phases: Readonly<Record<string, string>>;
  readonly task_type_to_combo: Readonly<Record<string, string>>;
}

export type MapStatus = "valid" | "missing" | "invalid";
export type PhaseMapValidation =
  | { readonly status: "valid"; readonly map: PhaseComboMap }
  | { readonly status: "missing" | "invalid"; readonly reason: string };

export interface PhaseResolution {
  readonly combo: string;
  readonly source: "explicit-combo" | "phase" | "task-type" | "auto" | "fallback";
  readonly mapStatus: MapStatus;
}

const SCHEMA = "temperance.phase-combo-map.v2";
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Descriptors prevent invoking accessors at this JSON boundary. Other metadata
// is deliberately ignored; the resolver does not validate the entire runtime map.
function ownValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new Error("Accessor properties are not map data");
  return descriptor.value;
}

function readTable(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new Error("Resolution tables must be plain records");
  const result: Record<string, string> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    const combo = ownValue(value, key);
    if (FORBIDDEN_KEYS.has(key) || typeof combo !== "string" || combo.trim() === "" || combo === "null") {
      throw new Error("Resolution tables require safe keys and nonempty combo strings");
    }
    result[key] = combo;
  }
  if (Object.getOwnPropertySymbols(value).length) throw new Error("Symbol keys are not JSON map data");
  return Object.freeze(result);
}

/**
 * null/undefined denote missing configuration. Partial/minimal maps may omit
 * schema and either table (an omitted table is empty). If present, schema must
 * be the current v2 identifier. Any malformed consumed field invalidates the
 * whole map, so resolution never succeeds from a partly trusted configuration.
 */
export function validatePhaseComboMap(input: unknown): PhaseMapValidation {
  if (input === null || input === undefined) return { status: "missing", reason: "No map supplied" };
  try {
    if (!isRecord(input)) return { status: "invalid", reason: "Map must be a plain record" };
    const schema = ownValue(input, "schema");
    if (Object.hasOwn(input, "schema") && schema !== SCHEMA) {
      return { status: "invalid", reason: "Unsupported map schema" };
    }
    const phases = Object.hasOwn(input, "algorithm_phases") ? ownValue(input, "algorithm_phases") : {};
    const types = Object.hasOwn(input, "task_type_to_combo") ? ownValue(input, "task_type_to_combo") : {};
    const map: PhaseComboMap = Object.freeze({
      ...(schema === SCHEMA ? { schema: SCHEMA } : {}),
      algorithm_phases: readTable(phases),
      task_type_to_combo: readTable(types),
    });
    return { status: "valid", map };
  } catch {
    return { status: "invalid", reason: "Malformed map fields" };
  }
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

// POSIX command substitutions remove trailing LF, but never CR.
function stripTrailingLf(value: string): string {
  return value.replace(/\n+$/, "");
}

function titleCase(value: string): string {
  return value.split("\n").map((line) => line.slice(0, 1).replace(/[a-z]/g, (letter) => letter.toUpperCase()) + asciiLower(line.slice(1))).join("\n");
}

/** Pure resolution only: this result confers no dispatch or provider authority. */
export function resolvePhaseCombo(key: string, task: string, input: unknown): PhaseResolution {
  const validation = validatePhaseComboMap(input);
  const result = (combo: string, source: PhaseResolution["source"]): PhaseResolution => ({ combo, source, mapStatus: validation.status });
  // noesis-* is the intentional correction to the legacy shell's passthrough.
  // te-* is accepted only as an explicitly supplied historical name.
  if (key.startsWith("noesis-") || key.startsWith("te-") || key === "temperance-coding" || key === "temperance-auto") {
    return result(key, "explicit-combo");
  }
  if (validation.status !== "valid") return result("noesis-fast", "fallback");
  const map = validation.map;
  // jq phase/type values pass through shell command substitution. Auto is a
  // direct jq output branch and retains its raw map string in this pure API.
  const lookup = (table: Readonly<Record<string, string>>, lookupKey: string): string | undefined => {
    const value = table[lookupKey];
    if (value === undefined) return undefined;
    const stripped = stripTrailingLf(value);
    return stripped === "" || stripped === "null" ? undefined : stripped;
  };
  const phase = lookup(map.algorithm_phases, key) ?? lookup(map.algorithm_phases, stripTrailingLf(titleCase(key)));
  if (phase !== undefined) return result(phase, "phase");
  const taskType = lookup(map.task_type_to_combo, stripTrailingLf(asciiLower(key)));
  if (taskType !== undefined) return result(taskType, "task-type");
  if (key === "auto") {
    const combo = map.task_type_to_combo[classifyTaskType(task)];
    if (combo !== undefined) return result(combo, "auto");
  }
  return result("noesis-fast", "fallback");
}
