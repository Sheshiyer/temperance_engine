import type { OnboardingCatalogV1, OnboardingProfileV1 } from "./contracts.ts";

/** Modules that were shipped once and are now retired from the default catalog. */
export const RETIRED_MODULE_IDS: ReadonlySet<string> = new Set(["provider.9router"]);

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
