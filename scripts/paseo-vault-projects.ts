#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type Mode = "dry-run" | "apply";

interface InventoryRecord {
  abs: string;
  path: string;
  name: string;
  group: string;
  remote?: string;
}

interface Workspace {
  workspaceId: string;
  projectId?: string;
  project?: string;
  name?: string;
  isolation?: string;
  cwd: string;
}

interface Preferences {
  providers: Record<string, string>;
  preferences: string[];
}

type OutcomeStatus = "preserved" | "planned-create" | "created" | "error";

interface Outcome {
  index: number;
  path: string;
  abs: string;
  canonicalPath: string | null;
  name: string;
  group: string;
  status: OutcomeStatus;
  reason: string | null;
  workspaceIds: string[];
  projectId?: string;
  duplicateWorkspace?: boolean;
}

interface Event {
  at: string;
  type: string;
  detail?: string;
}

interface Receipt {
  schemaVersion: 1;
  receiptId: string;
  mode: Mode;
  inventoryPath: string;
  paseoHome: string;
  startedAt: string;
  completedAt: string | null;
  aborted: boolean;
  allowInvalid: boolean;
  snapshotPath: string | null;
  preferences: {
    path: string;
    validated: boolean;
    changed: boolean;
    backupPath: string | null;
    providers: Record<string, string>;
  };
  counts: Record<string, number>;
  outcomes: Outcome[];
  events: Event[];
}

interface Options {
  mode: Mode;
  allowInvalid: boolean;
  inventoryPath: string;
  paseoHome: string;
  paseoBin: string;
  receiptDir: string;
  preferencesPath: string | null;
}

const REQUIRED_ROLES = ["impl", "ui", "research", "planning", "audit"] as const;

const DEFAULT_PREFERENCES: Preferences = {
  providers: {
    impl: "omniroute-dispatch",
    ui: "claude/claude-fable-5",
    research: "omniroute-write-research",
    planning: "omniroute-plan",
    audit: "omniroute-validate",
  },
  preferences: [
    "Use the Spark-enabled dispatch portfolio for parallel implementation work.",
    "Keep planning, research, implementation, and audit on distinct Temperance portfolios.",
    "Use native Claude for artistic, visual, interaction, and human-skill-oriented work.",
    "Treat provider quotas as independent pools and preserve provider/model attribution in fleet receipts.",
  ],
};

function usage(): never {
  console.error(`Usage:
  bun scripts/paseo-vault-projects.ts --inventory PATH [options]

Options:
  --dry-run                Preview only (default)
  --apply                  Create missing workspaces and write preferences
  --allow-invalid          Apply valid records while retaining invalid outcomes
  --paseo-home PATH        Paseo state root (default: ~/.paseo)
  --paseo-bin PATH         Paseo CLI (default: paseo)
  --receipt-dir PATH       Receipt directory (default: PASEO_HOME/receipts)
  --preferences PATH       Alternate orchestration-preferences JSON
  -h, --help               Show this help`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  let mode: Mode = "dry-run";
  let allowInvalid = false;
  let inventoryPath = "";
  let paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
  let paseoBin = process.env.PASEO_BIN || "paseo";
  let receiptDir = "";
  let preferencesPath: string | null = null;

  const value = (flag: string, index: number): string => {
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`${flag} requires a value`);
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        mode = "dry-run";
        break;
      case "--apply":
        mode = "apply";
        break;
      case "--allow-invalid":
        allowInvalid = true;
        break;
      case "--inventory":
        inventoryPath = value(arg, i);
        i += 1;
        break;
      case "--paseo-home":
        paseoHome = value(arg, i);
        i += 1;
        break;
      case "--paseo-bin":
        paseoBin = value(arg, i);
        i += 1;
        break;
      case "--receipt-dir":
        receiptDir = value(arg, i);
        i += 1;
        break;
      case "--preferences":
        preferencesPath = value(arg, i);
        i += 1;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!inventoryPath) throw new Error("--inventory is required");
  paseoHome = resolve(paseoHome);
  return {
    mode,
    allowInvalid,
    inventoryPath: resolve(inventoryPath),
    paseoHome,
    paseoBin,
    receiptDir: resolve(receiptDir || join(paseoHome, "receipts")),
    preferencesPath: preferencesPath ? resolve(preferencesPath) : null,
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

function stampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function stripLineEnding(value: string): string {
  return value.replace(/[\r\n]+$/, "");
}

function parseJsonOutput(raw: string, label: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        // Fall through to the bounded error below.
      }
    }
  }
  throw new Error(`${label} returned malformed JSON`);
}

function run(bin: string, args: string[], label: string): string {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${label} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "");
}

function canonicalPath(path: string): string {
  return realpathSync(path);
}

function canonicalWorkspacePath(path: string): string {
  try {
    return canonicalPath(path);
  } catch {
    return resolve(path);
  }
}

function loadInventory(path: string): InventoryRecord[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("inventory must be a JSON array");
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`inventory[${index}] must be an object`);
    const record = value as Partial<InventoryRecord>;
    for (const field of ["abs", "path", "name", "group"] as const) {
      if (typeof record[field] !== "string" || record[field] === "") {
        throw new Error(`inventory[${index}].${field} must be a non-empty string`);
      }
    }
    return record as InventoryRecord;
  });
}

function loadPreferences(path: string | null): Preferences {
  const parsed = path
    ? (JSON.parse(readFileSync(path, "utf8")) as Preferences)
    : DEFAULT_PREFERENCES;
  if (!parsed || typeof parsed !== "object" || !parsed.providers || typeof parsed.providers !== "object") {
    throw new Error("preferences must contain a providers object");
  }
  for (const role of REQUIRED_ROLES) {
    // Either "provider/model" (a provider with a selectable model catalog)
    // or a bare provider name (a standalone-registered provider with no
    // model selection to express -- see validatePreferenceTargets()'s
    // comment for why this shape is required for "extends: acp" providers).
    if (typeof parsed.providers[role] !== "string" || parsed.providers[role] === "") {
      throw new Error(`preferences.providers.${role} must be a non-empty provider or provider/model string`);
    }
  }
  const actualRoles = Object.keys(parsed.providers).sort();
  const expectedRoles = [...REQUIRED_ROLES].sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    throw new Error(`preferences providers must contain exactly: ${expectedRoles.join(", ")}`);
  }
  if (!Array.isArray(parsed.preferences) || !parsed.preferences.every((item) => typeof item === "string")) {
    throw new Error("preferences.preferences must be a string array");
  }
  return parsed;
}

function listWorkspaces(options: Options): Workspace[] {
  const parsed = parseJsonOutput(
    run(options.paseoBin, ["--json", "workspace", "ls"], "paseo workspace ls"),
    "paseo workspace ls",
  );
  if (!Array.isArray(parsed)) throw new Error("paseo workspace ls must return an array");
  return parsed.map((value, index) => {
    const workspace = value as Workspace;
    if (!workspace || typeof workspace.cwd !== "string" || typeof workspace.workspaceId !== "string") {
      throw new Error(`workspace[${index}] has an invalid shape`);
    }
    return workspace;
  });
}

// Preference targets come in two shapes:
//   "provider/model"  -- a provider with a selectable model catalog (e.g.
//                         "claude/claude-fable-5"); validated by checking the
//                         model id appears in `paseo provider models <provider>`.
//   "provider-name"   -- a bare, standalone-registered provider with no
//                         model selection to validate. This is the shape
//                         every Paseo "extends: acp" provider actually uses
//                         (confirmed live 2026-08-02: Paseo's own daemon log
//                         says "acp does not expose ACP model selection",
//                         and `paseo provider models <acp-provider>` returns
//                         `[]`, not an error -- an empty catalog is the
//                         expected, valid response for this provider kind,
//                         not a validation failure). Role-specific routing
//                         for these providers is expressed by registering a
//                         separate named provider per role (see
//                         package/router/omniroute-acp-agent.ts's
//                         TEMPERANCE_OMNIROUTE_MODEL_HINT env var and the
//                         omniroute-dispatch/-plan/-validate/-write-research
//                         entries in ~/.paseo/config.json), not by a
//                         provider/model split.
function validatePreferenceTargets(options: Options, preferences: Preferences): void {
  const withModel = new Map<string, Set<string>>();
  const bareProviders = new Set<string>();
  for (const target of Object.values(preferences.providers)) {
    const separator = target.indexOf("/");
    if (separator === -1) {
      bareProviders.add(target);
      continue;
    }
    const provider = target.slice(0, separator);
    const model = target.slice(separator + 1);
    if (!withModel.has(provider)) withModel.set(provider, new Set());
    withModel.get(provider)!.add(model);
  }

  for (const [provider, expectedModels] of withModel) {
    const parsed = parseJsonOutput(
      run(options.paseoBin, ["--json", "provider", "models", provider], `paseo provider models ${provider}`),
      `paseo provider models ${provider}`,
    );
    if (!Array.isArray(parsed)) throw new Error(`provider ${provider} models must be an array`);
    const available = new Set(
      parsed
        .map((value) => (value && typeof value === "object" ? (value as { id?: unknown }).id : null))
        .filter((value): value is string => typeof value === "string"),
    );
    const missing = [...expectedModels].filter((model) => !available.has(model));
    if (missing.length) throw new Error(`provider ${provider} is missing models: ${missing.join(", ")}`);
  }

  for (const provider of bareProviders) {
    // A bare provider name has no model to check -- confirm the provider
    // itself is registered and reachable (the command succeeds; an empty
    // model list is expected and valid for ACP providers, not an error).
    parseJsonOutput(
      run(options.paseoBin, ["--json", "provider", "models", provider], `paseo provider models ${provider}`),
      `paseo provider models ${provider}`,
    );
  }
}

function validateRecord(record: InventoryRecord, index: number): Outcome {
  const base: Outcome = {
    index,
    path: record.path,
    abs: record.abs,
    canonicalPath: null,
    name: record.name,
    group: record.group,
    status: "error",
    reason: null,
    workspaceIds: [],
  };
  try {
    if (!existsSync(record.abs) || !statSync(record.abs).isDirectory()) {
      return { ...base, reason: "path-missing" };
    }
    const canonical = canonicalPath(record.abs);
    const gitRootRaw = run("git", ["-C", record.abs, "rev-parse", "--show-toplevel"], `git root ${record.path}`);
    const gitRootText = stripLineEnding(gitRootRaw);
    const gitRoot = canonicalPath(gitRootText);
    if (gitRoot !== canonical) {
      return { ...base, canonicalPath: canonical, reason: `not-exact-git-root:${gitRoot}` };
    }
    return {
      ...base,
      canonicalPath: canonical,
      status: "planned-create",
      reason: null,
    };
  } catch (error) {
    return { ...base, reason: `git-validation:${error instanceof Error ? error.message : String(error)}` };
  }
}

function counts(outcomes: Outcome[]): Record<string, number> {
  const result: Record<string, number> = {
    inventory: outcomes.length,
    valid: outcomes.filter((item) => item.canonicalPath !== null && item.status !== "error").length,
    preserved: outcomes.filter((item) => item.status === "preserved").length,
    plannedCreate: outcomes.filter((item) => item.status === "planned-create").length,
    created: outcomes.filter((item) => item.status === "created").length,
    errors: outcomes.filter((item) => item.status === "error").length,
    duplicatePaths: outcomes.filter((item) => item.duplicateWorkspace).length,
  };
  return result;
}

function writeJsonAtomic(path: string, value: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

function writeReceipt(path: string, receipt: Receipt): void {
  receipt.counts = counts(receipt.outcomes);
  writeJsonAtomic(path, receipt);
}

function acquireApplyLock(options: Options): string {
  const lockPath = join(options.paseoHome, "locks", "vault-portfolio-reconcile.lock");
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `portfolio reconciliation lock exists at ${lockPath}; verify no apply is running, then remove only that stale lock (${detail})`,
    );
  }
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify({
        pid: process.pid,
        startedAt: timestamp(),
        inventoryPath: options.inventoryPath,
      })}\n`,
    );
  } finally {
    closeSync(descriptor);
  }
  return lockPath;
}

function releaseApplyLock(lockPath: string | null): void {
  if (lockPath && existsSync(lockPath)) unlinkSync(lockPath);
}

function snapshotRegistry(options: Options, receipt: Receipt): string {
  const destination = join(options.paseoHome, "backups", `portfolio-${receipt.receiptId}`);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of ["projects.json", "workspaces.json"]) {
    const source = join(options.paseoHome, "projects", file);
    if (existsSync(source)) {
      const snapshot = join(destination, file);
      copyFileSync(source, snapshot);
      chmodSync(snapshot, 0o600);
    }
  }
  receipt.snapshotPath = destination;
  receipt.events.push({ at: timestamp(), type: "registry-snapshot", detail: destination });
  return destination;
}

function createWorkspace(options: Options, outcome: Outcome): { workspaceId: string; projectId?: string } {
  const parsed = parseJsonOutput(
    run(
      options.paseoBin,
      [
        "--json",
        "workspace",
        "create",
        "--isolation",
        "local",
        "--path",
        outcome.abs,
        "--title",
        `${outcome.group}/${outcome.name}`,
      ],
      `paseo workspace create ${outcome.path}`,
    ),
    `paseo workspace create ${outcome.path}`,
  ) as Record<string, unknown>;
  const workspaceId =
    typeof parsed.workspaceId === "string"
      ? parsed.workspaceId
      : typeof parsed.id === "string"
        ? parsed.id
        : null;
  if (!workspaceId) throw new Error("workspace create response omitted workspaceId");
  return {
    workspaceId,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
  };
}

function applyPreferences(
  options: Options,
  receipt: Receipt,
  receiptPath: string,
  preferences: Preferences,
): void {
  const destination = join(options.paseoHome, "orchestration-preferences.json");
  const desired = `${JSON.stringify(preferences, null, 2)}\n`;
  const current = existsSync(destination) ? readFileSync(destination, "utf8") : null;
  if (current === desired) {
    receipt.events.push({ at: timestamp(), type: "preferences-unchanged", detail: destination });
    return;
  }
  if (current !== null) {
    const backup = join(options.paseoHome, "backups", `orchestration-preferences-${receipt.receiptId}.json`);
    mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
    copyFileSync(destination, backup);
    receipt.preferences.backupPath = backup;
    receipt.events.push({ at: timestamp(), type: "preferences-backup", detail: backup });
  }
  writeJsonAtomic(destination, preferences);
  receipt.preferences.changed = true;
  receipt.events.push({ at: timestamp(), type: "preferences-write", detail: destination });
  writeReceipt(receiptPath, receipt);
}

function printSummary(receipt: Receipt, receiptPath: string): void {
  console.log(
    JSON.stringify(
      {
        mode: receipt.mode,
        aborted: receipt.aborted,
        counts: receipt.counts,
        duplicateWorkspaces: receipt.outcomes
          .filter((item) => item.duplicateWorkspace)
          .map((item) => ({ path: item.path, workspaceIds: item.workspaceIds })),
        errors: receipt.outcomes
          .filter((item) => item.status === "error")
          .map((item) => ({ path: item.path, reason: item.reason })),
        snapshotPath: receipt.snapshotPath,
        receiptPath,
        preferencesChanged: receipt.preferences.changed,
      },
      null,
      2,
    ),
  );
}

export function main(argv = process.argv.slice(2)): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const started = new Date();
  const receiptId = `${stampForPath(started)}-${process.pid}`;
  const receiptPath = join(options.receiptDir, `vault-portfolio-${receiptId}.json`);
  let receipt: Receipt | null = null;
  let applyLockPath: string | null = null;

  try {
    if (options.mode === "apply") applyLockPath = acquireApplyLock(options);
    const inventory = loadInventory(options.inventoryPath);
    const preferences = loadPreferences(options.preferencesPath);
    validatePreferenceTargets(options, preferences);
    const workspaces = listWorkspaces(options);
    const workspaceByPath = new Map<string, Workspace[]>();
    for (const workspace of workspaces) {
      const path = canonicalWorkspacePath(workspace.cwd);
      if (!workspaceByPath.has(path)) workspaceByPath.set(path, []);
      workspaceByPath.get(path)!.push(workspace);
    }

    const outcomes = inventory.map(validateRecord);
    for (const outcome of outcomes) {
      if (!outcome.canonicalPath || outcome.status === "error") continue;
      const existing = workspaceByPath.get(outcome.canonicalPath) || [];
      if (existing.length) {
        outcome.status = "preserved";
        outcome.workspaceIds = existing.map((workspace) => workspace.workspaceId).sort();
        outcome.duplicateWorkspace = existing.length > 1;
      }
    }

    receipt = {
      schemaVersion: 1,
      receiptId,
      mode: options.mode,
      inventoryPath: options.inventoryPath,
      paseoHome: options.paseoHome,
      startedAt: started.toISOString(),
      completedAt: null,
      aborted: false,
      allowInvalid: options.allowInvalid,
      snapshotPath: null,
      preferences: {
        path: join(options.paseoHome, "orchestration-preferences.json"),
        validated: true,
        changed: false,
        backupPath: null,
        providers: preferences.providers,
      },
      counts: {},
      outcomes,
      events: [{ at: timestamp(), type: "preflight-complete" }],
    };
    writeReceipt(receiptPath, receipt);

    const inventoryErrors = outcomes.filter((outcome) => outcome.status === "error");
    if (options.mode === "apply" && inventoryErrors.length && !options.allowInvalid) {
      receipt.aborted = true;
      receipt.completedAt = timestamp();
      receipt.events.push({
        at: timestamp(),
        type: "apply-aborted",
        detail: `${inventoryErrors.length} invalid inventory record(s); use --allow-invalid after review`,
      });
      writeReceipt(receiptPath, receipt);
      printSummary(receipt, receiptPath);
      return 2;
    }

    if (options.mode === "apply") {
      const planned = outcomes.filter((outcome) => outcome.status === "planned-create");
      if (planned.length) {
        snapshotRegistry(options, receipt);
        writeReceipt(receiptPath, receipt);
      }
      let createFailed = false;
      for (const outcome of planned) {
        try {
          const existing = listWorkspaces(options)
            .filter(
              (workspace) =>
                outcome.canonicalPath !== null &&
                canonicalWorkspacePath(workspace.cwd) === outcome.canonicalPath,
            )
            .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
          if (existing.length) {
            outcome.status = "preserved";
            outcome.workspaceIds = existing.map((workspace) => workspace.workspaceId);
            outcome.duplicateWorkspace = existing.length > 1;
            receipt.events.push({
              at: timestamp(),
              type: "workspace-preserved-after-recheck",
              detail: `${outcome.path}\t${outcome.workspaceIds.join(",")}`,
            });
            writeReceipt(receiptPath, receipt);
            continue;
          }
          const created = createWorkspace(options, outcome);
          outcome.status = "created";
          outcome.workspaceIds = [created.workspaceId];
          outcome.projectId = created.projectId;
          receipt.events.push({
            at: timestamp(),
            type: "workspace-created",
            detail: `${outcome.path}\t${created.workspaceId}`,
          });
        } catch (error) {
          createFailed = true;
          outcome.status = "error";
          outcome.reason = `workspace-create:${error instanceof Error ? error.message : String(error)}`;
          receipt.events.push({ at: timestamp(), type: "workspace-create-error", detail: outcome.path });
        }
        writeReceipt(receiptPath, receipt);
      }
      if (!createFailed) applyPreferences(options, receipt, receiptPath, preferences);
      receipt.completedAt = timestamp();
      receipt.events.push({ at: timestamp(), type: "apply-complete" });
      writeReceipt(receiptPath, receipt);
      printSummary(receipt, receiptPath);
      return createFailed ? 1 : 0;
    }

    receipt.completedAt = timestamp();
    receipt.events.push({ at: timestamp(), type: "dry-run-complete" });
    writeReceipt(receiptPath, receipt);
    printSummary(receipt, receiptPath);
    return 0;
  } catch (error) {
    if (receipt) {
      receipt.aborted = true;
      receipt.completedAt = timestamp();
      receipt.events.push({
        at: timestamp(),
        type: "fatal-error",
        detail: error instanceof Error ? error.message : String(error),
      });
      writeReceipt(receiptPath, receipt);
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    releaseApplyLock(applyLockPath);
  }
}

if (import.meta.main) {
  process.exitCode = main();
}
