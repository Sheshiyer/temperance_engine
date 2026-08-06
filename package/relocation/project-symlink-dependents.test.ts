import { describe, expect, test } from "bun:test";

import { symlinkDependentsOf } from "./project-symlink-dependents";

const REPO = "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/Skill-clusters";

describe("symlinkDependentsOf", () => {
  test("finds a link pointing AT the repository root", () => {
    const found = symlinkDependentsOf(REPO, [
      { link: "/Users/x/.agents/skill-clusters", target: REPO },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].link).toBe("/Users/x/.agents/skill-clusters");
  });

  test("finds links pointing INSIDE the repository", () => {
    const found = symlinkDependentsOf(REPO, [
      { link: "/Users/x/.agents/skills/rust-core", target: `${REPO}/skills/rust-core` },
      { link: "/Users/x/.agents/skills/rust-orchestrator", target: `${REPO}/skills/rust-orchestrator` },
    ]);
    expect(found).toHaveLength(2);
  });

  test("PREFIX SAFETY: a sibling sharing a string prefix is not a dependent", () => {
    // `Skill-clusters.worktrees` starts with the repo path as a string but is a
    // different directory. A startsWith() check would wrongly hold the move.
    const found = symlinkDependentsOf(REPO, [
      { link: "/Users/x/a", target: `${REPO}.worktrees/wt-1` },
      { link: "/Users/x/b", target: `${REPO}-archive/skills/foo` },
    ]);
    expect(found).toEqual([]);
  });

  test("ignores links pointing elsewhere entirely", () => {
    const found = symlinkDependentsOf(REPO, [
      { link: "/Users/x/.local/bin/temperance-route", target: "/some/other/repo/router.sh" },
    ]);
    expect(found).toEqual([]);
  });

  test("resolves relative and trailing-slash forms before comparing", () => {
    const found = symlinkDependentsOf(`${REPO}/`, [
      { link: "/Users/x/p", target: `${REPO}/skills/../skills/rust-core` },
    ]);
    expect(found).toHaveLength(1);
  });

  test("a link whose target IS a parent of the repo is not a dependent", () => {
    // Pointing at the containing folder does not break when the child moves.
    const found = symlinkDependentsOf(REPO, [
      { link: "/Users/x/p", target: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed" },
    ]);
    expect(found).toEqual([]);
  });

  test("returns an empty list rather than throwing on no candidates", () => {
    expect(symlinkDependentsOf(REPO, [])).toEqual([]);
  });
});
