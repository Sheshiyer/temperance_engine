import Ajv2020 from "ajv/dist/2020.js";

import catalogSchema from "../../schemas/onboarding-catalog.v1.schema.json" with { type: "json" };
import profileSchema from "../../schemas/onboarding-profile.v1.schema.json" with { type: "json" };
import type { OnboardingCatalogV1, OnboardingProfileV1 } from "./contracts.ts";

const compiler = new Ajv2020({ strict: true, allErrors: true });
const catalogValidator = compiler.compile<OnboardingCatalogV1>(catalogSchema);
const profileValidator = compiler.compile<OnboardingProfileV1>(profileSchema);
const MAX_ONBOARDING_BYTES = 4_194_304;

function withinBound(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= MAX_ONBOARDING_BYTES;
  } catch {
    return false;
  }
}

export function validateOnboardingCatalog(value: unknown): value is OnboardingCatalogV1 {
  if (!withinBound(value) || !catalogValidator(value)) return false;
  for (const module of value.modules) {
    if (module.id !== "provider.9router") continue;
    const install = module.guided_installs.find((item) => item.kind === "command" && item.argv.includes("9router@0.5.75"));
    if (!install || install.kind !== "command" || install.environment?.DATA_DIR !== "${NINE_ROUTER_DATA_DIR}") return false;
    if (module.runtime_contract?.owner !== "temperance" || module.runtime_contract.forbidden_launch_agent_label !== "com.9router.autostart") return false;
  }
  return true;
}

export function validateOnboardingProfile(value: unknown): value is OnboardingProfileV1 {
  return withinBound(value) && profileValidator(value);
}
