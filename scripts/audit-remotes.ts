#!/usr/bin/env bun
/**
 * Audits git remotes for misconfiguration.
 *
 * Written after finding the vault root carrying a second remote pointing at
 * `iverif-wiki` — an entirely unrelated PUBLIC repository. Nothing had been
 * pushed, but one mistyped `git push iverif` would have sent 15 GB of private
 * vault content to a public repo. That kind of defect is invisible until
 * someone enumerates remotes deliberately, which is what this does.
 *
 * READ ONLY. It reports; it never edits a remote, fetches, or pushes.
 *
 * What it flags:
 *   unrelated-remote  the remote's tracked history shares NO merge-base with
 *                     HEAD. The strongest signal, and exactly the iverif case:
 *                     two repositories that were never the same project.
 *   public-remote     a PUBLIC remote on a repository named private via
 *                     --private-repo. Scoped to exact repos, not a tree: the
 *                     vault contains legitimately public projects, so flagging
 *                     the whole tree buries the one case that matters.
 *   multiple-remotes  informational. Not a defect on its own, but it is how the
 *                     mistake happens, so the pairing is worth seeing.
 *   no-remote         history exists nowhere else; a deleted .git is unrecoverable.
 *
 * Usage:
 *   bun scripts/audit-remotes.ts [--root <dir> ...] [--private-root <dir> ...]
 *                               [--private-repo <dir> ...] [--no-visibility] [--json <path>]
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_ROOTS = ["/Volumes/madara/2026/twc-vault", "/Volumes/madara/2026/Projects"];
const MAX_DEPTH = 6;

interface Finding {
  repo: string;
  kind: "unrelated-remote" | "public-remote" | "multiple-remotes" | "no-remote";
  detail: string;
}

function parseArgs(argv: string[]) {
  const roots: string[] = [];
  const privateRoots: string[] = [];
  let visibility = true;
  let jsonOut = "";
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") roots.push(resolve(argv[++i] ?? ""));
    else if (a === "--private-repo") privateRoots.push(resolve(argv[++i] ?? ""));
    else if (a === "--no-visibility") visibility = false;
    else if (a === "--json") jsonOut = argv[++i] ?? "";
    else throw new Error(`unknown_argument:${a}`);
  }
  if (jsonOut && !isAbsolute(jsonOut)) throw new Error("json_path_must_be_absolute");
  return {
    roots: roots.length ? roots : DEFAULT_ROOTS,
    // EXACT repositories whose own content is private, not a tree prefix. The
    // first version treated everything under the vault as private and produced
    // 41 findings, nearly all noise: the vault CONTAINS legitimately public
    // project repos (skill-clusters, team-forge-ts). What actually matters is a
    // public remote on the repo holding private vault content — the vault root
    // itself, which is where the iverif remote was.
    privateRepos: privateRoots.length ? privateRoots : ["/Volumes/madara/2026/twc-vault"],
    visibility,
    jsonOut,
  };
}

function git(dir: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function repositories(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes(".git")) {
      // A worktree's .git is a FILE and shares the parent's remotes; auditing it
      // would double-report the parent's configuration as its own.
      try {
        if (statSync(join(dir, ".git")).isDirectory()) found.push(dir);
      } catch { /* unreadable */ }
      // Deliberately does NOT return. The vault root is itself a repository, so
      // stopping here shadowed all 124 repositories nested inside it and the
      // audit reported 8. Nested repositories are real and are exactly what
      // needs auditing.
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) walk(path, depth + 1);
      } catch { /* skip */ }
    }
  };
  if (existsSync(root)) walk(root, 0);
  return found.sort();
}

const visibilityCache = new Map<string, string>();
function repoVisibility(url: string): string | null {
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if (!m) return null;
  const slug = m[1];
  if (visibilityCache.has(slug)) return visibilityCache.get(slug)!;
  const r = spawnSync("gh", ["repo", "view", slug, "--json", "visibility", "-q", ".visibility"],
    { encoding: "utf8" });
  const v = r.status === 0 ? r.stdout.trim() : "UNKNOWN";
  visibilityCache.set(slug, v);
  return v;
}

/**
 * True when the remote's tracked history and HEAD share no common ancestor.
 * Uses existing remote-tracking refs only — no fetch, so this stays read-only
 * and offline. A remote with no tracking refs yet is not evidence either way.
 */
function isUnrelated(dir: string, remote: string): boolean | null {
  const refs = git(dir, ["for-each-ref", "--format=%(refname)", `refs/remotes/${remote}`]);
  if (!refs) return null;
  const head = git(dir, ["rev-parse", "HEAD"]);
  if (!head) return null;
  for (const ref of refs.split("\n").filter(Boolean)) {
    if (git(dir, ["merge-base", head, ref]) !== null) return false;
  }
  return true;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const findings: Finding[] = [];
  let scanned = 0;

  for (const root of opts.roots) {
    for (const dir of repositories(root)) {
      scanned += 1;
      const isPrivateRepo = opts.privateRepos.some((p) => resolve(dir) === resolve(p));
      const remotes = (git(dir, ["remote"]) ?? "").split("\n").filter(Boolean);
      const short = dir.replace("/Volumes/madara/2026/", "");

      if (remotes.length === 0) {
        findings.push({ repo: short, kind: "no-remote", detail: "history exists only here" });
        continue;
      }
      if (remotes.length > 1) {
        findings.push({ repo: short, kind: "multiple-remotes", detail: remotes.join(", ") });
      }
      for (const remote of remotes) {
        const url = git(dir, ["remote", "get-url", remote]) ?? "";
        if (isUnrelated(dir, remote) === true) {
          findings.push({ repo: short, kind: "unrelated-remote", detail: `${remote} -> ${url} (no merge-base with HEAD)` });
        }
        if (opts.visibility && isPrivateRepo) {
          if (repoVisibility(url) === "PUBLIC") {
            findings.push({ repo: short, kind: "public-remote", detail: `${remote} -> ${url}` });
          }
        }
      }
    }
  }

  const byKind = (k: Finding["kind"]) => findings.filter((f) => f.kind === k);
  // Timestamp first: launchd appends to one log file, so without this a daily
  // run is indistinguishable from the one before it.
  console.log(`=== audit-remotes ${new Date().toISOString()} ===`);
  console.log(`roots: ${opts.roots.join(", ")}`);
  console.log(`repositories scanned: ${scanned}`);
  console.log(`findings: ${findings.length}\n`);
  for (const kind of ["unrelated-remote", "public-remote", "multiple-remotes", "no-remote"] as const) {
    const rows = byKind(kind);
    console.log(`=== ${kind} (${rows.length}) ===`);
    for (const f of rows.slice(0, 25)) console.log(`  ${f.repo}\n      ${f.detail}`);
    if (rows.length > 25) console.log(`  …and ${rows.length - 25} more`);
    console.log("");
  }
  if (opts.jsonOut) {
    writeFileSync(opts.jsonOut, `${JSON.stringify({ scanned, findings }, null, 2)}\n`, { mode: 0o600 });
    console.log(`wrote ${opts.jsonOut}`);
  }
  // Exit non-zero only for the defect class that is genuinely dangerous.
  process.exit(byKind("unrelated-remote").length > 0 ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
