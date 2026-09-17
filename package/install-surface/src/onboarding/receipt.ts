import {
  ONBOARDING_RECEIPT_SCHEMA,
  type OnboardingPlanV1,
  type OnboardingProfileV1,
  type OnboardingVersionV1,
} from "./contracts.ts";

export interface OnboardingReceiptV1 {
  schema: typeof ONBOARDING_RECEIPT_SCHEMA;
  version: OnboardingVersionV1;
  profile_id: string;
  plan_digest: `sha256:${string}`;
  generated_at: string;
  operating_mode: OnboardingPlanV1["operating_mode"];
  committed_modules: string[];
  blocked_modules: Array<{ id: string; reason_codes: string[] }>;
  secret_reference_ids: string[];
  approved_project_ids: string[];
  derived_tokens_persisted: false;
}

/**
 * Creates the durable, redaction-safe receipt projection. Profile variable
 * values and Keychain service/account metadata are intentionally excluded.
 */
export function createOnboardingReceipt(plan: OnboardingPlanV1, profile: OnboardingProfileV1): OnboardingReceiptV1 {
  return {
    schema: ONBOARDING_RECEIPT_SCHEMA,
    version: { major: 1, minor: 0 },
    profile_id: profile.id,
    plan_digest: plan.plan_digest,
    generated_at: plan.generated_at,
    operating_mode: plan.operating_mode,
    committed_modules: [...plan.install_order],
    blocked_modules: plan.modules
      .filter((module) => module.requested && module.status === "blocked")
      .map((module) => ({ id: module.id, reason_codes: module.holds.map((hold) => hold.reason_code) })),
    secret_reference_ids: Object.keys(profile.secret_references).sort(),
    approved_project_ids: profile.project_enrollments.filter((project) => project.approved).map((project) => project.id).sort(),
    derived_tokens_persisted: false,
  };
}

