import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonical } from "../canonical-json.ts";
import { composeOnboardingProfile } from "./composition.ts";
import type { HostBindingInitCliArgs } from "./host-binding-init-cli-args.ts";
import type { HostBindingV1, HostIdentityBindingV1, HostProfileV1 } from "./public-contracts.ts";

type HostObservation = Omit<HostIdentityBindingV1, "user_id"> & { user_id: number | null };

function intendedHost(observed: HostObservation): HostIdentityBindingV1 {
  if (observed.user_id === null || observed.user_id < 1
    || [observed.hardware_model, observed.chip_model, observed.architecture].some((value) => value === "unknown")) {
    throw new Error("HOST_BINDING_INIT_IDENTITY_UNAVAILABLE");
  }
  return { ...observed, user_id: observed.user_id };
}

export function createHostBinding(
  profile: HostProfileV1,
  input: Pick<HostBindingInitCliArgs, "variables" | "secretReferences" | "routingAliases" | "volumeBindings">,
  observed: HostObservation,
): HostBindingV1 {
  const binding: HostBindingV1 = {
    schema: "temperance.host-binding.v1",
    version: { major: 1, minor: 0 },
    profile_id: profile.id,
    host_identity: intendedHost(observed),
    variables: { ...input.variables },
    secret_references: structuredClone(input.secretReferences),
    routing_aliases: structuredClone(input.routingAliases),
    volume_bindings: structuredClone(input.volumeBindings),
  };
  // Composition is the single validator for declared variables, Keychain
  // references, semantic aliases, volume bindings, and required inputs.
  composeOnboardingProfile(profile, binding);
  return binding;
}

export function writePrivateHostBinding(outputPath: string, binding: HostBindingV1): string {
  const output = resolve(outputPath);
  const parent = dirname(output);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) !== 0) {
    throw new Error("HOST_BINDING_INIT_PARENT_UNSAFE");
  }
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(output, "wx", 0o600);
    created = true;
    fchmodSync(descriptor, 0o600);
    const bytes = Buffer.from(canonical(binding), "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const parentDescriptor = openSync(parent, "r");
    try { fsyncSync(parentDescriptor); } finally { closeSync(parentDescriptor); }
    return output;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try { unlinkSync(output); } catch { /* preserve the original failure */ }
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("HOST_BINDING_INIT_OUTPUT_EXISTS");
    throw error;
  }
}
