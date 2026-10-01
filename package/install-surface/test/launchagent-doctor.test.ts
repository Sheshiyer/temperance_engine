/**
 * LaunchAgent doctor observation tests.
 *
 * Exercises observeLaunchAgent via runInstallSection: absent plist → UNAVAILABLE,
 * matching plist → PASS, drifted plist → DRIFT, read-only invariant holds.
 *
 * All tests use filesystem IO only — never run launchctl.
 */

import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

import { canonical } from "../src/canonical-json.ts";
import { runInstallSection } from "../src/doctor/sections/install.ts";
import { renderPlist, sha256Hex } from "../src/lifecycle/launchagent.ts";
import type { InstallSurfaceLockV1, LaunchAgentSurfaceRecord } from "../src/types.ts";
import type { DoctorContext } from "../src/doctor/model.ts";

// ─── helpers ──────────────────────────────────────────────────────────────────

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{{label}}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{{binary}}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;

const BINDINGS = { label: "com.temperance.engine.test-agent", binary: "/usr/local/bin/test-agent" };

function launchAgentRecord(id: string, relativePlistPath: string): LaunchAgentSurfaceRecord {
  return {
    id,
    owner: "temperance-engine",
    class: "LAUNCHAGENT",
    label: BINDINGS.label,
    plist_template: PLIST_TEMPLATE,
    bindings: BINDINGS,
    destination: { root_token: "HOME", relative_path: relativePlistPath, ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-01"], isa: "ISC-001" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "plist-sha256" },
    rollback: { policy: "unload-and-restore" },
  };
}

function writeLock(repositoryRoot: string, record: LaunchAgentSurfaceRecord): void {
  const dir = join(repositoryRoot, "package/install-surface");
  mkdirSync(dir, { recursive: true });
  const lock: InstallSurfaceLockV1 = {
    schema: "temperance.install-surface.lock.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 },
    records: [record],
  };
  writeFileSync(join(dir, "install-surface-manifest.lock.json"), canonical(lock));
}

function makeContext(repositoryRoot: string, home: string): DoctorContext {
  return {
    repositoryRoot,
    stateRoot: join(repositoryRoot, "state"),
    platform: "darwin" as NodeJS.Platform,
    rootBindings: { HOME: home },
    runtimeUrls: {
      bridge: "http://127.0.0.1:1",
      omniroute: "http://127.0.0.1:1",
      console: "http://127.0.0.1:1",
      auto_proxy: "http://127.0.0.1:1",
      pulse: "http://127.0.0.1:1",
    },
    io: {
      readFile: async (path) => readFileSync(path, "utf8"),
      readBytes: async (path) => new Uint8Array(readFileSync(path)),
      readdir: async (path) => readdirSync(path),
      lstat: async (path) => lstatSync(path),
      realpath: async (path) => realpathSync(path),
      fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); },
      execFile: async () => { throw new Error("PROCESS_FORBIDDEN"); },
      now: () => new Date("2026-10-01T00:00:00.000Z"),
    },
    signal: AbortSignal.timeout(5000),
  };
}

function snapshot(root: string): string {
  const rows: string[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    const rel = relative(root, path) || ".";
    rows.push([rel, stat.mode & 0o777, stat.isFile() ? readFileSync(path).toString("hex") : ""].join("|"));
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root);
  return rows.join("\n");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("observeLaunchAgent — absent plist", () => {
  test("produces UNAVAILABLE with LAUNCHAGENT_PLIST_ABSENT when plist is not installed", async () => {
    const repo = tempRoot("la-doctor-absent-");
    const home = join(repo, "home");
    mkdirSync(home);
    const record = launchAgentRecord("la.test.absent", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.absent");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_ABSENT");
    expect(check!.class).toBe("LAUNCHAGENT");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — matching plist", () => {
  test("produces PASS when installed plist sha256 matches rendered template", async () => {
    const repo = tempRoot("la-doctor-match-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.match", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const before = snapshot(repo);
    const section = await runInstallSection(ctx);
    expect(snapshot(repo)).toBe(before);

    const check = section.checks.find((c) => c.id === "la.test.match");
    expect(check).toBeDefined();
    expect(check!.condition).toBe("PASS");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_MATCH");
    expect(check!.class).toBe("LAUNCHAGENT");
    expect(check!.actionable).toBe(false);
  });
});

describe("observeLaunchAgent — drifted plist", () => {
  test("produces DRIFT when installed plist sha256 does not match rendered template", async () => {
    const repo = tempRoot("la-doctor-drift-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const driftedPlist = renderPlist(PLIST_TEMPLATE, { ...BINDINGS, binary: "/usr/local/bin/OTHER" });
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, driftedPlist, "utf8");

    const record = launchAgentRecord("la.test.drift", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const before = snapshot(repo);
    const section = await runInstallSection(ctx);
    expect(snapshot(repo)).toBe(before);

    const check = section.checks.find((c) => c.id === "la.test.drift");
    expect(check).toBeDefined();
    expect(check!.condition).toBe("DRIFT");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_DRIFT");
    expect(check!.class).toBe("LAUNCHAGENT");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — read-only invariant", () => {
  test("observation does not mutate filesystem regardless of plist state", async () => {
    const repo = tempRoot("la-doctor-readonly-");
    const home = join(repo, "home");
    mkdirSync(home);

    const record = launchAgentRecord("la.test.readonly", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const before = snapshot(repo);
    await runInstallSection(ctx);
    expect(snapshot(repo)).toBe(before);
  });

  test("sha256Hex and renderPlist are deterministic with same inputs", () => {
    const r1 = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const r2 = renderPlist(PLIST_TEMPLATE, BINDINGS);
    expect(r1).toBe(r2);
    expect(sha256Hex(r1)).toBe(sha256Hex(r2));
    expect(sha256Hex(r1)).toBe(hash(r1));
  });
});

describe("observeLaunchAgent — platform gate", () => {
  test("produces UNSUPPORTED on linux platform", async () => {
    const repo = tempRoot("la-doctor-platform-");
    const home = join(repo, "home");
    mkdirSync(home);
    const record = launchAgentRecord("la.test.platform", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx: DoctorContext = { ...makeContext(repo, home), platform: "linux" as NodeJS.Platform };
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.platform");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNSUPPORTED");
    expect(check!.reason_code).toBe("PLATFORM_UNSUPPORTED");
  });
});

// ─── P2 review counterexamples: symlink/hardlink safety ──────────────────────

import { symlinkSync, linkSync } from "node:fs";

describe("observeLaunchAgent — parent-symlink", () => {
  test("rejects matching plist bytes when a parent directory is a symlink (LAUNCHAGENT_PLIST_UNSAFE)", async () => {
    const repo = tempRoot("la-doctor-parent-symlink-");
    const outerHome = join(repo, "real-home");
    const symlinkHome = join(repo, "symlink-home");
    const agentsDir = join(outerHome, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    // Write the exactly-matching plist in the real location
    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    writeFileSync(join(agentsDir, "com.temperance.engine.test-agent.plist"), renderedPlist, "utf8");

    // Point the HOME binding at a symlink to the real home — parent traversal unsafe
    symlinkSync(outerHome, symlinkHome);

    const record = launchAgentRecord("la.test.parent-sym", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, symlinkHome);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.parent-sym");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });

  test("rejects matching plist bytes when an intermediate directory is a symlink (LAUNCHAGENT_PLIST_UNSAFE)", async () => {
    const repo = tempRoot("la-doctor-mid-symlink-");
    const home = join(repo, "home");
    const realLibrary = join(repo, "real-Library");
    const symLibrary = join(home, "Library");
    const agentsDir = join(realLibrary, "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(home, { recursive: true });

    // Write the exactly-matching plist at the real location
    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    writeFileSync(join(agentsDir, "com.temperance.engine.test-agent.plist"), renderedPlist, "utf8");

    // Library within home is a symlink to the real Library outside home
    symlinkSync(realLibrary, symLibrary);

    const record = launchAgentRecord("la.test.mid-sym", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.mid-sym");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — leaf-symlink", () => {
  test("rejects matching plist bytes when the leaf plist file is a symlink (LAUNCHAGENT_PLIST_UNSAFE)", async () => {
    const repo = tempRoot("la-doctor-leaf-symlink-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    const realPlist = join(repo, "real.plist");
    mkdirSync(agentsDir, { recursive: true });

    // Write the exactly-matching plist outside the home bound
    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    writeFileSync(realPlist, renderedPlist, "utf8");

    // Leaf is a symlink to the real plist
    symlinkSync(realPlist, join(agentsDir, "com.temperance.engine.test-agent.plist"));

    const record = launchAgentRecord("la.test.leaf-sym", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.leaf-sym");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — hardlink", () => {
  test("rejects matching plist bytes when the leaf plist is a hardlink (nlink > 1) (LAUNCHAGENT_PLIST_UNSAFE)", async () => {
    const repo = tempRoot("la-doctor-hardlink-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    // Write canonical plist
    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    // Create a hard link — nlink becomes 2 on the canonical file
    const linkPath = join(repo, "hard-link.plist");
    linkSync(plistPath, linkPath);

    const record = launchAgentRecord("la.test.hardlink", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.hardlink");

    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — broken-link", () => {
  test("rejects broken symlink as LAUNCHAGENT_PLIST_UNSAFE, not as absent (LAUNCHAGENT_PLIST_ABSENT)", async () => {
    const repo = tempRoot("la-doctor-broken-link-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    // Create a broken symlink: target does not exist
    const brokenTarget = join(repo, "nonexistent.plist");
    symlinkSync(brokenTarget, join(agentsDir, "com.temperance.engine.test-agent.plist"));

    const record = launchAgentRecord("la.test.broken-link", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const ctx = makeContext(repo, home);
    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.broken-link");

    expect(check).toBeDefined();
    // A broken symlink must not produce ABSENT — the symlink exists even though its target is gone
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.reason_code).not.toBe("LAUNCHAGENT_PLIST_ABSENT");
    expect(check!.actionable).toBe(true);
  });
});

// ─── injected IO tests ────────────────────────────────────────────────────────
// These tests use synthetic Stats objects injected via context.io.lstat to
// simulate TOCTOU races that real-filesystem tests cannot trigger reliably.

import { symlinkSync, linkSync } from "node:fs";
import type { Stats } from "node:fs";
import type { ObservationIO } from "../src/doctor/model.ts";

/** Build a synthetic Stats object for injected IO tests. */
function makeStat(overrides: {
  isFile?: boolean;
  isDir?: boolean;
  isSym?: boolean;
  nlink?: number;
  mode?: number;
  ino?: number;
  dev?: number;
  size?: number;
  mtimeMs?: number;
}): Stats {
  const isFile = overrides.isFile ?? true;
  const isDir = overrides.isDir ?? false;
  const isSym = overrides.isSym ?? false;
  return {
    isFile: () => isFile,
    isDirectory: () => isDir,
    isSymbolicLink: () => isSym,
    nlink: overrides.nlink ?? 1,
    mode: overrides.mode ?? 0o100644,
    ino: overrides.ino ?? 1234,
    dev: overrides.dev ?? 99,
    size: overrides.size ?? 128,
    mtimeMs: overrides.mtimeMs ?? 1000,
  } as unknown as Stats;
}

/** Safe stats for a regular ancestor directory. */
const DIR_STAT = makeStat({ isFile: false, isDir: true, isSym: false, nlink: 2 });
/** Safe stats for a regular single-link file (used by walk). */
const SAFE_FILE_STAT = makeStat({ isFile: true, isDir: false, isSym: false, nlink: 1, mode: 0o100644 });
/** Stats pretending to be a symlink (returned after replacement). */
const SYMLINK_STAT = makeStat({ isFile: false, isDir: false, isSym: true, nlink: 1, mode: 0o120777 });
/** Stats for a hardlinked file (nlink > 1). */
const HARDLINK_STAT = makeStat({ isFile: true, isDir: false, isSym: false, nlink: 2, mode: 0o100644 });

function makeInjectedContext(
  repositoryRoot: string,
  home: string,
  ioOverrides: Partial<ObservationIO>,
): DoctorContext {
  const base = makeContext(repositoryRoot, home);
  return { ...base, io: { ...base.io, ...ioOverrides } };
}

describe("observeLaunchAgent — injected IO: symlink replaces leaf before pre-read lstat", () => {
  test("returns LAUNCHAGENT_PLIST_UNSAFE when walk sees safe stat but pre-read lstat returns symlink", async () => {
    // Demonstrates the TOCTOU window: walk lstat returns safe regular stats,
    // but between walk and the pre-read lstat, the file is replaced with a
    // symlink. The pre-read lstat check must catch this.
    const repo = tempRoot("la-doctor-inject-sym-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.inject-sym", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    // Walk calls: lstat(home), lstat(Library), lstat(LaunchAgents), lstat(plist) → safe
    // Read phase calls: lstat(plist) again → returns SYMLINK_STAT
    let walkLstatCount = 0;
    const ctx = makeInjectedContext(repo, home, {
      lstat: async (path: string) => {
        if (path === plistPath) {
          walkLstatCount++;
          // First call is during walk → safe. Subsequent calls (pre/post read) → symlink.
          if (walkLstatCount === 1) return SAFE_FILE_STAT;
          return SYMLINK_STAT;
        }
        return lstatSync(path);
      },
    });

    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.inject-sym");
    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — injected IO: hardlink replaces leaf before pre-read lstat", () => {
  test("returns LAUNCHAGENT_PLIST_UNSAFE when walk sees safe stat but pre-read lstat returns nlink>1", async () => {
    const repo = tempRoot("la-doctor-inject-hl-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.inject-hl", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    let walkLstatCount = 0;
    const ctx = makeInjectedContext(repo, home, {
      lstat: async (path: string) => {
        if (path === plistPath) {
          walkLstatCount++;
          if (walkLstatCount === 1) return SAFE_FILE_STAT;
          return HARDLINK_STAT;
        }
        return lstatSync(path);
      },
    });

    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.inject-hl");
    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — injected IO: file replaced during read (sameFile false)", () => {
  test("returns LAUNCHAGENT_PLIST_UNSAFE when before/after lstat do not match", async () => {
    // Simulates a file being atomically replaced between the before-lstat and
    // the after-lstat, making sameFile(before, after) return false.
    const repo = tempRoot("la-doctor-inject-race-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.inject-race", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    // before = safe; after = safe but different ino/mtimeMs (different file)
    const BEFORE_STAT = makeStat({ ino: 1000, mtimeMs: 1000 });
    const AFTER_STAT  = makeStat({ ino: 1001, mtimeMs: 2000 });
    let readPhaseLstatCount = 0;
    const ctx = makeInjectedContext(repo, home, {
      lstat: async (path: string) => {
        if (path === plistPath) {
          readPhaseLstatCount++;
          // Walk: call 1 → safe (SAFE_FILE_STAT matches existing check)
          // Read phase: call 2 = before, call 3 = after
          if (readPhaseLstatCount === 1) return SAFE_FILE_STAT;
          if (readPhaseLstatCount === 2) return BEFORE_STAT;
          return AFTER_STAT;
        }
        return lstatSync(path);
      },
    });

    const section = await runInstallSection(ctx);
    const check = section.checks.find((c) => c.id === "la.test.inject-race");
    expect(check).toBeDefined();
    expect(check!.condition).toBe("UNAVAILABLE");
    // sameFile(before, after) is false → should produce UNSAFE (not UNREADABLE)
    expect(check!.reason_code).toBe("LAUNCHAGENT_PLIST_UNSAFE");
    expect(check!.actionable).toBe(true);
  });
});

describe("observeLaunchAgent — abort: walk aborted", () => {
  test("propagates abort during walk phase (rejects, does not return doctor result)", async () => {
    const repo = tempRoot("la-doctor-abort-walk-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    writeFileSync(join(agentsDir, "com.temperance.engine.test-agent.plist"), renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.abort-walk", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const controller = new AbortController();
    const base = makeContext(repo, home);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");

    // Abort when lstat is called for the leaf during the walk
    const ctx: DoctorContext = {
      ...base,
      signal: controller.signal,
      io: {
        ...base.io,
        lstat: async (path: string) => {
          if (path === plistPath) controller.abort();
          return lstatSync(path);
        },
      },
    };

    // observeLaunchAgent calls throwIfAborted() inside the walk loop after
    // each lstat. The abort above fires during the leaf lstat, and the next
    // throwIfAborted must propagate — not map to a result.
    await expect(runInstallSection(ctx)).rejects.toThrow();
  });
});

describe("observeLaunchAgent — abort: read phase aborted", () => {
  test("propagates abort during read phase (rejects, does not return doctor result)", async () => {
    const repo = tempRoot("la-doctor-abort-read-");
    const home = join(repo, "home");
    const agentsDir = join(home, "Library", "LaunchAgents");
    mkdirSync(agentsDir, { recursive: true });

    const renderedPlist = renderPlist(PLIST_TEMPLATE, BINDINGS);
    const plistPath = join(agentsDir, "com.temperance.engine.test-agent.plist");
    writeFileSync(plistPath, renderedPlist, "utf8");

    const record = launchAgentRecord("la.test.abort-read", "Library/LaunchAgents/com.temperance.engine.test-agent.plist");
    writeLock(repo, record);

    const controller = new AbortController();
    const base = makeContext(repo, home);

    // Abort during readFile (the IO read itself)
    const ctx: DoctorContext = {
      ...base,
      signal: controller.signal,
      io: {
        ...base.io,
        readFile: async (_path: string) => {
          controller.abort();
          controller.signal.throwIfAborted();
          return "";
        },
      },
    };

    await expect(runInstallSection(ctx)).rejects.toThrow();
  });
});
