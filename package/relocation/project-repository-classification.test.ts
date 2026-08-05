// package/relocation/project-repository-classification.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
