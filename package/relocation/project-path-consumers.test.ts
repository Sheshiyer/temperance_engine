import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { auditPathConsumers, classifyConsumerPath, findPatternMatches } from "./project-path-consumers";

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function writeTrackedFile(repoRoot: string, relativePath: string, content: string): void {
  const absolute = join(repoRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function initFixtureRepo(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "path-consumers-fixture-"));
  git(repoRoot, ["init", "--quiet"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  git(repoRoot, ["config", "user.name", "Fixture"]);
  for (const [relativePath, content] of Object.entries(files)) {
    writeTrackedFile(repoRoot, relativePath, content);
  }
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--quiet", "-m", "fixture commit"]);
  return repoRoot;
}

describe("classifyConsumerPath", () => {
  test("classifies a linked-worktree gitdir pointer file", () => {
    expect(classifyConsumerPath(".git/worktrees/feature-x/gitdir")).toBe(
      "git-worktree-administration",
    );
  });

  test("classifies .gitmodules as a submodule consumer", () => {
    expect(classifyConsumerPath(".gitmodules")).toBe("submodule");
  });

  test("classifies a Git hook under .git/hooks", () => {
    expect(classifyConsumerPath(".git/hooks/pre-commit")).toBe("hook");
  });

  test("classifies a PAI-style *.hook.ts file as a hook", () => {
    expect(classifyConsumerPath("hooks/SessionStart.hook.ts")).toBe("hook");
  });

  test("classifies .mcp.json as MCP/client project config", () => {
    expect(classifyConsumerPath(".mcp.json")).toBe("mcp-client-project-config");
  });

  test("classifies a client launch.json under a dotted client directory as MCP/client project config", () => {
    expect(classifyConsumerPath(".claude/launch.json")).toBe("mcp-client-project-config");
  });

  test("classifies a launchd plist as launchd-or-systemd", () => {
    expect(classifyConsumerPath("Library/LaunchAgents/com.example.foo.plist")).toBe(
      "launchd-or-systemd",
    );
  });

  test("classifies a systemd unit as launchd-or-systemd", () => {
    expect(classifyConsumerPath("etc/systemd/system/foo.service")).toBe("launchd-or-systemd");
  });

  test("classifies a GitHub Actions workflow as a deploy script", () => {
    expect(classifyConsumerPath(".github/workflows/deploy.yml")).toBe("deploy-script");
  });

  test("classifies a deploy-prefixed script as a deploy script", () => {
    expect(classifyConsumerPath("scripts/deploy-prod.sh")).toBe("deploy-script");
  });

  test("classifies a sync-named script as a sync job", () => {
    expect(classifyConsumerPath("scripts/sync-vault.sh")).toBe("sync-job");
  });

  test("classifies markdown as documentation", () => {
    expect(classifyConsumerPath("README.md")).toBe("documentation");
    expect(classifyConsumerPath("docs/architecture.md")).toBe("documentation");
  });

  test("classifies an ordinary tracked file as repository-config-or-script by default", () => {
    expect(classifyConsumerPath("package.json")).toBe("repository-config-or-script");
    expect(classifyConsumerPath("scripts/build.sh")).toBe("repository-config-or-script");
  });

  test("classifies an empty path as repository-config-or-script without throwing", () => {
    expect(classifyConsumerPath("")).toBe("repository-config-or-script");
  });
});

describe("findPatternMatches", () => {
  test("returns no matches for text containing none of the patterns", () => {
    expect(findPatternMatches("nothing to see here\nor here", ["/old/path"])).toEqual([]);
  });

  test("finds a single-line, single-pattern match with a 1-indexed line number", () => {
    expect(findPatternMatches("uses /old/path for config", ["/old/path"])).toEqual([
      { line: 1, matchedPattern: "/old/path" },
    ]);
  });

  test("reports the correct line number for a match on a later line", () => {
    const text = ["line one", "line two", "references /old/path here"].join("\n");
    expect(findPatternMatches(text, ["/old/path"])).toEqual([
      { line: 3, matchedPattern: "/old/path" },
    ]);
  });

  test("finds matches for multiple distinct patterns", () => {
    const text = ["canonical: /old/path", "alias: /old/path-alias"].join("\n");
    expect(findPatternMatches(text, ["/old/path", "/old/path-alias"])).toEqual([
      { line: 1, matchedPattern: "/old/path" },
      { line: 2, matchedPattern: "/old/path" },
      { line: 2, matchedPattern: "/old/path-alias" },
    ]);
  });

  test("returns one match entry per pattern when two patterns both occur on the same line", () => {
    const text = "both /old/path and /old/path-alias appear here";
    expect(findPatternMatches(text, ["/old/path", "/old/path-alias"])).toEqual([
      { line: 1, matchedPattern: "/old/path" },
      { line: 1, matchedPattern: "/old/path-alias" },
    ]);
  });

  test("returns no matches for empty patterns without throwing", () => {
    expect(findPatternMatches("anything at all", [])).toEqual([]);
  });

  test("returns no matches for empty text without throwing", () => {
    expect(findPatternMatches("", ["/old/path"])).toEqual([]);
  });
});

describe("auditPathConsumers — bounded checked-in-text scan", () => {
  test("finds a match in the candidate repository's own tracked file and keeps its file-role category", () => {
    const candidate = initFixtureRepo({
      "README.md": "points at /old/path in prose",
    });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches).toEqual([
      {
        root: candidate,
        file: join(candidate, "README.md"),
        line: 1,
        matchedPattern: "/old/path",
        category: "documentation",
      },
    ]);
  });

  test("finds a match in a sibling repository's tracked file and reclassifies it cross-repository-reference", () => {
    const candidate = initFixtureRepo({ "README.md": "no reference here" });
    const sibling = initFixtureRepo({
      "README.md": "this other project also uses /old/path internally",
    });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate, sibling],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches).toEqual([
      {
        root: sibling,
        file: join(sibling, "README.md"),
        line: 1,
        matchedPattern: "/old/path",
        category: "cross-repository-reference",
      },
    ]);
  });

  test("keeps a specific file-role category even when the match is in a sibling repository", () => {
    const candidate = initFixtureRepo({ "README.md": "no reference here" });
    const sibling = initFixtureRepo({
      "scripts/deploy-prod.sh": "#!/bin/sh\ncd /old/path && ./release.sh",
    });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate, sibling],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches).toEqual([
      {
        root: sibling,
        file: join(sibling, "scripts/deploy-prod.sh"),
        line: 2,
        matchedPattern: "/old/path",
        category: "deploy-script",
      },
    ]);
  });

  test("does not find a match in an untracked file — checked-in text only", () => {
    const candidate = initFixtureRepo({ "README.md": "clean" });
    writeTrackedFile(candidate, "scratch.md", "untracked reference to /old/path");
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches).toEqual([]);
  });

  test("matches an approved alias in addition to the canonical path", () => {
    const candidate = initFixtureRepo({ "README.md": "legacy alias /old/alias-path lives here" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      approvedAliases: ["/old/alias-path"],
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches).toEqual([
      {
        root: candidate,
        file: join(candidate, "README.md"),
        line: 1,
        matchedPattern: "/old/alias-path",
        category: "documentation",
      },
    ]);
  });
});

describe("auditPathConsumers — Git worktree administration", () => {
  test("detects a linked worktree's .git file referencing the candidate's own repository path", () => {
    const candidate = initFixtureRepo({ "README.md": "root" });
    const worktreeParent = mkdtempSync(join(tmpdir(), "path-consumers-worktree-parent-"));
    const worktreePath = join(worktreeParent, "wt");
    git(candidate, ["worktree", "add", "-b", "wt-branch", worktreePath]);
    // git canonicalizes worktree paths (realpath) when recording them in its
    // own admin files, so the expected path must go through the same
    // resolution rather than assume mkdtemp's raw (possibly symlinked) path.
    const realWorktreePath = realpathSync(worktreePath);

    const report = auditPathConsumers({
      canonicalPath: candidate,
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });

    expect(report.matches).toEqual([
      {
        root: candidate,
        file: join(realWorktreePath, ".git"),
        line: 1,
        matchedPattern: candidate,
        category: "git-worktree-administration",
      },
    ]);
  });

  test("finds no worktree-administration matches when the candidate has no linked worktrees", () => {
    const candidate = initFixtureRepo({ "README.md": "root" });
    const report = auditPathConsumers({
      canonicalPath: candidate,
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches.filter((m) => m.category === "git-worktree-administration")).toEqual([]);
  });
});

describe("auditPathConsumers — explicit host-config-surface file list", () => {
  test("reads an explicitly listed host-config file and matches its content", () => {
    const surfaceDir = mkdtempSync(join(tmpdir(), "path-consumers-host-surface-"));
    const plistPath = join(surfaceDir, "com.example.foo.plist");
    writeFileSync(plistPath, "<key>WorkingDirectory</key>\n<string>/old/path</string>\n");
    const candidate = initFixtureRepo({ "README.md": "clean" });

    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
      hostConfigSurfaces: [plistPath],
    });

    expect(report.matches).toEqual([
      {
        root: "host-config-surface",
        file: plistPath,
        line: 2,
        matchedPattern: "/old/path",
        category: "launchd-or-systemd",
      },
    ]);
  });

  test("silently skips a host-config-surface path that does not exist", () => {
    const candidate = initFixtureRepo({ "README.md": "clean" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
      hostConfigSurfaces: ["/definitely/does/not/exist/mcp.json"],
    });
    expect(report.matches).toEqual([]);
  });

  test("silently skips a host-config-surface path that is a directory rather than a file", () => {
    const surfaceDir = mkdtempSync(join(tmpdir(), "path-consumers-host-surface-dir-"));
    const candidate = initFixtureRepo({ "README.md": "clean" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
      hostConfigSurfaces: [surfaceDir],
    });
    expect(report.matches).toEqual([]);
  });

  test("never inspects anything outside repositorySearchRoots and hostConfigSurfaces", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "path-consumers-untouched-"));
    writeFileSync(join(outsideDir, "secret.env"), "TOKEN=/old/path");
    const candidate = initFixtureRepo({ "README.md": "clean" });

    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });

    expect(report.matches).toEqual([]);
  });
});

describe("auditPathConsumers — unresolvedConsumers and report serialization", () => {
  test("every match is unresolved — there is no approved-cutover-rule concept yet", () => {
    const candidate = initFixtureRepo({ "README.md": "references /old/path here" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.unresolvedConsumers).toEqual(report.matches);
  });

  test("unresolvedConsumers is empty when there are no matches", () => {
    const candidate = initFixtureRepo({ "README.md": "clean" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
    });
    expect(report.unresolvedConsumers).toEqual([]);
  });

  test("serializes the full bounded search inputs alongside results, deterministically", () => {
    const candidate = initFixtureRepo({ "README.md": "clean" });
    const report = auditPathConsumers({
      canonicalPath: "/old/path",
      approvedAliases: ["/old/alias"],
      repositorySearchRoots: [candidate],
      candidateRepositoryRoot: candidate,
      hostConfigSurfaces: ["/does/not/exist.plist"],
    });

    expect(report.canonicalPath).toBe("/old/path");
    expect(report.approvedAliases).toEqual(["/old/alias"]);
    expect(report.repositorySearchRoots).toEqual([candidate]);
    expect(report.candidateRepositoryRoot).toBe(candidate);
    expect(report.hostConfigSurfaces).toEqual(["/does/not/exist.plist"]);
    expect(report.patterns).toEqual(["/old/path", "/old/alias"]);

    expect(JSON.stringify(report)).toBe(JSON.stringify(report));
  });
});
