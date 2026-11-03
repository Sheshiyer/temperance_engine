import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalExact } from "../canonical-json.ts";

export type Digest = `sha256:${string}`;
export const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function invalid(code = "ENGINE_INVALID_INPUT"): never { throw new Error(code); }

/** Public data is JSON, never accessors, proxies, sparse arrays or host objects. */
export function jsonValue(value: unknown, depth = 0, budget = { nodes: 0, bytes: 0 }): void {
  if (++budget.nodes > 8192 || depth > 20) invalid();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { budget.bytes += Buffer.byteLength(value); if (value.length > 16384 || budget.bytes > 65536) invalid("ENGINE_INPUT_TOO_LARGE"); return; }
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return; }
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1024 || (array && keys.length !== value.length + 1)) invalid();
  if (array) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) invalid();
  for (const key of keys) {
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) invalid();
    jsonValue(descriptor.value, depth + 1, budget);
  }
}
export function record(value: unknown, keys: readonly string[]): Record<string, any> {
  jsonValue(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, any>;
}
export function id(value: unknown): string { if (typeof value !== "string" || !identifier.test(value)) invalid(); return value; }
export function digest(value: unknown): Digest { if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) invalid(); return value as Digest; }
export function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid();
  return time;
}
export function list<T>(value: unknown, validate: (item: unknown) => T, max = 64): T[] {
  jsonValue(value);
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(validate);
}
export function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) invalid("ENGINE_DUPLICATE_IDENTITY"); }
export function frozen<T>(value: T): Readonly<T> {
  jsonValue(value);
  if (Buffer.byteLength(canonicalExact(value)) > 65536) invalid("ENGINE_INPUT_TOO_LARGE");
  const clone = structuredClone(value);
  const freeze = (item: any): any => { if (item && typeof item === "object") { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } return item; };
  return freeze(clone);
}
export function digestValue(value: unknown): Digest { jsonValue(value); return ("sha256:" + createHash("sha256").update(canonicalExact(value)).digest("hex")) as Digest; }
