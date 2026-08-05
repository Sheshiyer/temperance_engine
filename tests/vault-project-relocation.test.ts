import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * CLI-level tests for scripts/vault-project-relocation.ts. `inventory` and
 * `plan --dry-run` are both contractually read-only (no mkdir, rename,
 * unlink, or Git-state-changing command — verified by the source guards in
 * package/relocation/project-relocation-source-guards.test.ts), so these
 * tests invoke the real CLI against the real vault paths rather than a
 * fixture — there is nothing to fixture: no destination directory is ever
 * created, and the only file written is the caller-supplied --output
 * report. Argument-validation cases never touch the filesystem at all.
 */

const REPO_ROOT = join(import.meta.dir, "..");
const SCRIPT = "scripts/vault-project-relocation.ts";
const REAL_CANARY_REPO =
  "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas";

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function outputPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "vault-relocation-cli-fixture-")), name);
}

describe("CLI argument validation — never touches the filesystem", () => {
  test("no arguments prints usage and exits 2", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("an unknown command prints usage and exits 2", () => {
    const result = runCli(["not-a-real-command"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("inventory with an unlisted portfolio name fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "not-a-real-portfolio", "--output", outputPath("r.json")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("portfolio_not_allowed");
  });

  test("inventory without --output fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "thoughtseed"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("two_portfolios_and_absolute_output_required");
  });

  test("plan without --dry-run fails closed — dry-run is mandatory, not optional", () => {
    const result = runCli([
      "plan",
      "--repository",
      REAL_CANARY_REPO,
      "--output",
      outputPath("p.json"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("plan_requires_absolute_repository_output_and_dry_run");
  });

  test("plan without --repository fails closed", () => {
    const result = runCli(["plan", "--dry-run", "--output", outputPath("p.json")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("plan_requires_absolute_repository_output_and_dry_run");
  });

  // apply and rollback are never invoked against a real path anywhere in
  // this file — only argument validation, which fails before either
  // command reads or writes anything.

  test("apply without --manifest-digest fails closed", () => {
    const result = runCli([
      "apply",
      "--repository",
      REAL_CANARY_REPO,
      "--lock",
      outputPath("lock"),
      "--receipt-output",
      outputPath("receipt.json"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apply_requires_absolute_repository_lock_receipt_output_and_manifest_digest");
  });

  test("apply without --repository fails closed", () => {
    const result = runCli([
      "apply",
      "--manifest-digest",
      "a".repeat(64),
      "--lock",
      outputPath("lock"),
      "--receipt-output",
      outputPath("receipt.json"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apply_requires_absolute_repository_lock_receipt_output_and_manifest_digest");
  });

  test("apply without --lock fails closed", () => {
    const result = runCli([
      "apply",
      "--repository",
      REAL_CANARY_REPO,
      "--manifest-digest",
      "a".repeat(64),
      "--receipt-output",
      outputPath("receipt.json"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apply_requires_absolute_repository_lock_receipt_output_and_manifest_digest");
  });

  test("apply without --receipt-output fails closed", () => {
    const result = runCli([
      "apply",
      "--repository",
      REAL_CANARY_REPO,
      "--manifest-digest",
      "a".repeat(64),
      "--lock",
      outputPath("lock"),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apply_requires_absolute_repository_lock_receipt_output_and_manifest_digest");
  });

  test("rollback without --receipt fails closed", () => {
    const result = runCli(["rollback"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rollback_requires_absolute_receipt_path");
  });

  test("rollback with a non-existent receipt fails closed with rollback_receipt_missing — proving no argument-validation gap lets an invalid path through to a real mutation attempt", () => {
    const result = runCli(["rollback", "--receipt", outputPath("never-written-receipt.json")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rollback_receipt_missing");
  });

  test("inventory with a non-numeric --max-depth fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "thoughtseed", "--output", outputPath("x.json"), "--max-depth", "abc"]);
    expect(result.status).not.toBe(0);
  });

  test("inventory with a negative --max-depth fails closed", () => {
    const result = runCli(["inventory", "--portfolio", "thoughtseed", "--output", outputPath("x.json"), "--max-depth", "-1"]);
    expect(result.status).not.toBe(0);
  });
});

describe("CLI inventory — real, read-only run against the actual vault", () => {
  test("produces a mode-0600 report with the documented schema", () => {
    const output = outputPath("inventory.json");
    const result = runCli(["inventory", "--portfolio", "thoughtseed", "--output", output]);

    expect(result.status).toBe(0);
    expect((statSync(output).mode & 0o777).toString(8)).toBe("600");

    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.schemaVersion).toBe(1);
    expect(report.readOnly).toBe(true);
    expect(report.approvedPortfolios).toEqual(["thoughtseed"]);
    expect(report.roots.thoughtseed.present).toBe(true);
    expect(Array.isArray(report.records)).toBe(true);
    expect(report.records.length).toBeGreaterThan(0);
    expect(typeof report.counts.total).toBe("number");
  });

  test("the already-approved canary appears as an unheld candidate", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    const canary = report.records.find((record: { name: string }) => record.name === "thoughtseed-brand-atlas");
    expect(canary).toBeDefined();
    expect(canary.disposition).toBe("candidate");
    expect(canary.holdReasons).toEqual([]);
  });

  test("omitting --max-depth reproduces today's exact depth-0-only shape", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    for (const record of report.records) {
      expect(record.depth).toBe(0);
      expect(record.immediateParentPath).toBeNull();
    }
  });

  test("--max-depth 0 explicitly is identical in shape to omitting it", () => {
    const output = outputPath("inventory.json");
    runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "0"]);
    const report = JSON.parse(readFileSync(output, "utf8"));

    for (const record of report.records) {
      expect(record.depth).toBe(0);
      expect(record.immediateParentPath).toBeNull();
    }
  });

  test(
    "--max-depth 5 discovers the real hermes-aws-ts candidate nested inside thoughtseed-labs",
    () => {
      const output = outputPath("inventory.json");
      runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "5"]);
      const report = JSON.parse(readFileSync(output, "utf8"));

      const hermes = report.records.find(
        (record: { name: string; path: string }) =>
          record.name === "hermes-aws-ts" && record.path.endsWith("thoughtseed-labs/hermes-aws-ts"),
      );
      expect(hermes).toBeDefined();
      expect(hermes.depth).toBeGreaterThan(0);
      expect(hermes.repositoryKind).toBe("standalone-repository");
    },
    30000,
  );

  test(
    "--max-depth 5 flags the real Archive/team-forge-ts collision against the real team-forge-ts",
    () => {
      const output = outputPath("inventory.json");
      runCli(["inventory", "--portfolio", "thoughtseed", "--output", output, "--max-depth", "5"]);
      const report = JSON.parse(readFileSync(output, "utf8"));

      const teamForgeCandidates = report.records.filter((record: { name: string }) => record.name === "team-forge-ts");
      expect(teamForgeCandidates.length).toBeGreaterThanOrEqual(2);
      for (const candidate of teamForgeCandidates) {
        expect(candidate.holdReasons.some((reason: string) => reason.startsWith("competing_candidate_claim:"))).toBe(true);
        expect(candidate.disposition).toBe("held");
      }
    },
    30000,
  );
});

describe("CLI plan --dry-run — real, read-only run against the actual canary", () => {
  test("produces a mode-0600 manifest with the documented schema and never authorizes apply", () => {
    const output = outputPath("plan.json");
    const result = runCli(["plan", "--repository", REAL_CANARY_REPO, "--dry-run", "--output", output]);

    expect(result.status).toBe(0);
    expect((statSync(output).mode & 0o777).toString(8)).toBe("600");

    const plan = JSON.parse(readFileSync(output, "utf8"));
    expect(plan.readOnly).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.manifestApprovalRequired).toBe(true);
    expect(plan.ready).toBe(false);
    expect(plan.source).toBe(REAL_CANARY_REPO);
    expect(plan.portfolio).toBe("thoughtseed");
    expect(plan.repository.repositoryKind).toBe("standalone-repository");
    expect(plan.packet.identityStatus).toBe("verified-teamforge");
    expect(plan.holdReasons).toEqual([]);
  });
});

describe("session-map subcommand — argument validation only", () => {
  test("missing --repository exits 2 with usage", () => {
    const result = spawnSync("bun", ["scripts/vault-project-relocation.ts", "session-map"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("relative --repository path is rejected without touching the filesystem", () => {
    const result = spawnSync(
      "bun",
      ["scripts/vault-project-relocation.ts", "session-map", "--repository", "relative/path"],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
  });

  // Unlike the two tests above (which only ever reach the generic
  // `usage()` fallback that any unrecognized subcommand also hits), this
  // case supplies an absolute --repository path that prefix-matches a real
  // PORTFOLIO_ROOTS entry, so inferPortfolio() succeeds and control reaches
  // the session-map branch's own registry lookup. The basename is a
  // clearly-synthetic, obviously-fake name (and must satisfy the canonical
  // lowercase-alphanumeric-and-hyphen basename grammar to get past
  // registryEntryPath()'s own validation before it can even ask whether an
  // entry.json exists) that has no entry.json on disk, so the existsSync
  // check fails and the branch throws its own
  // session_map_registry_entry_not_found error — a string that only that
  // logic can produce. The path is never created or touched; the code
  // never calls existsSync(repository) itself, only on the derived
  // registry entry path.
  test("--repository under a real portfolio root with no registry entry reaches the session-map branch's own registry lookup", () => {
    const result = spawnSync(
      "bun",
      [
        "scripts/vault-project-relocation.ts",
        "session-map",
        "--repository",
        "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/session-map-fix-test-nonexistent-repo",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("session_map_registry_entry_not_found");
  });
});
