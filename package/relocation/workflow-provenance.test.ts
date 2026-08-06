import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveWorkflowProvenance, renderWorkflowProvenanceMd } from "./workflow-provenance";

const FIXTURE_REGISTRY = {
  version: 2,
  workflows: [
    {
      id: "website-delivery",
      title: "Website delivery factory",
      summary: "Brand lock -> composition -> motion/assets -> frontend -> ship.",
      doc: "~/.agents/skill-clusters/docs/website-delivery-workflow.html",
      plan_template: "~/.agents/skill-clusters/workflows/templates/website-delivery.PLAN.md",
      triggers: { prompt_any: ["website"] },
      stages: [
        { id: "0-discover", label: "Discovery / brief", search_query: "q", skills: ["swarm-architect"] },
        { id: "1-brand", label: "Brand & design cortex", search_query: "q", skills: ["design-orchestrator"] },
      ],
    },
  ],
};

describe("resolveWorkflowProvenance", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "workflow-provenance-fixture-"));
    registryPath = join(dir, "registry.json");
    writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a matched type returns its stage ids in order and a sha256 digest", () => {
    const result = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(result).not.toBeNull();
    expect(result?.workflowId).toBe("website-delivery");
    expect(result?.stages).toEqual(["0-discover", "1-brand"]);
    expect(result?.workflowDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an unmatched type returns null, not an error", () => {
    const result = resolveWorkflowProvenance("app-delivery", registryPath);
    expect(result).toBeNull();
  });

  test("a missing registry file returns null, not an error", () => {
    const result = resolveWorkflowProvenance("website-delivery", join(dir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  test("the digest is stable across repeated calls against unchanged input", () => {
    const first = resolveWorkflowProvenance("website-delivery", registryPath);
    const second = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(first?.workflowDigest).toBe(second?.workflowDigest);
  });

  test("the digest changes when the consumed workflow entry changes", () => {
    const before = resolveWorkflowProvenance("website-delivery", registryPath);
    const changed = {
      ...FIXTURE_REGISTRY,
      workflows: [
        {
          ...FIXTURE_REGISTRY.workflows[0],
          stages: [
            ...FIXTURE_REGISTRY.workflows[0].stages,
            { id: "2-composition", label: "Composition path", search_query: "q", skills: [] },
          ],
        },
      ],
    };
    writeFileSync(registryPath, JSON.stringify(changed));
    const after = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(after?.workflowDigest).not.toBe(before?.workflowDigest);
    expect(after?.stages).toEqual(["0-discover", "1-brand", "2-composition"]);
  });
});

describe("renderWorkflowProvenanceMd", () => {
  test("renders the workflow id, every stage as a folder reference, and the digest", () => {
    const text = renderWorkflowProvenanceMd({
      workflowId: "website-delivery",
      stages: ["0-discover", "1-brand"],
      workflowDigest: "a".repeat(64),
    });
    expect(text).toContain("website-delivery");
    expect(text).toContain("0-discover/");
    expect(text).toContain("1-brand/");
    expect(text).toContain("a".repeat(64));
  });
});
