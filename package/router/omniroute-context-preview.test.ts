import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CONTEXT_PREVIEW_CANDIDATES,
  CONTEXT_PREVIEW_HELD_ENGINES,
  CONTEXT_WRAPPER_MARKERS,
  OMNIROUTE_CONTEXT_PREVIEW_ENDPOINT,
  SYNTHETIC_CONTEXT_FIXTURES,
  buildContextPreviewRequests,
  runContextPreviewQualification,
  syntheticPreviewOriginal,
  validatePreviewPayload,
  type CandidateRequest,
  type ContextPreviewReceipt,
  type PreviewFetch,
} from "./omniroute-context-preview";

const roots: string[] = [];
const NOW = new Date("2026-08-02T05:00:00.000Z");

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "temperance-context-preview-")));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function nativeSnapshot(): Record<string, unknown> {
  return {
    schema: "temperance.omniroute.native-control-plane.v1",
    mode: "read-only-local-snapshot",
    collectedAt: "2026-08-02T04:59:59.000Z",
    expiresAt: "2026-08-02T05:00:20.000Z",
    fresh: true,
    promotionAuthorized: false,
    mutationMethods: [],
    evidence: {
      installedVersion: "3.8.48",
      runtime: {
        pid: 17555,
        startedHash: "a".repeat(64),
        listener: "127.0.0.1:20128",
        version: "3.8.48",
        packageIdentityHash: "b".repeat(64),
        databaseBindingHash: "c".repeat(64),
      },
      database: {
        mode: 384,
        links: 1,
        size: 4096,
        schemaVersion: "1",
        dataVersion: 2,
        journalMode: "wal",
      },
    },
    layers: {
      policy: {
        compression: {
          masterEnabled: false,
          defaultMode: "off",
          preserveSystemPrompt: true,
          activeComboId: null,
          activeComboResolves: false,
          candidateEngines: ["caveman"],
          configuredPipeline: [
            { engine: "rtk", intensity: "standard" },
            { engine: "caveman", intensity: "full" },
          ],
          effectivePipeline: "off",
          adoption: "preview-only",
        },
        dispatch: {
          portfolio: "te-dispatch",
          strategy: "round-robin",
          maxParallel: 4,
          solFree: true,
        },
        contextSources: "client-pointer-catalog",
        customSystemPrompt: "off",
      },
      execution: {
        hermes: {
          localStatePresent: false,
          adoption: "proposal-only",
          protectedEc2State: "not-probed",
        },
      },
      authority: {
        cloudflare: {
          quickTunnel: "stopped",
          publicUrlPresent: false,
          cloudflaredProcessesPresent: false,
          namedTunnelPromotion: "external-authority-gated",
        },
      },
    },
  };
}

function validPayload(candidate: CandidateRequest, compressed = syntheticPreviewOriginal()): Record<string, unknown> {
  return {
    encoderComparison: candidate.candidate === "headroom" ? { winner: "json" } : null,
    original: syntheticPreviewOriginal(),
    compressed,
    originalTokens: 100,
    compressedTokens: 100,
    tokensSaved: 0,
    savingsPct: 0,
    techniquesUsed: [],
    engineBreakdown: [],
    riskGate: null,
    quantumLock: null,
    durationMs: 1,
    mode: candidate.expectedMode,
    intensity: null,
    outputMode: null,
    skippedReasons: [],
    diff: [],
    preservedBlocks: [],
    ruleRemovals: [],
    rulesApplied: [],
    validation: { valid: true, errors: [], warnings: [], fallbackApplied: false },
    validationWarnings: [],
    validationErrors: [],
    fallbackApplied: false,
    fallbackReason: null,
    fallbackReasons: [],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CapturedRun {
  root: string;
  receipts: ContextPreviewReceipt[];
  calls: Array<{ url: string; init: RequestInit }>;
}

function captureHarness(fetchImpl: PreviewFetch, snapshots?: readonly unknown[]): CapturedRun & {
  options: Parameters<typeof runContextPreviewQualification>[0];
} {
  const root = makeRoot();
  const receipts: ContextPreviewReceipt[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const states = [...(snapshots ?? [nativeSnapshot(), nativeSnapshot()])];
  const wrappedFetch: PreviewFetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  return {
    root,
    receipts,
    calls,
    options: {
      receiptRoot: root,
      hooks: {
        fetchImpl: wrappedFetch,
        statusProbe: () => {
          if (states.length === 0) throw new Error("unexpected_status_probe");
          return states.shift();
        },
        receiptWriter: (_receiptRoot, receipt) => {
          receipts.push(receipt);
          return join(root, "captured-receipt.json");
        },
        now: () => NOW,
      },
    },
  };
}

function candidatesFetch(): PreviewFetch {
  let index = 0;
  const requests = buildContextPreviewRequests();
  return async () => jsonResponse(validPayload(requests[index++]));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OmniRoute context preview request contract", () => {
  test("builds the exact ordered allowlist and hardened request configurations", () => {
    const requests = buildContextPreviewRequests();
    expect(requests.map(({ candidate }) => candidate)).toEqual([...CONTEXT_PREVIEW_CANDIDATES]);
    expect(requests[0].request).toEqual({
      mode: "lite",
      messages: SYNTHETIC_CONTEXT_FIXTURES.map(({ role, content }) => ({ role, content })),
    });
    expect(requests[1].request).toEqual({
      engineId: "headroom",
      messages: SYNTHETIC_CONTEXT_FIXTURES.map(({ role, content }) => ({ role, content })),
    });
    expect(requests[2].request).toEqual({
      mode: "rtk",
      messages: SYNTHETIC_CONTEXT_FIXTURES.map(({ role, content }) => ({ role, content })),
      config: {
        rtkConfig: {
          intensity: "minimal",
          enabled: true,
          applyToToolResults: true,
          applyToAssistantMessages: false,
          rawOutputRetention: "never",
          customFiltersEnabled: false,
          trustProjectFilters: false,
          applyToCodeBlocks: false,
          stripCodeComments: false,
          preserveDocstrings: true,
        },
      },
    });
    expect(CONTEXT_PREVIEW_HELD_ENGINES).toEqual([
      "session-dedup",
      "ccr",
      "relevance",
      "caveman",
      "aggressive",
      "ultra",
      "llmlingua",
      "omniglyph",
    ]);
  });

  test("validates the exact synthetic candidate matrix without credential transport", () => {
    for (const candidate of buildContextPreviewRequests()) {
      const validation = validatePreviewPayload(validPayload(candidate), candidate);
      expect(validation.reasons).toEqual([]);
      expect(validation.observedMode).toBe(candidate.expectedMode);
      expect(validation.criticalOrderPreserved).toBe(true);
      expect(validation.stageOrderPreserved).toBe(true);
    }
  });
});

describe("semantic marker and response validation", () => {
  const candidate = buildContextPreviewRequests()[0];

  test("holds missing, duplicate, exchanged, and stage-order markers", () => {
    const original = syntheticPreviewOriginal();
    const missing = validatePreviewPayload(
      validPayload(candidate, original.replace("ISA_ID=ISC-572", "")),
      candidate,
    );
    expect(missing.reasons).toContain("marker_missing");

    const duplicate = validatePreviewPayload(
      validPayload(candidate, `${original}\nISA_ID=ISC-572`),
      candidate,
    );
    expect(duplicate.reasons).toContain("marker_duplicated");

    const exchangedText = original
      .replace("GSD_STATUS=verification_pending\nISA_ID=ISC-572", "ISA_ID=ISC-572\nGSD_STATUS=verification_pending");
    const exchanged = validatePreviewPayload(validPayload(candidate, exchangedText), candidate);
    expect(exchanged.reasons).toContain("critical_order_drift");
    expect(exchanged.reasons).not.toContain("marker_missing");

    const stageText = original
      .replace("PAI_STAGE_02=think\nPAI_STAGE_03=plan", "PAI_STAGE_03=plan\nPAI_STAGE_02=think");
    const stage = validatePreviewPayload(validPayload(candidate, stageText), candidate);
    expect(stage.reasons).toContain("stage_order_drift");
  });

  test("holds fallback, invalid validation, malformed metrics, and missing fields", () => {
    const fallback = validPayload(candidate);
    fallback.fallbackApplied = true;
    fallback.fallbackReason = "compression-fallback";
    expect(validatePreviewPayload(fallback, candidate).reasons).toContain("fallback_applied");

    const invalid = validPayload(candidate);
    invalid.validation = { valid: false, errors: ["canary"], warnings: [], fallbackApplied: false };
    invalid.validationErrors = ["canary"];
    expect(validatePreviewPayload(invalid, candidate).reasons).toContain("validation_invalid");

    const metrics = validPayload(candidate);
    metrics.tokensSaved = 1;
    expect(validatePreviewPayload(metrics, candidate).reasons).toContain("token_metrics_invalid");

    const missing = validPayload(candidate);
    delete missing.diff;
    expect(validatePreviewPayload(missing, candidate).reasons).toContain("response_fields_missing");
  });
});

describe("temperance-context wrapper fixture-parity (design doc 2026-08-02 §2 acceptance gate)", () => {
  const candidate = buildContextPreviewRequests()[0];

  test("wrapper markers are declared open, inner, close, in that order", () => {
    expect(CONTEXT_WRAPPER_MARKERS.map(({ id }) => id)).toEqual([
      "temperance-context-open",
      "temperance-context-inner",
      "temperance-context-close",
    ]);
    expect(CONTEXT_WRAPPER_MARKERS.map(({ value }) => value)).toEqual([
      "<temperance-context>",
      "TEMPERANCE_CONTEXT_INNER_CANARY=PRESERVE_WRAPPER_BOUNDARY",
      "</temperance-context>",
    ]);
  });

  test("the wrapper fixture is included in every candidate request", () => {
    for (const request of buildContextPreviewRequests()) {
      const wrapperMessage = request.request.messages.find((message) =>
        message.content.includes("<temperance-context>"),
      );
      expect(wrapperMessage).toBeDefined();
      expect(wrapperMessage?.content).toBe(
        "<temperance-context>\nTEMPERANCE_CONTEXT_INNER_CANARY=PRESERVE_WRAPPER_BOUNDARY\n</temperance-context>",
      );
    }
  });

  test("an unmodified echo preserves the wrapper", () => {
    const validation = validatePreviewPayload(validPayload(candidate), candidate);
    expect(validation.contextWrapperOrderPreserved).toBe(true);
    expect(validation.reasons).not.toContain("context_wrapper_order_drift");
  });

  test("holds when the engine strips the opening tag", () => {
    const original = syntheticPreviewOriginal();
    const stripped = original.replace("<temperance-context>\n", "");
    const validation = validatePreviewPayload(validPayload(candidate, stripped), candidate);
    expect(validation.contextWrapperOrderPreserved).toBe(false);
    expect(validation.reasons).toContain("context_wrapper_order_drift");
    expect(validation.reasons).toContain("marker_missing");
  });

  test("holds when the engine duplicates the closing tag", () => {
    const original = syntheticPreviewOriginal();
    const duplicated = `${original}\n</temperance-context>`;
    const validation = validatePreviewPayload(validPayload(candidate, duplicated), candidate);
    expect(validation.contextWrapperOrderPreserved).toBe(false);
    expect(validation.reasons).toContain("context_wrapper_order_drift");
    expect(validation.reasons).toContain("marker_duplicated");
  });

  test("holds when the engine reorders the tag pair (e.g. hoists the close tag)", () => {
    const original = syntheticPreviewOriginal();
    const reordered = original.replace(
      "<temperance-context>\nTEMPERANCE_CONTEXT_INNER_CANARY=PRESERVE_WRAPPER_BOUNDARY\n</temperance-context>",
      "</temperance-context>\nTEMPERANCE_CONTEXT_INNER_CANARY=PRESERVE_WRAPPER_BOUNDARY\n<temperance-context>",
    );
    const validation = validatePreviewPayload(validPayload(candidate, reordered), candidate);
    expect(validation.contextWrapperOrderPreserved).toBe(false);
    expect(validation.reasons).toContain("context_wrapper_order_drift");
    expect(validation.reasons).not.toContain("marker_missing");
    expect(validation.reasons).not.toContain("marker_duplicated");
  });

  test("wrapper fixture content never appears in a written receipt", async () => {
    const root = makeRoot();
    const receiptRoot = join(root, "receipts");
    const result = await runContextPreviewQualification({
      receiptRoot,
      hooks: {
        fetchImpl: async () => new Response(null, { status: 401 }),
        statusProbe: () => nativeSnapshot(),
        now: () => NOW,
      },
    });
    const source = readFileSync(result.receiptPath, "utf8");
    expect(source).not.toContain("<temperance-context>");
    expect(source).not.toContain("TEMPERANCE_CONTEXT_INNER_CANARY");
  });
});

describe("malformed semantic evidence", () => {
  test("holds missing and null arrays without throwing", () => {
    const candidate = buildContextPreviewRequests()[0];
    const missing = validPayload(candidate);
    delete missing.validationErrors;
    const missingResult = validatePreviewPayload(missing, candidate);
    expect(missingResult.reasons).toContain("response_fields_missing");
    expect(missingResult.reasons).toContain("response_fields_invalid");

    const nullable = validPayload(candidate);
    nullable.validationErrors = null;
    nullable.fallbackReasons = null;
    const nullableResult = validatePreviewPayload(nullable, candidate);
    expect(nullableResult.reasons).toContain("response_fields_invalid");
  });
});

describe("anonymous denial boundary", () => {
  test("sends one minimal anonymous canary, compares status twice, and holds as auth required", async () => {
    let statusCalls = 0;
    const harness = captureHarness(async () => new Response(null, { status: 401 }));
    harness.options.hooks!.statusProbe = () => {
      statusCalls += 1;
      return nativeSnapshot();
    };
    const result = await runContextPreviewQualification(harness.options);
    expect(result.result).toBe("held");
    expect(statusCalls).toBe(2);
    expect(harness.calls).toHaveLength(1);
    const call = harness.calls[0];
    expect(new Headers(call.init.headers).has("authorization")).toBe(false);
    const request = JSON.parse(String(call.init.body));
    expect(request).toEqual({
      mode: "lite",
      messages: [{ role: "user", content: "OMNIROUTE_ANONYMOUS_PREVIEW_CANARY_V1" }],
    });
    expect(JSON.stringify(request)).not.toContain(SYNTHETIC_CONTEXT_FIXTURES[0].content);
    expect(result.receipt.anonymousProbe).toMatchObject({ denialObserved: true, observation: "auth_required" });
    expect(result.receipt.authState).toBe("anonymous_denied");
    expect(result.receipt.nativeInvariants.equal).toBe(true);
    expect(result.receipt.candidates.every(({ reasons }) => reasons.includes("auth_required"))).toBe(true);
  });

  test("never qualifies unexpected anonymous success", async () => {
    const harness = captureHarness(async () => jsonResponse({ unexpectedly: "open" }));
    const result = await runContextPreviewQualification(harness.options);
    expect(result.result).toBe("held");
    expect(result.receipt.anonymousProbe).toMatchObject({
      denialObserved: false,
      observation: "anonymous_denial_not_observed",
    });
    expect(
      result.receipt.candidates.every(({ reasons }) => reasons.includes("anonymous_denial_not_observed")),
    ).toBe(true);
    expect(result.receipt.authState).toBe("anonymous_not_denied");
  });

  test("does not read or await an unexpected response body", async () => {
    let cancelCalls = 0;
    const stalled = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalls += 1;
        return new Promise<void>(() => undefined);
      },
    });
    const harness = captureHarness(async () => new Response(stalled, { status: 200 }));
    const result = await Promise.race([
      runContextPreviewQualification(harness.options),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("body_stall")), 250)),
    ]);
    expect(result.result).toBe("held");
    expect(result.receipt.authState).toBe("anonymous_not_denied");
    expect(cancelCalls).toBe(1);
  });
});

describe("native invariant guard", () => {
  test("turns otherwise valid candidates into held decisions on exact projection drift", async () => {
    const before = nativeSnapshot();
    const after = structuredClone(before);
    const policy = ((after.layers as Record<string, unknown>).policy as Record<string, unknown>);
    const compression = policy.compression as Record<string, unknown>;
    compression.masterEnabled = true;
    const harness = captureHarness(candidatesFetch(), [before, after]);
    const result = await runContextPreviewQualification(harness.options);
    expect(result.result).toBe("held");
    expect(result.receipt.nativeInvariants).toMatchObject({
      preValid: true,
      postValid: true,
      equal: false,
      changedFields: ["compression"],
    });
    expect(result.receipt.candidates.every(({ reasons }) => reasons.includes("native_invariant_changed"))).toBe(true);
  });

  test("does not send candidate previews when the pre-status snapshot is invalid", async () => {
    let statusCalls = 0;
    const harness = captureHarness(async () => {
      throw new Error("preview_must_not_run");
    });
    harness.options.hooks!.statusProbe = () => {
      statusCalls += 1;
      if (statusCalls === 1) throw new Error("synthetic_status_failure");
      return nativeSnapshot();
    };
    const result = await runContextPreviewQualification(harness.options);
    expect(harness.calls).toHaveLength(0);
    expect(statusCalls).toBe(2);
    expect(result.receipt.candidates.every(({ reasons }) => reasons.includes("pre_status_invalid"))).toBe(true);
  });
});

describe("private receipts", () => {
  test("writes a mode-0600 metadata-only receipt with no transient material", async () => {
    const root = makeRoot();
    const receiptRoot = join(root, "receipts");
    const result = await runContextPreviewQualification({
      receiptRoot,
      hooks: {
        fetchImpl: async () => new Response(null, { status: 401 }),
        statusProbe: () => nativeSnapshot(),
        now: () => NOW,
      },
    });
    const stat = statSync(result.receiptPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.nlink).toBe(1);
    const source = readFileSync(result.receiptPath, "utf8");
    const stored = JSON.parse(source);
    expect(stored.result).toBe("held");
    expect(stored.tokenSupplied).toBe(false);
    expect(stored.authState).toBe("anonymous_denied");
    for (const forbiddenKey of [
      "token",
      "tokenPath",
      "prompt",
      "original",
      "compressed",
      "diff",
      "body",
      "bodies",
      "content",
      "messages",
      "request",
      "response",
    ]) expect(source).not.toContain(`"${forbiddenKey}"`);
    expect(source).not.toContain("PAI_STAGE_01=observe");
    expect(source).not.toContain("OMNIROUTE_ANONYMOUS_PREVIEW_CANARY_V1");
    expect(stored.fixtures.every(({ sha256 }: { sha256: string }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
  });

  test("rejects unsafe root modes and symlink ancestors before creating receipts", async () => {
    const badMode = makeRoot();
    chmodSync(badMode, 0o755);
    const badModeHarness = captureHarness(candidatesFetch());
    badModeHarness.options.receiptRoot = badMode;
    await expect(runContextPreviewQualification(badModeHarness.options)).rejects.toMatchObject({
      code: "receipt_root_mode_invalid",
    });

    const root = makeRoot();
    const parent = join(root, "parent");
    const backing = join(root, "backing");
    const link = join(parent, "linked");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(parent, { mode: 0o700 });
    mkdirSync(backing, { mode: 0o700 });
    symlinkSync(backing, link);
    const symlinkHarness = captureHarness(candidatesFetch());
    symlinkHarness.options.receiptRoot = join(link, "receipts");
    await expect(runContextPreviewQualification(symlinkHarness.options)).rejects.toMatchObject({
      code: "receipt_root_not_real_directory",
    });
  });
});

describe("production surface confinement", () => {
  test("contains no mutation routes or alternate authorization surfaces", () => {
    const core = readFileSync(resolve(import.meta.dir, "omniroute-context-preview.ts"), "utf8");
    const cli = readFileSync(resolve(import.meta.dir, "../../scripts/omniroute-context-preview.ts"), "utf8");
    const production = `${core}\n${cli}`;
    const forbidden = [
      "/api/" + "settings",
      "/api/context/" + "combos",
      "/api/" + "providers",
      "dash" + "board/" + "login",
      "x-omniroute-" + "cli-token",
      "Bearer ",
      "oma_" + "live_",
      "--token-" + "file",
      "readStrict" + "PreviewToken",
      "coo" + "kie",
      "OMNIROUTE_" + "API_KEY",
      "OPENAI_" + "API_KEY",
      "ANTHROPIC_" + "API_KEY",
      "TODO",
      "FIXME",
      "XXX",
    ];
    for (const value of forbidden) expect(production).not.toContain(value);
    expect(production.match(/http:\/\/127\.0\.0\.1:20128\/api\/compression\/preview/gu)).toHaveLength(1);
  });
});
