#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { isCanonicalRepositoryBasename } from "../package/relocation/project-relocation-grammar";
import { parseFlatProjectYaml } from "../package/relocation/project-packet";
import { validateProjectYaml } from "../package/relocation/project-packet-schema";
import {
  listRegistryEntryIdentities,
  registryEntryPath,
  registryRootFor,
} from "../package/relocation/project-registry";
import { applyRelocationTransaction } from "../package/relocation/project-relocation-apply";
import { classifyRepositoryByGitToplevel } from "../package/relocation/project-repository-classification";
import { performRollback } from "../package/relocation/project-relocation-rollback";
import {
  buildSessionMap,
  applyClaudeCodeRelink,
  writeSessionMap,
} from "../package/relocation/project-session-map";

const DESTINATION_ROOT = "/Volumes/madara/2026/Projects";
const PORTFOLIO_ROOTS = {
  thoughtseed: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed",
  "tryambakam-noesis": "/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis",
} as const;
type Portfolio = keyof typeof PORTFOLIO_ROOTS;

const REGISTRY_HOST_ROOTS: Record<Portfolio, string> = {
  thoughtseed: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-labs",
  "tryambakam-noesis": "/Volumes/madara/2026/twc-vault/_System/10865xseed",
};

const OTHER_PORTFOLIO: Record<Portfolio, Portfolio> = {
  thoughtseed: "tryambakam-noesis",
  "tryambakam-noesis": "thoughtseed",
};

const ALWAYS_HELD_THOUGHTSEED_NAMES = new Set([
  "10869",
  "temperance_engine",
  "snow-gloves-os",
  "snow-gloves-ci-fix",
  "snow-gloves-variable-contracts",
  "hermes-aws-ts",
  "thoughtseed-labs",
]);

interface InventoryRecord {
  portfolio: Portfolio;
  sourceRoot: string;
  name: string;
  path: string;
  entryType: "directory" | "file" | "symlink" | "other";
  repositoryKind: "standalone-repository" | "nested-repository" | "not-a-repository" | "held";
  gitTopLevel: string | null;
  gitCommonDir: string | null;
  head: string | null;
  branch: string | null;
  remotes: string[];
  statusPorcelainV2Sha256: string | null;
  device: number | null;
  inode: number | null;
  proposedDestination: string;
  grammarAccepted: boolean;
  destinationExists: boolean;
  disposition: "candidate" | "held" | "out-of-scope";
  holdReasons: string[];
}

interface InventoryReport {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  destinationRoot: string;
  approvedPortfolios: Portfolio[];
  roots: Record<Portfolio, { path: string; present: boolean; immediateChildCount: number }>;
  records: InventoryRecord[];
  counts: Record<string, number>;
}

interface PlanReport {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  dryRun: true;
  canarySelectionApproved: true;
  manifestApprovalRequired: true;
  source: string;
  destination: string;
  portfolio: Portfolio | null;
  repository: Pick<InventoryRecord, "name" | "entryType" | "repositoryKind" | "gitTopLevel" | "gitCommonDir" | "head" | "branch" | "remotes" | "statusPorcelainV2Sha256" | "device" | "inode">;
  packet: {
    required: string[];
    present: string[];
    missing: string[];
    digest: string | null;
    identityStatus: "pending-teamforge-verification" | "verified-teamforge" | "unknown";
  };
  integrity: { trackedInventorySha256: string | null; ignoredInventorySha256: string | null };
  pathConsumers: { checkedInMatches: string[] };
  collision: { normalizedIdentity: string | null; destinationExists: boolean; disposition: "fail-closed" };
  holdReasons: string[];
  ready: false;
}

function usage(): never {
  console.error(`Usage:
  bun scripts/vault-project-relocation.ts inventory \
    --portfolio thoughtseed \
    --portfolio tryambakam-noesis \
    --output <owner-only-report.json>
  bun scripts/vault-project-relocation.ts plan \
    --repository <absolute-source-path> \
    --dry-run \
    --output <owner-only-manifest.json>
  bun scripts/vault-project-relocation.ts apply \
    --repository <absolute-source-path> \
    --manifest-digest <owner-approved-stable-manifest-digest> \
    --lock <absolute-lock-path> \
    --receipt-output <absolute-receipt-path> \
    [--registry-baseline-digest <sha256>]
  bun scripts/vault-project-relocation.ts rollback \
    --receipt <absolute-receipt-path>
  bun scripts/vault-project-relocation.ts session-map \
    --repository <absolute-new-path> \
    [--no-relink]`);
  process.exit(2);
}

/**
 * The digest an owner approves and later matches against a fresh apply-time
 * regeneration. Excludes generatedAt — a plan's timestamp changes every
 * call, so hashing the raw report would make no two independently-built
 * plans of the same real state ever match, defeating the entire point of
 * an "exact approved digest" gate.
 */
function stableManifestDigest(plan: PlanReport): string {
  const { generatedAt, ...stable } = plan;
  return sha256(JSON.stringify(stable));
}

/**
 * Reads the live te-* lane manifest rather than keeping a hardcoded copy
 * that could drift from the real source of truth.
 */
function approvedLanes(): string[] {
  const workflowsPath = resolve(import.meta.dir, "..", "package/router/temperance-workflows.json");
  if (!existsSync(workflowsPath)) return [];
  const raw = readFileSync(workflowsPath, "utf8");
  return [...new Set([...raw.matchAll(/"(te-[a-z-]+)"/g)].map((match) => match[1]))];
}

function parseArgs(argv: string[]): { portfolios: Portfolio[]; output: string } {
  if (argv[0] !== "inventory") usage();
  const portfolios: Portfolio[] = [];
  let output = "";
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--portfolio") {
      const value = argv[++i];
      if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
        throw new Error(`portfolio_not_allowed:${value ?? ""}`);
      }
      if (!portfolios.includes(value)) portfolios.push(value);
    } else if (arg === "--output") {
      output = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  if (portfolios.length === 0 || !output || !isAbsolute(output)) {
    throw new Error("two_portfolios_and_absolute_output_required");
  }
  return { portfolios, output: resolve(output) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(path: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function gitRemotes(path: string): string[] {
  const value = git(path, ["remote", "get-url", "--all", "origin"]);
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function classifyRepository(path: string): Pick<InventoryRecord, "repositoryKind" | "gitTopLevel" | "gitCommonDir" | "head" | "branch" | "remotes" | "statusPorcelainV2Sha256"> {
  const { repositoryKind, gitTopLevel } = classifyRepositoryByGitToplevel(path);
  if (repositoryKind === "not-a-repository") {
    return {
      repositoryKind,
      gitTopLevel: null,
      gitCommonDir: null,
      head: null,
      branch: null,
      remotes: [],
      statusPorcelainV2Sha256: null,
    };
  }
  const gitCommonDirRaw = git(path, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = gitCommonDirRaw ? resolve(path, gitCommonDirRaw) : null;
  const status = spawnSync("git", ["-C", path, "status", "--porcelain=v2", "--untracked-files=all"], { encoding: "utf8" });
  const statusText = status.status === 0 ? status.stdout : null;
  return {
    repositoryKind,
    gitTopLevel,
    gitCommonDir,
    head: git(path, ["rev-parse", "HEAD"]),
    branch: git(path, ["branch", "--show-current"]),
    remotes: gitRemotes(path),
    statusPorcelainV2Sha256: statusText == null ? null : sha256(statusText),
  };
}

function inventoryEntry(portfolio: Portfolio, sourceRoot: string, name: string): InventoryRecord {
  const path = join(sourceRoot, name);
  const proposedDestination = join(DESTINATION_ROOT, portfolio, name);
  const holdReasons: string[] = [];
  let entryType: InventoryRecord["entryType"] = "other";
  let repository = {
    repositoryKind: "not-a-repository" as InventoryRecord["repositoryKind"],
    gitTopLevel: null as string | null,
    gitCommonDir: null as string | null,
    head: null as string | null,
    branch: null as string | null,
    remotes: [] as string[],
    statusPorcelainV2Sha256: null as string | null,
  };
  let device: number | null = null;
  let inode: number | null = null;
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) entryType = "symlink";
    else if (stats.isDirectory()) entryType = "directory";
    else if (stats.isFile()) entryType = "file";
    device = Number(stats.dev);
    inode = Number(stats.ino);
    if (entryType === "directory") repository = classifyRepository(path);
  } catch (error) {
    holdReasons.push(`lstat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  const grammarAccepted = isCanonicalRepositoryBasename(name);
  if (!grammarAccepted) holdReasons.push("basename_not_canonical");
  if (entryType !== "directory") holdReasons.push(`entry_type:${entryType}`);
  if (repository.repositoryKind !== "standalone-repository") holdReasons.push(repository.repositoryKind);
  if (portfolio === "thoughtseed" && ALWAYS_HELD_THOUGHTSEED_NAMES.has(name)) {
    holdReasons.push(name === "thoughtseed-labs" ? "pinned_knowledge_vault" : "owner_mapping_or_active_control_hold");
  }
  if (portfolio === "tryambakam-noesis") holdReasons.push("tn_registry_baseline_unresolved");
  if (existsSync(proposedDestination)) holdReasons.push("destination_exists");
  const disposition = holdReasons.length === 0 ? "candidate" : "held";
  return {
    portfolio,
    sourceRoot,
    name,
    path,
    entryType,
    ...repository,
    device,
    inode,
    proposedDestination,
    grammarAccepted,
    destinationExists: existsSync(proposedDestination),
    disposition,
    holdReasons,
  };
}

function buildReport(portfolios: Portfolio[]): InventoryReport {
  const records: InventoryRecord[] = [];
  const roots = {} as InventoryReport["roots"];
  for (const portfolio of portfolios) {
    const sourceRoot = PORTFOLIO_ROOTS[portfolio];
    const present = existsSync(sourceRoot) && lstatSync(sourceRoot).isDirectory();
    const names = present ? readdirSync(sourceRoot).sort() : [];
    roots[portfolio] = { path: sourceRoot, present, immediateChildCount: names.length };
    for (const name of names) records.push(inventoryEntry(portfolio, sourceRoot, name));
  }
  const counts: Record<string, number> = { total: records.length };
  for (const record of records) {
    counts[record.disposition] = (counts[record.disposition] ?? 0) + 1;
    counts[record.repositoryKind] = (counts[record.repositoryKind] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    destinationRoot: DESTINATION_ROOT,
    approvedPortfolios: portfolios,
    roots,
    records,
    counts,
  };
}

const REQUIRED_PACKET_FILES = [
  "PROJECT.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".project/CONTEXT.md",
  ".project/project.yaml",
  ".project/HANDOFF.md",
];

function inferPortfolio(path: string): Portfolio | null {
  for (const [portfolio, root] of Object.entries(PORTFOLIO_ROOTS) as Array<[Portfolio, string]>) {
    if (dirname(path) === root) return portfolio;
  }
  return null;
}

function trackedInventorySha(path: string): string | null {
  const value = git(path, ["ls-files", "-z"]);
  return value == null ? null : sha256(value);
}

function gitGrepFiles(path: string, literal: string): string[] {
  const result = spawnSync("git", ["-C", path, "grep", "-l", "-I", "-F", "--", literal, "--", "."], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
}

function packetDigest(path: string, present: string[]): string | null {
  if (present.length !== REQUIRED_PACKET_FILES.length) return null;
  const content = present.map((file) => `${file}\0${readFileSync(join(path, file), "utf8")}`).join("\0");
  return sha256(content);
}

function packetIdentityStatus(
  path: string,
  present: string[],
): "pending-teamforge-verification" | "verified-teamforge" | "unknown" {
  if (present.length !== REQUIRED_PACKET_FILES.length) return "unknown";
  const yaml = readFileSync(join(path, ".project/project.yaml"), "utf8");
  if (
    /(^|\n)packet_status:\s*draft-held\s*(?:#.*)?$/m.test(yaml)
    || /(^|\n)project_id:\s*null\s*(?:#.*)?$/m.test(yaml)
    || /(^|\n)identity_status:\s*pending-teamforge-verification\s*(?:#.*)?$/m.test(yaml)
  ) {
    return "pending-teamforge-verification";
  }
  if (
    /(^|\n)identity_status:\s*verified-teamforge\s*(?:#.*)?$/m.test(yaml)
    && /(^|\n)project_id:\s*[^\s#]+\s*(?:#.*)?$/m.test(yaml)
  ) {
    return "verified-teamforge";
  }
  return "unknown";
}

function buildPlan(sourcePath: string): PlanReport {
  const source = resolve(sourcePath);
  const name = basename(source);
  const portfolio = inferPortfolio(source);
  const holdReasons: string[] = [];
  const destination = portfolio ? join(DESTINATION_ROOT, portfolio, name) : join(DESTINATION_ROOT, "unknown", name);
  const repository = classifyRepository(source);
  let device: number | null = null;
  let inode: number | null = null;
  let entryType: InventoryRecord["entryType"] = "other";
  try {
    const stats = lstatSync(source);
    device = Number(stats.dev);
    inode = Number(stats.ino);
    entryType = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
  } catch (error) {
    holdReasons.push(`lstat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  if (!portfolio) holdReasons.push("source_not_under_approved_portfolio_root");
  if (entryType !== "directory") holdReasons.push(`entry_type:${entryType}`);
  if (repository.repositoryKind !== "standalone-repository") holdReasons.push(repository.repositoryKind);
  if (!isCanonicalRepositoryBasename(name)) holdReasons.push("basename_not_canonical");
  const present = REQUIRED_PACKET_FILES.filter((file) => existsSync(join(source, file)));
  const missing = REQUIRED_PACKET_FILES.filter((file) => !present.includes(file));
  if (missing.length > 0) holdReasons.push(`packet_missing:${missing.join(",")}`);
  const identityStatus = packetIdentityStatus(source, present);
  if (identityStatus === "pending-teamforge-verification") holdReasons.push("packet_identity_pending_teamforge");
  if (identityStatus === "unknown") holdReasons.push("packet_identity_unrecognized");
  const checkedInMatches = [...new Set([
    ...gitGrepFiles(source, source),
    ...gitGrepFiles(source, "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/${name}"),
  ])];
  if (checkedInMatches.length > 0) holdReasons.push("checked_in_path_consumer");
  if (existsSync(destination)) holdReasons.push("destination_exists");
  const status = spawnSync("git", ["-C", source, "status", "--porcelain=v2", "--untracked-files=all"], { encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim().length > 0) holdReasons.push("working_tree_not_clean");
  const ignored = spawnSync("git", ["-C", source, "status", "--porcelain=v2", "--ignored", "--untracked-files=all"], { encoding: "utf8" });
  const ignoredInventorySha256 = ignored.status === 0 ? sha256(ignored.stdout) : null;
  const normalizedIdentity = isCanonicalRepositoryBasename(name) ? name : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    dryRun: true,
    canarySelectionApproved: true,
    manifestApprovalRequired: true,
    source,
    destination,
    portfolio,
    repository: {
      name,
      entryType,
      repositoryKind: repository.repositoryKind,
      gitTopLevel: repository.gitTopLevel,
      gitCommonDir: repository.gitCommonDir,
      head: repository.head,
      branch: repository.branch,
      remotes: repository.remotes,
      statusPorcelainV2Sha256: repository.statusPorcelainV2Sha256,
      device,
      inode,
    },
    packet: {
      required: REQUIRED_PACKET_FILES,
      present,
      missing,
      digest: packetDigest(source, present),
      identityStatus,
    },
    pathConsumers: { checkedInMatches },
    collision: { normalizedIdentity, destinationExists: existsSync(destination), disposition: "fail-closed" },
    integrity: {
      trackedInventorySha256: trackedInventorySha(source),
      ignoredInventorySha256,
    },
    holdReasons,
    ready: false,
  };
}

function writeOwnerOnly(output: string, report: InventoryReport): void {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  chmodSync(dirname(output), 0o700);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "w" });
  chmodSync(output, 0o600);
}

function parseFlagArgs(argv: string[], flags: string[]): Record<string, string | true> {
  const values: Record<string, string | true> = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!flags.includes(arg)) throw new Error(`unknown_argument:${arg}`);
    if (arg === "--dry-run") {
      values[arg] = true;
    } else {
      values[arg] = argv[++i] ?? "";
    }
  }
  return values;
}

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "plan") {
    const values = parseFlagArgs(argv, ["--repository", "--output", "--dry-run"]);
    const repository = typeof values["--repository"] === "string" ? values["--repository"] : "";
    const output = typeof values["--output"] === "string" ? values["--output"] : "";
    const dryRun = values["--dry-run"] === true;
    if (!repository || !output || !isAbsolute(repository) || !isAbsolute(output) || !dryRun) {
      throw new Error("plan_requires_absolute_repository_output_and_dry_run");
    }
    const plan = buildPlan(repository);
    writeOwnerOnly(resolve(output), plan);
    console.log(
      JSON.stringify({
        output: resolve(output),
        readOnly: true,
        ready: plan.ready,
        holdReasons: plan.holdReasons,
        stableManifestDigest: stableManifestDigest(plan),
      }),
    );
  } else if (argv[0] === "apply") {
    const values = parseFlagArgs(argv, [
      "--repository",
      "--manifest-digest",
      "--lock",
      "--receipt-output",
      "--registry-baseline-digest",
    ]);
    const repository = typeof values["--repository"] === "string" ? values["--repository"] : "";
    const manifestDigest = typeof values["--manifest-digest"] === "string" ? values["--manifest-digest"] : "";
    const lockPath = typeof values["--lock"] === "string" ? values["--lock"] : "";
    const receiptOutput = typeof values["--receipt-output"] === "string" ? values["--receipt-output"] : "";
    const registryBaselineDigest =
      typeof values["--registry-baseline-digest"] === "string" ? values["--registry-baseline-digest"] : undefined;
    if (
      !repository ||
      !manifestDigest ||
      !lockPath ||
      !receiptOutput ||
      !isAbsolute(repository) ||
      !isAbsolute(lockPath) ||
      !isAbsolute(receiptOutput)
    ) {
      throw new Error("apply_requires_absolute_repository_lock_receipt_output_and_manifest_digest");
    }

    const source = resolve(repository);
    const plan = buildPlan(source);
    if (!plan.portfolio) throw new Error("source_not_under_approved_portfolio_root");

    const projectYamlPath = join(source, ".project/project.yaml");
    const parsedYaml = existsSync(projectYamlPath)
      ? parseFlatProjectYaml(readFileSync(projectYamlPath, "utf8"))
      : {};
    const packetValidation = validateProjectYaml(parsedYaml, { approvedLanes: approvedLanes() });

    const registryHostRoot = REGISTRY_HOST_ROOTS[plan.portfolio];
    const registryHostStatus = spawnSync(
      "git",
      ["-C", registryHostRoot, "status", "--porcelain=v2", "--untracked-files=all"],
      { encoding: "utf8" },
    );

    const result = applyRelocationTransaction({
      source,
      destination: plan.destination,
      portfolio: plan.portfolio,
      stableId:
        typeof (parsedYaml as Record<string, unknown>).project_id === "string"
          ? ((parsedYaml as Record<string, unknown>).project_id as string)
          : plan.repository.name,
      githubIdentity:
        typeof (parsedYaml as Record<string, unknown>).github_repository === "string"
          ? ((parsedYaml as Record<string, unknown>).github_repository as string)
          : undefined,
      approvedManifestDigest: manifestDigest,
      freshManifestDigest: stableManifestDigest(plan),
      packetValidation,
      packetDigest: plan.packet.digest ?? "",
      unresolvedPathConsumers: plan.pathConsumers.checkedInMatches,
      otherPortfolioRegistryEntries: listRegistryEntryIdentities(registryRootFor(OTHER_PORTFOLIO[plan.portfolio])),
      registryEntryDirectoryPath: registryEntryPath(plan.portfolio, plan.repository.name),
      registryHostStatusPorcelain: registryHostStatus.status === 0 ? registryHostStatus.stdout : "",
      approvedRegistryHostBaselineDigest: registryBaselineDigest,
      knowledgeRef:
        typeof (parsedYaml as Record<string, unknown>).knowledge_ref === "string"
          ? ((parsedYaml as Record<string, unknown>).knowledge_ref as string)
          : "",
      rollbackCommand: `bun scripts/vault-project-relocation.ts rollback --receipt ${resolve(receiptOutput)}`,
      lockFilePath: resolve(lockPath),
      receiptOutputPath: resolve(receiptOutput),
    });

    console.log(JSON.stringify(result));
    if (!result.applied) process.exit(1);
  } else if (argv[0] === "rollback") {
    const values = parseFlagArgs(argv, ["--receipt"]);
    const receipt = typeof values["--receipt"] === "string" ? values["--receipt"] : "";
    if (!receipt || !isAbsolute(receipt)) throw new Error("rollback_requires_absolute_receipt_path");
    const result = performRollback(resolve(receipt));
    console.log(JSON.stringify(result));
  } else if (argv[0] === "inventory") {
    const { portfolios, output } = parseArgs(argv);
    const report = buildReport(portfolios);
    writeOwnerOnly(output, report);
    console.log(JSON.stringify({ output, readOnly: true, counts: report.counts }));
  } else if (argv[0] === "session-map") {
    let repository = "";
    let relink = true;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--repository") repository = argv[++i] ?? "";
      else if (arg === "--no-relink") relink = false;
    }
    if (!repository || !isAbsolute(repository)) usage();

    const portfolio = inferPortfolio(repository);
    if (!portfolio) throw new Error(`session_map_portfolio_not_inferred:${repository}`);
    const repositoryName = basename(repository);

    const entryPath = registryEntryPath(portfolio, repositoryName);
    const entryFilePath = join(entryPath, "entry.json");
    if (!existsSync(entryFilePath)) {
      throw new Error(`session_map_registry_entry_not_found:${entryFilePath}`);
    }
    const registryEntry = JSON.parse(readFileSync(entryFilePath, "utf8"));

    let record = buildSessionMap(
      {
        stableId: registryEntry.stableId,
        portfolio,
        repository: repositoryName,
        oldPath: registryEntry.oldPath,
        newPath: repository,
      },
      new Date().toISOString(),
    );
    if (relink) {
      record = applyClaudeCodeRelink(record);
    }

    const outputPath = join(
      "/Users/sheshnarayaniyer/.temperance_engine",
      "session-maps",
      portfolio,
      repositoryName,
      "map.json",
    );
    writeSessionMap(outputPath, record);
    console.log(JSON.stringify({ output: outputPath, tools: record.tools }, null, 2));
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
