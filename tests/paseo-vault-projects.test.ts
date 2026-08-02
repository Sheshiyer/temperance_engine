import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts", "paseo-vault-projects.ts");
const temporaryRoots: string[] = [];

interface Fixture {
  root: string;
  paseoHome: string;
  receiptDir: string;
  fakePaseo: string;
  statePath: string;
  logPath: string;
  inventoryPath: string;
  preservedRepo: string;
  trailingRepo: string;
  missingRepo: string;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function command(cmd: string, args: string[], env?: Record<string, string>) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function gitInit(path: string): void {
  mkdirSync(path, { recursive: true });
  const result = command("git", ["init", "-q", path]);
  if (result.status !== 0) throw new Error(result.stderr);
}

function latestReceipt(directory: string): any {
  const file = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .at(-1);
  if (!file) throw new Error("missing receipt");
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "temperance-paseo-"));
  temporaryRoots.push(root);
  const paseoHome = join(root, "paseo");
  const receiptDir = join(root, "receipts");
  const preservedRepo = join(root, "preserved");
  const trailingRepo = join(root, "trailing ");
  const missingRepo = join(root, "missing");
  const statePath = join(root, "workspaces.json");
  const logPath = join(root, "paseo-log.jsonl");
  const fakePaseo = join(root, "fake-paseo");
  const inventoryPath = join(root, "inventory.json");

  gitInit(preservedRepo);
  gitInit(trailingRepo);
  mkdirSync(join(paseoHome, "projects"), { recursive: true });
  writeFileSync(join(paseoHome, "projects", "projects.json"), "[]\n");
  writeFileSync(join(paseoHome, "projects", "workspaces.json"), "[]\n");
  writeFileSync(
    statePath,
    `${JSON.stringify(
      [
        {
          workspaceId: "wks_existing_1",
          project: "preserved",
          name: "main",
          isolation: "local",
          cwd: preservedRepo,
        },
        {
          workspaceId: "wks_existing_2",
          project: "preserved",
          name: "main-copy",
          isolation: "local",
          cwd: preservedRepo,
        },
      ],
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    inventoryPath,
    `${JSON.stringify(
      [
        {
          path: "group/preserved",
          abs: preservedRepo,
          name: "preserved",
          group: "group",
          remote: "https://example.test/shared",
        },
        {
          path: "group/trailing ",
          abs: trailingRepo,
          name: "trailing ",
          group: "group",
          remote: "https://example.test/shared",
        },
        {
          path: "group/missing",
          abs: missingRepo,
          name: "missing",
          group: "group",
          remote: "",
        },
      ],
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    fakePaseo,
    `#!/usr/bin/env bun
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const statePath = process.env.FAKE_PASEO_STATE;
const logPath = process.env.FAKE_PASEO_LOG;
if (!statePath || !logPath) process.exit(90);
const state = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + "\\n");
const log = (value) => appendFileSync(logPath, JSON.stringify(value) + "\\n");
const has = (...items) => items.every((item) => args.includes(item));
const value = (flag) => args[args.indexOf(flag) + 1];
if (has("workspace", "ls")) {
  console.log(JSON.stringify(state()));
} else if (has("workspace", "create")) {
  const delay = Number(process.env.FAKE_CREATE_DELAY_MS || "0");
  if (delay > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  }
  const workspaces = state();
  const cwd = value("--path");
  const title = value("--title");
  const sequence = workspaces.length + 1;
  const created = {
    workspaceId: "wks_created_" + sequence,
    projectId: "prj_created_" + sequence,
    project: cwd.split("/").at(-1),
    name: title,
    isolation: "local",
    cwd
  };
  log({ type: "create", cwd, title, snapshotPresent: existsSync(process.env.FAKE_EXPECTED_SNAPSHOT_ROOT || "") });
  workspaces.push(created);
  save(workspaces);
  console.log(JSON.stringify(created));
} else if (has("provider", "models")) {
  const provider = args.at(-1);
  const models = provider === "opencode"
    ? ["omniroute/te-dispatch", "omniroute/te-plan", "omniroute/te-write-research", "omniroute/te-validate"]
    : provider === "claude" ? ["claude-fable-5"] : [];
  console.log(JSON.stringify(models.map((id) => ({ id }))));
} else {
  console.error("unknown fake paseo command", args);
  process.exit(91);
}
`,
  );
  chmodSync(fakePaseo, 0o755);

  return {
    root,
    paseoHome,
    receiptDir,
    fakePaseo,
    statePath,
    logPath,
    inventoryPath,
    preservedRepo,
    trailingRepo,
    missingRepo,
  };
}

function runReconciler(
  fixture: Fixture,
  extra: string[],
  additionalEnv: Record<string, string> = {},
) {
  return command(
    "bun",
    [
      SCRIPT,
      "--inventory",
      fixture.inventoryPath,
      "--paseo-home",
      fixture.paseoHome,
      "--paseo-bin",
      fixture.fakePaseo,
      "--receipt-dir",
      fixture.receiptDir,
      ...extra,
    ],
    {
      FAKE_PASEO_STATE: fixture.statePath,
      FAKE_PASEO_LOG: fixture.logPath,
      ...additionalEnv,
    },
  );
}

describe("paseo vault project reconciliation", () => {
  test("dry-run preserves duplicates, plans trailing-space root, and reports missing", () => {
    const fixture = createFixture();
    const result = runReconciler(fixture, []);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.counts).toMatchObject({
      inventory: 3,
      preserved: 1,
      plannedCreate: 1,
      errors: 1,
      duplicatePaths: 1,
    });
    const receipt = latestReceipt(fixture.receiptDir);
    expect(receipt.outcomes[0].workspaceIds).toEqual(["wks_existing_1", "wks_existing_2"]);
    expect(receipt.outcomes[1].abs.endsWith(" ")).toBe(true);
    expect(receipt.outcomes[1].status).toBe("planned-create");
    expect(receipt.outcomes[2].reason).toBe("path-missing");
    expect(readFileSync(fixture.statePath, "utf8")).not.toContain("wks_created");
  });

  test("apply aborts before mutation when invalid records are unacknowledged", () => {
    const fixture = createFixture();
    const result = runReconciler(fixture, ["--apply"]);
    expect(result.status).toBe(2);
    expect(readFileSync(fixture.statePath, "utf8")).not.toContain("wks_created");
    expect(existsSync(join(fixture.paseoHome, "orchestration-preferences.json"))).toBe(false);
    expect(latestReceipt(fixture.receiptDir).aborted).toBe(true);
  });

  test("allow-invalid snapshots, creates exact path, and writes verified preferences", () => {
    const fixture = createFixture();
    const before = command("git", ["-C", fixture.trailingRepo, "status", "--porcelain=v1"]).stdout;
    const result = runReconciler(fixture, ["--apply", "--allow-invalid"]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.counts.created).toBe(1);
    expect(output.counts.errors).toBe(1);

    const receipt = latestReceipt(fixture.receiptDir);
    expect(receipt.snapshotPath).toBeTruthy();
    expect(existsSync(join(receipt.snapshotPath, "projects.json"))).toBe(true);
    expect(existsSync(join(receipt.snapshotPath, "workspaces.json"))).toBe(true);
    expect(statSync(join(receipt.snapshotPath, "projects.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(receipt.snapshotPath, "workspaces.json")).mode & 0o777).toBe(0o600);
    const snapshotIndex = receipt.events.findIndex((event: any) => event.type === "registry-snapshot");
    const createIndex = receipt.events.findIndex((event: any) => event.type === "workspace-created");
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(snapshotIndex);

    const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    const created = state.find((workspace: any) => workspace.workspaceId.startsWith("wks_created"));
    expect(created.cwd).toBe(fixture.trailingRepo);
    expect(created.cwd.endsWith(" ")).toBe(true);
    expect(created.name).toBe("group/trailing ");

    const preferences = JSON.parse(
      readFileSync(join(fixture.paseoHome, "orchestration-preferences.json"), "utf8"),
    );
    expect(preferences.providers.impl).toBe("omniroute-dispatch");
    expect(preferences.providers.ui).toBe("claude/claude-fable-5");
    const after = command("git", ["-C", fixture.trailingRepo, "status", "--porcelain=v1"]).stdout;
    expect(after).toBe(before);
  });

  test("second allow-invalid apply creates zero workspaces", () => {
    const fixture = createFixture();
    expect(runReconciler(fixture, ["--apply", "--allow-invalid"]).status).toBe(0);
    const firstCount = JSON.parse(readFileSync(fixture.statePath, "utf8")).length;
    const second = runReconciler(fixture, ["--apply", "--allow-invalid"]);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).counts.created).toBe(0);
    expect(JSON.parse(second.stdout).counts.plannedCreate).toBe(0);
    expect(JSON.parse(readFileSync(fixture.statePath, "utf8")).length).toBe(firstCount);
  });

  test("invalid provider target fails before workspace mutation", () => {
    const fixture = createFixture();
    const preferencesPath = join(fixture.root, "bad-preferences.json");
    writeFileSync(
      preferencesPath,
      `${JSON.stringify({
        providers: {
          impl: "opencode/omniroute/not-real",
          ui: "claude/claude-fable-5",
          research: "opencode/omniroute/te-write-research",
          planning: "opencode/omniroute/te-plan",
          audit: "opencode/omniroute/te-validate",
        },
        preferences: [],
      })}\n`,
    );
    const result = runReconciler(fixture, [
      "--apply",
      "--allow-invalid",
      "--preferences",
      preferencesPath,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing models");
    expect(readFileSync(fixture.statePath, "utf8")).not.toContain("wks_created");
  });

  test("existing preferences are backed up before replacement", () => {
    const fixture = createFixture();
    const destination = join(fixture.paseoHome, "orchestration-preferences.json");
    writeFileSync(destination, '{"legacy":true}\n');
    expect(runReconciler(fixture, ["--apply", "--allow-invalid"]).status).toBe(0);
    const receipt = latestReceipt(fixture.receiptDir);
    expect(receipt.preferences.backupPath).toBeTruthy();
    expect(readFileSync(receipt.preferences.backupPath, "utf8")).toBe('{"legacy":true}\n');
  });

  test("overlapping applies are single-flight and create one workspace", async () => {
    const fixture = createFixture();
    const args = [
      SCRIPT,
      "--inventory",
      fixture.inventoryPath,
      "--paseo-home",
      fixture.paseoHome,
      "--paseo-bin",
      fixture.fakePaseo,
      "--receipt-dir",
      fixture.receiptDir,
      "--apply",
      "--allow-invalid",
    ];
    const env = {
      ...process.env,
      FAKE_PASEO_STATE: fixture.statePath,
      FAKE_PASEO_LOG: fixture.logPath,
      FAKE_CREATE_DELAY_MS: "400",
    };
    const first = Bun.spawn(["bun", ...args], {
      cwd: ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const lockPath = join(fixture.paseoHome, "locks", "vault-portfolio-reconcile.lock");
    for (let attempt = 0; attempt < 100 && !existsSync(lockPath); attempt += 1) {
      await Bun.sleep(10);
    }
    expect(existsSync(lockPath)).toBe(true);

    const second = runReconciler(fixture, ["--apply", "--allow-invalid"]);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("portfolio reconciliation lock exists");

    const firstStatus = await first.exited;
    expect(firstStatus).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
    const workspaces = JSON.parse(readFileSync(fixture.statePath, "utf8"));
    expect(workspaces.filter((workspace: any) => workspace.cwd === fixture.trailingRepo)).toHaveLength(1);
  });
});
