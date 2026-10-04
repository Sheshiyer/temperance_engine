import type { DoctorSection } from "../types.ts";
import type { OnboardingModuleResolution, OnboardingPlanV1 } from "./contracts.ts";

/** A held modular or optional organ is a degraded convenience, not a broken host. */
export function softHold(module: OnboardingModuleResolution): boolean {
  return module.organ !== undefined && !module.required && module.organ.tier !== "required";
}

/**
 * Map the shared onboarding plan into the existing doctor result vocabulary. Organ modules report
 * their tier in `destination` so on/off status reads as "required organ held" vs "optional organ off".
 */
export function projectOnboardingDoctorSection(plan: OnboardingPlanV1, sectionId: DoctorSection["id"] = "host"): DoctorSection {
  const checks = plan.modules
    .filter((module) => module.requested)
    .flatMap((module) => {
      const advisoryChecks = module.advisories.map((advisory, index) => ({
        id: `onboarding-${module.id}-advisory-${index + 1}`,
        source: "onboarding:planner",
        destination: module.organ ? `organ:${module.organ.tier}:${module.id}` : `module:${module.id}`,
        class: "RUNTIME" as const,
        expected_state: "all state paths honor the configured DATA_DIR",
        actual_state: "upstream cleanup path divergence is known",
        condition: "WARN" as const,
        reason_code: advisory.reason_code,
        severity: "warning" as const,
        actionable: true,
        remediation: advisory.remediation.join(" "),
        evidence: [plan.plan_digest],
      }));
      const readinessChecks = module.holds.length === 0 ? [{
      id: `onboarding-${module.id}`,
      source: "onboarding:planner",
      destination: module.organ ? `organ:${module.organ.tier}:${module.id}` : `module:${module.id}`,
      class: "RUNTIME" as const,
      expected_state: "module is eligible",
      actual_state: "eligible",
      condition: "PASS" as const,
      reason_code: "MODULE_ELIGIBLE",
      severity: "info" as const,
      actionable: false,
      remediation: "No remediation required.",
      evidence: [plan.plan_digest],
      }] : module.holds.map((hold, index) => ({
      id: `onboarding-${module.id}-${index + 1}`,
      source: "onboarding:planner",
      destination: module.organ ? `organ:${module.organ.tier}:${module.id}` : `module:${module.id}`,
      class: "RUNTIME" as const,
      expected_state: "module is eligible",
      actual_state: "blocked",
      // A held modular/optional organ is a degraded convenience, not a broken host.
      condition: (softHold(module) ? "WARN" : "FAIL") as "WARN" | "FAIL",
      reason_code: hold.reason_code,
      severity: (softHold(module) ? "warning" : "error") as "warning" | "error",
      actionable: true,
      remediation: hold.remediation.join(" "),
      evidence: [plan.plan_digest, ...hold.evidence],
      }));
      return [...readinessChecks, ...advisoryChecks];
    });
  return {
    id: sectionId,
    condition: checks.some((check) => check.condition === "FAIL") ? "FAIL" : checks.some((check) => check.condition === "WARN") ? "WARN" : "PASS",
    checks,
  };
}
