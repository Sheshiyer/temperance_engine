import { canonical } from "../canonical-json.ts";
import type { DoctorReportV1, DoctorReportV2 } from "./model.ts";

export function renderDoctorJson(report: DoctorReportV1 | DoctorReportV2): string {
  return canonical(report);
}
