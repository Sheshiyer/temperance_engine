/**
 * Deterministic public COPY inventory construction.
 *
 * Expectations are generated from a caller-supplied, full Git commit object,
 * never from the mutable checkout. A separate check compares the current
 * checkout against that reviewed declaration and refuses additions, removals,
 * content drift, mode drift, links, binary data, and case-folded aliases.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import defaultDenyPolicy from "../deny-policy.v1.json" with { type: "json" };
import { canonical } from "./canonical-json.ts";
import { assertDenyPath, type DenyPolicy } from "./deny-policy.ts";
import { assertRepositoryRelativeSource } from "./path-policy.ts";
import type { CopyExpectation, CopyFileMode, SurfaceRecord } from "./types.ts";

const FULL_GIT_OBJECT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const TEXT_FORBIDDEN = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/u;

export class CopyInventoryError extends Error {
  constructor(readonly code: string, readonly details: Record<string, string> = {}) {
    super(code);
    this.name = "CopyInventoryError";
  }
}

export interface CopyInventoryProvenanceRecord {
  id: string;
  source: string;
  source_object: string;
  expectation_digest: `sha256:${string}`;
}

export interface CopyInventoryProvenance {
  schema: "temperance.install-surface.copy-expectations-provenance.v1";
  revision: string;
  tree: string;
  records: CopyInventoryProvenanceRecord[];
}

export interface CopyInventoryResult {
  expectations: Map<string, CopyExpectation>;
  provenance: CopyInventoryProvenance;
}

export interface BuildCopyInventoryOptions {
  repositoryRoot: string;
  revision: string;
  records: readonly SurfaceRecord[];
  denyPolicy?: DenyPolicy;
}

export interface WorkingCopyExpectationOptions {
  repositoryRoot: string;
  records: readonly SurfaceRecord[];
  expectations: ReadonlyMap<string, CopyExpectation>;
  denyPolicy?: DenyPolicy;
}

interface GitTreeEntry {
  mode: string;
  type: string;
  object: string;
  path: string;
}

function byteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inventoryMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function setInventoryEntry<T>(target: Record<string, T>, key: string, value: T): void {
  if (Object.hasOwn(target, key)) throw new CopyInventoryError("COPY_INVENTORY_PATH_COLLISION");
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  // A caller-controlled GIT_DIR, work-tree, object store, or config can make
  // `git -C` inspect a repository other than the supplied product root.
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_")) delete environment[key];
  }
  return {
    ...environment,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function assertRepositoryRoot(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  let stat;
  try {
    stat = lstatSync(root);
  } catch {
    throw new CopyInventoryError("COPY_INVENTORY_REPOSITORY_ROOT_INVALID");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CopyInventoryError("COPY_INVENTORY_REPOSITORY_ROOT_INVALID");
  }
  return root;
}

function runGit(repositoryRoot: string, args: readonly string[]): Buffer {
  try {
    return Buffer.from(execFileSync(
      "git",
      ["-C", repositoryRoot, "--no-replace-objects", ...args],
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        env: gitEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    ));
  } catch {
    throw new CopyInventoryError("COPY_INVENTORY_GIT_READ_FAILED");
  }
}

function textGit(repositoryRoot: string, args: readonly string[]): string {
  const value = runGit(repositoryRoot, args).toString("utf8").trim();
  if (!value || !FULL_GIT_OBJECT_ID.test(value)) throw new CopyInventoryError("COPY_INVENTORY_GIT_OBJECT_INVALID");
  return value;
}

function resolveRevision(repositoryRoot: string, revision: string): { revision: string; tree: string } {
  if (!FULL_GIT_OBJECT_ID.test(revision)) throw new CopyInventoryError("COPY_INVENTORY_REVISION_REQUIRED");
  const resolved = textGit(repositoryRoot, ["rev-parse", "--verify", `${revision}^{commit}`]);
  if (resolved !== revision) throw new CopyInventoryError("COPY_INVENTORY_REVISION_REQUIRED");
  return {
    revision: resolved,
    tree: textGit(repositoryRoot, ["rev-parse", "--verify", `${resolved}^{tree}`]),
  };
}

function assertText(bytes: Buffer): void {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes) || TEXT_FORBIDDEN.test(decoded)) {
    throw new CopyInventoryError("COPY_INVENTORY_TEXT_REQUIRED");
  }
}

function expectedMode(gitMode: string): CopyFileMode {
  if (gitMode === "100644") return "0644";
  if (gitMode === "100755") return "0755";
  throw new CopyInventoryError("COPY_INVENTORY_MODE_UNSUPPORTED", { mode: gitMode });
}

/** Convert a local lstat mode only after rejecting privileged permission bits. */
export function copyFileMode(mode: number): CopyFileMode {
  if ((mode & 0o7000) !== 0) {
    throw new CopyInventoryError("COPY_INVENTORY_MODE_UNSUPPORTED", { mode: (mode & 0o7777).toString(8).padStart(4, "0") });
  }
  const normalized = mode & 0o777;
  if (normalized === 0o644) return "0644";
  if (normalized === 0o755) return "0755";
  throw new CopyInventoryError("COPY_INVENTORY_MODE_UNSUPPORTED", { mode: normalized.toString(8).padStart(4, "0") });
}

function parseTreeEntries(output: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end === -1) throw new CopyInventoryError("COPY_INVENTORY_GIT_TREE_INVALID");
    const entry = output.subarray(offset, end);
    offset = end + 1;
    if (!entry.length) continue;
    const tab = entry.indexOf(0x09);
    if (tab === -1) throw new CopyInventoryError("COPY_INVENTORY_GIT_TREE_INVALID");
    const header = entry.subarray(0, tab).toString("ascii").split(" ");
    const pathBytes = entry.subarray(tab + 1);
    const path = pathBytes.toString("utf8");
    if (!Buffer.from(path, "utf8").equals(pathBytes)) throw new CopyInventoryError("COPY_INVENTORY_PATH_INVALID");
    if (header.length !== 3 || !FULL_GIT_OBJECT_ID.test(header[2])) throw new CopyInventoryError("COPY_INVENTORY_GIT_TREE_INVALID");
    entries.push({ mode: header[0], type: header[1], object: header[2], path });
  }
  return entries;
}

function assertPathSet(paths: readonly string[]): void {
  const leaves = new Set<string>();
  const directories = new Set<string>();
  const rendered = new Map<string, string>();
  for (const path of paths) {
    const segments = assertRepositoryRelativeSource(path);
    for (let index = 0; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index + 1).join("/");
      const key = prefix.normalize("NFC").toLocaleLowerCase("en-US");
      const prior = rendered.get(key);
      if (prior !== undefined && prior !== prefix) throw new CopyInventoryError("COPY_INVENTORY_PATH_COLLISION");
      rendered.set(key, prefix);
      if (index === segments.length - 1) leaves.add(key);
      else directories.add(key);
    }
  }
  for (const leaf of leaves) {
    if (directories.has(leaf)) throw new CopyInventoryError("COPY_INVENTORY_PATH_COLLISION");
  }
}

function gitSourceEntries(repositoryRoot: string, revision: string, source: string): { object: string; type: string; entries: GitTreeEntry[] } {
  assertRepositoryRelativeSource(source);
  let object: string;
  try {
    object = textGit(repositoryRoot, ["rev-parse", "--verify", `${revision}:${source}`]);
  } catch (error) {
    if (error instanceof CopyInventoryError && error.code === "COPY_INVENTORY_GIT_READ_FAILED") {
      throw new CopyInventoryError("COPY_INVENTORY_SOURCE_MISSING", { source });
    }
    throw error;
  }
  const type = runGit(repositoryRoot, ["cat-file", "-t", `${revision}:${source}`]).toString("utf8").trim();
  if (type !== "blob" && type !== "tree") throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");
  const entries = parseTreeEntries(runGit(repositoryRoot, ["ls-tree", "-r", "-z", revision, "--", source]));
  if (entries.length === 0) throw new CopyInventoryError("COPY_INVENTORY_EMPTY_TREE");
  return { object, type, entries };
}

function expectationForRecord(
  repositoryRoot: string,
  revision: string,
  record: SurfaceRecord,
  denyPolicy: DenyPolicy,
): { expectation: CopyExpectation; sourceObject: string } {
  if (record.class !== "COPY") throw new CopyInventoryError("COPY_INVENTORY_RECORD_CLASS_INVALID");
  assertDenyPath(record.source, denyPolicy);
  const source = gitSourceEntries(repositoryRoot, revision, record.source);
  if (source.type === "blob") {
    if (source.entries.length !== 1 || source.entries[0].path !== record.source) {
      throw new CopyInventoryError("COPY_INVENTORY_GIT_TREE_INVALID");
    }
    const entry = source.entries[0];
    if (entry.type !== "blob") throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");
    const bytes = runGit(repositoryRoot, ["cat-file", "blob", entry.object]);
    assertText(bytes);
    return {
      sourceObject: source.object,
      expectation: { kind: "file", sha256: sha256(bytes), mode: expectedMode(entry.mode) },
    };
  }

  const files = inventoryMap<`sha256:${string}`>();
  const modes = inventoryMap<CopyFileMode>();
  for (const entry of source.entries.sort((left, right) => byteOrder(left.path, right.path))) {
    if (entry.type !== "blob") throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");
    const prefix = `${record.source}/`;
    if (!entry.path.startsWith(prefix)) throw new CopyInventoryError("COPY_INVENTORY_GIT_TREE_INVALID");
    const path = entry.path.slice(prefix.length);
    assertRepositoryRelativeSource(path);
    assertDenyPath(`${record.source}/${path}`, denyPolicy);
    const bytes = runGit(repositoryRoot, ["cat-file", "blob", entry.object]);
    assertText(bytes);
    setInventoryEntry(files, path, sha256(bytes));
    setInventoryEntry(modes, path, expectedMode(entry.mode));
  }
  assertPathSet(Object.keys(files));
  return {
    sourceObject: source.object,
    expectation: { kind: "tree", files, modes },
  };
}

export function buildCopyInventory(options: BuildCopyInventoryOptions): CopyInventoryResult {
  const repositoryRoot = assertRepositoryRoot(options.repositoryRoot);
  const revision = resolveRevision(repositoryRoot, options.revision);
  const denyPolicy = options.denyPolicy ?? defaultDenyPolicy as DenyPolicy;
  const expectations = new Map<string, CopyExpectation>();
  const provenanceRecords: CopyInventoryProvenanceRecord[] = [];
  for (const record of [...options.records].filter((candidate) => candidate.class === "COPY").sort((left, right) => byteOrder(left.id, right.id))) {
    const built = expectationForRecord(repositoryRoot, revision.revision, record, denyPolicy);
    expectations.set(record.id, built.expectation);
    provenanceRecords.push({
      id: record.id,
      source: record.source,
      source_object: built.sourceObject,
      expectation_digest: sha256(canonical(built.expectation)),
    });
  }
  return {
    expectations,
    provenance: {
      schema: "temperance.install-surface.copy-expectations-provenance.v1",
      revision: revision.revision,
      tree: revision.tree,
      records: provenanceRecords,
    },
  };
}

function localSourcePath(repositoryRoot: string, source: string): string {
  const root = assertRepositoryRoot(repositoryRoot);
  const segments = assertRepositoryRelativeSource(source);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      throw new CopyInventoryError("COPY_INVENTORY_SOURCE_MISSING");
    }
    if (stat.isSymbolicLink()) throw new CopyInventoryError("COPY_INVENTORY_LINK_REJECTED");
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");
    }
  }
  return current;
}

function localExpectation(repositoryRoot: string, source: string, denyPolicy: DenyPolicy): CopyExpectation {
  assertDenyPath(source, denyPolicy);
  const absoluteSource = localSourcePath(repositoryRoot, source);
  const stat = lstatSync(absoluteSource);
  if (stat.isSymbolicLink()) throw new CopyInventoryError("COPY_INVENTORY_LINK_REJECTED");
  if (stat.isFile()) {
    const bytes = readFileSync(absoluteSource);
    assertText(bytes);
    return { kind: "file", sha256: sha256(bytes), mode: copyFileMode(stat.mode) };
  }
  if (!stat.isDirectory()) throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");

  const files = inventoryMap<`sha256:${string}`>();
  const modes = inventoryMap<CopyFileMode>();
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort(byteOrder)) {
      assertRepositoryRelativeSource(name);
      const path = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      assertDenyPath(`${source}/${relativePath}`, denyPolicy);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) throw new CopyInventoryError("COPY_INVENTORY_LINK_REJECTED");
      if (entry.isDirectory()) {
        walk(path, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new CopyInventoryError("COPY_INVENTORY_SOURCE_TYPE_INVALID");
      const bytes = readFileSync(path);
      assertText(bytes);
      setInventoryEntry(files, relativePath, sha256(bytes));
      setInventoryEntry(modes, relativePath, copyFileMode(entry.mode));
    }
  };
  walk(absoluteSource, "");
  if (Object.keys(files).length === 0) throw new CopyInventoryError("COPY_INVENTORY_EMPTY_TREE");
  assertPathSet(Object.keys(files));
  return { kind: "tree", files, modes };
}

export function assertWorkingCopyMatches(options: WorkingCopyExpectationOptions): void {
  const denyPolicy = options.denyPolicy ?? defaultDenyPolicy as DenyPolicy;
  for (const record of options.records) {
    if (record.class !== "COPY") continue;
    const expected = options.expectations.get(record.id);
    if (!expected) throw new CopyInventoryError("COPY_INVENTORY_EXPECTATION_MISSING", { id: record.id });
    let actual: CopyExpectation;
    try {
      actual = localExpectation(options.repositoryRoot, record.source, denyPolicy);
    } catch (error) {
      if (error instanceof CopyInventoryError) throw error;
      throw new CopyInventoryError("COPY_INVENTORY_WORKTREE_MISMATCH", { id: record.id });
    }
    if (canonical(actual) !== canonical(expected)) {
      throw new CopyInventoryError("COPY_INVENTORY_WORKTREE_MISMATCH", { id: record.id });
    }
  }
}
