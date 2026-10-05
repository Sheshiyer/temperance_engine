export const COMPOSITION_SCHEMA = "temperance.composition.v1" as const;
export const COMPOSITION_OBSERVATIONS_SCHEMA = "temperance.composition-observations.v1" as const;
export const COMPOSITION_REPORT_SCHEMA = "temperance.composition-report.v1" as const;

export const PRODUCT_ID = "temperance-engine" as const;
export const PRODUCT_REPOSITORY = "github.com/Sheshiyer/temperance_engine" as const;

export const MAX_INPUT_BYTES = 65536; // 64 KiB
export const MAX_MODULES = 64;
export const MAX_INTEGRATIONS = 16;
export const MAX_REFS_PER_ITEM = 32;
export const MAX_REQUIRES_PER_ITEM = 32;

export const VALID_MODULE_IDS = [
  "routing.gateway",
  "skills.binding",
  "executor.git",
  "executor.hands",
  "transport.a2a",
  "projection.manifest",
  "projection.constellation",
  "projection.banner",
  "projection.island",
  "organ.vestibule",
  "organ.adytum",
  "organ.nutrix",
  "organ.auspex",
  "organ.circulator",
  "organ.praeceptor",
] as const;

export type ModuleId = (typeof VALID_MODULE_IDS)[number];

export const VALID_COORDINATOR_SURFACES = [
  "codex-app",
  "codex-cli",
  "claude-app",
  "claude-code",
  "temperance-claude",
  "grok-cli",
  "opencode",
  "cursor",
  "antigravity",
] as const;

export type CoordinatorSurface = (typeof VALID_COORDINATOR_SURFACES)[number];
export type CoordinatorMode = "native";
export type PlantKind = "local" | "hosted";

export const VALID_OBSERVED_MODULE_STATES = [
  "unavailable",
  "detected",
  "configured",
  "healthy",
  "admitted",
] as const;

export type ObservedModuleState = (typeof VALID_OBSERVED_MODULE_STATES)[number];

export type ReportModuleState =
  | "unknown"
  | "stale"
  | "unavailable"
  | "detected"
  | "configured"
  | "healthy"
  | "admitted";

export type CompositionReadiness = "unknown" | "held" | "configuration-observed";

export interface CompositionModuleV1 {
  id: ModuleId;
  owner: string;
  plant_id: string;
  requires: ModuleId[];
  configuration_refs: string[];
}

export interface CompositionIntegrationV1 {
  id: string;
  repository: string;
  plant_id: string;
  requires: ModuleId[];
}

export interface CompositionV1 {
  schema: typeof COMPOSITION_SCHEMA;
  product: {
    id: typeof PRODUCT_ID;
    repository: typeof PRODUCT_REPOSITORY;
  };
  plant: {
    id: string;
    owner: string;
    kind: PlantKind;
  };
  coordinator: {
    surface: CoordinatorSurface;
    mode: CoordinatorMode;
  };
  modules: CompositionModuleV1[];
  integrations: CompositionIntegrationV1[];
}

export interface ObservedModuleV1 {
  id: ModuleId;
  state: ObservedModuleState;
  configuration_refs: string[];
}

export interface CompositionObservationsV1 {
  schema: typeof COMPOSITION_OBSERVATIONS_SCHEMA;
  plant_id: string;
  observed_at: string;
  expires_at: string;
  modules: ObservedModuleV1[];
}

export interface ReportModuleRowV1 {
  id: ModuleId;
  owner: string;
  state: ReportModuleState;
  missing_refs: string[];
  dependency_blockers: ModuleId[];
  readiness: CompositionReadiness;
}

export interface CompositionReportV1 {
  schema: typeof COMPOSITION_REPORT_SCHEMA;
  mode: "configuration-only";
  effect_authorized: false;
  source_manifest_digest: `sha256:${string}`;
  plant: {
    id: string;
    owner: string;
    kind: PlantKind;
  };
  coordinator: {
    surface: CoordinatorSurface;
    mode: CoordinatorMode;
  };
  integrations: Array<{
    id: string;
    repository: string;
  }>;
  modules: ReportModuleRowV1[];
  readiness: CompositionReadiness;
  kernel: {
    requires_integrations: false;
    requires_superset: false;
    acceptance_owner: "isa";
    planning_owner: "gsd";
    execution_authorized: false;
  };
}

export const GENERIC_MINIMUM_DEPENDENCIES: Record<ModuleId, readonly ModuleId[]> = {
  "executor.hands": ["executor.git", "skills.binding"],
  "transport.a2a": ["executor.hands"],
  "projection.constellation": ["projection.manifest"],
  "organ.adytum": ["organ.vestibule"],
  "organ.circulator": ["organ.nutrix"],
  "organ.praeceptor": ["organ.nutrix"],
  "routing.gateway": [],
  "skills.binding": [],
  "executor.git": [],
  "projection.manifest": [],
  "projection.banner": [],
  "projection.island": [],
  "organ.vestibule": [],
  "organ.nutrix": [],
  "organ.auspex": [],
};

const SAFE_SYMBOLIC_IDENTIFIER = /^[a-zA-Z0-9_.-]{1,64}$/;
const GITHUB_REPO_STRICT = /^github\.com\/[A-Za-z0-9][A-Za-z0-9_-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const REF_STRICT = /^(binding|secret-ref):[a-zA-Z0-9_.-]{1,64}$/;
const ISO_UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function keyOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function ensurePlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COMPOSITION_INVALID_INPUT");
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("COMPOSITION_PROTOTYPE_POLLUTION");
  }
  const names = Object.getOwnPropertyNames(value);
  for (const name of names) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      throw new Error("COMPOSITION_PROTOTYPE_POLLUTION");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor && (descriptor.get || descriptor.set)) {
      throw new Error("COMPOSITION_ACCESSOR_NOT_ALLOWED");
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("COMPOSITION_UNKNOWN_FIELD");
  }
}

// Inspect descriptors before serialization so nested getters/toJSON never run.
function assertSafeTree(input: unknown): void {
  const active = new Set<object>();
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > MAX_INPUT_BYTES || depth > 16) throw new Error("COMPOSITION_SIZE_EXCEEDED");
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > MAX_INPUT_BYTES) throw new Error("COMPOSITION_SIZE_EXCEEDED");
      return;
    }
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
    if (typeof value !== "object") throw new Error("COMPOSITION_INVALID_INPUT");
    if (active.has(value)) throw new Error("COMPOSITION_INVALID_INPUT");
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("COMPOSITION_PROTOTYPE_POLLUTION");
      if (value.length > MAX_MODULES) throw new Error("COMPOSITION_SIZE_EXCEEDED");
    } else ensurePlainObject(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error("COMPOSITION_UNKNOWN_FIELD");
    active.add(value);
    for (const name of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && name === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
      if (descriptor.get || descriptor.set) throw new Error("COMPOSITION_ACCESSOR_NOT_ALLOWED");
      if (!descriptor.enumerable || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(name))) throw new Error("COMPOSITION_UNKNOWN_FIELD");
      visit(descriptor.value, depth + 1);
    }
    active.delete(value);
  }
  visit(input, 0);
}

function assertExactKeys(obj: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const keys = Object.keys(obj);
  if (keys.length !== allowedKeys.length) {
    throw new Error("COMPOSITION_UNKNOWN_FIELD");
  }
  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      throw new Error("COMPOSITION_UNKNOWN_FIELD");
    }
  }
}

function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (VALID_MODULE_IDS as readonly string[]).includes(value);
}

function validateRef(ref: unknown): string {
  if (typeof ref !== "string" || !REF_STRICT.test(ref)) {
    throw new Error("COMPOSITION_MALFORMED_REF");
  }
  return ref;
}

export function validateComposition(input: unknown): CompositionV1 {
  assertSafeTree(input);
  ensurePlainObject(input);

  const jsonBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (jsonBytes > MAX_INPUT_BYTES) {
    throw new Error("COMPOSITION_SIZE_EXCEEDED");
  }

  assertExactKeys(input, ["schema", "product", "plant", "coordinator", "modules", "integrations"]);

  if (input.schema !== COMPOSITION_SCHEMA) {
    throw new Error("COMPOSITION_INVALID_SCHEMA");
  }

  // Validate product
  ensurePlainObject(input.product);
  assertExactKeys(input.product, ["id", "repository"]);
  if (input.product.id !== PRODUCT_ID || input.product.repository !== PRODUCT_REPOSITORY) {
    throw new Error("COMPOSITION_INVALID_PRODUCT");
  }

  // Validate plant
  ensurePlainObject(input.plant);
  assertExactKeys(input.plant, ["id", "owner", "kind"]);
  if (typeof input.plant.id !== "string" || !SAFE_SYMBOLIC_IDENTIFIER.test(input.plant.id)) {
    throw new Error("COMPOSITION_INVALID_PLANT");
  }
  if (typeof input.plant.owner !== "string" || !SAFE_SYMBOLIC_IDENTIFIER.test(input.plant.owner)) {
    throw new Error("COMPOSITION_INVALID_PLANT");
  }
  if (input.plant.kind !== "local" && input.plant.kind !== "hosted") {
    throw new Error("COMPOSITION_INVALID_PLANT");
  }
  const plantId = input.plant.id;

  // Validate coordinator
  ensurePlainObject(input.coordinator);
  assertExactKeys(input.coordinator, ["surface", "mode"]);
  if (
    typeof input.coordinator.surface !== "string"
    || !(VALID_COORDINATOR_SURFACES as readonly string[]).includes(input.coordinator.surface)
  ) {
    throw new Error("COMPOSITION_INVALID_COORDINATOR");
  }
  if (input.coordinator.mode !== "native") {
    throw new Error("COMPOSITION_INVALID_COORDINATOR");
  }

  // Validate modules
  if (!Array.isArray(input.modules)) {
    throw new Error("COMPOSITION_INVALID_MODULE");
  }
  if (input.modules.length > MAX_MODULES) {
    throw new Error("COMPOSITION_SIZE_EXCEEDED");
  }

  const moduleIdsSeen = new Set<ModuleId>();
  const rawModules: CompositionModuleV1[] = [];

  for (const rawMod of input.modules) {
    ensurePlainObject(rawMod);
    assertExactKeys(rawMod, ["id", "owner", "plant_id", "requires", "configuration_refs"]);

    if (!isModuleId(rawMod.id)) {
      throw new Error("COMPOSITION_INVALID_MODULE");
    }
    if (moduleIdsSeen.has(rawMod.id)) {
      throw new Error("COMPOSITION_DUPLICATE_MODULE");
    }
    moduleIdsSeen.add(rawMod.id);

    if (typeof rawMod.owner !== "string" || !SAFE_SYMBOLIC_IDENTIFIER.test(rawMod.owner)) {
      throw new Error("COMPOSITION_INVALID_MODULE");
    }
    if (typeof rawMod.plant_id !== "string" || rawMod.plant_id !== plantId) {
      throw new Error("COMPOSITION_CROSS_PLANT_MISMATCH");
    }

    if (!Array.isArray(rawMod.requires)) {
      throw new Error("COMPOSITION_INVALID_MODULE");
    }
    if (rawMod.requires.length > MAX_REQUIRES_PER_ITEM) {
      throw new Error("COMPOSITION_SIZE_EXCEEDED");
    }

    const requiresSeen = new Set<ModuleId>();
    const normalizedRequires: ModuleId[] = [];
    for (const req of rawMod.requires) {
      if (!isModuleId(req)) {
        throw new Error("COMPOSITION_INVALID_MODULE");
      }
      if (req === rawMod.id) {
        throw new Error("COMPOSITION_SELF_DEPENDENCY");
      }
      if (requiresSeen.has(req)) {
        throw new Error("COMPOSITION_DUPLICATE_REQUIREMENT");
      }
      requiresSeen.add(req);
      normalizedRequires.push(req);
    }

    // Generic minimum dependencies check
    const requiredGeneric = GENERIC_MINIMUM_DEPENDENCIES[rawMod.id];
    for (const genericDep of requiredGeneric) {
      if (!requiresSeen.has(genericDep)) {
        throw new Error("COMPOSITION_MISSING_GENERIC_DEPENDENCY");
      }
    }

    if (!Array.isArray(rawMod.configuration_refs)) {
      throw new Error("COMPOSITION_INVALID_MODULE");
    }
    if (rawMod.configuration_refs.length > MAX_REFS_PER_ITEM) {
      throw new Error("COMPOSITION_SIZE_EXCEEDED");
    }

    const refsSeen = new Set<string>();
    const normalizedRefs: string[] = [];
    for (const ref of rawMod.configuration_refs) {
      const validRef = validateRef(ref);
      if (refsSeen.has(validRef)) {
        throw new Error("COMPOSITION_DUPLICATE_REF");
      }
      refsSeen.add(validRef);
      normalizedRefs.push(validRef);
    }

    normalizedRequires.sort(keyOrder);
    normalizedRefs.sort(keyOrder);

    rawModules.push({
      id: rawMod.id,
      owner: rawMod.owner,
      plant_id: rawMod.plant_id,
      requires: normalizedRequires,
      configuration_refs: normalizedRefs,
    });
  }

  // Dangling module dependencies check
  for (const mod of rawModules) {
    for (const req of mod.requires) {
      if (!moduleIdsSeen.has(req)) {
        throw new Error("COMPOSITION_DANGLING_DEPENDENCY");
      }
    }
  }

  // Cycle detection in module requirements DAG
  const adj = new Map<ModuleId, ModuleId[]>();
  for (const mod of rawModules) {
    adj.set(mod.id, mod.requires);
  }

  const visited = new Map<ModuleId, "visiting" | "visited">();
  function checkCycle(node: ModuleId): void {
    const state = visited.get(node);
    if (state === "visiting") {
      throw new Error("COMPOSITION_CYCLE_DETECTED");
    }
    if (state === "visited") {
      return;
    }
    visited.set(node, "visiting");
    const neighbors = adj.get(node) || [];
    for (const next of neighbors) {
      checkCycle(next);
    }
    visited.set(node, "visited");
  }

  for (const modId of moduleIdsSeen) {
    if (!visited.has(modId)) {
      checkCycle(modId);
    }
  }

  // Validate integrations
  if (!Array.isArray(input.integrations)) {
    throw new Error("COMPOSITION_INVALID_INTEGRATION");
  }
  if (input.integrations.length > MAX_INTEGRATIONS) {
    throw new Error("COMPOSITION_SIZE_EXCEEDED");
  }

  const integrationIdsSeen = new Set<string>();
  const normalizedIntegrations: CompositionIntegrationV1[] = [];

  for (const rawInteg of input.integrations) {
    ensurePlainObject(rawInteg);
    assertExactKeys(rawInteg, ["id", "repository", "plant_id", "requires"]);

    if (typeof rawInteg.id !== "string" || !SAFE_SYMBOLIC_IDENTIFIER.test(rawInteg.id)) {
      throw new Error("COMPOSITION_INVALID_INTEGRATION");
    }
    if (rawInteg.id.toLowerCase() === PRODUCT_ID) {
      throw new Error("COMPOSITION_INTEGRATION_PRODUCT_COLLISION");
    }
    if (integrationIdsSeen.has(rawInteg.id)) {
      throw new Error("COMPOSITION_DUPLICATE_INTEGRATION");
    }
    integrationIdsSeen.add(rawInteg.id);

    if (
      typeof rawInteg.repository !== "string"
      || !GITHUB_REPO_STRICT.test(rawInteg.repository)
      || rawInteg.repository.toLowerCase().endsWith(".git")
    ) {
      throw new Error("COMPOSITION_INVALID_INTEGRATION");
    }
    if (rawInteg.repository.toLowerCase() === PRODUCT_REPOSITORY.toLowerCase()) {
      throw new Error("COMPOSITION_INTEGRATION_PRODUCT_COLLISION");
    }

    if (typeof rawInteg.plant_id !== "string" || rawInteg.plant_id !== plantId) {
      throw new Error("COMPOSITION_CROSS_PLANT_MISMATCH");
    }

    if (!Array.isArray(rawInteg.requires)) {
      throw new Error("COMPOSITION_INVALID_INTEGRATION");
    }
    if (rawInteg.requires.length > MAX_REQUIRES_PER_ITEM) {
      throw new Error("COMPOSITION_SIZE_EXCEEDED");
    }

    const integRequiresSeen = new Set<ModuleId>();
    const integRequires: ModuleId[] = [];
    for (const req of rawInteg.requires) {
      if (!isModuleId(req)) {
        throw new Error("COMPOSITION_INVALID_INTEGRATION");
      }
      if (integRequiresSeen.has(req)) {
        throw new Error("COMPOSITION_DUPLICATE_REQUIREMENT");
      }
      if (!moduleIdsSeen.has(req)) {
        throw new Error("COMPOSITION_DANGLING_DEPENDENCY");
      }
      integRequiresSeen.add(req);
      integRequires.push(req);
    }

    integRequires.sort(keyOrder);

    normalizedIntegrations.push({
      id: rawInteg.id,
      repository: rawInteg.repository,
      plant_id: rawInteg.plant_id,
      requires: integRequires,
    });
  }

  rawModules.sort((left, right) => keyOrder(left.id, right.id));
  normalizedIntegrations.sort((left, right) => keyOrder(left.id, right.id));

  return {
    schema: COMPOSITION_SCHEMA,
    product: {
      id: PRODUCT_ID,
      repository: PRODUCT_REPOSITORY,
    },
    plant: {
      id: input.plant.id,
      owner: input.plant.owner,
      kind: input.plant.kind,
    },
    coordinator: {
      surface: input.coordinator.surface as CoordinatorSurface,
      mode: "native",
    },
    modules: rawModules,
    integrations: normalizedIntegrations,
  };
}

export function validateObservations(input: unknown): CompositionObservationsV1 {
  assertSafeTree(input);
  ensurePlainObject(input);

  const jsonBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (jsonBytes > MAX_INPUT_BYTES) {
    throw new Error("COMPOSITION_SIZE_EXCEEDED");
  }

  assertExactKeys(input, ["schema", "plant_id", "observed_at", "expires_at", "modules"]);

  if (input.schema !== COMPOSITION_OBSERVATIONS_SCHEMA) {
    throw new Error("COMPOSITION_INVALID_SCHEMA");
  }

  if (typeof input.plant_id !== "string" || !SAFE_SYMBOLIC_IDENTIFIER.test(input.plant_id)) {
    throw new Error("COMPOSITION_OBSERVATION_INVALID");
  }

  if (typeof input.observed_at !== "string" || !ISO_UTC_DATE.test(input.observed_at)) {
    throw new Error("COMPOSITION_OBSERVATION_INVALID");
  }
  if (typeof input.expires_at !== "string" || !ISO_UTC_DATE.test(input.expires_at)) {
    throw new Error("COMPOSITION_OBSERVATION_INVALID");
  }

  const obsTime = Date.parse(input.observed_at);
  const expTime = Date.parse(input.expires_at);
  if (Number.isNaN(obsTime) || Number.isNaN(expTime)
    || new Date(obsTime).toISOString() !== input.observed_at
    || new Date(expTime).toISOString() !== input.expires_at) {
    throw new Error("COMPOSITION_OBSERVATION_INVALID");
  }

  if (!Array.isArray(input.modules)) {
    throw new Error("COMPOSITION_OBSERVATION_INVALID");
  }
  if (input.modules.length > MAX_MODULES) {
    throw new Error("COMPOSITION_SIZE_EXCEEDED");
  }

  const moduleIdsSeen = new Set<ModuleId>();
  const normalizedModules: ObservedModuleV1[] = [];

  for (const rawMod of input.modules) {
    ensurePlainObject(rawMod);
    assertExactKeys(rawMod, ["id", "state", "configuration_refs"]);

    if (!isModuleId(rawMod.id)) {
      throw new Error("COMPOSITION_OBSERVATION_INVALID");
    }
    if (moduleIdsSeen.has(rawMod.id)) {
      throw new Error("COMPOSITION_DUPLICATE_MODULE");
    }
    moduleIdsSeen.add(rawMod.id);

    if (
      typeof rawMod.state !== "string"
      || !(VALID_OBSERVED_MODULE_STATES as readonly string[]).includes(rawMod.state)
    ) {
      throw new Error("COMPOSITION_OBSERVATION_INVALID");
    }

    if (!Array.isArray(rawMod.configuration_refs)) {
      throw new Error("COMPOSITION_OBSERVATION_INVALID");
    }
    if (rawMod.configuration_refs.length > MAX_REFS_PER_ITEM) {
      throw new Error("COMPOSITION_SIZE_EXCEEDED");
    }

    const refsSeen = new Set<string>();
    const normalizedRefs: string[] = [];
    for (const ref of rawMod.configuration_refs) {
      const validRef = validateRef(ref);
      if (refsSeen.has(validRef)) {
        throw new Error("COMPOSITION_DUPLICATE_REF");
      }
      refsSeen.add(validRef);
      normalizedRefs.push(validRef);
    }

    normalizedRefs.sort(keyOrder);

    normalizedModules.push({
      id: rawMod.id,
      state: rawMod.state as ObservedModuleState,
      configuration_refs: normalizedRefs,
    });
  }

  normalizedModules.sort((left, right) => keyOrder(left.id, right.id));

  return {
    schema: COMPOSITION_OBSERVATIONS_SCHEMA,
    plant_id: input.plant_id,
    observed_at: input.observed_at,
    expires_at: input.expires_at,
    modules: normalizedModules,
  };
}
