#!/usr/bin/env bun
// docs-gate.ts - STE ratchet for the Temperance Engine docs.
//
// Each in-scope doc (docs-scope.json) has a committed error count in
// docs-baseline.json. The gate fails when a doc has more STE errors than its
// baseline, or when a doc that is not in the baseline has any error. Docs can only
// get better: --tighten lowers counts and drops stale entries, and never raises one.
//
// The gate checks the structural rules only (--no-vocab). It needs no network and
// no ASD-STE100 word list, so CI runs it as-is.
//
// Usage:
//   bun package/ste-check/docs-gate.ts                 # check (CI)
//   bun package/ste-check/docs-gate.ts --tighten       # lower the baseline after doc fixes
//   bun package/ste-check/docs-gate.ts --init-baseline # write the first baseline

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { MODES, Report, checkText, normalizeNewlines, type Mode } from "./ste-check";

export const BASELINE_SCHEMA = "temperance.ste-docs-baseline.v1";

export interface Scope {
  include: string[];
  exclude: string[];
  default_mode: Mode;
  modes: Record<string, Mode>;
}

export interface Baseline {
  schema: string;
  files: Record<string, { errors: number }>;
}

export interface FileResult {
  path: string;
  mode: Mode;
  errors: number;
  baseline: number | null;
}

export interface Evaluation {
  results: FileResult[];
  failures: string[];
  tighten: string[];
}

export async function loadScope(path: string): Promise<Scope> {
  const raw = await Bun.file(path).json();
  const scope: Scope = {
    include: raw.include ?? [],
    exclude: raw.exclude ?? [],
    default_mode: raw.default_mode ?? "mixed",
    modes: raw.modes ?? {},
  };
  for (const mode of [scope.default_mode, ...Object.values(scope.modes)]) {
    if (!(MODES as readonly string[]).includes(mode)) throw new Error(`invalid mode in ${path}: ${mode}`);
  }
  return scope;
}

export async function loadBaseline(path: string): Promise<Baseline> {
  const raw = await Bun.file(path).json();
  if (raw.schema !== BASELINE_SCHEMA) throw new Error(`unexpected baseline schema in ${path}: ${raw.schema}`);
  return { schema: raw.schema, files: raw.files ?? {} };
}

export function serializeBaseline(files: Record<string, { errors: number }>): string {
  const sorted: Record<string, { errors: number }> = {};
  for (const key of Object.keys(files).sort()) sorted[key] = { errors: files[key].errors };
  return JSON.stringify({ schema: BASELINE_SCHEMA, files: sorted }, null, 2) + "\n";
}

/** Repo-relative paths of the in-scope docs, sorted. */
export function scopeFiles(root: string, scope: Scope): string[] {
  const excluded = new Set<string>();
  for (const pattern of scope.exclude) {
    for (const p of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) excluded.add(p);
  }
  const files = new Set<string>();
  for (const pattern of scope.include) {
    for (const p of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      if (!excluded.has(p)) files.add(p);
    }
  }
  return [...files].sort();
}

// A line whose first non-blank character is `#` or `|`: an ATX heading (CommonMark
// allows up to three leading spaces), a table row, or anything else that makes the
// checker skip the block it starts. Leading whitespace matches Python's str.strip().
const SKIP_TRIGGER = /^[\s\x1c-\x1f\x85]*[#|]/u;

/**
 * Put each line that would make the checker skip its block in a block of its own.
 *
 * The checker (like upstream ste_check.py) trims a block and skips it whole when
 * it starts with `#` or `|`. Markdown lets prose follow a heading or a table,
 * indented or not, without a blank line, so without this the gate would skip
 * that prose and its errors. The CLI keeps the upstream behavior; only the gate
 * normalizes. Fenced code is left as is.
 */
export function isolateHeadingsAndTables(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
    } else if (!inFence && SKIP_TRIGGER.test(line)) {
      out.push("", line, "");
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

export async function countErrors(root: string, file: string, mode: Mode): Promise<number> {
  const report = new Report();
  const text = isolateHeadingsAndTables(normalizeNewlines(await Bun.file(join(root, file)).text()));
  checkText(text, mode, report, file, null);
  return report.errors.length;
}

export async function evaluate(root: string, scope: Scope, baseline: Baseline): Promise<Evaluation> {
  const files = scopeFiles(root, scope);
  const results: FileResult[] = [];
  const failures: string[] = [];
  const tighten: string[] = [];
  for (const path of files) {
    const mode = scope.modes[path] ?? scope.default_mode;
    const errors = await countErrors(root, path, mode);
    const base = baseline.files[path]?.errors ?? null;
    results.push({ path, mode, errors, baseline: base });
    if (base === null) {
      if (errors > 0) failures.push(`FAIL    ${path}: ${errors} errors (not in the baseline, so the limit is 0)`);
    } else if (errors > base) {
      failures.push(`FAIL    ${path}: ${errors} errors (baseline ${base})`);
    } else if (errors < base) {
      tighten.push(`TIGHTEN ${path}: ${errors} errors (baseline ${base})`);
    }
  }
  const inScope = new Set(files);
  for (const path of Object.keys(baseline.files).sort()) {
    if (!inScope.has(path)) tighten.push(`TIGHTEN ${path}: not in scope or deleted`);
  }
  return { results, failures, tighten };
}

/** Lower counts and drop stale entries. A count is never raised. */
export function tightenedFiles(baseline: Baseline, evaluation: Evaluation): Record<string, { errors: number }> {
  const out: Record<string, { errors: number }> = {};
  for (const r of evaluation.results) {
    if (r.baseline !== null) out[r.path] = { errors: Math.min(r.baseline, r.errors) };
  }
  return out;
}

export interface GateResult {
  stdout: string;
  code: number;
}

const DEFAULT_ROOT = resolve(import.meta.dir, "..", "..");

export async function runGate(argv: string[]): Promise<GateResult> {
  let root = DEFAULT_ROOT;
  let scopePath: string | null = null;
  let baselinePath: string | null = null;
  let action: "check" | "tighten" | "init" = "check";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") root = resolve(argv[++i] ?? "");
    else if (arg === "--scope") scopePath = argv[++i] ?? "";
    else if (arg === "--baseline") baselinePath = argv[++i] ?? "";
    else if (arg === "--tighten") action = "tighten";
    else if (arg === "--init-baseline") action = "init";
    else return { stdout: `docs-gate: unknown argument: ${arg}\n`, code: 2 };
  }
  scopePath ??= join(root, "package", "ste-check", "docs-scope.json");
  baselinePath ??= join(root, "package", "ste-check", "docs-baseline.json");
  const scope = await loadScope(scopePath);
  const lines: string[] = [];

  if (action === "init") {
    if (existsSync(baselinePath)) {
      return { stdout: `docs-gate: ${baselinePath} exists. Use --tighten to lower it.\n`, code: 2 };
    }
    const evaluation = await evaluate(root, scope, { schema: BASELINE_SCHEMA, files: {} });
    const files: Record<string, { errors: number }> = {};
    for (const r of evaluation.results) files[r.path] = { errors: r.errors };
    await Bun.write(baselinePath, serializeBaseline(files));
    return { stdout: `docs-gate: wrote a baseline for ${evaluation.results.length} files.\n`, code: 0 };
  }

  if (!existsSync(baselinePath)) {
    return { stdout: `docs-gate: no baseline at ${baselinePath}. Run with --init-baseline.\n`, code: 2 };
  }
  const baseline = await loadBaseline(baselinePath);
  const evaluation = await evaluate(root, scope, baseline);

  if (action === "tighten") {
    await Bun.write(baselinePath, serializeBaseline(tightenedFiles(baseline, evaluation)));
    lines.push(`docs-gate: tightened the baseline (${evaluation.tighten.length} entries changed).`);
  } else {
    lines.push(...evaluation.tighten);
  }
  lines.push(...evaluation.failures);
  if (evaluation.failures.length > 0) {
    lines.push("");
    lines.push("To see the errors in a file, run:");
    lines.push("  bun package/ste-check/cli.ts --no-vocab --mode <mode> <file>");
    lines.push("Refer to docs/ste.md. Do not raise a baseline count to make the gate pass.");
  } else if (action === "check" && evaluation.tighten.length > 0) {
    lines.push("Run `bun package/ste-check/docs-gate.ts --tighten` to lower the baseline.");
  }
  lines.push(
    `ste docs gate: ${evaluation.results.length} files, ${evaluation.failures.length} failures, ` +
      `${action === "tighten" ? 0 : evaluation.tighten.length} can tighten.`,
  );
  return { stdout: lines.join("\n") + "\n", code: evaluation.failures.length > 0 ? 1 : 0 };
}

if (import.meta.main) {
  const result = await runGate(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exit(result.code);
}
