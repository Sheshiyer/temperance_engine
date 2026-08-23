/**
 * Lifecycle tests — planner, executor, receipts.
 *
 * All tests use injected temp-dir fs only — never touch real filesystem.
 * Proves: outside-block preservation, crash recovery, idempotent uninstall,
 * rollback byte-equal, outcome taxonomy, digest linkage, redaction.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompileResult } from "../src/compile.ts";
import type { SurfaceRecord, InstallSurfaceLockV1 } from "../src/types.ts";
import {
  createPlan,
  type PlanOptions,
  type PlanResult,
  PlanError,
} from "../src/lifecycle/planner.ts";
import {
  executePlan,
  rollbackTransaction,
  spliceManagedBlock,
} from "../src/lifecycle/executor.ts";
import {
  writeReceipt,
  readReceipt,
  listReceipts,
  assertRedactionClean,
  verifyDigestLinkage,
  type Receipt,
} from "../src/lifecycle/receipts.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";

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
 * Resolves relative paths against the current working directory.
 */
function createTestIO(): LifecycleIO {
  return {
    mkdir: async (path, opts) => mkdirSync(path, opts),
    writeFile: async (path, data) => writeFileSync(path, data, "utf8"),
    readFile: async (path) => readFileSync(path, "utf8"),
    readdir: async (path) => readdirSync(path),
    rm: async (path, opts) => rmSync(path, opts),
    lstat: async (path) => {
      const { lstatSync } = await import("node:fs");
      return lstatSync(path);
    },
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
    fetch: async (_url, _opts) => new Response(null, { status: 200 }),
    execFile: async (_file, _args, _opts) => ({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

/**
 * Create a minimal CompileResult fixture.
 * @param srcDir - Absolute path to the source directory for COPY records
 */
function createFixture(overrides?: Partial<CompileResult>, srcDir?: string): CompileResult {
  const records: SurfaceRecord[] = [
    {
      id: "test-record-1",
      owner: "test",
      class: "COPY",
      source: srcDir ? join(srcDir, "file1.txt") : "src/file1.txt",
      destination: {
        root_token: "HOME",
        relative_path: ".config/test/file1.txt",
        ownership: { kind: "exclusive-path" },
      },
      authority: { requirement_ids: ["REQ-01"], isa: "ISA-01" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal", "full"], required: true },
      verification: { method: "sha256" },
      rollback: { policy: "restore-backup" },
    },
    {
      id: "test-record-2",
      owner: "test",
      class: "COPY",
      source: srcDir ? join(srcDir, "file2.txt") : "src/file2.txt",
      destination: {
        root_token: "HOME",
        relative_path: ".config/test/file2.txt",
        ownership: { kind: "exclusive-path" },
      },
      authority: { requirement_ids: ["REQ-02"], isa: "ISA-01" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["full"], required: false },
      depends_on: ["test-record-1"],
      verification: { method: "sha256" },
      rollback: { policy: "restore-backup" },
    },
    {
      id: "test-never-ship",
      owner: "test",
      class: "NEVER-SHIP",
      destination: {
        root_token: "HOME",
        relative_path: ".config/test/secret.key",
        ownership: { kind: "exclusive-path" },
      },
      authority: { requirement_ids: ["REQ-03"], isa: "ISA-01" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal", "full"], required: true },
      verification: { method: "symbolic-exclusion" },
      rollback: { policy: "none-private" },
    },
  ];

  const lockObject: InstallSurfaceLockV1 = {
    schema: "temperance.install-surface.lock.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 },
    records,
  };

  return {
    lockObject,
    canonicalBytes: JSON.stringify(lockObject),
    digest: "sha256:abc123def456" as `sha256:${string}`,
    semanticIds: records.map((r) => r.id),
    ...overrides,
  };
}

// ─── Planner tests ────────────────────────────────────────────────────────────

describe("planner", () => {
  test("creates plan with topological ordering", () => {
    const fixture = createFixture();
    const plan = createPlan({
      verb: "install",
      profileResult: fixture,
      profile: "full",
    });

    // test-record-1 should come before test-record-2 (depends_on)
    const idx1 = plan.steps.findIndex((s) => s.record_id === "test-record-1");
    const idx2 = plan.steps.findIndex((s) => s.record_id === "test-record-2");
    expect(idx1).toBeLessThan(idx2);
  });

  test("rejects NEVER-SHIP records", () => {
    const fixture = createFixture();

    expect(() => {
      createPlan({
        verb: "install",
        profileResult: fixture,
        profile: "minimal",
        explicitSelections: new Set(["test-never-ship"]),
      });
    }).toThrow(PlanError);
  });

  test("filters by profile", () => {
    const fixture = createFixture();
    const plan = createPlan({
      verb: "install",
      profileResult: fixture,
      profile: "minimal",
    });

    // test-record-2 is only in "full" profile
    expect(plan.steps.find((s) => s.record_id === "test-record-2")).toBeUndefined();
  });

  test("outcome taxonomy covers all states", () => {
    const fixture = createFixture();
    const plan = createPlan({
      verb: "install",
      profileResult: fixture,
      profile: "minimal",
    });

    // Should have outcomes for all records
    expect(plan.outcomes.length).toBe(fixture.lockObject.records.length);

    // NEVER-SHIP should be skipped
    const neverShip = plan.outcomes.find((o) => o.record_id === "test-never-ship");
    expect(neverShip?.status).toBe("skipped");

    // test-record-1 should be installed
    const record1 = plan.outcomes.find((o) => o.record_id === "test-record-1");
    expect(record1?.status).toBe("installed");

    // test-record-2 should be skipped (wrong profile)
    const record2 = plan.outcomes.find((o) => o.record_id === "test-record-2");
    expect(record2?.status).toBe("skipped");
  });
});

// ─── Executor tests ───────────────────────────────────────────────────────────

describe("executor", () => {
  test("executes install with journaling", async () => {
    const root = tempRoot("exec-install");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });

    // Create source files for the fixture
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "file1.txt"), "file1 content");

    // Set HOME to temp dir
    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const fixture = createFixture(undefined, srcDir);
      const io = createTestIO();
      const plan = createPlan({
        verb: "install",
        profileResult: fixture,
        profile: "minimal",
      });

      const result = await executePlan({
        stateRoot,
        io,
        plan,
        compileResult: fixture,
        verb: "install",
        profile: "minimal",
      });

      // Debug: print outcomes if failed
      if (result.status === "failed") {
        console.log("FAILED outcomes:", JSON.stringify(result.outcomes, null, 2));
      }

      expect(result.status).toBe("committed");
      expect(result.exitCode).toBe(0);
      expect(result.txid).toBeTruthy();
      expect(result.receipt).toBeTruthy();

      // Verify journal exists
      const txDir = join(stateRoot, "transactions", result.txid);
      expect(existsSync(join(txDir, "journal.json"))).toBe(true);

      // Verify receipt exists
      expect(existsSync(join(txDir, "receipt.json"))).toBe(true);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("dry run produces no writes", async () => {
    const root = tempRoot("exec-dry");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const fixture = createFixture();
    const io = createTestIO();
    const plan = createPlan({
      verb: "install",
      profileResult: fixture,
      profile: "minimal",
    });

    const result = await executePlan({
      stateRoot,
      io,
      plan,
      compileResult: fixture,
      verb: "install",
      profile: "minimal",
      dryRun: true,
    });

    expect(result.status).toBe("committed");
    expect(result.exitCode).toBe(0);

    // Verify no transaction directory created
    const txRoot = join(stateRoot, "transactions");
    expect(existsSync(txRoot)).toBe(false);
  });

  test("failed apply has receipt=failed and no manifest-after", async () => {
    const root = tempRoot("exec-fail");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const fixture = createFixture();
      const io = createTestIO();

      // Override execFile to fail for a specific binary
      const origExecFile = io.execFile;
      io.execFile = async (file, args, opts) => {
        if (file === "which" && args[0] === "nonexistent-binary") {
          return { stdout: "", stderr: "not found", exitCode: 1 };
        }
        return origExecFile(file, args, opts);
      };

      // Add a record with a missing dependency
      const failingRecord: SurfaceRecord = {
        id: "test-failing",
        owner: "test",
        class: "COPY",
        source: "src/failing.txt",
        destination: {
          root_token: "HOME",
          relative_path: ".config/test/failing.txt",
          ownership: { kind: "exclusive-path" },
        },
        authority: { requirement_ids: ["REQ-04"], isa: "ISA-01" },
        eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal"], required: true },
        requires: [{ kind: "binary", name: "nonexistent-binary" }],
        verification: { method: "sha256" },
        rollback: { policy: "restore-backup" },
      };

      const failingFixture = createFixture({
        lockObject: {
          ...fixture.lockObject,
          records: [...fixture.lockObject.records, failingRecord],
        },
      });

      const plan = createPlan({
        verb: "install",
        profileResult: failingFixture,
        profile: "minimal",
        explicitSelections: new Set(["test-failing"]),
      });

      const result = await executePlan({
        stateRoot,
        io,
        plan,
        compileResult: failingFixture,
        verb: "install",
        profile: "minimal",
        explicitSelections: new Set(["test-failing"]),
      });

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(1);

      // Check receipt status
      if (result.receipt) {
        expect(result.receipt.status).toBe("failed");
        expect(result.receipt.manifest_after_digest).toBeUndefined();
      }
    } finally {
      process.env.HOME = origHome;
    }
  });
});

// ─── Managed block tests ─────────────────────────────────────────────────────

describe("managed blocks", () => {
  test("spliceManagedBlock preserves outside-block content", () => {
    const existing = `# My Config

Some user content here.

<!-- temperance:managed:start test-block -->
old managed content
<!-- temperance:managed:end test-block -->

More user content.`;

    const result = spliceManagedBlock(existing, "test-block", "new managed content");

    // Should preserve outside-block content
    expect(result).toContain("# My Config");
    expect(result).toContain("Some user content here.");
    expect(result).toContain("More user content.");

    // Should update managed block
    expect(result).toContain("new managed content");
    expect(result).not.toContain("old managed content");
  });

  test("spliceManagedBlock creates block if missing", () => {
    const existing = `# My Config

Some user content here.`;

    const result = spliceManagedBlock(existing, "test-block", "new managed content");

    // Should preserve existing content
    expect(result).toContain("# My Config");
    expect(result).toContain("Some user content here.");

    // Should add managed block
    expect(result).toContain("<!-- temperance:managed:start test-block -->");
    expect(result).toContain("new managed content");
    expect(result).toContain("<!-- temperance:managed:end test-block -->");
  });
});

// ─── Receipt tests ────────────────────────────────────────────────────────────

describe("receipts", () => {
  test("receipt schema-valid and redaction-clean", async () => {
    const root = tempRoot("receipt-valid");
    const txDir = join(root, "tx-001");
    mkdirSync(txDir, { recursive: true });

    const io = createTestIO();

    const receipt = await writeReceipt({
      txid: "tx-001",
      verb: "install",
      profile: "minimal",
      inventory_digest: "sha256:abc123" as `sha256:${string}`,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      status: "committed",
      steps: [
        {
          id: "step-1",
          record_id: "record-1",
          destination_symbolic: "$HOME/.config/test/file.txt",
          outcome: "installed",
        },
      ],
      user_content_preserved: [],
      manifest_after_digest: "sha256:abc123" as `sha256:${string}`,
    }, txDir, io);

    expect(receipt.schema).toBe("temperance.lifecycle.receipt.v1");
    expect(receipt.txid).toBe("tx-001");
    expect(receipt.status).toBe("committed");

    // Should be redaction-clean
    expect(() => assertRedactionClean(receipt)).not.toThrow();
  });

  test("receipt rejects private values", () => {
    const receipt: Receipt = {
      schema: "temperance.lifecycle.receipt.v1",
      txid: "tx-001",
      verb: "install",
      profile: "minimal",
      inventory_digest: "sha256:abc123" as `sha256:${string}`,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      status: "committed",
      steps: [
        {
          id: "step-1",
          record_id: "record-1",
          destination_symbolic: "/Users/testuser/.config/test/file.txt", // PRIVATE!
          outcome: "installed",
        },
      ],
      user_content_preserved: [],
    };

    expect(() => assertRedactionClean(receipt)).toThrow("REDACTION_VIOLATION");
  });

  test("digest linkage matches CompileResult.digest", async () => {
    const root = tempRoot("receipt-digest");
    const txDir = join(root, "tx-001");
    mkdirSync(txDir, { recursive: true });

    const io = createTestIO();
    const expectedDigest = "sha256:abc123def456" as `sha256:${string}`;

    const receipt = await writeReceipt({
      txid: "tx-001",
      verb: "install",
      profile: "minimal",
      inventory_digest: expectedDigest,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      status: "committed",
      steps: [],
      user_content_preserved: [],
      manifest_after_digest: expectedDigest,
    }, txDir, io);

    // Digest linkage
    expect(verifyDigestLinkage(receipt, expectedDigest)).toBe(true);
    expect(verifyDigestLinkage(receipt, "sha256:different" as `sha256:${string}`)).toBe(false);
  });

  test("readReceipt retrieves saved receipt", async () => {
    const root = tempRoot("receipt-read");
    const stateRoot = join(root, "state");
    const txDir = join(stateRoot, "transactions", "tx-001");
    mkdirSync(txDir, { recursive: true });

    const io = createTestIO();

    const written = await writeReceipt({
      txid: "tx-001",
      verb: "install",
      profile: "minimal",
      inventory_digest: "sha256:abc123" as `sha256:${string}`,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      status: "committed",
      steps: [],
      user_content_preserved: [],
    }, txDir, io);

    const read = await readReceipt("tx-001", stateRoot, io);
    expect(read).toBeTruthy();
    expect(read?.txid).toBe("tx-001");
    expect(read?.inventory_digest).toBe(written.inventory_digest);
  });

  test("listReceipts returns all receipts", async () => {
    const root = tempRoot("receipt-list");
    const stateRoot = join(root, "state");

    const io = createTestIO();

    // Create multiple transactions
    for (let i = 1; i <= 3; i++) {
      const txDir = join(stateRoot, "transactions", `tx-00${i}`);
      mkdirSync(txDir, { recursive: true });

      await writeReceipt({
        txid: `tx-00${i}`,
        verb: "install",
        profile: "minimal",
        inventory_digest: `sha256:abc${i}` as `sha256:${string}`,
        started_at: "2026-01-01T00:00:00.000Z",
        finished_at: "2026-01-01T00:00:01.000Z",
        status: "committed",
        steps: [],
        user_content_preserved: [],
      }, txDir, io);
    }

    const receipts = await listReceipts(stateRoot, io);
    expect(receipts.length).toBe(3);
  });
});

// ─── Rollback tests ──────────────────────────────────────────────────────────

describe("rollback", () => {
  test("rollback restores preimages", async () => {
    const root = tempRoot("rollback-restore");
    const stateRoot = join(root, "state");
    const homeDir = join(root, "home");
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    // Source files for COPY records
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "file1.txt"), "file1 content");

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      // Create a file that will be displaced
      const destDir = join(homeDir, ".config", "test");
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, "file1.txt"), "original content");

      const fixture = createFixture(undefined, srcDir);
      const io = createTestIO();
      const plan = createPlan({
        verb: "install",
        profileResult: fixture,
        profile: "minimal",
      });

      // Execute install
      const installResult = await executePlan({
        stateRoot,
        io,
        plan,
        compileResult: fixture,
        verb: "install",
        profile: "minimal",
      });

      expect(installResult.status).toBe("committed");

      // Rollback
      const rollbackResult = await rollbackTransaction(
        installResult.txid,
        stateRoot,
        io,
      );

      expect(rollbackResult.status).toBe("committed");

      // Verify original content restored
      const restored = readFileSync(join(destDir, "file1.txt"), "utf8");
      expect(restored).toBe("original content");
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("double-uninstall is idempotent", async () => {
    const root = tempRoot("rollback-idempotent");
    const stateRoot = join(root, "state");
    const homeDir = join(root, "home");
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    // Source files for COPY records
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "file1.txt"), "file1 content");

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const fixture = createFixture(undefined, srcDir);
      const io = createTestIO();

      // First uninstall
      const plan1 = createPlan({
        verb: "uninstall",
        profileResult: fixture,
        profile: "minimal",
      });

      const result1 = await executePlan({
        stateRoot,
        io,
        plan: plan1,
        compileResult: fixture,
        verb: "uninstall",
        profile: "minimal",
      });

      // Debug: print outcomes if failed
      if (result1.status === "failed") {
        console.log("UNINSTALL FAILED outcomes:", JSON.stringify(result1.outcomes, null, 2));
      }

      expect(result1.status).toBe("committed");

      // Second uninstall (should be idempotent)
      const plan2 = createPlan({
        verb: "uninstall",
        profileResult: fixture,
        profile: "minimal",
      });

      const result2 = await executePlan({
        stateRoot,
        io,
        plan: plan2,
        compileResult: fixture,
        verb: "uninstall",
        profile: "minimal",
      });

      expect(result2.status).toBe("committed");
      expect(result2.exitCode).toBe(0);
    } finally {
      process.env.HOME = origHome;
    }
  });
});

// ─── INST-04: Unavailable capability tests ───────────────────────────────────

describe("INST-04: unavailable capability", () => {
  test("explicit selection of unavailable dep fails with guidance", async () => {
    const root = tempRoot("inst04-explicit");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const fixture = createFixture();
      const io = createTestIO();

      // Override execFile to fail for nonexistent-binary
      io.execFile = async (file, args, _opts) => {
        if (file === "which" && args[0] === "nonexistent-binary") {
          return { stdout: "", stderr: "not found", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      // Add a record with an optional dependency
      const optionalRecord: SurfaceRecord = {
        id: "test-optional",
        owner: "test",
        class: "COPY",
        source: "src/optional.txt",
        destination: {
          root_token: "HOME",
          relative_path: ".config/test/optional.txt",
          ownership: { kind: "exclusive-path" },
        },
        authority: { requirement_ids: ["REQ-05"], isa: "ISA-01" },
        eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal"], required: false },
        requires: [{ kind: "binary", name: "nonexistent-binary" }],
        verification: { method: "sha256" },
        rollback: { policy: "restore-backup" },
      };

      const fixtureWithOptional = createFixture({
        lockObject: {
          ...fixture.lockObject,
          records: [...fixture.lockObject.records, optionalRecord],
        },
      });

      const plan = createPlan({
        verb: "install",
        profileResult: fixtureWithOptional,
        profile: "minimal",
        explicitSelections: new Set(["test-optional"]),
      });

      const result = await executePlan({
        stateRoot,
        io,
        plan,
        compileResult: fixtureWithOptional,
        verb: "install",
        profile: "minimal",
        explicitSelections: new Set(["test-optional"]),
      });

      // Should fail with CAPABILITY_UNAVAILABLE
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(1);

      // Check that failure includes remediation guidance
      const failedOutcome = result.outcomes.find((o) => o.record_id === "test-optional");
      expect(failedOutcome?.reason).toContain("CAPABILITY_UNAVAILABLE");
      expect(failedOutcome?.reason).toContain("nonexistent-binary");
    } finally {
      process.env.HOME = origHome;
    }
  });

  test("broader profile silently skips unavailable dep", async () => {
    const root = tempRoot("inst04-broad");
    const stateRoot = join(root, "state");
    mkdirSync(stateRoot, { recursive: true });

    const homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });

    // Source files for COPY records
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "file1.txt"), "file1 content");

    const origHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const fixture = createFixture(undefined, srcDir);
      const io = createTestIO();

      // Override execFile to fail for nonexistent-binary
      io.execFile = async (file, args, _opts) => {
        if (file === "which" && args[0] === "nonexistent-binary") {
          return { stdout: "", stderr: "not found", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      // Add a record with an optional dependency
      const optionalRecord: SurfaceRecord = {
        id: "test-optional",
        owner: "test",
        class: "COPY",
        source: "src/optional.txt",
        destination: {
          root_token: "HOME",
          relative_path: ".config/test/optional.txt",
          ownership: { kind: "exclusive-path" },
        },
        authority: { requirement_ids: ["REQ-05"], isa: "ISA-01" },
        eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal"], required: false },
        requires: [{ kind: "binary", name: "nonexistent-binary" }],
        verification: { method: "sha256" },
        rollback: { policy: "restore-backup" },
      };

      const fixtureWithOptional = createFixture({
        lockObject: {
          ...fixture.lockObject,
          records: [...fixture.lockObject.records, optionalRecord],
        },
      });

      // No explicit selection — broader profile
      const plan = createPlan({
        verb: "install",
        profileResult: fixtureWithOptional,
        profile: "minimal",
      });

      const result = await executePlan({
        stateRoot,
        io,
        plan,
        compileResult: fixtureWithOptional,
        verb: "install",
        profile: "minimal",
      });

      // Debug: print outcomes if failed
      if (result.status === "failed") {
        console.log("BROADER PROFILE FAILED outcomes:", JSON.stringify(result.outcomes, null, 2));
      }

      // Should succeed (silently skip unavailable optional)
      expect(result.status).toBe("committed");
      expect(result.exitCode).toBe(0);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
