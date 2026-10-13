import type { OnboardingCatalogV1, OnboardingProfileV1 } from "./contracts.ts";

/** Modules that were shipped once and are now retired from the default catalog, with what replaces them. */
export const RETIRED_MODULES: ReadonlyMap<string, string> = new Map([
  ["provider.9router", "OmniRoute is the default router"],
  ["integration.company-omniroute", "a hosted router is provider.omniroute with OMNIROUTE_HOST_ROLE=cloud-runner"],
  ["integration.omniroute-a2a", "use integration.hermes-a2a"],
]);
export const RETIRED_MODULE_IDS: ReadonlySet<string> = new Set(RETIRED_MODULES.keys());

/** Operator notice for a retired module id that a profile or saved preference still names. */
export function retiredModuleNotice(id: string): string {
  const replacement = RETIRED_MODULES.get(id);
  return `temperance onboard: ignoring retired module ${id}${replacement ? `; ${replacement}` : ""}\n`;
}

/** Retired ids that the catalog in use no longer carries; saved preferences may still name them. */
export function retiredIdsOutsideCatalog(catalog: OnboardingCatalogV1, retired: ReadonlySet<string> = RETIRED_MODULE_IDS): string[] {
  const inCatalog = new Set(catalog.modules.map(({ id }) => id));
  return [...retired].filter((id) => !inCatalog.has(id)).sort();
}

/**
 * Drop retired module ids from a profile's selections and escalations when the catalog in use no
 * longer carries them (the legacy repair flow still does, so they are kept there).
 */
export function withoutRetiredModules(
  profile: OnboardingProfileV1,
  catalog: OnboardingCatalogV1,
  retired: ReadonlySet<string> = RETIRED_MODULE_IDS,
): { profile: OnboardingProfileV1; dropped: string[] } {
  const inCatalog = new Set(catalog.modules.map(({ id }) => id));
  const isDropped = (id: string): boolean => retired.has(id) && !inCatalog.has(id);
  const dropped = [...new Set([...profile.preselected_modules, ...(profile.required_modules ?? [])].filter(isDropped))].sort();
  if (dropped.length === 0) return { profile, dropped };
  return {
    profile: {
      ...profile,
      preselected_modules: profile.preselected_modules.filter((id) => !isDropped(id)),
      ...(profile.required_modules ? { required_modules: profile.required_modules.filter((id) => !isDropped(id)) } : {}),
    },
    dropped,
  };
}
