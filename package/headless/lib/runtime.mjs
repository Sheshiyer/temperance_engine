#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const ENVELOPE_SCHEMA = "thoughtseed.hermes.temperance_shadow_attempt.v1";
export const POLICY_SCHEMA = "thoughtseed.temperance.shadow_policy.v1";
export const RELEASE_SCHEMA = "thoughtseed.temperance.headless_release.v1";
export const DECISION_SCHEMA = "thoughtseed.temperance.shadow_decision.v1";
export const CANONICALIZATION = "thoughtseed.canonical_json.nfc_utf8_sorted_keys_integer_numbers.v1";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const DOMAINS = new Set([
  "hr",
  "accounting",
  "legal",
  "project_management",
  "marketing",
  "distribution",
  "operations",
]);
const BACKENDS = new Set(["auto", "kimi", "command-code"]);
const APPROVAL_STATES = new Set(["not_required", "pending", "approved", "rejected"]);

export class ShadowContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShadowContractError";
    this.code = code;
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, "root"));
}

export function digestCanonical(value) {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateEnvelope(value) {
  const root = exactObject(value, "root", ["schema", "hermes", "context", "approval", "intent", "proof"]);
  equal(root.schema, ENVELOPE_SCHEMA, "root.schema");

  const hermes = exactObject(root.hermes, "hermes", [
    "releaseCommit",
    "directiveId",
    "idempotencyKey",
    "executionId",
    "claimId",
    "attempt",
    "runnerId",
    "hostIdentity",
    "leaseExpiresAt",
  ]);
  match(hermes.releaseCommit, /^[a-f0-9]{40}$/, "hermes.releaseCommit");
  for (const key of ["directiveId", "idempotencyKey", "executionId", "claimId", "runnerId", "hostIdentity"]) {
    safeId(hermes[key], `hermes.${key}`);
  }
  positiveInteger(hermes.attempt, "hermes.attempt");
  isoDate(hermes.leaseExpiresAt, "hermes.leaseExpiresAt");

  const context = exactObject(root.context, "context", ["tenantId", "projectId", "workflowId", "taskId", "attemptId"]);
  for (const key of ["tenantId", "projectId", "workflowId", "taskId", "attemptId"]) {
    safeId(context[key], `context.${key}`);
  }

  const approval = exactObject(root.approval, "approval", ["required", "observedState", "observationId", "observedAt"]);
  if (typeof approval.required !== "boolean") fail("invalid_type", "approval.required must be boolean");
  oneOf(approval.observedState, APPROVAL_STATES, "approval.observedState");
  nullableSafeId(approval.observationId, "approval.observationId");
  nullableIsoDate(approval.observedAt, "approval.observedAt");
  if (approval.required) {
    if (approval.observedState === "not_required") {
      fail("invalid_approval_observation", "approval.required cannot observe not_required");
    }
    if (approval.observationId === null || approval.observedAt === null) {
      fail("missing_approval_observation", "required approval needs observationId and observedAt");
    }
  } else if (
    approval.observedState !== "not_required"
    || approval.observationId !== null
    || approval.observedAt !== null
  ) {
    fail("invalid_approval_observation", "non-required approval must be an explicit null not_required observation");
  }

  const intent = exactObject(root.intent, "intent", [
    "domain",
    "operation",
    "summary",
    "requestedArtifact",
    "requestedBackend",
  ]);
  oneOf(intent.domain, DOMAINS, "intent.domain");
  safeId(intent.operation, "intent.operation");
  if (typeof intent.summary !== "string" || intent.summary.length < 1 || intent.summary.length > 1000) {
    fail("invalid_summary", "intent.summary must be 1-1000 characters");
  }
  nullableSafeId(intent.requestedArtifact, "intent.requestedArtifact");
  oneOf(intent.requestedBackend, BACKENDS, "intent.requestedBackend");

  const proof = exactObject(root.proof, "proof", ["policyVersion", "expectedMode"]);
  equal(proof.policyVersion, POLICY_SCHEMA, "proof.policyVersion");
  equal(proof.expectedMode, "shadow", "proof.expectedMode");
  canonicalJson(root);
  return root;
}

export function validatePolicy(value) {
  const policy = exactObject(value, "policy", ["schema", "version", "routes"]);
  equal(policy.schema, POLICY_SCHEMA, "policy.schema");
  equal(policy.version, POLICY_SCHEMA, "policy.version");
  const routes = record(policy.routes, "policy.routes");
  for (const [key, routeValue] of Object.entries(routes)) {
    match(key, /^(?:hr|accounting|legal|project_management|marketing|distribution|operations):[A-Za-z0-9._:-]{1,256}$/, `policy.routes.${key}`);
    const route = exactObject(routeValue, `policy.routes.${key}`, [
      "logicalBackend",
      "requiredSkills",
      "rendererPolicy",
      "proofPolicy",
      "approvalRequired",
    ]);
    oneOf(route.logicalBackend, new Set(["kimi", "command-code"]), `policy.routes.${key}.logicalBackend`);
    if (!Array.isArray(route.requiredSkills) || route.requiredSkills.length < 1) {
      fail("invalid_policy", `policy.routes.${key}.requiredSkills must be a non-empty array`);
    }
    for (const [index, skill] of route.requiredSkills.entries()) {
      safeId(skill, `policy.routes.${key}.requiredSkills.${index}`);
    }
    nullableSafeId(route.rendererPolicy, `policy.routes.${key}.rendererPolicy`);
    safeId(route.proofPolicy, `policy.routes.${key}.proofPolicy`);
    if (typeof route.approvalRequired !== "boolean") {
      fail("invalid_policy", `policy.routes.${key}.approvalRequired must be boolean`);
    }
  }
  canonicalJson(policy);
  return policy;
}

export function validateReleaseManifest(value) {
  const manifest = exactObject(
    value,
    "manifest",
    ["schema", "releaseId", "version", "sourceCommit", "node", "contentDigest"],
    ["files"],
  );
  equal(manifest.schema, RELEASE_SCHEMA, "manifest.schema");
  safeId(manifest.releaseId, "manifest.releaseId");
  safeId(manifest.version, "manifest.version");
  match(manifest.sourceCommit, /^[a-f0-9]{40}$/, "manifest.sourceCommit");
  equal(manifest.node, ">=22 <23", "manifest.node");
  match(manifest.contentDigest, SHA256, "manifest.contentDigest");
  if (manifest.files !== undefined) {
    if (!Array.isArray(manifest.files)) fail("invalid_manifest", "manifest.files must be an array");
    for (const [index, file] of manifest.files.entries()) {
      const item = exactObject(file, `manifest.files.${index}`, ["path", "sha256"]);
      if (typeof item.path !== "string" || !/^[A-Za-z0-9._/-]+$/.test(item.path) || item.path.includes("..")) {
        fail("invalid_manifest", `manifest.files.${index}.path is unsafe`);
      }
      match(item.sha256, SHA256, `manifest.files.${index}.sha256`);
    }
  }
  return manifest;
}

export function planShadowAttempt(envelopeValue, policyValue, manifestValue) {
  const envelope = validateEnvelope(envelopeValue);
  const policy = validatePolicy(policyValue);
  const manifest = validateReleaseManifest(manifestValue);
  const routeKey = `${envelope.intent.domain}:${envelope.intent.operation}`;
  const policyRoute = policy.routes[routeKey] ?? null;

  let status = "blocked";
  let reason = "policy_route_missing";
  let logicalBackend = null;
  let requiredSkills = [];
  let rendererPolicy = null;
  let proofPolicy = null;

  if (policyRoute) {
    logicalBackend = policyRoute.logicalBackend;
    requiredSkills = [...policyRoute.requiredSkills];
    rendererPolicy = policyRoute.rendererPolicy;
    proofPolicy = policyRoute.proofPolicy;
    if (envelope.intent.requestedBackend !== "auto" && envelope.intent.requestedBackend !== logicalBackend) {
      reason = "requested_backend_policy_mismatch";
    } else if (envelope.approval.required !== policyRoute.approvalRequired) {
      reason = "approval_contract_mismatch";
    } else if (envelope.approval.observedState === "rejected") {
      reason = "approval_rejected";
    } else if (envelope.approval.observedState === "pending") {
      status = "needs_human";
      reason = "approval_pending";
    } else {
      status = "planned";
      reason = "policy_route_selected";
    }
  }

  const decisionCore = {
    schema: DECISION_SCHEMA,
    mode: "shadow",
    runtime: {
      releaseId: manifest.releaseId,
      version: manifest.version,
      sourceCommit: manifest.sourceCommit,
      policyVersion: policy.version,
    },
    identity: {
      tenantId: envelope.context.tenantId,
      projectId: envelope.context.projectId,
      workflowId: envelope.context.workflowId,
      taskId: envelope.context.taskId,
      attemptId: envelope.context.attemptId,
      directiveId: envelope.hermes.directiveId,
      idempotencyKey: envelope.hermes.idempotencyKey,
      executionId: envelope.hermes.executionId,
      claimId: envelope.hermes.claimId,
      attempt: envelope.hermes.attempt,
      runnerId: envelope.hermes.runnerId,
      hostIdentity: envelope.hermes.hostIdentity,
    },
    enrichedContext: {
      domain: envelope.intent.domain,
      operation: envelope.intent.operation,
      requestedArtifact: envelope.intent.requestedArtifact,
      summary: envelope.intent.summary.normalize("NFC"),
    },
    approvalObservation: {
      required: envelope.approval.required,
      state: envelope.approval.observedState,
      observationId: envelope.approval.observationId,
      observedAt: envelope.approval.observedAt,
    },
    guardrails: {
      approvalAuthority: "external_observation_only",
      canGrantApproval: false,
      sideEffectsAllowed: false,
      backendInvocationAllowed: false,
      networkAllowed: false,
      domainWritesAllowed: false,
    },
    route: {
      status,
      reason,
      logicalBackend,
      backendAvailability: "not_probed",
      requiredSkills,
      rendererPolicy,
      proofPolicy,
    },
  };

  return {
    ...decisionCore,
    proof: {
      canonicalization: CANONICALIZATION,
      inputDigest: digestCanonical(envelope),
      decisionDigest: digestCanonical(decisionCore),
    },
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      "temperance-shadow --envelope FILE --policy FILE --manifest FILE",
      "",
      "Validates one Hermes-shaped attempt and emits a route-only shadow decision.",
      "It cannot grant approval, invoke a backend, use the network, or write domain state.",
      "",
    ].join("\n"));
    return;
  }
  const [envelope, policy, manifest] = await Promise.all([
    readJson(args.envelope),
    readJson(args.policy),
    readJson(args.manifest),
  ]);
  process.stdout.write(`${canonicalJson(planShadowAttempt(envelope, policy, manifest))}\n`);
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const allowed = new Set(["--envelope", "--policy", "--manifest"]);
  const result = { help: false };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== "string" || value.length === 0) {
      fail("invalid_arguments", "expected --envelope FILE --policy FILE --manifest FILE");
    }
    const key = flag.slice(2);
    if (result[key] !== undefined) fail("invalid_arguments", `duplicate flag ${flag}`);
    result[key] = value;
  }
  for (const key of ["envelope", "policy", "manifest"]) {
    if (result[key] === undefined) fail("invalid_arguments", `missing --${key}`);
  }
  return result;
}

async function readJson(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail("input_unreadable", "required input file is unreadable");
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("invalid_json", "required input file is not valid JSON");
  }
}

function canonicalValue(value, path) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("non_canonical_number", `${path} allows safe integers only`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}.${index}`));
  if (!value || typeof value !== "object") fail("non_canonical_type", `${path} contains a non-JSON value`);

  const normalized = new Map();
  for (const [rawKey, item] of Object.entries(value)) {
    const key = rawKey.normalize("NFC");
    if (normalized.has(key)) fail("canonical_key_collision", `${path} has colliding normalized keys`);
    normalized.set(key, item);
  }
  const keys = [...normalized.keys()].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  return Object.fromEntries(keys.map((key) => [key, canonicalValue(normalized.get(key), `${path}.${key}`)]));
}

function exactObject(value, path, required, optional = []) {
  const object = record(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail("unknown_field", `unknown field ${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) fail("missing_field", `missing field ${path}.${key}`);
  }
  return object;
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_type", `${path} must be an object`);
  return value;
}

function safeId(value, path) {
  match(value, SAFE_ID, path);
}

function nullableSafeId(value, path) {
  if (value !== null) safeId(value, path);
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail("invalid_integer", `${path} must be a positive safe integer`);
}

function isoDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail("invalid_datetime", `${path} must be an ISO-8601 UTC timestamp`);
  }
}

function nullableIsoDate(value, path) {
  if (value !== null) isoDate(value, path);
}

function oneOf(value, choices, path) {
  if (!choices.has(value)) fail("invalid_enum", `${path} is not an allowed value`);
}

function equal(value, expected, path) {
  if (value !== expected) fail("invalid_constant", `${path} must equal ${expected}`);
}

function match(value, pattern, path) {
  if (typeof value !== "string" || !pattern.test(value)) fail("invalid_format", `${path} has invalid format`);
}

function fail(code, message) {
  throw new ShadowContractError(code, message);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof ShadowContractError ? error.code : "shadow_runtime_error";
    process.stderr.write(`${canonicalJson({ schema: "thoughtseed.temperance.shadow_error.v1", code })}\n`);
    process.exitCode = 2;
  });
}
