import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runtime = new URL("../lib/runtime.mjs", import.meta.url).pathname;
const envelope = new URL("../fixtures/hermes-shadow-attempt.v1.json", import.meta.url).pathname;
const policy = new URL("../share/policy.v1.json", import.meta.url).pathname;
const manifest = new URL("../fixtures/runtime-manifest.test.json", import.meta.url).pathname;
const invalidApproval = new URL("../fixtures/invalid-missing-approval.v1.json", import.meta.url).pathname;
const invalidField = new URL("../fixtures/invalid-unknown-field.v1.json", import.meta.url).pathname;

async function invoke(input) {
  return execFileAsync(process.execPath, [
    runtime,
    "--envelope", input,
    "--policy", policy,
    "--manifest", manifest,
  ], { env: { PATH: "" }, encoding: "utf8" });
}

const { stdout } = await invoke(envelope);

const decision = JSON.parse(stdout);
assert.equal(decision.schema, "thoughtseed.temperance.shadow_decision.v1");
assert.equal(decision.mode, "shadow");
assert.equal(decision.guardrails.sideEffectsAllowed, false);
assert.equal(decision.guardrails.backendInvocationAllowed, false);
assert.equal(decision.guardrails.networkAllowed, false);
assert.equal(decision.route.backendAvailability, "not_probed");

for (const [input, expectedCode] of [[invalidApproval, "missing_field"], [invalidField, "unknown_field"]]) {
  await assert.rejects(invoke(input), (error) => {
    const typed = JSON.parse(error.stderr);
    assert.equal(typed.schema, "thoughtseed.temperance.shadow_error.v1");
    assert.equal(typed.code, expectedCode);
    assert.equal(error.stdout, "");
    return true;
  });
}
console.log(JSON.stringify({ ok: true, gate: "standalone:smoke", decisionDigest: decision.proof.decisionDigest }));
