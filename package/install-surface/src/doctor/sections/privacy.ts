import { observePrivateRegistry } from "../../private-registry.ts";
import type { DoctorCheck, DoctorContext, DoctorSection } from "../model.ts";

export async function runPrivacySection(context: DoctorContext): Promise<DoctorSection> {
  const registry = observePrivateRegistry(context.stateRoot);
  const checks: DoctorCheck[] = registry.records.map((record) => ({
    id: record.id,
    source: `private-registry:${record.id}`,
    destination: `private-overlay:${record.id}`,
    class: "NEVER-SHIP",
    expected_state: record.enabled ? "enabled private overlay" : "disabled private overlay",
    actual_state: record.presence,
    condition: record.condition,
    reason_code: record.condition === "PRIVATE" ? "PRIVATE_OVERLAY_PRESENT" : record.condition === "WARN" ? "PRIVATE_OVERLAY_MISSING" : "PRIVATE_OVERLAY_SKIPPED",
    severity: record.condition === "WARN" ? "warning" : "info",
    actionable: record.condition === "WARN",
    remediation: record.condition === "WARN" ? "Restore the private binding or disable its host-owned registry record." : "None.",
    evidence: [record.policy_rule],
  }));
  if (checks.length === 0) {
    checks.push({
      id: "private-registry",
      source: "private-registry:symbolic",
      destination: "private-overlay:symbolic",
      class: "NEVER-SHIP",
      expected_state: "absent or valid host-owned registry",
      actual_state: registry.condition === "FAIL" ? "invalid" : "absent",
      condition: registry.condition === "FAIL" ? "FAIL" : "SKIPPED",
      reason_code: registry.reason_code,
      severity: registry.condition === "FAIL" ? "error" : "info",
      actionable: registry.condition === "FAIL",
      remediation: registry.condition === "FAIL" ? "Repair registry ownership, mode, schema, or binding containment outside doctor." : "None.",
      evidence: [],
    });
  }
  return { id: "privacy", condition: registry.condition, checks };
}
