#!/usr/bin/env node
// Source-owned repository generator. No installed/runtime tree is a destination.
import { closeSync, constants, fchmodSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "package/contracts/routing-observation-receipt.v1.ts";
export const TARGETS = Object.freeze([
  "package/router/contracts/routing-observation-receipt.v1.ts",
  "package/manifest-bridge/src/contracts/routing-observation-receipt.v1.ts",
]);
export const OWNERSHIP_NOTICE = "// Canonical product source. Generated RO-02 repository copies must remain byte-for-byte identical;\n"
  + "// edit package/contracts/routing-observation-receipt.v1.ts, then run scripts/sync-routing-observation-contract.mjs --write.\n";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = 0o644;
class SyncError extends Error {
  constructor(code, path = ".") { super(code); this.code = code; this.path = path; }
}
function fail(code, path) { throw new SyncError(code, path); }
function maybeStat(path) {
  try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
const identity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const version = (a, b) => identity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.nlink === b.nlink;

/** Conservative lexical gate, not a general TypeScript parser or code sandbox.
 * Only the two reviewed static built-in declarations are accepted. Comments and
 * strings cannot forge declarations; computed templates/escaped identifiers are
 * rejected rather than guessed. New dependencies require review of this owner.
 */
function checkImports(text) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    const start = i;
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith("//", i)) {
      i += 2;
      while (i < text.length && !/[\r\n\u2028\u2029]/.test(text[i])) i++;
      continue;
    }
    if (text.startsWith("/*", i)) { const end = text.indexOf("*/", i + 2); if (end < 0) fail("SOURCE_IMPORTS", SOURCE); i = end + 2; continue; }
    if (text[i] === "/" && [undefined, "=", "(", "[", ",", ":", "!", "?", "return", "&", "|"].includes(tokens.at(-1)?.value)) {
      i++; let inClass = false; let closed = false;
      while (i < text.length) {
        const c = text[i++];
        if (c === "\\") { i++; continue; }
        if (c === "[") inClass = true;
        if (c === "]") inClass = false;
        if (c === "/" && !inClass) { closed = true; break; }
        if (/[\r\n\u2028\u2029]/.test(c)) break;
      }
      if (!closed) fail("SOURCE_IMPORTS", SOURCE);
      while (i < text.length && /[a-z]/i.test(text[i])) i++;
      tokens.push({ value: "REGEX", start, end: i }); continue;
    }
    if (text[i] === "\\" || text[i] === "`") fail("SOURCE_IMPORTS", SOURCE);
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i++]; let closed = false;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i++] === quote) { closed = true; break; }
      }
      if (!closed) fail("SOURCE_IMPORTS", SOURCE);
      tokens.push({ value: "STRING", start, end: i }); continue;
    }
    if (/[A-Za-z_$]/.test(text[i])) {
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++;
    } else { i++; }
    tokens.push({ value: text.slice(start, i), start, end: i });
  }
  const allowed = new Set(['import { createHash } from "node:crypto";', 'import { types } from "node:util";']);
  const seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value === "require" || token.value === "from") fail("SOURCE_IMPORTS", SOURCE);
    if (token.value !== "import") continue;
    const end = tokens.findIndex((item, n) => n >= i && item.value === ";");
    const declaration = end < 0 ? "" : text.slice(token.start, tokens[end].end);
    if (!allowed.has(declaration) || seen.has(declaration)) fail("SOURCE_IMPORTS", SOURCE);
    seen.add(declaration); i = end;
  }
  if (seen.size !== allowed.size) fail("SOURCE_IMPORTS", SOURCE);
}

/** Injected root and deterministic failure seam are for synthetic tests only.
 * The CLI exposes neither. Caught failures get guarded rollback; two renames
 * cannot be crash-atomic. A crash may leave detectable drift/stage files.
 * This is a trusted-checkout operation, not a defense against an attacker
 * concurrently replacing ancestor directories between OS path operations.
 */
export function syncRoutingObservationContract({ root = ROOT, mode = "check", testOnlyFailPublication } = {}) {
  const stages = new Map(); const createdDirs = []; const published = [];
  let currentPath = "."; let rollback;
  try {
    if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root) fail("INVALID_ROOT");
    if (!["check", "write"].includes(mode) || (testOnlyFailPublication !== undefined && (mode !== "write" || testOnlyFailPublication !== 2))) fail("INVALID_ARGUMENTS");
    const dirs = new Map();
    function absolute(rel) {
      const result = resolve(root, rel); const back = relative(root, result);
      if (back === ".." || back.startsWith(".." + sep) || isAbsolute(back)) fail("UNSAFE_PATH", rel);
      return result;
    }
    function directory(rel, allowMissing = false) {
      const s = maybeStat(absolute(rel));
      if (!s && allowMissing) return false;
      if (!s) fail("PARENT_MISSING", rel);
      if (!s.isDirectory() || s.isSymbolicLink() || (dirs.has(rel) && !identity(dirs.get(rel), s))) fail("UNSAFE_PATH", rel);
      dirs.set(rel, s); return true;
    }
    function ancestors(rel, allowContracts = false) {
      directory(".");
      const parts = dirname(rel).split("/");
      for (let i = 1; i <= parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        if (!directory(parent, allowContracts && i === parts.length && parts[i - 1] === "contracts")) return false;
      }
      return true;
    }
    function read(rel, allowMissing = false) {
      currentPath = rel;
      if (!ancestors(rel, allowMissing)) return null;
      const path = absolute(rel); const before = maybeStat(path);
      if (!before) return null;
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail("UNSAFE_PATH", rel);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = fstatSync(fd);
        if (!version(before, opened)) fail("PATH_DRIFT", rel);
        const bytes = readFileSync(fd); const after = fstatSync(fd);
        if (!version(opened, after) || !version(after, lstatSync(path))) fail("PATH_DRIFT", rel);
        return { stat: after, bytes };
      } finally { closeSync(fd); }
    }
    const source = read(SOURCE);
    if (!source) fail("SOURCE_MISSING", SOURCE);
    if ((source.stat.mode & 0o7777) !== MODE) fail("SOURCE_MODE", SOURCE);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source.bytes); }
    catch { fail("SOURCE_ENCODING", SOURCE); }
    if (!text.startsWith(OWNERSHIP_NOTICE)) fail("SOURCE_NOTICE", SOURCE);
    checkImports(text);
    // Complete both target preflights before any directory/stage mutation.
    const targets = TARGETS.map(rel => ({ rel, before: read(rel, true) }));
    const changed = targets.filter(t => !t.before || !t.before.bytes.equals(source.bytes) || (t.before.stat.mode & 0o7777) !== MODE);
    if (mode === "check") {
      for (const t of targets) {
        if (!t.before) fail("TARGET_MISSING", t.rel);
        if ((t.before.stat.mode & 0o7777) !== MODE) fail("TARGET_MODE", t.rel);
        if (!t.before.bytes.equals(source.bytes)) fail("TARGET_DRIFT", t.rel);
      }
      return { ok: true, changed: [] };
    }
    function assertSnapshot(rel, expected) {
      const actual = read(rel, true);
      if (expected ? !actual || !version(expected.stat, actual.stat) || !expected.bytes.equals(actual.bytes) : actual !== null) fail("PATH_DRIFT", rel);
    }
    function staged(rel, bytes, fileMode) {
      ancestors(rel);
      const name = dirname(rel) + "/.ro02-" + randomUUID() + ".tmp";
      const fd = openSync(absolute(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      stages.set(name, { stat: fstatSync(fd) });
      try {
        writeFileSync(fd, bytes); fchmodSync(fd, fileMode); fsyncSync(fd);
        stages.set(name, { stat: fstatSync(fd), bytes });
      } finally { closeSync(fd); }
      const receipt = read(name);
      if (!receipt || !identity(receipt.stat, stages.get(name).stat) || !receipt.bytes.equals(bytes) || (receipt.stat.mode & 0o7777) !== fileMode) fail("STAGE_INVALID", rel);
      stages.set(name, receipt); return name;
    }
    function publish(name, target) {
      const stage = stages.get(name); assertSnapshot(name, stage); ancestors(target);
      renameSync(absolute(name), absolute(target)); stages.delete(name);
      return stage;
    }
    function cleanStages() {
      for (const [name, expected] of stages) {
        ancestors(name); const actual = maybeStat(absolute(name));
        if (!actual || !actual.isFile() || actual.nlink !== 1 || !identity(actual, expected.stat)) fail("CLEANUP_FAILED", name);
        unlinkSync(absolute(name)); stages.delete(name);
      }
    }
    try {
      assertSnapshot(SOURCE, source);
      for (const t of targets) assertSnapshot(t.rel, t.before);
      for (const t of changed) {
        const parent = dirname(t.rel);
        if (!ancestors(t.rel, true)) { mkdirSync(absolute(parent), { mode: 0o755 }); createdDirs.push(parent); directory(parent); }
        t.stage = staged(t.rel, source.bytes, MODE);
        if (t.before) t.backup = staged(t.rel, t.before.bytes, t.before.stat.mode & 0o7777);
      }
      for (const [index, t] of changed.entries()) {
        currentPath = t.rel; assertSnapshot(SOURCE, source); assertSnapshot(t.rel, t.before);
        if (testOnlyFailPublication === index + 1) fail("PUBLICATION_FAILED", t.rel);
        t.output = publish(t.stage, t.rel); published.push(t);
        const output = read(t.rel);
        if (!output || !identity(output.stat, t.output.stat) || !output.bytes.equals(source.bytes) || (output.stat.mode & 0o7777) !== MODE) fail("PUBLICATION_FAILED", t.rel);
        t.output = output;
      }
      for (const t of targets) {
        const actual = read(t.rel);
        if (!actual || !actual.bytes.equals(source.bytes) || (actual.stat.mode & 0o7777) !== MODE) fail("PUBLICATION_FAILED", t.rel);
      }
      cleanStages();
      return { ok: true, changed: changed.map(t => t.rel) };
    } catch (error) {
      const failedPath = error instanceof SyncError ? error.path : currentPath;
      let failed = false;
      for (const t of published.reverse()) {
        try {
          // Do not overwrite intervening edits; preserve the backup on conflict.
          const now = read(t.rel);
          if (!now || !identity(now.stat, t.output.stat) || !now.bytes.equals(source.bytes) || (now.stat.mode & 0o7777) !== MODE) fail("ROLLBACK_FAILED", t.rel);
          if (t.before) {
            publish(t.backup, t.rel);
            const restored = read(t.rel);
            if (!restored || !restored.bytes.equals(t.before.bytes) || (restored.stat.mode & 0o7777) !== (t.before.stat.mode & 0o7777)) fail("ROLLBACK_FAILED", t.rel);
          } else { unlinkSync(absolute(t.rel)); if (maybeStat(absolute(t.rel))) fail("ROLLBACK_FAILED", t.rel); }
        } catch { failed = true; }
      }
      if (!failed) {
        try {
          cleanStages();
          for (const parent of createdDirs.reverse()) { directory(parent); rmdirSync(absolute(parent)); }
        } catch { failed = true; }
      }
      rollback = failed ? "failed" : "restored";
      if (failed) fail("ROLLBACK_FAILED", failedPath);
      throw error instanceof SyncError ? error : new SyncError("PUBLICATION_FAILED", failedPath);
    }
  } catch (error) {
    return { ok: false, code: error instanceof SyncError ? error.code : "IO_ERROR", path: error instanceof SyncError ? error.path : currentPath, ...(rollback ? { rollback } : {}) };
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry || entry === "-") return false;
  // Imported modules must work from stdin/eval and custom launchers whose
  // argv entry may not identify a filesystem file.
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !["--check", "--write"].includes(args[0]))) {
    process.stderr.write("INVALID_ARGUMENTS: use --check (default) or --write\n"); process.exitCode = 2;
  } else {
    const result = syncRoutingObservationContract({ mode: args[0] === "--write" ? "write" : "check" });
    (result.ok ? process.stdout : process.stderr).write(JSON.stringify(result) + "\n"); process.exitCode = result.ok ? 0 : 1;
  }
}
