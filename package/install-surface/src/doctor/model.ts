import type { Stats } from "node:fs";

import {
  DOCTOR_REPORT_SCHEMA,
  type DoctorCheck,
  type DoctorCondition,
  type DoctorExitCode,
  type DoctorSection,
} from "../types.ts";

export { DOCTOR_REPORT_SCHEMA };
export type { DoctorCheck, DoctorCondition, DoctorExitCode, DoctorSection };

export const DOCTOR_SCHEMA = "temperance.doctor.report.v1" as const;
export const DOCTOR_SECTION_ORDER = ["install", "privacy", "runtime"] as const;
export type DoctorSectionId = (typeof DOCTOR_SECTION_ORDER)[number];

export interface ObservationIO {
  readFile(path: string): Promise<string>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  fetch(url: string, options: { signal: AbortSignal }): Promise<Response>;
  execFile(file: string, args: readonly string[], options: { signal: AbortSignal }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  now(): Date;
}

export interface DoctorScope {
  complete: boolean;
  requested_sections: DoctorSectionId[];
}

export interface DoctorReportV1 {
  schema: typeof DOCTOR_SCHEMA;
  version: { major: 1; minor: 0 };
  generated_at: string;
  scope: DoctorScope;
  trustworthy: boolean;
  overall_condition: DoctorCondition;
  exit_code: DoctorExitCode;
  manifest_digest: `sha256:${string}`;
  sections: DoctorSection[];
}

export interface DoctorContext {
  repositoryRoot: string;
  stateRoot: string;
  platform: NodeJS.Platform;
  rootBindings: Readonly<Record<string, string>>;
  runtimeUrls: { bridge: string; omniroute: string };
  io: ObservationIO;
  signal: AbortSignal;
}

export type DoctorSectionRunner = (context: DoctorContext) => Promise<DoctorSection>;
