import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";

export const OWNER_FILE_MAX_BYTES = 4 * 1024 * 1024;
export type OwnerFileFailureCode = "invalid-bound" | "invalid-path" | "unsupported-flags" | "open-failed" | "invalid-descriptor" | "metadata-failed" | "not-regular" | "file-limit" | "allocation-failed" | "read-failed" | "invalid-read-count" | "truncated" | "grew" | "changed" | "path-changed" | "close-failed";
export class BoundedOwnerFileError extends Error {
  constructor(readonly code: OwnerFileFailureCode) { super(`bounded-owner-file:${code}`); this.name = "BoundedOwnerFileError"; }
}
export interface OwnerFileMetadata {
  regular: boolean; dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint;
}
/** Trusted test/host adapter. It is never selected by request data or environment. */
export interface OwnerFileFs {
  open(path: string, flags: number): number;
  descriptorMetadata(fd: number): OwnerFileMetadata;
  pathMetadata(path: string): OwnerFileMetadata;
  read(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  close(fd: number): void;
  allocate(length: number): Buffer;
}
function metadata(stat: ReturnType<typeof fstatSync> | ReturnType<typeof lstatSync>): OwnerFileMetadata {
  const s = stat as unknown as { isFile(): boolean; dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
  return { regular: s.isFile(), dev: s.dev, ino: s.ino, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs };
}
const nativeFs: OwnerFileFs = {
  open: openSync,
  descriptorMetadata: fd => metadata(fstatSync(fd, { bigint: true })),
  pathMetadata: path => metadata(lstatSync(path, { bigint: true })),
  read: readSync,
  close: closeSync,
  allocate: length => Buffer.alloc(length),
};
function failure(code: OwnerFileFailureCode): never { throw new BoundedOwnerFileError(code); }
function validMetadata(s: OwnerFileMetadata): boolean {
  return s && typeof s.regular === "boolean" && typeof s.dev === "bigint" && s.dev >= 0n && typeof s.ino === "bigint" && s.ino >= 0n && typeof s.size === "bigint" && s.size >= 0n && typeof s.mtimeNs === "bigint" && typeof s.ctimeNs === "bigint";
}
function equal(a: OwnerFileMetadata, b: OwnerFileMetadata): boolean {
  return b.regular && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** Bounded raw-byte snapshot, not an ancestry/authority or synchronous wall-time guarantee.
 * Owner supplies a canonical path and fixed policy ceiling. Final path continuity is checked.
 */
export function readBoundedOwnerFile(path: string, maximumBytes: number, adapter: OwnerFileFs = nativeFs): Buffer {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > OWNER_FILE_MAX_BYTES) failure("invalid-bound");
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0")) failure("invalid-path");
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) failure("unsupported-flags");
  let fd: number;
  try { fd = adapter.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { failure("open-failed"); }
  if (!Number.isSafeInteger(fd) || fd < 0) failure("invalid-descriptor");
  try {
    const getMetadata = (atPath: boolean): OwnerFileMetadata => {
      let s: OwnerFileMetadata;
      try { s = atPath ? adapter.pathMetadata(path) : adapter.descriptorMetadata(fd); } catch { failure("metadata-failed"); }
      if (!validMetadata(s!)) failure("metadata-failed"); return s!;
    };
    const before = getMetadata(false);
    if (!before.regular) failure("not-regular");
    if (before.size > BigInt(maximumBytes)) failure("file-limit");
    const size = Number(before.size); let bytes: Buffer; let probe: Buffer;
    try { bytes = adapter.allocate(size); probe = adapter.allocate(1); } catch { failure("allocation-failed"); }
    if (!Buffer.isBuffer(bytes!) || bytes!.length !== size || !Buffer.isBuffer(probe!) || probe!.length !== 1) failure("allocation-failed");
    const read = (buffer: Buffer, offset: number, length: number, position: number): number => {
      let count: number; try { count = adapter.read(fd, buffer, offset, length, position); } catch { failure("read-failed"); }
      if (!Number.isSafeInteger(count!) || count! < 0 || count! > length) failure("invalid-read-count"); return count!;
    };
    let offset = 0;
    while (offset < size) { const count = read(bytes!, offset, Math.min(size - offset, 65536), offset); if (!count) failure("truncated"); offset += count; }
    if (read(probe!, 0, 1, size)) failure("grew");
    const after = getMetadata(false); if (!equal(before, after)) failure("changed");
    const currentPath = getMetadata(true); if (!equal(after, currentPath)) failure("path-changed");
    return bytes!;
  } finally { try { adapter.close(fd); } catch { failure("close-failed"); } }
}
