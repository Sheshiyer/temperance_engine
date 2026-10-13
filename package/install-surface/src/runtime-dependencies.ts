import { types } from "node:util";
import type { RuntimeDependency } from "./types.ts";

export class RuntimeDependencyError extends Error {
  constructor(readonly code: "DEPENDENCY_DECLARATION_INVALID" | "DEPENDENCY_HTTP_UNSUPPORTED") { super(code); }
}
function invalid(): never { throw new RuntimeDependencyError("DEPENDENCY_DECLARATION_INVALID"); }
/** Bounded declarations; caller owns the outer DTO size and trusted IO behavior.
 * Detached scalar snapshots reject accessors, proxies and option/path names.
 */
export function normalizeRuntimeDependencies(value: unknown): readonly RuntimeDependency[] {
  if (value === undefined) return Object.freeze([]);
  if (types.isProxy(value) || !Array.isArray(value) || value.length > 32) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(k => k !== "length" && (typeof k !== "string" || !/^(0|[1-9][0-9]*)$/.test(k)))) invalid();
  const seen = new Set<string>(); const result: RuntimeDependency[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (!item || !("value" in item)) invalid();
    const raw = item.value;
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) invalid();
    const kind = Object.getOwnPropertyDescriptor(raw, "kind");
    if (!kind || !("value" in kind)) invalid();
    const key = kind.value === "binary" ? "name" : kind.value === "http-health" ? "url_token" : invalid();
    const own = Reflect.ownKeys(raw);
    const field = Object.getOwnPropertyDescriptor(raw, key);
    if (own.length !== 2 || !own.includes("kind") || !own.includes(key) || !field || !("value" in field)) invalid();
    const text = field.value;
    if (typeof text !== "string" || !(key === "name" ? /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}(?![\s\S])/ : /^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/).test(text)) invalid();
    const id = `${kind.value}:${text}`; if (seen.has(id)) invalid(); seen.add(id);
    result.push(Object.freeze(key === "name" ? { kind: "binary", name: text } : { kind: "http-health", url_token: text }));
  }
  return Object.freeze(result);
}
export function assertRuntimeDependenciesSupported(dependencies: readonly RuntimeDependency[]): void {
  if (dependencies.some(dep => dep.kind === "http-health")) throw new RuntimeDependencyError("DEPENDENCY_HTTP_UNSUPPORTED");
}
