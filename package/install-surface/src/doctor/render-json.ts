import { canonical } from "../canonical-json.ts";
import type { DoctorReportV1 } from "./model.ts";

export function renderDoctorJson(report: DoctorReportV1): string {
  return canonical(report);
}
