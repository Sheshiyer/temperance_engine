import { digest, digestValue, frozen, id, invalid, list, record, timestamp, unique, type Digest } from "./boundary.ts";

export interface ModuleDescriptorV1 {
  schema: "temperance.module-descriptor.v1";
  id: string;
  implementation_ref: string;
  source_digest: Digest;
  requires: string[];
  operations: Array<{ id: string; capability: string; mode: "read" | "write" }>;
}
export interface CompositionV2 {
  schema: "temperance.composition.v2";
  plant: { id: string; owner_ref: string };
  coordinator: null | { adapter_ref: string; source_digest: Digest };
  flow: null | { owner_ref: string; definition_ref: string };
  planning_owner_ref: string | null;
  acceptance_owner_ref: string | null;
  authorization_owner: null | { ref: string; source_digest: Digest };
  modules: Array<{ id: string; descriptor_digest: Digest }>;
  bindings: Array<{ capability: string; owner_ref: string; source_digest: Digest }>;
}
export interface ObservationsV2 {
  schema: "temperance.composition-observations.v2";
  plant_id: string;
  source_manifest_digest: Digest;
  observed_at: string;
  expires_at: string;
  capabilities: Array<{ capability: string; owner_ref: string; source_digest: Digest; state: "unavailable" | "detected" | "configured" | "healthy" }>;
}
export function validateDescriptor(value: unknown): Readonly<ModuleDescriptorV1> {
  const v = record(value, ["schema", "id", "implementation_ref", "source_digest", "requires", "operations"]);
  if (v.schema !== "temperance.module-descriptor.v1") invalid();
  id(v.id); id(v.implementation_ref); digest(v.source_digest);
  const requires = list(v.requires, id); unique(requires);
  const operations = list(v.operations, raw => {
    const operation = record(raw, ["id", "capability", "mode"]);
    id(operation.id); id(operation.capability);
    if (!["read", "write"].includes(operation.mode)) invalid();
    return operation;
  });
  unique(operations.map(operation => operation.id));
  if (requires.includes(v.id)) invalid("ENGINE_DEPENDENCY_CYCLE");
  return frozen(value as ModuleDescriptorV1);
}
export function validateCompositionV2(value: unknown): Readonly<CompositionV2> {
  const v = record(value, ["schema", "plant", "coordinator", "flow", "planning_owner_ref", "acceptance_owner_ref", "authorization_owner", "modules", "bindings"]);
  if (v.schema !== "temperance.composition.v2") invalid();
  const plant = record(v.plant, ["id", "owner_ref"]); id(plant.id); id(plant.owner_ref);
  if (v.coordinator !== null) { const c = record(v.coordinator, ["adapter_ref", "source_digest"]); id(c.adapter_ref); digest(c.source_digest); }
  if (v.flow !== null) { const f = record(v.flow, ["owner_ref", "definition_ref"]); id(f.owner_ref); id(f.definition_ref); }
  for (const owner of [v.planning_owner_ref, v.acceptance_owner_ref]) if (owner !== null) id(owner);
  if (v.authorization_owner !== null) { const a = record(v.authorization_owner, ["ref", "source_digest"]); id(a.ref); digest(a.source_digest); }
  const modules = list(v.modules, raw => { const m = record(raw, ["id", "descriptor_digest"]); id(m.id); digest(m.descriptor_digest); return m; });
  unique(modules.map(module => module.id));
  const bindings = list(v.bindings, raw => { const b = record(raw, ["capability", "owner_ref", "source_digest"]); id(b.capability); id(b.owner_ref); digest(b.source_digest); return b; });
  unique(bindings.map(binding => binding.capability));
  return frozen(value as CompositionV2);
}
export function createBareComposition(plant_id = "local", owner_ref = "owner.local"): Readonly<CompositionV2> {
  return validateCompositionV2({ schema: "temperance.composition.v2", plant: { id: plant_id, owner_ref }, coordinator: null, flow: null, planning_owner_ref: null, acceptance_owner_ref: null, authorization_owner: null, modules: [], bindings: [] });
}
export function validateObservationsV2(value: unknown): Readonly<ObservationsV2> {
  const v = record(value, ["schema", "plant_id", "source_manifest_digest", "observed_at", "expires_at", "capabilities"]);
  if (v.schema !== "temperance.composition-observations.v2") invalid();
  id(v.plant_id); digest(v.source_manifest_digest);
  const observed = timestamp(v.observed_at), expires = timestamp(v.expires_at);
  if (expires <= observed || expires - observed > 300000) invalid("ENGINE_OBSERVATION_EXPIRY_INVALID");
  const capabilities = list(v.capabilities, raw => {
    const c = record(raw, ["capability", "owner_ref", "source_digest", "state"]);
    id(c.capability); id(c.owner_ref); digest(c.source_digest);
    if (!["unavailable", "detected", "configured", "healthy"].includes(c.state)) invalid();
    return c;
  });
  unique(capabilities.map(capability => capability.capability));
  return frozen(value as ObservationsV2);
}
export interface ModuleReportV2 { id: string; readiness: "configuration-observed" | "held"; reasons: string[] }

/** Configuration inspection grants no work, provider, semantic or acceptance authority. */
export function inspectCompositionV2(input: unknown, descriptorInputs: readonly unknown[] = [], observationInput?: unknown, now = Date.now()) {
  if (!Number.isSafeInteger(now)) invalid();
  const manifest = validateCompositionV2(input);
  const source_manifest_digest = digestValue(manifest);
  const descriptors = list(descriptorInputs, validateDescriptor);
  unique(descriptors.map(descriptor => descriptor.id));
  const byId = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]));
  const selected = new Set(manifest.modules.map(module => module.id));
  const observations = observationInput === undefined ? undefined : validateObservationsV2(observationInput);
  if (observations && (observations.plant_id !== manifest.plant.id || observations.source_manifest_digest !== source_manifest_digest)) invalid("ENGINE_OBSERVATION_IDENTITY_MISMATCH");
  if (observations && timestamp(observations.observed_at) > now) invalid("ENGINE_OBSERVATION_FROM_FUTURE");
  const stale = observations !== undefined && now >= timestamp(observations.expires_at);
  const observed = new Map(observations?.capabilities.map(capability => [capability.capability, capability]) ?? []);
  if (observations?.capabilities.some(capability => !manifest.bindings.some(binding => binding.capability === capability.capability && binding.owner_ref === capability.owner_ref && binding.source_digest === capability.source_digest))) invalid("ENGINE_OBSERVATION_BINDING_MISMATCH");
  const rows = new Map<string, ModuleReportV2>();
  const visiting = new Set<string>();
  function inspect(module_id: string): ModuleReportV2 {
    const prior = rows.get(module_id); if (prior) return prior;
    if (visiting.has(module_id)) invalid("ENGINE_DEPENDENCY_CYCLE");
    visiting.add(module_id);
    const selection = manifest.modules.find(module => module.id === module_id);
    const descriptor = byId.get(module_id);
    const reasons: string[] = [];
    if (!selection || !descriptor) reasons.push("DESCRIPTOR_UNAVAILABLE");
    else if (digestValue(descriptor) !== selection.descriptor_digest) reasons.push("DESCRIPTOR_PIN_MISMATCH");
    else {
      for (const dependency of descriptor.requires) if (!selected.has(dependency) || inspect(dependency).readiness !== "configuration-observed") reasons.push("DEPENDENCY_HELD:" + dependency);
      for (const operation of descriptor.operations) {
        const binding = manifest.bindings.find(candidate => candidate.capability === operation.capability);
        const observation = observed.get(operation.capability);
        if (!binding) reasons.push("BINDING_UNAVAILABLE:" + operation.capability);
        else if (stale) reasons.push("OBSERVATION_STALE:" + operation.capability);
        else if (!observation || !["configured", "healthy"].includes(observation.state)) reasons.push("CAPABILITY_UNAVAILABLE:" + operation.capability);
      }
    }
    visiting.delete(module_id);
    const row: ModuleReportV2 = { id: module_id, readiness: reasons.length ? "held" : "configuration-observed", reasons: [...new Set(reasons)].sort() };
    rows.set(module_id, row); return row;
  }
  for (const selection of manifest.modules) inspect(selection.id);
  return frozen({ schema: "temperance.composition-report.v2" as const, source_manifest_digest, plant: manifest.plant, coordinator: manifest.coordinator, flow: manifest.flow, planning_owner_ref: manifest.planning_owner_ref, acceptance_owner_ref: manifest.acceptance_owner_ref, readiness: manifest.modules.length === 0 ? "core-available" : [...rows.values()].every(row => row.readiness === "configuration-observed") ? "configuration-observed" : "held", modules: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)), effect_authorized: false as const, acceptance_asserted: false as const });
}
