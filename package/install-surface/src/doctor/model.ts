import type { Stats } from "node:fs";

import type { CompileResult } from "../compile.ts";
import {
  DOCTOR_REPORT_SCHEMA,
  DOCTOR_REPORT_SCHEMA_V2,
  type DoctorCheck,
  type DoctorCondition,
  type DoctorExitCode,
  type DoctorReportV2,
  type DoctorSection,
} from "../types.ts";

export { DOCTOR_REPORT_SCHEMA, DOCTOR_REPORT_SCHEMA_V2 };
export type { DoctorCheck, DoctorCondition, DoctorExitCode, DoctorReportV2, DoctorSection };

export const DOCTOR_SCHEMA = "temperance.doctor.report.v1" as const;
export const DOCTOR_SECTION_ORDER = ["install", "privacy", "runtime"] as const;
export type DoctorSectionId = (typeof DOCTOR_SECTION_ORDER)[number];

export const V2_DOCTOR_SCHEMA = "temperance.doctor.report.v2" as const;
export const V2_DOCTOR_SECTION_ORDER = ["install", "privacy", "manifest", "runtime", "host"] as const;
export type V2_SectionId = (typeof V2_DOCTOR_SECTION_ORDER)[number];

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
  runtimeUrls: { bridge: string; omniroute: string; console: string; auto_proxy: string; pulse: string };
  io: ObservationIO;
  signal: AbortSignal;
}

export type DoctorSectionRunner = (context: DoctorContext) => Promise<DoctorSection>;

export interface V2_DoctorScope {
  complete: boolean;
  requested_sections: V2_SectionId[];
}

export interface DoctorContextV2 extends DoctorContext {
  inventory: CompileResult;
}

export type V2_SectionRunner = (context: DoctorContextV2) => Promise<DoctorSection>;

export const V2_SECTION_RUNNERS: Record<V2_SectionId, V2_SectionRunner> = {} as Record<V2_SectionId, V2_SectionRunner>;
