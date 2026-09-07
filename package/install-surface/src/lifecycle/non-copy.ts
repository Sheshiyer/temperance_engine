/**
 * Source-owned producers for public non-COPY installation records.
 *
 * This module deliberately has no process, network, or runtime-service
 * dependencies. A producer either prepares bounded bytes for the lifecycle
 * to verify and promote, or reports that it is unavailable. It never writes a
 * destination itself.
 */

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { join, resolve } from "node:path";

import { assertRepositoryRelativeSource } from "../path-policy.ts";
import type { CopyFileMode, RegenerateSurfaceRecord, TransformSurfaceRecord } from "../types.ts";
import { safePath } from "./copy-tree.ts";
import type { LifecycleIO } from "./journal.ts";

export const MANAGED_TEMPLATE_ADAPTER = "managed-template-v1" as const;
export const MANAGED_TEMPLATE_DEFAULT_MODE = 0o644;

export type ProducerUnavailable = {
  status: "unavailable";
  code: "ADAPTER_UNAVAILABLE" | "GENERATOR_UNAVAILABLE";
  producer_id: string;
  reason: string;
};

export type PreparedTransform = {
  status: "prepared";
  record_id: string;
  producer_id: string;
  content: string;
  source_hash: string;
  /** Exact user-adjacent input that was rendered into the output. */
  destination_before: { hash: string | null; mode: number | null };
  /** Preserve an existing regular destination's safe mode; use this for a new one. */
  mode: { kind: "preserve-existing"; absent_mode: number };
};

export type NonCopyPreparation = PreparedTransform | ProducerUnavailable;

export interface NonCopyPreparationOptions {
  io: LifecycleIO;
  repositoryRoot: string | undefined;
  resolveRoot: (token: string) => string;
}

const BLOCK_START_MARKER = "<!-- temperance:managed:start";
const BLOCK_END_MARKER = "<!-- temperance:managed:end";
const MANAGED_MARKER_PREFIX = "<!-- temperance:managed:";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function requireText(content: string, code: string): string {
  if (/[^\x09\x0a\x0d\x20-\x7e\u0080-\ufffc]/u.test(content) || content.includes("\ufffd")) {
    throw new Error(code);
  }
  return content;
}

function regularMode(mode: number, code: string): number {
  if ((mode & 0o7000) !== 0) throw new Error(code);
  return mode & 0o777;
}

function declaredMode(mode: CopyFileMode | undefined): number {
  if (mode === "0644") return 0o644;
  if (mode === "0755") return 0o755;
  throw new Error("TRANSFORM_SOURCE_MODE_REQUIRED");
}

function markerPositions(content: string, marker: string): number[] {
  const positions: number[] = [];
  let cursor = content.indexOf(marker);
  while (cursor !== -1) {
    positions.push(cursor);
    cursor = content.indexOf(marker, cursor + marker.length);
  }
  return positions;
}

const MANAGED_MARKER = /<!-- temperance:managed:(start|end) ([A-Za-z0-9][A-Za-z0-9._-]{0,191}) -->/g;
const MANAGED_MARKER_AT_START = /^<!-- temperance:managed:(start|end) ([A-Za-z0-9][A-Za-z0-9._-]{0,191}) -->/;

/**
 * Blocks owned by different producers may be adjacent, but never nested or
 * crossed. Replacing an outer block would otherwise silently erase another
 * owner's bytes. This is intentionally stricter than a target-only search.
 */
function assertNonOverlappingManagedBlocks(content: string): void {
  // The exact grammar is part of ownership. A near-miss target marker must not
  // be treated as ordinary user context: appending a valid block beside it
  // would leave two competing declarations of the same owned region.
  let cursor = content.indexOf(MANAGED_MARKER_PREFIX);
  while (cursor !== -1) {
    const match = MANAGED_MARKER_AT_START.exec(content.slice(cursor));
    if (!match) throw new Error("MANAGED_BLOCK_MARKERS_INVALID");
    cursor = content.indexOf(MANAGED_MARKER_PREFIX, cursor + match[0].length);
  }

  let open: string | null = null;
  for (const match of content.matchAll(MANAGED_MARKER)) {
    const [, kind, id] = match;
    if (kind === "start") {
      if (open !== null) throw new Error("MANAGED_BLOCK_MARKERS_INVALID");
      open = id;
      continue;
    }
    if (open !== id) throw new Error("MANAGED_BLOCK_MARKERS_INVALID");
    open = null;
  }
  if (open !== null) throw new Error("MANAGED_BLOCK_MARKERS_INVALID");
}

function sameRegularFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.mode === after.mode
    && before.nlink === after.nlink;
}

/**
 * Render exactly one owned block. Outside bytes are never normalized or
 * rewritten; an unowned file without a block only gains an appended block.
 */
export function spliceManagedBlock(
  existingContent: string,
  blockId: string,
  newBlockContent: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(blockId)) {
    throw new Error("MANAGED_BLOCK_ID_INVALID");
  }
  const startMarker = `${BLOCK_START_MARKER} ${blockId} -->`;
  const endMarker = `${BLOCK_END_MARKER} ${blockId} -->`;
  if (newBlockContent.includes(BLOCK_START_MARKER) || newBlockContent.includes(BLOCK_END_MARKER)) {
    throw new Error("MANAGED_BLOCK_TEMPLATE_MARKER_CONFLICT");
  }

  assertNonOverlappingManagedBlocks(existingContent);

  const starts = markerPositions(existingContent, startMarker);
  const ends = markerPositions(existingContent, endMarker);
  if (starts.length === 0 && ends.length === 0) {
    const separator = existingContent.length === 0 || existingContent.endsWith("\n") ? "" : "\n";
    const body = newBlockContent.endsWith("\n") ? newBlockContent.slice(0, -1) : newBlockContent;
    return `${existingContent}${separator}${startMarker}\n${body}\n${endMarker}\n`;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
    throw new Error("MANAGED_BLOCK_MARKERS_INVALID");
  }

  const body = newBlockContent.endsWith("\n") ? newBlockContent.slice(0, -1) : newBlockContent;
  const before = existingContent.slice(0, starts[0] + startMarker.length);
  const after = existingContent.slice(ends[0]);
  return `${before}\n${body}\n${after}`;
}

async function readExistingText(
  io: LifecycleIO,
  root: string,
  destination: string,
): Promise<{ content: string; mode: number } | null> {
  await safePath(io, root, destination, "file");
  try {
    const before = await io.lstat(destination);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new Error("TRANSFORM_DESTINATION_UNSAFE");
    }
    const content = requireText(await io.readFile(destination), "TRANSFORM_DESTINATION_TEXT_REQUIRED");
    await safePath(io, root, destination, "file");
    const after = await io.lstat(destination);
    if (!sameRegularFile(before, after)) throw new Error("TRANSFORM_DESTINATION_READ_DRIFT");
    return { content, mode: regularMode(after.mode, "TRANSFORM_DESTINATION_MODE_UNSAFE") };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function unavailableAdapter(record: TransformSurfaceRecord): ProducerUnavailable {
  return {
    status: "unavailable",
    code: "ADAPTER_UNAVAILABLE",
    producer_id: record.verification.adapter_id,
    reason: `ADAPTER_UNAVAILABLE: ${record.verification.adapter_id}`,
  };
}

function unavailableGenerator(record: RegenerateSurfaceRecord): ProducerUnavailable {
  return {
    status: "unavailable",
    code: "GENERATOR_UNAVAILABLE",
    producer_id: record.verification.generator_id,
    reason: `GENERATOR_UNAVAILABLE: ${record.verification.generator_id} has no source-owned producer`,
  };
}

/**
 * Availability is a source contract, not a best-effort fallback decision.
 * The caller may use this before creating a transaction; rendering remains a
 * separate operation because it reads the bounded template and destination.
 */
export function producerAvailability(
  record: TransformSurfaceRecord | RegenerateSurfaceRecord,
): ProducerUnavailable | null {
  if (record.class === "REGENERATE") return unavailableGenerator(record);
  return record.verification.adapter_id === MANAGED_TEMPLATE_ADAPTER ? null : unavailableAdapter(record);
}

export async function prepareNonCopy(
  record: TransformSurfaceRecord | RegenerateSurfaceRecord,
  options: NonCopyPreparationOptions,
): Promise<NonCopyPreparation> {
  const availability = producerAvailability(record);
  if (availability) return availability;
  if (record.class !== "TRANSFORM") throw new Error("NON_COPY_PRODUCER_INVALID");
  if (record.destination.ownership.kind !== "managed-block" || !record.destination.ownership.marker_id) {
    throw new Error("TRANSFORM_MANAGED_BLOCK_REQUIRED");
  }
  if (!options.repositoryRoot) throw new Error("TRANSFORM_SOURCE_ROOT_REQUIRED");
  if (!record.verification.expected || record.verification.expected.kind !== "file") {
    throw new Error("TRANSFORM_SOURCE_EXPECTATION_REQUIRED");
  }

  const repositoryRoot = resolve(options.repositoryRoot);
  assertRepositoryRelativeSource(record.source);
  const sourcePath = resolve(repositoryRoot, record.source);
  await safePath(options.io, repositoryRoot, sourcePath, "file");
  const sourceBefore = await options.io.lstat(sourcePath);
  if (!sourceBefore.isFile() || sourceBefore.isSymbolicLink() || sourceBefore.nlink !== 1) {
    throw new Error("TRANSFORM_SOURCE_UNSAFE");
  }
  if (regularMode(sourceBefore.mode, "TRANSFORM_SOURCE_MODE_UNSAFE") !== declaredMode(record.verification.expected.mode)) {
    throw new Error("TRANSFORM_SOURCE_MODE_DRIFT");
  }
  const source = requireText(await options.io.readFile(sourcePath), "TRANSFORM_SOURCE_TEXT_REQUIRED");
  await safePath(options.io, repositoryRoot, sourcePath, "file");
  const sourceAfter = await options.io.lstat(sourcePath);
  if (!sameRegularFile(sourceBefore, sourceAfter)) throw new Error("TRANSFORM_SOURCE_READ_DRIFT");
  const sourceHash = digest(source);
  if (`sha256:${sourceHash}` !== record.verification.expected.sha256) {
    throw new Error("TRANSFORM_SOURCE_HASH_DRIFT");
  }

  const root = resolve(options.resolveRoot(record.destination.root_token));
  const destination = join(root, record.destination.relative_path);
  const existing = await readExistingText(options.io, root, destination);
  const content = spliceManagedBlock(existing?.content ?? "", record.destination.ownership.marker_id, source);
  return {
    status: "prepared",
    record_id: record.id,
    producer_id: record.verification.adapter_id,
    content,
    source_hash: sourceHash,
    destination_before: { hash: existing ? digest(existing.content) : null, mode: existing?.mode ?? null },
    mode: { kind: "preserve-existing", absent_mode: MANAGED_TEMPLATE_DEFAULT_MODE },
  };
}
