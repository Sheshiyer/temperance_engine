#!/usr/bin/env bun
/** Process boundary for shell callers. Shared policy modules remain I/O-free. */
import { readFileSync } from "node:fs";
import { classifyTaskType, preferredForTaskType } from "./task-classification";
import { resolvePhaseCombo } from "./phase-resolution";

export function runRoutingContract(args: readonly string[]): string {
  const [operation, value = "", task = "", mapPath] = args;
  if (operation === "type") return classifyTaskType(value);
  if (operation === "preferred") return preferredForTaskType(value);
  if (operation === "phase") {
    let map: unknown = null;
    if (mapPath) {
      try { map = JSON.parse(readFileSync(mapPath, "utf8")); }
      catch { /* Missing/malformed configuration follows the declared fallback. */ }
    }
    return resolvePhaseCombo(value, task, map).combo;
  }
  throw new Error("usage: routing-contract-cli.ts <type|preferred|phase> value [task map-path]");
}

if (import.meta.main) {
  try { process.stdout.write(`${runRoutingContract(process.argv.slice(2))}\n`); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "routing contract failed"}\n`);
    process.exitCode = 2;
  }
}
