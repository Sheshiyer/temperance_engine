import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Executable source guards (Task 9 / ISC-654-657, ISC-704-706): prove by
 * inspecting the actual production source text — not by trusting a design
 * doc — that the relocation subsystem contains no provider-home traversal,
 * Paseo import/reconciliation, network Git, history rewrite, credential
 * access, transcript access, or automatic staging/commit/push.
 *
 * Test-only files are deliberately excluded: fixtures legitimately call
 * `git init`/`git worktree add` to build throwaway temp repos, and this
 * file's own doc comments legitimately use words like "transcript" and
 * ".ssh" to describe what must be absent. Comments are stripped before
 * scanning so this guard tests real code, not prose about the code.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");

const PRODUCTION_RELOCATION_FILES = [
  "package/relocation/project-relocation-grammar.ts",
  "package/relocation/project-path-consumers.ts",
  "package/relocation/project-packet-schema.ts",
  "package/relocation/project-packet.ts",
  "package/relocation/project-registry.ts",
  "package/relocation/project-capsule.ts",
  "package/relocation/project-relocation-transaction.ts",
  "package/relocation/project-pickup.ts",
  "package/relocation/project-relocation-rollback.ts",
  "package/relocation/project-relocation-apply.ts",
  "package/relocation/project-management-record.ts",
  "scripts/vault-project-relocation.ts",
  "package/relocation/project-session-map.ts",
  "package/relocation/session-store-matchers/claude-code-matcher.ts",
  "package/relocation/session-store-matchers/opencode-matcher.ts",
  "package/relocation/session-store-matchers/copilot-matcher.ts",
  "package/relocation/session-store-matchers/codex-matcher.ts",
  "package/relocation/session-store-matchers/kimi-matcher.ts",
  "package/relocation/session-store-matchers/craft-agent-matcher.ts",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readProductionCode(relativePath: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, relativePath), "utf8"));
}

function readAllProductionCode(): Map<string, string> {
  return new Map(PRODUCTION_RELOCATION_FILES.map((file) => [file, readProductionCode(file)]));
}

function assertNoneContain(pattern: RegExp, description: string): void {
  const offenders: string[] = [];
  for (const [file, code] of readAllProductionCode()) {
    if (pattern.test(code)) offenders.push(file);
  }
  expect(offenders, `${description} — found in: ${offenders.join(", ")}`).toEqual([]);
}

describe("source guards — every production relocation file", () => {
  test("every listed production file actually exists and is non-empty", () => {
    for (const file of PRODUCTION_RELOCATION_FILES) {
      expect(readProductionCode(file).length).toBeGreaterThan(0);
    }
  });

  test("no provider-home or session-store traversal: no homedir() call, no bare HOME env read", () => {
    assertNoneContain(/\bhomedir\s*\(/, "homedir() call");
    assertNoneContain(/process\.env(?:\.HOME\b|\[["']HOME["']\])/, "process.env.HOME read");
  });

  test("no Paseo import, call, or reference anywhere", () => {
    assertNoneContain(/paseo/i, "Paseo reference");
  });

  test("no network Git operation (clone/fetch/pull/push/remote-mutating)", () => {
    assertNoneContain(/["'](?:clone|fetch|pull|push)["']/, "network Git subcommand literal");
  });

  test("no history-rewrite Git operation (rebase/filter-branch/filter-repo/gc/reflog/reset --hard)", () => {
    assertNoneContain(/["'](?:rebase|filter-branch|filter-repo|gc|reflog)["']/, "history-rewrite Git subcommand literal");
    assertNoneContain(/reset["',\s]+--hard/, "git reset --hard");
  });

  test("no automatic staging, commit, or push Git subcommand literal", () => {
    assertNoneContain(/["'](?:add|commit|stage)["']/, "staging/commit Git subcommand literal");
  });

  test("no credential-file access pattern (.ssh, id_rsa, api key, credentials.json, PEM markers)", () => {
    assertNoneContain(/\.ssh\//, ".ssh/ path literal");
    assertNoneContain(/id_rsa/, "id_rsa path literal");
    assertNoneContain(/credentials\.json/, "credentials.json path literal");
    assertNoneContain(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "embedded PEM private key marker");
  });

  test("no transcript or native-session-store access pattern", () => {
    assertNoneContain(/\btranscript\b/i, "transcript reference");
    assertNoneContain(/session\.jsonl/, "session.jsonl reference");
  });

  test("every Git subcommand actually invoked across production code is read-only", () => {
    const readOnlySubcommands = new Set([
      "ls-files",
      "grep",
      "status",
      "rev-parse",
      "branch",
      "remote",
      "show",
      "show-ref",
      "worktree",
    ]);
    const invoked = new Set<string>();
    for (const [, code] of readAllProductionCode()) {
      const matches = code.matchAll(/spawnSync\("git",\s*\[([^\]]*)\]/g);
      for (const match of matches) {
        const args = [...match[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
        // The first non-flag argument after any -C <path> pair is the subcommand.
        for (let index = 0; index < args.length; index += 1) {
          if (args[index] === "-C") {
            index += 1;
            continue;
          }
          invoked.add(args[index]);
          break;
        }
      }
    }
    for (const subcommand of invoked) {
      expect(readOnlySubcommands.has(subcommand), `unexpected non-read-only Git subcommand: ${subcommand}`).toBe(
        true,
      );
    }
    // Sanity: the scan actually found something, proving this isn't a
    // vacuously-true check over zero matches.
    expect(invoked.size).toBeGreaterThan(0);
  });

  test("no session-map file ever reads session/transcript file content — no .jsonl literal anywhere", () => {
    assertNoneContain(/\.jsonl/, ".jsonl file reference");
  });

  test("symlinkSync is called from exactly one production call site across the whole file set", () => {
    let totalMatches = 0;
    const offenders: string[] = [];
    for (const [file, code] of readAllProductionCode()) {
      const matches = [...code.matchAll(/symlinkSync\s*\(/g)];
      if (matches.length > 0) {
        totalMatches += matches.length;
        offenders.push(`${file} (${matches.length})`);
      }
    }
    expect(totalMatches, `symlinkSync call sites: ${offenders.join(", ")}`).toBe(1);
  });
});
