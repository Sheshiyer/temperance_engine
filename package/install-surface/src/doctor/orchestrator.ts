import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadLock } from "../load.ts";
import { validateDoctorReport } from "../schema.ts";
import {
  DOCTOR_SCHEMA,
  DOCTOR_SECTION_ORDER,
  type DoctorCondition,
  type DoctorContext,
  type DoctorReportV1,
  type DoctorSection,
  type DoctorSectionId,
  type DoctorSectionRunner,
  type ObservationIO,
} from "./model.ts";
import { runInstallSection } from "./sections/install.ts";
import { runPrivacySection } from "./sections/privacy.ts";
import { runRuntimeSection } from "./sections/runtime.ts";

const execFileAsync = promisify(execFile);
export const SECTION_TIMEOUTS_MS = { install: 2000, privacy: 750, runtime: 4000 } as const;

export const nodeObservationIO: ObservationIO = {
  readFile: (path) => readFile(path, "utf8"),
  lstat,
  realpath,
  fetch: (url, options) => fetch(url, options),
  execFile: async (file, args, options) => {
    const output = await execFileAsync(file, [...args], { signal: options.signal, encoding: "utf8" });
    return { stdout: output.stdout, stderr: output.stderr, exitCode: 0 };
  },
  now: () => new Date(),
};

const SECTION_RUNNERS: Record<DoctorSectionId, DoctorSectionRunner> = {
  install: runInstallSection,
  privacy: runPrivacySection,
  runtime: runRuntimeSection,
};

export interface RunDoctorOptions {
  repositoryRoot: string;
  stateRoot?: string;
  platform?: NodeJS.Platform;
  sections?: DoctorSectionId[];
  rootBindings?: Readonly<Record<string, string>>;
  runtimeUrls?: { bridge: string; omniroute: string };
  io?: ObservationIO;
  timeouts?: Partial<Record<DoctorSectionId, number>>;
  runners?: Partial<Record<DoctorSectionId, DoctorSectionRunner>>;
}

function unavailableSection(id: DoctorSectionId, reasonCode: string): DoctorSection {
  return {
    id,
    condition: "UNAVAILABLE",
    checks: [{
      id: `${id}-section`,
      source: `doctor:${id}`,
      destination: `doctor:${id}`,
      class: "RUNTIME",
      expected_state: "section completes within its budget",
      actual_state: "unavailable",
      condition: "UNAVAILABLE",
      reason_code: reasonCode,
      severity: "warning",
      actionable: true,
      remediation: `Run the focused ${id} doctor and inspect its bounded dependencies.`,
      evidence: [],
    }],
  };
}

async function runBounded(
  id: DoctorSectionId,
  runner: DoctorSectionRunner,
  baseContext: Omit<DoctorContext, "signal">,
  timeoutMs: number,
): Promise<DoctorSection> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DoctorSection>((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout(unavailableSection(id, "SECTION_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      runner({ ...baseContext, signal: controller.signal }).catch(() => unavailableSection(id, "SECTION_CRASH")),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function aggregate(sections: readonly DoctorSection[]): DoctorCondition {
  for (const condition of ["FAIL", "DRIFT", "WARN", "UNAVAILABLE"] as const) {
    if (sections.some((section) => section.condition === condition)) return condition;
  }
  return "PASS";
}

export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReportV1> {
  const requested = [...new Set(options.sections ?? [...DOCTOR_SECTION_ORDER])]
    .sort((left, right) => DOCTOR_SECTION_ORDER.indexOf(left) - DOCTOR_SECTION_ORDER.indexOf(right));
  const io = options.io ?? nodeObservationIO;
  const home = homedir();
  const stateRoot = options.stateRoot ?? resolve(home, ".temperance_engine");
  let manifestDigest: `sha256:${string}`;
  try {
    manifestDigest = loadLock(resolve(options.repositoryRoot, "package/install-surface/install-surface-manifest.lock.json")).digest;
  } catch {
    return {
      schema: DOCTOR_SCHEMA,
      version: { major: 1, minor: 0 },
      generated_at: io.now().toISOString(),
      scope: { complete: requested.length === 3, requested_sections: requested },
      trustworthy: false,
      overall_condition: "FAIL",
      exit_code: 2,
      manifest_digest: `sha256:${"0".repeat(64)}`,
      sections: [],
    };
  }

  const baseContext: Omit<DoctorContext, "signal"> = {
    repositoryRoot: options.repositoryRoot,
    stateRoot,
    platform: options.platform ?? process.platform,
    rootBindings: options.rootBindings ?? {
      CODEX_HOME: resolve(home, ".codex"),
      CLAUDE_CONFIG_DIR: resolve(home, ".claude"),
      HOME: home,
      TEMPERANCE_STATE: stateRoot,
    },
    runtimeUrls: options.runtimeUrls ?? {
      bridge: process.env.TEMPERANCE_MANIFEST_BRIDGE_URL ?? "http://127.0.0.1:8766",
      omniroute: process.env.TEMPERANCE_OMNIROUTE_URL ?? "http://127.0.0.1:20128",
    },
    io,
  };
  const sections = await Promise.all(requested.map((id) => runBounded(
    id,
    options.runners?.[id] ?? SECTION_RUNNERS[id],
    baseContext,
    options.timeouts?.[id] ?? SECTION_TIMEOUTS_MS[id],
  )));
  sections.sort((left, right) => DOCTOR_SECTION_ORDER.indexOf(left.id) - DOCTOR_SECTION_ORDER.indexOf(right.id));
  const overall = aggregate(sections);
  const report: DoctorReportV1 = {
    schema: DOCTOR_SCHEMA,
    version: { major: 1, minor: 0 },
    generated_at: io.now().toISOString(),
    scope: { complete: requested.length === 3, requested_sections: requested },
    trustworthy: true,
    overall_condition: overall,
    exit_code: overall === "PASS" ? 0 : 1,
    manifest_digest: manifestDigest,
    sections,
  };
  if (!validateDoctorReport(report)) throw new Error("DOCTOR_REPORT_SCHEMA_INVALID");
  return report;
}
