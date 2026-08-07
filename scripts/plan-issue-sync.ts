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
 * BIDIRECTIONAL — forward creates an issue for a document with outstanding
 * work; reverse closes an issue whose document has none left. A document that
 * has VANISHED is never treated as complete: it may have been renamed, moved,
 * or its repository relocated, and closing on that guess destroys the only
 * pointer back to the work. Missing and ambiguous are reported, never acted on.
 *
 * Dry run by default; --apply creates and closes.
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
  // Ordered by precedence. A repository present in more than one root is the
  // SAME project, not two: the first root listed wins. temperance_engine is
  // ALWAYS_HELD and so lives only in the vault, which is why the vault is a
  // root at all -- without it, its plans are invisible and its issues orphan.
  projectsRoots: [
    "/Volumes/madara/2026/Projects/thoughtseed",
    // Narrowly the one project, NOT the whole vault tree. Rooting at the vault
    // directory pulls in review clones whose plans duplicate the live project's
    // (plexus-ts-github-settings-ota-review mirrors plexus-ts), plus ad-hoc
    // folders that were never projects. Only temperance_engine is both
    // ALWAYS_HELD and genuinely tracked, so only it is named.
    "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/temperance_engine",
  ],
  registryRoot:
    "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium/docs/project-management/relocation-registry/thoughtseed",
};

/** Directories that hold plan documents. Anything under an archive/ path is skipped. */
const PLAN_DIRS = [".planning", "docs/plans", "tasks", "docs/superpowers/plans"];
/**
 * Snapshot directories are not projects. `parkarea-aleph.pre-restore-20260807-0627`
 * is a restore point whose plan documents are frozen duplicates of the live
 * project's -- syncing them creates issues that can never close, because
 * nobody edits a backup. Matched on the directory name, not on contents.
 */
const SNAPSHOT_DIR = /(\.pre-restore-|\.bak$|\.backup$|\.orig$|~$|\.worktrees$)/;
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
  const opts = { ...DEFAULTS, projectsRoots: [...DEFAULTS.projectsRoots], apply: false, limit: 0 };
  let sawRoot = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--limit") opts.limit = Number(argv[++i] ?? 0);
    else if (arg === "--target") opts.target = argv[++i] ?? "";
    else if (arg === "--projects-root") {
      // Repeatable. The first occurrence replaces the defaults rather than
      // appending to them, so an explicit root list is exactly what is scanned.
      if (!sawRoot) { opts.projectsRoots = []; sawRoot = true; }
      opts.projectsRoots.push(argv[++i] ?? "");
    }
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

/**
 * Project directories, found by the presence of a plan directory rather than a
 * `.git`.
 *
 * Discovery used to walk for `.git`, which stopped working the moment the
 * project tree was deliberately de-gitted — every repository's history was
 * pushed and its `.git` removed so each session can `git init` fresh. A
 * project is a directory that holds planning, not one that holds a repository;
 * keying on `.git` conflated the two and made the sync silently find nothing.
 */
/**
 * The name a project is known by, in the grammar the rest of the system uses:
 * lowercase, underscores folded to hyphens. The vault directory is
 * `temperance_engine` while every issue marker says `temperance-engine`; without
 * folding, those never match and the issues orphan forever.
 */
function repoKey(dir: string): string {
  return basename(dir).toLowerCase().replace(/_/g, "-");
}

function projectDirectories(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (SNAPSHOT_DIR.test(basename(dir))) return;
    if (PLAN_DIRS.some((planDir) => existsSync(join(dir, planDir)))) {
      found.push(dir);
      return; // a project owns its planning; do not descend into sub-projects
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
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
  const seenRepos = new Set<string>();
  const allRepos: string[] = [];
  for (const root of opts.projectsRoots) {
    if (!existsSync(root)) continue;
    for (const repo of projectDirectories(root)) {
      const key = repoKey(repo);
      if (seenRepos.has(key)) continue;   // first root wins; same project, not two
      seenRepos.add(key);
      allRepos.push(repo);
    }
  }
  for (const repo of allRepos) {
    const repoName = repoKey(repo);
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

interface SyncedIssue {
  number: number;
  state: string;
  marker: string;
}

function syncedIssues(target: string): SyncedIssue[] {
  const result = spawnSync(
    "gh",
    ["issue", "list", "--repo", target, "--state", "all", "--limit", "1000", "--json", "body,number,state"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`gh_issue_list_failed:${result.stderr.trim()}`);
  const issues: SyncedIssue[] = [];
  for (const issue of JSON.parse(result.stdout) as { body?: string; number: number; state: string }[]) {
    const found = MARKER.exec(issue.body ?? "");
    if (found) issues.push({ number: issue.number, state: issue.state, marker: found[1].trim() });
  }
  return issues;
}

/**
 * Current state of the document a marker points at.
 *
 * The marker carries the repository BASENAME, but a nested repository lives at
 * a tenant path -- `tirakplus` is at `tirak/standalone-repos/tirakplus`, not at
 * the portfolio root. Rebuilding the path by joining the basename finds nothing
 * and reports every nested repository as orphaned, so the basename is resolved
 * against the repositories actually on disk instead.
 *
 * `missing` is deliberately NOT treated as complete. A document can disappear
 * because its work finished, but equally because it was renamed, moved, or the
 * repository relocated -- and closing an issue on that guess loses the only
 * pointer back to the work. Missing is reported for a human to resolve.
 *
 * An ambiguous basename (two repositories sharing a name under different
 * tenants) is reported rather than resolved to whichever matched first.
 */
function documentState(
  marker: string,
  repositoriesByName: Map<string, string[]>,
): { missing: boolean; ambiguous: boolean; open: number } {
  const separator = marker.indexOf(":");
  const repo = marker.slice(0, separator);
  const relativePath = marker.slice(separator + 1);
  const matches = repositoriesByName.get(repo) ?? [];
  if (matches.length > 1) return { missing: false, ambiguous: true, open: 0 };
  if (matches.length === 0) return { missing: true, ambiguous: false, open: 0 };
  const path = join(matches[0], relativePath);
  if (!existsSync(path)) return { missing: true, ambiguous: false, open: 0 };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { missing: true, ambiguous: false, open: 0 };
  }
  return { missing: false, ambiguous: false, open: [...text.matchAll(OPEN_BOX)].length };
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

  // The projects root lives on an external volume. When it is not mounted every
  // document looks missing, and on a schedule that would report all 45 issues as
  // orphaned every run. Nothing would be wrongly CLOSED -- orphans are never
  // acted on -- but the noise would bury a real orphan. Exit 0 rather than
  // non-zero: an unmounted drive is not a failure, and launchd should not treat
  // it as a crashing job.
  const presentRoots = opts.projectsRoots.filter((r) => existsSync(r));
  if (presentRoots.length === 0) {
    console.log(`no projects root present: ${opts.projectsRoots.join(", ")}`);
    console.log("nothing to sync — is the volume mounted?");
    process.exit(0);
  }

  const rows = collectCandidates(opts);
  if (rows.length === 0) {
    console.log(`no plan documents found under ${presentRoots.join(", ")} — refusing to act`);
    process.exit(0);
  }
  const issues = syncedIssues(opts.target);
  const syncedMarkerSet = new Set(issues.map((issue) => issue.marker));

  let toCreate = rows.filter((row) => !syncedMarkerSet.has(row.marker));
  if (opts.limit > 0) toCreate = toCreate.slice(0, opts.limit);

  // Reverse: an OPEN issue whose document no longer has outstanding items.
  // Same precedence as discovery: a repository present in more than one root
  // is one project, and the first root listed wins.
  const repositoriesByName = new Map<string, string[]>();
  for (const root of opts.projectsRoots) {
    if (!existsSync(root)) continue;
    for (const repo of projectDirectories(root)) {
      const key = repoKey(repo);
      if (!repositoriesByName.has(key)) repositoriesByName.set(key, [repo]);
    }
  }

  const openIssues = issues.filter((issue) => issue.state.toUpperCase() === "OPEN");
  const toClose: { issue: SyncedIssue; open: number }[] = [];
  const orphaned: SyncedIssue[] = [];
  const ambiguous: SyncedIssue[] = [];
  for (const issue of openIssues) {
    const state = documentState(issue.marker, repositoriesByName);
    if (state.ambiguous) ambiguous.push(issue);
    else if (state.missing) orphaned.push(issue);
    else if (state.open === 0) toClose.push({ issue, open: 0 });
  }

  console.log(`target                   : ${opts.target}`);
  console.log(`plan docs with open work : ${rows.length}`);
  console.log(`issues carrying a marker : ${issues.length} (${openIssues.length} open)`);
  console.log(`to create                : ${toCreate.length}${opts.limit > 0 ? ` (limited to ${opts.limit})` : ""}`);
  console.log(`to close (work complete) : ${toClose.length}`);
  console.log(`orphaned (doc missing)   : ${orphaned.length}`);
  console.log(`ambiguous repo basename  : ${ambiguous.length}`);
  console.log(`mode                     : ${opts.apply ? "APPLY" : "DRY RUN — nothing changed"}\n`);

  for (const candidate of toCreate) {
    console.log(`  + ${candidate.repo.padEnd(24)} ${String(candidate.open).padStart(4)} open  ${candidate.relativePath}`);
  }
  for (const { issue } of toClose) {
    console.log(`  - close #${issue.number}  ${issue.marker}`);
  }
  for (const issue of orphaned) {
    console.log(`  ? orphan #${issue.number}  ${issue.marker}  (document not found — left open, resolve by hand)`);
  }
  for (const issue of ambiguous) {
    console.log(`  ? ambiguous #${issue.number}  ${issue.marker}  (basename matches >1 repo — left open)`);
  }

  if (!opts.apply) process.exit(0);

  let created = 0;
  for (const candidate of toCreate) {
    const result = spawnSync(
      "gh",
      ["issue", "create", "--repo", opts.target,
       "--title", `${candidate.repo}: ${candidate.title}`,
       "--body", issueBody(candidate), "--label", "vault"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      console.error(`  FAILED create ${candidate.marker}: ${result.stderr.trim().slice(0, 160)}`);
      break;
    }
    created += 1;
    console.log(`  created ${result.stdout.trim()}`);
  }

  let closed = 0;
  for (const { issue } of toClose) {
    const result = spawnSync(
      "gh",
      ["issue", "close", String(issue.number), "--repo", opts.target,
       "--comment", "All outstanding items in the linked plan document are complete. " +
         "Closed by plan-issue-sync; reopen if the document gains new items."],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      console.error(`  FAILED close #${issue.number}: ${result.stderr.trim().slice(0, 160)}`);
      break;
    }
    closed += 1;
    console.log(`  closed #${issue.number}`);
  }

  console.log(`\ncreated: ${created}/${toCreate.length}   closed: ${closed}/${toClose.length}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
