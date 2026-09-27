import { isAbsolute, normalize } from "node:path";

import type { OnboardingProfileV1 } from "./contracts.ts";
import { validateOnboardingProfile } from "./schema.ts";
import {
  validateHostBindingV1,
  validateHostProfileV1,
  validateProjectCapsuleV1,
} from "./contract-schema.ts";
import type {
  HostBindingV1,
  HostProfileV1,
  ProjectCapsuleV1,
} from "./public-contracts.ts";

export interface ComposeOnboardingProfileOptions {
  projectCapsules?: readonly ProjectCapsuleV1[];
}

function uniqueNames(values: readonly { name: string }[], code: string): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (result.has(value.name)) throw new Error(code);
    result.add(value.name);
  }
  return result;
}

function validateVariableValue(kind: HostProfileV1["variables"][number]["kind"], value: string, name: string): string {
  if (kind === "absolute-path") {
    if (!isAbsolute(value) || normalize(value) !== value || value.includes("\0")) {
      throw new Error(`HOST_BINDING_PATH_INVALID:${name}`);
    }
  } else if (kind === "url") {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error(`HOST_BINDING_URL_INVALID:${name}`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`HOST_BINDING_URL_INVALID:${name}`);
  } else if (kind === "volume-uuid") {
    if (!/^[A-Za-z0-9-]{4,256}$/u.test(value)) throw new Error(`HOST_BINDING_VOLUME_UUID_INVALID:${name}`);
  }
  return value;
}

function volumeUuidVariable(
  binding: HostBindingV1["volume_bindings"][number],
  profile: HostProfileV1,
): string {
  if (binding.volume_uuid_variable) return binding.volume_uuid_variable;
  const candidates = profile.variables.filter(({ kind }) => kind === "volume-uuid");
  if (candidates.length !== 1) throw new Error(`HOST_BINDING_VOLUME_UUID_VARIABLE_AMBIGUOUS:${binding.id}`);
  return candidates[0].name;
}

/**
 * Join portable declarations to private machine bindings. The composed value
 * is an in-memory planner input; callers must never persist it as a profile.
 */
export function composeOnboardingProfile(
  profile: HostProfileV1,
  binding: HostBindingV1,
  options: ComposeOnboardingProfileOptions = {},
): OnboardingProfileV1 {
  if (!validateHostProfileV1(profile)) throw new Error("HOST_PROFILE_INVALID");
  if (!validateHostBindingV1(binding)) throw new Error("HOST_BINDING_INVALID");
  if (binding.profile_id !== profile.id) throw new Error("HOST_BINDING_PROFILE_MISMATCH");

  const declaredVariables = uniqueNames(profile.variables, "HOST_PROFILE_VARIABLE_DUPLICATE");
  const declaredSecrets = uniqueNames(profile.secret_references, "HOST_PROFILE_SECRET_DUPLICATE");
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(binding.variables)) {
    const declaration = profile.variables.find((candidate) => candidate.name === name);
    if (!declaration) throw new Error(`HOST_BINDING_VARIABLE_UNDECLARED:${name}`);
    variables[name] = validateVariableValue(declaration.kind, value, name);
  }

  for (const volume of binding.volume_bindings) {
    const mountDeclaration = profile.variables.find(({ name }) => name === volume.mount_path_variable);
    if (!mountDeclaration || mountDeclaration.kind !== "absolute-path") {
      throw new Error(`HOST_BINDING_MOUNT_VARIABLE_INVALID:${volume.mount_path_variable}`);
    }
    if (!variables[volume.mount_path_variable]) {
      throw new Error(`HOST_BINDING_MOUNT_PATH_MISSING:${volume.mount_path_variable}`);
    }
    const uuidVariable = volumeUuidVariable(volume, profile);
    const uuidDeclaration = profile.variables.find(({ name }) => name === uuidVariable);
    if (!uuidDeclaration || uuidDeclaration.kind !== "volume-uuid") {
      throw new Error(`HOST_BINDING_VOLUME_UUID_VARIABLE_INVALID:${uuidVariable}`);
    }
    variables[uuidVariable] = validateVariableValue("volume-uuid", volume.volume_uuid, uuidVariable);
  }

  for (const declaration of profile.variables) {
    if (declaration.required && !variables[declaration.name]) {
      throw new Error(`HOST_BINDING_REQUIRED_VARIABLE_MISSING:${declaration.name}`);
    }
  }
  for (const name of Object.keys(binding.secret_references)) {
    if (!declaredSecrets.has(name)) throw new Error(`HOST_BINDING_SECRET_UNDECLARED:${name}`);
  }
  for (const declaration of profile.secret_references) {
    if (declaration.required && !binding.secret_references[declaration.name]) {
      throw new Error(`HOST_BINDING_REQUIRED_SECRET_MISSING:${declaration.name}`);
    }
  }
  for (const requiredAlias of profile.required_routing_aliases) {
    if (!binding.routing_aliases.some(({ alias }) => alias === requiredAlias)) {
      throw new Error(`HOST_BINDING_REQUIRED_ALIAS_MISSING:${requiredAlias}`);
    }
  }

  const capsules = options.projectCapsules ?? [];
  const project_enrollments = capsules.map((capsule) => {
    if (!validateProjectCapsuleV1(capsule)) throw new Error("PROJECT_CAPSULE_INVALID");
    if (!declaredVariables.has(capsule.root_variable)) throw new Error(`PROJECT_CAPSULE_ROOT_UNDECLARED:${capsule.root_variable}`);
    return {
      id: capsule.id,
      root_variable: capsule.root_variable,
      approved: capsule.approved,
      access: capsule.access,
    } as const;
  });

  const composed: OnboardingProfileV1 = {
    schema: "temperance.onboarding.profile.v1",
    version: { major: 1, minor: 0 },
    id: profile.id,
    variables,
    secret_references: { ...binding.secret_references },
    preselected_modules: [...profile.preselected_modules],
    routing_aliases: [...binding.routing_aliases],
    project_enrollments,
  };
  if (!validateOnboardingProfile(composed)) throw new Error("ONBOARDING_PROFILE_COMPOSITION_INVALID");
  return composed;
}
