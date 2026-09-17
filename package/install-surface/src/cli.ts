import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { canonical } from "./canonical-json.ts";
import { compileFragments, writeLock, type CompileResult } from "./compile.ts";
import { runDoctor, runDoctorV2 } from "./doctor/orchestrator.ts";
import type { DoctorSectionId, V2_SectionId } from "./doctor/model.ts";
import { renderDoctorHuman } from "./doctor/render-human.ts";
import { renderDoctorJson } from "./doctor/render-json.ts";
import { loadLock } from "./load.ts";
import { createPlan, type PlanOptions, type LifecycleVerb } from "./lifecycle/planner.ts";
import { executePlan, rollbackTransaction } from "./lifecycle/executor.ts";
import { readReceipt, listReceipts } from "./lifecycle/receipts.ts";
import type { LifecycleIO } from "./lifecycle/journal.ts";
import type { OnboardingCatalogV1, OnboardingProfileV1 } from "./onboarding/contracts.ts";
import { composeOnboardingProfile } from "./onboarding/composition.ts";
import {
  validateHostBindingV1,
  validateHostProfileV1,
  validateNineRouterGuidedSetupV1,
  validateProjectCapsuleV1,
} from "./onboarding/contract-schema.ts";
import { createCoreOnboardingCatalog, createCoreOnboardingProfile } from "./onboarding/core-catalog.ts";
import { projectOnboardingDoctorSection } from "./onboarding/doctor.ts";
import { createOnboardingPlan } from "./onboarding/planner.ts";
import { validateOnboardingCatalog, validateOnboardingProfile } from "./onboarding/schema.ts";
import { createSystemProbeAdapter } from "./onboarding/system-adapter.ts";
import { renderOnboardingText } from "./onboarding/presentation.ts";
import { discoverProjectCandidates } from "./onboarding/project-discovery.ts";
import { parseOnboardingArgs } from "./onboarding/cli-args.ts";
import { MacOsKeychainAdapter } from "./onboarding/keychain-adapter.ts";
import { NineRouterApiClient } from "./onboarding/nine-router-api.ts";
import { createNineRouterGuidedSetupPlanInput, prepareNineRouterGuidedSetupCatalog } from "./onboarding/nine-router-guided-setup.ts";
import { executeConfirmedNineRouterRepair } from "./onboarding/nine-router-repair.ts";
import { createFileOperationReceiptSink } from "./onboarding/operation-executor.ts";
import type { HostBindingV1, HostProfileV1, NineRouterGuidedSetupV1, ProjectCapsuleV1 } from "./onboarding/public-contracts.ts";
import { parseV4CutoverReviewArgs } from "./onboarding/v4-cutover-cli-args.ts";
import { parseV4CutoverApplyArgs } from "./onboarding/v4-cutover-apply-cli-args.ts";
import { hostIdentityMatches } from "./onboarding/host-identity.ts";
import type { V4CutoverPlan } from "../../router/v4-cutover-plan.ts";
import type { V4CutoverConfirmation, V4ReplacementProof } from "../../router/v4-cutover-executor.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fragmentRoot = resolve(packageRoot, "fragments");
const lockPath = resolve(packageRoot, "install-surface-manifest.lock.json");

// ─── Lifecycle IO (real filesystem) ──────────────────────────────────────────

const lifecycleIO: LifecycleIO = {
  mkdir: async (path, opts) => { mkdirSync(path, opts); },
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
  chmod: async (path, mode) => {
    const { chmodSync } = await import("node:fs");
    chmodSync(path, mode);
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
  writeFileAtomic: async (path, data, options) => {
    const { closeSync, fchmodSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } = await import("node:fs");
    const mode = options?.mode ?? 0o600;
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new Error("ATOMIC_WRITE_MODE_INVALID");
    const temporary = `${path}.temperance-write-${randomBytes(16).toString("hex")}.tmp`;
    let fd: number | undefined;
    let temporaryExists = false;
    try {
      fd = openSync(temporary, "wx", mode);
      temporaryExists = true;
      // open(2)'s creation mode is masked by the process umask. Apply the
      // reviewed final mode through the already-open descriptor before any
      // bytes are durable, so a restrictive caller umask cannot change a
      // lifecycle artifact or staged output's required mode.
      fchmodSync(fd, mode);
      const bytes = Buffer.from(data, "utf8");
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, path);
      temporaryExists = false;
      const directoryFd = openSync(dirname(path), "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (temporaryExists) {
        try { unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      }
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

function parseDoctorArgs(args: string[]): { sections?: DoctorSectionId[]; v2Sections?: V2_SectionId[]; json: boolean; verbose: boolean; stateRoot?: string; reportVersion: 1 | 2 } {
  const rawSections: string[] = [];
  let json = false;
  let verbose = false;
  let stateRoot: string | undefined;
  let reportVersion: 1 | 2 = 1;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") json = true;
    else if (argument === "--verbose") verbose = true;
    else if (argument === "--report") {
      const value = args[index += 1];
      if (value === "v2") reportVersion = 2;
      else if (value === "v1") reportVersion = 1;
      else throw new Error("DOCTOR_ARGUMENT_INVALID");
    } else if (argument === "--section") {
      const value = args[index += 1];
      if (!value) throw new Error("DOCTOR_ARGUMENT_INVALID");
      rawSections.push(value);
    } else if (argument === "--state-root") {
      const value = args[index += 1];
      if (!value) throw new Error("DOCTOR_ARGUMENT_INVALID");
      stateRoot = resolve(value);
    } else throw new Error("DOCTOR_ARGUMENT_INVALID");
  }

  // Validate sections based on report version
  if (reportVersion === 2) {
    const v2Sections: V2_SectionId[] = [];
    for (const section of rawSections) {
      if (!["install", "privacy", "manifest", "runtime", "host"].includes(section)) throw new Error("DOCTOR_ARGUMENT_INVALID");
      v2Sections.push(section as V2_SectionId);
    }
    return {
      v2Sections: v2Sections.length ? v2Sections : undefined,
      json,
      verbose,
      stateRoot,
      reportVersion,
    };
  } else {
    const sections: DoctorSectionId[] = [];
    for (const section of rawSections) {
      if (!["install", "privacy", "runtime"].includes(section)) throw new Error("DOCTOR_ARGUMENT_INVALID");
      sections.push(section as DoctorSectionId);
    }
    return {
      sections: sections.length ? sections : undefined,
      json,
      verbose,
      stateRoot,
      reportVersion,
    };
  }
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

function loadOnboardingJson<T>(path: string, validate: (value: unknown) => value is T, code: string): T {
  const value: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!validate(value)) throw new Error(code);
  return value;
}

function loadProjectCapsules(path: string | undefined): ProjectCapsuleV1[] {
  if (!path) return [];
  const value: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(value) || value.length > 1024 || !value.every(validateProjectCapsuleV1)) {
    throw new Error("PROJECT_CAPSULES_INVALID");
  }
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "cutover-apply") {
    try {
      const args = parseV4CutoverApplyArgs(process.argv.slice(3));
      const plan = JSON.parse(readFileSync(resolve(args.planPath), "utf8")) as V4CutoverPlan;
      const proof = JSON.parse(readFileSync(resolve(args.proofPath), "utf8")) as V4ReplacementProof;
      const confirmation = JSON.parse(readFileSync(resolve(args.confirmationPath), "utf8")) as V4CutoverConfirmation;
      const hostBinding = loadOnboardingJson<HostBindingV1>(
        args.hostBindingPath,
        validateHostBindingV1,
        "HOST_BINDING_INVALID",
      );
      const credentialReference = hostBinding.secret_references[args.legacyCredentialReferenceId];
      if (!credentialReference) throw new Error("CUTOVER_APPLY_KEYCHAIN_REFERENCE_MISSING");
      if (!hostBinding.host_identity) throw new Error("CUTOVER_APPLY_INTENDED_HOST_MISSING");
      const executable = (name: "env" | "bun" | "git" | "tar"): string => {
        const path = Bun.which(name);
        if (!path) throw new Error(`CUTOVER_APPLY_${name.toUpperCase()}_MISSING`);
        return path;
      };
      const { applyV4Cutover } = await import("../../router/v4-cutover-apply.ts");
      const receipt = await applyV4Cutover({
        plan,
        proof,
        confirmation,
        binding: {
          home_directory: homedir(),
          expected_host: hostBinding.host_identity,
          source_repository: resolve(args.sourceRepository),
          env_executable: executable("env"),
          node_executable: hostBinding.variables.NINE_ROUTER_NODE_EXECUTABLE ?? "",
          executable_path: hostBinding.variables.NINE_ROUTER_PATH ?? "",
          bun_executable: executable("bun"),
          git_executable: executable("git"),
          tar_executable: executable("tar"),
          data_directory: hostBinding.variables.NINE_ROUTER_DATA_DIR ?? "",
          log_directory: hostBinding.variables.NINE_ROUTER_LOG_DIR ?? "",
          cli_entrypoint: hostBinding.variables.NINE_ROUTER_CLI_ENTRYPOINT ?? "",
          health_url: hostBinding.variables.NINE_ROUTER_HEALTH_URL ?? "",
          legacy_credential_reference_id: args.legacyCredentialReferenceId,
          legacy_credential_reference: credentialReference,
        },
      });
      process.stdout.write(`${canonical(receipt)}\n`);
      process.exitCode = receipt.status === "committed" ? 0 : 1;
    } catch (error) {
      process.stderr.write(`temperance cutover-apply: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 64;
    }
    return;
  }
  if (command === "cutover-review") {
    try {
      const args = parseV4CutoverReviewArgs(process.argv.slice(3));
      const plan = JSON.parse(readFileSync(resolve(args.planPath), "utf8")) as V4CutoverPlan;
      const proof = JSON.parse(readFileSync(resolve(args.proofPath), "utf8")) as V4ReplacementProof;
      const hostBinding = loadOnboardingJson<HostBindingV1>(
        args.hostBindingPath,
        validateHostBindingV1,
        "HOST_BINDING_INVALID",
      );
      if (!hostBinding.host_identity) throw new Error("CUTOVER_REVIEW_INTENDED_HOST_MISSING");
      if (!hostIdentityMatches(hostBinding.host_identity, plan.host)) {
        throw new Error("CUTOVER_REVIEW_INTENDED_HOST_MISMATCH");
      }
      const { createV4CutoverViewModel } = await import("./onboarding/v4-cutover-review.ts");
      const view = createV4CutoverViewModel(plan, proof, hostBinding.host_identity);
      if (args.json) {
        process.stdout.write(`${canonical(view)}\n`);
      } else {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("CUTOVER_REVIEW_TUI_REQUIRES_TTY");
        const { runV4CutoverTui } = await import("./onboarding/v4-cutover-tui.ts");
        const confirmation = await runV4CutoverTui(view);
        if (confirmation) process.stdout.write(`${canonical(confirmation)}\n`);
      }
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`temperance cutover-review: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 64;
    }
    return;
  }
  if (command === "onboard") {
    try {
      const args = parseOnboardingArgs(process.argv.slice(3));
      const catalog = args.catalogPath
        ? loadOnboardingJson<OnboardingCatalogV1>(args.catalogPath, validateOnboardingCatalog, "ONBOARDING_CATALOG_INVALID")
        : createCoreOnboardingCatalog();
      const hostProfile = args.hostProfilePath
        ? loadOnboardingJson<HostProfileV1>(args.hostProfilePath, validateHostProfileV1, "HOST_PROFILE_INVALID")
        : undefined;
      const hostBinding = args.hostBindingPath
        ? loadOnboardingJson<HostBindingV1>(args.hostBindingPath, validateHostBindingV1, "HOST_BINDING_INVALID")
        : undefined;
      const projectCapsules = loadProjectCapsules(args.projectCapsulesPath);
      const profile = args.profilePath
        ? loadOnboardingJson<OnboardingProfileV1>(args.profilePath, validateOnboardingProfile, "ONBOARDING_PROFILE_INVALID")
        : hostProfile
          ? composeOnboardingProfile(
            hostProfile,
            hostBinding!,
            { projectCapsules },
          )
          : createCoreOnboardingProfile();
      const routerSetup = args.routerSetupPath
        ? loadOnboardingJson<NineRouterGuidedSetupV1>(args.routerSetupPath, validateNineRouterGuidedSetupV1, "NINE_ROUTER_SETUP_INVALID")
        : undefined;
      const plannedCatalog = routerSetup ? prepareNineRouterGuidedSetupCatalog(catalog, routerSetup, profile) : catalog;
      const discovery = hostProfile && hostBinding
        ? discoverProjectCandidates(hostProfile, hostBinding)
        : { candidates: [], findings: [] };
      const plan = await createOnboardingPlan({
        catalog: plannedCatalog,
        profile,
        adapter: createSystemProbeAdapter(),
        selections: args.selections,
        projectCandidates: discovery.candidates,
        projectDiscoveryFindings: discovery.findings,
        dryRun: !args.apply,
        configurationInputs: routerSetup ? [createNineRouterGuidedSetupPlanInput(routerSetup, profile)] : [],
      });
      if (args.apply && (plan.install_order.length !== 1 || plan.install_order[0] !== "provider.9router")) {
        throw new Error("NINE_ROUTER_REPAIR_SCOPE_INVALID");
      }
      if (args.doctor) {
        const section = projectOnboardingDoctorSection(plan);
        process.stdout.write(args.json ? canonical(section) : renderOnboardingText(plan));
        process.exitCode = section.condition === "PASS" || section.condition === "WARN" ? 0 : 1;
      } else if (args.tui || (!args.json && process.stdin.isTTY && process.stdout.isTTY)) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("ONBOARDING_TUI_REQUIRES_TTY");
        const { runOnboardingTui } = await import("./onboarding/tui.ts");
        const result = await runOnboardingTui(plan, {
          existingProjectCapsules: projectCapsules,
          allowProjectCapsuleSave: Boolean(args.projectCapsulesOutPath),
        });
        if (result.save_project_capsules) {
          const output = resolve(args.projectCapsulesOutPath!);
          mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
          await lifecycleIO.writeFileAtomic!(output, `${canonical(result.project_capsules)}\n`, { mode: 0o600 });
        }
        if (args.apply && result.confirmed) {
          if (!result.confirmed_at || !routerSetup) throw new Error("NINE_ROUTER_REPAIR_CONFIRMATION_INVALID");
          const dataDirectory = profile.variables.NINE_ROUTER_DATA_DIR;
          const healthUrl = profile.variables.NINE_ROUTER_HEALTH_URL;
          const entrypoint = profile.variables.NINE_ROUTER_CLI_ENTRYPOINT;
          if (!dataDirectory || !healthUrl || !entrypoint) throw new Error("NINE_ROUTER_REPAIR_BINDING_INCOMPLETE");
          const receipt = await executeConfirmedNineRouterRepair({
            plan,
            profile,
            confirmation: { confirmed: true, plan_digest: result.plan_digest, confirmed_at: result.confirmed_at },
            desired: routerSetup,
            api: new NineRouterApiClient({ dataDirectory, baseUrl: new URL(healthUrl).origin }),
            keychain: new MacOsKeychainAdapter(),
            executable: { id: "9router", path: entrypoint, version: "0.5.75" },
            receiptSink: createFileOperationReceiptSink(resolve(args.receiptDirectory!)),
          });
          process.stdout.write(`${canonical(receipt)}\n`);
          process.exitCode = receipt.status === "committed" ? 0 : 1;
        } else {
          process.exitCode = 0;
        }
      } else {
        process.stdout.write(args.json ? canonical(plan) : renderOnboardingText(plan));
        process.exitCode = 0;
      }
    } catch (error) {
      process.stderr.write(`temperance onboard: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 64;
    }
    return;
  }
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
      if (args.reportVersion === 2) {
        const compileResult = compileRepositoryFragments();
        const report = await runDoctorV2({
          repositoryRoot,
          stateRoot: args.stateRoot,
          sections: args.v2Sections,
          inventory: { digest: compileResult.digest },
        });
        process.stdout.write(args.json ? renderDoctorJson(report) : renderDoctorHuman(report, args.verbose));
        process.exitCode = report.exit_code;
      } else {
        const report = await runDoctor({ repositoryRoot, stateRoot: args.stateRoot, sections: args.sections });
        process.stdout.write(args.json ? renderDoctorJson(report) : renderDoctorHuman(report, args.verbose));
        process.exitCode = report.exit_code;
      }
    } catch {
      process.stderr.write("temperance doctor: invalid arguments; use --report v2, --section install|privacy|runtime|manifest|host, --json, or --verbose\n");
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
        explicitSelections: args.select
          ? new Set(args.select.split(",").filter((selection) => /^[a-z0-9][a-z0-9._-]*$/.test(selection)))
          : undefined,
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
        repositoryRoot,
        io: lifecycleIO,
        plan,
        compileResult,
        verb: command,
        profile,
        force: args.force,
        explicitSelections: planOptions.explicitSelections,
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
  onboard [--profile P | --host-profile P --host-binding B] [--catalog C] [--json|--doctor]
                                   Open generic TUI by default; Noesis is an explicit overlay
          [--project-capsules P --project-capsules-out P --tui]
                                   Review advisory candidates and explicitly save capsules
          --tui --repair --host-profile P --host-binding B --router-setup R
          --receipt-dir D --select provider.9router
                                   Confirm and apply one digest-bound 9Router repair transaction
  cutover-review --plan P --proof R --host-binding B [--tui|--json]
                                   Review plan + clean proof; TUI confirmation never mutates host state
  cutover-apply --plan P --proof R --confirmation C --host-binding B
          --legacy-credential-reference ID --source-repository S
                                   Consume external confirmation and perform destructive V4 cutover
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
