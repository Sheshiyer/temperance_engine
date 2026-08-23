import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "./canonical-json.ts";
import { compileFragments, writeLock, type CompileResult } from "./compile.ts";
import { runDoctor } from "./doctor/orchestrator.ts";
import type { DoctorSectionId } from "./doctor/model.ts";
import { renderDoctorHuman } from "./doctor/render-human.ts";
import { renderDoctorJson } from "./doctor/render-json.ts";
import { loadLock } from "./load.ts";
import { createPlan, type PlanOptions, type LifecycleVerb } from "./lifecycle/planner.ts";
import { executePlan, rollbackTransaction } from "./lifecycle/executor.ts";
import { readReceipt, listReceipts } from "./lifecycle/receipts.ts";
import type { LifecycleIO } from "./lifecycle/journal.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fragmentRoot = resolve(packageRoot, "fragments");
const lockPath = resolve(packageRoot, "install-surface-manifest.lock.json");

// ─── Lifecycle IO (real filesystem) ──────────────────────────────────────────

const lifecycleIO: LifecycleIO = {
  mkdir: async (path, opts) => mkdirSync(path, opts),
  writeFile: async (path, data) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, data, "utf8");
  },
  readFile: async (path) => readFileSync(path, "utf8"),
  readdir: async (path) => readdirSync(path),
  rm: async (path, opts) => {
    const { rmSync } = await import("node:fs");
    rmSync(path, opts);
  },
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
  now: () => new Date(),
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
  fetch: async (url, options) => fetch(url, options),
  execFile: async (file, args, options) => {
    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFileCb);
    try {
      const result = await execFileAsync(file, [...args], { signal: options.signal, encoding: "utf8" });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error: any) {
      return { stdout: error.stdout || "", stderr: error.stderr || "", exitCode: error.code || 1 };
    }
  },
};

// ─── State root ──────────────────────────────────────────────────────────────

function getStateRoot(): string {
  return process.env.TEMPERANCE_STATE || resolve(process.env.HOME || "/tmp", ".temperance");
}

// ─── Compile ─────────────────────────────────────────────────────────────────

function compileRepositoryFragments(): CompileResult {
  const inputs = readdirSync(fragmentRoot)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      contents: readFileSync(resolve(fragmentRoot, name), "utf8"),
    }));
  return compileFragments(inputs, {
    isaText: readFileSync(resolve(repositoryRoot, "ISA.md"), "utf8"),
    requirementsText: readFileSync(resolve(repositoryRoot, ".planning/REQUIREMENTS.md"), "utf8"),
    priorLock: existsSync(lockPath) ? loadLock(lockPath).lockObject : undefined,
  });
}

function printReceipt(result: CompileResult): void {
  process.stdout.write(canonical({
    digest: result.digest,
    semantic_ids: result.semanticIds,
  }));
}

// ─── Doctor args ─────────────────────────────────────────────────────────────

function parseDoctorArgs(args: string[]): { sections?: DoctorSectionId[]; json: boolean; verbose: boolean; stateRoot?: string; report?: string } {
  const sections: DoctorSectionId[] = [];
  let json = false;
  let verbose = false;
  let stateRoot: string | undefined;
  let report: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") json = true;
    else if (argument === "--verbose") verbose = true;
    else if (argument === "--report") {
      report = args[index += 1];
    }
    else if (argument === "--section") {
      const value = args[index += 1];
      if (!value || !["install", "privacy", "runtime"].includes(value)) throw new Error("DOCTOR_ARGUMENT_INVALID");
      sections.push(value as DoctorSectionId);
    } else if (argument === "--state-root") {
      const value = args[index += 1];
      if (!value) throw new Error("DOCTOR_ARGUMENT_INVALID");
      stateRoot = resolve(value);
    } else throw new Error("DOCTOR_ARGUMENT_INVALID");
  }
  return { sections: sections.length ? sections : undefined, json, verbose, stateRoot, report };
}

// ─── Lifecycle verb args ─────────────────────────────────────────────────────

function parseLifecycleArgs(args: string[]): {
  profile?: string;
  dryRun: boolean;
  force: boolean;
  select?: string;
  json: boolean;
} {
  let profile: string | undefined;
  let dryRun = false;
  let force = false;
  let select: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--profile") {
      profile = args[index += 1];
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--force") {
      force = true;
    } else if (argument === "--select") {
      select = args[index += 1];
    } else if (argument === "--json") {
      json = true;
    }
  }

  return { profile, dryRun, force, select, json };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "compile") {
    printReceipt(compileRepositoryFragments());
    return;
  }

  if (command === "write-lock") {
    const result = compileRepositoryFragments();
    writeLock(lockPath, result.canonicalBytes);
    printReceipt(result);
    return;
  }

  if (command === "doctor") {
    try {
      const args = parseDoctorArgs(process.argv.slice(3));
      const report = await runDoctor({ repositoryRoot, stateRoot: args.stateRoot, sections: args.sections });
      process.stdout.write(args.json ? renderDoctorJson(report) : renderDoctorHuman(report, args.verbose));
      process.exitCode = report.exit_code;
    } catch {
      process.stderr.write("temperance doctor: invalid arguments; use --section install|privacy|runtime, --json, or --verbose\n");
      process.exitCode = 2;
    }
    return;
  }

  // ─── Lifecycle verbs ─────────────────────────────────────────────────────

  if (command === "install" || command === "update" || command === "uninstall") {
    const args = parseLifecycleArgs(process.argv.slice(3));
    const profile = args.profile || "minimal";
    const stateRoot = getStateRoot();

    try {
      const compileResult = compileRepositoryFragments();

      // Check for NO_APPLICABLE_RECORDS
      const applicableRecords = compileResult.lockObject.records.filter(
        (r) => r.class !== "NEVER-SHIP" && r.eligibility.profiles.includes(profile),
      );

      if (applicableRecords.length === 0) {
        process.stderr.write(`temperance ${command}: NO_APPLICABLE_RECORDS for profile '${profile}'\n`);
        process.exitCode = 2;
        return;
      }

      const planOptions: PlanOptions = {
        verb: command as LifecycleVerb,
        profileResult: compileResult,
        profile,
        force: args.force,
      };

      const plan = createPlan(planOptions);

      // Dry run: print plan without writes
      if (args.dryRun) {
        process.stdout.write(canonical({
          verb: command,
          profile,
          steps: plan.steps.map((s) => ({
            step_id: s.step_id,
            record_id: s.record_id,
            destination_symbolic: `$${s.destination.root_token}/${s.destination.relative_path}`,
            mode: s.mode,
          })),
          outcomes: plan.outcomes,
          inventory_digest: compileResult.digest,
        }));
        process.exitCode = 0;
        return;
      }

      const result = await executePlan({
        stateRoot,
        io: lifecycleIO,
        plan,
        compileResult,
        verb: command,
        profile,
        force: args.force,
        signal: new AbortController().signal,
      });

      if (args.json) {
        process.stdout.write(canonical(result));
      } else {
        process.stdout.write(`Transaction ${result.txid}: ${result.status}\n`);
        for (const outcome of result.outcomes) {
          process.stdout.write(`  ${outcome.record_id}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}\n`);
        }
      }

      process.exitCode = result.exitCode;
    } catch (error) {
      process.stderr.write(`temperance ${command}: ${error}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "rollback") {
    const args = parseLifecycleArgs(process.argv.slice(3));
    if (!args.select) {
      process.stderr.write("temperance rollback: --select <txid> required\n");
      process.exitCode = 64;
      return;
    }

    const stateRoot = getStateRoot();

    try {
      const result = await rollbackTransaction(args.select, stateRoot, lifecycleIO);

      if (args.json) {
        process.stdout.write(canonical(result));
      } else {
        process.stdout.write(`Transaction ${result.txid}: ${result.status}\n`);
      }

      process.exitCode = result.exitCode;
    } catch (error) {
      process.stderr.write(`temperance rollback: ${error}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "receipt") {
    const args = parseLifecycleArgs(process.argv.slice(3));
    const stateRoot = getStateRoot();

    try {
      if (args.select) {
        const receipt = await readReceipt(args.select, stateRoot, lifecycleIO);
        if (!receipt) {
          process.stderr.write(`temperance receipt: transaction ${args.select} not found\n`);
          process.exitCode = 1;
          return;
        }

        process.stdout.write(canonical(receipt));
      } else {
        const receipts = await listReceipts(stateRoot, lifecycleIO);
        if (args.json) {
          process.stdout.write(canonical(receipts));
        } else {
          for (const { txid, receipt } of receipts) {
            process.stdout.write(`${txid}: ${receipt.status} (${receipt.verb} ${receipt.profile})\n`);
          }
        }
      }

      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`temperance receipt: ${error}\n`);
      process.exitCode = 1;
    }
    return;
  }

  // ─── Usage ───────────────────────────────────────────────────────────────

  process.stderr.write(`usage: temperance <command> [options]

Commands:
  compile                          Compile fragments and print receipt
  write-lock                       Compile and write lock file
  doctor [--section S] [--json]    Run doctor checks
  install [--profile P] [--dry-run] [--force]  Install records
  update [--profile P] [--dry-run]             Update records
  uninstall [--profile P] [--dry-run]          Uninstall records
  rollback --select <txid>                     Rollback transaction
  receipt [--select <txid>] [--json]           View receipts
`);
  process.exitCode = 64;
}

await main();
