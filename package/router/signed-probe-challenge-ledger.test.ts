import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import {
  chmodSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  canonicalProbeJson,
  generateProbeKeyPairForFixture,
  loadProbeVerificationBundleFromEnv,
  signProbeReceipt,
  verifySignedProbeReceipt,
  SIGNED_PROBE_CLAIM_SCOPE,
  SIGNED_PROBE_DOES_NOT_ASSERT,
  SIGNED_PROBE_KIND,
  type UnsignedProbeReceipt,
} from "./signed-probe-receipt";
import {
  SIGNED_PROBE_CHALLENGE_LEDGER_KIND,
  SIGNED_PROBE_CHALLENGE_MAX_ENTRIES,
  consumeProbeChallenge,
  issueProbeChallenge,
  parseChallengeLedger,
  readChallengeLedgerStatus,
  recoverChallengeOperation,
  rollbackIssuedChallenge,
  type ChallengeEntry,
  type ChallengeLedger,
} from "./signed-probe-challenge-ledger";

const roots: string[] = [];
const controllerPath = resolve("package/router/signed-probe-challenge-ledger.ts");
const cliPath = resolve("scripts/signed-probe-challenge-ledger.ts");
const baseNow = Date.parse("2026-08-01T16:00:00.000Z");

function fixture(): { root: string; ledger: string; receipts: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "temperance-challenge-ledger-")));
  chmodSync(root, 0o700);
  roots.push(root);
  return { root, ledger: join(root, "ledger.json"), receipts: join(root, "receipts") };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root && root.startsWith(realpathSync(tmpdir())) && root.includes("temperance-challenge-ledger-")) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function mode(path: string): number {
  return lstatSync(path).mode & 0o777;
}

function operationReceipts(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".pre.json"))
    .map((name) => join(directory, name))
    .sort();
}

function readLedger(path: string): ChallengeLedger {
  const raw = readFileSync(path, "utf8");
  expect(canonicalProbeJson(JSON.parse(raw))).toBe(raw);
  return parseChallengeLedger(JSON.parse(raw));
}

function entry(index: number, overrides: Partial<ChallengeEntry> = {}): ChallengeEntry {
  return {
    keyId: `capacity-key-${index}`,
    challenge: index.toString(16).padStart(64, "0"),
    status: "issued",
    issuedAt: "2026-08-01T15:59:00.000Z",
    expiresAt: "2026-08-01T16:04:00.000Z",
    retainUntil: "2026-08-02T16:04:00.000Z",
    consumedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function writeLedger(path: string, entries: ChallengeEntry[], generation = 1): void {
  const state: ChallengeLedger = {
    schemaVersion: 1,
    kind: SIGNED_PROBE_CHALLENGE_LEDGER_KIND,
    generation,
    lastOperationId: `fixture-${generation}`,
    updatedAt: "2026-08-01T16:00:00.000Z",
    entries: [...entries].sort((left, right) => {
      const leftKey = `${left.keyId}:${left.challenge}`;
      const rightKey = `${right.keyId}:${right.challenge}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  };
  writeFileSync(path, canonicalProbeJson(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function signedReceipt(keyId: string, challenge: string): UnsignedProbeReceipt {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_KIND,
    surface: "cloudflare",
    claimScope: SIGNED_PROBE_CLAIM_SCOPE,
    disclaimerSchemaVersion: 1,
    doesNotAssert: [...SIGNED_PROBE_DOES_NOT_ASSERT],
    issuer: "fixture-issuer",
    keyId,
    audience: "fixture-audience",
    challenge,
    issuedAt: "2026-08-01T16:00:00.000Z",
    notBefore: "2026-08-01T16:00:00.000Z",
    expiresAt: "2026-08-01T16:05:00.000Z",
    payload: { accountId: "fixture-account" },
  };
}

describe("atomic signed-probe challenge ledger", () => {
  test("issues a canonical owner-only 256-bit challenge with durable receipt evidence", async () => {
    const paths = fixture();
    const result = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "probe-key-2026-08",
      nowMs: baseNow,
    });

    expect(result.challenge).toMatch(/^[a-f0-9]{64}$/);
    expect(result.authorizing).toBe(false);
    expect(result.generation).toBe(1);
    expect(result.expiresAt).toBe("2026-08-01T16:05:00.000Z");
    expect(mode(paths.root)).toBe(0o700);
    expect(mode(paths.ledger)).toBe(0o600);
    expect(mode(`${paths.ledger}.lock`)).toBe(0o600);
    expect(mode(paths.receipts)).toBe(0o700);
    expect(mode(result.receiptPath)).toBe(0o600);
    const state = readLedger(paths.ledger);
    expect(state.generation).toBe(1);
    expect(state.lastOperationId).toBe(result.operationId);
    expect(state.entries).toEqual([
      expect.objectContaining({
        keyId: "probe-key-2026-08",
        challenge: result.challenge,
        status: "issued",
      }),
    ]);
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt).toEqual(expect.objectContaining({
      status: "applied",
      operation: "issue",
      authorizing: false,
      pre: expect.objectContaining({ exists: false, generation: 0, hash: "absent" }),
      post: expect.objectContaining({ exists: true, generation: 1 }),
    }));
  });

  test("permits exactly one winner across concurrent CLI consumers", async () => {
    const paths = fixture();
    const issued = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "concurrency-key",
    });
    const processes = Array.from({ length: 12 }, () => Bun.spawn({
      cmd: [
        process.execPath,
        cliPath,
        "consume",
        "--ledger",
        paths.ledger,
        "--receipt-dir",
        paths.receipts,
        "--key-id",
        "concurrency-key",
        "--challenge",
        issued.challenge,
      ],
      stdout: "pipe",
      stderr: "pipe",
    }));
    const outcomes = await Promise.all(processes.map(async (child) => {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    }));
    const winners = outcomes.filter((outcome) => outcome.exitCode === 0);
    expect(winners).toHaveLength(1);
    expect(JSON.parse(winners[0].stdout)).toEqual(expect.objectContaining({
      status: "consumed",
      authorizing: false,
    }));
    expect(outcomes.filter((outcome) => outcome.exitCode !== 0)).toHaveLength(11);
    expect(outcomes.filter((outcome) => outcome.exitCode !== 0).every((outcome) =>
      outcome.stderr.includes("challenge-ledger-challenge-consumed")
    )).toBe(true);
    expect(readChallengeLedgerStatus(paths.ledger)).toEqual(expect.objectContaining({
      generation: 2,
      consumed: 1,
      issued: 0,
      authorizing: false,
    }));
  });

  test("makes consumption irreversible and rollback a monotonic issuance revocation", async () => {
    const revokedPaths = fixture();
    const issued = await issueProbeChallenge({
      ledgerPath: revokedPaths.ledger,
      receiptDirectory: revokedPaths.receipts,
      keyId: "rollback-key",
      nowMs: baseNow,
    });
    const revoked = await rollbackIssuedChallenge({
      operationReceiptPath: issued.receiptPath,
      receiptDirectory: revokedPaths.receipts,
      nowMs: baseNow + 1_000,
    });
    expect(revoked).toEqual(expect.objectContaining({ status: "revoked", generation: 2 }));
    expect(readLedger(revokedPaths.ledger).entries[0].status).toBe("revoked");
    await expect(consumeProbeChallenge({
      ledgerPath: revokedPaths.ledger,
      receiptDirectory: revokedPaths.receipts,
      keyId: "rollback-key",
      challenge: issued.challenge,
      nowMs: baseNow + 2_000,
    })).rejects.toThrow("challenge-ledger-challenge-revoked");
    await expect(rollbackIssuedChallenge({
      operationReceiptPath: issued.receiptPath,
      receiptDirectory: revokedPaths.receipts,
      nowMs: baseNow + 3_000,
    })).rejects.toThrow("challenge-ledger-rollback-drift");

    const consumedPaths = fixture();
    const issuedThenConsumed = await issueProbeChallenge({
      ledgerPath: consumedPaths.ledger,
      receiptDirectory: consumedPaths.receipts,
      keyId: "irreversible-key",
      nowMs: baseNow,
    });
    const consumed = await consumeProbeChallenge({
      ledgerPath: consumedPaths.ledger,
      receiptDirectory: consumedPaths.receipts,
      keyId: "irreversible-key",
      challenge: issuedThenConsumed.challenge,
      nowMs: baseNow + 1_000,
    });
    await expect(rollbackIssuedChallenge({
      operationReceiptPath: issuedThenConsumed.receiptPath,
      receiptDirectory: consumedPaths.receipts,
      nowMs: baseNow + 2_000,
    })).rejects.toThrow("challenge-ledger-rollback-drift");
    await expect(rollbackIssuedChallenge({
      operationReceiptPath: consumed.receiptPath,
      receiptDirectory: consumedPaths.receipts,
      nowMs: baseNow + 2_000,
    })).rejects.toThrow("challenge-ledger-rollback-source-not-applied-issue");
    expect(readLedger(consumedPaths.ledger).entries[0].status).toBe("consumed");
  });

  test("serializes rollback against consumption into exactly one terminal winner", async () => {
    const paths = fixture();
    const issued = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "rollback-consume-race",
    });
    const consume = Bun.spawn({
      cmd: [
        process.execPath,
        cliPath,
        "consume",
        "--ledger",
        paths.ledger,
        "--receipt-dir",
        paths.receipts,
        "--key-id",
        "rollback-consume-race",
        "--challenge",
        issued.challenge,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const rollback = Bun.spawn({
      cmd: [
        process.execPath,
        cliPath,
        "rollback",
        "--receipt",
        issued.receiptPath,
        "--receipt-dir",
        paths.receipts,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [consumeExit, rollbackExit] = await Promise.all([consume.exited, rollback.exited]);
    expect([consumeExit, rollbackExit].filter((code) => code === 0)).toHaveLength(1);
    const state = readLedger(paths.ledger);
    expect(["consumed", "revoked"]).toContain(state.entries[0].status);
    expect(state.entries[0].status).not.toBe("issued");
    const terminalReceipts = operationReceipts(paths.receipts)
      .map((path) => JSON.parse(readFileSync(path, "utf8")))
      .filter((receipt) => receipt.status === "applied");
    expect(terminalReceipts.every((receipt) => receipt.authorizing === false)).toBe(true);
  });

  test("recovers prepared receipts deterministically from exact pre or post generations", async () => {
    const prePaths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: prePaths.ledger,
      receiptDirectory: prePaths.receipts,
      keyId: "pre-crash-key",
      nowMs: baseNow,
      faultInjector(point) {
        if (point === "after-prepared-receipt-fsync") throw new Error("injected-pre-commit-crash");
      },
    })).rejects.toThrow("injected-pre-commit-crash");
    expect(readChallengeLedgerStatus(prePaths.ledger).exists).toBe(false);
    const preReceipt = operationReceipts(prePaths.receipts)[0];
    expect((await recoverChallengeOperation({ operationReceiptPath: preReceipt })).status).toBe("aborted");
    expect(JSON.parse(readFileSync(preReceipt, "utf8")).status).toBe("aborted");

    const postPaths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: postPaths.ledger,
      receiptDirectory: postPaths.receipts,
      keyId: "post-crash-key",
      nowMs: baseNow,
      faultInjector(point) {
        if (point === "after-ledger-directory-fsync") throw new Error("injected-post-commit-crash");
      },
    })).rejects.toThrow("injected-post-commit-crash");
    expect(readChallengeLedgerStatus(postPaths.ledger).generation).toBe(1);
    const postReceipt = operationReceipts(postPaths.receipts)[0];
    expect((await recoverChallengeOperation({ operationReceiptPath: postReceipt })).status).toBe("applied");
    expect(JSON.parse(readFileSync(postReceipt, "utf8")).status).toBe("applied");

    const renamePaths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: renamePaths.ledger,
      receiptDirectory: renamePaths.receipts,
      keyId: "rename-crash-key",
      nowMs: baseNow,
      faultInjector(point) {
        if (point === "after-ledger-rename") throw new Error("injected-post-rename-crash");
      },
    })).rejects.toThrow("injected-post-rename-crash");
    expect(readChallengeLedgerStatus(renamePaths.ledger).generation).toBe(1);
    const renameReceipt = operationReceipts(renamePaths.receipts)[0];
    expect((await recoverChallengeOperation({ operationReceiptPath: renameReceipt })).status).toBe("applied");
  });

  test("fails closed when ledger durability reports an error", async () => {
    const paths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "durability-failure-key",
      nowMs: baseNow,
      faultInjector(point) {
        if (point === "before-ledger-temp-fsync") {
          throw new Error("challenge-ledger-full-fsync-failed");
        }
      },
    })).rejects.toThrow("challenge-ledger-full-fsync-failed");
    expect(readChallengeLedgerStatus(paths.ledger).exists).toBe(false);
    const receipt = operationReceipts(paths.receipts)[0];
    expect(JSON.parse(readFileSync(receipt, "utf8")).status).toBe("prepared");
    expect((await recoverChallengeOperation({ operationReceiptPath: receipt })).status).toBe("aborted");
  });

  test("closing an unrelated lock descriptor cannot release the held flock", async () => {
    const paths = fixture();
    const contenderScript = join(paths.root, "lock-contender.ts");
    writeFileSync(contenderScript, `
      import { issueProbeChallenge } from ${JSON.stringify(controllerPath)};
      try {
        await issueProbeChallenge({
          ledgerPath: ${JSON.stringify(paths.ledger)},
          receiptDirectory: ${JSON.stringify(paths.receipts)},
          keyId: "contender-key",
          lockTimeoutMs: 100,
        });
        process.exit(2);
      } catch (error) {
        process.exit(error instanceof Error && error.message === "challenge-ledger-lock-timeout" ? 0 : 3);
      }
    `, { mode: 0o600 });
    let contenderRejected = false;
    const issued = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "held-lock-key",
      faultInjector(point) {
        if (point !== "after-prepared-receipt-fsync") return;
        const unrelated = openSync(`${paths.ledger}.lock`, "r");
        closeSync(unrelated);
        contenderRejected = spawnSync(process.execPath, [contenderScript]).status === 0;
      },
    });
    expect(contenderRejected).toBe(true);
    expect(issued.generation).toBe(1);
    expect(readChallengeLedgerStatus(paths.ledger)).toEqual(expect.objectContaining({
      generation: 1,
      issued: 1,
    }));
  });

  test("releases the advisory lock after SIGKILL and finalizes the durable post-state", async () => {
    const paths = fixture();
    const childScript = join(paths.root, "kill-after-commit.ts");
    const sleeperPidPath = join(paths.root, "sleeper.pid");
    writeFileSync(childScript, `
      import { writeFileSync } from "node:fs";
      import { issueProbeChallenge } from ${JSON.stringify(controllerPath)};
      await issueProbeChallenge({
        ledgerPath: ${JSON.stringify(paths.ledger)},
        receiptDirectory: ${JSON.stringify(paths.receipts)},
        keyId: "sigkill-key",
        faultInjector(point) {
          if (point === "after-ledger-directory-fsync") {
            const sleeper = Bun.spawn({ cmd: ["/bin/sleep", "10"] });
            writeFileSync(${JSON.stringify(sleeperPidPath)}, String(sleeper.pid));
            process.kill(process.pid, "SIGKILL");
          }
        },
      });
    `, { mode: 0o600 });
    const child = Bun.spawn({ cmd: [process.execPath, childScript], stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).not.toBe(0);
    expect(readChallengeLedgerStatus(paths.ledger).generation).toBe(1);
    const receipt = operationReceipts(paths.receipts)[0];
    expect(JSON.parse(readFileSync(receipt, "utf8")).status).toBe("prepared");
    const sleeperPid = Number(readFileSync(sleeperPidPath, "utf8"));
    try {
      const recovered = await recoverChallengeOperation({
        operationReceiptPath: receipt,
        lockTimeoutMs: 500,
      });
      expect(recovered.status).toBe("applied");
    } finally {
      try {
        process.kill(sleeperPid, "SIGTERM");
      } catch {
        // The exact fixture child may already have exited.
      }
    }
    const second = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "after-sigkill-key",
    });
    expect(second.generation).toBe(2);
  });

  test("serializes concurrent recovery and finalizes a prepared receipt once", async () => {
    const paths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId: "concurrent-recovery-key",
      faultInjector(point) {
        if (point === "after-ledger-directory-fsync") throw new Error("prepared-post-state");
      },
    })).rejects.toThrow("prepared-post-state");
    const receipt = operationReceipts(paths.receipts)[0];
    const recover = () => Bun.spawn({
      cmd: [process.execPath, cliPath, "recover", "--receipt", receipt],
      stdout: "pipe",
      stderr: "pipe",
    });
    const firstWave = Array.from({ length: 12 }, recover);
    const firstExits = await Promise.all(firstWave.map((child) => child.exited));
    expect(firstExits.every((code) => code === 0)).toBe(true);
    expect(JSON.parse(readFileSync(receipt, "utf8")).status).toBe("applied");
    const finalizedBytes = readFileSync(receipt, "utf8");
    const secondWave = Array.from({ length: 4 }, recover);
    const secondExits = await Promise.all(secondWave.map((child) => child.exited));
    expect(secondExits.every((code) => code === 0)).toBe(true);
    expect(readFileSync(receipt, "utf8")).toBe(finalizedBytes);
  });

  test("rejects symlinked parents, targets, locks, hardlinks, and broad modes", async () => {
    const traversalPaths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: `${traversalPaths.root}/unused/../ledger.json`,
      receiptDirectory: traversalPaths.receipts,
      keyId: "ledger-traversal-key",
    })).rejects.toThrow("challenge-ledger-path-noncanonical");
    await expect(issueProbeChallenge({
      ledgerPath: traversalPaths.ledger,
      receiptDirectory: `${traversalPaths.root}/unused/../receipts`,
      keyId: "receipt-traversal-key",
    })).rejects.toThrow("challenge-ledger-path-noncanonical");
    const canonicalIssue = await issueProbeChallenge({
      ledgerPath: traversalPaths.ledger,
      receiptDirectory: traversalPaths.receipts,
      keyId: "receipt-load-traversal-key",
    });
    await expect(recoverChallengeOperation({
      operationReceiptPath:
        `${traversalPaths.receipts}/unused/../${basename(canonicalIssue.receiptPath)}`,
    })).rejects.toThrow("challenge-ledger-path-noncanonical");

    const parentPaths = fixture();
    const actual = join(parentPaths.root, "actual");
    mkdirSync(actual, { mode: 0o700 });
    const linkedParent = join(parentPaths.root, "linked-parent");
    symlinkSync(actual, linkedParent);
    await expect(issueProbeChallenge({
      ledgerPath: join(linkedParent, "ledger.json"),
      receiptDirectory: join(parentPaths.root, "receipts"),
      keyId: "symlink-parent-key",
    })).rejects.toThrow("challenge-ledger-directory-symlink-invalid");

    const targetPaths = fixture();
    const outside = join(targetPaths.root, "outside.json");
    writeFileSync(outside, "outside", { mode: 0o600 });
    symlinkSync(outside, targetPaths.ledger);
    await expect(issueProbeChallenge({
      ledgerPath: targetPaths.ledger,
      receiptDirectory: targetPaths.receipts,
      keyId: "symlink-target-key",
    })).rejects.toThrow("challenge-ledger-open-failed");
    expect(readFileSync(outside, "utf8")).toBe("outside");

    const lockPaths = fixture();
    symlinkSync(outside, `${lockPaths.ledger}.lock`);
    await expect(issueProbeChallenge({
      ledgerPath: lockPaths.ledger,
      receiptDirectory: lockPaths.receipts,
      keyId: "symlink-lock-key",
    })).rejects.toThrow("challenge-ledger-lock-open-failed");

    const hardlinkPaths = fixture();
    await issueProbeChallenge({
      ledgerPath: hardlinkPaths.ledger,
      receiptDirectory: hardlinkPaths.receipts,
      keyId: "hardlink-key",
    });
    linkSync(hardlinkPaths.ledger, join(hardlinkPaths.root, "ledger-hardlink.json"));
    expect(() => readChallengeLedgerStatus(hardlinkPaths.ledger)).toThrow("challenge-ledger-hardlink-invalid");

    const modePaths = fixture();
    await issueProbeChallenge({
      ledgerPath: modePaths.ledger,
      receiptDirectory: modePaths.receipts,
      keyId: "mode-key",
    });
    chmodSync(modePaths.ledger, 0o644);
    expect(() => readChallengeLedgerStatus(modePaths.ledger)).toThrow("challenge-ledger-file-mode-invalid");

    const tempPaths = fixture();
    await expect(issueProbeChallenge({
      ledgerPath: tempPaths.ledger,
      receiptDirectory: tempPaths.receipts,
      keyId: "symlink-temp-key",
      faultInjector(point) {
        if (point === "after-prepared-receipt-fsync") throw new Error("leave-prepared-temp-name");
      },
    })).rejects.toThrow("leave-prepared-temp-name");
    const preparedReceiptPath = operationReceipts(tempPaths.receipts)[0];
    const preparedReceipt = JSON.parse(readFileSync(preparedReceiptPath, "utf8"));
    const outsideTemp = join(tempPaths.root, "outside-temp");
    writeFileSync(outsideTemp, "unchanged", { mode: 0o600 });
    symlinkSync(outsideTemp, join(tempPaths.root, preparedReceipt.ledgerTempName));
    await expect(recoverChallengeOperation({
      operationReceiptPath: preparedReceiptPath,
    })).rejects.toThrow("challenge-ledger-relative-target-invalid");
    expect(readFileSync(outsideTemp, "utf8")).toBe("unchanged");
  });

  test("retains every fresh tombstone and prunes only after the bounded recovery window", async () => {
    const fullPaths = fixture();
    writeLedger(
      fullPaths.ledger,
      Array.from({ length: SIGNED_PROBE_CHALLENGE_MAX_ENTRIES }, (_, index) => entry(index)),
    );
    mkdirSync(fullPaths.receipts, { mode: 0o700 });
    await expect(issueProbeChallenge({
      ledgerPath: fullPaths.ledger,
      receiptDirectory: fullPaths.receipts,
      keyId: "capacity-overflow-key",
      nowMs: baseNow,
    })).rejects.toThrow("challenge-ledger-capacity-entries-exhausted");
    expect(readLedger(fullPaths.ledger).entries).toHaveLength(SIGNED_PROBE_CHALLENGE_MAX_ENTRIES);

    const prunePaths = fixture();
    writeLedger(prunePaths.ledger, [entry(1, {
      issuedAt: "2026-08-01T15:50:00.000Z",
      expiresAt: "2026-08-01T15:55:00.000Z",
      retainUntil: "2026-08-01T15:57:00.000Z",
    })]);
    const issued = await issueProbeChallenge({
      ledgerPath: prunePaths.ledger,
      receiptDirectory: prunePaths.receipts,
      keyId: "after-prune-key",
      nowMs: baseNow,
    });
    const state = readLedger(prunePaths.ledger);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].challenge).toBe(issued.challenge);
  });

  test("loads controller state as a non-authorizing verifier snapshot", async () => {
    const paths = fixture();
    const keyId = "verifier-key";
    const issued = await issueProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId,
      nowMs: baseNow,
    });
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receiptPath = join(paths.root, "signed-receipt.json");
    const publicKeyPath = join(paths.root, "public-key.pem");
    writeFileSync(
      receiptPath,
      canonicalProbeJson(signProbeReceipt(signedReceipt(keyId, issued.challenge), privateKey)),
      { mode: 0o600 },
    );
    writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    chmodSync(receiptPath, 0o600);
    chmodSync(publicKeyPath, 0o600);
    const env = {
      TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
      TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY: publicKeyPath,
      TEMPERANCE_SIGNED_PROBE_LEDGER: paths.ledger,
      TEMPERANCE_SIGNED_PROBE_ISSUER: "fixture-issuer",
      TEMPERANCE_SIGNED_PROBE_KEY_ID: keyId,
      TEMPERANCE_SIGNED_PROBE_AUDIENCE: "fixture-audience",
      TEMPERANCE_SIGNED_PROBE_CHALLENGE: issued.challenge,
    };
    const openBundle = loadProbeVerificationBundleFromEnv("cloudflare", env)!;
    const open = verifySignedProbeReceipt(openBundle.receipt, {
      ...openBundle.verification,
      nowMs: baseNow + 1_000,
    });
    expect(open.replayState).toEqual({
      status: "open",
      observedAt: "2026-08-01T16:00:01.000Z",
      authorizing: false,
    });
    await consumeProbeChallenge({
      ledgerPath: paths.ledger,
      receiptDirectory: paths.receipts,
      keyId,
      challenge: issued.challenge,
      nowMs: baseNow + 2_000,
    });
    const consumedBundle = loadProbeVerificationBundleFromEnv("cloudflare", env)!;
    const consumed = verifySignedProbeReceipt(consumedBundle.receipt, {
      ...consumedBundle.verification,
      nowMs: baseNow + 3_000,
    });
    expect(consumed.replayState.status).toBe("consumed");
    expect(consumed.replayState.authorizing).toBe(false);
  });

  test("limits the controller to its CLI and the isolated production anti-replay adapter", () => {
    for (const path of [
      "package/router/omniroute-promotion.ts",
      "package/router/multi-backend-router.sh",
      "scripts/temperance-routing-policy.sh",
    ]) {
      const source = readFileSync(resolve(path), "utf8");
      expect(source).not.toContain("signed-probe-challenge-ledger");
      expect(source).not.toContain("consumeProbeChallenge");
    }
    const productionConsumers = spawnSync(
      "rg",
      [
        "-l",
        "issueProbeChallenge|consumeProbeChallenge|rollbackIssuedChallenge|recoverChallengeOperation",
        "package",
        "scripts",
        "--glob",
        "*.ts",
        "--glob",
        "!*.test.ts",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    expect(productionConsumers.status).toBe(0);
    expect(productionConsumers.stdout.trim().split("\n").sort()).toEqual([
      "package/router/omniroute-cloudflare-production-adapter.ts",
      "package/router/signed-probe-challenge-ledger.ts",
      "scripts/signed-probe-challenge-ledger.ts",
    ]);
    const genericPromotionCli = readFileSync(resolve("scripts/omniroute-cloudflare-promotion.ts"), "utf8");
    expect(genericPromotionCli).not.toContain("omniroute-cloudflare-production-adapter");
    expect(genericPromotionCli).not.toContain("signed-probe-challenge-ledger");
    const cliInvocations = spawnSync(
      "rg",
      [
        "-l",
        "signed-probe-challenge-ledger\\.ts",
        "package",
        "scripts",
        "--glob",
        "!*.test.ts",
        "--glob",
        "!verify-all.sh",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    expect(cliInvocations.status).toBe(0);
    expect(cliInvocations.stdout.trim()).toBe("scripts/signed-probe-challenge-ledger.ts");
  });
});
