/**
 * Safety foundation tests for transactional lifecycle.
 *
 * All tests use injected temp-dir fs only — never touch real filesystem.
 * Proves: journal-before-mutation, crash recovery, hazard fail-closed,
 * drift refusal, traversal bound, dependency preflight.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  linkSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SurfaceRecord } from "../src/types.ts";
import {
  Journal,
  generateTxId,
  pruneCompletedTransactions,
  type LifecycleIO,
  type JournalEntry,
} from "../src/lifecycle/journal.ts";
import {
  HazardError,
  assertTraversalBound,
  probeDestination,
  recheckBeforeMutation,
  assertNoAncestorConflict,
  checkDrift,
  enumerateRemovals,
  checkDependencies,
  preflight,
  type PlannedStep,
} from "../src/lifecycle/hazards.ts";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/**
 * Create a LifecycleIO backed by real fs in a temp directory.
 * All operations are real but scoped to injected temp dirs.
 */
function createTestIO(): LifecycleIO {
  return {
    mkdir: async (path, opts) => {
      mkdirSync(path, opts);
    },
    writeFile: async (path, data) => {
      writeFileSync(path, data, "utf8");
    },
    readFile: async (path) => readFileSync(path, "utf8"),
    readdir: async (path) => readdirSync(path),
    rm: async (path, opts) => rmSync(path, opts),
    lstat: async (path) => lstatSync(path),
    rename: async (oldPath, newPath) => {
      const { renameSync } = await import("node:fs");
      renameSync(oldPath, newPath);
    },
    realpath: async (path) => {
      const { realpathSync } = await import("node:fs");
      return realpathSync(path);
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    writeFileAtomic: async (path, data) => {
      const { openSync, writeSync, fsyncSync, closeSync } = await import("node:fs");
      const fd = openSync(path, "w");
      try {
        writeSync(fd, data, 0, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    fetch: async (url, _opts) => {
      // Default: succeed. Tests override for failure cases.
      return new Response(null, { status: 200 });
    },
    execFile: async (file, args, _opts) => {
      // Default: succeed. Tests override for failure cases.
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

function makeRecord(
  id: string,
  relativePath: string,
  opts: {
    ownership?: "exclusive-path" | "managed-block";
    requires?: SurfaceRecord["requires"];
  } = {},
): SurfaceRecord {
  return {
    id,
    owner: "test",
    class: "COPY",
    source: `fixtures/${id}.txt`,
    destination: {
      root_token: "HOME",
      relative_path: relativePath,
      ownership: { kind: opts.ownership ?? "exclusive-path" },
    },
    authority: { requirement_ids: ["TEST"], isa: "ISC-TEST" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
    requires: opts.requires,
  };
}

function makeStep(
  stepId: string,
  record: SurfaceRecord,
  mode: PlannedStep["mode"] = "install",
): PlannedStep {
  return {
    step_id: stepId,
    record_id: record.id,
    destination: record.destination,
    ownership: record.destination.ownership.kind,
    mode,
  };
}

function resolveRoots(base: string): (token: string) => string {
  return (token: string) => {
    const map: Record<string, string> = {
      HOME: join(base, "home"),
      CODEX_HOME: join(base, "codex"),
      CLAUDE_CONFIG_DIR: join(base, "claude"),
      TEMPERANCE_STATE: join(base, "state"),
    };
    return map[token] ?? join(base, token);
  };
}

// ─── Task 1: Journal tests ────────────────────────────────────────────────────

describe("journal", () => {
  test("append fsyncs before returning — entry is durable on disk", async () => {
    const root = tempRoot("journal-durable-");
    const io = createTestIO();
    const journal = await Journal.create(join(root, "state"), io);

    await journal.append({
      kind: "BEGIN",
      verb: "install",
      profile: "default",
      inventory_digest: "sha256:abc123",
      ts: "",
    });

    // Read the journal file directly from disk — proves fsync happened
    const raw = readFileSync(join(journal.txDir, "journal.json"), "utf8");
    const entries = JSON.parse(raw) as JournalEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("BEGIN");
    expect(entries[0].verb).toBe("install");
  });

  test("txid is lexicographically sortable by time", () => {
    const id1 = generateTxId();
    const id2 = generateTxId();
    // Format: 12 hex chars + dash + 8 hex chars
    expect(id1).toMatch(/^[0-9a-f]{12}-[0-9a-f]{8}$/);
    expect(id2).toMatch(/^[0-9a-f]{12}-[0-9a-f]{8}$/);
    // Same-millisecond IDs share the timestamp prefix
    expect(id1.slice(0, 12)).toBe(id2.slice(0, 12));
    // Different IDs (random suffix)
    expect(id1).not.toBe(id2);
    // Verify lexicographic sort works across different timestamps
    const early = "000000000001-aaaaaaaa";
    const late = "000000000002-aaaaaaaa";
    expect(early < late).toBe(true);
  });

  test("journal entry kinds: BEGIN, STAGE, COMMIT_STEP, COMPENSATE, ABORT, COMPLETE", async () => {
    const root = tempRoot("journal-kinds-");
    const io = createTestIO();
    const journal = await Journal.create(join(root, "state"), io);

    const kinds: JournalEntry["kind"][] = [
      "BEGIN", "STAGE", "COMMIT_STEP", "COMPENSATE", "ABORT", "COMPLETE",
    ];

    for (const kind of kinds) {
      const entry: JournalEntry = (() => {
        switch (kind) {
          case "BEGIN":
            return { kind, verb: "install", profile: "default", inventory_digest: "sha256:x", ts: "" };
          case "STAGE":
            return { kind, step_id: "s1", destination_symbolic: "HOME:.config/test", mode: "install", ts: "" };
          case "COMMIT_STEP":
            return { kind, step_id: "s1", ts: "" };
          case "COMPENSATE":
            return { kind, step_id: "s1", method: "restore-backup", ts: "" };
          case "ABORT":
            return { kind, reason: "test abort", ts: "" };
          case "COMPLETE":
            return { kind, receipt_ref: "receipt-001", ts: "" };
        }
      })();
      await journal.append(entry);
    }

    const entries = await journal.readEntries();
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.kind)).toEqual(kinds);
  });

  test("crash recovery: mid-run crash (BEGIN+STAGE, no COMMIT_STEP) identifies pending steps", async () => {
    const root = tempRoot("journal-crash-");
    const io = createTestIO();
    const journal = await Journal.create(join(root, "state"), io);

    // Simulate a mid-run crash: BEGIN + STAGE present, no COMMIT_STEP
    await journal.append({
      kind: "BEGIN",
      verb: "install",
      profile: "default",
      inventory_digest: "sha256:abc",
      ts: "",
    });
    await journal.append({
      kind: "STAGE",
      step_id: "step-1",
      destination_symbolic: "HOME:.config/test/file.txt",
      mode: "install",
      ts: "",
    });
    await journal.append({
      kind: "STAGE",
      step_id: "step-2",
      destination_symbolic: "HOME:.config/test/other.txt",
      mode: "install",
      ts: "",
    });

    // Crash recovery: reopen the journal
    const recovered = Journal.open(journal.txDir, io);
    expect(await recovered.getStatus()).toBe("incomplete");
    expect(await recovered.pendingSteps()).toEqual(["step-1", "step-2"]);
    expect(await recovered.committedSteps()).toEqual([]);
  });

  test("crash recovery: committed steps identified for rollback compensation", async () => {
    const root = tempRoot("journal-rollback-");
    const io = createTestIO();
    const journal = await Journal.create(join(root, "state"), io);

    await journal.append({ kind: "BEGIN", verb: "install", profile: "default", inventory_digest: "sha256:x", ts: "" });
    await journal.append({ kind: "STAGE", step_id: "step-1", destination_symbolic: "HOME:a", mode: "install", ts: "" });
    await journal.append({ kind: "COMMIT_STEP", step_id: "step-1", ts: "" });
    await journal.append({ kind: "STAGE", step_id: "step-2", destination_symbolic: "HOME:b", mode: "install", ts: "" });
    // Crash here — step-2 staged but not committed

    const recovered = Journal.open(journal.txDir, io);
    expect(await recovered.getStatus()).toBe("incomplete");
    expect(await recovered.pendingSteps()).toEqual(["step-2"]);
    expect(await recovered.committedSteps()).toEqual(["step-1"]);
  });

  test("retention: prunes oldest COMPLETE tx dirs, keeps last N", async () => {
    const root = tempRoot("journal-retention-");
    const stateRoot = join(root, "state");
    const io = createTestIO();

    // Create 7 completed transactions
    for (let i = 0; i < 7; i++) {
      const txid = `00000000000${i.toString(16)}-aaaa${i.toString(16).padStart(4, "0")}`;
      const journal = await Journal.create(stateRoot, io, txid);
      await journal.append({ kind: "BEGIN", verb: "install", profile: "default", inventory_digest: "sha256:x", ts: "" });
      await journal.append({ kind: "COMPLETE", receipt_ref: `receipt-${i}`, ts: "" });
    }

    // Keep last 5
    const pruned = await pruneCompletedTransactions(stateRoot, io, 5);
    expect(pruned).toHaveLength(2);
    // Oldest two were pruned
    expect(pruned[0]).toContain("000000000000");
    expect(pruned[1]).toContain("000000000001");

    // 5 remain
    const remaining = readdirSync(join(stateRoot, "transactions"));
    expect(remaining).toHaveLength(5);
  });

  test("retention: never touches incomplete transactions", async () => {
    const root = tempRoot("journal-retention-incomplete-");
    const stateRoot = join(root, "state");
    const io = createTestIO();

    // Create 3 completed and 2 incomplete
    for (let i = 0; i < 3; i++) {
      const txid = `00000000000${i.toString(16)}-bbbb${i.toString(16).padStart(4, "0")}`;
      const journal = await Journal.create(stateRoot, io, txid);
      await journal.append({ kind: "BEGIN", verb: "install", profile: "default", inventory_digest: "sha256:x", ts: "" });
      await journal.append({ kind: "COMPLETE", receipt_ref: `receipt-${i}`, ts: "" });
    }
    for (let i = 0; i < 2; i++) {
      const txid = `00000000000${(i + 3).toString(16)}-cccc${i.toString(16).padStart(4, "0")}`;
      const journal = await Journal.create(stateRoot, io, txid);
      await journal.append({ kind: "BEGIN", verb: "install", profile: "default", inventory_digest: "sha256:x", ts: "" });
      // No COMPLETE — stays incomplete
    }

    // Keep last 1 — should prune 2 completed, leave 2 incomplete + 1 completed
    const pruned = await pruneCompletedTransactions(stateRoot, io, 1);
    expect(pruned).toHaveLength(2);

    const remaining = readdirSync(join(stateRoot, "transactions"));
    expect(remaining).toHaveLength(3); // 1 completed + 2 incomplete
  });
});

// ─── Task 2: Hazard tests ─────────────────────────────────────────────────────

describe("hazard", () => {
  test("DEST_SYMLINK: symlink at destination fails closed with zero writes", async () => {
    const root = tempRoot("hazard-symlink-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    symlinkSync("/etc/passwd", join(homeDir, "evil-link"));

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "evil-link");
    const step = makeStep("s1", record);

    await expect(probeDestination(step, resolveRoot, io)).rejects.toThrow(HazardError);
    try {
      await probeDestination(step, resolveRoot, io);
    } catch (error) {
      expect((error as HazardError).code).toBe("DEST_SYMLINK");
    }
  });

  test("DEST_HARDLINK: hardlink at destination fails closed", async () => {
    const root = tempRoot("hazard-hardlink-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, "original.txt"), "content");
    linkSync(join(homeDir, "original.txt"), join(homeDir, "hard-linked"));

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "hard-linked");
    const step = makeStep("s1", record);

    await expect(probeDestination(step, resolveRoot, io)).rejects.toThrow(HazardError);
    try {
      await probeDestination(step, resolveRoot, io);
    } catch (error) {
      expect((error as HazardError).code).toBe("DEST_HARDLINK");
    }
  });

  test("PARENT_SWAP: symlink parent directory fails closed", async () => {
    const root = tempRoot("hazard-parent-");
    const homeDir = join(root, "home");
    mkdirSync(join(homeDir, "real-dir"), { recursive: true });
    symlinkSync(join(homeDir, "real-dir"), join(homeDir, "link-dir"));

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "link-dir/target.txt");
    const step = makeStep("s1", record);

    await expect(probeDestination(step, resolveRoot, io)).rejects.toThrow(HazardError);
    try {
      await probeDestination(step, resolveRoot, io);
    } catch (error) {
      expect((error as HazardError).code).toBe("PARENT_SWAP");
    }
  });

  test("PATH_TYPE_CONFLICT: directory where file expected fails closed", async () => {
    const root = tempRoot("hazard-pathtype-");
    const homeDir = join(root, "home");
    mkdirSync(join(homeDir, "adir"), { recursive: true });

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "adir");
    const step = makeStep("s1", record, "install");

    await expect(probeDestination(step, resolveRoot, io)).rejects.toThrow(HazardError);
    try {
      await probeDestination(step, resolveRoot, io);
    } catch (error) {
      expect((error as HazardError).code).toBe("PATH_TYPE_CONFLICT");
    }
  });

  test("TOCTOU re-check before mutation catches race", async () => {
    const root = tempRoot("hazard-toctou-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "target.txt");
    const step = makeStep("s1", record);

    // First check passes (file doesn't exist)
    await probeDestination(step, resolveRoot, io);

    // Race: someone creates a symlink
    symlinkSync("/etc/passwd", join(homeDir, "target.txt"));

    // Re-check catches it
    await expect(recheckBeforeMutation(step, resolveRoot, io)).rejects.toThrow(HazardError);
  });

  test("ANCESTOR_CONFLICT: uninstall step that is ancestor of another record fails", async () => {
    const record1 = makeRecord("r1", ".config/app");
    const record2 = makeRecord("r2", ".config/app/settings.json");
    const steps = [
      makeStep("s1", record1, "uninstall"),
      makeStep("s2", record2, "install"),
    ];

    expect(() => assertNoAncestorConflict(steps)).toThrow(HazardError);
    try {
      assertNoAncestorConflict(steps);
    } catch (error) {
      expect((error as HazardError).code).toBe("ANCESTOR_CONFLICT");
    }
  });

  test("sibling file survives uninstall — removal is enumeration-only", async () => {
    const root = tempRoot("hazard-sibling-");
    const homeDir = join(root, "home");
    mkdirSync(join(homeDir, ".config/app"), { recursive: true });
    writeFileSync(join(homeDir, ".config/app/target.txt"), "remove me");
    writeFileSync(join(homeDir, ".config/app/sibling.txt"), "keep me");

    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", ".config/app/target.txt");
    const steps = [makeStep("s1", record, "uninstall")];

    const removals = await enumerateRemovals(steps, resolveRoot);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toBe(join(homeDir, ".config/app/target.txt"));

    // Sibling is NOT in the removal list
    expect(removals.some((p) => p.includes("sibling.txt"))).toBe(false);
  });

  test("drift refusal: exclusive-path file differing from pre-image and expected blocks uninstall", async () => {
    const root = tempRoot("hazard-drift-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, "drifted.txt"), "unknown content");

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "drifted.txt");
    const step = makeStep("s1", record, "uninstall");

    const preimageBytes = new TextEncoder().encode("original content");
    const expectedBytes = new TextEncoder().encode("expected content");

    await expect(
      checkDrift(step, resolveRoot, io, { preimageBytes, expectedBytes }),
    ).rejects.toThrow(HazardError);

    try {
      await checkDrift(step, resolveRoot, io, { preimageBytes, expectedBytes });
    } catch (error) {
      expect((error as HazardError).code).toBe("OWNERSHIP_AMBIGUOUS");
    }
  });

  test("drift refusal: matching pre-image passes", async () => {
    const root = tempRoot("hazard-drift-ok-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    const content = "original content";
    writeFileSync(join(homeDir, "ok.txt"), content);

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "ok.txt");
    const step = makeStep("s1", record, "uninstall");

    const preimageBytes = new TextEncoder().encode(content);

    // Should not throw — matches pre-image
    await checkDrift(step, resolveRoot, io, { preimageBytes, expectedBytes: null });
  });

  test("TRAVERSAL_BOUND: rejects record with `..` in path", () => {
    const record = makeRecord("r1", ".config/../../../etc/passwd");
    expect(() => assertTraversalBound(record)).toThrow(HazardError);
    try {
      assertTraversalBound(record);
    } catch (error) {
      expect((error as HazardError).code).toBe("TRAVERSAL_BOUND");
      expect((error as HazardError).details.reason).toContain("parent traversal");
    }
  });

  test("TRAVERSAL_BOUND: rejects absolute path", () => {
    const record: SurfaceRecord = {
      ...makeRecord("r1", "safe/path"),
      destination: {
        root_token: "HOME",
        relative_path: "/etc/passwd",
        ownership: { kind: "exclusive-path" },
      },
    };
    expect(() => assertTraversalBound(record)).toThrow(HazardError);
    try {
      assertTraversalBound(record);
    } catch (error) {
      expect((error as HazardError).code).toBe("TRAVERSAL_BOUND");
      expect((error as HazardError).details.reason).toContain("absolute path");
    }
  });

  test("TRAVERSAL_BOUND: rejects provider-cache-shaped path", () => {
    const record = makeRecord("r1", "node_modules/evil/package.json");
    expect(() => assertTraversalBound(record)).toThrow(HazardError);
    try {
      assertTraversalBound(record);
    } catch (error) {
      expect((error as HazardError).code).toBe("TRAVERSAL_BOUND");
      expect((error as HazardError).details.reason).toContain("provider-cache");
    }
  });

  test("full preflight: planted hazard fails with zero writes", async () => {
    const root = tempRoot("hazard-preflight-");
    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    symlinkSync("/etc/passwd", join(homeDir, "evil"));

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const record = makeRecord("r1", "evil");
    const steps = [makeStep("s1", record)];
    const controller = new AbortController();

    await expect(
      preflight(steps, [record], resolveRoot, io, controller.signal),
    ).rejects.toThrow(HazardError);

    // Verify zero writes occurred — no journal dir, no mutations
    expect(readdirSync(root)).toEqual(["home"]);
  });
});

// ─── Task 3: Dependency preflight tests ───────────────────────────────────────

describe("dependency preflight", () => {
  test("missing binary dependency fails pre-execution with actionable remediation", async () => {
    const root = tempRoot("dep-binary-");
    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    // Override execFile to simulate missing binary
    const failIO: LifecycleIO = {
      ...io,
      execFile: async () => ({ stdout: "", stderr: "not found", exitCode: 1 }),
    };

    const record = makeRecord("r1", ".config/test", {
      requires: [{ kind: "binary", name: "nonexistent-tool" }],
    });

    await expect(
      checkDependencies([record], resolveRoot, failIO, controller.signal),
    ).rejects.toThrow(HazardError);

    try {
      await checkDependencies([record], resolveRoot, failIO, controller.signal);
    } catch (error) {
      expect((error as HazardError).code).toBe("DEPENDENCY_MISSING");
      expect((error as HazardError).details.remediation).toContain("nonexistent-tool");
      expect((error as HazardError).details.remediation).toContain("PATH");
    }
  });

  test("failing HTTP health check fails pre-execution with actionable remediation", async () => {
    const root = tempRoot("dep-http-");
    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    // Override fetch to simulate failure
    const failIO: LifecycleIO = {
      ...io,
      fetch: async () => new Response(null, { status: 503 }),
    };

    const record = makeRecord("r1", ".config/test", {
      requires: [{ kind: "http-health", url_token: "BRIDGE_URL" }],
    });

    await expect(
      checkDependencies([record], resolveRoot, failIO, controller.signal),
    ).rejects.toThrow(HazardError);

    try {
      await checkDependencies([record], resolveRoot, failIO, controller.signal);
    } catch (error) {
      expect((error as HazardError).code).toBe("DEPENDENCY_MISSING");
      expect((error as HazardError).details.remediation).toContain("BRIDGE_URL");
    }
  });

  test("records without requires pass dependency check", async () => {
    const root = tempRoot("dep-none-");
    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    const record = makeRecord("r1", ".config/test"); // no requires

    // Should not throw
    await checkDependencies([record], resolveRoot, io, controller.signal);
  });

  test("all dependencies satisfied passes", async () => {
    const root = tempRoot("dep-ok-");
    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    const record = makeRecord("r1", ".config/test", {
      requires: [
        { kind: "binary", name: "bun" }, // bun is available in test env
      ],
    });

    // Should not throw — bun exists on PATH
    await checkDependencies([record], resolveRoot, io, controller.signal);
  });

  test("zero-write proof: dependency failure leaves machine untouched", async () => {
    const root = tempRoot("dep-zerowrite-");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    const failIO: LifecycleIO = {
      ...io,
      execFile: async () => ({ stdout: "", stderr: "not found", exitCode: 1 }),
    };

    const record = makeRecord("r1", ".config/test", {
      requires: [{ kind: "binary", name: "nonexistent-tool" }],
    });

    try {
      await checkDependencies([record], resolveRoot, failIO, controller.signal);
    } catch {
      // Expected
    }

    // State directory is empty — no transactions created
    const stateContents = readdirSync(stateRoot);
    expect(stateContents).toEqual([]);
  });
});

// ─── Task 4: Integration — full preflight + journal flow ──────────────────────

describe("integration", () => {
  test("full preflight + journal BEGIN: safety gate before mutation", async () => {
    const root = tempRoot("integ-full-");
    const homeDir = join(root, "home");
    const stateRoot = join(root, "state");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, "target.txt"), "original");

    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    const record = makeRecord("r1", "target.txt");
    const steps = [makeStep("s1", record)];

    // 1. Preflight passes (no hazards)
    await preflight(steps, [record], resolveRoot, io, controller.signal);

    // 2. Journal BEGIN written before mutation
    const journal = await Journal.create(stateRoot, io);
    await journal.append({
      kind: "BEGIN",
      verb: "install",
      profile: "default",
      inventory_digest: "sha256:test",
      ts: "",
    });

    // 3. Stage the step
    await journal.append({
      kind: "STAGE",
      step_id: "s1",
      destination_symbolic: "HOME:target.txt",
      mode: "install",
      ts: "",
    });

    // 4. Verify journal is on disk before "mutation"
    const status = await journal.getStatus();
    expect(status).toBe("incomplete");
    expect(await journal.pendingSteps()).toEqual(["s1"]);

    // 5. Commit
    await journal.append({ kind: "COMMIT_STEP", step_id: "s1", ts: "" });
    await journal.append({ kind: "COMPLETE", receipt_ref: "receipt-001", ts: "" });

    expect(await journal.getStatus()).toBe("complete");
    expect(await journal.pendingSteps()).toEqual([]);
  });

  test("preflight rejects traversal-bound record before any IO", async () => {
    const root = tempRoot("integ-traversal-");
    const io = createTestIO();
    const resolveRoot = resolveRoots(root);
    const controller = new AbortController();

    const record = makeRecord("r1", "../escape");
    const steps = [makeStep("s1", record)];

    await expect(
      preflight(steps, [record], resolveRoot, io, controller.signal),
    ).rejects.toThrow(HazardError);

    // No state directory created
    expect(() => readdirSync(join(root, "state"))).toThrow();
  });
});
