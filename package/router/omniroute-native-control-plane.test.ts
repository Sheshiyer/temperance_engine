import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  NativeControlPlaneError,
  collectNativeControlPlane,
  type CollectionOptions,
  type RuntimeIdentity,
} from "./omniroute-native-control-plane";

const roots: string[] = [];
const keepers: Array<{ path: string; database: Database }> = [];
const runtime: RuntimeIdentity = {
  pid: 4242,
  startedHash: "a".repeat(64),
  listener: "127.0.0.1:20128",
  version: "3.8.48",
  packageIdentityHash: "b".repeat(64),
  databaseBindingHash: "c".repeat(64),
};

function fixtureDatabaseBinding(path: string): string {
  const stat = statSync(path);
  return createHash("sha256").update(`${stat.dev}:${stat.ino}`).digest("hex");
}

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "temperance-native-control-plane-")));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function createDatabase(path: string): void {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE provider_connections (
      provider TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      test_status TEXT NOT NULL,
      api_key TEXT,
      access_token TEXT,
      refresh_token TEXT,
      email TEXT,
      provider_specific_data TEXT
    );
    CREATE TABLE call_logs (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      status INTEGER NOT NULL,
      provider TEXT,
      error_summary TEXT,
      request_summary TEXT
    );
    CREATE TABLE key_value (namespace TEXT, key TEXT, value TEXT);
    CREATE TABLE compression_combos (
      id TEXT,
      name TEXT,
      pipeline TEXT,
      is_default INTEGER
    );
    CREATE TABLE a2a_tasks (
      state TEXT,
      created_at TEXT,
      input_json TEXT,
      output_json TEXT
    );
    CREATE TABLE mcp_tool_audit (created_at TEXT, output_summary TEXT);
    CREATE TABLE combos (id TEXT, name TEXT);
    CREATE TABLE model_intelligence (model TEXT);
    CREATE TABLE db_meta (key TEXT, value TEXT);

    INSERT INTO provider_connections VALUES
      ('github-copilot', 1, 'active', 'SENTINEL_API_KEY', 'SENTINEL_ACCESS', 'SENTINEL_REFRESH', 'secret@example.invalid', '{"secret":"SENTINEL_PROVIDER_DATA"}'),
      ('antigravity', 1, 'error', 'SENTINEL_API_KEY_2', NULL, NULL, NULL, NULL),
      ('antigravity', 0, 'banned', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO call_logs VALUES
      (1, '2026-08-01T00:00:00.000Z', 200, 'github-copilot', NULL, 'SENTINEL_REQUEST_BODY'),
      (2, '2026-08-01T01:00:00.000Z', 503, 'antigravity', 'SENTINEL_ERROR_BODY', NULL);
    INSERT INTO key_value VALUES
      ('compression', 'enabled', 'false'),
      ('compression', 'defaultMode', '"off"'),
      ('compression', 'activeComboId', 'null'),
      ('compression', 'preserveSystemPrompt', 'true'),
      ('compression', 'cavemanConfig', '{"enabled":true,"private":"SENTINEL_COMPRESSION"}');
    INSERT INTO compression_combos VALUES
      ('default', 'Default', '[{"engine":"rtk","intensity":"standard"},{"engine":"caveman","intensity":"full"}]', 1);
    INSERT INTO a2a_tasks VALUES
      ('submitted', '2026-08-01T00:00:00.000Z', 'SENTINEL_A2A_INPUT', NULL),
      ('completed', '2026-08-01T01:00:00.000Z', NULL, 'SENTINEL_A2A_OUTPUT');
    INSERT INTO mcp_tool_audit VALUES ('2026-08-01T02:00:00.000Z', 'SENTINEL_MCP_OUTPUT');
    INSERT INTO combos VALUES
      ('one', 'temperance-coding'),
      ('two', 'te-build'),
      ('three', 'te-free-burst'),
      ('four', 'te-reason'),
      ('five', 'te-plan');
    INSERT INTO model_intelligence VALUES ('github/model-one'), ('antigravity/model-two'), ('model-three');
    INSERT INTO db_meta VALUES ('schema_version', '1');
  `);
  db.close();
  chmodSync(path, 0o600);
}

function manifest(
  workers?: Array<{ role: string; provider: string; model: string }>,
  fallbacks?: Array<{ backend: string; model: string }>,
): object {
  return {
    dispatch: {
      portfolio: "te-dispatch",
      strategy: "round-robin",
      max_parallel: 4,
      omniroute_workers: workers ?? [
        { role: "spark-fast-worker", provider: "codex", model: "codex/gpt-5.3-codex-spark" },
        { role: "fast-worker", provider: "command-code", model: "command-code/deepseek-v4-flash" },
        { role: "coding-worker", provider: "command-code", model: "command-code/kimi-k2.7-code" },
        { role: "build-worker", provider: "grok-cli", model: "grok-cli/grok-build" },
      ],
      direct_cli_fallbacks: fallbacks ?? [{ backend: "kimi", model: "kimi-code/kimi-for-coding" }],
    },
  };
}

function createFixture(): CollectionOptions & { root: string; quickTunnelStatePath: string } {
  const root = makeRoot();
  const databasePath = resolve(root, "storage.sqlite");
  const dispatchManifestPath = resolve(root, "temperance-workflows.json");
  const quickTunnelStatePath = resolve(root, "quick-tunnel-state.json");
  createDatabase(databasePath);
  const keeper = new Database(databasePath);
  keeper.query("SELECT COUNT(*) AS count FROM provider_connections").get();
  keepers.push({ path: databasePath, database: keeper });
  const fixtureRuntime = { ...runtime, databaseBindingHash: fixtureDatabaseBinding(databasePath) };
  writeFileSync(dispatchManifestPath, JSON.stringify(manifest()), { mode: 0o600 });
  writeFileSync(quickTunnelStatePath, JSON.stringify({ status: "stopped", pid: null }), { mode: 0o600 });
  return {
    root,
    databasePath,
    dispatchManifestPath,
    quickTunnelStatePath,
    hermesDirectoryPath: resolve(root, "absent-hermes"),
    installedVersion: "3.8.48",
    expectedUid: process.getuid?.(),
    now: () => new Date("2026-08-02T00:00:00.000Z"),
    runtimeProbe: () => fixtureRuntime,
    cliProbe: () => ({ claude: true, codex: true, opencode: true, hermes: false, "hermes-agent": false }),
  };
}

function captureCode(fn: () => unknown): string {
  try {
    fn();
    return "no_error";
  } catch (error) {
    if (error instanceof NativeControlPlaneError) return error.code;
    throw error;
  }
}

afterEach(() => {
  for (const keeper of keepers.splice(0)) keeper.database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OmniRoute native control-plane snapshot", () => {
  test("projects only five redacted layers from one read-only transaction", () => {
    const fixture = createFixture();
    const snapshot = collectNativeControlPlane(fixture);
    expect(Object.keys(snapshot.layers)).toEqual(["inventory", "activity", "policy", "execution", "authority"]);
    expect(snapshot.layers.inventory).toMatchObject({
      configuredConnections: 3,
      activeConnections: 2,
      configuredProviderFamilies: 2,
      activeProviderFamilies: 2,
      healthyConnections: 1,
      unhealthyConnections: 2,
      persistedObservedProviderFamilies: 2,
      governedComboCount: 5,
      governedHermesCombos: {
        temperanceCoding: true,
        teBuild: true,
        teFreeBurst: true,
        teReason: true,
        tePlan: true,
      },
    });
    expect(snapshot.layers.activity).toMatchObject({
      liveInFlightProviderFamilies: null,
      liveInFlightState: "unknown-websocket-only-not-collected",
      lastPersistedProvider: "antigravity",
      lastPersistedErrorProvider: "antigravity",
    });
    expect(snapshot.layers.policy.compression).toMatchObject({
      masterEnabled: false,
      effectivePipeline: "off",
      candidateEngines: ["caveman"],
      adoption: "preview-only",
    });
    expect(snapshot.layers.policy.contextSources).toBe("client-pointer-catalog");
    expect(snapshot.layers.policy.dispatch).toMatchObject({
      workerCount: 4,
      nonCodexWorkerCount: 3,
      nonCodexProviderFamilyCount: 2,
      nonCodexTargetCount: 3,
      sparkWorkerCount: 1,
      fallbackCount: 1,
      solFree: true,
    });
    expect(snapshot.layers.execution.protocols.a2a.taskCounts).toMatchObject({ submitted: 1, completed: 1 });
    expect(snapshot.layers.authority.omnirouteManagement).toBe("not-contacted");
    expect(snapshot.promotionAuthorized).toBe(false);
    expect(snapshot.mutationMethods).toEqual([]);
    expect(Object.keys(snapshot.evidence.database)).toEqual([
      "mode",
      "links",
      "size",
      "schemaVersion",
      "dataVersion",
      "journalMode",
    ]);

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      "SENTINEL_",
      "secret@example.invalid",
      "api_key",
      "access_token",
      "refresh_token",
      "provider_specific_data",
      "request_summary",
      "error_summary",
      "input_json",
      "output_json",
      "output_summary",
    ]) expect(serialized).not.toContain(forbidden);
  });

  test("fails closed on Sol-family model, provider, and role aliases", () => {
    for (const worker of [
      { role: "forbidden-worker", provider: "codex", model: "codex/gpt-5.6-sol-max" },
      { role: "forbidden-worker", provider: "codex", model: "codex/gpt-5.6-solmax" },
      { role: "forbidden-worker", provider: "sol", model: "vendor/safe-model" },
      { role: "sol_worker", provider: "vendor", model: "vendor/safe-model" },
      { role: "solmax-worker", provider: "vendor", model: "vendor/safe-model" },
    ]) {
      const fixture = createFixture();
      writeFileSync(fixture.dispatchManifestPath, JSON.stringify(manifest([worker])), { mode: 0o600 });
      expect(captureCode(() => collectNativeControlPlane(fixture))).toBe("dispatch_sol_forbidden");
    }

    const fallbackFixture = createFixture();
    writeFileSync(
      fallbackFixture.dispatchManifestPath,
      JSON.stringify(manifest(undefined, [{ backend: "codex", model: "codex/gpt-5.6-solmax" }])),
      { mode: 0o600 },
    );
    expect(captureCode(() => collectNativeControlPlane(fallbackFixture))).toBe("dispatch_sol_forbidden");
  });

  test("rejects writable files, unsafe ancestry, and symbolic database paths", () => {
    const writable = createFixture();
    chmodSync(writable.databasePath, 0o666);
    expect(captureCode(() => collectNativeControlPlane(writable))).toBe("file_writable_by_others");

    const ancestry = createFixture();
    chmodSync(ancestry.root, 0o777);
    expect(captureCode(() => collectNativeControlPlane(ancestry))).toBe("directory_writable_by_others");

    const linked = createFixture();
    const target = resolve(linked.root, "target.sqlite");
    renameSync(linked.databasePath, target);
    symlinkSync(target, linked.databasePath);
    expect(captureCode(() => collectNativeControlPlane(linked))).toBe("file_symlink_forbidden");
  });

  test("rejects schema drift, runtime restarts, and database replacement", () => {
    const schema = createFixture();
    const schemaDb = new Database(schema.databasePath);
    schemaDb.exec("DROP TABLE mcp_tool_audit");
    schemaDb.close();
    expect(captureCode(() => collectNativeControlPlane(schema))).toBe("database_schema_invalid");

    const schemaVersion = createFixture();
    const versionDb = new Database(schemaVersion.databasePath);
    versionDb.exec("UPDATE db_meta SET value = '2' WHERE key = 'schema_version'");
    versionDb.close();
    expect(captureCode(() => collectNativeControlPlane(schemaVersion))).toBe(
      "database_schema_version_unsupported",
    );

    const restarted = createFixture();
    const restartedRuntime = restarted.runtimeProbe(restarted.databasePath);
    let calls = 0;
    restarted.runtimeProbe = () => ({ ...restartedRuntime, pid: ++calls === 1 ? 4242 : 4243 });
    expect(captureCode(() => collectNativeControlPlane(restarted))).toBe("runtime_identity_changed");

    const wrongRuntimePackage = createFixture();
    const wrongPackageRuntime = wrongRuntimePackage.runtimeProbe(wrongRuntimePackage.databasePath);
    wrongRuntimePackage.runtimeProbe = () => ({ ...wrongPackageRuntime, version: "3.8.49" });
    expect(captureCode(() => collectNativeControlPlane(wrongRuntimePackage))).toBe(
      "runtime_package_version_mismatch",
    );

    const wrongRuntimeDatabase = createFixture();
    const wrongDatabaseRuntime = wrongRuntimeDatabase.runtimeProbe(wrongRuntimeDatabase.databasePath);
    wrongRuntimeDatabase.runtimeProbe = () => ({ ...wrongDatabaseRuntime, databaseBindingHash: "d".repeat(64) });
    expect(captureCode(() => collectNativeControlPlane(wrongRuntimeDatabase))).toBe(
      "runtime_database_identity_mismatch",
    );

    const replaced = createFixture();
    const replacementPath = resolve(replaced.root, "replacement.sqlite");
    createDatabase(replacementPath);
    const replacedRuntime = replaced.runtimeProbe(replaced.databasePath);
    let replacedOnce = false;
    replaced.runtimeProbe = () => {
      if (!replacedOnce) {
        replacedOnce = true;
        renameSync(replacementPath, replaced.databasePath);
      }
      return replacedRuntime;
    };
    expect(captureCode(() => collectNativeControlPlane(replaced))).toBe("database_identity_changed");
  });

  test("rejects unsafe quick-tunnel state files", () => {
    const fixture = createFixture();
    chmodSync(fixture.quickTunnelStatePath, 0o666);
    expect(captureCode(() => collectNativeControlPlane(fixture))).toBe("file_writable_by_others");
  });

  test("treats cloudflared processes as unsafe and rejects process drift", () => {
    const present = createFixture();
    present.cloudflaredProcessProbe = () => [9001];
    expect(collectNativeControlPlane(present).layers.authority.cloudflare).toMatchObject({
      quickTunnel: "unsafe",
      cloudflaredProcessesPresent: true,
    });

    const drift = createFixture();
    let probes = 0;
    drift.cloudflaredProcessProbe = () => (++probes === 1 ? [] : [9001]);
    expect(captureCode(() => collectNativeControlPlane(drift))).toBe("cloudflared_process_state_changed");
  });

  test("rejects wrong ownership, non-WAL databases, and hot journals", () => {
    const wrongOwner = createFixture();
    wrongOwner.expectedUid = (process.getuid?.() ?? 0) + 1;
    expect(captureCode(() => collectNativeControlPlane(wrongOwner))).toBe("directory_owner_invalid");

    const nonWal = createFixture();
    const keeperIndex = keepers.findIndex((keeper) => keeper.path === nonWal.databasePath);
    keepers.splice(keeperIndex, 1)[0]?.database.close();
    const nonWalDb = new Database(nonWal.databasePath);
    nonWalDb.exec("PRAGMA journal_mode = DELETE");
    nonWalDb.close();
    expect(captureCode(() => collectNativeControlPlane(nonWal))).toBe("database_journal_mode_unsupported");

    const hotJournal = createFixture();
    writeFileSync(`${hotJournal.databasePath}-journal`, "fixture", { mode: 0o600 });
    expect(captureCode(() => collectNativeControlPlane(hotJournal))).toBe("database_hot_journal_present");
  });

  test("reports master-on compression as request-dependent even when default mode is off", () => {
    const fixture = createFixture();
    const db = new Database(fixture.databasePath);
    db.exec("UPDATE key_value SET value = 'true' WHERE namespace = 'compression' AND key = 'enabled'");
    db.close();
    expect(collectNativeControlPlane(fixture).layers.policy.compression).toMatchObject({
      masterEnabled: true,
      defaultMode: "off",
      activeComboResolves: false,
      effectivePipeline: "request-dependent",
    });

    const active = createFixture();
    const activeDb = new Database(active.databasePath);
    activeDb.exec(`
      UPDATE key_value SET value = 'true'
      WHERE namespace = 'compression' AND key = 'enabled';
      UPDATE key_value SET value = '"default"'
      WHERE namespace = 'compression' AND key = 'activeComboId';
    `);
    activeDb.close();
    expect(collectNativeControlPlane(active).layers.policy.compression).toMatchObject({
      masterEnabled: true,
      defaultMode: "off",
      activeComboId: "default",
      activeComboResolves: true,
      effectivePipeline: "request-dependent",
    });
  });

  test("source contains no credential, HTTP, or SQL mutation control plane", () => {
    const core = readFileSync(resolve(import.meta.dir, "omniroute-native-control-plane.ts"), "utf8");
    const script = readFileSync(resolve(import.meta.dir, "../../scripts/omniroute-native-status.ts"), "utf8");
    for (const source of [core, script]) {
      expect(source).not.toMatch(/fetch\s*\(/u);
      expect(source).not.toMatch(/https?:\/\//u);
      expect(source).not.toMatch(/\/api\//u);
      expect(source).not.toMatch(/Authorization|Keychain|security\s+find/u);
    }
    expect(core).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/u);
  });
});
