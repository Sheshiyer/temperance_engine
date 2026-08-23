import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "./canonical-json.ts";
import { compileFragments, writeLock, type CompileResult } from "./compile.ts";
import { runDoctor, runDoctorV2 } from "./doctor/orchestrator.ts";
import type { DoctorSectionId, V2_SectionId } from "./doctor/model.ts";
import { renderDoctorHuman } from "./doctor/render-human.ts";
import { renderDoctorJson } from "./doctor/render-json.ts";
import { loadLock } from "./load.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fragmentRoot = resolve(packageRoot, "fragments");
const lockPath = resolve(packageRoot, "install-surface-manifest.lock.json");

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
  process.stderr.write("usage: bun run src/cli.ts <compile|write-lock|doctor>\n");
  process.exitCode = 64;
}

await main();
