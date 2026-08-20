import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "./canonical-json.ts";
import { compileFragments, writeLock, type CompileResult } from "./compile.ts";
import { runDoctor } from "./doctor/orchestrator.ts";
import type { DoctorSectionId } from "./doctor/model.ts";
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

function parseDoctorArgs(args: string[]): { sections?: DoctorSectionId[]; json: boolean; verbose: boolean; stateRoot?: string } {
  const sections: DoctorSectionId[] = [];
  let json = false;
  let verbose = false;
  let stateRoot: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") json = true;
    else if (argument === "--verbose") verbose = true;
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
  return { sections: sections.length ? sections : undefined, json, verbose, stateRoot };
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
      const report = await runDoctor({ repositoryRoot, stateRoot: args.stateRoot, sections: args.sections });
      process.stdout.write(args.json ? renderDoctorJson(report) : renderDoctorHuman(report, args.verbose));
      process.exitCode = report.exit_code;
    } catch {
      process.stderr.write("temperance doctor: invalid arguments; use --section install|privacy|runtime, --json, or --verbose\n");
      process.exitCode = 2;
    }
    return;
  }
  process.stderr.write("usage: bun run src/cli.ts <compile|write-lock|doctor>\n");
  process.exitCode = 64;
}

await main();
