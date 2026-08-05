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
