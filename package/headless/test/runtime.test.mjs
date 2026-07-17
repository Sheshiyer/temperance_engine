import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJson,
  digestCanonical,
  planShadowAttempt,
  validateEnvelope,
} from "../lib/runtime.mjs";

const fixtureUrl = new URL("../fixtures/hermes-shadow-attempt.v1.json", import.meta.url);
const policyUrl = new URL("../share/policy.v1.json", import.meta.url);
const manifestUrl = new URL("../fixtures/runtime-manifest.test.json", import.meta.url);

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("golden Hermes-shaped envelope produces a typed no-side-effect decision", async () => {
  const envelope = await json(fixtureUrl);
  const decision = planShadowAttempt(envelope, await json(policyUrl), await json(manifestUrl));

  assert.equal(decision.schema, "thoughtseed.temperance.shadow_decision.v1");
  assert.equal(decision.mode, "shadow");
  assert.deepEqual(decision.guardrails, {
    approvalAuthority: "external_observation_only",
    canGrantApproval: false,
    sideEffectsAllowed: false,
    backendInvocationAllowed: false,
    networkAllowed: false,
    domainWritesAllowed: false,
  });
  assert.equal(decision.route.status, "planned");
  assert.equal(decision.route.logicalBackend, "kimi");
  assert.equal(decision.route.backendAvailability, "not_probed");
  assert.deepEqual(decision.route.requiredSkills, ["anthropic-skills:thoughtseed-contract-generator"]);
  assert.equal(decision.route.rendererPolicy, "thoughtseed.contract.renderer.v1");
  assert.match(decision.proof.inputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(decision.proof.decisionDigest, /^sha256:[a-f0-9]{64}$/);
});

test("unknown fields fail closed", async () => {
  const envelope = await json(fixtureUrl);
  envelope.context.untrackedState = "must-not-be-accepted";
  assert.throws(() => validateEnvelope(envelope), /unknown field context\.untrackedState/);
});

test("missing approval observation fails closed", async () => {
  const envelope = await json(fixtureUrl);
  delete envelope.approval;
  assert.throws(() => validateEnvelope(envelope), /missing field root\.approval/);
});

test("pending external approval yields needs_human without granting it", async () => {
  const envelope = await json(fixtureUrl);
  envelope.approval.observedState = "pending";
  envelope.approval.observationId = "actionrequest_shadow_pending_0001";
  envelope.approval.observedAt = "2026-07-17T08:00:00Z";
  const decision = planShadowAttempt(envelope, await json(policyUrl), await json(manifestUrl));
  assert.equal(decision.route.status, "needs_human");
  assert.equal(decision.guardrails.canGrantApproval, false);
});

test("missing policy route is a typed block, never a fallback", async () => {
  const envelope = await json(fixtureUrl);
  envelope.intent.domain = "marketing";
  envelope.intent.operation = "campaign.publish";
  envelope.approval.required = false;
  envelope.approval.observedState = "not_required";
  envelope.approval.observationId = null;
  envelope.approval.observedAt = null;
  const decision = planShadowAttempt(envelope, await json(policyUrl), await json(manifestUrl));
  assert.equal(decision.route.status, "blocked");
  assert.equal(decision.route.reason, "policy_route_missing");
  assert.equal(decision.route.logicalBackend, null);
});

test("canonicalization normalizes strings, sorts keys, and rejects non-integers", () => {
  assert.equal(canonicalJson({ b: "e\u0301", a: 1 }), '{"a":1,"b":"é"}');
  assert.equal(digestCanonical({ b: 2, a: 1 }), digestCanonical({ a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ unsafe: 1.5 }), /integers only/);
});
