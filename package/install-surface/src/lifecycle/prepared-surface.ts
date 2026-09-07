/** Prepared text outputs and exact-state compensation; filesystem effects stay behind LifecycleIO. */
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { assertDestination } from "../path-policy.ts";
import { safePath, sha256 } from "./copy-tree.ts";
import type { PlannedStep } from "./hazards.ts";
import type { LifecycleIO } from "./journal.ts";

export interface PreparedSurface {
  step: PlannedStep;
  surface_class: "COPY" | "TRANSFORM";
  /** Source-owned producer identity for contextual transform output. */
  producer_id?: string;
  /** Reviewed transform-template digest, without a filesystem path. */
  source_hash?: string;
  content: string;
  expected_hash: string;
  /** Preserve a managed file's safe existing mode; absent files default to 0644. */
  expected_mode: number | "preserve";
}
export interface SurfaceLeaf {
  step_id: string;
  record_id: string;
  root_token: string;
  relative_path: string;
  surface_class: "COPY" | "TRANSFORM";
  producer_id: string | null;
  source_hash: string | null;
  ownership: "exclusive-path" | "managed-block";
  expected_hash: string;
  expected_mode: number;
  output: string;
  prior_hash: string | null;
  prior_mode: number | null;
  preimage: string | null;
}
export interface SurfaceManifest {
  schema: "temperance.surface-manifest.v1";
  leaves: SurfaceLeaf[];
}
export type ResolveSurfaceRoot = (token: string) => string;
interface FileState { content: string; hash: string; mode: number; }
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const validMode = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0o777;
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const textOnly = (content: string): string => {
  if (typeof content !== "string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/u.test(content)) throw new Error("SURFACE_TEXT_REQUIRED");
  return content;
};
const modeOf = (mode: number): number => {
  if ((mode & 0o7000) !== 0) throw new Error("SURFACE_MODE_UNSAFE");
  return mode & 0o777;
};
const artifactPath = (kind: "output" | "preimage", stepId: string): string => `${kind}/surface-${sha256(stepId)}.txt`;
const collisionKey = (path: string): string => resolve(path).normalize("NFC").toLowerCase();
const overlap = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
function destination(leaf: SurfaceLeaf, resolveRoot: ResolveSurfaceRoot): { root: string; path: string } {
  const root = resolveRoot(leaf.root_token);
  if (!isAbsolute(root)) throw new Error("SURFACE_ROOT_INVALID");
  return { root: resolve(root), path: resolve(root, leaf.relative_path) };
}
async function readState(io: LifecycleIO, root: string, path: string): Promise<FileState | null> {
  await safePath(io, root, path, "file");
  let before;
  try { before = await io.lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
  const content = textOnly(await io.readFile(path));
  await safePath(io, root, path, "file");
  const after = await io.lstat(path);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode) throw new Error("SURFACE_READ_DRIFT");
  return { content, hash: sha256(content), mode: modeOf(after.mode) };
}
const matches = (state: FileState | null, hash: string | null, mode: number | null): boolean => (state?.hash ?? null) === hash && (state?.mode ?? null) === mode;

/** Validate even in-memory manifests: rollback must not trust a caller's cast. */
export function validateSurfaceManifest(value: unknown): SurfaceManifest {
  if (!value || typeof value !== "object") throw new Error("SURFACE_MANIFEST_INVALID");
  const manifest = value as SurfaceManifest;
  if (manifest.schema !== "temperance.surface-manifest.v1" || !Array.isArray(manifest.leaves)) throw new Error("SURFACE_MANIFEST_INVALID");
  const ids = new Set<string>(), paths: string[] = [];
  for (const leaf of manifest.leaves) {
    if (!leaf || typeof leaf.step_id !== "string" || !/^[\w.-]+$/.test(leaf.step_id) || ids.has(leaf.step_id) || typeof leaf.record_id !== "string" || !leaf.record_id) throw new Error("SURFACE_MANIFEST_INVALID");
    ids.add(leaf.step_id);
    if (leaf.surface_class !== "COPY" && leaf.surface_class !== "TRANSFORM") throw new Error("SURFACE_MANIFEST_INVALID");
    if (leaf.ownership !== "exclusive-path" && leaf.ownership !== "managed-block") throw new Error("SURFACE_MANIFEST_INVALID");
    if (
      (leaf.surface_class === "COPY" && (leaf.producer_id !== null || leaf.source_hash !== null))
      || (leaf.surface_class === "TRANSFORM" && (typeof leaf.producer_id !== "string" || !leaf.producer_id || !validHash(leaf.source_hash)))
    ) throw new Error("SURFACE_MANIFEST_INVALID");
    assertDestination({ root_token: leaf.root_token, relative_path: leaf.relative_path, ownership: { kind: leaf.ownership } });
    const key = `${leaf.root_token}/${leaf.relative_path}`.normalize("NFC").toLowerCase();
    if (paths.some(path => overlap(path, key))) throw new Error("SURFACE_DESTINATION_COLLISION");
    paths.push(key);
    if (!validHash(leaf.expected_hash) || !validMode(leaf.expected_mode) || leaf.output !== artifactPath("output", leaf.step_id)) throw new Error("SURFACE_MANIFEST_INVALID");
    if (leaf.prior_hash === null) {
      if (leaf.prior_mode !== null || leaf.preimage !== null) throw new Error("SURFACE_MANIFEST_INVALID");
    } else if (!validHash(leaf.prior_hash) || !validMode(leaf.prior_mode) || leaf.preimage !== artifactPath("preimage", leaf.step_id)) throw new Error("SURFACE_MANIFEST_INVALID");
  }
  return manifest;
}
function validateResolvedPaths(manifest: SurfaceManifest, txDir: string, resolveRoot: ResolveSurfaceRoot): void {
  const paths: string[] = [];
  for (const leaf of manifest.leaves) {
    const key = collisionKey(destination(leaf, resolveRoot).path);
    if (paths.some(path => overlap(path, key)) || overlap(key, collisionKey(txDir))) throw new Error("SURFACE_DESTINATION_COLLISION");
    paths.push(key);
  }
}
async function requireAbsent(io: LifecycleIO, root: string, path: string): Promise<void> {
  await safePath(io, root, path, "file");
  try { await io.lstat(path); } catch (error) { if (missing(error)) return; throw error; }
  throw new Error("SURFACE_ARTIFACT_EXISTS");
}
async function writeArtifact(io: LifecycleIO, txDir: string, path: string, content: string, mode: number): Promise<void> {
  await requireAbsent(io, txDir, path);
  await io.mkdir(dirname(path), { recursive: true });
  await requireAbsent(io, txDir, path);
  await io.writeFileAtomic(path, content, { mode });
  await safePath(io, txDir, path, "file");
  const state = await readState(io, txDir, path);
  if (!matches(state, sha256(content), mode)) throw new Error("SURFACE_ARTIFACT_VERIFY_FAILED");
}

/** Capture before destination mutation. Never overwrite a prior transaction's artifacts. */
export async function captureSurfaceManifest(io: LifecycleIO, txDir: string, prepared: Map<string, PreparedSurface>, resolveRoot: ResolveSurfaceRoot): Promise<SurfaceManifest> {
  const manifest: SurfaceManifest = { schema: "temperance.surface-manifest.v1", leaves: [] };
  const priors = new Map<string, FileState | null>();
  for (const [id, output] of prepared) {
    const { step } = output;
    if (id !== step.step_id || !validHash(output.expected_hash) || sha256(textOnly(output.content)) !== output.expected_hash || (output.expected_mode !== "preserve" && !validMode(output.expected_mode))) throw new Error("SURFACE_OUTPUT_INVALID");
    assertDestination(step.destination);
    const provisional = { root_token: step.destination.root_token, relative_path: step.destination.relative_path } as SurfaceLeaf;
    const { root, path } = destination(provisional, resolveRoot);
    const prior = await readState(io, root, path);
    priors.set(id, prior);
    manifest.leaves.push({ step_id: id, record_id: step.record_id, root_token: step.destination.root_token, relative_path: step.destination.relative_path,
      surface_class: output.surface_class, producer_id: output.surface_class === "TRANSFORM" ? output.producer_id ?? null : null,
      source_hash: output.surface_class === "TRANSFORM" ? output.source_hash ?? null : null, ownership: step.ownership,
      expected_hash: output.expected_hash, expected_mode: output.expected_mode === "preserve" ? prior?.mode ?? 0o644 : output.expected_mode,
      output: artifactPath("output", id), prior_hash: prior?.hash ?? null, prior_mode: prior?.mode ?? null, preimage: prior ? artifactPath("preimage", id) : null });
  }
  validateSurfaceManifest(manifest);
  validateResolvedPaths(manifest, txDir, resolveRoot);
  await requireAbsent(io, txDir, join(txDir, "surface-manifest.json"));
  for (const leaf of manifest.leaves) {
    await requireAbsent(io, txDir, join(txDir, leaf.output));
    if (leaf.preimage) await requireAbsent(io, txDir, join(txDir, leaf.preimage));
  }
  for (const leaf of manifest.leaves) {
    await writeArtifact(io, txDir, join(txDir, leaf.output), prepared.get(leaf.step_id)!.content, leaf.expected_mode);
    if (leaf.preimage) await writeArtifact(io, txDir, join(txDir, leaf.preimage), priors.get(leaf.step_id)!.content, 0o600);
    await assertSurfacePrior(io, leaf, resolveRoot);
  }
  await writeArtifact(io, txDir, join(txDir, "surface-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", 0o600);
  return manifest;
}
/** Missing is distinct from corrupt/unsupported; existing legacy COPY artifacts remain untouched. */
export async function loadSurfaceManifest(io: LifecycleIO, txDir: string): Promise<SurfaceManifest | null> {
  const state = await readState(io, txDir, join(txDir, "surface-manifest.json"));
  return state ? validateSurfaceManifest(JSON.parse(state.content)) : null;
}
export async function assertSurfacePrior(io: LifecycleIO, leaf: SurfaceLeaf, resolveRoot: ResolveSurfaceRoot): Promise<void> {
  validateSurfaceManifest({ schema: "temperance.surface-manifest.v1", leaves: [leaf] });
  const { root, path } = destination(leaf, resolveRoot);
  if (!matches(await readState(io, root, path), leaf.prior_hash, leaf.prior_mode)) throw new Error("SURFACE_DESTINATION_DRIFT");
}
/** Verify a prepared output or its promoted destination, with exact safe mode. */
export async function verifySurfaceOutput(io: LifecycleIO, leaf: SurfaceLeaf, path: string, root = dirname(path)): Promise<void> {
  validateSurfaceManifest({ schema: "temperance.surface-manifest.v1", leaves: [leaf] });
  if (!matches(await readState(io, root, path), leaf.expected_hash, leaf.expected_mode)) throw new Error("SURFACE_OUTPUT_DRIFT");
}

/** Validate all evidence before any compensation; recheck each leaf immediately before mutation. */
export async function rollbackSurface(io: LifecycleIO, txDir: string, value: SurfaceManifest, resolveRoot: ResolveSurfaceRoot): Promise<void> {
  const manifest = validateSurfaceManifest(value);
  validateResolvedPaths(manifest, txDir, resolveRoot);
  const inspect = async (leaf: SurfaceLeaf) => {
    const { root, path } = destination(leaf, resolveRoot);
    await verifySurfaceOutput(io, leaf, join(txDir, leaf.output), txDir);
    let prior: FileState | null = null;
    if (leaf.preimage) {
      prior = await readState(io, txDir, join(txDir, leaf.preimage));
      if (!matches(prior, leaf.prior_hash, 0o600)) throw new Error("SURFACE_PREIMAGE_DRIFT");
    }
    const current = await readState(io, root, path);
    const unchanged = matches(current, leaf.prior_hash, leaf.prior_mode);
    if (!unchanged && !matches(current, leaf.expected_hash, leaf.expected_mode)) throw new Error("SURFACE_DESTINATION_DRIFT");
    return { root, path, prior, unchanged };
  };
  for (const leaf of manifest.leaves) await inspect(leaf);
  for (const leaf of [...manifest.leaves].reverse()) {
    const { root, path, prior, unchanged } = await inspect(leaf);
    if (unchanged) continue;
    if (!prior) {
      await verifySurfaceOutput(io, leaf, path, root);
      await io.rm(path, { recursive: false, force: false });
      if (await readState(io, root, path)) throw new Error("SURFACE_RESTORE_VERIFY_FAILED");
      continue;
    }
    const stage = join(dirname(path), `.temperance-surface-restore-${randomBytes(16).toString("hex")}.tmp`);
    await requireAbsent(io, root, stage);
    // Failed stages are deliberately left as evidence; retries use a new name.
    // Never delete an unknown path that may have replaced our staging inode.
    await io.writeFileAtomic(stage, prior.content, { mode: leaf.prior_mode! });
    await safePath(io, root, stage, "file");
    if (!matches(await readState(io, root, stage), leaf.prior_hash, leaf.prior_mode)) throw new Error("SURFACE_RESTORE_STAGE_VERIFY_FAILED");
    await verifySurfaceOutput(io, leaf, path, root);
    if (!matches(await readState(io, root, stage), leaf.prior_hash, leaf.prior_mode)) throw new Error("SURFACE_RESTORE_STAGE_VERIFY_FAILED");
    await io.rename(stage, path);
    if (!matches(await readState(io, root, path), leaf.prior_hash, leaf.prior_mode)) throw new Error("SURFACE_RESTORE_VERIFY_FAILED");
  }
}
