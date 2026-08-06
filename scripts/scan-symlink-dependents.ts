#!/usr/bin/env bun
/**
 * Emits the symlinks under a bounded set of tool-wiring roots, as a manifest
 * for `vault-project-relocation.ts plan --symlink-manifest`.
 *
 * DELIBERATELY NOT PART OF THE RELOCATION SUBSYSTEM. That subsystem carries an
 * executable source guard forbidding provider-home traversal — no `homedir()`,
 * no `process.env.HOME` — because it must never walk session stores,
 * transcripts, or credential directories. Scanning for symlink dependents
 * needs exactly that traversal, so it lives here instead and hands the result
 * across as evidence, the same way packet validation and the path-consumer
 * audit are supplied rather than gathered.
 *
 * Reads directory structure and link targets only. It never opens a file.
 *
 * Usage:
 *   bun scripts/scan-symlink-dependents.ts --output <absolute-path.json>
 *                                          [--root <dir> ...] [--max-depth <n>]
 */

import { lstatSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

interface SymlinkCandidate {
  link: string;
  target: string;
}

const DEFAULT_ROOTS = [".agents", ".claude", ".kimi", join(".local", "bin"), ".config"];
const DEFAULT_MAX_DEPTH = 3;

function parseArgs(argv: string[]): { output: string; roots: string[]; maxDepth: number } {
  let output = "";
  let maxDepth = DEFAULT_MAX_DEPTH;
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output") output = argv[++i] ?? "";
    else if (arg === "--root") roots.push(argv[++i] ?? "");
    else if (arg === "--max-depth") maxDepth = Number(argv[++i] ?? DEFAULT_MAX_DEPTH);
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!output || !isAbsolute(output)) throw new Error("absolute_output_required");
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("max_depth_must_be_a_non_negative_integer");
  return {
    output: resolve(output),
    roots: roots.length > 0 ? roots.map((r) => resolve(r)) : DEFAULT_ROOTS.map((r) => join(homedir(), r)),
    maxDepth,
  };
}

function scan(root: string, maxDepth: number): SymlinkCandidate[] {
  const found: SymlinkCandidate[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // missing or unreadable root is not an error; nothing links from it
    }
    for (const name of entries) {
      const path = join(dir, name);
      let stats;
      try {
        stats = lstatSync(path);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) {
        try {
          found.push({ link: path, target: resolve(dir, readlinkSync(path)) });
        } catch {
          /* unreadable link has no comparable target */
        }
      } else if (stats.isDirectory()) {
        walk(path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

try {
  const { output, roots, maxDepth } = parseArgs(process.argv.slice(2));
  const candidates = roots.flatMap((root) => scan(root, maxDepth));
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, roots, maxDepth, candidates }, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify({ output, roots: roots.length, symlinks: candidates.length }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
