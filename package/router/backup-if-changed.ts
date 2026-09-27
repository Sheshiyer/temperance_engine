#!/usr/bin/env bun
/** Adjacent text/config recovery copies. SQLite databases require SQLite .backup. */
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, fchmodSync, futimesSync, lstatSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface BackupResult { action: "skipped unchanged" | "dry-run would create" | "created"; path: string }
const TAG = /^[A-Za-z0-9._-]+$/;
function regular(path: string): void {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new Error(`refusing symlink source or backup: ${path}`);
  if (!st.isFile()) throw new Error(`source or backup is not a regular file: ${path}`);
}
function readRegular(path: string): { bytes: Buffer; mode: number; atime: Date; mtime: Date } {
  regular(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`source is not a regular file: ${path}`);
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("source changed while reading");
    return { bytes, mode: before.mode & 0o7777, atime: before.atime, mtime: before.mtime };
  } finally { closeSync(fd); }
}
export function createBackup(source: string, tag: string, apply = false, now = new Date()): BackupResult {
  if (!TAG.test(tag)) throw new Error("--tag must contain only letters, digits, dot, underscore, or hyphen");
  const content = readRegular(source);
  if (content.bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0")) || /(?:-wal|-shm)$/i.test(source)) throw new Error("refusing SQLite/WAL recovery copy; use SQLite .backup");
  const prefix = `${basename(source)}.bak.${tag}-`;
  const newest = readdirSync(dirname(source)).filter((name) => name.startsWith(prefix)).sort().at(-1);
  if (newest) { const path = join(dirname(source), newest); if (readRegular(path).bytes.equals(content.bytes)) return { action: "skipped unchanged", path }; }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, ".$1000Z");
  const destination = join(dirname(source), `${prefix}${stamp}`);
  if (!apply) return { action: "dry-run would create", path: destination };
  let fd: number | undefined; let created = false;
  try {
    // Only unlink files this invocation created: EEXIST must preserve prior recovery data.
    fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
    writeFileSync(fd, content.bytes); fchmodSync(fd, content.mode); futimesSync(fd, content.atime, content.mtime); fsyncSync(fd);
    closeSync(fd); fd = undefined;
  } catch (error) { if (fd !== undefined) closeSync(fd); if (created) unlinkSync(destination); throw error; }
  return { action: "created", path: destination };
}
export function backupMain(args: string[], out: (value: string) => void = (value) => { process.stdout.write(value); }, err: (value: string) => void = (value) => { process.stderr.write(value); }): number {
  const usage = "usage: te-backup-if-changed SOURCE --tag TAG [--apply]\n";
  if (args.includes("--help") || args.includes("-h")) { out(usage); return 0; }
  let source: string | undefined, tag: string | undefined, apply = false;
  for (let i = 0; i < args.length; i++) { const arg = args[i]!; if (arg === "--apply") apply = true; else if (arg === "--tag") tag = args[++i]; else if (arg.startsWith("--tag=")) tag = arg.slice(6); else if (!arg.startsWith("-") && !source) source = arg; else { err(usage); return 2; } }
  if (!source || !tag || !TAG.test(tag)) { err(`${usage}--tag must contain only letters, digits, dot, underscore, or hyphen\n`); return 2; }
  try { const result = createBackup(source, tag, apply); out(`te-backup-if-changed: ${result.action}: ${result.path}\n`); return 0; }
  catch (error) { err(`te-backup-if-changed: ${error instanceof Error ? error.message : "backup failed"}\n`); return 1; }
}
if (import.meta.main) process.exitCode = backupMain(process.argv.slice(2));
