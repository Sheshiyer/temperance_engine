import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  STAGE_CAPABILITIES,
  STAGE_IDS,
  createHandoff,
  resolveKnowledgePointers,
  resolveStageCapabilities,
  validateHandoff,
} from "./temperance-stage-contract";

describe("Temperance seven-stage contract", () => {
  test("keeps the canonical alchemical order and stage count", () => {
    expect(STAGE_IDS).toEqual(["observe", "think", "plan", "build", "execute", "verify", "learn"]);
    expect(STAGE_CAPABILITIES.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGE_CAPABILITIES.map(({ next }) => next)).toEqual([
      "think",
      "plan",
      "build",
      "execute",
      "verify",
      "learn",
      null,
    ]);
  });

  test("maps stages to existing portfolios without classifying prompt text", () => {
    expect(STAGE_CAPABILITIES.map(({ portfolio }) => portfolio)).toEqual([
      "te-reason",
      "te-reason",
      "te-plan",
      "te-build",
      "te-dispatch",
      "te-validate",
      "te-reason",
    ]);
    expect(STAGE_CAPABILITIES.every(({ portfolioStatus }) => portfolioStatus === "existing")).toBe(true);
  });

  test("returns only catalog-backed capabilities and reports missing lanes", () => {
    const packet = resolveStageCapabilities("verify", {
      skills: ["ISA", "browser-automation-core"],
      mcp: ["codegraph", "chrome_devtools"],
      knowledge: ["project-isa"],
    });

    expect(packet.selected.skill).toEqual(["browser-automation-core", "ISA"]);
    expect(packet.selected.mcp).toEqual(["codegraph", "chrome_devtools"]);
    expect(packet.selected.knowledge).toEqual(["project-isa"]);
    expect(packet.missing.mcp).toContain("PostHog");
    expect(packet.clientOwnedExecution).toBe(true);
    expect(packet.gatewayBoundary).toMatch(/does not execute capabilities/);
  });

  test("resolves knowledge as paths only", () => {
    const pointers = resolveKnowledgePointers("/tmp/temperance-missing-cwd", "/tmp/temperance-missing-home");
    expect(pointers).toEqual([]);
    expect(JSON.stringify(pointers)).not.toMatch(/contents|body|transcript/);
  });

  test("creates and validates a stage handoff", () => {
    const packet = resolveStageCapabilities("plan", {
      skills: ["writing-plans", "ISA", "ContextSearch"],
      mcp: ["codegraph"],
      knowledge: ["project-isa", "project-planning"],
    });
    const handoff = createHandoff({
      runId: "run_test_001",
      stage: "plan",
      status: "completed",
      goal: "Freeze the implementation plan.",
      capabilityPacket: packet,
      isaRef: "/project/ISA.md",
      decisions: ["Keep OmniRoute below the stage controller."],
      artifacts: ["/project/.planning/PLAN.md"],
      verification: ["plan schema probe passed"],
      routeEvidence: { portfolio: "te-plan", provider: "github", model: "github/gpt-5.4" },
    });

    expect(handoff.stageNumber).toBe(3);
    expect(handoff.nextStage).toBe("build");
    expect(validateHandoff(handoff)).toEqual({ valid: true, errors: [] });
  });

  test("rejects malformed or secret-bearing handoffs", () => {
    const result = validateHandoff({
      schemaVersion: 1,
      runId: "run_test_002",
      stage: "plan",
      stageNumber: 3,
      status: "completed",
      goal: "plan",
      isaRef: "/project/ISA.md",
      memoryRefs: [],
      decisions: [],
      assumptions: [],
      artifacts: [],
      verification: [],
      openQuestions: [],
      nextStage: "build",
      capabilityPacket: {},
      routeEvidence: { portfolio: "te-plan" },
      raw_transcript: "must not cross the handoff seam",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("handoff contains forbidden secret or raw-transcript fields");
  });

  test("rejects expanded knowledge bodies and capability execution fields", () => {
    const packet = resolveStageCapabilities("plan", {
      skills: ["writing-plans"],
      mcp: ["codegraph"],
      knowledge: ["project-isa"],
    });
    const result = validateHandoff({
      schemaVersion: 1,
      runId: "run_test_003",
      stage: "plan",
      stageNumber: 3,
      status: "completed",
      goal: "plan",
      isaRef: "/project/ISA.md",
      memoryRefs: [{ id: "project-isa", kind: "file", path: "/project/ISA.md", present: true, body: "private body" }],
      decisions: [],
      assumptions: [],
      artifacts: [],
      verification: [],
      openQuestions: [],
      nextStage: "build",
      capabilityPacket: { ...packet, execute: { tool: "dangerous" } },
      routeEvidence: { portfolio: "te-plan" },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("memoryRefs[0] contains unsupported field"))).toBe(true);
    expect(result.errors.some((error) => error.includes("capabilityPacket contains unsupported field"))).toBe(true);
  });

  test("rejects forged lanes, portfolios, routes, paths, and transitions", () => {
    const packet = resolveStageCapabilities("plan");
    const result = validateHandoff({
      schemaVersion: 1,
      runId: "run_test_004",
      stage: "plan",
      stageNumber: 3,
      status: "completed",
      goal: "plan",
      capabilityPacket: {
        ...packet,
        portfolio: "evil-portfolio",
        selected: { skill: ["evil-skill"], mcp: [], knowledge: [] },
        missing: { skill: [], mcp: [], knowledge: [] },
      },
      isaRef: "/project/ISA.md",
      memoryRefs: [{ id: "project-isa", kind: "file", path: "/project/../etc/ISA.md", present: true }],
      decisions: [{ content: "private body" }],
      assumptions: [],
      artifacts: [],
      verification: [],
      openQuestions: [],
      nextStage: "verify",
      routeEvidence: { portfolio: "other-portfolio", body: "private body" },
      content: "must not cross the handoff seam",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("portfolio does not match stage contract"))).toBe(true);
    expect(result.errors.some((error) => error.includes("contains unsupported ref: evil-skill"))).toBe(true);
    expect(result.errors.some((error) => error.includes("path contains traversal"))).toBe(true);
    expect(result.errors.some((error) => error.includes("routeEvidence contains unsupported field: body"))).toBe(true);
    expect(result.errors).toContain("nextStage does not match the stage contract");
    expect(result.errors).toContain("handoff contains unsupported field: content");
  });

  test("fails closed for an invalid stage without throwing", () => {
    const result = validateHandoff({
      schemaVersion: 1,
      runId: "run_test_005",
      stage: "unknown",
      stageNumber: 99,
      status: "completed",
      goal: "plan",
      isaRef: "/project/ISA.md",
      memoryRefs: [],
      decisions: [],
      assumptions: [],
      artifacts: [],
      verification: [],
      openQuestions: [],
      nextStage: null,
      capabilityPacket: {},
      routeEvidence: {},
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("stage is invalid");
  });

  test("does not expose symlinked knowledge roots outside the trusted base", () => {
    const cwd = mkdtempSync(join(tmpdir(), "temperance-stage-cwd-"));
    const home = mkdtempSync(join(tmpdir(), "temperance-stage-home-"));
    const outside = mkdtempSync(join(tmpdir(), "temperance-stage-outside-"));
    try {
      mkdirSync(join(cwd, ".planning"), { recursive: true });
      mkdirSync(join(home, ".Codex/PAI/MEMORY"), { recursive: true });
      mkdirSync(join(outside, "knowledge"), { recursive: true });
      symlinkSync(join(outside, "knowledge"), join(home, ".Codex/PAI/MEMORY/KNOWLEDGE"), "dir");

      const pointers = resolveKnowledgePointers(cwd, home);
      expect(pointers.some(({ id }) => id === "pai-knowledge")).toBe(false);
      expect(pointers.find(({ id }) => id === "project-planning")?.present).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("bounds handoff text and evidence arrays", () => {
    const packet = resolveStageCapabilities("plan");
    const result = validateHandoff({
      schemaVersion: 1,
      runId: "run_test_006",
      stage: "plan",
      stageNumber: 3,
      status: "completed",
      goal: "x".repeat(16_385),
      capabilityPacket: packet,
      isaRef: "/project/ISA.md",
      memoryRefs: [],
      decisions: Array.from({ length: 129 }, () => "decision"),
      assumptions: [],
      artifacts: [],
      verification: [],
      openQuestions: [],
      nextStage: "build",
      routeEvidence: { portfolio: "te-plan" },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("goal exceeds the text limit");
    expect(result.errors).toContain("decisions exceeds the item limit");
  });
});
