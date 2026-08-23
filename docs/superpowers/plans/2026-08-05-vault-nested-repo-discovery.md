> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Vault Project Relocation — Nested-Repo Discovery (Piece B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **No parallel-dispatch candidates this time.** Unlike the session-map plan, every task here touches shared, interdependent code in sequence (a shared classifier two existing files migrate onto, then discovery, then collision detection, then wiring). There is no genuinely independent subset of tasks to fan out via `temperance-parallel-dispatch` — execute sequentially.

**Goal:** Make Git repositories nested two or more levels below a portfolio root discoverable by the existing `inventory` command, with enough provenance for the owner to judge each one, and with same-identity collisions (basename or GitHub remote) caught structurally before any registry entry is ever written.

**Architecture:** Two new small, independently fixture-tested modules — `project-nested-repo-discovery.ts` (bounded recursive `.git`-marker walk) and `project-candidate-collision.ts` (pure grouping/collision logic) — plus a third, `project-repository-classification.ts`, holding the one comparison currently duplicated between `scripts/vault-project-relocation.ts` and `package/relocation/project-relocation-apply.ts`. `scripts/vault-project-relocation.ts` wires all three into its existing `buildReport()`/`inventory` command behind a new, default-off `--max-depth` flag. No apply-side mutation code changes — confirmed in the design doc (§1.3) that nothing downstream of classification is nesting-aware.

**Tech Stack:** TypeScript, `bun:test`. Matches the existing `package/relocation/*` conventions exactly — no new libraries.

## Global Constraints

- `--max-depth` defaults to `0`. Omitting it must reproduce today's exact `inventory` behavior — every record gets `depth: 0` and `immediateParentPath: null`, and the existing hold-reason/candidate logic for depth-0 entries is untouched.
- The discovery walk never reads file content — only `.git` existence and type (directory vs. file) via `lstatSync`. A `.git` **file** (a worktree admin pointer) excludes that path from candidacy and the walk does not descend past it. A `.git` **directory** is a candidate; the walk does not descend into it either — a repository's own internal contents are never walked.
- The walk explicitly skips `node_modules` at every level.
- The walk is bounded to the two existing `PORTFOLIO_ROOTS` — it only ever starts from a depth-0 entry already enumerated by the existing scan, never from an arbitrary path.
- Collision detection holds **every** member of a colliding group — no automatic preference, no default winner.
- The new shared classifier (`project-repository-classification.ts`) does **not** land in `project-relocation-grammar.ts` — that file explicitly documents itself as having no filesystem/Git seam, and this function shells out to `git` and calls `realpathSync`. It lands in its own new file.
- `scripts/vault-project-relocation.ts` has no `export` statements and executes its CLI dispatch at the top level when run — it cannot be unit-tested by importing its functions. All new logic that needs direct fixture-level unit tests must live in a `package/relocation/*.ts` module with real exports; `scripts/vault-project-relocation.ts` only wires those modules together, tested at the CLI/subprocess level via `tests/vault-project-relocation.test.ts`'s existing `runCli()` helper.
- Fixture-only tests for every new pure function (`mkdtempSync`-created temp directories) — never the real vault. The two real, read-only CLI-level checks in Task 7 are the sole exception, matching the existing pattern already used for `inventory`/`plan` in `tests/vault-project-relocation.test.ts`.

---

### Task 1: `project-repository-classification.ts` — shared classifier

**Files:**
- Create: `package/relocation/project-repository-classification.ts`
- Create: `package/relocation/project-repository-classification.test.ts`

**Interfaces:**
- Produces: `classifyRepositoryByGitToplevel(path: string): { repositoryKind: "standalone-repository" | "nested-repository" | "not-a-repository"; gitTopLevel: string | null }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// package/relocation/project-repository-classification.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, realpathSync } from "node:path";
import { spawnSync } from "node:child_process";

import { classifyRepositoryByGitToplevel } from "./project-repository-classification";

function initGitRepo(path: string): void {
  spawnSync("git", ["init", "--quiet", path]);
  spawnSync("git", ["-C", path, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", path, "config", "user.name", "Test"]);
}

describe("classifyRepositoryByGitToplevel", () => {
  test("standalone-repository: path's own git toplevel equals itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "classify-standalone-"));
    initGitRepo(dir);

    const result = classifyRepositoryByGitToplevel(dir);

    expect(result.repositoryKind).toBe("standalone-repository");
    expect(result.gitTopLevel).toBe(realpathSync(dir));
    rmSync(dir, { recursive: true, force: true });
  });

  test("nested-repository: path has no own .git, git walks up to a parent repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "classify-nested-"));
    initGitRepo(dir);
    const subdir = join(dir, "plain-subdirectory");
    mkdirSync(subdir);

    const result = classifyRepositoryByGitToplevel(subdir);

    expect(result.repositoryKind).toBe("nested-repository");
    expect(result.gitTopLevel).toBe(realpathSync(dir));
    rmSync(dir, { recursive: true, force: true });
  });

  test("not-a-repository: no .git anywhere in the ancestor chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "classify-none-"));

    const result = classifyRepositoryByGitToplevel(dir);

    expect(result.repositoryKind).toBe("not-a-repository");
    expect(result.gitTopLevel).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("realpath normalization: a repo reached through a symlinked ancestor still classifies standalone", () => {
    // macOS resolves /tmp -> /private/tmp; mkdtempSync already returns a
    // path under /tmp, so git's own --show-toplevel output on this machine
    // already exercises the exact symlink-resolution case this function
    // exists to handle correctly (see the inline comment in the
    // implementation). This test's real assertion is simply that
    // gitTopLevel is the REALPATH'd form, not a raw comparison that would
    // fail under exactly this condition.
    const dir = mkdtempSync(join(tmpdir(), "classify-symlink-"));
    initGitRepo(dir);

    const result = classifyRepositoryByGitToplevel(dir);

    expect(result.gitTopLevel).toBe(realpathSync(dir));
    expect(result.gitTopLevel).not.toContain("/tmp/"); // realpath'd form on macOS is /private/tmp/..., never the raw alias
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/project-repository-classification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// package/relocation/project-repository-classification.ts
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export type RepositoryKind = "standalone-repository" | "nested-repository" | "not-a-repository";

export interface RepositoryToplevelClassification {
  repositoryKind: RepositoryKind;
  gitTopLevel: string | null;
}

/**
 * The one comparison duplicated between scripts/vault-project-relocation.ts
 * and package/relocation/project-relocation-apply.ts before this module
 * existed: does `git rev-parse --show-toplevel` from this exact path equal
 * the path itself? realpath both sides first -- git resolves symlinks in
 * its own output (e.g. macOS /tmp -> /private/tmp), and comparing against
 * a non-realpath'd input would misclassify anything reached through a
 * symlinked ancestor as nested.
 */
export function classifyRepositoryByGitToplevel(path: string): RepositoryToplevelClassification {
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) {
    return { repositoryKind: "not-a-repository", gitTopLevel: null };
  }
  const gitTopLevel = realpathSync(result.stdout.trim());
  const canonicalPath = realpathSync(path);
  return {
    repositoryKind: gitTopLevel === canonicalPath ? "standalone-repository" : "nested-repository",
    gitTopLevel,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-repository-classification.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-repository-classification.ts package/relocation/project-repository-classification.test.ts
git commit -m "feat(relocation): add shared git-toplevel repository classifier"
```

---

### Task 2: Migrate `project-relocation-apply.ts` onto the shared classifier

**Files:**
- Modify: `package/relocation/project-relocation-apply.ts`

**Interfaces:**
- Consumes: `classifyRepositoryByGitToplevel` (Task 1).
- Removes: the local `classifyRepositoryKind()` function and its now-unused `realpathSync` import.

- [ ] **Step 1: Confirm the existing test that must keep passing unchanged**

Read `package/relocation/project-relocation-apply.test.ts`'s existing test
`"holds on a nested (non-standalone) repository and touches nothing"`
(creates a fixture, points `source` at a subdirectory with no `.git` of its
own, expects `holdReasons` to include a string containing
`"not_standalone_repository"`). This test's behavior must not change —
this task is a pure refactor, not a behavior change.

Run: `bun test package/relocation/project-relocation-apply.test.ts`
Expected: PASS (baseline, before this task's edit).

- [ ] **Step 2: Make the change**

In `package/relocation/project-relocation-apply.ts`:

Add the import alongside the existing ones:

```typescript
import { classifyRepositoryByGitToplevel } from "./project-repository-classification";
```

Remove the local `classifyRepositoryKind` function entirely (currently
lines 52-61):

```typescript
function classifyRepositoryKind(path: string): string {
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) return "not-a-repository";
  // git resolves symlinks in its output (e.g. macOS /tmp -> /private/tmp);
  // realpath both sides before comparing, or every fixture under a
  // symlinked temp dir would misclassify as nested.
  const gitToplevel = realpathSync(result.stdout.trim());
  const canonicalPath = realpathSync(path);
  return gitToplevel === canonicalPath ? "standalone-repository" : "nested-repository";
}
```

Remove `realpathSync` from the `node:fs` import list at the top of the
file (it was only used inside the function just removed — confirm no other
use exists in the file before deleting the import).

In `gatherHoldReasons()`, change:

```typescript
const repositoryKind = classifyRepositoryKind(input.source);
```

to:

```typescript
const repositoryKind = classifyRepositoryByGitToplevel(input.source).repositoryKind;
```

- [ ] **Step 3: Run tests to verify they still pass**

Run: `bun test package/relocation/project-relocation-apply.test.ts`
Expected: PASS, same test count as the Step 1 baseline, including the
nested-repository test unchanged.

- [ ] **Step 4: Run the wider relocation suite to catch anything unexpected**

Run: `bun test package/relocation/`
Expected: PASS, no new failures relative to the pre-change baseline.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-relocation-apply.ts
git commit -m "refactor(relocation): migrate apply transaction onto the shared classifier"
```

---

### Task 3: Migrate `scripts/vault-project-relocation.ts` onto the shared classifier

**Files:**
- Modify: `scripts/vault-project-relocation.ts`

**Interfaces:**
- Consumes: `classifyRepositoryByGitToplevel` (Task 1).
- `classifyRepository()`'s exported behavior (return shape, all fields) is
  unchanged — it still returns `gitCommonDir`/`head`/`branch`/`remotes`/
  `statusPorcelainV2Sha256` in addition to `repositoryKind`/`gitTopLevel`;
  only its *internal* toplevel comparison now delegates to the shared
  function instead of reimplementing it with `resolve()`.

- [ ] **Step 1: Note the behavior-sensitive detail before changing anything**

The current implementation uses `resolve()` for its toplevel comparison;
the shared function uses `realpathSync()`. These differ only when a path
is reached through a symlink (e.g. macOS `/tmp` → `/private/tmp`) — on
this machine, real portfolio roots are not symlinked, so no real-vault
inventory output changes. This is a genuine correctness improvement (the
apply-side code already carries an inline comment explaining why
`realpathSync` is required), not a neutral refactor — call this out
explicitly in the commit message.

- [ ] **Step 2: Make the change**

Add the import alongside the existing ones:

```typescript
import { classifyRepositoryByGitToplevel } from "../package/relocation/project-repository-classification";
```

Replace the body of `classifyRepository()` (currently lines 206-233):

```typescript
function classifyRepository(path: string): Pick<InventoryRecord, "repositoryKind" | "gitTopLevel" | "gitCommonDir" | "head" | "branch" | "remotes" | "statusPorcelainV2Sha256"> {
  const gitTopLevel = git(path, ["rev-parse", "--show-toplevel"]);
  if (!gitTopLevel) {
    return {
      repositoryKind: "not-a-repository",
      gitTopLevel: null,
      gitCommonDir: null,
      head: null,
      branch: null,
      remotes: [],
      statusPorcelainV2Sha256: null,
    };
  }
  const canonicalTop = resolve(gitTopLevel);
  const gitCommonDirRaw = git(path, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = gitCommonDirRaw ? resolve(path, gitCommonDirRaw) : null;
  const status = spawnSync("git", ["-C", path, "status", "--porcelain=v2", "--untracked-files=all"], { encoding: "utf8" });
  const statusText = status.status === 0 ? status.stdout : null;
  return {
    repositoryKind: canonicalTop === resolve(path) ? "standalone-repository" : "nested-repository",
    gitTopLevel: canonicalTop,
    gitCommonDir,
    head: git(path, ["rev-parse", "HEAD"]),
    branch: git(path, ["branch", "--show-current"]),
    remotes: gitRemotes(path),
    statusPorcelainV2Sha256: statusText == null ? null : sha256(statusText),
  };
}
```

with:

```typescript
function classifyRepository(path: string): Pick<InventoryRecord, "repositoryKind" | "gitTopLevel" | "gitCommonDir" | "head" | "branch" | "remotes" | "statusPorcelainV2Sha256"> {
  const { repositoryKind, gitTopLevel } = classifyRepositoryByGitToplevel(path);
  if (repositoryKind === "not-a-repository") {
    return {
      repositoryKind,
      gitTopLevel: null,
      gitCommonDir: null,
      head: null,
      branch: null,
      remotes: [],
      statusPorcelainV2Sha256: null,
    };
  }
  const gitCommonDirRaw = git(path, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = gitCommonDirRaw ? resolve(path, gitCommonDirRaw) : null;
  const status = spawnSync("git", ["-C", path, "status", "--porcelain=v2", "--untracked-files=all"], { encoding: "utf8" });
  const statusText = status.status === 0 ? status.stdout : null;
  return {
    repositoryKind,
    gitTopLevel,
    gitCommonDir,
    head: git(path, ["rev-parse", "HEAD"]),
    branch: git(path, ["branch", "--show-current"]),
    remotes: gitRemotes(path),
    statusPorcelainV2Sha256: statusText == null ? null : sha256(statusText),
  };
}
```

- [ ] **Step 3: Run the existing CLI-level tests to verify no behavior change**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: PASS, same results as the pre-change baseline for every existing
test, specifically including `"the already-approved canary appears as an
unheld candidate"` (which depends on `classifyRepository` correctly
returning `"standalone-repository"` for the real canary) and the `plan`
test's `plan.repository.repositoryKind` assertion. The two pre-existing,
already-documented failures (dirty real canary, `inventory` timeout) are
expected and unrelated — confirm no *new* failures beyond those two.

- [ ] **Step 4: Commit**

```bash
git add scripts/vault-project-relocation.ts
git commit -m "refactor(relocation): migrate CLI classifier onto the shared implementation, gaining realpath symlink-safety"
```

---

### Task 4: `project-nested-repo-discovery.ts` — bounded recursive walk

**Files:**
- Create: `package/relocation/project-nested-repo-discovery.ts`
- Create: `package/relocation/project-nested-repo-discovery.test.ts`

**Interfaces:**
- Produces: `discoverNestedGitRoots(startPath: string, maxDepth: number): Array<{ path: string; depth: number }>`. `depth` starts at `1` for a `.git` directory found immediately inside `startPath` — the caller (Task 6) treats `startPath` itself as depth `0` and never re-classifies it here.

- [ ] **Step 1: Write the failing tests**

```typescript
// package/relocation/project-nested-repo-discovery.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { discoverNestedGitRoots } from "./project-nested-repo-discovery";

function initGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  spawnSync("git", ["init", "--quiet", path]);
}

function initGitWorktreeLink(path: string, gitCommonDirTarget: string): void {
  // A real worktree's .git is a FILE containing "gitdir: <path>", never a
  // directory. Fixture doesn't need a real functioning worktree -- only
  // the file-vs-directory distinction this function is scoped to detect.
  mkdirSync(path, { recursive: true });
  require("node:fs").writeFileSync(join(path, ".git"), `gitdir: ${gitCommonDirTarget}\n`);
}

describe("discoverNestedGitRoots", () => {
  test("finds a real .git directory at depth 3 and stops descending into it", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-"));
    const containerA = join(root, "container-a");
    const containerB = join(containerA, "container-b");
    const repoPath = join(containerB, "the-repo");
    mkdirSync(containerB, { recursive: true });
    initGitRepo(repoPath);
    // content inside the found repo that must never be walked into
    mkdirSync(join(repoPath, "nested-would-be-depth-4"));
    initGitRepo(join(repoPath, "nested-would-be-depth-4", "should-never-be-found"));

    const found = discoverNestedGitRoots(root, 5);

    expect(found).toEqual([{ path: repoPath, depth: 3 }]);
    rmSync(root, { recursive: true, force: true });
  });

  test("excludes a .git FILE (worktree pointer) from candidacy and does not descend past it", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-worktree-"));
    const worktreePath = join(root, "some-worktree");
    initGitWorktreeLink(worktreePath, "/fixture/does/not/need/to/be/real");
    mkdirSync(join(worktreePath, "would-be-a-real-repo-if-descended"));
    initGitRepo(join(worktreePath, "would-be-a-real-repo-if-descended", "repo"));

    const found = discoverNestedGitRoots(root, 5);

    expect(found).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test("skips node_modules entirely", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-nodemodules-"));
    const insideNodeModules = join(root, "node_modules", "some-package");
    initGitRepo(insideNodeModules);

    const found = discoverNestedGitRoots(root, 5);

    expect(found).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test("respects maxDepth — a repo one level past the cap is not found", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-depthcap-"));
    const deepRepo = join(root, "a", "b", "c");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    initGitRepo(deepRepo);

    const found = discoverNestedGitRoots(root, 2);

    expect(found).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test("maxDepth 0 finds nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-zero-"));
    initGitRepo(join(root, "direct-child"));

    const found = discoverNestedGitRoots(root, 0);

    expect(found).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test("a plain container folder with no .git is walked through, not treated as a stopping point", () => {
    const root = mkdtempSync(join(tmpdir(), "discover-container-"));
    const repoPath = join(root, "plain-folder-one", "plain-folder-two", "real-repo");
    mkdirSync(join(root, "plain-folder-one", "plain-folder-two"), { recursive: true });
    initGitRepo(repoPath);

    const found = discoverNestedGitRoots(root, 5);

    expect(found).toEqual([{ path: repoPath, depth: 3 }]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/project-nested-repo-discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// package/relocation/project-nested-repo-discovery.ts
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredGitRoot {
  path: string;
  depth: number;
}

/**
 * Bounded, depth-capped scan for independent Git repositories nested below
 * startPath. Never reads file content -- existence and type (directory vs.
 * file) only. Stops descending the instant it finds a repository boundary
 * (a real .git directory) or a worktree pointer (a .git file) -- neither
 * is ever walked into further. Skips node_modules entirely at every level.
 * Bounded to startPath's own subtree; the caller is responsible for only
 * ever passing an already-approved portfolio-root child as startPath.
 */
export function discoverNestedGitRoots(startPath: string, maxDepth: number): DiscoveredGitRoot[] {
  const found: DiscoveredGitRoot[] = [];
  walk(startPath, 1, maxDepth, found);
  return found;
}

function walk(dir: string, depth: number, maxDepth: number, found: DiscoveredGitRoot[]): void {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entryName of entries) {
    if (entryName === "node_modules") continue;
    const entryPath = join(dir, entryName);
    let entryStats;
    try {
      entryStats = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (!entryStats.isDirectory()) continue;

    const gitMarkerPath = join(entryPath, ".git");
    let gitMarkerStats;
    try {
      gitMarkerStats = lstatSync(gitMarkerPath);
    } catch {
      gitMarkerStats = null;
    }

    if (gitMarkerStats?.isDirectory()) {
      found.push({ path: entryPath, depth });
      continue;
    }
    if (gitMarkerStats) {
      // .git exists but isn't a directory -- a worktree admin pointer file.
      // Excluded from candidacy; do not descend past it either.
      continue;
    }
    walk(entryPath, depth + 1, maxDepth, found);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-nested-repo-discovery.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-nested-repo-discovery.ts package/relocation/project-nested-repo-discovery.test.ts
git commit -m "feat(relocation): add bounded recursive nested-git-root discovery"
```

---

### Task 5: `project-candidate-collision.ts` — collision detection

**Files:**
- Create: `package/relocation/project-candidate-collision.ts`
- Create: `package/relocation/project-candidate-collision.test.ts`

**Interfaces:**
- Produces: `findCandidateCollisions(candidates: CandidateIdentity[]): Map<string, string[]>` where `CandidateIdentity = { path: string; repositoryName: string; remotes: string[] }`. The returned `Map` is keyed by `path` (the unique identifier per candidate — `repositoryName` is deliberately *not* unique, since sharing it is exactly the condition being detected) and holds the list of new hold-reason strings for that candidate; candidates with no collision are absent from the map entirely (not present with an empty array).

- [ ] **Step 1: Write the failing tests**

```typescript
// package/relocation/project-candidate-collision.test.ts
import { describe, expect, test } from "bun:test";

import { findCandidateCollisions } from "./project-candidate-collision";

describe("findCandidateCollisions", () => {
  test("two candidates sharing a basename both get held, third distinct one is untouched", () => {
    const result = findCandidateCollisions([
      { path: "/a/team-forge-ts", repositoryName: "team-forge-ts", remotes: [] },
      { path: "/a/Archive/team-forge-ts", repositoryName: "team-forge-ts", remotes: [] },
      { path: "/a/some-other-repo", repositoryName: "some-other-repo", remotes: [] },
    ]);

    expect(result.get("/a/team-forge-ts")).toEqual(["competing_candidate_claim:basename:team-forge-ts"]);
    expect(result.get("/a/Archive/team-forge-ts")).toEqual(["competing_candidate_claim:basename:team-forge-ts"]);
    expect(result.has("/a/some-other-repo")).toBe(false);
  });

  test("two candidates sharing a GitHub remote identity (https form) both get held", () => {
    const result = findCandidateCollisions([
      { path: "/a/team-forge-ts", repositoryName: "team-forge-ts", remotes: ["https://github.com/Sheshiyer/team-forge-ts.git"] },
      { path: "/a/Archive/team-forge-ts", repositoryName: "team-forge-ts", remotes: ["https://github.com/Sheshiyer/team-forge-ts.git"] },
    ]);

    expect(result.get("/a/team-forge-ts")).toContain("competing_candidate_claim:github_identity:sheshiyer/team-forge-ts");
    expect(result.get("/a/Archive/team-forge-ts")).toContain("competing_candidate_claim:github_identity:sheshiyer/team-forge-ts");
  });

  test("ssh-form and https-form remotes for the same repo still normalize to the same identity", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "one", remotes: ["git@github.com:Sheshiyer/some-repo.git"] },
      { path: "/a/two", repositoryName: "two", remotes: ["https://github.com/Sheshiyer/some-repo.git"] },
    ]);

    expect(result.get("/a/one")).toContain("competing_candidate_claim:github_identity:sheshiyer/some-repo");
    expect(result.get("/a/two")).toContain("competing_candidate_claim:github_identity:sheshiyer/some-repo");
  });

  test("no collisions at all returns an empty map", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "one", remotes: ["https://github.com/Sheshiyer/one.git"] },
      { path: "/a/two", repositoryName: "two", remotes: ["https://github.com/Sheshiyer/two.git"] },
    ]);

    expect(result.size).toBe(0);
  });

  test("a candidate with no remotes at all is only checked for basename collisions", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "shared-name", remotes: [] },
      { path: "/a/two", repositoryName: "shared-name", remotes: [] },
    ]);

    expect(result.get("/a/one")).toEqual(["competing_candidate_claim:basename:shared-name"]);
    expect(result.get("/a/two")).toEqual(["competing_candidate_claim:basename:shared-name"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/project-candidate-collision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// package/relocation/project-candidate-collision.ts
export interface CandidateIdentity {
  path: string;
  repositoryName: string;
  remotes: string[];
}

/**
 * Extracts a normalized "owner/repo" identity from a GitHub remote URL in
 * either https or ssh form. Returns null for anything that isn't a
 * recognizable GitHub remote (no attempt to handle other hosts -- nothing
 * in this codebase relocates non-GitHub-hosted repositories today).
 */
function normalizeGithubIdentity(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

/**
 * Groups candidates by repository basename and by normalized GitHub remote
 * identity. Any group with 2+ members means every member of that group is
 * held -- no automatic preference, no default winner (owner decision E4,
 * design doc). Returns a map keyed by candidate path (repositoryName is
 * deliberately not unique -- sharing it is exactly what's being detected)
 * to the new hold-reason strings for that candidate; candidates with no
 * collision are absent from the map.
 */
export function findCandidateCollisions(candidates: CandidateIdentity[]): Map<string, string[]> {
  const holdsByPath = new Map<string, string[]>();
  const addHold = (path: string, reason: string) => {
    const existing = holdsByPath.get(path) ?? [];
    existing.push(reason);
    holdsByPath.set(path, existing);
  };

  const pathsByBasename = new Map<string, string[]>();
  for (const candidate of candidates) {
    const list = pathsByBasename.get(candidate.repositoryName) ?? [];
    list.push(candidate.path);
    pathsByBasename.set(candidate.repositoryName, list);
  }
  for (const [repositoryName, paths] of pathsByBasename) {
    if (paths.length > 1) {
      for (const path of paths) addHold(path, `competing_candidate_claim:basename:${repositoryName}`);
    }
  }

  const pathsByIdentity = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const remote of candidate.remotes) {
      const identity = normalizeGithubIdentity(remote);
      if (!identity) continue;
      const list = pathsByIdentity.get(identity) ?? [];
      if (!list.includes(candidate.path)) list.push(candidate.path);
      pathsByIdentity.set(identity, list);
    }
  }
  for (const [identity, paths] of pathsByIdentity) {
    if (paths.length > 1) {
      for (const path of paths) addHold(path, `competing_candidate_claim:github_identity:${identity}`);
    }
  }

  return holdsByPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-candidate-collision.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-candidate-collision.ts package/relocation/project-candidate-collision.test.ts
git commit -m "feat(relocation): add basename/GitHub-identity candidate collision detection"
```

---

### Task 6: Wire discovery, collision detection, and `--max-depth` into the CLI

**Files:**
- Modify: `scripts/vault-project-relocation.ts`
- Modify: `tests/vault-project-relocation.test.ts`

**Interfaces:**
- Consumes: `discoverNestedGitRoots` (Task 4), `findCandidateCollisions` (Task 5).
- `InventoryRecord` gains `depth: number` and `immediateParentPath: string | null`.
- `parseArgs()` gains an optional `--max-depth <n>` flag, default `0`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/vault-project-relocation.test.ts, inside the existing
// "CLI argument validation — never touches the filesystem" describe block
  test("inventory with a non-numeric --max-depth fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "thoughtseed", "--output", outputPath("x.json"), "--max-depth", "abc"]);
    expect(result.status).not.toBe(0);
  });

  test("inventory with a negative --max-depth fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "thoughtseed", "--output", outputPath("x.json"), "--max-depth", "-1"]);
    expect(result.status).not.toBe(0);
  });
```

```typescript
// append to tests/vault-project-relocation.test.ts, inside the existing
// "CLI inventory — real, read-only run against the actual vault" describe block
  test("omitting --max-depth reproduces today's exact depth-0-only shape", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    for (const record of report.records) {
      expect(record.depth).toBe(0);
      expect(record.immediateParentPath).toBeNull();
    }
  });

  test("--max-depth 0 explicitly is identical in shape to omitting it", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "0"]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    for (const record of report.records) {
      expect(record.depth).toBe(0);
      expect(record.immediateParentPath).toBeNull();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: FAIL — `--max-depth` is an unrecognized argument today
(`unknown_argument:--max-depth`), and `record.depth`/`record.immediateParentPath`
don't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Add the import alongside the existing ones in `scripts/vault-project-relocation.ts`:

```typescript
import { discoverNestedGitRoots } from "../package/relocation/project-nested-repo-discovery";
import { findCandidateCollisions } from "../package/relocation/project-candidate-collision";
```

Extend the `InventoryRecord` interface (add two fields; every other field unchanged):

```typescript
interface InventoryRecord {
  portfolio: Portfolio;
  sourceRoot: string;
  name: string;
  path: string;
  entryType: "directory" | "file" | "symlink" | "other";
  repositoryKind: "standalone-repository" | "nested-repository" | "not-a-repository" | "held";
  gitTopLevel: string | null;
  gitCommonDir: string | null;
  head: string | null;
  branch: string | null;
  remotes: string[];
  statusPorcelainV2Sha256: string | null;
  device: number | null;
  inode: number | null;
  proposedDestination: string;
  grammarAccepted: boolean;
  destinationExists: boolean;
  disposition: "candidate" | "held" | "out-of-scope";
  holdReasons: string[];
  depth: number;
  immediateParentPath: string | null;
}
```

Update `inventoryEntry()`'s return statement to set the two new fields for
every depth-0 record (unchanged behavior — always `0`/`null` at this call
site):

```typescript
  return {
    portfolio,
    sourceRoot,
    name,
    path,
    entryType,
    ...repository,
    device,
    inode,
    proposedDestination,
    grammarAccepted,
    destinationExists: existsSync(proposedDestination),
    disposition,
    holdReasons,
    depth: 0,
    immediateParentPath: null,
  };
```

Add a new function, placed after `inventoryEntry()`, that builds a full
`InventoryRecord` for a path discovered by the recursive walk (reusing
`classifyRepository`, `gitRemotes`, `isCanonicalRepositoryBasename`, and
the same destination-proposal formula as `inventoryEntry` — deliberately
`join(DESTINATION_ROOT, portfolio, name)` using only the basename, not the
full nested relative path, so that two same-named candidates naturally
propose the same destination too):

```typescript
function nestedInventoryEntry(
  portfolio: Portfolio,
  sourceRoot: string,
  found: { path: string; depth: number },
  immediateParentPath: string,
): InventoryRecord {
  const name = basename(found.path);
  const proposedDestination = join(DESTINATION_ROOT, portfolio, name);
  const holdReasons: string[] = [];
  let entryType: InventoryRecord["entryType"] = "other";
  let device: number | null = null;
  let inode: number | null = null;
  try {
    const stats = lstatSync(found.path);
    entryType = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
    device = Number(stats.dev);
    inode = Number(stats.ino);
  } catch (error) {
    holdReasons.push(`lstat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  const repository = classifyRepository(found.path);
  const grammarAccepted = isCanonicalRepositoryBasename(name);
  if (!grammarAccepted) holdReasons.push("basename_not_canonical");
  if (entryType !== "directory") holdReasons.push(`entry_type:${entryType}`);
  if (repository.repositoryKind !== "standalone-repository") holdReasons.push(repository.repositoryKind);
  if (existsSync(proposedDestination)) holdReasons.push("destination_exists");
  const disposition = holdReasons.length === 0 ? "candidate" : "held";
  return {
    portfolio,
    sourceRoot,
    name,
    path: found.path,
    entryType,
    ...repository,
    device,
    inode,
    proposedDestination,
    grammarAccepted,
    destinationExists: existsSync(proposedDestination),
    disposition,
    holdReasons,
    depth: found.depth,
    immediateParentPath,
  };
}
```

Note: `nestedInventoryEntry` deliberately does **not** apply
`ALWAYS_HELD_THOUGHTSEED_NAMES` or the `tn_registry_baseline_unresolved`
hold — those are owner-mapping/registry-readiness concerns tied to the
*direct-child* candidate list's specific named entries, not something that
generalizes correctly to an arbitrary deep path. This is intentional
scope: deep candidates get exactly the checks that are actually meaningful
for them (grammar, repository kind, destination collision), not a blind
copy of every depth-0 rule.

Update `buildReport()` to run discovery for non-standalone depth-0
directory entries, then run collision detection across the full combined
list, before computing counts:

```typescript
function buildReport(portfolios: Portfolio[], maxDepth: number): InventoryReport {
  const records: InventoryRecord[] = [];
  const roots = {} as InventoryReport["roots"];
  for (const portfolio of portfolios) {
    const sourceRoot = PORTFOLIO_ROOTS[portfolio];
    const present = existsSync(sourceRoot) && lstatSync(sourceRoot).isDirectory();
    const names = present ? readdirSync(sourceRoot).sort() : [];
    roots[portfolio] = { path: sourceRoot, present, immediateChildCount: names.length };
    for (const name of names) {
      const entry = inventoryEntry(portfolio, sourceRoot, name);
      records.push(entry);
      if (maxDepth > 0 && entry.entryType === "directory" && entry.repositoryKind !== "standalone-repository") {
        const found = discoverNestedGitRoots(entry.path, maxDepth);
        for (const nested of found) {
          records.push(nestedInventoryEntry(portfolio, sourceRoot, nested, entry.path));
        }
      }
    }
  }

  // Collision detection is scoped to standalone-repository records only —
  // a genuine collision is between two things that could actually be
  // relocated as competing candidates for the same destination. A plain
  // non-git folder or a still-nested (non-standalone) entry already fails
  // on its own hold reason regardless of naming; it isn't a relocation
  // candidate at all, so it doesn't need collision protection on top.
  const collisions = findCandidateCollisions(
    records
      .filter((record) => record.repositoryKind === "standalone-repository")
      .map((record) => ({ path: record.path, repositoryName: record.name, remotes: record.remotes })),
  );
  for (const record of records) {
    const newHolds = collisions.get(record.path);
    if (newHolds) {
      record.holdReasons.push(...newHolds);
      record.disposition = "held";
    }
  }

  const counts: Record<string, number> = { total: records.length };
  for (const record of records) {
    counts[record.disposition] = (counts[record.disposition] ?? 0) + 1;
    counts[record.repositoryKind] = (counts[record.repositoryKind] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    destinationRoot: DESTINATION_ROOT,
    approvedPortfolios: portfolios,
    roots,
    records,
    counts,
  };
}
```

Update `parseArgs()` to accept `--max-depth`:

```typescript
function parseArgs(argv: string[]): { portfolios: Portfolio[]; output: string; maxDepth: number } {
  if (argv[0] !== "inventory") usage();
  const portfolios: Portfolio[] = [];
  let output = "";
  let maxDepth = 0;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--portfolio") {
      const value = argv[++i];
      if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
        throw new Error(`portfolio_not_allowed:${value ?? ""}`);
      }
      if (!portfolios.includes(value)) portfolios.push(value);
    } else if (arg === "--output") {
      output = argv[++i] ?? "";
    } else if (arg === "--max-depth") {
      const value = argv[++i] ?? "";
      if (!/^\d+$/.test(value)) throw new Error(`max_depth_must_be_a_non_negative_integer:${value}`);
      maxDepth = Number(value);
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  if (portfolios.length === 0 || !output || !isAbsolute(output)) {
    throw new Error("two_portfolios_and_absolute_output_required");
  }
  return { portfolios, output: resolve(output), maxDepth };
}
```

Update the `inventory` dispatch branch and the `usage()` text:

```typescript
  } else if (argv[0] === "inventory") {
    const { portfolios, output, maxDepth } = parseArgs(argv);
    const report = buildReport(portfolios, maxDepth);
    writeOwnerOnly(output, report);
    console.log(JSON.stringify({ output, readOnly: true, counts: report.counts }));
```

```
  bun scripts/vault-project-relocation.ts inventory \
    --portfolio thoughtseed \
    --portfolio tryambakam-noesis \
    --output <owner-only-report.json> \
    [--max-depth <n>]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: PASS, including all new tests and every pre-existing test
(modulo the two already-documented, pre-existing live-vault failures).

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-project-relocation.ts tests/vault-project-relocation.test.ts
git commit -m "feat(relocation): wire nested-repo discovery and collision detection into inventory"
```

---

### Task 7: Prove it against the real vault, wire into `verify-all.sh`, update docs

**Files:**
- Modify: `tests/vault-project-relocation.test.ts`
- Modify: `scripts/verify-all.sh`
- Modify: `docs/vault-project-relocation.md`

**Interfaces:**
- Consumes: nothing new — this task is real-data verification, integration, and documentation.

- [ ] **Step 1: Write the real, read-only proof tests**

These are read-only (`inventory` never mutates anything beyond writing the
caller-specified owner-only report file) and directly prove the design
doc's central claim (§1.2) against real data — the closest equivalent to
piece A/C's "prove it works for real" final step, and directly serves the
"prove on one canary" scope decision (design doc §2, E1). Append to the
existing `"CLI inventory — real, read-only run against the actual vault"`
describe block:

```typescript
  test("--max-depth 5 discovers the real hermes-aws-ts candidate nested inside thoughtseed-labs", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "5"]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    const hermes = report.records.find(
      (record: { name: string; path: string }) =>
        record.name === "hermes-aws-ts" && record.path.endsWith("thoughtseed-labs/hermes-aws-ts"),
    );
    expect(hermes).toBeDefined();
    expect(hermes.depth).toBeGreaterThan(0);
    expect(hermes.repositoryKind).toBe("standalone-repository");
  });

  test("--max-depth 5 flags the real Archive/team-forge-ts collision against the real team-forge-ts", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "5"]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    const teamForgeCandidates = report.records.filter((record: { name: string }) => record.name === "team-forge-ts");
    expect(teamForgeCandidates.length).toBeGreaterThanOrEqual(2);
    for (const candidate of teamForgeCandidates) {
      expect(candidate.holdReasons.some((reason: string) => reason.startsWith("competing_candidate_claim:"))).toBe(true);
      expect(candidate.disposition).toBe("held");
    }
  });
```

- [ ] **Step 2: Run to verify they pass against the real vault**

Run: `bun test tests/vault-project-relocation.test.ts -t "hermes-aws-ts|team-forge-ts collision"`
Expected: PASS. If either fails, treat it as a real finding to investigate
(real vault state may have changed since the design doc's 2026-08-05
reconnaissance — e.g. `Archive/team-forge-ts` could have been cleaned up
since) — do not weaken the assertions to make them pass.

- [ ] **Step 3: Wire the new test files into `verify-all.sh`**

Add these lines alongside the existing `package/relocation` lines:

```bash
run bun test package/relocation/project-repository-classification.test.ts
run bun test package/relocation/project-nested-repo-discovery.test.ts
run bun test package/relocation/project-candidate-collision.test.ts
```

- [ ] **Step 4: Document `--max-depth` in `docs/vault-project-relocation.md`**

Add to the existing "## Inventory" section, after the existing description
of `disposition`/`holdReasons`:

```markdown
`--max-depth <n>` (default `0`, i.e. today's depth-0-only behavior) opts
into a bounded recursive scan for independently-versioned Git repositories
nested below each direct child that isn't already a standalone candidate —
e.g. `hermes-aws-ts` inside `thoughtseed-labs`, or the many repositories
found clustered inside non-git "container" folders like `klear-karma` and
`Tirak`. The scan never leaves the two approved portfolio roots, never
reads file content, and treats a Git worktree (`.git` file, not directory)
as excluded, never as something to descend into further. Deep candidates
carry `depth` and `immediateParentPath` for provenance and get exactly the
checks that generalize to an arbitrary nested path (grammar, repository
kind, destination collision) — not the depth-0-specific named-entry holds.

A new cross-candidate collision pass runs whenever `inventory` builds its
report (depth-0 candidates included): any two candidates sharing a
repository basename or a normalized GitHub remote identity are both held
with `competing_candidate_claim:...`, no automatic preference. This is
additive to, not a replacement for, the existing cross-portfolio registry
check — this one catches duplicates within a single inventory run, before
anything is ever registered. Full design:
[`docs/superpowers/specs/2026-08-05-vault-nested-repo-discovery-design.md`](superpowers/specs/2026-08-05-vault-nested-repo-discovery-design.md).
```

- [ ] **Step 5: Run the full scoped suite one more time and commit**

Run: `bun test package/relocation/ && bun test tests/vault-project-relocation.test.ts`
Expected: PASS across every relocation file including this plan's 6
new/modified files, modulo the two already-documented pre-existing
live-vault failures.

```bash
git add tests/vault-project-relocation.test.ts scripts/verify-all.sh docs/vault-project-relocation.md
git commit -m "docs(relocation): wire nested-repo discovery into verify-all.sh, prove it against the real vault, document --max-depth"
```

---

## Self-Review

**Spec coverage:** Design §1.3 (classifier duplication) → Tasks 1-3. §6
(discovery algorithm, including the `.git`-file worktree exclusion and
`node_modules` skip) → Task 4. §7 (collision detection, including the
`Archive/team-forge-ts` real example) → Task 5. §5 (data model:
`depth`/`immediateParentPath`) → Task 6. §9 (CLI surface, `--max-depth`
default `0`) → Task 6. §10 (testing) → Tasks 1, 4, 5 (fixture-only unit
tests) and Task 7 (the two real, read-only proof tests). §11
(relationship to the already-built system — apply-side code untouched) →
confirmed by Task 2 only removing/redirecting the classifier call, never
touching `performGuardedRename`/registry/capsule.

**Placeholder scan:** none found — every claim about existing file
contents (current `classifyRepository`/`classifyRepositoryKind`
implementations, `InventoryRecord`'s current fields, `tests/vault-project-relocation.test.ts`'s
existing test structure and `runCli()` helper) was read directly from the
real files before being written into this plan, not assumed.

**Type consistency:** `RepositoryToplevelClassification`,
`DiscoveredGitRoot`, `CandidateIdentity` are each defined once (Tasks 1, 4,
5 respectively) and referenced identically wherever consumed (Task 6's
`nestedInventoryEntry` and `buildReport`). `InventoryRecord`'s two new
fields (`depth`, `immediateParentPath`) are set consistently in both
`inventoryEntry` (always `0`/`null`) and `nestedInventoryEntry` (the real
walk-reported values) — no task leaves either path producing a record
missing these fields. Function names match exactly between "Produces" and
"Consumes" blocks across tasks: `classifyRepositoryByGitToplevel`,
`discoverNestedGitRoots`, `findCandidateCollisions` — no renames.

**Scope check:** every task after Task 3 depends on the one before it —
correctly reflected in the plan's header note that this is a purely
sequential plan, unlike the session-map plan's parallel-dispatch-eligible
Tasks 2-6.
