import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { loadLock } from "../../load.ts";
import { producerAvailability, spliceManagedBlock } from "../../lifecycle/non-copy.ts";
import { validateSurfaceManifest, type SurfaceLeaf, type SurfaceManifest } from "../../lifecycle/prepared-surface.ts";
import type { SurfaceRecord, TransformSurfaceRecord } from "../../types.ts";
import type { DoctorCheck, DoctorContext, DoctorSection } from "../model.ts";

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function publicDestination(record: SurfaceRecord): string {
  return `${record.destination.root_token}:${record.destination.relative_path}`;
}

function boundRoot(record: Exclude<SurfaceRecord, { class: "NEVER-SHIP" }>, context: DoctorContext): string {
  const root = context.rootBindings[record.destination.root_token];
  if (!root || !isAbsolute(root)) throw new Error("DOCTOR_ROOT_BINDING_INVALID");
  return resolve(root);
}

function destinationPath(record: Exclude<SurfaceRecord, { class: "NEVER-SHIP" }>, context: DoctorContext): string {
  const root = boundRoot(record, context);
  const candidate = resolve(root, record.destination.relative_path);
  const rel = relative(root, candidate);
  if (rel === "" || rel === ".." || rel.split(sep).some((segment) => segment === "..") || isAbsolute(rel)) {
    throw new Error("DOCTOR_DESTINATION_ESCAPE");
  }
  return candidate;
}

function checkBase(record: SurfaceRecord): Omit<DoctorCheck, "expected_state" | "actual_state" | "condition" | "reason_code" | "severity" | "actionable" | "remediation" | "evidence"> {
  return {
    id: record.id,
    source: "source" in record ? record.source : `symbolic:${record.id}`,
    destination: record.class === "NEVER-SHIP" ? `symbolic:${record.id}` : publicDestination(record),
    class: record.class,
  };
}

function result(
  record: SurfaceRecord,
  values: Pick<DoctorCheck, "expected_state" | "actual_state" | "condition" | "reason_code" | "severity" | "actionable" | "remediation" | "evidence">,
): DoctorCheck {
  return { ...checkBase(record), ...values };
}

type CopyRecord = Extract<SurfaceRecord, { class: "COPY" }>;
type DestinationRecord = Exclude<SurfaceRecord, { class: "NEVER-SHIP" }>;

function assertContained(root: string, candidate: string, code: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "" || rel === ".." || rel.split(sep).some((segment) => segment === "..") || isAbsolute(rel)) {
    throw new Error(code);
  }
}

function sameFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.mode === after.mode
    && before.nlink === after.nlink;
}

function safeRegularMode(stat: Stats, code: string): number {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o7000) !== 0) {
    throw new Error(code);
  }
  return stat.mode & 0o777;
}

function requireText(content: string, code: string): string {
  if (content.split("").some((character) => {
    const value = character.codePointAt(0) ?? 0;
    return (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) || value === 0xfffd;
  })) {
    throw new Error(code);
  }
  return content;
}

async function safeDirectory(context: DoctorContext, path: string, code: string): Promise<void> {
  const stat = await context.io.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
}

/**
 * Read a single regular text file without traversing links. The second stat
 * rejects a source/artifact that changes while doctor reads its bounded bytes.
 */
async function safeText(
  context: DoctorContext,
  root: string,
  path: string,
  unsafeCode: string,
): Promise<{ content: string; mode: number }> {
  root = resolve(root);
  path = resolve(path);
  if (!isAbsolute(root) || !isAbsolute(path)) throw new Error(unsafeCode);
  assertContained(root, path, unsafeCode);
  await safeDirectory(context, root, unsafeCode);
  let cursor = root;
  const segments = relative(root, path).split(sep);
  for (const [index, segment] of segments.entries()) {
    cursor = resolve(cursor, segment);
    const stat = await context.io.lstat(cursor);
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) throw new Error(unsafeCode);
    if (index === segments.length - 1) safeRegularMode(stat, unsafeCode);
  }
  const before = await context.io.lstat(path);
  const content = requireText(await context.io.readFile(path), unsafeCode);
  const after = await context.io.lstat(path);
  if (!sameFile(before, after)) throw new Error(unsafeCode);
  return { content, mode: safeRegularMode(after, unsafeCode) };
}

/** Walk below the bound root with lstat; never follow a destination symlink. */
async function safeDestination(record: DestinationRecord, context: DoctorContext): Promise<string> {
  const destination = destinationPath(record, context);
  const root = boundRoot(record, context);
  await safeDirectory(context, root, "COPY_DESTINATION_UNSAFE");
  let cursor = root;
  const segments = relative(root, destination).split(sep);
  for (const [index, segment] of segments.entries()) {
    context.signal.throwIfAborted();
    cursor = resolve(cursor, segment);
    const stat = await context.io.lstat(cursor);
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      throw new Error("COPY_DESTINATION_UNSAFE");
    }
  }
  return destination;
}

async function observeCopy(record: CopyRecord, context: DoctorContext): Promise<DoctorCheck> {
  const expected = record.verification.expected;
  if (!expected || (expected.kind === "file" ? !expected.mode : !expected.modes
    || Object.keys(expected.files).some((leaf) => !expected.modes?.[leaf])
    || Object.keys(expected.modes).length !== Object.keys(expected.files).length)) {
    return result(record, {
      expected_state: "reviewed content and mode declaration", actual_state: "undeclared",
      condition: "WARN", reason_code: "COPY_EXPECTATION_UNDECLARED", severity: "warning", actionable: true,
      remediation: "Generate and review the committed-source COPY declaration before installation.", evidence: ["sha256"],
    });
  }
  const expectedState = expected.kind === "file" ? `${expected.sha256};mode:${expected.mode}` : `reviewed tree:${Object.keys(expected.files).length} leaves`;
  const observedResult = (code: string, state: string): DoctorCheck => result(record, {
    expected_state: expectedState, actual_state: state, condition: code === "COPY_DECLARATION_MATCH" ? "PASS" : "DRIFT",
    reason_code: code, severity: code === "COPY_DECLARATION_MATCH" ? "info" : "warning", actionable: code !== "COPY_DECLARATION_MATCH",
    remediation: code === "COPY_DECLARATION_MATCH" ? "None." : "Review destination drift before running the governed lifecycle update.", evidence: ["sha256", "regular-file-mode"],
  });
  try {
    const destination = await safeDestination(record, context);
    const files: Record<string, string> = expected.kind === "file" ? { "": expected.sha256 } : expected.files;
    const modes = expected.kind === "file" ? { "": expected.mode! } : expected.modes!;
    const actualLeaves: string[] = [];
    const visit = async (path: string, rel: string): Promise<void> => {
      context.signal.throwIfAborted();
      const stat = await context.io.lstat(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) {
        throw new Error("COPY_DESTINATION_UNSAFE");
      }
      if (stat.isFile()) { actualLeaves.push(rel); return; }
      for (const name of (await context.io.readdir(path)).sort()) {
        if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new Error("COPY_DESTINATION_UNSAFE");
        await visit(resolve(path, name), rel ? `${rel}/${name}` : name);
      }
    };
    const destinationStat = await context.io.lstat(destination);
    if ((expected.kind === "file" && !destinationStat.isFile()) || (expected.kind === "tree" && !destinationStat.isDirectory())) {
      return observedResult("COPY_TYPE_DRIFT", "destination type mismatch");
    }
    await visit(destination, "");
    const keys = Object.keys(files).sort();
    if (JSON.stringify(actualLeaves.sort()) !== JSON.stringify(keys)) return observedResult("COPY_LEAF_SET_DRIFT", "destination leaf inventory differs");
    // Only declared leaves are read, and bytes are hashed without UTF-8 replacement.
    for (const leaf of keys) {
      context.signal.throwIfAborted();
      const path = leaf ? resolve(destination, leaf) : destination;
      const stat = await context.io.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("COPY_DESTINATION_UNSAFE");
      if ((stat.mode & 0o7777) !== Number.parseInt(modes[leaf], 8)) return observedResult("COPY_MODE_DRIFT", "destination regular-file mode differs");
      if (digest(await context.io.readBytes(path)) !== files[leaf]) return observedResult("COPY_DIGEST_DRIFT", "destination content digest differs");
    }
    return observedResult("COPY_DECLARATION_MATCH", expectedState);
  } catch (error) {
    const unsafe = error instanceof Error && error.message === "COPY_DESTINATION_UNSAFE";
    return result(record, {
      expected_state: expectedState, actual_state: unsafe ? "unsafe destination structure" : "unavailable",
      condition: unsafe || record.eligibility.required ? "FAIL" : "SKIPPED",
      reason_code: unsafe ? "COPY_DESTINATION_UNSAFE" : record.eligibility.required ? "REQUIRED_SURFACE_UNAVAILABLE" : "OPTIONAL_SURFACE_SKIPPED",
      severity: unsafe || record.eligibility.required ? "error" : "info", actionable: unsafe || record.eligibility.required,
      remediation: "Inspect the declared destination before restoring the reviewed surface.", evidence: ["sha256"],
    });
  }
}

type TransactionBinding = {
  txid: string;
  txDir: string;
  manifest: SurfaceManifest;
};

type BindingAttempt =
  | { kind: "irrelevant" }
  | { kind: "invalid" }
  | { kind: "valid"; binding: TransactionBinding };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sourceDigest(record: TransformSurfaceRecord): string | null {
  const expected = record.verification.expected;
  const match = expected && /^sha256:([a-f0-9]{64})$/.exec(expected.sha256);
  return match?.[1] ?? null;
}

function sourceMode(record: TransformSurfaceRecord): number | null {
  const mode = record.verification.expected?.mode;
  return mode === "0644" ? 0o644 : mode === "0755" ? 0o755 : null;
}

async function inspectBinding(
  context: DoctorContext,
  txid: string,
  lockDigest: string,
): Promise<BindingAttempt> {
  const stateRoot = resolve(context.stateRoot);
  const txRoot = join(stateRoot, "transactions");
  const txDir = join(txRoot, txid);
  await safeDirectory(context, stateRoot, "TRANSFORM_BINDING_UNSAFE");
  await safeDirectory(context, txRoot, "TRANSFORM_BINDING_UNSAFE");
  await safeDirectory(context, txDir, "TRANSFORM_BINDING_UNSAFE");

  let entries: unknown[];
  try {
    entries = JSON.parse((await safeText(context, txDir, join(txDir, "journal.json"), "TRANSFORM_BINDING_UNSAFE")).content) as unknown[];
  } catch {
    return { kind: "invalid" };
  }
  if (!Array.isArray(entries)) return { kind: "invalid" };
  const begins = entries.map(object).filter((entry): entry is Record<string, unknown> => entry?.kind === "BEGIN");
  if (begins.length !== 1) return { kind: "invalid" };
  const begin = begins[0];
  if (begin.inventory_digest !== lockDigest) return { kind: "irrelevant" };
  if (typeof begin.surface_manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(begin.surface_manifest_sha256)) {
    return { kind: "invalid" };
  }
  const complete = entries.map(object).filter((entry): entry is Record<string, unknown> => entry?.kind === "COMPLETE");
  if (
    complete.length !== 1
    || complete[0].receipt_ref !== `${txid}/receipt.json`
    || entries.map(object).some((entry) => entry?.kind === "ABORT" || entry?.kind === "COMPENSATE")
  ) return { kind: "invalid" };

  let manifest: SurfaceManifest;
  let receipt: Record<string, unknown>;
  try {
    const rawManifest = (await safeText(context, txDir, join(txDir, "surface-manifest.json"), "TRANSFORM_BINDING_UNSAFE")).content;
    if (digest(rawManifest) !== `sha256:${begin.surface_manifest_sha256}`) return { kind: "invalid" };
    manifest = validateSurfaceManifest(JSON.parse(rawManifest));
    const rawReceipt = (await safeText(context, txDir, join(txDir, "receipt.json"), "TRANSFORM_BINDING_UNSAFE")).content;
    receipt = object(JSON.parse(rawReceipt)) ?? {};
  } catch {
    return { kind: "invalid" };
  }
  if (
    receipt.schema !== "temperance.lifecycle.receipt.v1"
    || receipt.txid !== txid
    || receipt.status !== "committed"
    || receipt.inventory_digest !== lockDigest
    || !Array.isArray(receipt.steps)
  ) return { kind: "invalid" };

  const committed = new Set(
    entries.map(object)
      .filter((entry): entry is Record<string, unknown> => entry?.kind === "COMMIT_STEP" && typeof entry.step_id === "string")
      .map((entry) => entry.step_id as string),
  );
  // Receipts are deliberately record-level for compatibility with the public
  // planning result. A tree COPY expands only its journal/manifest leaf IDs,
  // so proof requires both each exact leaf commit and an installed receipt for
  // the leaf's owning record.
  const installedRecords = new Set(
    receipt.steps.map(object)
      .filter((step): step is Record<string, unknown> => step?.outcome === "installed" && typeof step.id === "string" && typeof step.record_id === "string")
      .map((step) => step.record_id as string),
  );
  if (manifest.leaves.some((leaf) => !committed.has(leaf.step_id) || !installedRecords.has(leaf.record_id))) {
    return { kind: "invalid" };
  }
  return { kind: "valid", binding: { txid, txDir, manifest } };
}

/**
 * A newer malformed or compensated transaction for the current lock prevents
 * fallback to an older receipt. Doctor must never call stale proof current.
 */
async function currentBinding(context: DoctorContext, lockDigest: string): Promise<TransactionBinding | null> {
  const stateRoot = resolve(context.stateRoot);
  const txRoot = join(stateRoot, "transactions");
  try {
    await safeDirectory(context, stateRoot, "TRANSFORM_BINDING_UNSAFE");
    await safeDirectory(context, txRoot, "TRANSFORM_BINDING_UNSAFE");
    const txids = (await context.io.readdir(txRoot))
      .filter((name) => /^[a-f0-9]{12}-[a-f0-9]{8}$/.test(name))
      .sort()
      .reverse();
    for (const txid of txids) {
      const attempt = await inspectBinding(context, txid, lockDigest);
      if (attempt.kind === "valid") return attempt.binding;
      if (attempt.kind === "invalid") return null;
    }
  } catch {
    return null;
  }
  return null;
}

function unavailableTransform(record: TransformSurfaceRecord, code: string, remediation: string): DoctorCheck {
  return result(record, {
    expected_state: "completed current-lock managed transform binding",
    actual_state: "unavailable",
    condition: "UNAVAILABLE",
    reason_code: code,
    severity: "warning",
    actionable: true,
    remediation,
    evidence: ["journal-bound-surface-manifest", "managed-block"],
  });
}

async function observeTransform(
  record: TransformSurfaceRecord,
  context: DoctorContext,
  binding: TransactionBinding | null,
): Promise<DoctorCheck> {
  const availability = producerAvailability(record);
  if (availability) {
    return unavailableTransform(record, availability.code, "Install only after the declared source-owned adapter is available.");
  }
  if (!binding) {
    return unavailableTransform(record, "TRANSFORM_BINDING_UNAVAILABLE", "Run a reviewed lifecycle install for the current lock before treating this managed block as verified.");
  }
  if (record.destination.ownership.kind !== "managed-block" || !record.destination.ownership.marker_id) {
    return unavailableTransform(record, "TRANSFORM_MANAGED_BLOCK_REQUIRED", "Repair the declared transform ownership before installation.");
  }
  const expectedSourceHash = sourceDigest(record);
  const expectedSourceMode = sourceMode(record);
  if (!expectedSourceHash || expectedSourceMode === null) {
    return unavailableTransform(record, "TRANSFORM_SOURCE_EXPECTATION_UNDECLARED", "Declare and review the transform template digest and mode before installation.");
  }
  const leaves = binding.manifest.leaves.filter((leaf) => leaf.record_id === record.id);
  if (leaves.length !== 1) {
    return unavailableTransform(record, "TRANSFORM_BINDING_RECORD_MISSING", "Run a reviewed lifecycle install that binds exactly one managed transform leaf.");
  }
  const leaf = leaves[0];
  if (
    leaf.surface_class !== "TRANSFORM"
    || leaf.root_token !== record.destination.root_token
    || leaf.relative_path !== record.destination.relative_path
    || leaf.ownership !== "managed-block"
    || leaf.producer_id !== record.verification.adapter_id
    || leaf.source_hash !== expectedSourceHash
  ) {
    return unavailableTransform(record, "TRANSFORM_BINDING_IDENTITY_MISMATCH", "Do not reuse this transaction evidence; run a reviewed lifecycle install for the current record.");
  }

  try {
    const templatePath = resolve(context.repositoryRoot, record.source);
    const template = await safeText(context, context.repositoryRoot, templatePath, "TRANSFORM_SOURCE_UNSAFE");
    if (template.mode !== expectedSourceMode || digest(template.content) !== `sha256:${expectedSourceHash}`) {
      throw new Error("TRANSFORM_SOURCE_DRIFT");
    }
    const artifact = await safeText(context, binding.txDir, join(binding.txDir, leaf.output), "TRANSFORM_BINDING_ARTIFACT_UNSAFE");
    if (artifact.mode !== leaf.expected_mode || digest(artifact.content) !== `sha256:${leaf.expected_hash}`) {
      throw new Error("TRANSFORM_BINDING_ARTIFACT_DRIFT");
    }
    if (leaf.preimage) {
      const preimage = await safeText(context, binding.txDir, join(binding.txDir, leaf.preimage), "TRANSFORM_BINDING_PREIMAGE_UNSAFE");
      if (
        leaf.prior_hash === null
        || preimage.mode !== 0o600
        || digest(preimage.content) !== `sha256:${leaf.prior_hash}`
      ) {
        throw new Error("TRANSFORM_BINDING_PREIMAGE_DRIFT");
      }
    }
    const destination = await safeText(context, boundRoot(record, context), destinationPath(record, context), "TRANSFORM_DESTINATION_UNSAFE");
    if (destination.mode !== leaf.expected_mode) throw new Error("TRANSFORM_MODE_DRIFT");
    if (spliceManagedBlock(destination.content, record.destination.ownership.marker_id, template.content) !== destination.content) {
      throw new Error("TRANSFORM_MANAGED_BLOCK_DRIFT");
    }
    const fullBoundOutput = digest(destination.content) === `sha256:${leaf.expected_hash}`;
    return result(record, {
      expected_state: "current managed block and bound regular-file mode",
      actual_state: fullBoundOutput ? "managed block and bound output match" : "managed block matches; user-owned context differs",
      condition: "PASS",
      reason_code: fullBoundOutput ? "TRANSFORM_MANAGED_BLOCK_MATCH" : "TRANSFORM_MANAGED_BLOCK_MATCH_USER_CONTEXT_CHANGED",
      severity: "info",
      actionable: false,
      remediation: "None.",
      evidence: ["journal-bound-surface-manifest", "managed-block", "sha256", "regular-file-mode"],
    });
  } catch (error) {
    const code = error instanceof Error && /^TRANSFORM_[A-Z_]+$/.test(error.message)
      ? error.message
      : "TRANSFORM_PROOF_DRIFT";
    const driftCodes = new Set([
      "TRANSFORM_SOURCE_DRIFT",
      "TRANSFORM_BINDING_ARTIFACT_DRIFT",
      "TRANSFORM_BINDING_PREIMAGE_DRIFT",
      "TRANSFORM_MODE_DRIFT",
      "TRANSFORM_MANAGED_BLOCK_DRIFT",
    ]);
    if (!driftCodes.has(code)) {
      return unavailableTransform(record, code === "TRANSFORM_PROOF_DRIFT" ? "TRANSFORM_PROOF_UNAVAILABLE" : code,
        "Restore safe, complete current-lock transform evidence before treating this managed block as verified.");
    }
    return result(record, {
      expected_state: "current managed block and bound regular-file mode",
      actual_state: "drift or unsafe proof input",
      condition: "DRIFT",
      reason_code: code,
      severity: "warning",
      actionable: true,
      remediation: "Review the managed block, template, transaction artifact, and destination before running a governed update.",
      evidence: ["journal-bound-surface-manifest", "managed-block", "sha256", "regular-file-mode"],
    });
  }
}

function observeRegenerate(record: Extract<SurfaceRecord, { class: "REGENERATE" }>): DoctorCheck {
  const availability = producerAvailability(record);
  return result(record, {
    expected_state: "registered source-owned generator",
    actual_state: availability ? "generator unavailable" : "generator verification unavailable",
    condition: "UNAVAILABLE",
    reason_code: availability?.code ?? "GENERATOR_VERIFICATION_UNAVAILABLE",
    severity: "warning",
    actionable: true,
    remediation: availability
      ? "Install a source-owned generator before enabling this record."
      : "Add a governed generator verification contract before treating this surface as healthy.",
    evidence: [record.verification.generator_id],
  });
}

async function observeRecord(
  record: SurfaceRecord,
  context: DoctorContext,
  binding: TransactionBinding | null,
): Promise<DoctorCheck> {
  if (!record.eligibility.platforms.some((platform) => platform === context.platform)) {
    return result(record, {
      expected_state: "eligible platform",
      actual_state: `unsupported:${context.platform}`,
      condition: "UNSUPPORTED",
      reason_code: "PLATFORM_UNSUPPORTED",
      severity: "info",
      actionable: false,
      remediation: "Run this check on a declared supported platform.",
      evidence: [],
    });
  }

  if (record.class === "NEVER-SHIP") {
    return result(record, {
      expected_state: "symbolically excluded",
      actual_state: "symbolically excluded",
      condition: "PASS",
      reason_code: "NEVER_SHIP_SYMBOLIC",
      severity: "info",
      actionable: false,
      remediation: "None; preserve the private boundary.",
      evidence: [record.verification.method],
    });
  }

  if (record.class === "REGENERATE") return observeRegenerate(record);
  if (record.class === "COPY") return observeCopy(record, context);
  return observeTransform(record, context, binding);
}

function sectionCondition(checks: readonly DoctorCheck[]): DoctorSection["condition"] {
  for (const condition of ["FAIL", "DRIFT", "WARN", "UNAVAILABLE"] as const) {
    if (checks.some((check) => check.condition === condition)) return condition;
  }
  return "PASS";
}

export async function runInstallSection(context: DoctorContext): Promise<DoctorSection> {
  const lockPath = resolve(context.repositoryRoot, "package/install-surface/install-surface-manifest.lock.json");
  const lock = loadLock(lockPath);
  const binding = await currentBinding(context, lock.digest);
  const checks = await Promise.all(lock.lockObject.records.map((record) => observeRecord(record, context, binding)));
  checks.sort((left, right) => left.id.localeCompare(right.id));
  return { id: "install", condition: sectionCondition(checks), checks };
}
