#!/usr/bin/env bun
/**
 * Promotes planning documents that still carry outstanding work into GitHub
 * issues, so an agent can be pointed at an issue number instead of being told
 * where to look. This closes the gap where planning lives in local .md files
 * and never becomes addressable work.
 *
 * GRANULARITY — one issue per DOCUMENT, not per checkbox. At the time this was
 * written there were 1,606 open checkboxes across the relocated repositories
 * and 1,032 of them sat in a single file. Those are sub-steps of a plan, not
 * portfolio work items; an issue each would bury the tracker. A document-level
 * issue matches how the existing issues were written ("GH-001 ... Source:
 * <doc>") and how the work is actually picked up: read the plan, execute it.
 * The document stays the source of truth; the issue is the addressable pointer.
 *
 * IDEMPOTENT — every body carries `<!-- plan-sync:<repo>:<path> -->`. A
 * document that already has an issue is skipped, so this is safe to re-run on
 * a schedule or after any planning session: it only ever syncs what is new.
 *
 * TARGET — defaults to the private vault repository, not the individual project
 * repositories. Most of those are public, and scattering planning across 37 of
 * them makes "which issue" unanswerable, which is the problem this solves.
 *
 * Dry run by default; --apply creates issues.
 *
 * Usage:
 *   bun scripts/plan-issue-sync.ts [--apply] [--limit <n>]
 *                                  [--target <owner/repo>]
 *                                  [--projects-root <dir>] [--registry-root <dir>]
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const DEFAULTS = {
  target: "Sheshiyer/thoughtseed-vault",
  projectsRoot: "/Volumes/madara/2026/Projects/thoughtseed",
  registryRoot:
    "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium/docs/project-management/relocation-registry/thoughtseed",
};

/** Directories that hold plan documents. Anything under an archive/ path is skipped. */
const PLAN_DIRS = [".planning", "docs/plans", "tasks", "docs/superpowers/plans"];
const OPEN_BOX = /^[ \t]*[-*][ \t]*\[ \][ \t]+(.{4,160})$/gm;
const DONE_BOX = /^[ \t]*[-*][ \t]*\[[xX]\][ \t]+/gm;
const HEADING = /^#[ \t]+(.+)$/m;
const MARKER = /<!-- plan-sync:(.+?) -->/;
/** Outstanding items quoted into the issue body; the rest stay in the document. */
const ITEM_PREVIEW = 8;

interface Candidate {
  repo: string;
  relativePath: string;
  marker: string;
  title: string;
  open: number;
  done: number;
  items: string[];
  githubIdentity?: string;
  stableId?: string;
}

function parseArgs(argv: string[]) {
  const opts = { ...DEFAULTS, apply: false, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--limit") opts.limit = Number(argv[++i] ?? 0);
    else if (arg === "--target") opts.target = argv[++i] ?? "";
    else if (arg === "--projects-root") opts.projectsRoot = argv[++i] ?? "";
    else if (arg === "--registry-root") opts.registryRoot = argv[++i] ?? "";
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!opts.target.includes("/")) throw new Error("target_must_be_owner_slash_repo");
  if (!Number.isInteger(opts.limit) || opts.limit < 0) throw new Error("limit_must_be_a_non_negative_integer");
  return opts;
}

/** Relocated repositories, by destination basename -> registry entry. */
function registryIndex(registryRoot: string): Map<string, { stableId: string; githubIdentity?: string }> {
  const index = new Map<string, { stableId: string; githubIdentity?: string }>();
  if (!existsSync(registryRoot)) return index;
  for (const name of readdirSync(registryRoot)) {
    const entryPath = join(registryRoot, name, "entry.json");
    if (!existsSync(entryPath)) continue;
    try {
      const record = JSON.parse(readFileSync(entryPath, "utf8"));
      index.set(String(record.stableId).split(".").pop() ?? name, record);
    } catch {
      continue; // an unparseable entry is not worth aborting the whole sync
    }
  }
  return index;
}

function gitRepositories(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes(".git")) {
      found.push(dir);
      return; // do not descend into a repository's own worktrees
    }
    for (const name of entries) {
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) walk(path, depth + 1);
      } catch {
        continue;
      }
    }
  };
  walk(root, 0);
  return found.sort();
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(current, name);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(path);
      else if (name.endsWith(".md")) out.push(path);
    }
  };
  walk(dir);
  return out.sort();
}

function collectCandidates(opts: ReturnType<typeof parseArgs>): Candidate[] {
  const registry = registryIndex(opts.registryRoot);
  const rows: Candidate[] = [];
  for (const repo of gitRepositories(opts.projectsRoot)) {
    const repoName = basename(repo);
    const entry = registry.get(repoName);
    for (const planDir of PLAN_DIRS) {
      const dir = join(repo, planDir);
      if (!existsSync(dir)) continue;
      for (const file of markdownFiles(dir)) {
        const relativePath = relative(repo, file);
        if (relativePath.toLowerCase().includes("archive/")) continue;
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const open = [...text.matchAll(OPEN_BOX)].map((m) => m[1].trim());
        if (open.length === 0) continue;
        rows.push({
          repo: repoName,
          relativePath,
          marker: `${repoName}:${relativePath}`,
          title: (HEADING.exec(text)?.[1] ?? basename(relativePath)).trim().slice(0, 120),
          open: open.length,
          done: [...text.matchAll(DONE_BOX)].length,
          items: open.slice(0, ITEM_PREVIEW),
          githubIdentity: entry?.githubIdentity,
          stableId: entry?.stableId,
        });
      }
    }
  }
  return rows;
}

function syncedMarkers(target: string): Set<string> {
  const result = spawnSync(
    "gh",
    ["issue", "list", "--repo", target, "--state", "all", "--limit", "1000", "--json", "body"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`gh_issue_list_failed:${result.stderr.trim()}`);
  const markers = new Set<string>();
  for (const issue of JSON.parse(result.stdout) as { body?: string }[]) {
    const found = MARKER.exec(issue.body ?? "");
    if (found) markers.add(found[1].trim());
  }
  return markers;
}

function issueBody(candidate: Candidate): string {
  const lines = [`<!-- plan-sync:${candidate.marker} -->`];
  lines.push(
    `**Repository:** \`${candidate.repo}\`` +
      (candidate.githubIdentity
        ? ` — [${candidate.githubIdentity}](https://github.com/${candidate.githubIdentity})`
        : ""),
  );
  lines.push(`**Plan document:** \`${candidate.relativePath}\``);
  if (candidate.stableId) lines.push(`**WorkObject:** \`${candidate.stableId}\``);
  lines.push("", `${candidate.open} outstanding item(s), ${candidate.done} already complete.`, "", "Outstanding:");
  for (const item of candidate.items) lines.push(`- [ ] ${item}`);
  if (candidate.open > candidate.items.length) {
    lines.push(`- …and ${candidate.open - candidate.items.length} more in the document.`);
  }
  lines.push(
    "",
    "---",
    "The document is the source of truth; this issue is a pointer to it. " +
      "Work it there and close this when its outstanding items are done.",
  );
  return lines.join("\n");
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const rows = collectCandidates(opts);
  const synced = syncedMarkers(opts.target);
  let todo = rows.filter((row) => !synced.has(row.marker));
  if (opts.limit > 0) todo = todo.slice(0, opts.limit);

  console.log(`target                   : ${opts.target}`);
  console.log(`plan docs with open work : ${rows.length}`);
  console.log(`already synced           : ${rows.length - rows.filter((r) => !synced.has(r.marker)).length}`);
  console.log(`to create                : ${todo.length}${opts.limit > 0 ? ` (limited to ${opts.limit})` : ""}`);
  console.log(`mode                     : ${opts.apply ? "APPLY" : "DRY RUN — nothing created"}\n`);
  for (const candidate of todo) {
    console.log(`  ${candidate.repo.padEnd(26)} ${String(candidate.open).padStart(4)} open  ${candidate.relativePath}`);
  }

  if (!opts.apply) process.exit(0);

  let created = 0;
  for (const candidate of todo) {
    const result = spawnSync(
      "gh",
      [
        "issue", "create",
        "--repo", opts.target,
        "--title", `${candidate.repo}: ${candidate.title}`,
        "--body", issueBody(candidate),
        "--label", "vault",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      console.error(`  FAILED ${candidate.marker}: ${result.stderr.trim().slice(0, 160)}`);
      break; // stop rather than continue past an unexplained failure
    }
    created += 1;
    console.log(`  created ${result.stdout.trim()}`);
  }
  console.log(`\ncreated: ${created}/${todo.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
