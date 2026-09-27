import { describe, expect, test } from "bun:test";

import { verifyV4ReplacementProof } from "./v4-cutover-executor.ts";
import {
  generateV4ReplacementProof,
  type ReplacementProofCommandResult,
  type ReplacementProofRunner,
} from "./v4-replacement-proof.ts";

const encoder = new TextEncoder();

function result(stdout = "", exitCode = 0, stderr = ""): ReplacementProofCommandResult {
  return { exitCode, stdout: encoder.encode(stdout), stderr: encoder.encode(stderr) };
}

class FixtureRunner implements ReplacementProofRunner {
  readonly calls: string[] = [];
  dirty = false;
  failInstall = false;

  run(file: string, args: readonly string[], cwd: string): ReplacementProofCommandResult {
    this.calls.push(`${cwd}:${file} ${args.join(" ")}`);
    const command = `${file} ${args.join(" ")}`;
    if (command === "git status --porcelain=v1 --untracked-files=all") return result(this.dirty ? " M changed.ts\n" : "");
    if (command === "git rev-parse HEAD") return result(`${"a".repeat(40)}\n`);
    if (command === "git rev-parse HEAD^{tree}") return result(`${"b".repeat(40)}\n`);
    if (command === "git archive --format=tar HEAD") return result("archive bytes");
    if (command === "bun run verify") return this.failInstall ? result("", 1, "private failure detail") : result("315 pass\n");
    if (command.startsWith("bun test package/router/v4-cutover-plan.test.ts")) return result("cutover tests pass\n");
    return result("", 1);
  }
}

describe("V4 replacement proof generator", () => {
  test("binds a clean Git archive and both successful verification surfaces", () => {
    const runner = new FixtureRunner();
    const proof = generateV4ReplacementProof({
      repositoryRoot: "/reviewed/source",
      runner,
      now: () => new Date("2026-09-17T06:30:00.000Z"),
    });
    expect(verifyV4ReplacementProof(proof)).toBe(true);
    expect(proof).toMatchObject({
      temperance_revision: "a".repeat(40),
      temperance_tree: "b".repeat(40),
      router: { package: "9router", version: "0.5.75" },
    });
    expect(proof.artifact_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(proof.verification.install_surface).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(proof.verification.cutover_contract).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(runner.calls).toHaveLength(6);
  });

  test("refuses dirty source before reading a revision or running tests", () => {
    const runner = new FixtureRunner();
    runner.dirty = true;
    expect(() => generateV4ReplacementProof({ repositoryRoot: "/reviewed/source", runner })).toThrow("REPLACEMENT_PROOF_WORKTREE_NOT_CLEAN");
    expect(runner.calls).toHaveLength(1);
  });

  test("returns a stable error without leaking failed verification output", () => {
    const runner = new FixtureRunner();
    runner.failInstall = true;
    let message = "";
    try { generateV4ReplacementProof({ repositoryRoot: "/reviewed/source", runner }); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toBe("REPLACEMENT_PROOF_INSTALL_SURFACE_FAILED");
    expect(message).not.toContain("private failure detail");
  });
});
