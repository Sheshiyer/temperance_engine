/**
 * Portfolio knowledge-registry paths and the append-only Thoughtseed
 * reconciliation lifecycle. Path/log logic here is pure — the only I/O this
 * module performs is writeRegistryEntry(), which always takes an explicit
 * caller-supplied path so tests can point it at a fixture directory instead
 * of a real portfolio registry host.
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isCanonicalRepositoryBasename } from "./project-relocation-grammar";

export type Portfolio = "thoughtseed" | "tryambakam-noesis";

const REGISTRY_ROOTS: Record<Portfolio, string> = {
  thoughtseed:
    "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed",
  "tryambakam-noesis": "/Volumes/madara/2026/twc-vault/_System/10865xseed/projects",
};

export function registryRootFor(portfolio: Portfolio): string {
  return REGISTRY_ROOTS[portfolio];
}

export function registryEntryPath(portfolio: Portfolio, repository: string): string {
  if (!isCanonicalRepositoryBasename(repository)) {
    throw new Error(`repository_basename_invalid:${JSON.stringify(repository)}`);
  }
  return `${registryRootFor(portfolio)}/${repository}`;
}

export interface ReconcilingTransitionInput {
  at: string;
  actor: string;
}

export interface ReconciledTransitionInput {
  at: string;
  actor: string;
  ownerRatifier: string;
  closedAt: string;
  canonicalProjectRecord: string;
  closureManifestDigest: string;
}

export type ReconciliationTransition =
  | ({ type: "reconciling" } & ReconcilingTransitionInput)
  | ({ type: "reconciled" } & ReconciledTransitionInput);

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * ISC-733: a new Thoughtseed reconciliation entry begins with exactly one
 * reconciling transition — this only appends to an empty log.
 */
export function appendReconcilingTransition(
  log: readonly ReconciliationTransition[],
  input: ReconcilingTransitionInput,
): ReconciliationTransition[] {
  if (log.length !== 0) {
    throw new Error("reconciling_transition_requires_empty_log");
  }
  return [...log, { type: "reconciling", ...input }];
}

/**
 * ISC-747: appends, never rewrites. Only closes an entry whose most recent
 * transition is an open "reconciling" event — refuses an empty log and
 * refuses double-closing an already-reconciled entry (ISC-743).
 */
export function appendReconciledTransition(
  log: readonly ReconciliationTransition[],
  input: ReconciledTransitionInput,
): ReconciliationTransition[] {
  const last = log[log.length - 1];
  if (!last || last.type !== "reconciling") {
    throw new Error("reconciled_transition_requires_open_reconciling_event");
  }
  if (!SHA256_HEX_PATTERN.test(input.closureManifestDigest)) {
    throw new Error("closure_manifest_digest_must_be_sha256_hex");
  }
  return [...log, { type: "reconciled", ...input }];
}

/** Displayed status is a projection of the append-only transition log. */
export function projectStatus(
  log: readonly ReconciliationTransition[],
): "reconciling" | "reconciled" | "unknown" {
  const last = log[log.length - 1];
  return last ? last.type : "unknown";
}

/** ISC-745: relocation_evidence_ref is the exact sha256:<digest> identity. */
export function relocationEvidenceRef(digestHex: string): string {
  if (!SHA256_HEX_PATTERN.test(digestHex)) {
    throw new Error("digest_must_be_sha256_hex");
  }
  return `sha256:${digestHex}`;
}

export interface RegistryClaimIdentity {
  stableId: string;
  githubIdentity?: string;
}

/**
 * ISC-711: a competing stable-ID or GitHub-identity claim in the other
 * portfolio's registry fails before mutation — no precedence, no merge.
 */
export function assertNoCompetingRegistryClaim(input: {
  stableId: string;
  githubIdentity?: string;
  otherPortfolioEntries: RegistryClaimIdentity[];
}): void {
  for (const entry of input.otherPortfolioEntries) {
    if (entry.stableId === input.stableId) {
      throw new Error(`competing_registry_claim:stable_id:${input.stableId}`);
    }
    if (
      input.githubIdentity !== undefined &&
      entry.githubIdentity !== undefined &&
      entry.githubIdentity === input.githubIdentity
    ) {
      throw new Error(`competing_registry_claim:github_identity:${input.githubIdentity}`);
    }
  }
}

/**
 * ISC-727: the selected registry repository must be clean, or have an
 * owner-approved exact baseline whose porcelain status digest still
 * matches exactly — any further drift beyond that baseline fails closed.
 */
export function assertRegistryHostClean(input: {
  statusPorcelain: string;
  approvedBaselineDigest?: string;
}): void {
  if (input.statusPorcelain.length === 0) return;
  if (!input.approvedBaselineDigest) {
    throw new Error("registry_host_dirty_without_approved_baseline");
  }
  const digest = createHash("sha256").update(input.statusPorcelain).digest("hex");
  if (digest !== input.approvedBaselineDigest) {
    throw new Error("registry_host_baseline_drifted");
  }
}

/**
 * Bounded to exactly each immediate subdirectory's own entry.json file
 * under a registry root — never a recursive walk. Feeds
 * assertNoCompetingRegistryClaim's otherPortfolioEntries. A subdirectory
 * without an entry.json, or one whose entry.json fails to parse, is
 * skipped rather than aborting the listing.
 */
export function listRegistryEntryIdentities(registryRoot: string): RegistryClaimIdentity[] {
  if (!existsSync(registryRoot)) return [];
  const identities: RegistryClaimIdentity[] = [];
  for (const name of readdirSync(registryRoot)) {
    const entryPath = join(registryRoot, name, "entry.json");
    if (!existsSync(entryPath)) continue;
    try {
      const record = JSON.parse(readFileSync(entryPath, "utf8")) as RegistryEntryRecord;
      identities.push({ stableId: record.stableId, githubIdentity: record.githubIdentity });
    } catch {
      continue;
    }
  }
  return identities;
}

export interface RegistryEntryRecord {
  stableId: string;
  portfolio: Portfolio;
  githubIdentity?: string;
  oldPath: string;
  packetDigest: string;
  transitions: ReconciliationTransition[];
}

function transitionsShareApprovedPrefix(
  existing: ReconciliationTransition[],
  next: ReconciliationTransition[],
): boolean {
  if (next.length < existing.length) return false;
  return existing.every((event, index) => JSON.stringify(event) === JSON.stringify(next[index]));
}

/**
 * The only I/O in this module — always takes an explicit caller-supplied
 * path so tests point it at a fixture directory, never a real portfolio
 * registry host. Overwriting is how the append-only log in memory gets
 * persisted (each write serializes the full current log), but a write that
 * would shorten or alter any already-written transition is refused
 * (ISC-743, ISC-747): history only grows, it is never rewritten.
 */
export function writeRegistryEntry(entryDirectoryPath: string, record: RegistryEntryRecord): void {
  const filePath = join(entryDirectoryPath, "entry.json");
  if (existsSync(filePath)) {
    const existing = JSON.parse(readFileSync(filePath, "utf8")) as RegistryEntryRecord;
    if (!transitionsShareApprovedPrefix(existing.transitions, record.transitions)) {
      throw new Error("registry_entry_history_rewrite_refused");
    }
  }
  mkdirSync(entryDirectoryPath, { recursive: true, mode: 0o700 });
  chmodSync(entryDirectoryPath, 0o700);
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}
