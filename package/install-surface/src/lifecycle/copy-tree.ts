/** Text-only COPY expansion and durable leaf recovery. No directory replacement or recursive removal. */
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertDestination, assertRepositoryRelativeSource } from "../path-policy.ts";
import type { SurfaceRecord } from "../types.ts";
import type { PlannedStep } from "./hazards.ts";
import type { LifecycleIO } from "./journal.ts";

export type DeclaredCopyHashes = Record<string, Record<string, string>>;
export interface CopyLeaf {
  step_id: string;
  record_id: string;
  root_token: string;
  relative_path: string;
  expected_hash: string;
  prior_hash: string | null;
  preimage: string | null;
}
export interface CopyManifest { schema: "temperance.copy-manifest.v1"; leaves: CopyLeaf[]; }
export interface PreparedCopy { step: PlannedStep; content: string; expected_hash: string; }
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
async function readExisting(io: LifecycleIO, root: string, path: string): Promise<string | null> {
  await safePath(io, root, path, "file");
  try { return textOnly(await io.readFile(path)); } catch (error) { if (missing(error)) return null; throw error; }
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
    if (tree && !declaration) throw new Error("COPY_TREE_HASHES_REQUIRED");
    const leaves: { path: string; content: string }[] = [];
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
        const content = textOnly(await io.readFile(path));
        await safePath(io, root, path, "file");
        leaves.push({ path: rel || ".", content });
      }
    };
    await walk(source, "");
    leaves.sort((a, b) => order(a.path, b.path));
    if (declaration && JSON.stringify(Object.keys(declaration).sort(order)) !== JSON.stringify(leaves.map(l => l.path))) throw new Error("COPY_HASH_INVENTORY_MISMATCH");
    for (const leaf of leaves) {
      const expected = declaration?.[leaf.path]?.replace(/^sha256:/, "") ?? sha256(leaf.content);
      if (!/^[a-f0-9]{64}$/.test(expected) || sha256(leaf.content) !== expected) throw new Error("COPY_DECLARED_HASH_MISMATCH");
      const leafStep: PlannedStep = tree ? {
        ...step, step_id: `${step.step_id}-${sha256(leaf.path).slice(0, 16)}`,
        destination: { ...step.destination, relative_path: `${step.destination.relative_path}/${leaf.path}` },
      } : step;
      assertDestination(leafStep.destination);
      if (copies.has(leafStep.step_id)) throw new Error("COPY_STEP_COLLISION");
      expanded.push(leafStep); copies.set(leafStep.step_id, { step: leafStep, content: leaf.content, expected_hash: expected });
    }
  }
  return { steps: expanded, copies };
}

export async function captureCopyManifest(io: LifecycleIO, txDir: string, copies: Map<string, PreparedCopy>, resolveRoot: (token: string) => string): Promise<CopyManifest> {
  const manifest: CopyManifest = { schema: "temperance.copy-manifest.v1", leaves: [] };
  const destinations = new Set<string>();
  for (const { step, expected_hash } of copies.values()) {
    const root = resolveRoot(step.destination.root_token), dest = join(root, step.destination.relative_path);
    const key = resolve(dest).normalize("NFC").toLowerCase();
    if (destinations.has(key)) throw new Error("COPY_DESTINATION_COLLISION");
    destinations.add(key);
    const prior = await readExisting(io, root, dest);
    const preimage = prior === null ? null : `preimage/copy-${sha256(step.step_id)}.txt`;
    if (preimage) { await io.writeFileAtomic(join(txDir, preimage), prior!); if (sha256(await io.readFile(join(txDir, preimage))) !== sha256(prior!)) throw new Error("COPY_PREIMAGE_VERIFY_FAILED"); }
    manifest.leaves.push({ step_id: step.step_id, record_id: step.record_id, root_token: step.destination.root_token,
      relative_path: step.destination.relative_path, expected_hash, prior_hash: prior === null ? null : sha256(prior), preimage });
  }
  if (copies.size) await io.writeFileAtomic(join(txDir, "copy-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function assertCopyPrior(io: LifecycleIO, leaf: CopyLeaf, resolveRoot: (token: string) => string): Promise<void> {
  const root = resolveRoot(leaf.root_token);
  const current = await readExisting(io, root, join(root, leaf.relative_path));
  if ((current === null ? null : sha256(current)) !== leaf.prior_hash) throw new Error("COPY_DESTINATION_DRIFT");
}

/** Missing manifests are legacy; invalid/corrupt manifests must never fall back. */
export async function loadCopyManifest(io: LifecycleIO, txDir: string): Promise<CopyManifest | null> {
  let raw: string;
  try { await safePath(io, txDir, join(txDir, "copy-manifest.json"), "file"); raw = await io.readFile(join(txDir, "copy-manifest.json")); } catch (error) { if (missing(error)) return null; throw error; }
  const value = JSON.parse(raw);
  if (value?.schema !== "temperance.copy-manifest.v1" || !Array.isArray(value.leaves)) throw new Error("COPY_MANIFEST_INVALID");
  const seen = new Set<string>();
  for (const leaf of value.leaves) {
    if (!leaf || typeof leaf.step_id !== "string" || !/^[\w.-]+$/.test(leaf.step_id) || typeof leaf.record_id !== "string" || seen.has(leaf.step_id)) throw new Error("COPY_MANIFEST_INVALID");
    seen.add(leaf.step_id);
    assertDestination({ root_token: leaf.root_token, relative_path: leaf.relative_path, ownership: { kind: "exclusive-path" } });
    if (typeof leaf.expected_hash !== "string" || !/^[a-f0-9]{64}$/.test(leaf.expected_hash)) throw new Error("COPY_MANIFEST_INVALID");
    if (leaf.prior_hash === null ? leaf.preimage !== null : (!/^[a-f0-9]{64}$/.test(leaf.prior_hash) || leaf.preimage !== `preimage/copy-${sha256(leaf.step_id)}.txt`)) throw new Error("COPY_MANIFEST_INVALID");
  }
  return value;
}

export async function rollbackCopies(io: LifecycleIO, txDir: string, manifest: CopyManifest, resolveRoot: (token: string) => string): Promise<void> {
  const inspect = async (leaf: CopyLeaf): Promise<{ dest: string; prior: string | null; changed: boolean }> => {
    const root = resolveRoot(leaf.root_token), dest = join(root, leaf.relative_path);
    const current = await readExisting(io, root, dest), currentHash = current === null ? null : sha256(current);
    let prior: string | null = null;
    if (leaf.preimage) {
      await safePath(io, txDir, join(txDir, leaf.preimage), "file");
      prior = await io.readFile(join(txDir, leaf.preimage));
      if (sha256(prior) !== leaf.prior_hash) throw new Error("COPY_PREIMAGE_DRIFT");
    }
    if (currentHash !== leaf.expected_hash && currentHash !== leaf.prior_hash) throw new Error("COPY_DESTINATION_DRIFT");
    return { dest, prior, changed: currentHash !== leaf.prior_hash };
  };
  // Whole-manifest validation before any compensation, then immediate recheck.
  for (const leaf of manifest.leaves) await inspect(leaf);
  for (const leaf of [...manifest.leaves].reverse()) {
    const { dest, prior, changed } = await inspect(leaf);
    if (!changed) continue;
    if (prior === null) await io.rm(dest, { recursive: false, force: false });
    else { await io.writeFileAtomic(dest, prior); if (sha256(await io.readFile(dest)) !== leaf.prior_hash) throw new Error("COPY_RESTORE_VERIFY_FAILED"); }
  }
}
