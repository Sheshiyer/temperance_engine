/** Pure destination proposal. Inputs are supplied observations, never probes or authority.
 * The independent review context MUST come from a trusted caller, not this plan.
 * Integrity hashes do not authenticate a device, approve an owner or authorize effects.
 */
import { createHash } from "node:crypto";
import { composeOnboardingProfile } from "../onboarding/composition.ts";
import { createOnboardingPlan } from "../onboarding/planner.ts";
import { validateOnboardingCatalog } from "../onboarding/schema.ts";
import type { OnboardingCatalogV1 } from "../onboarding/contracts.ts";
import type { HostBindingV1, HostProfileV1 } from "../onboarding/public-contracts.ts";
import { assessMigrationCompatibility, validateMigrationSnapshot, validateMigrationTarget,
  type MigrationSnapshotV1, type MigrationTargetV1, type MigrationExpectedContext } from "./contracts.ts";

export type MigrationDigest = `sha256:${string}`;
export type MigrationProfile = "workstation" | "always-on-node" | "recovery";
export type MigrationBackend = "none" | "omniroute" | "9router";
export type MigrationEffect = "local-file" | "configuration-create" | "system-service" | "provider" | "remote";
export interface MigrationDestinationRequirement {
  id: string;
  root_ref: string;
  relative_path: string;
  effect: MigrationEffect;
  prepared_digest: MigrationDigest;
  preimage_digest: MigrationDigest;
  mode: number;
}
/** Metadata binding to an EXISTING onboarding module, not another module catalog. */
export interface MigrationModuleBinding {
  module_id: string;
  owner: string;
  version: string;
  source_digest: MigrationDigest;
  destinations: MigrationDestinationRequirement[];
  runtime_requirements: Array<{ workspace_ref: string; environment_ref: string; node_major: number }>;
}
export interface MigrationDestinationObservation {
  destination_id: string;
  issued_device_ref: string;
  identity_digest: MigrationDigest;
  platform: string;
  architecture: string;
  free_bytes: number | null;
  required_bytes: number;
  port_20128: "free" | "occupied" | "unknown";
  roots: Array<{ root_ref: string; owner: string; identity_digest: MigrationDigest | null; state: "available" | "unavailable" | "unknown" }>;
  runtime_environments: Array<{ environment_ref: string; node_major: number | null }>;
}
export interface MigrationInputDigests {
  snapshot_digest: MigrationDigest;
  source_release_digest: MigrationDigest;
  module_lock_digest: MigrationDigest;
  selection_digest: MigrationDigest;
  destination_identity_digest: MigrationDigest;
  destination_observation_digest: MigrationDigest;
  binding_digest: MigrationDigest;
  configuration_generation_digest: MigrationDigest;
  prepared_intent_digest: MigrationDigest;
  preimage_digest: MigrationDigest;
}
export interface MigrationContextBindings extends MigrationInputDigests {
  destination_id: string;
  issued_device_ref: string;
  profile: MigrationProfile;
  backend: MigrationBackend;
  selected_modules: string[];
}
/** Independently pinned source/compatibility expectations, available before planning.
 * This context never claims to review a final plan or issue effect authority.
 */
export interface MigrationSourceContext extends MigrationContextBindings {
  pinned_at: string;
  expires_at: string;
}
/** Issued after planning by an independent reviewer; pins the complete final
 * proposal, including step order. Task4 still requires fresh effect preflight.
 */
export interface MigrationPlanReviewContext extends MigrationContextBindings {
  plan_digest: MigrationDigest;
  reviewed_at: string;
  expires_at: string;
}
export interface MigrationPlannerInputs {
  snapshot: MigrationSnapshotV1;
  target: MigrationTargetV1;
  profile: MigrationProfile;
  selected_modules: string[];
  backend: MigrationBackend;
  catalog: OnboardingCatalogV1;
  host_profile: HostProfileV1;
  private_binding: HostBindingV1;
  module_bindings: MigrationModuleBinding[];
  destination: MigrationDestinationObservation;
  observations: Array<{ capability_id: string; available: boolean }>;
  expected_context: MigrationExpectedContext;
  now: string;
}
export interface CreateMigrationPlanOptions extends MigrationPlannerInputs { source_context: MigrationSourceContext }
export interface MigrationPlanStep extends MigrationDestinationRequirement {
  module_id: string;
  owner: "temperance";
  module_version: string;
  source_digest: MigrationDigest;
  effect: "local-file" | "configuration-create";
  depends_on: string[];
  preconditions: ["fresh-exact-review", "exclusive-owned-claim", "fresh-destination-preflight", "exact-preimage"];
  verifier_probes: ["prepared-bytes-and-mode", "destination-bytes-and-mode"];
  rollback_requirements: ["owned-preimage", "compatible-configuration-generation", "exclusive-owned-claim"];
}
export interface MigrationPlanV1 extends MigrationInputDigests {
  schema: "temperance.migration.plan.v1";
  version: { major: 1; minor: 0 };
  status: "PROPOSED";
  execution_authorized: false;
  profile: MigrationProfile;
  backend: MigrationBackend;
  destination_id: string;
  issued_device_ref: string;
  selected_modules: string[];
  generated_at: string;
  source_context_pinned_at: string;
  source_context_expires_at: string;
  steps: MigrationPlanStep[];
  holds: Array<{ reason: string; subject: string }>;
  observations: string[];
  plan_digest: MigrationDigest;
}

const DIGEST_KEYS = ["snapshot_digest", "source_release_digest", "module_lock_digest", "selection_digest", "destination_identity_digest",
  "destination_observation_digest", "binding_digest", "configuration_generation_digest", "prepared_intent_digest", "preimage_digest"] as const;
const REQUIREMENT_KEYS = ["id", "root_ref", "relative_path", "effect", "prepared_digest", "preimage_digest", "mode"];
const STEP_KEYS = [...REQUIREMENT_KEYS, "module_id", "owner", "module_version", "source_digest", "depends_on", "preconditions", "verifier_probes", "rollback_requirements"];
const PRECONDITIONS = ["fresh-exact-review", "exclusive-owned-claim", "fresh-destination-preflight", "exact-preimage"] as const;
const PROBES = ["prepared-bytes-and-mode", "destination-bytes-and-mode"] as const;
const ROLLBACK = ["owned-preimage", "compatible-configuration-generation", "exclusive-owned-claim"] as const;
const digest = (v: unknown): v is MigrationDigest => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const ref = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(v)
  && !v.includes("..") && !/localhost|127\.0\.0\.1|https?:/i.test(v);
const version = (v: unknown): v is string => typeof v === "string" && /^[0-9][A-Za-z0-9.+_-]{0,63}$/.test(v);
const profile = (v: unknown): v is MigrationProfile => ["workstation", "always-on-node", "recovery"].includes(v as string);
const backend = (v: unknown): v is MigrationBackend => ["none", "omniroute", "9router"].includes(v as string);
const relative = (v: unknown): v is string => typeof v === "string" && v.length <= 512 && v.split("/").every(p => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && p !== "." && p !== "..");
const foreign = (v: string): boolean => /(?:^|[^a-z0-9])(?:cambium|snow[-_.]?gloves|hermes|vault|d1)(?:$|[^a-z0-9])/i.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function timestamp(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) return false;
  const time = Date.parse(v);
  return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === v.replace(".000Z", "Z");
}
function closed(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
}
const list = <T>(v: unknown, test: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.length <= 4096 && v.every(test);
const unique = (v: readonly string[]) => new Set(v).size === v.length;
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("MIGRATION_DIGEST_INPUT_INVALID");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("MIGRATION_DIGEST_INPUT_INVALID");
}
/** Object keys are unordered; arrays retain semantic order (especially plan steps).
 * Input set-like collections are explicitly normalized below, never by locale.
 */
export function calculateMigrationDigest(value: unknown): MigrationDigest {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
function sorted<T>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => { const x = canonical(a), y = canonical(b); return x < y ? -1 : x > y ? 1 : 0; });
}
/** Snapshot/expected-context arrays are reference sets, unlike command argv or ordered steps. */
function referenceSets(value: unknown): unknown {
  if (Array.isArray(value)) return sorted(value.map(referenceSets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, referenceSets(child)]));
  return value;
}
function targetEntries(input: MigrationPlannerInputs) {
  return sorted(input.module_bindings.filter(m => input.selected_modules.includes(m.module_id)).flatMap(m => m.destinations.map(d => ({
    ...d, module_id: m.module_id, owner: m.owner, module_version: m.version, source_digest: m.source_digest,
  }))));
}
export function calculateMigrationEffectDigests(entries: ReturnType<typeof targetEntries>, scope: Pick<MigrationInputDigests, "source_release_digest" | "module_lock_digest" | "binding_digest">) {
  const prepared = entries.map(({ id, root_ref, relative_path, effect, prepared_digest, mode, module_id, owner, module_version, source_digest }) =>
    ({ id, root_ref, relative_path, effect, prepared_digest, mode, module_id, owner, module_version, source_digest }));
  return {
    prepared_intent_digest: calculateMigrationDigest(sorted(prepared)),
    preimage_digest: calculateMigrationDigest(sorted(entries.map(({ id, preimage_digest }) => ({ id, preimage_digest })))),
    configuration_generation_digest: calculateMigrationDigest({ source_release_digest: scope.source_release_digest, module_lock_digest: scope.module_lock_digest, binding_digest: scope.binding_digest, targets: sorted(entries.map(({ id, root_ref, relative_path, prepared_digest, mode }) => ({ id, root_ref, relative_path, prepared_digest, mode }))) }),
  };
}
/** Hash only the supplied private value; this helper performs no secret reads. */
export function calculateMigrationBindingDigest(binding: HostBindingV1): MigrationDigest {
  return calculateMigrationDigest(referenceSets(binding));
}
/** Hash freshly supplied observations; this helper never probes the destination. */
export function calculateMigrationDestinationObservationDigest(destination: MigrationDestinationObservation): MigrationDigest {
  return calculateMigrationDigest(referenceSets(destination));
}
/** Integrity helper for independent review tooling. Calling this is NOT approval. */
export function calculateMigrationInputDigests(input: MigrationPlannerInputs): MigrationInputDigests {
  const { now: _now, ...expected } = input.expected_context;
  const catalog = { ...input.catalog, modules: sorted(input.catalog.modules.map(m => ({ ...m, depends_on: sorted(m.depends_on), requires: sorted(m.requires) }))) };
  return {
    snapshot_digest: calculateMigrationDigest(referenceSets(input.snapshot)),
    source_release_digest: input.snapshot.source_release_digest,
    module_lock_digest: input.snapshot.module_lock_digest,
    selection_digest: calculateMigrationDigest({ profile: input.profile, backend: input.backend, selected_modules: sorted(input.selected_modules),
      catalog, host_profile: referenceSets(input.host_profile), target: referenceSets(input.target),
      module_bindings: referenceSets(input.module_bindings), expected_context: referenceSets(expected), observations: sorted(input.observations) }),
    destination_identity_digest: input.destination.identity_digest,
    destination_observation_digest: calculateMigrationDestinationObservationDigest(input.destination),
    binding_digest: calculateMigrationBindingDigest(input.private_binding),
    ...calculateMigrationEffectDigests(targetEntries(input), { source_release_digest: input.snapshot.source_release_digest, module_lock_digest: input.snapshot.module_lock_digest, binding_digest: calculateMigrationBindingDigest(input.private_binding) }),
  };
}
export function calculateMigrationPlanDigest(plan: Omit<MigrationPlanV1, "plan_digest"> | MigrationPlanV1): MigrationDigest {
  const { plan_digest: _digest, ...body } = plan as MigrationPlanV1;
  return calculateMigrationDigest(body);
}
export function verifyMigrationPlanDigest(value: MigrationPlanV1): boolean {
  try { return digest(value.plan_digest) && calculateMigrationPlanDigest(value) === value.plan_digest; } catch { return false; }
}
function validContextBindings(v: unknown, extraKeys: readonly string[]): v is MigrationContextBindings & Record<string, unknown> {
  return closed(v, [...DIGEST_KEYS, "destination_id", "issued_device_ref", "profile", "backend", "selected_modules", ...extraKeys])
    && DIGEST_KEYS.every(k => digest(v[k])) && ref(v.destination_id) && ref(v.issued_device_ref) && profile(v.profile) && backend(v.backend)
    && list(v.selected_modules, ref) && unique(v.selected_modules);
}
function validSourceContext(v: unknown): v is MigrationSourceContext {
  return validContextBindings(v, ["pinned_at", "expires_at"]) && timestamp(v.pinned_at) && timestamp(v.expires_at)
    && Date.parse(v.pinned_at) < Date.parse(v.expires_at);
}
function validReview(v: unknown): v is MigrationPlanReviewContext {
  return validContextBindings(v, ["plan_digest", "reviewed_at", "expires_at"]) && digest(v.plan_digest)
    && timestamp(v.reviewed_at) && timestamp(v.expires_at) && Date.parse(v.reviewed_at) < Date.parse(v.expires_at);
}
function validRequirement(v: unknown): v is MigrationDestinationRequirement {
  return closed(v, REQUIREMENT_KEYS) && ref(v.id) && ref(v.root_ref) && relative(v.relative_path)
    && ["local-file", "configuration-create", "system-service", "provider", "remote"].includes(v.effect as string)
    && digest(v.prepared_digest) && digest(v.preimage_digest) && integer(v.mode) && v.mode <= 0o777;
}
function validModule(v: unknown): v is MigrationModuleBinding {
  return closed(v, ["module_id", "owner", "version", "source_digest", "destinations", "runtime_requirements"])
    && ref(v.module_id) && ref(v.owner) && version(v.version) && digest(v.source_digest) && list(v.destinations, validRequirement)
    && list(v.runtime_requirements, (r): r is MigrationModuleBinding["runtime_requirements"][number] => closed(r, ["workspace_ref", "environment_ref", "node_major"])
      && ref(r.workspace_ref) && ref(r.environment_ref) && integer(r.node_major));
}
function validDestination(v: unknown): v is MigrationDestinationObservation {
  return closed(v, ["destination_id", "issued_device_ref", "identity_digest", "platform", "architecture", "free_bytes", "required_bytes", "port_20128", "roots", "runtime_environments"])
    && ref(v.destination_id) && ref(v.issued_device_ref) && digest(v.identity_digest) && ref(v.platform) && ref(v.architecture)
    && (v.free_bytes === null || integer(v.free_bytes)) && integer(v.required_bytes) && ["free", "occupied", "unknown"].includes(v.port_20128 as string)
    && list(v.roots, (r): r is MigrationDestinationObservation["roots"][number] => closed(r, ["root_ref", "owner", "identity_digest", "state"])
      && ref(r.root_ref) && ref(r.owner) && (r.identity_digest === null || digest(r.identity_digest)) && ["available", "unavailable", "unknown"].includes(r.state as string))
    && list(v.runtime_environments, (r): r is MigrationDestinationObservation["runtime_environments"][number] => closed(r, ["environment_ref", "node_major"])
      && ref(r.environment_ref) && (r.node_major === null || integer(r.node_major)));
}
function assertInput(input: CreateMigrationPlanOptions): void {
  if (!closed(input, ["snapshot", "target", "profile", "selected_modules", "backend", "catalog", "host_profile", "private_binding", "module_bindings", "destination", "observations", "expected_context", "now", "source_context"])
    || !validateMigrationSnapshot(input.snapshot).ok || !validateMigrationTarget(input.target) || !profile(input.profile) || !backend(input.backend)
    || !list(input.selected_modules, ref) || !unique(input.selected_modules) || !validateOnboardingCatalog(input.catalog)
    || !list(input.module_bindings, validModule) || !validDestination(input.destination) || !timestamp(input.now) || !validSourceContext(input.source_context)
    || !list(input.observations, (v): v is MigrationPlannerInputs["observations"][number] => closed(v, ["capability_id", "available"]) && ref(v.capability_id) && typeof v.available === "boolean")
    || !unique(input.observations.map(o => o.capability_id))) throw new Error("MIGRATION_INPUT_INVALID");
}
function contextMatches(plan: MigrationContextBindings, expected: MigrationContextBindings): boolean {
  return DIGEST_KEYS.every(key => plan[key] === expected[key]) && plan.destination_id === expected.destination_id && plan.issued_device_ref === expected.issued_device_ref
    && plan.profile === expected.profile && plan.backend === expected.backend && canonical(sorted(plan.selected_modules)) === canonical(sorted(expected.selected_modules));
}
/** Checks a final review issued AFTER proposal generation, never returns permission.
 * The required ordering is generated_at <= reviewed_at <= now < expires_at.
 * Independently pinned source context must also remain fresh. Task4 must ALSO
 * perform fresh independent destination/preimage checks and claim ownership.
 */
export function assertMigrationPlanContext(plan: unknown, review: MigrationPlanReviewContext, now: string): asserts plan is MigrationPlanV1 {
  if (!validateMigrationPlan(plan)) throw new Error("MIGRATION_PLAN_INVALID");
  if (plan.holds.length) throw new Error("MIGRATION_PLAN_HELD");
  if (!validReview(review) || !timestamp(now)) throw new Error("REVIEW_CONTEXT_INVALID");
  if (review.plan_digest !== plan.plan_digest) throw new Error("REVIEW_PLAN_MISMATCH");
  if (!contextMatches(plan, review)) throw new Error("REVIEW_CONTEXT_MISMATCH");
  if (Date.parse(review.reviewed_at) < Date.parse(plan.generated_at)) throw new Error("REVIEW_PREDATES_PLAN");
  if (Date.parse(now) < Date.parse(review.reviewed_at)) throw new Error("REVIEW_NOT_YET_VALID");
  if (Date.parse(now) >= Date.parse(review.expires_at)) throw new Error("REVIEW_EXPIRED");
  if (Date.parse(now) >= Date.parse(plan.source_context_expires_at)) throw new Error("SOURCE_CONTEXT_EXPIRED");
}

export function validateMigrationPlan(value: unknown): value is MigrationPlanV1 {
  try {
    if (!closed(value, ["schema", "version", "status", "execution_authorized", "profile", "backend", "destination_id", "issued_device_ref", "selected_modules", "generated_at", "source_context_pinned_at", "source_context_expires_at", "steps", "holds", "observations", "plan_digest", ...DIGEST_KEYS])
      || value.schema !== "temperance.migration.plan.v1" || !closed(value.version, ["major", "minor"]) || value.version.major !== 1 || value.version.minor !== 0
      || value.status !== "PROPOSED" || value.execution_authorized !== false || !profile(value.profile) || !backend(value.backend)
      || !ref(value.destination_id) || !ref(value.issued_device_ref) || !list(value.selected_modules, ref) || !unique(value.selected_modules)
      || !timestamp(value.generated_at) || !timestamp(value.source_context_pinned_at) || !timestamp(value.source_context_expires_at) || Date.parse(value.source_context_pinned_at as string) >= Date.parse(value.source_context_expires_at as string) || !DIGEST_KEYS.every(key => digest(value[key]))
      || !list(value.observations, ref) || !list(value.holds, (h): h is MigrationPlanV1["holds"][number] => closed(h, ["reason", "subject"]) && ref(h.reason) && ref(h.subject))
      || !list(value.steps, (s): s is MigrationPlanStep => {
        if (!closed(s, STEP_KEYS)) return false;
        const requirement = Object.fromEntries(REQUIREMENT_KEYS.map(k => [k, s[k]]));
        return validRequirement(requirement) && ["local-file", "configuration-create"].includes(s.effect as string) && s.owner === "temperance"
          && ref(s.module_id) && !foreign(s.module_id) && version(s.module_version) && digest(s.source_digest) && !foreign(s.relative_path as string) && !foreign(s.root_ref as string)
          && list(s.depends_on, ref) && unique(s.depends_on) && canonical(s.preconditions) === canonical(PRECONDITIONS)
          && canonical(s.verifier_probes) === canonical(PROBES) && canonical(s.rollback_requirements) === canonical(ROLLBACK);
      })) return false;
    const plan = value as unknown as MigrationPlanV1;
    if (!plan.holds.length && (Date.parse(plan.generated_at) < Date.parse(plan.source_context_pinned_at) || Date.parse(plan.generated_at) >= Date.parse(plan.source_context_expires_at))) return false;
    if (!verifyMigrationPlanDigest(plan) || (plan.holds.length > 0 && plan.steps.length > 0) || (plan.profile === "recovery" && plan.steps.length > 0)) return false;
    if (!unique(plan.steps.map(s => s.id))) return false;
    const seen = new Set<string>();
    for (const step of plan.steps) {
      if (!plan.selected_modules.includes(step.module_id) || step.depends_on.some(id => !seen.has(id))) return false;
      seen.add(step.id);
    }
    if (hasDestinationConflict(plan.steps)) return false;
    if (!plan.holds.length) {
      const derived = calculateMigrationEffectDigests(plan.steps.map(({ depends_on: _d, preconditions: _p, verifier_probes: _v, rollback_requirements: _r, ...step }) => step), plan);
      if (Object.entries(derived).some(([key, hash]) => plan[key as keyof MigrationInputDigests] !== hash)) return false;
    }
    return true;
  } catch { return false; }
}
function hasDestinationConflict(entries: Array<{ root_ref: string; relative_path: string }>): boolean {
  return entries.some((a, i) => entries.slice(i + 1).some(b => a.root_ref.toLowerCase() === b.root_ref.toLowerCase()
    && (a.relative_path.toLowerCase() === b.relative_path.toLowerCase() || a.relative_path.toLowerCase().startsWith(`${b.relative_path.toLowerCase()}/`) || b.relative_path.toLowerCase().startsWith(`${a.relative_path.toLowerCase()}/`))));
}

export async function createMigrationPlan(input: CreateMigrationPlanOptions): Promise<MigrationPlanV1> {
  // Detach caller data before the first await; neither concurrent caller mutation
  // nor the onboarding adapter may change the digest scope mid-proposal.
  let options: CreateMigrationPlanOptions;
  try { options = structuredClone(input); assertInput(options); } catch { throw new Error("MIGRATION_INPUT_INVALID"); }
  const holds: MigrationPlanV1["holds"] = [];
  const observations = new Set<string>();
  const hold = (reason: string, subject = "destination") => { if (!holds.some(h => h.reason === reason && h.subject === subject)) holds.push({ reason, subject }); };
  let composed;
  try { composed = composeOnboardingProfile(options.host_profile, options.private_binding); } catch { throw new Error("MIGRATION_BINDING_INVALID"); }
  let hashes: MigrationInputDigests;
  try { hashes = calculateMigrationInputDigests(options); } catch { throw new Error("MIGRATION_INPUT_INVALID"); }
  const identity = { destination_id: options.destination.destination_id, issued_device_ref: options.destination.issued_device_ref,
    profile: options.profile, backend: options.backend, selected_modules: sorted(options.selected_modules) };
  if (!contextMatches({ ...hashes, ...identity }, options.source_context)) hold("SOURCE_CONTEXT_MISMATCH");
  if (Date.parse(options.now) < Date.parse(options.source_context.pinned_at)) hold("SOURCE_CONTEXT_NOT_YET_VALID");
  if (Date.parse(options.now) >= Date.parse(options.source_context.expires_at)) hold("SOURCE_CONTEXT_EXPIRED");
  if (options.expected_context.now !== options.now) hold("EVALUATION_TIME_MISMATCH");
  const assessment = assessMigrationCompatibility(options.snapshot, options.expected_context);
  assessment.holds.forEach(reason => hold(reason.split(":")[0], "compatibility"));
  assessment.observations.forEach(reason => observations.add(reason.split(":")[0]));
  if (options.snapshot.external_product_refs?.length) observations.add("EXTERNAL_PRODUCT_NO_AUTHORITY");
  if (options.target.destination_id !== identity.destination_id || options.target.target_profile !== options.profile
    || canonical(sorted(options.target.requested_modules)) !== canonical(identity.selected_modules)) hold("TARGET_SELECTION_MISMATCH");
  if (options.target.held_requirements.length) hold("TARGET_REQUIREMENT_HELD");
  if (options.destination.platform !== "darwin" || !["arm64", "x64"].includes(options.destination.architecture)) hold("UNSUPPORTED_PLATFORM");
  if (options.destination.free_bytes === null) hold("CAPACITY_UNKNOWN");
  else if (options.destination.free_bytes < options.destination.required_bytes) hold("CAPACITY_INSUFFICIENT");
  if (options.backend === "omniroute") hold("ROUTER_ADAPTER_UNVERIFIED");
  if (options.backend !== "none") {
    if (options.destination.port_20128 === "occupied") hold("ROUTER_PORT_CONFLICT");
    if (options.destination.port_20128 === "unknown") hold("ROUTER_PORT_UNKNOWN");
  }
  const selected = options.module_bindings.filter(m => options.selected_modules.includes(m.module_id));
  if (!unique(options.module_bindings.map(m => m.module_id))) hold("DUPLICATE_MODULE_OWNER");
  if (!unique(options.catalog.modules.map(m => m.id))) hold("DUPLICATE_MODULE_ID");
  if (!unique(options.destination.roots.map(r => r.root_ref))) hold("DUPLICATE_LOGICAL_ID");
  if (!unique(options.destination.runtime_environments.map(r => r.environment_ref))) hold("RUNTIME_ENVIRONMENT_CONFLICT");
  for (const id of options.selected_modules) {
    if (!options.catalog.modules.some(m => m.id === id)) hold("MODULE_UNKNOWN", id);
    if (!selected.some(m => m.module_id === id)) hold("MODULE_BINDING_MISSING", id);
  }
  const entries = targetEntries(options);
  if (!unique(entries.map(e => e.id))) hold("DUPLICATE_LOGICAL_ID");
  if (hasDestinationConflict(entries)) hold("DESTINATION_CONFLICT");
  // Detect aliases/overlapping private roots without disclosing their values.
  const usedRoots = [...new Set(entries.map(e => e.root_ref))];
  const boundRoots = usedRoots.map(root => ({ root, path: composed.variables[root] }));
  for (const [index, a] of boundRoots.entries()) for (const b of boundRoots.slice(index + 1)) {
    if (a.path && b.path && (a.path.toLowerCase() === b.path.toLowerCase() || a.path.toLowerCase().startsWith(`${b.path.toLowerCase()}/`) || b.path.toLowerCase().startsWith(`${a.path.toLowerCase()}/`))) hold("DESTINATION_CONFLICT");
  }
  for (const root of usedRoots) {
    const observed = options.destination.roots.find(r => r.root_ref === root);
    if (!observed || observed.identity_digest === null) hold("ROOT_IDENTITY_UNKNOWN", root);
    if (!observed || observed.state !== "available") hold("ROOT_UNAVAILABLE", root);
    if (!options.host_profile.variables.some(v => v.name === root && v.kind === "absolute-path") || !composed.variables[root]) hold("ROOT_BINDING_MISSING", root);
    if (observed?.owner !== "temperance" || foreign(root) || (composed.variables[root] && foreign(composed.variables[root]))) hold("OWNER_SCOPE_FORBIDDEN", root);
  }
  const environments = new Map<string, number>();
  const workspaces = new Map<string, string>();
  for (const module of selected) {
    if (module.owner !== "temperance" || foreign(module.module_id)) hold("OWNER_SCOPE_FORBIDDEN", module.module_id);
    if (module.module_id.startsWith("provider.") || options.catalog.modules.find(m => m.id === module.module_id)?.runtime_contract) hold("OWNER_EFFECT_REVIEW_REQUIRED", module.module_id);
    for (const entry of module.destinations) {
      if (foreign(entry.relative_path) || foreign(entry.id) || /(?:^|\/)(?:LaunchAgents|LaunchDaemons)(?:\/|$)/i.test(entry.relative_path)) hold("OWNER_SCOPE_FORBIDDEN", entry.id);
      if (!["local-file", "configuration-create"].includes(entry.effect)) hold("OWNER_EFFECT_REVIEW_REQUIRED", entry.id);
    }
    for (const runtime of module.runtime_requirements) {
      if (["global", "system", "default"].includes(runtime.environment_ref.toLowerCase())) hold("GLOBAL_RUNTIME_FORBIDDEN", module.module_id);
      if (![22, 26].includes(runtime.node_major)) hold("UNSUPPORTED_RUNTIME", module.module_id);
      if ((environments.has(runtime.environment_ref) && environments.get(runtime.environment_ref) !== runtime.node_major)
        || (workspaces.has(runtime.workspace_ref) && workspaces.get(runtime.workspace_ref) !== runtime.environment_ref)) hold("RUNTIME_ENVIRONMENT_CONFLICT", module.module_id);
      environments.set(runtime.environment_ref, runtime.node_major); workspaces.set(runtime.workspace_ref, runtime.environment_ref);
      const observed = options.destination.runtime_environments.find(e => e.environment_ref === runtime.environment_ref);
      if (!observed || observed.node_major === null) hold("RUNTIME_UNAVAILABLE", module.module_id);
      else if (observed.node_major !== runtime.node_major) hold("RUNTIME_VERSION_MISMATCH", module.module_id);
    }
  }
  let order: string[] = [];
  try {
    const onboarding = await createOnboardingPlan({ catalog: { ...options.catalog, modules: [...options.catalog.modules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(m => ({ ...m, depends_on: sorted(m.depends_on) })) },
      profile: composed, selections: new Set(options.selected_modules), dryRun: true,
      adapter: { now: () => new Date(options.now), probe: async requirement => {
        const observed = options.observations.find(o => o.capability_id === requirement.id);
        return { capability_id: requirement.id, available: observed?.available === true,
          reason_code: observed?.available === true ? "AVAILABLE" : "PROBE_FAILED", evidence: [] };
      } } });
    order = onboarding.install_order;
    // Never export titles, installer commands, private variables, raw errors or probe evidence.
    for (const module of onboarding.modules) for (const h of module.holds) hold(h.reason_code, module.id);
  } catch { hold("ONBOARDING_INPUT_INVALID"); }
  if (options.profile === "recovery" && (options.selected_modules.length || entries.length)) hold("RECOVERY_READ_ONLY");
  const steps: MigrationPlanStep[] = [];
  if (!holds.length) for (const moduleId of order) {
    // Preserve dependencies through modules whose satisfied prerequisites have
    // no local file effect of their own. Onboarding already ruled out cycles.
    const dependencies = new Set<string>();
    const visit = (id: string): void => {
      for (const dependency of options.catalog.modules.find(m => m.id === id)!.depends_on) {
        if (!dependencies.has(dependency)) { dependencies.add(dependency); visit(dependency); }
      }
    };
    visit(moduleId);
    for (const entry of entries.filter(e => e.module_id === moduleId)) steps.push({ ...entry, owner: "temperance", effect: entry.effect as MigrationPlanStep["effect"],
      depends_on: sorted(steps.filter(s => dependencies.has(s.module_id)).map(s => s.id)), preconditions: [...PRECONDITIONS], verifier_probes: [...PROBES], rollback_requirements: [...ROLLBACK] });
  }
  const body: Omit<MigrationPlanV1, "plan_digest"> = { schema: "temperance.migration.plan.v1", version: { major: 1, minor: 0 }, status: "PROPOSED", execution_authorized: false,
    ...identity, ...hashes, generated_at: options.now, source_context_pinned_at: options.source_context.pinned_at, source_context_expires_at: options.source_context.expires_at, steps, holds: sorted(holds), observations: sorted([...observations]) };
  const plan = { ...body, plan_digest: calculateMigrationPlanDigest(body) };
  if (!validateMigrationPlan(plan)) throw new Error("MIGRATION_PLAN_INVALID");
  return plan;
}
