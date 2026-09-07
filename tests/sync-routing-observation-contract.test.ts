import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { syncRoutingObservationContract, OWNERSHIP_NOTICE, SOURCE, TARGETS } from "../scripts/sync-routing-observation-contract.mjs";

const roots: string[] = [];
const script = new URL("../scripts/sync-routing-observation-contract.mjs", import.meta.url);
const canonical = () => readFileSync(new URL("../package/contracts/routing-observation-receipt.v1.ts", import.meta.url), "utf8")
  .replace(/^\/\/ Canonical product source[^\n]*\n\/\/ edit this file[^\n]*\n/, OWNERSHIP_NOTICE);
function temp(): string {
  const root = mkdtempSync(join(tmpdir(), "ro02-")); roots.push(root); return root;
}
function put(root: string, relative: string, bytes: string | Buffer, mode = 0o644): void {
  mkdirSync(dirname(join(root, relative)), { recursive: true });
  writeFileSync(join(root, relative), bytes); chmodSync(join(root, relative), mode);
}
function fixture(): string {
  const root = temp(); put(root, SOURCE, canonical());
  mkdirSync(join(root, "package/router")); mkdirSync(join(root, "package/manifest-bridge/src"), { recursive: true });
  return root;
}
function snapshot(root: string): unknown {
  function visit(relative: string): unknown {
    const file = join(root, relative); const s = lstatSync(file);
    return { relative, mode: s.mode, ino: s.ino, mtime: s.mtimeMs,
      ...(s.isDirectory() ? { children: readdirSync(file).sort().map(name => visit(join(relative, name))) }
        : s.isFile() ? { bytes: readFileSync(file).toString("hex") } : {}) };
  }
  return visit("");
}
function noStages(root: string): void {
  for (const target of TARGETS) if (existsSync(dirname(join(root, target)))) {
    expect(readdirSync(dirname(join(root, target))).filter(name => name.startsWith(".ro02-"))).toEqual([]);
  }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("RO-02 source-owned contract sync", () => {
  test("default and explicit check reject missing targets without any mutation", () => {
    const root = fixture(); const before = snapshot(root);
    for (const options of [{ root }, { root, mode: "check" }]) {
      expect(syncRoutingObservationContract(options)).toMatchObject({ ok: false, code: "TARGET_MISSING", path: TARGETS[0] });
      expect(snapshot(root)).toEqual(before);
    }
  });
  test("write creates only declared contract directories, copies raw bytes and fixes umask", () => {
    const root = fixture(); const previous = process.umask(0o077);
    try { expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: true, changed: [...TARGETS] }); }
    finally { process.umask(previous); }
    for (const target of TARGETS) {
      expect(readFileSync(join(root, target))).toEqual(readFileSync(join(root, SOURCE)));
      expect(lstatSync(join(root, target)).mode & 0o7777).toBe(0o644);
    }
    noStages(root);
  });
  test("parity is byte exact including CRLF, invalid UTF8 drift and final newline; check is read-only", () => {
    const root = fixture(); expect(syncRoutingObservationContract({ root, mode: "write" }).ok).toBe(true);
    for (const bytes of [Buffer.from(canonical().replace(/\n/g, "\r\n")), Buffer.from(canonical().slice(0, -1)), Buffer.concat([Buffer.from(canonical()), Buffer.from([0xff])])]) {
      put(root, TARGETS[1], bytes); const before = snapshot(root);
      expect(syncRoutingObservationContract({ root })).toMatchObject({ ok: false, code: "TARGET_DRIFT", path: TARGETS[1] });
      expect(snapshot(root)).toEqual(before);
    }
    expect(syncRoutingObservationContract({ root, mode: "write" }).ok).toBe(true);
    const before = snapshot(root);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: true, changed: [] });
    expect(syncRoutingObservationContract({ root })).toMatchObject({ ok: true, changed: [] });
    expect(snapshot(root)).toEqual(before);
  });
  test("check rejects mode drift without chmod; write repairs it and preserves the other inode", () => {
    const root = fixture(); syncRoutingObservationContract({ root, mode: "write" });
    chmodSync(join(root, TARGETS[1]), 0o600); const first = lstatSync(join(root, TARGETS[0])); const before = snapshot(root);
    expect(syncRoutingObservationContract({ root })).toMatchObject({ ok: false, code: "TARGET_MODE" });
    expect(snapshot(root)).toEqual(before);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: true, changed: [TARGETS[1]] });
    expect(lstatSync(join(root, TARGETS[0])).ino).toBe(first.ino);
    expect(lstatSync(join(root, TARGETS[1])).mode & 0o7777).toBe(0o644);
  });
  test("preflights both targets before creating the first directory", () => {
    const root = fixture(); const outside = temp(); symlinkSync(outside, dirname(join(root, TARGETS[1])));
    const before = snapshot(root);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "UNSAFE_PATH" });
    expect(snapshot(root)).toEqual(before); expect(readdirSync(outside)).toEqual([]);
  });
  for (const relative of [SOURCE, ...TARGETS]) for (const kind of ["symlink", "hardlink", "directory", "fifo"]) {
    test(`rejects ${kind} at ${relative} without mutation`, () => {
      const root = fixture(); syncRoutingObservationContract({ root, mode: "write" });
      const outside = temp(); put(outside, "sentinel", "synthetic outside bytes");
      rmSync(join(root, relative));
      if (kind === "symlink") symlinkSync(join(outside, "sentinel"), join(root, relative));
      if (kind === "hardlink") linkSync(join(outside, "sentinel"), join(root, relative));
      if (kind === "directory") mkdirSync(join(root, relative));
      if (kind === "fifo") expect(spawnSync("mkfifo", [join(root, relative)]).status).toBe(0);
      const before = snapshot(root);
      expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "UNSAFE_PATH", path: relative });
      expect(snapshot(root)).toEqual(before); expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("synthetic outside bytes");
    });
  }
  for (const ancestor of ["package", "package/contracts", "package/router", "package/manifest-bridge", "package/manifest-bridge/src"]) {
    test(`rejects symlink ancestor ${ancestor}`, () => {
      const root = fixture(); rmSync(join(root, ancestor), { recursive: true }); symlinkSync(temp(), join(root, ancestor));
      const before = snapshot(root);
      expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "UNSAFE_PATH" });
      expect(snapshot(root)).toEqual(before);
    });
  }
  test("rejects symlink root, relative root, and missing undeclared parents", () => {
    const root = fixture(); const alias = join(temp(), "alias"); symlinkSync(root, alias);
    expect(syncRoutingObservationContract({ root: alias, mode: "write" })).toMatchObject({ ok: false, code: "UNSAFE_PATH", path: "." });
    expect(syncRoutingObservationContract({ root: "../escape", mode: "write" })).toMatchObject({ ok: false, code: "INVALID_ROOT" });
    rmSync(join(root, "package/router"), { recursive: true }); const before = snapshot(root);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "PARENT_MISSING" });
    expect(snapshot(root)).toEqual(before);
  });
  test("missing source and non-directory ancestors fail before mutation", () => {
    const root = fixture(); rmSync(join(root, SOURCE)); const before = snapshot(root);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "SOURCE_MISSING", path: SOURCE });
    expect(snapshot(root)).toEqual(before);
    put(root, SOURCE, canonical()); rmSync(join(root, "package/router"), { recursive: true }); put(root, "package/router", "synthetic obstruction");
    const obstructed = snapshot(root);
    expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "UNSAFE_PATH", path: "package/router" });
    expect(snapshot(root)).toEqual(obstructed);
  });
  test("rejects source mode, ownership or encoding drift before writes", () => {
    const root = fixture();
    for (const [bytes, mode, code] of [[canonical(), 0o600, "SOURCE_MODE"], [canonical().replace("Canonical product source", "Forged source"), 0o644, "SOURCE_NOTICE"], [Buffer.concat([Buffer.from(canonical()), Buffer.from([0xff])]), 0o644, "SOURCE_ENCODING"]] as const) {
      put(root, SOURCE, bytes, mode); const before = snapshot(root);
      expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code });
      expect(snapshot(root)).toEqual(before);
    }
  });
  for (const edge of ['import x from "./local.ts";', 'import "../sibling.ts";', 'export * from "./local.ts";', 'export { x } from "./local.ts";', 'const x = import /* hidden */ ("./local.ts");', 'const x = import\n("./local.ts");', 'const x = require("./local.ts");', 'const x = require /* hidden */ ("./local.ts");', 'import fs from "node:fs";', 'const x = `${import("./local.ts")}`;', 'const x = requ\\u0069re("./local.ts");']) {
    test(`rejects dependency edge ${edge}`, () => {
      const root = fixture(); put(root, SOURCE, canonical() + edge + "\n"); const before = snapshot(root);
      expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "SOURCE_IMPORTS" });
      expect(snapshot(root)).toEqual(before);
    });
  }
  for (const terminator of ["\r", "\u2028", "\u2029"]) {
    test(`line comment ends before dependency after U+${terminator.charCodeAt(0).toString(16).padStart(4, "0")}`, () => {
      const root = fixture(); put(root, SOURCE, canonical() + '// synthetic comment' + terminator + 'import "./missing-dependency.ts";\n');
      const before = snapshot(root);
      expect(syncRoutingObservationContract({ root, mode: "write" })).toMatchObject({ ok: false, code: "SOURCE_IMPORTS", path: SOURCE });
      expect(snapshot(root)).toEqual(before);
    });
  }
  for (const existing of [false, true]) {
    test(`caught second-publication failure restores first target (${existing ? "preimage" : "absence"}) and removes stages`, () => {
      const root = fixture();
      if (existing) for (const target of TARGETS) put(root, target, "synthetic previous bytes\r\n", 0o600);
      const result = syncRoutingObservationContract({ root, mode: "write", testOnlyFailPublication: 2 });
      expect(result).toMatchObject({ ok: false, code: "PUBLICATION_FAILED", path: TARGETS[1], rollback: "restored" });
      for (const target of TARGETS) {
        expect(existsSync(join(root, target))).toBe(existing);
        if (existing) { expect(readFileSync(join(root, target), "utf8")).toBe("synthetic previous bytes\r\n"); expect(lstatSync(join(root, target)).mode & 0o7777).toBe(0o600); }
        else expect(existsSync(dirname(join(root, target)))).toBe(false);
      }
      noStages(root);
    });
  }
  test("each generated copy imports in a detached tree without canonical source or sibling package", async () => {
    const root = fixture(); expect(syncRoutingObservationContract({ root, mode: "write" }).ok).toBe(true);
    for (const target of TARGETS) {
      const detached = temp(); const relative = target.replace(/^package\//, "");
      put(detached, relative, readFileSync(join(root, target)));
      expect(existsSync(join(detached, SOURCE))).toBe(false);
      expect(readdirSync(detached)).toEqual([relative.split("/")[0]]);
      const contract = await import(pathToFileURL(join(detached, relative)).href);
      expect(contract.ROUTING_OBSERVATION_RECEIPT_SCHEMA).toBe("temperance.routing-observation-receipt.v1");
      expect(contract.buildReceipt({}, {})).toEqual({ ok: false, code: "INVALID_POLICY" });
      const synthetic = readFileSync(new URL("../package/contracts/fixtures/routing-observation-receipt.v1/observed-completed.json", import.meta.url), "utf8");
      const result = contract.parseReceipt(synthetic, { registered_projects: ["prj_synthetic-project"], catalog: [{ provider: "synthetic", model: "synthetic/model-v1" }], max_freshness_ms: 60_000 });
      expect(result.ok).toBe(true);
      expect(result.receipt.evidence_mode).toBe("synthetic");
    }
  });
  test("CLI resolves its own script root from foreign cwd and accepts only check or write", () => {
    const root = fixture(); mkdirSync(join(root, "scripts")); copyFileSync(script, join(root, "scripts/sync-routing-observation-contract.mjs"));
    const foreign = temp(); const run = (...args: string[]) => spawnSync("node", [join(root, "scripts/sync-routing-observation-contract.mjs"), ...args], { cwd: foreign, encoding: "utf8" });
    const before = snapshot(root); expect(run().status).toBe(1); expect(snapshot(root)).toEqual(before);
    for (const args of [["--root", foreign], ["--write", "--check"], ["--check", "--check"], ["--target=x"], ["--write", "extra"]]) {
      const result = run(...args); expect(result.status).toBe(2); expect(result.stderr).toContain("INVALID_ARGUMENTS"); expect(result.stderr).not.toContain(root);
      expect(snapshot(root)).toEqual(before);
    }
    expect(run("--write").status).toBe(0); const written = snapshot(root);
    expect(run("--check").status).toBe(0); expect(run().status).toBe(0); expect(snapshot(root)).toEqual(written);
  });
  test("module imports safely from node stdin with dash, absent or nonexistent argv entry", () => {
    const root = fixture(); mkdirSync(join(root, "scripts")); copyFileSync(script, join(root, "scripts/sync-routing-observation-contract.mjs"));
    const moduleUrl = pathToFileURL(join(root, "scripts/sync-routing-observation-contract.mjs")).href;
    const before = snapshot(root);
    for (const setup of ["", "delete process.argv[1];", `process.argv[1] = ${JSON.stringify(join(root, "missing-entry.mjs"))};`]) {
      const result = spawnSync("node", ["--input-type=module", "-"], { encoding: "utf8", input: `${setup}\nconst module = await import(${JSON.stringify(moduleUrl)});\nconsole.log(typeof module.syncRoutingObservationContract);\n` });
      expect(result.status).toBe(0); expect(result.stderr).toBe(""); expect(result.stdout).toBe("function\n");
      expect(snapshot(root)).toEqual(before);
    }
  });
});
