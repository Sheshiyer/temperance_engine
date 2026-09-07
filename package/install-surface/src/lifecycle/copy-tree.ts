/** Text-only COPY expansion and durable leaf recovery. No directory replacement or recursive removal. */
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertDestination, assertRepositoryRelativeSource } from "../path-policy.ts";
import type { CopyFileMode, SurfaceRecord } from "../types.ts";
import type { PlannedStep } from "./hazards.ts";
import type { LifecycleIO } from "./journal.ts";

export interface DeclaredCopyLeaf {
  hash: string;
  mode: number;
}
export type DeclaredCopyHashes = Record<string, Record<string, DeclaredCopyLeaf>>;
export interface CopyLeaf {
  step_id: string;
  record_id: string;
  root_token: string;
  relative_path: string;
  expected_hash: string;
  expected_mode: number;
  prior_hash: string | null;
  prior_mode: number | null;
  preimage: string | null;
}
export interface CopyManifest { schema: "temperance.copy-manifest.v2"; leaves: CopyLeaf[]; }
export interface PreparedCopy { step: PlannedStep; content: string; expected_hash: string; expected_mode: number; }
export const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
const order = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
function textOnly(content: string): string {
  // The legacy IO seam returns decoded strings. Reject replacement characters too,
  // since this seam cannot distinguish malformed UTF-8 from literal U+FFFD.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/u.test(content)) throw new Error("COPY_TEXT_REQUIRED");
  return content;
}
function contained(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("COPY_PATH_ESCAPE");
}
/** Check every existing ancestor, including root itself; never follow links. */
export async function safePath(io: LifecycleIO, root: string, path: string, kind: "file" | "directory" | "either"): Promise<void> {
  root = resolve(root); path = resolve(path); contained(root, path);
  const paths: string[] = [];
  for (let p = path; ; p = dirname(p)) { paths.unshift(p); if (p === root) break; }
  for (const p of paths) {
    let stat;
    try { stat = await io.lstat(p); } catch (error) { if (missing(error)) continue; throw error; }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error("COPY_LINK_REJECTED");
    if (p !== path && !stat.isDirectory()) throw new Error("COPY_PARENT_TYPE");
    if (p === path && (!stat.isFile() && !stat.isDirectory())) throw new Error("COPY_SPECIAL_FILE");
    if (p === path && kind === "file" && !stat.isFile()) throw new Error("COPY_FILE_REQUIRED");
    if (p === path && kind === "directory" && !stat.isDirectory()) throw new Error("COPY_DIRECTORY_REQUIRED");
  }
}
interface ExistingCopy {
  content: string;
  mode: number;
}

function regularMode(mode: number): number {
  if ((mode & 0o7000) !== 0) throw new Error("COPY_MODE_UNSAFE");
  return mode & 0o777;
}

async function readExisting(io: LifecycleIO, root: string, path: string): Promise<ExistingCopy | null> {
  await safePath(io, root, path, "file");
  try {
    const stat = await io.lstat(path);
    const content = textOnly(await io.readFile(path));
    await safePath(io, root, path, "file");
    return { content, mode: regularMode(stat.mode) };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function declaredDigest(value: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(value);
  if (!match) throw new Error("COPY_EXPECTATION_INVALID");
  return match[1];
}

function declaredMode(value: CopyFileMode | undefined): number {
  if (value === "0644") return 0o644;
  if (value === "0755") return 0o755;
  throw new Error("COPY_MODE_REQUIRED");
}

/**
 * Derive execution hashes only from the compiled public record contract.
 * A caller may not inject a separate map and still claim the lock digest.
 */
export function declaredCopyHashesForSteps(
  steps: readonly PlannedStep[],
  records: readonly SurfaceRecord[],
): DeclaredCopyHashes {
  const actionableRecordIds = new Set(
    steps
      .filter((step) => step.mode === "install" || step.mode === "update")
      .map((step) => step.record_id),
  );
  const hashes: DeclaredCopyHashes = {};
  for (const record of records) {
    if (record.class !== "COPY" || !actionableRecordIds.has(record.id)) continue;
    const expected = record.verification.expected;
    if (!expected) throw new Error("COPY_EXPECTATION_REQUIRED");
    if (expected.kind === "file") {
      hashes[record.id] = {
        ".": { hash: declaredDigest(expected.sha256), mode: declaredMode(expected.mode) },
      };
      continue;
    }
    const files: Record<string, DeclaredCopyLeaf> = Object.create(null) as Record<string, DeclaredCopyLeaf>;
    for (const [path, digest] of Object.entries(expected.files).sort(([left], [right]) => order(left, right))) {
      assertRepositoryRelativeSource(path);
      Object.defineProperty(files, path, {
        value: {
        hash: declaredDigest(digest),
        mode: declaredMode(expected.modes?.[path]),
        },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (Object.keys(files).length === 0) throw new Error("COPY_EXPECTATION_INVALID");
    hashes[record.id] = files;
  }
  return hashes;
}

export async function prepareCopies(
  io: LifecycleIO, steps: PlannedStep[], records: SurfaceRecord[], sourceRoot?: string, hashes?: DeclaredCopyHashes,
): Promise<{ steps: PlannedStep[]; copies: Map<string, PreparedCopy> }> {
  const expanded: PlannedStep[] = [], copies = new Map<string, PreparedCopy>();
  for (const step of steps) {
    const record = records.find(r => r.id === step.record_id);
    if (record?.class !== "COPY" || (step.mode !== "install" && step.mode !== "update")) { expanded.push(step); continue; }
    const root = resolve(sourceRoot ?? (isAbsolute(record.source) ? dirname(record.source) : process.cwd()));
    if (sourceRoot || !isAbsolute(record.source)) assertRepositoryRelativeSource(record.source);
    const source = resolve(root, record.source);
    await safePath(io, root, source, "either");
    const stat = await io.lstat(source);
    const tree = stat.isDirectory();
    if (tree && !sourceRoot) throw new Error("COPY_TREE_SOURCE_ROOT_REQUIRED");
    const declaration = hashes?.[record.id];
    if (!declaration) throw new Error("COPY_EXPECTATION_REQUIRED");
    const leaves: { path: string; content: string; mode: number }[] = [];
    const walk = async (path: string, rel: string): Promise<void> => {
      await safePath(io, root, path, "either");
      contained(await io.realpath(root), await io.realpath(path));
      const info = await io.lstat(path);
      if (info.isDirectory()) {
        for (const name of (await io.readdir(path)).sort(order)) {
          assertRepositoryRelativeSource(name);
          if (name.includes("/")) throw new Error("COPY_ENTRY_INVALID");
          await walk(join(path, name), rel ? `${rel}/${name}` : name);
        }
      } else {
        const leafPath = rel || ".";
        const declared = declaration[leafPath];
        // Reject extra leaves before their content is read. A declaration is a
        // complete reviewed inventory, never permission to scan arbitrary data.
        if (!declared) throw new Error("COPY_HASH_INVENTORY_MISMATCH");
        if (regularMode(info.mode) !== declared.mode) throw new Error("COPY_DECLARED_MODE_MISMATCH");
        const content = textOnly(await io.readFile(path));
        await safePath(io, root, path, "file");
        leaves.push({ path: leafPath, content, mode: regularMode(info.mode) });
      }
    };
    await walk(source, "");
    leaves.sort((a, b) => order(a.path, b.path));
    if (JSON.stringify(Object.keys(declaration).sort(order)) !== JSON.stringify(leaves.map(l => l.path))) throw new Error("COPY_HASH_INVENTORY_MISMATCH");
    for (const leaf of leaves) {
      const expected = declaration[leaf.path];
      if (!expected || !/^[a-f0-9]{64}$/.test(expected.hash) || sha256(leaf.content) !== expected.hash) throw new Error("COPY_DECLARED_HASH_MISMATCH");
      if (leaf.mode !== expected.mode) throw new Error("COPY_DECLARED_MODE_MISMATCH");
      const leafStep: PlannedStep = tree ? {
        ...step, step_id: `${step.step_id}-${sha256(leaf.path).slice(0, 16)}`,
        destination: { ...step.destination, relative_path: `${step.destination.relative_path}/${leaf.path}` },
      } : step;
      assertDestination(leafStep.destination);
      if (copies.has(leafStep.step_id)) throw new Error("COPY_STEP_COLLISION");
      expanded.push(leafStep); copies.set(leafStep.step_id, {
        step: leafStep,
        content: leaf.content,
        expected_hash: expected.hash,
        expected_mode: expected.mode,
      });
    }
  }
  return { steps: expanded, copies };
}

export async function captureCopyManifest(io: LifecycleIO, txDir: string, copies: Map<string, PreparedCopy>, resolveRoot: (token: string) => string): Promise<CopyManifest> {
  const manifest: CopyManifest = { schema: "temperance.copy-manifest.v2", leaves: [] };
  const destinations = new Set<string>();
  for (const { step, expected_hash, expected_mode } of copies.values()) {
    const root = resolveRoot(step.destination.root_token), dest = join(root, step.destination.relative_path);
    const key = resolve(dest).normalize("NFC").toLowerCase();
    if (destinations.has(key)) throw new Error("COPY_DESTINATION_COLLISION");
    destinations.add(key);
    const prior = await readExisting(io, root, dest);
    const preimage = prior === null ? null : `preimage/copy-${sha256(step.step_id)}.txt`;
    if (preimage) {
      await io.writeFileAtomic(join(txDir, preimage), prior!.content);
      if (sha256(await io.readFile(join(txDir, preimage))) !== sha256(prior!.content)) throw new Error("COPY_PREIMAGE_VERIFY_FAILED");
    }
    manifest.leaves.push({ step_id: step.step_id, record_id: step.record_id, root_token: step.destination.root_token,
      relative_path: step.destination.relative_path, expected_hash, expected_mode,
      prior_hash: prior === null ? null : sha256(prior.content), prior_mode: prior?.mode ?? null, preimage });
  }
  if (copies.size) await io.writeFileAtomic(join(txDir, "copy-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function assertCopyPrior(io: LifecycleIO, leaf: CopyLeaf, resolveRoot: (token: string) => string): Promise<void> {
  const root = resolveRoot(leaf.root_token);
  const current = await readExisting(io, root, join(root, leaf.relative_path));
  if (
    (current === null ? null : sha256(current.content)) !== leaf.prior_hash
    || (current?.mode ?? null) !== leaf.prior_mode
  ) throw new Error("COPY_DESTINATION_DRIFT");
}

/** Missing manifests are legacy; invalid/corrupt manifests must never fall back. */
export async function loadCopyManifest(io: LifecycleIO, txDir: string): Promise<CopyManifest | null> {
  let raw: string;
  try { await safePath(io, txDir, join(txDir, "copy-manifest.json"), "file"); raw = await io.readFile(join(txDir, "copy-manifest.json")); } catch (error) { if (missing(error)) return null; throw error; }
  const value = JSON.parse(raw);
  if (value?.schema === "temperance.copy-manifest.v1") throw new Error("COPY_MANIFEST_MODE_UNSUPPORTED");
  if (value?.schema !== "temperance.copy-manifest.v2" || !Array.isArray(value.leaves)) throw new Error("COPY_MANIFEST_INVALID");
  const seen = new Set<string>();
  for (const leaf of value.leaves) {
    if (!leaf || typeof leaf.step_id !== "string" || !/^[\w.-]+$/.test(leaf.step_id) || typeof leaf.record_id !== "string" || seen.has(leaf.step_id)) throw new Error("COPY_MANIFEST_INVALID");
    seen.add(leaf.step_id);
    assertDestination({ root_token: leaf.root_token, relative_path: leaf.relative_path, ownership: { kind: "exclusive-path" } });
    if (
      typeof leaf.expected_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(leaf.expected_hash)
      || !Number.isInteger(leaf.expected_mode)
      || (leaf.expected_mode !== 0o644 && leaf.expected_mode !== 0o755)
    ) throw new Error("COPY_MANIFEST_INVALID");
    if (leaf.prior_hash === null) {
      if (leaf.preimage !== null || leaf.prior_mode !== null) throw new Error("COPY_MANIFEST_INVALID");
    } else if (
      !/^[a-f0-9]{64}$/.test(leaf.prior_hash)
      || leaf.preimage !== `preimage/copy-${sha256(leaf.step_id)}.txt`
      || !Number.isInteger(leaf.prior_mode)
      || leaf.prior_mode < 0
      || leaf.prior_mode > 0o777
    ) throw new Error("COPY_MANIFEST_INVALID");
  }
  return value;
}

export async function rollbackCopies(io: LifecycleIO, txDir: string, manifest: CopyManifest, resolveRoot: (token: string) => string): Promise<void> {
  const inspect = async (leaf: CopyLeaf): Promise<{ dest: string; prior: ExistingCopy | null; changed: boolean }> => {
    const root = resolveRoot(leaf.root_token), dest = join(root, leaf.relative_path);
    const current = await readExisting(io, root, dest);
    const currentHash = current === null ? null : sha256(current.content);
    let prior: ExistingCopy | null = null;
    if (leaf.preimage) {
      await safePath(io, txDir, join(txDir, leaf.preimage), "file");
      prior = { content: await io.readFile(join(txDir, leaf.preimage)), mode: leaf.prior_mode! };
      if (sha256(prior.content) !== leaf.prior_hash) throw new Error("COPY_PREIMAGE_DRIFT");
    }
    const currentMatchesExpected = currentHash === leaf.expected_hash && (current?.mode ?? null) === leaf.expected_mode;
    const currentMatchesPrior = currentHash === leaf.prior_hash && (current?.mode ?? null) === leaf.prior_mode;
    if (!currentMatchesExpected && !currentMatchesPrior) throw new Error("COPY_DESTINATION_DRIFT");
    return { dest, prior, changed: !currentMatchesPrior };
  };
  // Whole-manifest validation before any compensation, then immediate recheck.
  for (const leaf of manifest.leaves) await inspect(leaf);
  for (const leaf of [...manifest.leaves].reverse()) {
    const { dest, prior, changed } = await inspect(leaf);
    if (!changed) continue;
    if (prior === null) await io.rm(dest, { recursive: false, force: false });
    else {
      const root = resolveRoot(leaf.root_token);
      // A new unpredictable sibling lets a later rollback proceed after a
      // process stop leaves an earlier restore stage behind. We never reuse or
      // delete an orphaned sibling because it is outside this attempt's proof.
      const restoreStage = join(
        dirname(dest),
        `.temperance-restore-${sha256(`${txDir}\u0000${leaf.step_id}`).slice(0, 16)}-${randomBytes(8).toString("hex")}.tmp`,
      );
      await safePath(io, root, restoreStage, "file");
      try {
        await io.lstat(restoreStage);
        throw new Error("COPY_RESTORE_STAGE_EXISTS");
      } catch (error) {
        if (!missing(error)) throw error;
      }
      let staged = false;
      try {
        // Build and verify the complete prior state before replacing the live
        // destination. A failed chmod therefore leaves the expected state
        // intact and permits a later rollback retry.
        staged = true;
        await io.writeFileAtomic(restoreStage, prior.content);
        await io.chmod(restoreStage, prior.mode);
        const verifiedStage = await readExisting(io, root, restoreStage);
        if (
          verifiedStage === null
          || sha256(verifiedStage.content) !== leaf.prior_hash
          || verifiedStage.mode !== leaf.prior_mode
        ) throw new Error("COPY_RESTORE_STAGE_VERIFY_FAILED");
        const current = await readExisting(io, root, dest);
        if (
          current === null
          || sha256(current.content) !== leaf.expected_hash
          || current.mode !== leaf.expected_mode
        ) throw new Error("COPY_DESTINATION_DRIFT");
        await safePath(io, root, dest, "file");
        await io.rename(restoreStage, dest);
        staged = false;
      } finally {
        if (staged) await io.rm(restoreStage, { recursive: false, force: true });
      }
      const restored = await readExisting(io, root, dest);
      if (
        restored === null
        || sha256(restored.content) !== leaf.prior_hash
        || restored.mode !== leaf.prior_mode
      ) throw new Error("COPY_RESTORE_VERIFY_FAILED");
    }
  }
}
