// Test-only runner, copied into a disposable cwd. Every product import resolves
// through the verified installed allowlist; this is not the bridge CLI/pg graph.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { plugin } from "bun";
import { mock } from "bun:test";
import * as originalFs from "node:fs";
import { isAbsolute, relative } from "node:path";

const root = process.cwd();
// Guards delegate to real filesystem operations, confined to this child tree.
// They make an accidental default host path a failure without claiming OS isolation.
const guardedFs = { ...originalFs };
function guardPath(path: unknown): void {
  if (typeof path !== "string") throw new Error("NONSTRING_FILESYSTEM_PATH");
  const rel = relative(root, resolve(path));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("CHILD_FILESYSTEM_ESCAPE");
}
for (const name of ["readFileSync", "writeFileSync", "appendFileSync", "mkdirSync", "rmdirSync", "rmSync", "readdirSync", "statSync", "existsSync"] as const) {
  const original = originalFs[name] as (...args: any[]) => any;
  (guardedFs as any)[name] = (...args: any[]) => { guardPath(args[0]); return original(...args); };
}
const renameSync = originalFs.renameSync;
guardedFs.renameSync = (from, to) => { guardPath(from); guardPath(to); renameSync(from, to); };
mock.module("node:fs", () => guardedFs);
mock.module("node:child_process", () => ({ execFileSync: () => { throw new Error("CHILD_PROCESS_FORBIDDEN"); } }));
const manifest = JSON.parse(readFileSync(join(root, "closure.json"), "utf8"));
const permitted = new Map<string, string>(manifest.entries.map((entry: any) => [join(root, "state", entry.installed), entry.sha256]));
const builtins = new Set(manifest.builtins);
await plugin({
  name: "installed-observation-closure-only",
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path.startsWith("node:") && builtins.has(args.path)) return;
      const base = args.path.startsWith(".") ? resolve(dirname(args.importer), args.path) : args.path;
      const target = permitted.has(base) ? base : `${base}.ts`;
      if (!permitted.has(target)) throw new Error("UNDECLARED_INSTALLED_IMPORT");
      if (createHash("sha256").update(readFileSync(target)).digest("hex") !== permitted.get(target)) throw new Error("INSTALLED_HASH_DRIFT");
      // Let Bun perform its normal file resolution after the exact target gate.
      return;
    });
  },
});

const { adaptRoutingObservation } = await import(join(root, "state/router/routing-observation-adapter.ts"));
const contract = await import(join(root, "state/runtime/manifest-bridge/src/contracts/routing-observation-receipt.v1.ts"));
const { admitRoutingObservation, observationEventId, observationKey } = await import(join(root, "state/runtime/manifest-bridge/src/routing-observation.ts"));
const { ManifestStore } = await import(join(root, "state/runtime/manifest-bridge/src/store.ts"));
const { ManifestCatalog } = await import(join(root, "state/runtime/manifest-bridge/src/catalog.ts"));
const project = "prj_synthetic-installed";
let now = Date.parse("2026-09-07T00:00:00.000Z");
const receiptPolicy = { registered_projects: [project], catalog: [{ provider: "synthetic", model: "synthetic/model-v1" }], max_freshness_ms: 60_000 };
const policy = { receipt_policy: receiptPolicy, project_bindings: [{ project_id: project, project_ref: project }], max_clock_skew_ms: 0, now: () => now };
const context = {
  observation_id: `obs_${"1".repeat(32)}`, project_ref: project,
  observed_at: "2026-09-07T00:00:00.000Z", fresh_until: "2026-09-07T00:01:00.000Z", evidence_mode: "synthetic",
  provenance: { product_source_commit: manifest.product_source_commit, closure_sha256: manifest.digest, contract_sha256: manifest.contract_sha256 }, policy: receiptPolicy,
};
function adapt(observationId = context.observation_id, uncertain = false) {
  const result = adaptRoutingObservation({
    request: { outcome: "succeeded" },
    attempts: uncertain ? { state: "unavailable" } : { state: "available", records: [{ observation_id: observationId, ordinal: 2, phase: "terminal", outcome: "succeeded", termination: "completed", identity: { state: "available", provider: "synthetic", model: "synthetic/model-v1" } }] },
    tools: { state: "unavailable", reason_code: "not_instrumented" },
  }, { ...context, observation_id: observationId });
  assert.equal(result.ok, true);
  assert.equal(contract.validateReceipt(result.receipt, receiptPolicy).canonical, result.canonical);
  return result;
}
function envelope(receipt: any) {
  return { schema: "temperance.manifest.event.v1", id: observationEventId(receipt.receipt_id), ts: receipt.observed_at, fresh_until: receipt.fresh_until, kind: "routing.observation.recorded", source: "temperance-router", status: "synthetic", project_id: project, actor: "product-routing-adapter", payload: receipt, evidence: [], redaction: "bounded-preview" };
}
const first = adapt(), uncertain = adapt(`obs_${"2".repeat(32)}`, true);
const event = envelope(first.receipt), uncertainEvent = envelope(uncertain.receipt), conflict = envelope(adapt(context.observation_id, true).receipt);
const key = observationKey(first.receipt);
assert.equal(admitRoutingObservation(event, policy).ok, true);
const data = join(root, "data");
const catalog = new ManifestCatalog(data, policy);
catalog.ensureProject({ schema: "temperance.manifest.project.v1", project_id: project, name: project, cwd: null });
assert.equal(catalog.ingest(event).accepted, true);
const file = join(data, "projects", project, "events.jsonl");
const firstBytes = readFileSync(file, "utf8");
assert.equal(catalog.ingest(event).accepted, false);
assert.deepEqual(catalog.ingest(conflict), { accepted: false, error: "receipt_conflict" });
assert.equal(readFileSync(file, "utf8"), firstBytes);
assert.equal(catalog.snapshot(project).event_count, 1);
assert.equal(catalog.ingest(uncertainEvent).accepted, true);
const durableBytes = readFileSync(file, "utf8");
for (const [line, expected] of durableBytes.trim().split("\n").map((line, index) => [JSON.parse(line), [first, uncertain][index]] as const)) {
  assert.equal(contract.validateReceipt(line.payload, receiptPolicy).canonical, expected.canonical);
  assert.equal(JSON.stringify(line.payload), JSON.stringify(expected.receipt));
}
assert.equal(catalog.snapshot(project).routing_observations[key].freshness, "fresh");
now += 60_001;
const restarted = new ManifestCatalog(data, policy);
const store = new ManifestStore(file, project, policy);
assert.equal(store.ingest(event).accepted, false);
assert.equal(restarted.ingest(event).accepted, false);
assert.deepEqual(store.replay(), []);
for (const state of [store.state, restarted.snapshot(project), restarted.snapshot("all")]) {
  assert.equal(state.event_count, 2);
  const projection = state.routing_observations[key];
  assert.equal(projection.freshness, "stale");
  assert.equal(JSON.stringify(projection.receipt), JSON.stringify(first.receipt));
  assert.equal(contract.validateReceipt(projection.receipt, receiptPolicy).canonical, first.canonical);
  assert.deepEqual(state.routing_observations[observationKey(uncertain.receipt)].receipt.attribution, { state: "unavailable", reason_code: "evidence_unavailable" });
  assert.deepEqual(projection.receipt.tools, { state: "unavailable", reason_code: "not_instrumented" });
  assert.equal(projection.receipt.evidence_mode, "synthetic");
  for (const field of ["routes", "approvals", "dispatches", "agents"]) assert.deepEqual(state[field], {});
}
assert.equal(readFileSync(file, "utf8"), durableBytes);
// Only synthetic bounded values are returned to the parent, never host data.
writeFileSync(join(root, "result.json"), JSON.stringify({ schema: "ro05.synthetic-installed-proof.v1", event_count: 2, receipt_id: first.receipt.receipt_id, canonical_sha256: createHash("sha256").update(first.canonical).digest("hex"), freshness: "stale", attribution: "unavailable", child_env_keys: Object.keys(process.env).sort() }));
