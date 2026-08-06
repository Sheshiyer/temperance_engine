// tests/vault-project-relocation-new-project.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixtureRoot: string;
let vaultRoot: string;
let registryPath: string;
let workflowRegistryPath: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "new-project-fixture-"));
  vaultRoot = join(fixtureRoot, "thoughtseed");
  mkdirSync(vaultRoot, { recursive: true });

  registryPath = join(fixtureRoot, "work-object-registry.v1.json");
  writeFileSync(registryPath, JSON.stringify({ workObjects: [], sourceInventory: [] }));

  workflowRegistryPath = join(fixtureRoot, "workflows-registry.json");
  writeFileSync(
    workflowRegistryPath,
    JSON.stringify({
      workflows: [
        {
          id: "website-delivery",
          title: "Website delivery factory",
          summary: "s",
          doc: "d",
          plan_template: "p",
          triggers: {},
          stages: [
            { id: "0-discover", label: "Discovery", search_query: "q", skills: [] },
            { id: "1-brand", label: "Brand", search_query: "q", skills: [] },
          ],
        },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function runNewProject(args: string[]): { stdout: string } {
  const stdout = execFileSync(
    "bun",
    [
      join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
      "new-project",
      "--vault-root",
      vaultRoot,
      "--portfolio",
      "thoughtseed",
      "--registry-path",
      registryPath,
      ...args,
    ],
    { encoding: "utf8" },
  );
  return { stdout };
}

describe("new-project CLI subcommand", () => {
  test("matched type: scaffolds the packet, git init, stage folders, WORKFLOW.md, and a registry entry", () => {
    runNewProject([
      "--name",
      "client-x",
      "--kind",
      "sapling",
      "--type",
      "website-delivery",
      "--workflow-registry-path",
      workflowRegistryPath,
      "--output",
      join(fixtureRoot, "receipt.json"),
    ]);

    const target = join(vaultRoot, "client-x");
    for (const file of ["PROJECT.md", "AGENTS.md", "CLAUDE.md", ".project/CONTEXT.md", ".project/project.yaml", ".project/HANDOFF.md"]) {
      expect(existsSync(join(target, file))).toBe(true);
    }
    expect(existsSync(join(target, ".git"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(true);
    expect(existsSync(join(target, "0-discover"))).toBe(true);
    expect(existsSync(join(target, "1-brand"))).toBe(true);

    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.workObjects).toHaveLength(1);
    expect(registry.workObjects[0].workId).toBe("sapling:client-x");
    expect(registry.sourceInventory[0].path).toBe(target);

    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.target).toBe(target);
    expect(receipt.workId).toBe("sapling:client-x");
    expect(receipt.stages).toEqual(["0-discover", "1-brand"]);
  });

  test("unmatched type: scaffolds fixed-folder-only, no error, no WORKFLOW.md, no stage folders", () => {
    runNewProject([
      "--name",
      "client-y",
      "--kind",
      "program",
      "--type",
      "app-delivery",
      "--workflow-registry-path",
      workflowRegistryPath,
      "--output",
      join(fixtureRoot, "receipt.json"),
    ]);

    const target = join(vaultRoot, "client-y");
    expect(existsSync(join(target, "PROJECT.md"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(false);

    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.stages).toEqual([]);
  });

  test("no --type at all: scaffolds fixed-folder-only, no error", () => {
    runNewProject(["--name", "client-z", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]);
    const target = join(vaultRoot, "client-z");
    expect(existsSync(join(target, "PROJECT.md"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(false);
  });

  test("--dry-run writes nothing to disk", () => {
    runNewProject([
      "--name",
      "client-dry",
      "--kind",
      "sapling",
      "--output",
      join(fixtureRoot, "receipt.json"),
      "--dry-run",
    ]);
    expect(existsSync(join(vaultRoot, "client-dry"))).toBe(false);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.workObjects).toHaveLength(0);
    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.dryRun).toBe(true);
    expect(receipt.target).toBe(join(vaultRoot, "client-dry"));
  });

  test("fails with no write when the target folder already exists", () => {
    mkdirSync(join(vaultRoot, "client-taken"), { recursive: true });
    expect(() =>
      runNewProject(["--name", "client-taken", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]),
    ).toThrow();
    expect(existsSync(join(fixtureRoot, "receipt.json"))).toBe(false);
  });

  test("fails when workId already exists in the registry, leaving the folder scaffold in place", () => {
    writeFileSync(
      registryPath,
      JSON.stringify({
        workObjects: [{ workId: "sapling:client-dup", name: "Dup", kind: "sapling", sourceRefs: ["repo:client-dup"] }],
        sourceInventory: [{ path: "/somewhere/else/client-dup", workRefs: ["sapling:client-dup"] }],
      }),
    );
    expect(() =>
      runNewProject(["--name", "client-dup", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]),
    ).toThrow();
    expect(existsSync(join(vaultRoot, "client-dup", "PROJECT.md"))).toBe(true);
  });
});
