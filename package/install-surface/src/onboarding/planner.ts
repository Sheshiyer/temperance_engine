import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import { canonical } from "../canonical-json.ts";
import {
  ONBOARDING_PLAN_SCHEMA,
  type CapabilityProbe,
  type CapabilityRequirement,
  type OnboardingCatalogV1,
  type OnboardingHold,
  type OnboardingModule,
  type OnboardingModuleResolution,
  type OnboardingPlanV1,
  type OnboardingProbeAdapter,
  type OnboardingProfileV1,
} from "./contracts.ts";
import { validateOnboardingCatalog, validateOnboardingProfile } from "./schema.ts";
import type { ProjectCandidateV1 } from "./public-contracts.ts";
import type { ProjectDiscoveryFinding } from "./project-discovery.ts";

export interface CreateOnboardingPlanOptions {
  catalog: OnboardingCatalogV1;
  profile: OnboardingProfileV1;
  adapter: OnboardingProbeAdapter;
  selections?: ReadonlySet<string>;
  dryRun?: boolean;
  signal?: AbortSignal;
  projectCandidates?: readonly ProjectCandidateV1[];
  projectDiscoveryFindings?: readonly ProjectDiscoveryFinding[];
  configurationInputs?: readonly NonNullable<OnboardingPlanV1["configuration_inputs"]>[number][];
}

function remediationFor(probe: CapabilityProbe): string[] {
  const messages: Record<CapabilityProbe["reason_code"], string> = {
    AVAILABLE: "No remediation required.",
    BINARY_MISSING: "Use the module's guided installer, then probe again.",
    VERSION_MISMATCH: "Install the exact required version, then probe again.",
    APPLICATION_MISSING: "Install the required application, then probe again.",
    MOUNT_ABSENT: "Mount the configured volume and run onboarding again.",
    MOUNT_UUID_MISMATCH: "Verify the mounted volume identity before enabling this module.",
    PATH_MISSING: "Configure an existing path in the selected profile.",
    PATH_INACCESSIBLE: "Correct path permissions before enabling this module.",
    SECRET_REFERENCE_MISSING: "Add a macOS Keychain reference to the profile; never add a plaintext value.",
    SECRET_UNAVAILABLE: "Create the referenced Keychain item, then probe again.",
    ROUTING_ALIAS_MISSING: "Declare the required semantic routing alias in the profile.",
    VARIABLE_MISSING: "Set the required profile variable.",
    VARIABLE_INVALID: "Correct the profile variable before enabling this module.",
    HTTP_UNAVAILABLE: "Start or configure the required local service.",
    UNSUPPORTED_PLATFORM: "Disable this module on the current platform.",
    PROBE_FAILED: "Inspect the probe evidence and rerun onboarding.",
  };
  return [messages[probe.reason_code]];
}

function holdForProbe(probe: CapabilityProbe): OnboardingHold {
  return {
    reason_code: probe.reason_code,
    capability_id: probe.capability_id,
    message: `Capability '${probe.capability_id}' is not ready (${probe.reason_code}).`,
    remediation: remediationFor(probe),
    evidence: probe.evidence,
  };
}

function missingInputProbe(requirement: CapabilityRequirement, profile: OnboardingProfileV1): CapabilityProbe | undefined {
  if (requirement.kind === "keychain-secret" && !profile.secret_references[requirement.secret_reference]) {
    return { capability_id: requirement.id, available: false, reason_code: "SECRET_REFERENCE_MISSING", evidence: [] };
  }
  if (requirement.kind === "routing-alias" && !profile.routing_aliases.some((item) => item.alias === requirement.alias)) {
    return { capability_id: requirement.id, available: false, reason_code: "ROUTING_ALIAS_MISSING", evidence: [] };
  }
  const variableNames = requirement.kind === "mount"
    // Probe the mount before requiring its UUID. This preserves the important
    // distinction between an unplugged volume (read-only degraded mode) and a
    // present volume whose identity has not been bound (configuration hold).
    ? [requirement.mount_path_variable, requirement.required_relative_path_variable]
    : requirement.kind === "path"
      ? [requirement.path_variable]
      : requirement.kind === "http-health"
        ? [requirement.url_variable]
        : requirement.kind === "9router-management"
          ? [requirement.data_dir_variable]
        : requirement.kind === "binary"
          ? [requirement.executable_variable]
        : [];
  const missing = variableNames.filter((name): name is string => Boolean(name) && !profile.variables[name!]);
  if (missing.length > 0) {
    return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_MISSING", evidence: missing.map((name) => `missing:${name}`) };
  }
  if (requirement.kind === "mount") {
    const mountPath = profile.variables[requirement.mount_path_variable];
    const relative = requirement.required_relative_path_variable ? profile.variables[requirement.required_relative_path_variable] : undefined;
    if (mountPath && !isAbsolute(mountPath)) return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_INVALID", evidence: ["mount path must be absolute"] };
    if (relative && (isAbsolute(relative) || relative.includes("\\") || relative.split("/").includes(".."))) {
      return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_INVALID", evidence: ["mount-relative path is unsafe"] };
    }
  }
  if (requirement.kind === "path" && profile.variables[requirement.path_variable] && !isAbsolute(profile.variables[requirement.path_variable]!)) {
    return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_INVALID", evidence: ["path must be absolute"] };
  }
  if (requirement.kind === "9router-management" && profile.variables[requirement.data_dir_variable] && !isAbsolute(profile.variables[requirement.data_dir_variable]!)) {
    return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_INVALID", evidence: ["9router DATA_DIR must be absolute"] };
  }
  if (requirement.kind === "binary" && requirement.executable_variable) {
    const executable = profile.variables[requirement.executable_variable];
    if (executable && !isAbsolute(executable)) {
      return { capability_id: requirement.id, available: false, reason_code: "VARIABLE_INVALID", evidence: ["bound executable path must be absolute"] };
    }
  }
  return undefined;
}

function selectedIds(catalog: OnboardingCatalogV1, profile: OnboardingProfileV1, selections?: ReadonlySet<string>): Set<string> {
  if (selections) return new Set(selections);
  return new Set([
    ...profile.preselected_modules,
    ...catalog.modules.filter((module) => module.preselection === "selected").map((module) => module.id),
  ]);
}

function dependencyCycleMembers(modules: OnboardingModule[]): Set<string> {
  const map = new Map(modules.map((module) => [module.id, module]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visiting.has(id)) {
      const offset = stack.indexOf(id);
      for (const member of stack.slice(offset)) cycles.add(member);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const module = map.get(id);
    if (module) for (const dependency of module.depends_on) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const module of modules) visit(module.id, []);
  return cycles;
}

function topologicalEligible(modules: OnboardingModule[], eligible: Set<string>): string[] {
  const map = new Map(modules.map((module) => [module.id, module]));
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || !eligible.has(id)) return;
    visited.add(id);
    for (const dependency of map.get(id)?.depends_on ?? []) visit(dependency);
    order.push(id);
  };
  for (const module of modules) visit(module.id);
  return order;
}

export function calculateOnboardingPlanDigest(plan: Omit<OnboardingPlanV1, "plan_digest" | "generated_at">): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(plan), "utf8").digest("hex")}`;
}

export function verifyOnboardingPlanDigest(plan: OnboardingPlanV1): boolean {
  const { generated_at: _generatedAt, plan_digest, ...digestScope } = plan;
  return calculateOnboardingPlanDigest(digestScope) === plan_digest;
}

export async function createOnboardingPlan(options: CreateOnboardingPlanOptions): Promise<OnboardingPlanV1> {
  if (!validateOnboardingCatalog(options.catalog)) throw new Error("ONBOARDING_CATALOG_INVALID");
  if (!validateOnboardingProfile(options.profile)) throw new Error("ONBOARDING_PROFILE_INVALID");
  const configurationInputs = [...(options.configurationInputs ?? [])];
  if (new Set(configurationInputs.map(({ id }) => id)).size !== configurationInputs.length) {
    throw new Error("ONBOARDING_CONFIGURATION_INPUT_DUPLICATE");
  }
  for (const input of configurationInputs) {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(input.id)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.digest)
      || input.details.length > 1024
      || input.details.some((detail) => !detail || detail.length > 16_384 || detail.includes("\0"))) {
      throw new Error("ONBOARDING_CONFIGURATION_INPUT_INVALID");
    }
  }

  const chosen = selectedIds(options.catalog, options.profile, options.selections);
  const known = new Set(options.catalog.modules.map((module) => module.id));
  const unknown = [...chosen].filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`ONBOARDING_SELECTION_UNKNOWN:${unknown.sort().join(",")}`);
  const signal = options.signal ?? new AbortController().signal;
  const cycleMembers = dependencyCycleMembers(options.catalog.modules);
  const holds = new Map<string, OnboardingHold[]>();

  for (const module of options.catalog.modules) {
    if (!chosen.has(module.id)) continue;
    const moduleHolds: OnboardingHold[] = [];
    for (const dependency of module.depends_on) {
      if (!known.has(dependency)) {
        moduleHolds.push({ reason_code: "DEPENDENCY_MISSING", dependency_id: dependency, message: `Dependency '${dependency}' is not in the catalog.`, remediation: ["Add the dependency module to the catalog."], evidence: [] });
      }
    }
    if (cycleMembers.has(module.id)) {
      moduleHolds.push({ reason_code: "DEPENDENCY_CYCLE", message: "Module participates in a dependency cycle.", remediation: ["Remove the dependency cycle from the module catalog."], evidence: [] });
    }
    for (const requirement of module.requires) {
      const missing = missingInputProbe(requirement, options.profile);
      const result = missing ?? await options.adapter.probe(requirement, { profile: options.profile, signal });
      if (!result.available) moduleHolds.push(holdForProbe(result));
    }
    holds.set(module.id, moduleHolds);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const module of options.catalog.modules) {
      if (!chosen.has(module.id)) continue;
      const moduleHolds = holds.get(module.id) ?? [];
      for (const dependency of module.depends_on) {
        if (!chosen.has(dependency) || (holds.get(dependency)?.length ?? 0) > 0) {
          if (!moduleHolds.some((hold) => hold.reason_code === "DEPENDENCY_BLOCKED" && hold.dependency_id === dependency)) {
            moduleHolds.push({ reason_code: "DEPENDENCY_BLOCKED", dependency_id: dependency, message: `Dependency '${dependency}' is not selected and eligible.`, remediation: [`Resolve '${dependency}' before enabling '${module.id}'.`], evidence: [] });
            changed = true;
          }
        }
      }
      holds.set(module.id, moduleHolds);
    }
  }

  const eligible = new Set(options.catalog.modules
    .filter((module) => chosen.has(module.id) && (holds.get(module.id)?.length ?? 0) === 0)
    .map((module) => module.id));
  const modules: OnboardingModuleResolution[] = options.catalog.modules.map((module) => ({
    id: module.id,
    title: module.title,
    requested: chosen.has(module.id),
    status: !chosen.has(module.id) ? "not-selected" : eligible.has(module.id) ? "eligible" : "blocked",
    holds: holds.get(module.id) ?? [],
    guided_installs: module.guided_installs,
    advisories: module.runtime_contract?.cleanup_path_divergence === "doctor-required" ? [{
      reason_code: "NINE_ROUTER_DATA_DIR_CLEANUP_DIVERGENCE",
      message: "9Router server state honors DATA_DIR, but some upstream cleanup paths still resolve the default state directory.",
      remediation: ["Keep cleanup under the Temperance lifecycle and let doctor check both resolved state roots."],
    }] : [],
  }));
  const mountDegraded = modules.some((module) => module.holds.some((hold) => hold.reason_code === "MOUNT_ABSENT" || hold.reason_code === "MOUNT_UUID_MISMATCH"));
  const base: Omit<OnboardingPlanV1, "plan_digest" | "generated_at"> = {
    schema: ONBOARDING_PLAN_SCHEMA,
    version: { major: 1, minor: 0 },
    profile_id: options.profile.id,
    dry_run: options.dryRun ?? true,
    operating_mode: mountDegraded ? "read-only-degraded" : modules.some((module) => module.status === "blocked") ? "blocked" : "ready",
    install_order: topologicalEligible(options.catalog.modules, eligible),
    project_enrollments: options.profile.project_enrollments.map(({ id, approved, access }) => ({ id, approved, access })),
    project_candidates: [...(options.projectCandidates ?? [])],
    project_discovery_findings: [...(options.projectDiscoveryFindings ?? [])],
    ...(configurationInputs.length > 0 ? { configuration_inputs: structuredClone(configurationInputs) } : {}),
    modules,
  };
  return {
    ...base,
    generated_at: (options.adapter.now?.() ?? new Date()).toISOString(),
    plan_digest: calculateOnboardingPlanDigest(base),
  };
}
