import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runtime = new URL("../lib/runtime.mjs", import.meta.url).pathname;
const envelope = new URL("../fixtures/hermes-shadow-attempt.v1.json", import.meta.url).pathname;
const policy = new URL("../share/policy.v1.json", import.meta.url).pathname;
const manifest = new URL("../fixtures/runtime-manifest.test.json", import.meta.url).pathname;
const invalidApproval = new URL("../fixtures/invalid-missing-approval.v1.json", import.meta.url).pathname;
const invalidField = new URL("../fixtures/invalid-unknown-field.v1.json", import.meta.url).pathname;
const business = new URL("../bin/temperance-business", import.meta.url).pathname;
const businessPolicy = new URL("../share/service-agreement-policy.v1.json", import.meta.url).pathname;
const businessDirective = new URL("../fixtures/service-agreement-directive.v1.json", import.meta.url).pathname;

async function invoke(input) {
  return execFileAsync(process.execPath, [
    runtime,
    "--envelope", input,
    "--policy", policy,
    "--manifest", manifest,
  ], { env: { PATH: "" }, encoding: "utf8" });
}

async function invokeBusiness(input, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [business, ...args], {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error("business renderer failed"), { code, stdout, stderr })));
    child.stdin.end(input);
  });
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
const outputDir = await mkdtemp(join(tmpdir(), "temperance-business-smoke-"));
try {
  const directiveJson = await readFile(businessDirective, "utf8");
  const rendered = await invokeBusiness(directiveJson, ["--policy", businessPolicy, "--output-dir", outputDir, "--member-id", "shesh"]);
  const receipt = JSON.parse(rendered.stdout);
  assert.equal(receipt.status, "rendered");
  assert.equal(receipt.approvalState, "awaiting_human_approval");
  assert.match(receipt.artifact.digest, /^sha256:[a-f0-9]{64}$/);
  console.log(JSON.stringify({ ok: true, gate: "standalone:smoke", decisionDigest: decision.proof.decisionDigest, artifactDigest: receipt.artifact.digest }));
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
