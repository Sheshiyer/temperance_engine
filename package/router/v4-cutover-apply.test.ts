import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createV4CutoverReview,
  createV4ReplacementProof,
  type V4CutoverAdapter,
  type V4CutoverJournal,
  type V4CutoverReceipt,
} from "./v4-cutover-executor.ts";
import {
  LoopbackV4DoctorProbe,
  applyV4Cutover,
  type V4CutoverApplyBinding,
} from "./v4-cutover-apply.ts";
import {
  calculateV4CutoverPlanDigest,
  createV4CutoverPlan,
  type V4CutoverHostObservation,
} from "./v4-cutover-plan.ts";

const roots: string[] = [];
const NOW = new Date("2026-09-17T08:00:00.000Z");
const HOST: V4CutoverHostObservation = {
  platform: "darwin",
  hardware_model: "Mac16,11",
  chip_model: "Apple M4",
  architecture: "arm64",
  user_id: process.getuid?.() ?? 501,
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "temperance-v4-apply-"));
  roots.push(root);
  const home = join(root, "home");
  const plan = createV4CutoverPlan({
    homeDirectory: home,
    platform: "darwin",
    now: () => NOW,
    findBinary: () => null,
    readVersion: () => null,
    inspectPort: (port) => ({ port, owner: "free" }),
    observeHost: () => HOST,
  });
  const proof = createV4ReplacementProof({
    generated_at: NOW.toISOString(),
    temperance_revision: "a".repeat(40),
    temperance_tree: "b".repeat(40),
    router: { package: "9router", version: "0.5.75" },
    artifact_digest: `sha256:${"c".repeat(64)}`,
    verification: {
      install_surface: `sha256:${"d".repeat(64)}`,
      cutover_contract: `sha256:${"e".repeat(64)}`,
    },
  });
  const review = createV4CutoverReview(plan, proof);
  const binding: V4CutoverApplyBinding = {
    home_directory: home,
    source_repository: join(root, "source"),
    env_executable: join(root, "bin", "env"),
    node_executable: join(root, "bin", "node"),
    executable_path: `${join(root, "bin")}:/usr/bin:/bin`,
    bun_executable: join(root, "bin", "bun"),
    git_executable: join(root, "bin", "git"),
    tar_executable: join(root, "bin", "tar"),
    data_directory: join(home, ".9router"),
    log_directory: join(home, ".temperance_engine", "logs"),
    cli_entrypoint: join(home, ".temperance_engine", "providers", "9router", "node_modules", "9router", "cli.js"),
    health_url: "http://127.0.0.1:20128/v1/models",
    legacy_credential_reference_id: "LEGACY_OMNIROUTE_GATEWAY_KEY",
    legacy_credential_reference: {
      store: "macos-keychain",
      service: "legacy.gateway",
      account: "default",
    },
  };
  return {
    root,
    home,
    plan,
    proof,
    binding,
    confirmation: { confirmed: true as const, operation_digest: review.operation_digest, confirmed_at: NOW.toISOString() },
  };
}

function receipt(context: ReturnType<typeof fixture>): V4CutoverReceipt {
  return {
    schema: "temperance.v4-cutover-receipt.v1",
    version: { major: 1, minor: 0 },
    operation_id: "cutover-apply-fixture",
    operation_digest: context.confirmation.operation_digest,
    plan_digest: context.plan.plan_digest,
    proof_digest: context.proof.proof_digest,
    status: "committed",
    completed_action_ids: [],
    secret_reference_ids: [context.binding.legacy_credential_reference_id],
    redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"],
    recovery_status: "not-required",
    started_at: NOW.toISOString(),
    finished_at: NOW.toISOString(),
  };
}

describe("V4 cutover apply admission", () => {
  test("consumes the reviewed confirmation and exact private binding without manufacturing either", async () => {
    const context = fixture();
    let runtimeOptions: Parameters<NonNullable<Parameters<typeof applyV4Cutover>[1]["createRuntime"]>>[0] | undefined;
    let executeOptions: Parameters<NonNullable<Parameters<typeof applyV4Cutover>[1]["execute"]>>[0] | undefined;
    const result = await applyV4Cutover({
      plan: context.plan,
      proof: context.proof,
      confirmation: context.confirmation,
      binding: context.binding,
      operation_id: "cutover-apply-fixture",
    }, {
      observeHost: () => HOST,
      createPlan: () => structuredClone(context.plan),
      createRuntime: (options) => {
        runtimeOptions = options;
        return { adapter: {} as V4CutoverAdapter, journal: {} as V4CutoverJournal };
      },
      execute: async (options) => {
        executeOptions = options;
        expect(await options.reobserve()).toEqual(context.plan);
        return receipt(context);
      },
      fetch: async () => new Response(null, { status: 200 }),
      now: () => NOW,
    });
    expect(result.status).toBe("committed");
    expect(runtimeOptions?.legacyCredentialReferences).toEqual({
      LEGACY_OMNIROUTE_GATEWAY_KEY: context.binding.legacy_credential_reference,
    });
    expect(runtimeOptions?.nodeExecutable).toBe(context.binding.node_executable);
    expect(executeOptions?.confirmation).toEqual(context.confirmation);
    expect(executeOptions?.legacyCredentialReferenceId).toBe("LEGACY_OMNIROUTE_GATEWAY_KEY");
    expect(JSON.stringify(runtimeOptions)).not.toContain("api-key-value");
  });

  test("rejects host or runtime-binding drift before constructing the live runtime", async () => {
    const context = fixture();
    let constructed = false;
    const dependencies = {
      observeHost: () => ({ ...HOST, chip_model: "Apple M3" }),
      createRuntime: () => {
        constructed = true;
        return { adapter: {} as V4CutoverAdapter, journal: {} as V4CutoverJournal };
      },
    };
    await expect(applyV4Cutover({
      plan: context.plan,
      proof: context.proof,
      confirmation: context.confirmation,
      binding: context.binding,
    }, dependencies)).rejects.toThrow("CUTOVER_APPLY_HOST_DRIFTED");
    expect(constructed).toBe(false);

    await expect(applyV4Cutover({
      plan: context.plan,
      proof: context.proof,
      confirmation: context.confirmation,
      binding: { ...context.binding, data_directory: join(context.home, "foreign") },
    }, { ...dependencies, observeHost: () => HOST })).rejects.toThrow("CUTOVER_APPLY_RUNTIME_BINDING_DRIFTED");
    expect(constructed).toBe(false);
  });

  test("rejects a self-consistent reviewed plan outside the bound home scope", async () => {
    const context = fixture();
    const plan = structuredClone(context.plan);
    plan.paths[0]!.path = join(context.root, "foreign-runtime");
    plan.plan_digest = calculateV4CutoverPlanDigest(plan);
    const confirmation = {
      confirmed: true as const,
      operation_digest: createV4CutoverReview(plan, context.proof).operation_digest,
      confirmed_at: NOW.toISOString(),
    };
    let constructed = false;
    await expect(applyV4Cutover({
      plan,
      proof: context.proof,
      confirmation,
      binding: context.binding,
    }, {
      observeHost: () => HOST,
      createRuntime: () => {
        constructed = true;
        return { adapter: {} as V4CutoverAdapter, journal: {} as V4CutoverJournal };
      },
    })).rejects.toThrow("CUTOVER_APPLY_PLAN_SCOPE_DRIFTED");
    expect(constructed).toBe(false);
  });

  test("accepts only an unauthenticated loopback health probe", async () => {
    const context = fixture();
    expect(() => new LoopbackV4DoctorProbe("https://router.example/health", context.binding.data_directory))
      .toThrow("CUTOVER_DOCTOR_HEALTH_URL_INVALID");
    expect(() => new LoopbackV4DoctorProbe("http://user:pass@127.0.0.1:20128/health", context.binding.data_directory))
      .toThrow("CUTOVER_DOCTOR_HEALTH_URL_INVALID");
    const requests: Array<{ input: string; method?: string; redirect?: string }> = [];
    const probe = new LoopbackV4DoctorProbe(
      context.binding.health_url,
      context.binding.data_directory,
      async (input, init) => {
        requests.push({ input: String(input), method: init?.method, redirect: init?.redirect });
        return new Response(null, { status: 204 });
      },
    );
    const serviceInput = {
      node_executable: context.binding.node_executable,
      cli_entrypoint: context.binding.cli_entrypoint,
      data_directory: context.binding.data_directory,
      log_directory: context.binding.log_directory,
      path: context.binding.executable_path,
    };
    expect(await probe.run(serviceInput, new AbortController().signal)).toBe(true);
    expect(requests).toEqual([{ input: context.binding.health_url, method: "HEAD", redirect: "error" }]);
    expect(await probe.run({ ...serviceInput, data_directory: join(context.home, "other") }, new AbortController().signal)).toBe(false);
  });
});
