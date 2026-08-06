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
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import {
  isCanonicalRepositoryBasename,
  isCanonicalizableRepositorySegment,
} from "../package/relocation/project-relocation-grammar";
import { projectDestinationPath } from "../package/relocation/project-destination-path";
import { discoverNestedGitRoots } from "../package/relocation/project-nested-repo-discovery";
import { findCandidateCollisions } from "../package/relocation/project-candidate-collision";
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
import {
  planCopilotSessionFix,
  applyCopilotSessionFix,
  receiptPathFor,
} from "../package/relocation/copilot-session-fix";
import { gatherPacketEvidence, type CanonicalRegistry, type PackageManager } from "../package/relocation/packet-evidence";
import { renderPacket } from "../package/relocation/packet-draft";
import { synthesizeScaffoldEvidence, type ScaffoldInput } from "../package/relocation/project-scaffold";
import { resolveWorkflowProvenance, renderWorkflowProvenanceMd } from "../package/relocation/workflow-provenance";
import { writeWorkObjectEntry } from "../package/relocation/work-object-registry-write";

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

/**
 * Returns the pinned/owner-held segment on a candidate's vault-relative path,
 * or null. Unlike the registry-readiness rules -- which really are specific to
 * the direct-child list and do not generalize -- containment generalizes
 * exactly: if `thoughtseed-labs` is pinned, a repository *inside* it is pinned
 * too. Without this, `thoughtseed-labs/hermes-aws-ts` surfaced as a live
 * candidate despite BOTH its own basename and its container being named in
 * ALWAYS_HELD_THOUGHTSEED_NAMES, and relocating it would have moved a
 * repository out of the registry host root itself.
 */
function heldSegmentOnPath(portfolio: Portfolio, sourceRoot: string, path: string): string | null {
  if (portfolio !== "thoughtseed") return null;
  const rootSegments = resolve(sourceRoot).split(sep).filter(Boolean);
  const pathSegments = resolve(path).split(sep).filter(Boolean);
  for (const segment of pathSegments.slice(rootSegments.length)) {
    if (ALWAYS_HELD_THOUGHTSEED_NAMES.has(segment)) return segment;
  }
  return null;
}

function heldReasonFor(segment: string): string {
  return segment === "thoughtseed-labs" ? "pinned_knowledge_vault" : "owner_mapping_or_active_control_hold";
}

interface ProjectedDestination {
  destination: string;
  tenant: string | null;
  rewritten: { from: string; to: string; index: number }[];
  holdReason: string | null;
}

/**
 * Destination projection that degrades to a hold instead of throwing, so a
 * single unprojectable name (a worktree directory, a dotted basename) can
 * never abort a whole inventory scan. The fallback path is for the report
 * only -- the accompanying hold reason keeps the entry from ever moving.
 */
function projectDestination(
  portfolio: Portfolio,
  sourceRoot: string,
  path: string,
): ProjectedDestination {
  try {
    const projection = projectDestinationPath({
      destinationRoot: DESTINATION_ROOT,
      portfolio,
      sourceRoot,
      sourcePath: path,
    });
    return {
      destination: projection.destination,
      tenant: projection.tenant,
      rewritten: projection.rewritten,
      holdReason: null,
    };
  } catch (error) {
    return {
      destination: join(DESTINATION_ROOT, portfolio, basename(path)),
      tenant: null,
      rewritten: [],
      holdReason: `destination_not_projectable:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

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
  /** Canonical container path above the repo; null for depth-0 candidates. */
  tenant: string | null;
  /** Segments canonicalization rewrote, surfaced for the approval boundary. */
  destinationRewrites: { from: string; to: string; index: number }[];
  grammarAccepted: boolean;
  destinationExists: boolean;
  disposition: "candidate" | "held" | "out-of-scope";
  holdReasons: string[];
  depth: number;
  immediateParentPath: string | null;
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
  /** Canonical container path above the repo; null for depth-0 candidates. */
  tenant: string | null;
  /**
   * Segments canonicalization rewrote to reach `destination`. Non-empty means
   * the destination name differs from the on-disk name -- Approval Boundary B
   * must show this rather than let it pass unseen.
   */
  destinationRewrites: { from: string; to: string; index: number }[];
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
    --output <owner-only-report.json> \
    [--max-depth <n>]
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
    [--no-relink]
  bun scripts/vault-project-relocation.ts session-fix \
    --repository <new-absolute-path> \
    --tool copilot \
    [--dry-run]
  bun scripts/vault-project-relocation.ts draft-packets \
    --vault-root <absolute-portfolio-root> \
    --portfolio thoughtseed|tryambakam-noesis \
    --registry-path <absolute-registry-json-path> \
    --candidate <folder-name> [--candidate <folder-name> ...] \
    --output <owner-only-review-summary.md>
  bun scripts/vault-project-relocation.ts new-project \
    --vault-root <absolute-portfolio-root> \
    --portfolio thoughtseed|tryambakam-noesis \
    --name <new-repository-basename> \
    --kind sapling|program \
    --registry-path <absolute-work-object-registry.v1.json-path> \
    [--type <skill-clusters-workflow-id>] \
    [--workflow-registry-path <absolute-workflows/registry.json-path>] \
    --output <owner-only-receipt.json> \
    [--dry-run]`);
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

function gitRemoteUrlFor(repositoryPath: string): string | null {
  const result = spawnSync("git", ["-C", repositoryPath, "remote", "get-url", "origin"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function packageJsonScriptsFor(repositoryPath: string): Record<string, string> | null {
  const packageJsonPath = join(repositoryPath, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof parsed.scripts === "object" && parsed.scripts !== null ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function detectPackageManager(repositoryPath: string): PackageManager {
  if (existsSync(join(repositoryPath, "bun.lock")) || existsSync(join(repositoryPath, "bun.lockb"))) return "bun";
  if (existsSync(join(repositoryPath, "pnpm-lock.yaml"))) return "pnpm";
  return "npm";
}

/**
 * A packet file is only safe to draft over if it doesn't already exist, or
 * exists with no real content. Many repos already have their own AGENTS.md
 * (or, in principle, any of the other five) for unrelated reasons — real
 * build/test instructions, coding conventions, agent rosters — and a draft
 * run must never silently destroy that. Whitespace-only content doesn't
 * count as real, so an empty placeholder file is still safe to overwrite.
 */
function detectPreExistingPacketFiles(repositoryPath: string): string[] {
  return REQUIRED_PACKET_FILES.filter((relativePath) => {
    const fullPath = join(repositoryPath, relativePath);
    if (!existsSync(fullPath)) return false;
    return readFileSync(fullPath, "utf8").trim().length > 0;
  });
}

function writePacketFiles(
  repositoryPath: string,
  files: Record<string, string>,
  skip: readonly string[],
): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    if (skip.includes(relativePath)) {
      skipped.push(relativePath);
      continue;
    }
    const fullPath = join(repositoryPath, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
    written.push(relativePath);
  }
  return { written, skipped };
}

function parseArgs(argv: string[]): { portfolios: Portfolio[]; output: string; maxDepth: number } {
  if (argv[0] !== "inventory") usage();
  const portfolios: Portfolio[] = [];
  let output = "";
  let maxDepth = 0;
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
    } else if (arg === "--max-depth") {
      const value = argv[++i] ?? "";
      if (!/^\d+$/.test(value)) throw new Error(`max_depth_must_be_a_non_negative_integer:${value}`);
      maxDepth = Number(value);
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  if (portfolios.length === 0 || !output || !isAbsolute(output)) {
    throw new Error("two_portfolios_and_absolute_output_required");
  }
  return { portfolios, output: resolve(output), maxDepth };
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
  const holdReasons: string[] = [];
  const projected = projectDestination(portfolio, sourceRoot, path);
  const proposedDestination = projected.destination;
  if (projected.holdReason) holdReasons.push(projected.holdReason);
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
  const grammarAccepted = isCanonicalizableRepositorySegment(name);
  if (!grammarAccepted) holdReasons.push("basename_not_canonicalizable");
  if (entryType !== "directory") holdReasons.push(`entry_type:${entryType}`);
  if (repository.repositoryKind !== "standalone-repository") holdReasons.push(repository.repositoryKind);
  const heldSegment = heldSegmentOnPath(portfolio, sourceRoot, path);
  if (heldSegment) holdReasons.push(heldReasonFor(heldSegment));
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
    tenant: projected.tenant,
    destinationRewrites: projected.rewritten,
    grammarAccepted,
    destinationExists: existsSync(proposedDestination),
    disposition,
    holdReasons,
    depth: 0,
    immediateParentPath: null,
  };
}

/**
 * Builds a full InventoryRecord for a path discovered by the recursive
 * nested-repo walk. Still does not apply the tn_registry_baseline_unresolved
 * hold — that is a registry-readiness concern tied to the direct-child
 * candidate list, and does not generalize to an arbitrary deep path.
 *
 * ALWAYS_HELD_THOUGHTSEED_NAMES, however, is now applied by *path
 * containment* rather than skipped. The original reasoning treated it as a
 * depth-0-only rule, but that let `thoughtseed-labs/hermes-aws-ts` surface as
 * a live candidate while both its own basename and its container were named
 * in that set. A pinned container pins what is inside it; that is containment,
 * not a blind copy of a depth-0 rule.
 */
function nestedInventoryEntry(
  portfolio: Portfolio,
  sourceRoot: string,
  found: { path: string; depth: number },
): InventoryRecord {
  const name = basename(found.path);
  const immediateParentPath = dirname(found.path);
  const holdReasons: string[] = [];
  const projected = projectDestination(portfolio, sourceRoot, found.path);
  const proposedDestination = projected.destination;
  if (projected.holdReason) holdReasons.push(projected.holdReason);
  let entryType: InventoryRecord["entryType"] = "other";
  let device: number | null = null;
  let inode: number | null = null;
  try {
    const stats = lstatSync(found.path);
    entryType = stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
    device = Number(stats.dev);
    inode = Number(stats.ino);
  } catch (error) {
    holdReasons.push(`lstat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  const repository = classifyRepository(found.path);
  const grammarAccepted = isCanonicalizableRepositorySegment(name);
  if (!grammarAccepted) holdReasons.push("basename_not_canonicalizable");
  if (entryType !== "directory") holdReasons.push(`entry_type:${entryType}`);
  if (repository.repositoryKind !== "standalone-repository") holdReasons.push(repository.repositoryKind);
  const heldSegment = heldSegmentOnPath(portfolio, sourceRoot, found.path);
  if (heldSegment) holdReasons.push(heldReasonFor(heldSegment));
  if (existsSync(proposedDestination)) holdReasons.push("destination_exists");
  const disposition = holdReasons.length === 0 ? "candidate" : "held";
  return {
    portfolio,
    sourceRoot,
    name,
    path: found.path,
    entryType,
    ...repository,
    device,
    inode,
    proposedDestination,
    tenant: projected.tenant,
    destinationRewrites: projected.rewritten,
    grammarAccepted,
    destinationExists: existsSync(proposedDestination),
    disposition,
    holdReasons,
    depth: found.depth,
    immediateParentPath,
  };
}

function buildReport(portfolios: Portfolio[], maxDepth: number): InventoryReport {
  const records: InventoryRecord[] = [];
  const roots = {} as InventoryReport["roots"];
  for (const portfolio of portfolios) {
    const sourceRoot = PORTFOLIO_ROOTS[portfolio];
    const present = existsSync(sourceRoot) && lstatSync(sourceRoot).isDirectory();
    const names = present ? readdirSync(sourceRoot).sort() : [];
    roots[portfolio] = { path: sourceRoot, present, immediateChildCount: names.length };
    for (const name of names) {
      const entry = inventoryEntry(portfolio, sourceRoot, name);
      records.push(entry);
      if (maxDepth > 0 && entry.entryType === "directory") {
        const found = discoverNestedGitRoots(entry.path, maxDepth);
        for (const nested of found) {
          records.push(nestedInventoryEntry(portfolio, sourceRoot, nested));
        }
      }
    }
  }

  // Collision detection is scoped to standalone-repository records only —
  // a genuine collision is between two things that could actually be
  // relocated as competing candidates for the same destination. A plain
  // non-git folder or a still-nested (non-standalone) entry already fails
  // on its own hold reason regardless of naming; it isn't a relocation
  // candidate at all, so it doesn't need collision protection on top.
  const collisions = findCandidateCollisions(
    records
      .filter((record) => record.repositoryKind === "standalone-repository")
      .map((record) => ({ path: record.path, repositoryName: record.name, remotes: record.remotes })),
  );
  for (const record of records) {
    const newHolds = collisions.get(record.path);
    if (newHolds) {
      record.holdReasons.push(...newHolds);
      record.disposition = "held";
    }
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

/**
 * Resolves a candidate's portfolio by path containment rather than by parent
 * equality. Parent equality admitted only direct children, which meant a
 * nested candidate (`thoughtseed/klear-karma/snowglobe`) could never be
 * planned at all -- it held on `source_not_under_approved_portfolio_root`
 * despite being plainly inside an approved root. Compares resolved segments,
 * so a sibling root that merely shares a string prefix
 * (`.../thoughtseed-labs` against `.../thoughtseed`) is not mistaken for a
 * containing root.
 */
function inferPortfolio(path: string): Portfolio | null {
  const pathSegments = resolve(path).split(sep).filter(Boolean);
  for (const [portfolio, root] of Object.entries(PORTFOLIO_ROOTS) as Array<[Portfolio, string]>) {
    const rootSegments = resolve(root).split(sep).filter(Boolean);
    if (pathSegments.length <= rootSegments.length) continue;
    if (rootSegments.every((segment, index) => pathSegments[index] === segment)) return portfolio;
  }
  return null;
}

/**
 * `--vault-root` and `--portfolio` are accepted as two independent CLI
 * flags (draft-packets and new-project both take them), which lets an
 * operator pass a mismatched pair -- e.g. a thoughtseed vault-root with
 * --portfolio tryambakam-noesis -- silently baking the wrong portfolio
 * into drafted/scaffolded packet content while writing real files under
 * the OTHER portfolio's directory tree. Checked by basename rather than
 * exact equality against PORTFOLIO_ROOTS so fixture-directory tests (which
 * use a temp root's "thoughtseed"-named child, not the real hardcoded
 * vault path) keep working -- the real portfolio roots' own basenames are
 * exactly "thoughtseed" and "tryambakam-noesis", so this check is exact
 * for real runs and still meaningful for fixtures.
 */
function assertVaultRootMatchesPortfolio(vaultRoot: string, portfolio: Portfolio): void {
  if (basename(vaultRoot) !== portfolio) {
    throw new Error(`vault_root_portfolio_mismatch:${basename(vaultRoot)}:${portfolio}`);
  }
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
  const projected: ProjectedDestination = portfolio
    ? projectDestination(portfolio, PORTFOLIO_ROOTS[portfolio], source)
    : {
        destination: join(DESTINATION_ROOT, "unknown", name),
        tenant: null,
        rewritten: [],
        holdReason: null,
      };
  const destination = projected.destination;
  if (projected.holdReason) holdReasons.push(projected.holdReason);
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
  if (!isCanonicalizableRepositorySegment(name)) holdReasons.push("basename_not_canonicalizable");
  // Previously unguarded here: `plan` relied on the basename grammar to reject
  // always-held names like `temperance_engine`, which only worked by accident
  // of its underscore. Now that underscores canonicalize, the hold has to be
  // stated explicitly or that protection disappears silently.
  if (portfolio) {
    const heldSegment = heldSegmentOnPath(portfolio, PORTFOLIO_ROOTS[portfolio], source);
    if (heldSegment) holdReasons.push(heldReasonFor(heldSegment));
  }
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
    tenant: projected.tenant,
    destinationRewrites: projected.rewritten,
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

function writeOwnerOnly<T>(output: string, report: T): void {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  chmodSync(dirname(output), 0o700);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "w" });
  chmodSync(output, 0o600);
}

/**
 * Same owner-only directory/file permissions as writeOwnerOnly, but for
 * plain-text payloads (e.g. the draft-packets review summary markdown)
 * that must not be run through JSON.stringify — doing so would collapse
 * the file into a single JSON-escaped string instead of legible markdown.
 */
function writeOwnerOnlyText(output: string, text: string): void {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  chmodSync(dirname(output), 0o700);
  writeFileSync(output, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600, flag: "w" });
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
    const { portfolios, output, maxDepth } = parseArgs(argv);
    const report = buildReport(portfolios, maxDepth);
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
  } else if (argv[0] === "session-fix") {
    let repository = "";
    let tool = "";
    let dryRun = false;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--repository") repository = argv[++i] ?? "";
      else if (arg === "--tool") tool = argv[++i] ?? "";
      else if (arg === "--dry-run") dryRun = true;
    }
    if (!repository || !isAbsolute(repository)) usage();
    if (tool !== "copilot") throw new Error(`session_fix_tool_not_supported:${JSON.stringify(tool)}`);

    const portfolio = inferPortfolio(repository);
    if (!portfolio) throw new Error(`session_fix_portfolio_not_inferred:${repository}`);
    const repositoryName = basename(repository);

    const entryPath = registryEntryPath(portfolio, repositoryName);
    const entryFilePath = join(entryPath, "entry.json");
    if (!existsSync(entryFilePath)) {
      throw new Error(`session_fix_registry_entry_not_found:${entryFilePath}`);
    }
    const registryEntry = JSON.parse(readFileSync(entryFilePath, "utf8"));

    const plan = planCopilotSessionFix({
      portfolio,
      repository: repositoryName,
      oldPath: registryEntry.oldPath,
      newPath: repository,
      generatedAt: new Date().toISOString(),
    });

    if (dryRun || plan.status !== "fixable") {
      console.log(JSON.stringify({ plan, applied: false }, null, 2));
      if (!dryRun && plan.status !== "fixable") process.exit(1);
    } else {
      const receipt = applyCopilotSessionFix(plan);
      console.log(JSON.stringify({ plan, applied: true, receiptPath: receiptPathFor(plan), receipt }, null, 2));
    }
  } else if (argv[0] === "draft-packets") {
    let vaultRoot = "";
    let portfolio: Portfolio | "" = "";
    let registryPath = "";
    let output = "";
    const candidates: string[] = [];
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--vault-root") vaultRoot = argv[++i] ?? "";
      else if (arg === "--portfolio") {
        const value = argv[++i];
        if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
          throw new Error(`portfolio_not_allowed:${value ?? ""}`);
        }
        portfolio = value;
      } else if (arg === "--registry-path") registryPath = argv[++i] ?? "";
      else if (arg === "--output") output = argv[++i] ?? "";
      else if (arg === "--candidate") candidates.push(argv[++i] ?? "");
      else throw new Error(`unknown_argument:${arg}`);
    }
    if (!vaultRoot || !portfolio || !registryPath || !output || candidates.length === 0) {
      throw new Error(
        "draft_packets_requires_vault_root_portfolio_registry_path_output_and_at_least_one_candidate",
      );
    }
    assertVaultRootMatchesPortfolio(vaultRoot, portfolio);
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    const summaryLines: string[] = ["# Packet draft summary", ""];
    let draftedCount = 0;
    let failedCount = 0;
    for (const candidateName of candidates) {
      const repositoryPath = join(vaultRoot, candidateName);
      try {
        const evidence = gatherPacketEvidence({
          candidateName,
          portfolio,
          registry,
          gitRemoteUrl: gitRemoteUrlFor(repositoryPath),
          packageJsonScripts: packageJsonScriptsFor(repositoryPath),
          packageManager: detectPackageManager(repositoryPath),
        });
        const preExisting = detectPreExistingPacketFiles(repositoryPath);
        if (preExisting.length > 0) {
          evidence.needsReview = [
            ...evidence.needsReview,
            ...preExisting.map((file) => `${file} (pre-existing, not overwritten — needs manual reconciliation)`),
          ];
        }
        const files = renderPacket(evidence);
        const { skipped } = writePacketFiles(repositoryPath, files, preExisting);
        draftedCount += 1;
        summaryLines.push(`## ${candidateName}`, "");
        summaryLines.push(`- WorkObject: \`${evidence.workObjectId}\` (${evidence.workObjectName})`);
        summaryLines.push(
          evidence.needsReview.length === 0
            ? "- All fields sourced confidently."
            : `- Needs review: ${evidence.needsReview.join(", ")}`,
        );
        if (skipped.length > 0) {
          summaryLines.push(`- Skipped (pre-existing content, not overwritten): ${skipped.join(", ")}`);
        }
        summaryLines.push("");
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        summaryLines.push(`## ${candidateName}`, "", `FAILED: ${candidateName}: ${message}`, "");
      }
    }
    summaryLines.unshift(`Drafted: ${draftedCount}. Failed: ${failedCount}.`, "");
    writeOwnerOnlyText(resolve(output), summaryLines.join("\n"));
    console.log(JSON.stringify({ output: resolve(output), drafted: draftedCount, failed: failedCount }));
  } else if (argv[0] === "new-project") {
    let vaultRoot = "";
    let portfolio: Portfolio | "" = "";
    let name = "";
    let kind: "sapling" | "program" | "" = "";
    let registryPath = "";
    let typeId = "";
    let workflowRegistryPath = "";
    let output = "";
    let dryRun = false;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--vault-root") vaultRoot = argv[++i] ?? "";
      else if (arg === "--portfolio") {
        const value = argv[++i];
        if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
          throw new Error(`portfolio_not_allowed:${value ?? ""}`);
        }
        portfolio = value;
      } else if (arg === "--name") name = argv[++i] ?? "";
      else if (arg === "--kind") {
        const value = argv[++i];
        if (value !== "sapling" && value !== "program") {
          throw new Error(`kind_not_allowed:${value ?? ""}`);
        }
        kind = value;
      } else if (arg === "--registry-path") registryPath = argv[++i] ?? "";
      else if (arg === "--type") typeId = argv[++i] ?? "";
      else if (arg === "--workflow-registry-path") workflowRegistryPath = argv[++i] ?? "";
      else if (arg === "--output") output = argv[++i] ?? "";
      else if (arg === "--dry-run") dryRun = true;
      else throw new Error(`unknown_argument:${arg}`);
    }
    if (!vaultRoot || !portfolio || !name || !kind || !registryPath || !output) {
      throw new Error(
        "new_project_requires_vault_root_portfolio_name_kind_registry_path_and_output",
      );
    }
    assertVaultRootMatchesPortfolio(vaultRoot, portfolio);
    if (!isCanonicalRepositoryBasename(name)) {
      throw new Error(`repository_basename_invalid:${JSON.stringify(name)}`);
    }

    const target = join(vaultRoot, name);
    if (existsSync(target)) {
      throw new Error(`scaffold_target_exists:${target}`);
    }

    const provenance =
      typeId && workflowRegistryPath ? resolveWorkflowProvenance(typeId, workflowRegistryPath) : null;

    const workObjectId = `${kind}:${name}`;
    const scaffoldInput: ScaffoldInput = {
      projectId: name,
      portfolio,
      repository: name,
      workObjectId,
      workObjectName: name,
      workObjectKind: kind,
    };
    const evidence = synthesizeScaffoldEvidence(scaffoldInput);
    const files = renderPacket(evidence);

    const parsedYaml = parseFlatProjectYaml(files[".project/project.yaml"]);
    const validation = validateProjectYaml(parsedYaml, { approvedLanes: approvedLanes() });
    if (!validation.valid) {
      throw new Error(`synthesized_packet_invalid:${validation.errors.join("; ")}`);
    }

    // Pre-flight the registry write against the read-only current state so
    // both --dry-run and a real run report the exact same collision
    // outcome, without writing anything during the check itself.
    const existingRegistry = existsSync(registryPath)
      ? (JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry)
      : { workObjects: [], sourceInventory: [] };
    const workIdCollision = existingRegistry.workObjects.some((entry) => entry.workId === workObjectId);
    const pathCollision = existingRegistry.sourceInventory.some((entry) => entry.path === target);

    const receipt = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dryRun,
      target,
      portfolio,
      name,
      kind,
      workId: workObjectId,
      type: provenance?.workflowId ?? null,
      stages: provenance?.stages ?? [],
      workflowDigest: provenance?.workflowDigest ?? null,
      needsReview: evidence.needsReview,
      registryCollision: workIdCollision || pathCollision,
    };

    if (dryRun) {
      writeOwnerOnly(resolve(output), receipt);
      console.log(JSON.stringify({ output: resolve(output), dryRun: true, target, workId: workObjectId }));
    } else {
      // Deliberately no pre-flight collision throw here (workIdCollision/
      // pathCollision above feed only the receipt's reporting field). The
      // folder and packet files are written first regardless, and
      // writeWorkObjectEntry — called last — is what actually throws on a
      // real collision. This ordering matters: the folder half of a
      // scaffold is inert on its own (no registry claim, no relocation
      // eligibility) and safe to leave in place for the operator to
      // resolve, so a collision must surface after those writes, not
      // before them, matching the design's documented Error Handling
      // behavior.
      mkdirSync(target, { recursive: true });
      const gitInit = spawnSync("git", ["init", "--quiet", "-b", "main"], { cwd: target });
      if (gitInit.status !== 0) throw new Error(`git_init_failed:${target}`);

      for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = join(target, relativePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, "utf8");
      }

      if (provenance) {
        writeFileSync(join(target, ".project/WORKFLOW.md"), renderWorkflowProvenanceMd(provenance), "utf8");
        for (const stage of provenance.stages) {
          mkdirSync(join(target, stage), { recursive: true });
        }
      }

      writeWorkObjectEntry(registryPath, {
        workObject: {
          workId: workObjectId,
          name,
          kind,
          sourceRefs: [`repo:${name}`],
        },
        sourceInventoryPath: target,
      });

      writeOwnerOnly(resolve(output), receipt);
      console.log(JSON.stringify({ output: resolve(output), dryRun: false, target, workId: workObjectId }));
    }
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
