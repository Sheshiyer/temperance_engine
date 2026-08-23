import type { DoctorCheck, DoctorReportV1, DoctorReportV2 } from "./model.ts";

function renderCheck(check: DoctorCheck): string[] {
  return [
    `  [${check.condition}] ${check.id} · ${check.reason_code}`,
    `    expected: ${check.expected_state}`,
    `    actual: ${check.actual_state}`,
    `    remediation: ${check.remediation}`,
  ];
}

export function renderDoctorHuman(report: DoctorReportV1 | DoctorReportV2, verbose = false): string {
  const digestLabel = "inventory_digest" in report
    ? `  inventory    ${report.inventory_digest}`
    : `  manifest     ${report.manifest_digest}`;
  const lines = [
    `TEMPERANCE DOCTOR · ${report.overall_condition}`,
    `  trustworthy  ${report.trustworthy}`,
    `  scope        ${report.scope.complete ? "complete" : `partial (${report.scope.requested_sections.join(",")})`}`,
    digestLabel,
    "SECTIONS",
    ...report.sections.map((section) => `  [${section.condition}] ${section.id} · ${section.checks.length} checks`),
  ];
  const findings = report.sections.flatMap((section) => section.checks)
    .filter((check) => check.actionable || ["FAIL", "DRIFT", "WARN", "UNAVAILABLE"].includes(check.condition));
  lines.push("FINDINGS");
  if (findings.length === 0) lines.push("  No actionable findings.");
  else for (const check of findings) lines.push(...renderCheck(check));
  if (verbose) {
    lines.push("VERBOSE PUBLIC-SAFE RECORDS");
    for (const check of report.sections.flatMap((section) => section.checks)) {
      lines.push(...renderCheck(check), `    source: ${check.source}`, `    destination: ${check.destination}`, `    evidence: ${check.evidence.join(",") || "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
