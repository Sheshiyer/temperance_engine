#!/usr/bin/env bun
// cli.ts - command line for the bun port of the upstream STE check tool.
//
// Usage:
//   bun package/ste-check/cli.ts [--mode procedural|descriptive|mixed] [--word-list PATH] [--no-vocab] FILE...
//   cat draft.txt | bun package/ste-check/cli.ts --mode procedural
//
// Stdout and exit codes match upstream scripts/ste_check.py: 0 = no errors, 1 = errors.
// Usage and I/O problems exit 2. The word list is not part of Temperance Engine; it
// comes from the upstream skill that scripts/install-ste.sh fetches.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { MODES, Report, checkText, formatReport, loadWordList, normalizeNewlines, type Mode } from "./ste-check";

export const SKILL_DIR_NAME = "simplified-technical-english";

const USAGE =
  "usage: cli.ts [-h] [--mode {procedural,descriptive,mixed}] [--word-list WORD_LIST] [--no-vocab] [files ...]";

function readError(e: unknown): string {
  return (e as NodeJS.ErrnoException)?.code ?? (e instanceof Error ? e.message : String(e));
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Find the upstream word-list.md: explicit path, then STE_SKILL_HOME, then AGENTS_HOME. */
export function defaultWordListPath(env: Record<string, string | undefined>): string | null {
  const candidates: string[] = [];
  if (env.STE_SKILL_HOME) candidates.push(join(env.STE_SKILL_HOME, "references", "word-list.md"));
  const agentsHome = env.AGENTS_HOME || (env.HOME ? join(env.HOME, ".agents") : null);
  if (agentsHome) candidates.push(join(agentsHome, "skills", SKILL_DIR_NAME, "references", "word-list.md"));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  readStdin: () => Promise<string> = () => Bun.stdin.text(),
): Promise<CliResult> {
  let mode: Mode = "mixed";
  let wordList: string | null = null;
  let noVocab = false;
  const files: string[] = [];
  const fail = (msg: string): CliResult => ({ stdout: "", stderr: `${USAGE}\ncli.ts: error: ${msg}\n`, code: 2 });

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = (): string | undefined => inline ?? argv[++i];
    if (flag === "-h" || flag === "--help") {
      return { stdout: `${USAGE}\n\nCheck text against the STE writing rules.\n`, stderr: "", code: 0 };
    } else if (flag === "--mode") {
      const v = value();
      if (!v || !(MODES as readonly string[]).includes(v)) {
        return fail(`argument --mode: invalid choice: '${v ?? ""}' (choose from 'procedural', 'descriptive', 'mixed')`);
      }
      mode = v as Mode;
    } else if (flag === "--word-list") {
      const v = value();
      if (!v) return fail("argument --word-list: expected one argument");
      wordList = v;
    } else if (flag === "--no-vocab") {
      noVocab = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      return fail(`unrecognized arguments: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  let stderr = "";
  let approved: Set<string> | null = null;
  if (!noVocab) {
    if (wordList !== null && !existsSync(wordList)) {
      return { stdout: "", stderr: `cli.ts: error: word list not found: ${wordList}\n`, code: 2 };
    }
    const wl = wordList ?? defaultWordListPath(env);
    if (wl) {
      try {
        approved = await loadWordList(wl);
      } catch (e) {
        return { stdout: "", stderr: `${stderr}cli.ts: error: cannot read word list ${wl}: ${readError(e)}\n`, code: 2 };
      }
    } else {
      stderr += "NOTE: no STE word list found (install with ./install.sh --with-ste); the vocabulary check is skipped.\n";
    }
  }

  const report = new Report();
  if (files.length > 0) {
    for (const f of files) {
      if (!existsSync(f)) return { stdout: "", stderr: `${stderr}cli.ts: error: file not found: ${f}\n`, code: 2 };
      let text: string;
      try {
        text = await Bun.file(f).text();
      } catch (e) {
        // An I/O problem (a directory, no permission) is exit 2, never an STE result.
        return { stdout: "", stderr: `${stderr}cli.ts: error: cannot read ${f}: ${readError(e)}\n`, code: 2 };
      }
      checkText(normalizeNewlines(text), mode, report, f, approved);
    }
  } else {
    let text: string;
    try {
      text = await readStdin();
    } catch (e) {
      return { stdout: "", stderr: `${stderr}cli.ts: error: cannot read stdin: ${readError(e)}\n`, code: 2 };
    }
    checkText(normalizeNewlines(text), mode, report, "stdin", approved);
  }

  return { stdout: formatReport(report), stderr, code: report.errors.length > 0 ? 1 : 0 };
}

if (import.meta.main) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.code);
}
