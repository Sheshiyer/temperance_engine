import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import manifestJson from "./omniroute-s-tier-candidates.ec2.json";
import {
  CONTROL_EVIDENCE_CODES,
  S_TIER_OUTCOMES,
  buildProbeSchedule,
  canonicalManifestBytes,
  createProbeRequest,
  createTelemetryReceipt,
  maximumScheduledRequests,
  parseFixtureEvidence,
  parseSTierManifest,
  sanitizeHttpObservation,
  sha256,
  writePrivateReceipt,
  type SanitizedObservation,
  type STierManifest,
} from "./omniroute-s-tier-readiness";
import { collectLive, credentialMetadataAccepted, pathWithin, readStrictCredential, resolveRuntimeContext } from "../../scripts/omniroute-s-tier-readiness";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "scripts/omniroute-s-tier-readiness.ts");
const MANIFEST_PATH = join(ROOT, "package/router/omniroute-s-tier-candidates.ec2.json");
const NONCE = "0123456789abcdef0123456789abcdef";
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    try {
      spawnSync("/bin/chmod", ["-R", "u+rwx", path]);
      spawnSync("/bin/rm", ["-rf", path]);
    } catch {
      // Cleanup is best effort and never part of the probe implementation.
    }
  }
});

function cloneManifest(): unknown {
  return structuredClone(manifestJson);
}

function manifest(): STierManifest {
  return parseSTierManifest(cloneManifest());
}

function observation(entry: ReturnType<typeof buildProbeSchedule>[number], overrides: Partial<SanitizedObservation> = {}): SanitizedObservation {
  return {
    ordinal: entry.ordinal,
    kind: entry.kind,
    ...(entry.candidateId ? { candidateId: entry.candidateId } : {}),
    probe: entry.probe,
    transport: "http",
    httpStatus: 200,
    typedErrorCode: null,
    observedProvider: null,
    observedModel: null,
    responseShape: "valid",
    noncePresent: true,
    valuePresent: true,
    refusalPresent: false,
    finishReason: entry.probe === "tool" ? "tool_calls" : "stop",
    toolNameValid: true,
    normalized: true,
    ...overrides,
  };
}

function passingControls(candidateOverrides: Record<string, Partial<SanitizedObservation>> = {}, executablePresence: Record<string, boolean> = { auggie: false }): SanitizedObservation[] {
  const plan = manifest();
  return buildProbeSchedule(plan, executablePresence).map((entry) => {
    if (entry.kind === "pin_before" || entry.kind === "pin_after") return observation(entry, { httpStatus: 404, responseShape: "invalid", noncePresent: false, valuePresent: false, finishReason: null });
    if (entry.kind === "mismatch") return observation(entry, { observedProvider: "nebius", observedModel: "meta-llama/Llama-3.3-70B-Instruct" });
    return observation(entry, candidateOverrides[`${entry.candidateId}:${entry.probe}`]);
  });
}

function makeReceipt(observations: SanitizedObservation[], executablePresence: Record<string, boolean> = { auggie: false }, evidenceMode: "fixture" | "live" = "fixture") {
  const plan = manifest();
  return createTelemetryReceipt({
    manifest: plan,
    evidenceMode,
    executablePresence,
    observations,
    nonce: NONCE,
    manifestCanonicalBytes: canonicalManifestBytes(plan),
    probeSourceBytes: Buffer.from("fixture-probe-source", "utf8"),
    now: new Date("2026-08-01T20:00:00.000Z"),
  });
}

function candidateExact(candidateId: string): Record<string, Partial<SanitizedObservation>> {
  const candidate = manifest().candidates.find((item) => item.id === candidateId)!;
  const exact = { observedProvider: candidate.expected_serving_provider, observedModel: candidate.expected_serving_model };
  return { [`${candidateId}:content`]: exact, [`${candidateId}:tool`]: exact };
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function writeFixture(root: string, observations: SanitizedObservation[], executablePresence: Record<string, boolean> = { auggie: false }): string {
  const path = join(root, "fixture.json");
  writeFileSync(path, JSON.stringify({ schema_version: 1, kind: "temperance.omniroute-s-tier-fixture", executable_presence: executablePresence, observations }));
  return path;
}

function walkFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walkFiles(child) : [child];
  });
}

describe("EC2 S-tier falsification manifest", () => {
  test("accepts only the exact preregistered non-Sol candidate set", () => {
    const parsed = manifest();
    expect(parsed.candidates.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "aug/claude-opus-4.6",
      "tllm/CLAUDE_4_6_OPUS",
      "tllm/claude_opus_4",
    ]);
    expect(parsed.candidates.map((item) => item.expected_serving_provider)).toEqual(["auggie", "theoldllm", "theoldllm"]);
    expect(JSON.stringify(parsed.candidates)).not.toMatch(/(^|[-_/.])(?:codex|sol(?:-max)?|auto|no[-_]?think)(?=$|[-_/.])/iu);
    expect(S_TIER_OUTCOMES).toEqual(["FALSIFIED", "CONSISTENT_UNPROVEN", "ENV_UNAVAILABLE", "QUOTA_BLOCKED", "TRANSPORT_FAIL", "PINNING_UNVERIFIED", "STRUCTURALLY_UNVERIFIABLE"]);
  });

  test("rejects malformed, duplicate, forbidden, auto, and real-tool candidate fields", () => {
    const malformed = cloneManifest() as any;
    malformed.candidates = "not-an-array";
    expect(() => parseSTierManifest(malformed)).toThrow("candidate_count_invalid");
    const duplicate = cloneManifest() as any;
    duplicate.candidates[1] = structuredClone(duplicate.candidates[0]);
    expect(() => parseSTierManifest(duplicate)).toThrow("candidate_duplicate");
    const forbidden = cloneManifest() as any;
    forbidden.candidates[0].provider = "codex";
    expect(() => parseSTierManifest(forbidden)).toThrow("candidate_family_forbidden");
    const auto = cloneManifest() as any;
    auto.candidates[0].provider = "auto";
    expect(() => parseSTierManifest(auto)).toThrow("candidate_family_forbidden");
    const tool = cloneManifest() as any;
    tool.candidates[0].tool_name = "bash";
    expect(() => parseSTierManifest(tool)).toThrow("candidate_keys_invalid");
  });

  test("pins an exact deterministic nine-request ceiling", () => {
    const parsed = manifest();
    expect(maximumScheduledRequests(parsed)).toBe(9);
    expect(buildProbeSchedule(parsed, { auggie: true })).toHaveLength(9);
    const withoutAuggie = buildProbeSchedule(parsed, { auggie: false });
    expect(withoutAuggie).toHaveLength(7);
    expect(withoutAuggie.filter((entry) => entry.candidateId === "aug-claude-opus-4-6")).toHaveLength(0);
    expect(withoutAuggie.map((entry) => entry.kind)).toEqual(["pin_before", "mismatch", "candidate", "candidate", "candidate", "candidate", "pin_after"]);
  });

  test("rejects a manifest ceiling below its deterministic schedule before collection", () => {
    const belowCeiling = cloneManifest() as any;
    belowCeiling.limits.max_requests = 8;
    expect(() => parseSTierManifest(belowCeiling)).toThrow("request_ceiling_not_exact");
  });

  test("builds bounded non-streaming literal-off content and inert tool requests", () => {
    const parsed = manifest();
    const entries = buildProbeSchedule(parsed, { auggie: true });
    const content = createProbeRequest(parsed, entries.find((item) => item.kind === "candidate" && item.probe === "content")!, NONCE);
    const tool = createProbeRequest(parsed, entries.find((item) => item.kind === "candidate" && item.probe === "tool")!, NONCE);
    expect(content).toMatchObject({ stream: false, temperature: 0, max_tokens: 64 });
    expect(JSON.stringify(content)).toContain(NONCE);
    expect(tool).toMatchObject({ stream: false, temperature: 0, max_tokens: 64 });
    expect((tool.tools as any[])[0].function.name).toBe("te_probe_noop");
    expect(JSON.stringify(tool)).toContain("TOOL_OK");
    expect(() => createProbeRequest(parsed, entries[0], "too-short")).toThrow("nonce_invalid");
  });
});

describe("pure falsification evaluation", () => {
  test("invalid mismatch dispatches exactly three controls and zero candidate models", async () => {
    const calls: string[] = [];
    const headersSeen: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.model);
      headersSeen.push(new Headers(init?.headers).get("x-omniroute-compression") ?? "");
      if (body.model === "auto/claude-opus") {
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: `${NONCE} CONTENT_OK` } }] }), {
          status: 200,
          headers: { "x-omniroute-provider": "nebius", "x-omniroute-model": "unexpected-model" },
        });
      }
      return new Response('{"error":{"code":"model_not_found"}}', { status: 404 });
    }) as typeof fetch;
    const plan = manifest();
    const collected = await collectLive(plan, "fixture-credential-never-logged", NONCE, { fetchImpl, executablePresence: { auggie: true } });
    expect(calls).toEqual(["nebius/temperance-probe-nonexistent", "auto/claude-opus", "nebius/temperance-probe-nonexistent"]);
    expect(calls.every((model) => !model.startsWith("aug/") && !model.startsWith("tllm/"))).toBe(true);
    expect(headersSeen).toEqual(["off", "off", "off"]);
    const receipt = createTelemetryReceipt({ manifest: plan, evidenceMode: "fixture", executablePresence: collected.executablePresence, observations: collected.observations, nonce: NONCE, manifestCanonicalBytes: canonicalManifestBytes(plan), probeSourceBytes: Buffer.from("fixture-source") });
    expect(receipt.requestCount).toBe(3);
    expect(receipt.requestCeiling).toBe(9);
    expect(receipt.controls.mismatch).toBe("UNEXPECTED_PINNING");
    expect(receipt.controlEvidenceCodes).toEqual({ pinBefore: ["expected_404"], mismatch: ["unexpected_attribution"], pinAfter: ["expected_404"] });
    expect(receipt.candidates.every((candidate) => candidate.outcome === "STRUCTURALLY_UNVERIFIABLE" && candidate.requestsAttempted === 0)).toBe(true);
    const receiptInput = { manifest: plan, evidenceMode: "fixture" as const, executablePresence: collected.executablePresence, nonce: NONCE, manifestCanonicalBytes: canonicalManifestBytes(plan), probeSourceBytes: Buffer.from("fixture-source") };
    expect(() => createTelemetryReceipt({ ...receiptInput, observations: [...collected.observations, collected.observations[0]] })).toThrow("observation_schedule_mismatch");
    expect(() => createTelemetryReceipt({ ...receiptInput, observations: collected.observations.filter((item) => item.kind !== "pin_after") })).toThrow("observation_control_missing_or_duplicate");
  });

  test("valid early controls retain the bounded serial candidate schedule", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.model);
      if (body.model === "auto/claude-opus") {
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: `${NONCE} CONTENT_OK` } }] }), {
          status: 200,
          headers: { "x-omniroute-provider": "nebius", "x-omniroute-model": "meta-llama/Llama-3.3-70B-Instruct" },
        });
      }
      if (body.model === "nebius/temperance-probe-nonexistent") return new Response('{"error":{"code":"model_not_found"}}', { status: 404 });
      return new Response('{"error":{"code":"insufficient_quota"}}', { status: 403 });
    }) as typeof fetch;
    const plan = manifest();
    const collected = await collectLive(plan, "fixture-credential-never-logged", NONCE, { fetchImpl, executablePresence: { auggie: false } });
    expect(calls).toEqual([
      "nebius/temperance-probe-nonexistent",
      "auto/claude-opus",
      "tllm/CLAUDE_4_6_OPUS",
      "tllm/CLAUDE_4_6_OPUS",
      "tllm/claude_opus_4",
      "tllm/claude_opus_4",
      "nebius/temperance-probe-nonexistent",
    ]);
    const receipt = createTelemetryReceipt({ manifest: plan, evidenceMode: "fixture", executablePresence: collected.executablePresence, observations: collected.observations, nonce: NONCE, manifestCanonicalBytes: canonicalManifestBytes(plan), probeSourceBytes: Buffer.from("fixture-source") });
    expect(receipt.requestCount).toBe(7);
    expect(receipt.requestCeiling).toBe(9);
    expect(receipt.candidates.find((candidate) => candidate.candidateId === "aug-claude-opus-4-6")?.outcome).toBe("ENV_UNAVAILABLE");
    expect(receipt.candidates.filter((candidate) => candidate.candidateId.startsWith("tllm-")).every((candidate) => candidate.outcome === "QUOTA_BLOCKED")).toBe(true);
  });

  test("accepts serial 404 controls and records Auggie absence without inference calls", () => {
    const receipt = makeReceipt(passingControls());
    expect(receipt.controls).toEqual({ pinBefore: "EXPECTED", mismatch: "EXPECTED", pinAfter: "EXPECTED" });
    expect(receipt.controlEvidenceCodes).toEqual({ pinBefore: ["expected_404"], mismatch: ["expected_mismatch"], pinAfter: ["expected_404"] });
    expect(CONTROL_EVIDENCE_CODES).toEqual(["expected_404", "transport_timeout", "transport_network", "unexpected_status", "invalid_response_shape", "nonce_missing", "value_missing", "attribution_missing", "unexpected_attribution", "expected_mismatch"]);
    const aug = receipt.candidates.find((item) => item.candidateId === "aug-claude-opus-4-6")!;
    expect(aug.outcome).toBe("ENV_UNAVAILABLE");
    expect(aug.requestsAttempted).toBe(0);
    expect(receipt.requestCount).toBe(7);
  });

  test("classifies only typed 403 insufficient_quota as QUOTA_BLOCKED", () => {
    const quota = passingControls();
    for (const item of quota.filter((entry) => entry.candidateId === "tllm-claude-4-6-opus")) Object.assign(item, { httpStatus: 403, typedErrorCode: "insufficient_quota" });
    expect(makeReceipt(quota).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("QUOTA_BLOCKED");
    const generic = passingControls();
    for (const item of generic.filter((entry) => entry.candidateId === "tllm-claude-4-6-opus")) Object.assign(item, { httpStatus: 403, typedErrorCode: null, responseShape: "invalid" });
    expect(makeReceipt(generic).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("TRANSPORT_FAIL");
  });

  test("FALSIFIED requires explicit serving attribution contradiction", () => {
    const values = passingControls({
      "tllm-claude-4-6-opus:content": { observedProvider: "nebius", observedModel: "meta-llama/Llama-3.3-70B-Instruct" },
      "tllm-claude-4-6-opus:tool": { observedProvider: "nebius", observedModel: "meta-llama/Llama-3.3-70B-Instruct" },
    });
    expect(makeReceipt(values).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("FALSIFIED");
    const noAttribution = passingControls();
    expect(makeReceipt(noAttribution).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("PINNING_UNVERIFIED");
  });

  test("dual exact content and inert-tool agreement remains CONSISTENT_UNPROVEN", () => {
    const receipt = makeReceipt(passingControls(candidateExact("tllm-claude-4-6-opus")));
    expect(receipt.candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("CONSISTENT_UNPROVEN");
    expect(receipt.doesNotEstablish).toEqual(["identity", "readiness", "authorization", "promotion"]);
    expect(receipt.integrityScope).toBe("unauthenticated_local_telemetry");
    expect(Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt)).toBe(300_000);
  });

  test.each([
    ["missing nonce", { noncePresent: false }],
    ["refusal", { refusalPresent: true }],
    ["truncation", { finishReason: "length" as const }],
    ["normalization", { normalized: false }],
    ["tool disagreement", { valuePresent: false }],
  ])("%s can never cause FALSIFIED", (_label, mutation) => {
    const exact = candidateExact("tllm-claude-4-6-opus");
    exact["tllm-claude-4-6-opus:tool"] = { ...exact["tllm-claude-4-6-opus:tool"], ...mutation };
    const outcome = makeReceipt(passingControls(exact)).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome;
    expect(outcome).toBe("STRUCTURALLY_UNVERIFIABLE");
    expect(outcome).not.toBe("FALSIFIED");
  });

  test("unexpected controls void all candidate interpretation", () => {
    const pinning = passingControls(candidateExact("tllm-claude-4-6-opus"));
    Object.assign(pinning.find((item) => item.kind === "pin_before")!, { httpStatus: 200, observedProvider: "nebius", observedModel: "some-model" });
    const pinReceipt = makeReceipt(pinning);
    expect(pinReceipt.controls.pinBefore).toBe("UNEXPECTED_PINNING");
    expect(pinReceipt.candidates.every((item) => item.outcome === "PINNING_UNVERIFIED")).toBe(true);
    const structural = passingControls({
      "tllm-claude-4-6-opus:content": { observedProvider: "nebius", observedModel: "meta-llama/Llama-3.3-70B-Instruct" },
      "tllm-claude-4-6-opus:tool": { observedProvider: "nebius", observedModel: "meta-llama/Llama-3.3-70B-Instruct" },
    });
    expect(makeReceipt(structural).candidates.find((item) => item.candidateId === "tllm-claude-4-6-opus")?.outcome).toBe("FALSIFIED");
    Object.assign(structural.find((item) => item.kind === "pin_after")!, { httpStatus: 500 });
    const structuralReceipt = makeReceipt(structural);
    expect(structuralReceipt.controls.pinAfter).toBe("UNEXPECTED_STRUCTURE");
    expect(structuralReceipt.candidates.every((item) => item.outcome === "STRUCTURALLY_UNVERIFIABLE")).toBe(true);
    expect(structuralReceipt.candidates.some((item) => item.outcome === "FALSIFIED")).toBe(false);
    expect(structuralReceipt.controlEvidenceCodes.pinAfter).toEqual(["unexpected_status"]);
  });

  test("control diagnostics remain allowlisted for structural transport and shape failures", () => {
    const timeout = passingControls();
    Object.assign(timeout.find((item) => item.kind === "mismatch")!, { transport: "timeout", httpStatus: null, responseShape: "invalid", noncePresent: false, valuePresent: false, observedProvider: null, observedModel: null });
    const timeoutReceipt = makeReceipt(timeout);
    expect(timeoutReceipt.controls.mismatch).toBe("UNEXPECTED_STRUCTURE");
    expect(timeoutReceipt.controlEvidenceCodes.mismatch).toEqual(["transport_timeout"]);
    const shape = passingControls();
    Object.assign(shape.find((item) => item.kind === "mismatch")!, { responseShape: "invalid", noncePresent: false, valuePresent: false, observedProvider: null, observedModel: null });
    const shapeReceipt = makeReceipt(shape);
    expect(shapeReceipt.controls.mismatch).toBe("UNEXPECTED_STRUCTURE");
    expect(shapeReceipt.controlEvidenceCodes.mismatch).toEqual(["invalid_response_shape", "nonce_missing", "value_missing", "attribution_missing"]);
    expect(shapeReceipt.controlEvidenceCodes.mismatch.every((code) => CONTROL_EVIDENCE_CODES.includes(code))).toBe(true);
  });

  test("sanitizer allowlists attribution, typed quota, nonce, and tool evidence only", () => {
    const entry = buildProbeSchedule(manifest(), { auggie: true }).find((item) => item.kind === "candidate" && item.probe === "tool")!;
    const headers = new Headers({ "x-omniroute-provider": "auggie", "x-omniroute-model": "claude-opus-4.6" });
    const raw = JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ function: { name: "te_probe_noop", arguments: JSON.stringify({ nonce: NONCE, value: "TOOL_OK", credential: "must-not-survive" }) } }] } }], vendor_error: "must-not-survive" });
    const sanitized = sanitizeHttpObservation(entry, 200, headers, raw, NONCE);
    expect(sanitized).toMatchObject({ observedProvider: "auggie", observedModel: "claude-opus-4.6", noncePresent: true, valuePresent: true, toolNameValid: true });
    expect(JSON.stringify(sanitized)).not.toContain("must-not-survive");
    const quota = sanitizeHttpObservation(entry, 403, new Headers(), '{"error":{"code":"insufficient_quota","message":"secret vendor body"}}', NONCE);
    expect(quota.typedErrorCode).toBe("insufficient_quota");
    expect(JSON.stringify(quota)).not.toContain("secret vendor body");
    const generic = sanitizeHttpObservation(entry, 403, new Headers(), "not-json-secret", NONCE);
    expect(generic.typedErrorCode).toBeNull();
    expect(JSON.stringify(generic)).not.toContain("not-json-secret");
  });
});

describe("credential and receipt filesystem boundaries", () => {
  test("accepts only owner 0600 or the exact protected root-service metadata pattern", () => {
    const directory = { uid: 0, gid: 988, mode: 0o40750, isDirectory: () => true, isSymbolicLink: () => false };
    expect(credentialMetadataAccepted({ uid: 501, gid: 20, mode: 0o100600 }, directory, 501)).toBe(true);
    expect(credentialMetadataAccepted({ uid: 0, gid: 988, mode: 0o100640 }, directory, 501)).toBe(true);
    expect(credentialMetadataAccepted({ uid: 0, gid: 988, mode: 0o100644 }, directory, 501)).toBe(false);
    expect(credentialMetadataAccepted({ uid: 0, gid: 988, mode: 0o100640 }, { ...directory, mode: 0o40755 }, 501)).toBe(false);
    expect(credentialMetadataAccepted({ uid: 0, gid: 0, mode: 0o100640 }, { ...directory, gid: 0 }, 501)).toBe(false);
  });

  test("reads an owner-only external regular key without emitting it", () => {
    const root = tempRoot("temperance-s-key-");
    const key = join(root, "key");
    const secret = "fixture-secret-0123456789";
    writeFileSync(key, `${secret}\n`, { mode: 0o600 });
    chmodSync(key, 0o600);
    expect(readStrictCredential(key, ROOT)).toBe(secret);
    chmodSync(key, 0o640);
    expect(() => readStrictCredential(key, ROOT)).toThrow("credential_file_not_strict");
  });

  test("rejects final symlinks and canonical paths that resolve inside the repository", () => {
    const root = tempRoot("temperance-s-key-link-");
    const key = join(root, "key");
    writeFileSync(key, "fixture-secret-0123456789\n", { mode: 0o600 });
    const finalLink = join(root, "key-link");
    symlinkSync(key, finalLink);
    expect(() => readStrictCredential(finalLink, ROOT)).toThrow("credential_file_not_strict");
    const parentLink = join(root, "repository-link");
    symlinkSync(ROOT, parentLink);
    expect(() => readStrictCredential(join(parentLink, "package/router/omniroute-s-tier-candidates.ec2.json"), ROOT)).toThrow("credential_path_inside_code_boundary");
  });

  test("writes exact 0600 into a private directory and rejects collision, symlink, and broad mode", () => {
    const root = tempRoot("temperance-s-receipt-");
    const receipt = makeReceipt(passingControls());
    const path = join(root, "private", "receipt.json");
    writePrivateReceipt(path, receipt);
    expect(lstatSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(() => writePrivateReceipt(path, receipt)).toThrow("receipt_exclusive_write_failed");
    const symlinkDir = join(root, "symlink-private");
    mkdirSync(symlinkDir, { mode: 0o700 });
    const symlink = join(symlinkDir, "receipt.json");
    symlinkSync(path, symlink);
    expect(() => writePrivateReceipt(symlink, receipt)).toThrow("receipt_exclusive_write_failed");
    const broad = join(root, "broad");
    mkdirSync(broad, { mode: 0o755 });
    chmodSync(broad, 0o755);
    expect(() => writePrivateReceipt(join(broad, "receipt.json"), receipt)).toThrow("receipt_directory_not_private");
  });
});

describe("fixture CLI and source isolation", () => {
  test("runtime context keeps root fail-closed and recognizes the source layout", () => {
    expect(pathWithin("/etc/hermes/key", "/")).toBe(true);
    expect(pathWithin("/tmp/a", "/tmp/a")).toBe(true);
    expect(pathWithin("/tmp/ab", "/tmp/a")).toBe(false);
    const runtime = resolveRuntimeContext(SCRIPT);
    expect(runtime).toMatchObject({ entryPath: SCRIPT, codeBoundary: ROOT, defaultManifestPath: MANIFEST_PATH, layout: "source-tree" });
  });

  test("fixture schema rejects live-mode claims and malformed observations", () => {
    const values: any = { schema_version: 1, kind: "temperance.omniroute-s-tier-fixture", executable_presence: { auggie: false }, observations: passingControls() };
    expect(parseFixtureEvidence(values).observations).toHaveLength(7);
    expect(() => parseFixtureEvidence({ ...values, evidenceMode: "live" })).toThrow("fixture_keys_invalid");
    const malformed = structuredClone(values);
    malformed.observations[0].rawBody = "forbidden";
    expect(() => parseFixtureEvidence(malformed)).toThrow("fixture_observation_keys_invalid");
    const fakeQuota = structuredClone(values);
    Object.assign(fakeQuota.observations[2], { httpStatus: 200, typedErrorCode: "insufficient_quota" });
    expect(() => parseFixtureEvidence(fakeQuota)).toThrow("fixture_observation_quota_binding_invalid");
  });

  test("fixture output cannot masquerade as live and completed PINNING_UNVERIFIED exits zero", () => {
    const root = tempRoot("temperance-s-cli-pin-");
    const fixture = writeFixture(root, passingControls());
    const output = join(root, "receipts", "receipt.json");
    const result = spawnSync("bun", [SCRIPT, "--fixture", fixture, "--output", output], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ telemetryCompleted: true, evidenceMode: "fixture", receiptWritten: true });
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    expect(receipt.evidenceMode).toBe("fixture");
    expect(receipt.candidates.some((item: any) => item.outcome === "PINNING_UNVERIFIED")).toBe(true);
    expect(lstatSync(output).mode & 0o777).toBe(0o600);
  });

  test("completed typed quota telemetry exits zero", () => {
    const root = tempRoot("temperance-s-cli-quota-");
    const values = passingControls();
    for (const item of values.filter((entry) => entry.candidateId?.startsWith("tllm-"))) Object.assign(item, { httpStatus: 403, typedErrorCode: "insufficient_quota" });
    const fixture = writeFixture(root, values);
    const output = join(root, "receipts", "receipt.json");
    const result = spawnSync("bun", [SCRIPT, "--fixture", fixture, "--output", output], { cwd: ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).candidates.filter((item: any) => item.candidateId.startsWith("tllm-")).every((item: any) => item.outcome === "QUOTA_BLOCKED")).toBe(true);
  });

  test("production bundle executes a fixture and hashes its exact regular entry", () => {
    const root = tempRoot("temperance-s-bundle-");
    const bin = join(root, "bin");
    mkdirSync(bin, { mode: 0o700 });
    const bundle = join(bin, "omniroute-s-tier-readiness.js");
    const build = spawnSync("bun", ["build", "--target=bun", SCRIPT, "--outfile", bundle], { cwd: ROOT, encoding: "utf8" });
    expect(build.status).toBe(0);
    const fixture = writeFixture(root, passingControls());
    const output = join(root, "receipts", "bundle-receipt.json");
    const run = spawnSync("bun", [bundle, "--fixture", fixture, "--manifest", MANIFEST_PATH, "--output", output], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual({ telemetryCompleted: true, evidenceMode: "fixture", receiptWritten: true });
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    expect(receipt.evidenceMode).toBe("fixture");
    expect(receipt.probeSourceSha256).toBe(sha256(readFileSync(bundle)));
  });

  test("default invocation never probes and live mode requires a protected key file", () => {
    const none = spawnSync("bun", [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("mode_required");
    const live = spawnSync("bun", [SCRIPT, "--live", "--output", join(tempRoot("temperance-s-no-key-"), "out", "receipt.json")], { cwd: ROOT, encoding: "utf8" });
    expect(live.status).toBe(2);
    expect(live.stderr).toContain("live_arguments_invalid");
  });

  test("receipt hashes canonical manifest and probe source without raw evidence", () => {
    const receipt = makeReceipt(passingControls());
    expect(receipt.manifestCanonicalSha256).toBe(sha256(canonicalManifestBytes(manifest())));
    expect(receipt.probeSourceSha256).toBe(sha256(Buffer.from("fixture-probe-source")));
    expect(receipt.nonceSha256).toBe(sha256(NONCE));
    const serialized = JSON.stringify(receipt);
    for (const forbidden of ["rawBody", "rawError", "credential", "environment", "requestBody", "vendor_error"]) expect(serialized).not.toContain(forbidden);
  });

  test("production surfaces have no consumer or mutation path", () => {
    const productionFiles = [MANIFEST_PATH, join(ROOT, "package/router/omniroute-s-tier-readiness.ts"), SCRIPT];
    const source = productionFiles.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const forbidden of ["TEMPERANCE_AUTO_READY", "cloudflared", "Cloudflare", "Hermes", "A2A", "child_process", "spawn(", "exec(", "method: \"PUT\"", "method: \"PATCH\"", "method: \"DELETE\""]) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/process\.env\.(?:OMNIROUTE_API_KEY|ROUTER_API_KEY|API_KEY)/u);
    const otherProduction = [...walkFiles(join(ROOT, "package")), ...walkFiles(join(ROOT, "scripts"))]
      .filter((path) => /\.(?:ts|sh)$/u.test(path))
      .filter((path) => !productionFiles.includes(path) && path !== import.meta.path && path !== join(ROOT, "scripts/verify-all.sh") && !path.endsWith(".test.ts"));
    const consumers = otherProduction.filter((path) => readFileSync(path, "utf8").includes("omniroute-s-tier-readiness"));
    expect(consumers).toEqual([]);
  });
});
