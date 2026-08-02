import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { FFIType, dlopen, ptr } from "bun:ffi";
import {
  SIGNED_PROBE_MAX_CANONICAL_BYTES,
  SIGNED_PROBE_MAX_CLOCK_SKEW_MS,
  SIGNED_PROBE_MAX_LIFETIME_MS,
  canonicalProbeJson,
  generateProbeChallenge,
} from "./signed-probe-receipt";

export const SIGNED_PROBE_CHALLENGE_LEDGER_SCHEMA_VERSION = 1 as const;
export const SIGNED_PROBE_CHALLENGE_LEDGER_KIND =
  "temperance.signed-probe-challenge-ledger" as const;
export const SIGNED_PROBE_CHALLENGE_OPERATION_KIND =
  "temperance.signed-probe-challenge-operation" as const;
export const SIGNED_PROBE_CHALLENGE_MAX_ENTRIES = 128;
export const SIGNED_PROBE_CHALLENGE_DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SIGNED_PROBE_CHALLENGE_MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SIGNED_PROBE_CHALLENGE_RECOVERY_MARGIN_MS = 60_000;
export const SIGNED_PROBE_CHALLENGE_DEFAULT_LOCK_TIMEOUT_MS = 5_000;

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const F_GETFD = 1;
const F_FULLFSYNC = 51;
const FD_CLOEXEC = 1;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;
const O_CLOEXEC = process.platform === "darwin" ? 0x01000000 : 0o2000000;
const AT_FDCWD = process.platform === "darwin" ? -2 : -100;
const ALLOWED_LINUX_FILESYSTEM_TYPES = new Set<number>([
  0xef53,
  0x58465342,
  0x9123683e,
  0x2fc12fc1,
]); // ext, XFS, Btrfs, ZFS.

export type ChallengeStatus = "issued" | "consumed" | "revoked";
export type ChallengeOperation = "issue" | "consume" | "revoke-issuance";
export type ChallengeOperationStatus = "prepared" | "applied" | "aborted";
export type ChallengeFaultPoint =
  | "after-backup-fsync"
  | "after-prepared-receipt-fsync"
  | "before-ledger-temp-fsync"
  | "after-ledger-temp-fsync"
  | "after-ledger-rename"
  | "after-ledger-directory-fsync"
  | "after-committed-receipt-fsync";

export interface ChallengeEntry {
  keyId: string;
  challenge: string;
  status: ChallengeStatus;
  issuedAt: string;
  expiresAt: string;
  retainUntil: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

export interface ChallengeLedger {
  schemaVersion: 1;
  kind: typeof SIGNED_PROBE_CHALLENGE_LEDGER_KIND;
  generation: number;
  lastOperationId: string | null;
  updatedAt: string;
  entries: ChallengeEntry[];
}

interface StateReference {
  exists: boolean;
  generation: number;
  hash: string;
  lastOperationId: string | null;
}

export interface ChallengeOperationReceipt {
  schemaVersion: 1;
  kind: typeof SIGNED_PROBE_CHALLENGE_OPERATION_KIND;
  status: ChallengeOperationStatus;
  operation: ChallengeOperation;
  operationId: string;
  readonly authorizing: false;
  ledgerPath: string;
  ledgerDirectoryDevice: string;
  ledgerDirectoryInode: string;
  keyId: string;
  challenge: string;
  createdAt: string;
  completedAt: string | null;
  pre: StateReference;
  post: StateReference;
  backupPath: string | null;
  backupHash: string | null;
  ledgerTempName: string;
  sourceReceiptPath: string | null;
  sourceReceiptHash: string | null;
}

export interface ChallengeMutationOptions {
  ledgerPath: string;
  receiptDirectory: string;
  nowMs?: number;
  lockTimeoutMs?: number;
  faultInjector?: (point: ChallengeFaultPoint) => void;
}

export interface IssueChallengeOptions extends ChallengeMutationOptions {
  keyId: string;
  lifetimeMs?: number;
  retentionAfterExpiryMs?: number;
}

export interface ConsumeChallengeOptions extends ChallengeMutationOptions {
  keyId: string;
  challenge: string;
}

export interface RollbackChallengeOptions extends Omit<ChallengeMutationOptions, "ledgerPath"> {
  operationReceiptPath: string;
}

export interface RecoverChallengeOptions {
  operationReceiptPath: string;
  lockTimeoutMs?: number;
}

export interface ChallengeMutationResult {
  schemaVersion: 1;
  kind: "temperance.signed-probe-challenge-result";
  operation: ChallengeOperation;
  status: "issued" | "consumed" | "revoked";
  keyId: string;
  challenge: string;
  issuedAt: string;
  expiresAt: string;
  retainUntil: string;
  generation: number;
  operationId: string;
  receiptPath: string;
  readonly authorizing: false;
}

export interface ChallengeRecoveryResult {
  schemaVersion: 1;
  kind: "temperance.signed-probe-challenge-recovery";
  operationId: string;
  status: ChallengeOperationStatus;
  receiptPath: string;
  readonly authorizing: false;
}

interface PosixApi {
  openat(directoryFd: number, name: string, flags: number, mode: number): number;
  renameat(directoryFd: number, from: string, to: string): void;
  unlinkat(directoryFd: number, name: string): void;
  mkdirat(directoryFd: number, name: string, mode: number): void;
  flock(fd: number, operation: number): number;
  descriptorFlags(fd: number): number;
  filesystem(fd: number): { name: string | null; type: number };
  fullFsync(fd: number): void;
}

interface TrustedDirectory {
  path: string;
  fd: number;
  device: string;
  inode: string;
}

interface SafeTarget {
  path: string;
  name: string;
  directory: TrustedDirectory;
}

interface LedgerSnapshot {
  exists: boolean;
  raw: Buffer | null;
  hash: string;
  state: ChallengeLedger;
}

function nativeString(value: string): Buffer {
  return Buffer.from(`${value}\0`, "utf8");
}

function loadPosixApi(): PosixApi {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("challenge-ledger-posix-platform-required");
  }
  const candidates = process.platform === "darwin"
    ? ["/usr/lib/libSystem.B.dylib"]
    : ["libc.so.6", "/lib/x86_64-linux-gnu/libc.so.6", "/lib/aarch64-linux-gnu/libc.so.6"];
  let lastError = "unknown";
  for (const candidate of candidates) {
    try {
      const library = dlopen(candidate, {
        openat: {
          args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.u32],
          returns: FFIType.i32,
        },
        renameat: {
          args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring],
          returns: FFIType.i32,
        },
        unlinkat: {
          args: [FFIType.i32, FFIType.cstring, FFIType.i32],
          returns: FFIType.i32,
        },
        mkdirat: {
          args: [FFIType.i32, FFIType.cstring, FFIType.u32],
          returns: FFIType.i32,
        },
        flock: {
          args: [FFIType.i32, FFIType.i32],
          returns: FFIType.i32,
        },
        fcntl: {
          args: [FFIType.i32, FFIType.i32, FFIType.i32],
          returns: FFIType.i32,
        },
        fstatfs: {
          args: [FFIType.i32, FFIType.ptr],
          returns: FFIType.i32,
        },
      });
      return {
        openat(directoryFd, name, flags, mode) {
          return Number(library.symbols.openat(directoryFd, nativeString(name), flags, mode));
        },
        renameat(directoryFd, from, to) {
          if (Number(library.symbols.renameat(
            directoryFd,
            nativeString(from),
            directoryFd,
            nativeString(to),
          )) !== 0) {
            throw new Error("challenge-ledger-renameat-failed");
          }
        },
        unlinkat(directoryFd, name) {
          if (Number(library.symbols.unlinkat(directoryFd, nativeString(name), 0)) !== 0) {
            throw new Error("challenge-ledger-unlinkat-failed");
          }
        },
        mkdirat(directoryFd, name, mode) {
          if (Number(library.symbols.mkdirat(directoryFd, nativeString(name), mode)) !== 0) {
            throw new Error("challenge-ledger-mkdirat-failed");
          }
        },
        flock(fd, operation) {
          return Number(library.symbols.flock(fd, operation));
        },
        descriptorFlags(fd) {
          return Number(library.symbols.fcntl(fd, F_GETFD, 0));
        },
        filesystem(fd) {
          const buffer = Buffer.alloc(4096);
          if (Number(library.symbols.fstatfs(fd, ptr(buffer))) !== 0) {
            throw new Error("challenge-ledger-fstatfs-failed");
          }
          if (process.platform === "darwin") {
            return {
              name: buffer.subarray(72, 88).toString("utf8").replace(/\0.*$/s, ""),
              type: buffer.readUInt32LE(60),
            };
          }
          return { name: null, type: Number(buffer.readBigUInt64LE(0)) };
        },
        fullFsync(fd) {
          if (Number(library.symbols.fcntl(fd, F_FULLFSYNC, 0)) !== 0) {
            throw new Error("challenge-ledger-full-fsync-failed");
          }
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`challenge-ledger-posix-api-unavailable:${lastError}`);
}

const POSIX = loadPosixApi();

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function timestamp(nowMs: number): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("challenge-ledger-clock-invalid");
  return new Date(nowMs).toISOString();
}

function validKeyId(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.normalize("NFC") &&
    /^[A-Za-z0-9._/@-]{1,128}$/.test(value);
}

function validChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validHash(value: unknown, allowAbsent = false): value is string {
  return typeof value === "string" &&
    (/^sha256:[a-f0-9]{64}$/.test(value) || (allowAbsent && value === "absent"));
}

function hashBytes(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ownerUid(): number {
  if (typeof process.getuid !== "function") throw new Error("challenge-ledger-euid-unavailable");
  return process.getuid();
}

function assertOwnerOnlyDirectoryStat(stat: ReturnType<typeof statSync>): void {
  if (stat.isSymbolicLink()) throw new Error("challenge-ledger-directory-symlink-invalid");
  if (!stat.isDirectory()) throw new Error("challenge-ledger-directory-invalid");
  if (stat.uid !== ownerUid()) throw new Error("challenge-ledger-directory-owner-invalid");
  if ((stat.mode & 0o777) !== 0o700) throw new Error("challenge-ledger-directory-mode-invalid");
}

function assertOwnerOnlyRegularStat(stat: ReturnType<typeof fstatSync>): void {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("challenge-ledger-file-invalid");
  if (stat.uid !== ownerUid()) throw new Error("challenge-ledger-file-owner-invalid");
  if ((stat.mode & 0o777) !== 0o600) throw new Error("challenge-ledger-file-mode-invalid");
  if (stat.nlink !== 1) throw new Error("challenge-ledger-hardlink-invalid");
}

function assertCloseOnExec(fd: number): void {
  const flags = POSIX.descriptorFlags(fd);
  if (flags < 0 || (flags & FD_CLOEXEC) === 0) {
    throw new Error("challenge-ledger-descriptor-cloexec-missing");
  }
}

function assertSupportedFilesystem(fd: number): void {
  const filesystem = POSIX.filesystem(fd);
  const supported = process.platform === "darwin"
    ? filesystem.name === "apfs"
    : ALLOWED_LINUX_FILESYSTEM_TYPES.has(filesystem.type);
  if (!supported) {
    throw new Error(
      `challenge-ledger-filesystem-unsupported:${filesystem.name ?? "type"}:${filesystem.type}`,
    );
  }
}

function durableSync(fd: number): void {
  fsyncSync(fd);
  if (process.platform === "darwin") POSIX.fullFsync(fd);
}

function canonicalAbsolutePath(path: string): string {
  const resolved = resolve(path);
  if (
    path !== resolved ||
    path.includes("\0") ||
    path !== path.normalize("NFC")
  ) {
    throw new Error("challenge-ledger-path-noncanonical");
  }
  return resolved;
}

function ensureTrustedDirectory(path: string, create = false): TrustedDirectory {
  const resolved = canonicalAbsolutePath(path);
  if (create) {
    try {
      lstatSync(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(resolved);
      const parentStat = lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent) {
        throw new Error("challenge-ledger-parent-invalid");
      }
      const parentFd = POSIX.openat(
        AT_FDCWD,
        parent,
        constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
        0,
      );
      if (parentFd < 0) throw new Error("challenge-ledger-parent-open-failed");
      try {
        assertCloseOnExec(parentFd);
        assertSupportedFilesystem(parentFd);
        const openedParent = fstatSync(parentFd);
        if (openedParent.dev !== parentStat.dev || openedParent.ino !== parentStat.ino) {
          throw new Error("challenge-ledger-parent-identity-drift");
        }
        POSIX.mkdirat(parentFd, basename(resolved), 0o700);
        durableSync(parentFd);
      } finally {
        closeSync(parentFd);
      }
    }
  }
  const pathStat = lstatSync(resolved);
  assertOwnerOnlyDirectoryStat(pathStat);
  if (realpathSync(resolved) !== resolved) throw new Error("challenge-ledger-directory-symlink-invalid");
  const fd = POSIX.openat(
    AT_FDCWD,
    resolved,
    constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
    0,
  );
  if (fd < 0) throw new Error("challenge-ledger-directory-open-failed");
  try {
    assertCloseOnExec(fd);
    assertSupportedFilesystem(fd);
    const descriptorStat = fstatSync(fd);
    assertOwnerOnlyDirectoryStat(descriptorStat);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      throw new Error("challenge-ledger-directory-identity-drift");
    }
    return {
      path: resolved,
      fd,
      device: String(descriptorStat.dev),
      inode: String(descriptorStat.ino),
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function closeDirectory(directory: TrustedDirectory): void {
  closeSync(directory.fd);
}

function safeTarget(path: string, createDirectory = false): SafeTarget {
  const resolved = canonicalAbsolutePath(path);
  const name = basename(resolved);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0") ||
    name !== name.normalize("NFC") ||
    Buffer.byteLength(name, "utf8") > 180
  ) {
    throw new Error("challenge-ledger-basename-invalid");
  }
  const directory = ensureTrustedDirectory(dirname(resolved), createDirectory);
  return { path: join(directory.path, name), name, directory };
}

function openRelativeRegular(
  target: SafeTarget,
  flags: number,
  mode = 0o600,
): number {
  const previousUmask = (flags & constants.O_CREAT) !== 0 ? process.umask(0o077) : null;
  let fd: number;
  try {
    fd = POSIX.openat(target.directory.fd, target.name, flags | O_NOFOLLOW | O_CLOEXEC, mode);
  } finally {
    if (previousUmask !== null) process.umask(previousUmask);
  }
  if (fd < 0) throw new Error(`challenge-ledger-openat-failed:${target.name}`);
  try {
    assertCloseOnExec(fd);
    if ((flags & constants.O_CREAT) !== 0) fchmodSync(fd, mode);
    assertOwnerOnlyRegularStat(fstatSync(fd));
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function relativeExists(target: SafeTarget): boolean {
  const fd = POSIX.openat(
    target.directory.fd,
    target.name,
    constants.O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
    0,
  );
  if (fd < 0) {
    try {
      lstatSync(target.path);
      throw new Error("challenge-ledger-relative-target-invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  try {
    assertCloseOnExec(fd);
    assertOwnerOnlyRegularStat(fstatSync(fd));
    return true;
  } finally {
    closeSync(fd);
  }
}

function readRelativeBounded(target: SafeTarget, maxBytes: number): Buffer {
  const fd = openRelativeRegular(target, constants.O_RDONLY);
  try {
    const stat = fstatSync(fd);
    if (stat.size > maxBytes) throw new Error("challenge-ledger-file-oversized");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(directory: TrustedDirectory): void {
  durableSync(directory.fd);
}

function unlinkRelativeIfPresent(target: SafeTarget): void {
  if (!relativeExists(target)) return;
  POSIX.unlinkat(target.directory.fd, target.name);
  fsyncDirectory(target.directory);
}

function writeRelativeExclusive(target: SafeTarget, bytes: Buffer | string): void {
  const fd = openRelativeRegular(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
  );
  try {
    writeFileSync(fd, bytes);
    durableSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDirectory(target.directory);
}

function writeRelativeAtomic(
  target: SafeTarget,
  tempName: string,
  bytes: Buffer | string,
  beforeTempDurable?: () => void,
  onTempDurable?: () => void,
  beforeRename?: () => void,
  onRenamed?: () => void,
): void {
  const temp = safeTarget(join(target.directory.path, tempName));
  try {
    const fd = openRelativeRegular(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    );
    try {
      writeFileSync(fd, bytes);
      beforeTempDurable?.();
      durableSync(fd);
    } finally {
      closeSync(fd);
    }
    onTempDurable?.();
    beforeRename?.();
    POSIX.renameat(target.directory.fd, temp.name, target.name);
    onRenamed?.();
    fsyncDirectory(target.directory);
  } catch (error) {
    try {
      unlinkRelativeIfPresent(temp);
    } catch (cleanupError) {
      const original = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`challenge-ledger-temp-cleanup-failed:${cleanup}:original:${original}`);
    }
    throw error;
  } finally {
    closeDirectory(temp.directory);
  }
}

async function acquireMutationLock(target: SafeTarget, timeoutMs: number): Promise<() => void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("challenge-ledger-lock-timeout-invalid");
  }
  const lock = safeTarget(`${target.path}.lock`);
  let fd = -1;
  try {
    const previousUmask = process.umask(0o077);
    try {
      fd = POSIX.openat(
        lock.directory.fd,
        lock.name,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW | O_CLOEXEC,
        0o600,
      );
    } finally {
      process.umask(previousUmask);
    }
    if (fd >= 0) {
      fchmodSync(fd, 0o600);
    } else {
      fd = POSIX.openat(
        lock.directory.fd,
        lock.name,
        constants.O_RDWR | O_NOFOLLOW | O_CLOEXEC,
        0,
      );
    }
    if (fd < 0) throw new Error("challenge-ledger-lock-open-failed");
    assertCloseOnExec(fd);
    assertOwnerOnlyRegularStat(fstatSync(fd));
    durableSync(fd);
    fsyncDirectory(lock.directory);
    const deadline = Date.now() + timeoutMs;
    while (POSIX.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      if (Date.now() >= deadline) throw new Error("challenge-ledger-lock-timeout");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const unlockResult = POSIX.flock(fd, LOCK_UN);
      closeSync(fd);
      closeDirectory(lock.directory);
      if (unlockResult !== 0) throw new Error("challenge-ledger-unlock-failed");
    };
  } catch (error) {
    if (fd >= 0) closeSync(fd);
    closeDirectory(lock.directory);
    throw error;
  }
}

function parseEntry(value: unknown): ChallengeEntry {
  if (!record(value) || !exactKeys(value, [
    "challenge",
    "consumedAt",
    "expiresAt",
    "issuedAt",
    "keyId",
    "retainUntil",
    "revokedAt",
    "status",
  ])) {
    throw new Error("challenge-ledger-entry-shape-invalid");
  }
  if (!validKeyId(value.keyId) || !validChallenge(value.challenge)) {
    throw new Error("challenge-ledger-entry-identity-invalid");
  }
  if (
    value.status !== "issued" &&
    value.status !== "consumed" &&
    value.status !== "revoked"
  ) {
    throw new Error("challenge-ledger-entry-status-invalid");
  }
  if (
    !canonicalTimestamp(value.issuedAt) ||
    !canonicalTimestamp(value.expiresAt) ||
    !canonicalTimestamp(value.retainUntil)
  ) {
    throw new Error("challenge-ledger-entry-time-invalid");
  }
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const retainUntil = Date.parse(value.retainUntil);
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > SIGNED_PROBE_MAX_LIFETIME_MS ||
    retainUntil < expiresAt + SIGNED_PROBE_MAX_CLOCK_SKEW_MS + SIGNED_PROBE_CHALLENGE_RECOVERY_MARGIN_MS ||
    retainUntil - expiresAt > SIGNED_PROBE_CHALLENGE_MAX_RETENTION_MS
  ) {
    throw new Error("challenge-ledger-entry-window-invalid");
  }
  const consumedAt = value.consumedAt;
  const revokedAt = value.revokedAt;
  if (value.status === "issued" && (consumedAt !== null || revokedAt !== null)) {
    throw new Error("challenge-ledger-issued-terminal-time-invalid");
  }
  if (
    value.status === "consumed" &&
    (!canonicalTimestamp(consumedAt) || revokedAt !== null || Date.parse(consumedAt) < issuedAt || Date.parse(consumedAt) >= expiresAt)
  ) {
    throw new Error("challenge-ledger-consumed-time-invalid");
  }
  if (
    value.status === "revoked" &&
    (!canonicalTimestamp(revokedAt) || consumedAt !== null || Date.parse(revokedAt) < issuedAt)
  ) {
    throw new Error("challenge-ledger-revoked-time-invalid");
  }
  return value as unknown as ChallengeEntry;
}

export function parseChallengeLedger(value: unknown): ChallengeLedger {
  if (!record(value) || !exactKeys(value, [
    "entries",
    "generation",
    "kind",
    "lastOperationId",
    "schemaVersion",
    "updatedAt",
  ])) {
    throw new Error("challenge-ledger-shape-invalid");
  }
  if (
    value.schemaVersion !== SIGNED_PROBE_CHALLENGE_LEDGER_SCHEMA_VERSION ||
    value.kind !== SIGNED_PROBE_CHALLENGE_LEDGER_KIND ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.lastOperationId !== "string" ||
    !/^[A-Za-z0-9._-]{1,160}$/.test(value.lastOperationId) ||
    !canonicalTimestamp(value.updatedAt) ||
    !Array.isArray(value.entries) ||
    value.entries.length > SIGNED_PROBE_CHALLENGE_MAX_ENTRIES
  ) {
    throw new Error("challenge-ledger-metadata-invalid");
  }
  const entries = value.entries.map(parseEntry);
  const keys = entries.map((entry) => `${entry.keyId}:${entry.challenge}`);
  if (new Set(keys).size !== keys.length) throw new Error("challenge-ledger-entry-duplicate");
  const ordered = [...entries].sort(compareEntries);
  if (ordered.some((entry, index) => entry !== entries[index])) {
    throw new Error("challenge-ledger-entry-order-invalid");
  }
  return value as unknown as ChallengeLedger;
}

function parseCanonical<T>(raw: Buffer, parser: (value: unknown) => T): T {
  if (raw.byteLength > SIGNED_PROBE_MAX_CANONICAL_BYTES) {
    throw new Error("challenge-ledger-json-oversized");
  }
  const text = raw.toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (canonicalProbeJson(parsed) !== text) throw new Error("challenge-ledger-json-not-canonical");
  return parser(parsed);
}

function initialLedger(): ChallengeLedger {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_CHALLENGE_LEDGER_KIND,
    generation: 0,
    lastOperationId: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
    entries: [],
  };
}

function readLedger(target: SafeTarget): LedgerSnapshot {
  const fd = POSIX.openat(
    target.directory.fd,
    target.name,
    constants.O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
    0,
  );
  if (fd < 0) {
    try {
      lstatSync(target.path);
      throw new Error("challenge-ledger-open-failed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { exists: false, raw: null, hash: "absent", state: initialLedger() };
    }
  }
  try {
    assertCloseOnExec(fd);
    const stat = fstatSync(fd);
    assertOwnerOnlyRegularStat(stat);
    if (stat.size > SIGNED_PROBE_MAX_CANONICAL_BYTES) throw new Error("challenge-ledger-file-oversized");
    const raw = readFileSync(fd);
    return { exists: true, raw, hash: hashBytes(raw), state: parseCanonical(raw, parseChallengeLedger) };
  } finally {
    closeSync(fd);
  }
}

function compareEntries(left: ChallengeEntry, right: ChallengeEntry): number {
  const leftKey = `${left.keyId}:${left.challenge}`;
  const rightKey = `${right.keyId}:${right.challenge}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function pruneEntries(entries: ChallengeEntry[], nowMs: number): ChallengeEntry[] {
  return entries.filter((entry) => Date.parse(entry.retainUntil) > nowMs);
}

function stateReference(snapshot: LedgerSnapshot): StateReference {
  return {
    exists: snapshot.exists,
    generation: snapshot.state.generation,
    hash: snapshot.hash,
    lastOperationId: snapshot.state.lastOperationId,
  };
}

function nextState(
  previous: ChallengeLedger,
  operationId: string,
  nowMs: number,
  entries: ChallengeEntry[],
): ChallengeLedger {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_CHALLENGE_LEDGER_KIND,
    generation: previous.generation + 1,
    lastOperationId: operationId,
    updatedAt: timestamp(nowMs),
    entries: [...entries].sort(compareEntries),
  };
}

function operationId(nowMs: number): string {
  return `${new Date(nowMs).toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}-${randomBytes(12).toString("hex")}`;
}

function entryFor(state: ChallengeLedger, keyId: string, challenge: string): ChallengeEntry | undefined {
  return state.entries.find((entry) => entry.keyId === keyId && entry.challenge === challenge);
}

function receiptParser(value: unknown): ChallengeOperationReceipt {
  if (!record(value) || !exactKeys(value, [
    "authorizing",
    "backupHash",
    "backupPath",
    "challenge",
    "completedAt",
    "createdAt",
    "keyId",
    "kind",
    "ledgerDirectoryDevice",
    "ledgerDirectoryInode",
    "ledgerPath",
    "ledgerTempName",
    "operation",
    "operationId",
    "post",
    "pre",
    "schemaVersion",
    "sourceReceiptHash",
    "sourceReceiptPath",
    "status",
  ])) {
    throw new Error("challenge-operation-receipt-shape-invalid");
  }
  if (
    value.schemaVersion !== 1 ||
    value.kind !== SIGNED_PROBE_CHALLENGE_OPERATION_KIND ||
    value.authorizing !== false ||
    !["issue", "consume", "revoke-issuance"].includes(String(value.operation)) ||
    !["prepared", "applied", "aborted"].includes(String(value.status)) ||
    typeof value.operationId !== "string" ||
    !/^[A-Za-z0-9._-]{1,160}$/.test(value.operationId) ||
    !validKeyId(value.keyId) ||
    !validChallenge(value.challenge) ||
    !canonicalTimestamp(value.createdAt) ||
    (value.completedAt !== null && !canonicalTimestamp(value.completedAt)) ||
    typeof value.ledgerPath !== "string" ||
    resolve(value.ledgerPath) !== value.ledgerPath ||
    typeof value.ledgerDirectoryDevice !== "string" ||
    typeof value.ledgerDirectoryInode !== "string" ||
    typeof value.ledgerTempName !== "string" ||
    basename(value.ledgerTempName) !== value.ledgerTempName ||
    (value.backupPath !== null && (typeof value.backupPath !== "string" || resolve(value.backupPath) !== value.backupPath)) ||
    (value.backupHash !== null && !validHash(value.backupHash)) ||
    (value.sourceReceiptPath !== null && (typeof value.sourceReceiptPath !== "string" || resolve(value.sourceReceiptPath) !== value.sourceReceiptPath)) ||
    (value.sourceReceiptHash !== null && !validHash(value.sourceReceiptHash))
  ) {
    throw new Error("challenge-operation-receipt-metadata-invalid");
  }
  for (const [label, reference] of [["pre", value.pre], ["post", value.post]] as const) {
    if (!record(reference) || !exactKeys(reference, ["exists", "generation", "hash", "lastOperationId"])) {
      throw new Error(`challenge-operation-receipt-${label}-invalid`);
    }
    if (
      typeof reference.exists !== "boolean" ||
      !Number.isSafeInteger(reference.generation) ||
      Number(reference.generation) < 0 ||
      !validHash(reference.hash, true) ||
      (reference.lastOperationId !== null && typeof reference.lastOperationId !== "string")
    ) {
      throw new Error(`challenge-operation-receipt-${label}-invalid`);
    }
  }
  const pre = value.pre as Record<string, unknown>;
  const post = value.post as Record<string, unknown>;
  if (
    (pre.exists === false && (pre.generation !== 0 || pre.hash !== "absent" || pre.lastOperationId !== null)) ||
    (pre.exists === true && (pre.generation === 0 || pre.hash === "absent" || typeof pre.lastOperationId !== "string")) ||
    post.exists !== true ||
    post.generation !== Number(pre.generation) + 1 ||
    post.lastOperationId !== value.operationId ||
    post.hash === "absent" ||
    (pre.exists === true && (value.backupPath === null || value.backupHash !== pre.hash)) ||
    (pre.exists === false && (value.backupPath !== null || value.backupHash !== null)) ||
    (value.status === "prepared" && value.completedAt !== null) ||
    (value.status !== "prepared" && value.completedAt === null) ||
    (value.operation === "revoke-issuance" && (value.sourceReceiptPath === null || value.sourceReceiptHash === null)) ||
    (value.operation !== "revoke-issuance" && (value.sourceReceiptPath !== null || value.sourceReceiptHash !== null))
  ) {
    throw new Error("challenge-operation-receipt-invariant-invalid");
  }
  return value as unknown as ChallengeOperationReceipt;
}

function loadReceipt(path: string): {
  target: SafeTarget;
  raw: Buffer;
  receipt: ChallengeOperationReceipt;
} {
  const target = safeTarget(path);
  try {
    const raw = readRelativeBounded(target, SIGNED_PROBE_MAX_CANONICAL_BYTES);
    return { target, raw, receipt: parseCanonical(raw, receiptParser) };
  } catch (error) {
    closeDirectory(target.directory);
    throw error;
  }
}

function writeReceipt(target: SafeTarget, receipt: ChallengeOperationReceipt): void {
  const bytes = canonicalProbeJson(receipt);
  writeRelativeAtomic(
    target,
    `.${target.name}.tmp.${randomBytes(8).toString("hex")}`,
    bytes,
  );
}

function receiptPath(directory: TrustedDirectory, id: string): string {
  return join(directory.path, `challenge-${id}.json`);
}

function sameReference(snapshot: LedgerSnapshot, reference: StateReference): boolean {
  return snapshot.exists === reference.exists &&
    snapshot.state.generation === reference.generation &&
    snapshot.hash === reference.hash &&
    snapshot.state.lastOperationId === reference.lastOperationId;
}

function assertDirectoryIdentity(
  directory: TrustedDirectory,
  device: string,
  inode: string,
): void {
  if (directory.device !== device || directory.inode !== inode) {
    throw new Error("challenge-ledger-directory-replaced");
  }
  const current = lstatSync(directory.path);
  if (String(current.dev) !== device || String(current.ino) !== inode || realpathSync(directory.path) !== directory.path) {
    throw new Error("challenge-ledger-directory-path-drift");
  }
}

function makeResult(
  operation: ChallengeOperation,
  entry: ChallengeEntry,
  state: ChallengeLedger,
  id: string,
  path: string,
): ChallengeMutationResult {
  return {
    schemaVersion: 1,
    kind: "temperance.signed-probe-challenge-result",
    operation,
    status: operation === "issue" ? "issued" : operation === "consume" ? "consumed" : "revoked",
    keyId: entry.keyId,
    challenge: entry.challenge,
    issuedAt: entry.issuedAt,
    expiresAt: entry.expiresAt,
    retainUntil: entry.retainUntil,
    generation: state.generation,
    operationId: id,
    receiptPath: path,
    authorizing: false,
  };
}

async function commitTransition(
  ledgerTarget: SafeTarget,
  receiptDirectory: TrustedDirectory,
  pre: LedgerSnapshot,
  postState: ChallengeLedger,
  operation: ChallengeOperation,
  entry: ChallengeEntry,
  id: string,
  nowMs: number,
  sourceReceiptPath: string | null,
  sourceReceiptHash: string | null,
  faultInjector?: (point: ChallengeFaultPoint) => void,
): Promise<ChallengeMutationResult> {
  const postBytes = Buffer.from(canonicalProbeJson(postState), "utf8");
  if (postBytes.byteLength > SIGNED_PROBE_MAX_CANONICAL_BYTES) {
    throw new Error("challenge-ledger-capacity-bytes-exhausted");
  }
  const path = receiptPath(receiptDirectory, id);
  const receiptTarget = safeTarget(path);
  const backupPath = pre.exists ? join(receiptDirectory.path, `challenge-${id}.pre.json`) : null;
  const backupTarget = backupPath ? safeTarget(backupPath) : null;
  const ledgerTempName = `.${ledgerTarget.name}.tmp.${id}`;
  const post: StateReference = {
    exists: true,
    generation: postState.generation,
    hash: hashBytes(postBytes),
    lastOperationId: postState.lastOperationId,
  };
  const receipt: ChallengeOperationReceipt = {
    schemaVersion: 1,
    kind: SIGNED_PROBE_CHALLENGE_OPERATION_KIND,
    status: "prepared",
    operation,
    operationId: id,
    authorizing: false,
    ledgerPath: ledgerTarget.path,
    ledgerDirectoryDevice: ledgerTarget.directory.device,
    ledgerDirectoryInode: ledgerTarget.directory.inode,
    keyId: entry.keyId,
    challenge: entry.challenge,
    createdAt: timestamp(nowMs),
    completedAt: null,
    pre: stateReference(pre),
    post,
    backupPath,
    backupHash: pre.raw ? hashBytes(pre.raw) : null,
    ledgerTempName,
    sourceReceiptPath,
    sourceReceiptHash,
  };
  try {
    if (backupTarget && pre.raw) {
      writeRelativeExclusive(backupTarget, pre.raw);
      if (hashBytes(readRelativeBounded(backupTarget, SIGNED_PROBE_MAX_CANONICAL_BYTES)) !== receipt.backupHash) {
        throw new Error("challenge-ledger-backup-readback-mismatch");
      }
      faultInjector?.("after-backup-fsync");
    }
    writeRelativeExclusive(receiptTarget, canonicalProbeJson(receipt));
    faultInjector?.("after-prepared-receipt-fsync");

    const current = readLedger(ledgerTarget);
    if (!sameReference(current, receipt.pre)) throw new Error("challenge-ledger-precommit-drift");
    writeRelativeAtomic(
      ledgerTarget,
      ledgerTempName,
      postBytes,
      () => faultInjector?.("before-ledger-temp-fsync"),
      () => faultInjector?.("after-ledger-temp-fsync"),
      () => {
        const beforeRename = readLedger(ledgerTarget);
        if (!sameReference(beforeRename, receipt.pre)) {
          throw new Error("challenge-ledger-prerename-drift");
        }
      },
      () => faultInjector?.("after-ledger-rename"),
    );
    faultInjector?.("after-ledger-directory-fsync");
    assertDirectoryIdentity(
      ledgerTarget.directory,
      receipt.ledgerDirectoryDevice,
      receipt.ledgerDirectoryInode,
    );
    receipt.status = "applied";
    receipt.completedAt = timestamp(Date.now());
    writeReceipt(receiptTarget, receipt);
    faultInjector?.("after-committed-receipt-fsync");
    return makeResult(operation, entry, postState, id, path);
  } finally {
    closeDirectory(receiptTarget.directory);
    if (backupTarget) closeDirectory(backupTarget.directory);
  }
}

export async function issueProbeChallenge(options: IssueChallengeOptions): Promise<ChallengeMutationResult> {
  if (!validKeyId(options.keyId)) throw new Error("challenge-ledger-key-id-invalid");
  const nowMs = options.nowMs ?? Date.now();
  timestamp(nowMs);
  const lifetimeMs = options.lifetimeMs ?? SIGNED_PROBE_MAX_LIFETIME_MS;
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > SIGNED_PROBE_MAX_LIFETIME_MS) {
    throw new Error("challenge-ledger-lifetime-invalid");
  }
  const retentionMs = options.retentionAfterExpiryMs ?? SIGNED_PROBE_CHALLENGE_DEFAULT_RETENTION_MS;
  const minimumRetention = SIGNED_PROBE_MAX_CLOCK_SKEW_MS + SIGNED_PROBE_CHALLENGE_RECOVERY_MARGIN_MS;
  if (
    !Number.isSafeInteger(retentionMs) ||
    retentionMs < minimumRetention ||
    retentionMs > SIGNED_PROBE_CHALLENGE_MAX_RETENTION_MS
  ) {
    throw new Error("challenge-ledger-retention-invalid");
  }
  const ledgerTarget = safeTarget(options.ledgerPath);
  const receiptDirectory = ensureTrustedDirectory(options.receiptDirectory, true);
  const release = await acquireMutationLock(
    ledgerTarget,
    options.lockTimeoutMs ?? SIGNED_PROBE_CHALLENGE_DEFAULT_LOCK_TIMEOUT_MS,
  );
  try {
    const pre = readLedger(ledgerTarget);
    const entries = pruneEntries(pre.state.entries, nowMs);
    if (entries.length >= SIGNED_PROBE_CHALLENGE_MAX_ENTRIES) {
      throw new Error("challenge-ledger-capacity-entries-exhausted");
    }
    let challenge = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = generateProbeChallenge();
      if (!entries.some((entry) => entry.challenge === candidate)) {
        challenge = candidate;
        break;
      }
    }
    if (!challenge) throw new Error("challenge-ledger-random-collision-limit");
    const id = operationId(nowMs);
    const entry: ChallengeEntry = {
      keyId: options.keyId,
      challenge,
      status: "issued",
      issuedAt: timestamp(nowMs),
      expiresAt: timestamp(nowMs + lifetimeMs),
      retainUntil: timestamp(nowMs + lifetimeMs + retentionMs),
      consumedAt: null,
      revokedAt: null,
    };
    const post = nextState(pre.state, id, nowMs, [...entries, entry]);
    return await commitTransition(
      ledgerTarget,
      receiptDirectory,
      pre,
      post,
      "issue",
      entry,
      id,
      nowMs,
      null,
      null,
      options.faultInjector,
    );
  } finally {
    release();
    closeDirectory(receiptDirectory);
    closeDirectory(ledgerTarget.directory);
  }
}

export async function consumeProbeChallenge(options: ConsumeChallengeOptions): Promise<ChallengeMutationResult> {
  if (!validKeyId(options.keyId) || !validChallenge(options.challenge)) {
    throw new Error("challenge-ledger-consume-identity-invalid");
  }
  const nowMs = options.nowMs ?? Date.now();
  timestamp(nowMs);
  const ledgerTarget = safeTarget(options.ledgerPath);
  const receiptDirectory = ensureTrustedDirectory(options.receiptDirectory, true);
  const release = await acquireMutationLock(
    ledgerTarget,
    options.lockTimeoutMs ?? SIGNED_PROBE_CHALLENGE_DEFAULT_LOCK_TIMEOUT_MS,
  );
  try {
    const pre = readLedger(ledgerTarget);
    const existing = entryFor(pre.state, options.keyId, options.challenge);
    if (!existing) throw new Error("challenge-ledger-challenge-missing");
    if (existing.status === "consumed") throw new Error("challenge-ledger-challenge-consumed");
    if (existing.status === "revoked") throw new Error("challenge-ledger-challenge-revoked");
    if (nowMs < Date.parse(existing.issuedAt)) throw new Error("challenge-ledger-challenge-not-yet-active");
    if (nowMs >= Date.parse(existing.expiresAt)) throw new Error("challenge-ledger-challenge-expired");
    const id = operationId(nowMs);
    const entry: ChallengeEntry = {
      ...existing,
      status: "consumed",
      consumedAt: timestamp(nowMs),
    };
    const entries = pre.state.entries.map((candidate) =>
      candidate.keyId === entry.keyId && candidate.challenge === entry.challenge ? entry : candidate
    );
    const post = nextState(pre.state, id, nowMs, entries);
    return await commitTransition(
      ledgerTarget,
      receiptDirectory,
      pre,
      post,
      "consume",
      entry,
      id,
      nowMs,
      null,
      null,
      options.faultInjector,
    );
  } finally {
    release();
    closeDirectory(receiptDirectory);
    closeDirectory(ledgerTarget.directory);
  }
}

export async function rollbackIssuedChallenge(options: RollbackChallengeOptions): Promise<ChallengeMutationResult> {
  const loaded = loadReceipt(options.operationReceiptPath);
  try {
    const source = loaded.receipt;
    if (source.status !== "applied" || source.operation !== "issue") {
      throw new Error("challenge-ledger-rollback-source-not-applied-issue");
    }
    const sourceHash = hashBytes(loaded.raw);
    const ledgerTarget = safeTarget(source.ledgerPath);
    const receiptDirectory = ensureTrustedDirectory(options.receiptDirectory, true);
    const release = await acquireMutationLock(
      ledgerTarget,
      options.lockTimeoutMs ?? SIGNED_PROBE_CHALLENGE_DEFAULT_LOCK_TIMEOUT_MS,
    );
    try {
      assertDirectoryIdentity(
        ledgerTarget.directory,
        source.ledgerDirectoryDevice,
        source.ledgerDirectoryInode,
      );
      const nowMs = options.nowMs ?? Date.now();
      timestamp(nowMs);
      const pre = readLedger(ledgerTarget);
      if (!sameReference(pre, source.post)) throw new Error("challenge-ledger-rollback-drift");
      const existing = entryFor(pre.state, source.keyId, source.challenge);
      if (!existing || existing.status !== "issued") {
        throw new Error("challenge-ledger-rollback-would-reopen-terminal-state");
      }
      const id = operationId(nowMs);
      const entry: ChallengeEntry = {
        ...existing,
        status: "revoked",
        revokedAt: timestamp(nowMs),
      };
      const entries = pre.state.entries.map((candidate) =>
        candidate.keyId === entry.keyId && candidate.challenge === entry.challenge ? entry : candidate
      );
      const post = nextState(pre.state, id, nowMs, entries);
      return await commitTransition(
        ledgerTarget,
        receiptDirectory,
        pre,
        post,
        "revoke-issuance",
        entry,
        id,
        nowMs,
        loaded.target.path,
        sourceHash,
        options.faultInjector,
      );
    } finally {
      release();
      closeDirectory(receiptDirectory);
      closeDirectory(ledgerTarget.directory);
    }
  } finally {
    closeDirectory(loaded.target.directory);
  }
}

export async function recoverChallengeOperation(options: RecoverChallengeOptions): Promise<ChallengeRecoveryResult> {
  const loaded = loadReceipt(options.operationReceiptPath);
  try {
    let receipt = loaded.receipt;
    if (receipt.status !== "prepared") {
      return {
        schemaVersion: 1,
        kind: "temperance.signed-probe-challenge-recovery",
        operationId: receipt.operationId,
        status: receipt.status,
        receiptPath: loaded.target.path,
        authorizing: false,
      };
    }
    const ledgerTarget = safeTarget(receipt.ledgerPath);
    const release = await acquireMutationLock(
      ledgerTarget,
      options.lockTimeoutMs ?? SIGNED_PROBE_CHALLENGE_DEFAULT_LOCK_TIMEOUT_MS,
    );
    try {
      const currentReceiptRaw = readRelativeBounded(
        loaded.target,
        SIGNED_PROBE_MAX_CANONICAL_BYTES,
      );
      const currentReceipt = parseCanonical(currentReceiptRaw, receiptParser);
      if (currentReceipt.operationId !== receipt.operationId) {
        throw new Error("challenge-ledger-recovery-receipt-replaced");
      }
      receipt = currentReceipt;
      if (receipt.status !== "prepared") {
        return {
          schemaVersion: 1,
          kind: "temperance.signed-probe-challenge-recovery",
          operationId: receipt.operationId,
          status: receipt.status,
          receiptPath: loaded.target.path,
          authorizing: false,
        };
      }
      assertDirectoryIdentity(
        ledgerTarget.directory,
        receipt.ledgerDirectoryDevice,
        receipt.ledgerDirectoryInode,
      );
      const current = readLedger(ledgerTarget);
      if (sameReference(current, receipt.post)) {
        fsyncDirectory(ledgerTarget.directory);
        receipt.status = "applied";
      } else if (sameReference(current, receipt.pre)) {
        receipt.status = "aborted";
      } else {
        throw new Error("challenge-ledger-recovery-drift");
      }
      const tempTarget = safeTarget(join(ledgerTarget.directory.path, receipt.ledgerTempName));
      try {
        unlinkRelativeIfPresent(tempTarget);
      } finally {
        closeDirectory(tempTarget.directory);
      }
      receipt.completedAt = timestamp(Date.now());
      writeReceipt(loaded.target, receipt);
      return {
        schemaVersion: 1,
        kind: "temperance.signed-probe-challenge-recovery",
        operationId: receipt.operationId,
        status: receipt.status,
        receiptPath: loaded.target.path,
        authorizing: false,
      };
    } finally {
      release();
      closeDirectory(ledgerTarget.directory);
    }
  } finally {
    closeDirectory(loaded.target.directory);
  }
}

export function readChallengeLedgerStatus(ledgerPath: string): {
  schemaVersion: 1;
  kind: "temperance.signed-probe-challenge-status";
  exists: boolean;
  generation: number;
  issued: number;
  consumed: number;
  revoked: number;
  entries: number;
  authorizing: false;
} {
  const target = safeTarget(ledgerPath);
  try {
    const snapshot = readLedger(target);
    return {
      schemaVersion: 1,
      kind: "temperance.signed-probe-challenge-status",
      exists: snapshot.exists,
      generation: snapshot.state.generation,
      issued: snapshot.state.entries.filter((entry) => entry.status === "issued").length,
      consumed: snapshot.state.entries.filter((entry) => entry.status === "consumed").length,
      revoked: snapshot.state.entries.filter((entry) => entry.status === "revoked").length,
      entries: snapshot.state.entries.length,
      authorizing: false,
    };
  } finally {
    closeDirectory(target.directory);
  }
}
