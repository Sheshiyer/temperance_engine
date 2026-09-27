import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { parseV4CutoverApplyArgs } from "../src/onboarding/v4-cutover-apply-cli-args.ts";

const complete = [
  "--plan", "plan.json",
  "--proof", "proof.json",
  "--confirmation", "confirmation.json",
  "--host-binding", "host-binding.json",
  "--legacy-credential-reference", "LEGACY_OMNIROUTE_GATEWAY_KEY",
  "--source-repository", "/source/temperance-engine",
] as const;

test("V4 cutover apply arguments require every external admission artifact", () => {
  expect(parseV4CutoverApplyArgs(complete)).toEqual({
    planPath: "plan.json",
    proofPath: "proof.json",
    confirmationPath: "confirmation.json",
    hostBindingPath: "host-binding.json",
    legacyCredentialReferenceId: "LEGACY_OMNIROUTE_GATEWAY_KEY",
    sourceRepository: "/source/temperance-engine",
  });
  expect(() => parseV4CutoverApplyArgs(complete.slice(0, -2))).toThrow("CUTOVER_APPLY_ARGUMENT_INVALID");
  expect(() => parseV4CutoverApplyArgs([...complete, "--json"])).toThrow("CUTOVER_APPLY_ARGUMENT_INVALID");
  expect(() => parseV4CutoverApplyArgs([...complete, "--plan", "other.json"])).toThrow("CUTOVER_APPLY_ARGUMENT_INVALID");
});

test("CLI rejects incomplete apply admission before loading live runtime", () => {
  const result = Bun.spawnSync([
    "bun", "run", "src/cli.ts", "cutover-apply", "--plan", "plan.json",
  ], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(64);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toContain("CUTOVER_APPLY_ARGUMENT_INVALID");
});
