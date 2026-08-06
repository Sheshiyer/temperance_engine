import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "draft-packets-fixture-"));

  const vaultRoot = join(fixtureRoot, "thoughtseed");
  mkdirSync(join(vaultRoot, "example-app"), { recursive: true });
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: join(vaultRoot, "example-app") });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example-owner/example-app.git"], {
    cwd: join(vaultRoot, "example-app"),
  });
  writeFileSync(
    join(vaultRoot, "example-app", "package.json"),
    JSON.stringify({ name: "example-app", scripts: { build: "next build" } }),
  );

  mkdirSync(join(vaultRoot, "no-evidence-repo"), { recursive: true });
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: join(vaultRoot, "no-evidence-repo") });

  const registryDir = join(fixtureRoot, "thoughtseed-labs", "00-meta");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, "work-object-registry.v1.json"),
    JSON.stringify({
      workObjects: [
        {
          workId: "sapling:example",
          name: "Example App",
          kind: "sapling",
          sourceRefs: ["repo:example-app", "vault:10-brand-essence/example-overview.md"],
        },
        {
          workId: "program:no-evidence",
          name: "No Evidence Program",
          kind: "program",
          programKind: "capability",
          sourceRefs: ["repo:no-evidence-repo"],
        },
      ],
      sourceInventory: [
        { path: `${vaultRoot}/example-app`, workRefs: ["sapling:example"] },
        { path: `${vaultRoot}/no-evidence-repo`, workRefs: ["program:no-evidence"] },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("draft-packets CLI subcommand", () => {
  test("writes all six packet files into each candidate and a review summary", () => {
    const outputPath = join(fixtureRoot, "review-summary.md");
    execFileSync(
      "bun",
      [
        join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
        "draft-packets",
        "--vault-root",
        join(fixtureRoot, "thoughtseed"),
        "--portfolio",
        "thoughtseed",
        "--registry-path",
        join(fixtureRoot, "thoughtseed-labs", "00-meta", "work-object-registry.v1.json"),
        "--candidate",
        "example-app",
        "--candidate",
        "no-evidence-repo",
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );

    const exampleProjectMd = readFileSync(
      join(fixtureRoot, "thoughtseed", "example-app", "PROJECT.md"),
      "utf8",
    );
    expect(exampleProjectMd).toContain("Example App");
    expect(existsSync(join(fixtureRoot, "thoughtseed", "example-app", ".project", "project.yaml"))).toBe(true);
    expect(existsSync(join(fixtureRoot, "thoughtseed", "no-evidence-repo", ".project", "HANDOFF.md"))).toBe(true);

    const summary = readFileSync(outputPath, "utf8");
    expect(summary).toContain("example-app");
    expect(summary).toContain("no-evidence-repo");
    expect(summary).toContain("commands.verify");
  });

  test("a candidate that fails evidence-gathering is reported and doesn't block the others", () => {
    const outputPath = join(fixtureRoot, "review-summary-2.md");
    execFileSync(
      "bun",
      [
        join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
        "draft-packets",
        "--vault-root",
        join(fixtureRoot, "thoughtseed"),
        "--portfolio",
        "thoughtseed",
        "--registry-path",
        join(fixtureRoot, "thoughtseed-labs", "00-meta", "work-object-registry.v1.json"),
        "--candidate",
        "example-app",
        "--candidate",
        "unmatched-folder",
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );

    expect(existsSync(join(fixtureRoot, "thoughtseed", "example-app", "PROJECT.md"))).toBe(true);
    const summary = readFileSync(outputPath, "utf8");
    expect(summary).toContain("FAILED: unmatched-folder");
    expect(summary).toContain("no sourceInventory match");
  });
});
