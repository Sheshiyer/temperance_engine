import { expect, test } from "bun:test";

import { parseV4CutoverReviewArgs } from "../src/onboarding/v4-cutover-cli-args.ts";

test("V4 cutover review arguments require plan, proof, and intended host binding", () => {
  expect(parseV4CutoverReviewArgs(["--plan", "plan.json", "--proof", "proof.json", "--host-binding", "host.json", "--json"]))
    .toEqual({ planPath: "plan.json", proofPath: "proof.json", hostBindingPath: "host.json", json: true, tui: false });
  expect(parseV4CutoverReviewArgs(["--proof", "proof.json", "--host-binding", "host.json", "--plan", "plan.json", "--tui"]))
    .toEqual({ planPath: "plan.json", proofPath: "proof.json", hostBindingPath: "host.json", json: false, tui: true });
  expect(() => parseV4CutoverReviewArgs(["--plan", "plan.json"])).toThrow("CUTOVER_REVIEW_ARGUMENT_INVALID");
  expect(() => parseV4CutoverReviewArgs(["--plan", "p", "--proof", "r", "--host-binding", "h", "--json", "--tui"]))
    .toThrow("CUTOVER_REVIEW_ARGUMENT_INVALID");
  expect(() => parseV4CutoverReviewArgs(["--plan", "p", "--proof", "r", "--host-binding", "h", "--apply"]))
    .toThrow("CUTOVER_REVIEW_ARGUMENT_INVALID");
});
