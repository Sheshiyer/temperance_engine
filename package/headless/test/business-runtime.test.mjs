import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  renderServiceAgreement,
  validateDirective,
  validatePolicy,
} from "../lib/business-runtime.mjs";

const execFileAsync = promisify(execFile);
const fixtureUrl = new URL("../fixtures/service-agreement-directive.v1.json", import.meta.url);
const policyUrl = new URL("../share/service-agreement-policy.v1.json", import.meta.url);

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("renders pinned Thoughtseed service-agreement DOCX with legal draft guardrails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "temperance-business-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await renderServiceAgreement(await json(fixtureUrl), await json(policyUrl), directory, "shesh");

  assert.equal(result.schema, "thoughtseed.temperance.business_execution.v1");
  assert.equal(result.status, "rendered");
  assert.equal(result.approvalState, "awaiting_human_approval");
  assert.equal(result.synthetic, true);
  assert.equal(result.externalAction, "none");
  assert.match(result.artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.policies.contentPolicyId, "anthropic-skills:thoughtseed-contract-generator@1");
  assert.equal(result.policies.rendererPolicyId, "thoughtseed.docx.legal.a4.v1");
  assert.equal(result.policies.fallbackPolicy, "fail_closed");

  await execFileAsync("unzip", ["-t", result.artifact.path]);
  const documentXml = (await execFileAsync("unzip", ["-p", result.artifact.path, "word/document.xml"], { maxBuffer: 4_000_000 })).stdout;
  const stylesXml = (await execFileAsync("unzip", ["-p", result.artifact.path, "word/styles.xml"], { maxBuffer: 4_000_000 })).stdout;
  const footerXml = (await execFileAsync("unzip", ["-p", result.artifact.path, "word/footer1.xml"], { maxBuffer: 4_000_000 })).stdout;
  const flattened = documentXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const required of [
    "SYSTEM CANARY — DRAFT — NOT FOR SIGNATURE OR EXTERNAL USE",
    "SERVICE AGREEMENT",
    "PARTIES",
    "RECITALS",
    "1. SCOPE OF SERVICES",
    "2. FEES AND PAYMENT",
    "3. TERM AND TERMINATION",
    "4. CONFIDENTIALITY",
    "5. INTELLECTUAL PROPERTY",
    "6. WARRANTIES",
    "7. LIMITATION OF LIABILITY",
    "8. INDEMNIFICATION",
    "9. GENERAL PROVISIONS",
    "10. GOVERNING LAW AND DISPUTE RESOLUTION",
    "11. SIGNATURES DISABLED",
    "APPENDIX A – SCOPE OF WORK",
    "One pinned Thoughtseed service-agreement DOCX draft",
  ]) assert.match(flattened, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(documentXml, /<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/);
  assert.match(documentXml, /<w:pgMar[^>]*w:top="1440"[^>]*w:right="1440"[^>]*w:bottom="1440"[^>]*w:left="1440"/);
  assert.match(stylesXml, /w:ascii="Times New Roman"/);
  assert.match(stylesXml, /<w:sz w:val="22"/);
  assert.match(footerXml, /PAGE/);
});

test("fresh output directories produce byte-identical DOCX archives", async (t) => {
  const firstDirectory = await mkdtemp(join(tmpdir(), "temperance-business-determinism-a-"));
  const secondDirectory = await mkdtemp(join(tmpdir(), "temperance-business-determinism-b-"));
  t.after(() => Promise.all([
    rm(firstDirectory, { recursive: true, force: true }),
    rm(secondDirectory, { recursive: true, force: true }),
  ]));
  const directive = await json(fixtureUrl);
  const policy = await json(policyUrl);
  const first = await renderServiceAgreement(directive, policy, firstDirectory, "shesh");
  const second = await renderServiceAgreement(directive, policy, secondDirectory, "shesh");
  assert.equal(first.artifact.digest, second.artifact.digest);
  assert.deepEqual(await readFile(first.artifact.path), await readFile(second.artifact.path));
});

test("unknown fields and prohibited external actions fail before rendering", async () => {
  const directive = await json(fixtureUrl);
  directive.payload.input.delivery = { channel: "email" };
  assert.throws(() => validateDirective(directive, "shesh"), (error) => error.code === "unknown_field");

  delete directive.payload.input.delivery;
  directive.payload.input.intent = "Create and send this agreement for signature";
  assert.throws(() => validateDirective(directive, "shesh"), (error) => error.code === "external_action_forbidden");
});

test("synthetic counterparty and policy digests fail closed", async () => {
  const directive = await json(fixtureUrl);
  directive.payload.input.clientDisplayName = "Real Client Limited";
  assert.throws(() => validateDirective(directive, "shesh"), (error) => error.code === "contract_mismatch");

  const policy = await json(policyUrl);
  policy.rendererPolicy.spec.marginDxa = 720;
  assert.throws(() => validatePolicy(policy), (error) => error.code === "contract_mismatch");
});
