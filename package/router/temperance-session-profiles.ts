import manifestJson from "./temperance-session-profiles.json";

export const CAPABILITY_TIERS = ["S", "A", "B"] as const;
export const FALLBACK_READINESS_STATES = ["ready", "degraded", "candidate"] as const;
export const PROMOTION_STATES = ["proven", "candidate"] as const;
export const CANDIDATE_ONLY_ALIAS = "omniroute/te-orchestrate";

export const CURATED_OPENCODE_ALIASES = [
  "temperance/temperance-auto",
  "omniroute/te-fast",
  "omniroute/te-algorithm",
  "omniroute/te-build",
  "omniroute/te-plan",
  "omniroute/te-dispatch",
  "omniroute/te-validate",
  "omniroute/codex/gpt-5.3-codex-spark",
  "omniroute/te-reason",
  "omniroute/te-creative",
  "omniroute/te-write",
  "omniroute/te-write-critique",
  "omniroute/te-write-research",
  "omniroute/te-write-media",
] as const;

export const REQUIRED_PROFILE_MODELS = {
  "temperance-auto": "temperance/temperance-auto",
  "temperance-native": "omniroute/te-fast",
  "temperance-algorithm": "omniroute/te-algorithm",
  "temperance-continuity": "omniroute/te-build",
} as const;

export const REQUIRED_HELPER_MODELS = {
  planner: "omniroute/te-plan",
  worker: "omniroute/te-dispatch",
  validator: "omniroute/te-validate",
  "code-fast": "omniroute/codex/gpt-5.3-codex-spark",
} as const;

export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];
export type FallbackReadiness = (typeof FALLBACK_READINESS_STATES)[number];
export type PromotionState = (typeof PROMOTION_STATES)[number];
export type EvidenceKind = "content" | "tool" | "health" | "receipt";

export interface CapabilityTierDefinition {
  rank: number;
  role: string;
}

export interface FallbackReadinessDefinition {
  eligible_for_default: boolean;
  eligible_for_fallback: boolean;
}

export interface ProviderDefinition {
  promotion_state: PromotionState;
}

export interface PromotionEvidence {
  content: string | null;
  tool: string | null;
  health: string | null;
  receipt: string | null;
}

export interface ModelDefinition {
  provider: string;
  capability_tier: CapabilityTier;
  fallback_readiness: FallbackReadiness;
  failure_domain: string;
  promotion: {
    state: PromotionState;
    evidence: PromotionEvidence;
  };
}

export interface AliasLimits {
  context: number;
  output: number;
}

export interface OpenCodeAlias {
  id: string;
  provider: string;
  model: string;
  limits: AliasLimits;
}

export interface CandidateAlias extends OpenCodeAlias {
  status: "candidate-only";
}

export interface SessionProfile {
  default_model: string;
  fallback_models: string[];
  capability_tier: CapabilityTier;
  fallback_readiness: FallbackReadiness;
  freeze_coordinator_identity: boolean;
  allow_silent_downgrade: boolean;
}

export interface HelperAgentProfile {
  default_model: string;
  fallback_models: string[];
  escalation_models?: string[];
  capability_tier: CapabilityTier;
  max_subagent_depth: number;
}

export interface TierTransition {
  from: CapabilityTier;
  to: CapabilityTier;
}

export interface FallbackTierTransition extends TierTransition {
  requires_log: boolean;
}

export interface SessionProfileManifest {
  version: 1;
  max_subagent_depth: number;
  capability_tiers: Record<CapabilityTier, CapabilityTierDefinition>;
  fallback_readiness: Record<FallbackReadiness, FallbackReadinessDefinition>;
  providers: Record<string, ProviderDefinition>;
  models: Record<string, ModelDefinition>;
  aliases: OpenCodeAlias[];
  candidate_aliases: CandidateAlias[];
  profiles: Record<string, SessionProfile>;
  helper_agents: Record<string, HelperAgentProfile>;
  tier_policy: {
    algorithm: {
      primary_profile: string;
      coordinator_tier: CapabilityTier;
      allow_silent_downgrade: boolean;
      retry_at: {
        tier: CapabilityTier;
        profile: string;
        requires_explicit_selection: boolean;
      };
    };
    fallback_transitions: FallbackTierTransition[];
    worker: {
      initial_tier: CapabilityTier;
      escalation_edges: TierTransition[];
      downgrade_within_same_task: "reject";
      downgrade_requires_new_task: boolean;
    };
  };
  failure_domain_policy: {
    independence_sets: Array<{
      id: string;
      profiles: string[];
    }>;
  };
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
}

export const sessionProfileManifest = manifestJson as SessionProfileManifest;

const TIER_RANK: Readonly<Record<CapabilityTier, number>> = {
  S: 3,
  A: 2,
  B: 1,
};

const REQUIRED_PROFILE_TIERS: Readonly<Record<string, CapabilityTier>> = {
  "temperance-auto": "S",
  "temperance-native": "B",
  "temperance-algorithm": "S",
  "temperance-continuity": "A",
};

const REQUIRED_HELPER_TIERS: Readonly<Record<string, CapabilityTier>> = {
  planner: "S",
  worker: "B",
  validator: "A",
  "code-fast": "B",
};

const REQUIRED_EVIDENCE: readonly EvidenceKind[] = [
  "content",
  "tool",
  "health",
  "receipt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isCapabilityTier(value: unknown): value is CapabilityTier {
  return typeof value === "string" && (CAPABILITY_TIERS as readonly string[]).includes(value);
}

function isReadiness(value: unknown): value is FallbackReadiness {
  return typeof value === "string"
    && (FALLBACK_READINESS_STATES as readonly string[]).includes(value);
}

function isPromotionState(value: unknown): value is PromotionState {
  return typeof value === "string" && (PROMOTION_STATES as readonly string[]).includes(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function recordOrEmpty(value: unknown, error: string, errors: string[]): Record<string, unknown> {
  if (isRecord(value)) return value;
  errors.push(error);
  return {};
}

function arrayOrEmpty(value: unknown, error: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(error);
  return [];
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return actualSet.size === expected.length && expected.every((item) => actualSet.has(item));
}

function operationalReferences(root: Record<string, unknown>): Array<{ owner: string; model: string }> {
  const references: Array<{ owner: string; model: string }> = [];
  const profiles = isRecord(root.profiles) ? root.profiles : {};
  const helpers = isRecord(root.helper_agents) ? root.helper_agents : {};

  for (const [name, unknownProfile] of Object.entries(profiles)) {
    if (!isRecord(unknownProfile)) continue;
    if (typeof unknownProfile.default_model === "string") {
      references.push({ owner: `profile:${name}:default`, model: unknownProfile.default_model });
    }
    for (const model of stringArray(unknownProfile.fallback_models) ?? []) {
      references.push({ owner: `profile:${name}:fallback`, model });
    }
  }

  for (const [name, unknownHelper] of Object.entries(helpers)) {
    if (!isRecord(unknownHelper)) continue;
    if (typeof unknownHelper.default_model === "string") {
      references.push({ owner: `helper:${name}:default`, model: unknownHelper.default_model });
    }
    for (const model of stringArray(unknownHelper.fallback_models) ?? []) {
      references.push({ owner: `helper:${name}:fallback`, model });
    }
    for (const model of stringArray(unknownHelper.escalation_models) ?? []) {
      references.push({ owner: `helper:${name}:escalation`, model });
    }
  }

  return references;
}

function validateCapabilityDefinitions(root: Record<string, unknown>, errors: string[]): void {
  const tiers = recordOrEmpty(
    root.capability_tiers,
    "capability-tiers-missing-or-invalid",
    errors,
  );
  if (!sameMembers(Object.keys(tiers), CAPABILITY_TIERS)) {
    errors.push("capability-tier-set-mismatch");
  }
  for (const tier of CAPABILITY_TIERS) {
    const definition = tiers[tier];
    if (!isRecord(definition)) {
      errors.push(`capability-tier-definition-invalid:${tier}`);
      continue;
    }
    if (definition.rank !== TIER_RANK[tier]) {
      errors.push(`capability-tier-rank-invalid:${tier}`);
    }
    if (!isNonEmptyString(definition.role)) {
      errors.push(`capability-tier-role-missing:${tier}`);
    }
  }

  const readiness = recordOrEmpty(
    root.fallback_readiness,
    "fallback-readiness-missing-or-invalid",
    errors,
  );
  if (!sameMembers(Object.keys(readiness), FALLBACK_READINESS_STATES)) {
    errors.push("fallback-readiness-set-mismatch");
  }
  for (const state of FALLBACK_READINESS_STATES) {
    const definition = readiness[state];
    if (!isRecord(definition)) {
      errors.push(`fallback-readiness-definition-invalid:${state}`);
      continue;
    }
    if (typeof definition.eligible_for_default !== "boolean") {
      errors.push(`fallback-readiness-default-eligibility-invalid:${state}`);
    }
    if (typeof definition.eligible_for_fallback !== "boolean") {
      errors.push(`fallback-readiness-fallback-eligibility-invalid:${state}`);
    }
  }
}

function validateProvidersAndModels(
  root: Record<string, unknown>,
  errors: string[],
): {
  providers: Record<string, unknown>;
  models: Record<string, unknown>;
  readiness: Record<string, unknown>;
} {
  const providers = recordOrEmpty(root.providers, "providers-missing-or-invalid", errors);
  const models = recordOrEmpty(root.models, "models-missing-or-invalid", errors);
  const readiness = isRecord(root.fallback_readiness) ? root.fallback_readiness : {};

  for (const [providerId, unknownProvider] of Object.entries(providers)) {
    if (!isRecord(unknownProvider) || !isPromotionState(unknownProvider.promotion_state)) {
      errors.push(`provider-promotion-state-invalid:${providerId}`);
    }
  }

  for (const [modelId, unknownModel] of Object.entries(models)) {
    if (!isRecord(unknownModel)) {
      errors.push(`model-definition-invalid:${modelId}`);
      continue;
    }
    const provider = unknownModel.provider;
    if (!isNonEmptyString(provider) || !isRecord(providers[provider])) {
      errors.push(`model-provider-unresolved:${modelId}:${String(provider ?? "")}`);
    } else if (!modelId.startsWith(`${provider}/`)) {
      errors.push(`model-provider-prefix-mismatch:${modelId}:${provider}`);
    }
    if (!isCapabilityTier(unknownModel.capability_tier)) {
      errors.push(`model-capability-tier-invalid:${modelId}`);
    }
    if (!isReadiness(unknownModel.fallback_readiness)) {
      errors.push(`model-fallback-readiness-invalid:${modelId}`);
    }
    if (!isNonEmptyString(unknownModel.failure_domain)) {
      errors.push(`model-failure-domain-missing:${modelId}`);
    }

    const promotion = unknownModel.promotion;
    if (!isRecord(promotion) || !isPromotionState(promotion.state)) {
      errors.push(`model-promotion-state-invalid:${modelId}`);
      continue;
    }
    const evidence = promotion.evidence;
    if (!isRecord(evidence)) {
      errors.push(`model-promotion-evidence-missing:${modelId}`);
    } else {
      for (const kind of REQUIRED_EVIDENCE) {
        if (!(kind in evidence)) {
          errors.push(`model-promotion-evidence-field-missing:${modelId}:${kind}`);
        } else if (promotion.state === "proven" && !isNonEmptyString(evidence[kind])) {
          errors.push(`model-promotion-evidence-missing:${modelId}:${kind}`);
        } else if (
          promotion.state === "candidate"
          && evidence[kind] !== null
          && !isNonEmptyString(evidence[kind])
        ) {
          errors.push(`model-promotion-evidence-invalid:${modelId}:${kind}`);
        }
      }
    }

    if (isReadiness(unknownModel.fallback_readiness)) {
      const readinessDefinition = readiness[unknownModel.fallback_readiness];
      if (!isRecord(readinessDefinition)) {
        errors.push(`model-readiness-definition-unresolved:${modelId}`);
      }
      if (promotion.state === "candidate" && unknownModel.fallback_readiness !== "candidate") {
        errors.push(`candidate-model-readiness-invalid:${modelId}`);
      }
      if (promotion.state === "proven" && unknownModel.fallback_readiness === "candidate") {
        errors.push(`proven-model-readiness-invalid:${modelId}`);
      }
    }

    if (isNonEmptyString(provider) && isRecord(providers[provider])) {
      const providerState = providers[provider].promotion_state;
      if (providerState === "candidate" && promotion.state === "proven") {
        errors.push(`candidate-provider-model-promoted:${provider}:${modelId}`);
      }
    }
  }

  return { providers, models, readiness };
}

function validateAliasLimits(
  aliasId: string,
  unknownLimits: unknown,
  errors: string[],
): void {
  if (!isRecord(unknownLimits)) {
    errors.push(`alias-limits-missing:${aliasId}`);
    return;
  }
  if (!isPositiveInteger(unknownLimits.context)) {
    errors.push(`alias-limit-invalid:${aliasId}:context`);
  }
  if (!isPositiveInteger(unknownLimits.output)) {
    errors.push(`alias-limit-invalid:${aliasId}:output`);
  }
}

function validateAliases(
  root: Record<string, unknown>,
  providers: Record<string, unknown>,
  models: Record<string, unknown>,
  errors: string[],
): Map<string, Record<string, unknown>> {
  const aliases = arrayOrEmpty(root.aliases, "aliases-missing-or-invalid", errors);
  const aliasById = new Map<string, Record<string, unknown>>();
  const ids: string[] = [];

  for (const unknownAlias of aliases) {
    if (!isRecord(unknownAlias) || !isNonEmptyString(unknownAlias.id)) {
      errors.push("alias-definition-invalid");
      continue;
    }
    const id = unknownAlias.id;
    ids.push(id);
    if (aliasById.has(id)) errors.push(`alias-duplicate:${id}`);
    aliasById.set(id, unknownAlias);

    const provider = unknownAlias.provider;
    const model = unknownAlias.model;
    if (!isNonEmptyString(provider) || !isRecord(providers[provider])) {
      errors.push(`alias-provider-unresolved:${id}:${String(provider ?? "")}`);
    } else if (!id.startsWith(`${provider}/`)) {
      errors.push(`alias-provider-prefix-mismatch:${id}:${provider}`);
    }
    if (!isNonEmptyString(model) || !isRecord(models[model])) {
      errors.push(`alias-model-unresolved:${id}:${String(model ?? "")}`);
    } else {
      const modelDefinition = models[model];
      if (modelDefinition.provider !== provider) {
        errors.push(`alias-model-provider-mismatch:${id}:${model}`);
      }
      const promotion = modelDefinition.promotion;
      if (!isRecord(promotion) || promotion.state !== "proven") {
        errors.push(`candidate-model-in-curated-alias:${id}:${model}`);
      }
    }
    validateAliasLimits(id, unknownAlias.limits, errors);
  }

  if (!sameMembers(ids, CURATED_OPENCODE_ALIASES)) {
    errors.push("curated-alias-set-mismatch");
  }

  const candidates = arrayOrEmpty(
    root.candidate_aliases,
    "candidate-aliases-missing-or-invalid",
    errors,
  );
  const candidateIds: string[] = [];
  for (const unknownAlias of candidates) {
    if (!isRecord(unknownAlias) || !isNonEmptyString(unknownAlias.id)) {
      errors.push("candidate-alias-definition-invalid");
      continue;
    }
    const id = unknownAlias.id;
    candidateIds.push(id);
    if (unknownAlias.status !== "candidate-only") {
      errors.push(`candidate-alias-status-invalid:${id}`);
    }
    const provider = unknownAlias.provider;
    const model = unknownAlias.model;
    if (!isNonEmptyString(provider) || !isRecord(providers[provider])) {
      errors.push(`candidate-alias-provider-unresolved:${id}:${String(provider ?? "")}`);
    }
    if (!isNonEmptyString(model) || !isRecord(models[model])) {
      errors.push(`candidate-alias-model-unresolved:${id}:${String(model ?? "")}`);
    } else {
      const promotion = models[model].promotion;
      if (!isRecord(promotion) || promotion.state !== "candidate") {
        errors.push(`candidate-alias-model-not-candidate:${id}:${model}`);
      }
    }
    validateAliasLimits(id, unknownAlias.limits, errors);
  }
  if (!sameMembers(candidateIds, [CANDIDATE_ONLY_ALIAS])) {
    errors.push("candidate-alias-set-mismatch");
  }

  return aliasById;
}

function resolvedAliasModel(
  aliasId: unknown,
  aliases: Map<string, Record<string, unknown>>,
  models: Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof aliasId !== "string") return null;
  const alias = aliases.get(aliasId);
  if (!alias || typeof alias.model !== "string") return null;
  const model = models[alias.model];
  return isRecord(model) ? model : null;
}

function validateOperationalModel(
  owner: string,
  modelId: unknown,
  purpose: "default" | "fallback" | "escalation",
  aliases: Map<string, Record<string, unknown>>,
  models: Record<string, unknown>,
  readiness: Record<string, unknown>,
  errors: string[],
): Record<string, unknown> | null {
  if (!isNonEmptyString(modelId) || !aliases.has(modelId)) {
    errors.push(`operational-alias-unresolved:${owner}:${String(modelId ?? "")}`);
    return null;
  }
  const model = resolvedAliasModel(modelId, aliases, models);
  if (!model) {
    errors.push(`operational-model-unresolved:${owner}:${modelId}`);
    return null;
  }
  const promotion = model.promotion;
  if (!isRecord(promotion) || promotion.state !== "proven") {
    errors.push(`candidate-model-in-operational-path:${owner}:${modelId}`);
  }
  const readinessState = model.fallback_readiness;
  const readinessDefinition = typeof readinessState === "string"
    ? readiness[readinessState]
    : undefined;
  if (!isRecord(readinessDefinition)) {
    errors.push(`operational-readiness-unresolved:${owner}:${modelId}`);
  } else if (purpose === "default" && readinessDefinition.eligible_for_default !== true) {
    errors.push(`model-not-default-ready:${owner}:${modelId}`);
  } else if (purpose !== "default" && readinessDefinition.eligible_for_fallback !== true) {
    errors.push(`model-not-fallback-ready:${owner}:${modelId}`);
  }
  return model;
}

function validateProfilesAndHelpers(
  root: Record<string, unknown>,
  aliases: Map<string, Record<string, unknown>>,
  models: Record<string, unknown>,
  readiness: Record<string, unknown>,
  errors: string[],
): void {
  const profiles = recordOrEmpty(root.profiles, "profiles-missing-or-invalid", errors);
  if (!sameMembers(Object.keys(profiles), Object.keys(REQUIRED_PROFILE_MODELS))) {
    errors.push("profile-set-mismatch");
  }

  for (const [profileName, expectedModel] of Object.entries(REQUIRED_PROFILE_MODELS)) {
    const unknownProfile = profiles[profileName];
    if (!isRecord(unknownProfile)) {
      errors.push(`profile-definition-invalid:${profileName}`);
      continue;
    }
    if (unknownProfile.default_model !== expectedModel) {
      errors.push(`profile-default-mismatch:${profileName}:${String(unknownProfile.default_model ?? "")}`);
    }
    const defaultModel = validateOperationalModel(
      `profile:${profileName}:default`,
      unknownProfile.default_model,
      "default",
      aliases,
      models,
      readiness,
      errors,
    );
    const fallbacks = stringArray(unknownProfile.fallback_models);
    if (!fallbacks) {
      errors.push(`profile-fallbacks-invalid:${profileName}`);
    } else {
      for (const fallback of fallbacks) {
        validateOperationalModel(
          `profile:${profileName}:fallback`,
          fallback,
          "fallback",
          aliases,
          models,
          readiness,
          errors,
        );
      }
    }
    const expectedTier = REQUIRED_PROFILE_TIERS[profileName];
    if (unknownProfile.capability_tier !== expectedTier) {
      errors.push(`profile-tier-mismatch:${profileName}`);
    }
    if (defaultModel && defaultModel.capability_tier !== unknownProfile.capability_tier) {
      errors.push(`profile-model-tier-mismatch:${profileName}`);
    }
    if (!isReadiness(unknownProfile.fallback_readiness)) {
      errors.push(`profile-readiness-invalid:${profileName}`);
    }
    if (unknownProfile.freeze_coordinator_identity !== true) {
      errors.push(`profile-coordinator-not-frozen:${profileName}`);
    }
    if (unknownProfile.allow_silent_downgrade !== false) {
      errors.push(`profile-silent-downgrade-forbidden:${profileName}`);
    }
  }

  const algorithmProfile = profiles["temperance-algorithm"];
  if (isRecord(algorithmProfile)) {
    const fallbacks = stringArray(algorithmProfile.fallback_models);
    if (!fallbacks || fallbacks.length !== 0) {
      errors.push("algorithm-profile-fallback-must-be-explicit-continuity");
    }
  }
  const continuityProfile = profiles["temperance-continuity"];
  if (
    !isRecord(continuityProfile)
    || !sameMembers(stringArray(continuityProfile.fallback_models) ?? [], ["omniroute/te-fast"])
  ) {
    errors.push("continuity-fallback-set-mismatch");
  }

  const helpers = recordOrEmpty(root.helper_agents, "helper-agents-missing-or-invalid", errors);
  if (!sameMembers(Object.keys(helpers), Object.keys(REQUIRED_HELPER_MODELS))) {
    errors.push("helper-agent-set-mismatch");
  }
  for (const [helperName, expectedModel] of Object.entries(REQUIRED_HELPER_MODELS)) {
    const unknownHelper = helpers[helperName];
    if (!isRecord(unknownHelper)) {
      errors.push(`helper-definition-invalid:${helperName}`);
      continue;
    }
    if (unknownHelper.default_model !== expectedModel) {
      errors.push(`helper-default-mismatch:${helperName}:${String(unknownHelper.default_model ?? "")}`);
    }
    const defaultModel = validateOperationalModel(
      `helper:${helperName}:default`,
      unknownHelper.default_model,
      "default",
      aliases,
      models,
      readiness,
      errors,
    );
    const fallbacks = stringArray(unknownHelper.fallback_models);
    if (!fallbacks) {
      errors.push(`helper-fallbacks-invalid:${helperName}`);
    } else {
      for (const fallback of fallbacks) {
        validateOperationalModel(
          `helper:${helperName}:fallback`,
          fallback,
          "fallback",
          aliases,
          models,
          readiness,
          errors,
        );
      }
    }
    const expectedTier = REQUIRED_HELPER_TIERS[helperName];
    if (unknownHelper.capability_tier !== expectedTier) {
      errors.push(`helper-tier-mismatch:${helperName}`);
    }
    if (defaultModel && defaultModel.capability_tier !== unknownHelper.capability_tier) {
      errors.push(`helper-model-tier-mismatch:${helperName}`);
    }
    if (
      typeof unknownHelper.max_subagent_depth !== "number"
      || !Number.isFinite(unknownHelper.max_subagent_depth)
      || !Number.isInteger(unknownHelper.max_subagent_depth)
      || unknownHelper.max_subagent_depth !== 0
    ) {
      errors.push(`helper-depth-invalid:${helperName}`);
    }
  }

  const worker = helpers.worker;
  if (isRecord(worker)) {
    const escalationModels = stringArray(worker.escalation_models);
    const expectedEscalations = ["omniroute/te-build", "omniroute/te-algorithm"];
    if (!escalationModels || !sameMembers(escalationModels, expectedEscalations)) {
      errors.push("worker-escalation-models-mismatch");
    } else {
      for (const escalation of escalationModels) {
        validateOperationalModel(
          "helper:worker:escalation",
          escalation,
          "escalation",
          aliases,
          models,
          readiness,
          errors,
        );
      }
      const escalationTiers = escalationModels.map(
        (modelId) => resolvedAliasModel(modelId, aliases, models)?.capability_tier,
      );
      if (escalationTiers[0] !== "A" || escalationTiers[1] !== "S") {
        errors.push("worker-escalation-model-tier-order-invalid");
      }
    }
  }

  for (const reference of operationalReferences(root)) {
    if (reference.model === CANDIDATE_ONLY_ALIAS) {
      errors.push(`candidate-only-alias-in-operational-path:${reference.owner}:${reference.model}`);
    }
  }
}

function validateTierPolicy(root: Record<string, unknown>, errors: string[]): void {
  const policy = recordOrEmpty(root.tier_policy, "tier-policy-missing-or-invalid", errors);
  const algorithm = recordOrEmpty(
    policy.algorithm,
    "algorithm-tier-policy-missing-or-invalid",
    errors,
  );
  if (algorithm.primary_profile !== "temperance-algorithm") {
    errors.push("algorithm-primary-profile-invalid");
  }
  if (algorithm.coordinator_tier !== "S") {
    errors.push("algorithm-coordinator-tier-invalid");
  }
  if (algorithm.allow_silent_downgrade !== false) {
    errors.push("algorithm-silent-downgrade-forbidden");
  }
  const retry = recordOrEmpty(algorithm.retry_at, "algorithm-retry-policy-missing", errors);
  if (
    retry.tier !== "A"
    || retry.profile !== "temperance-continuity"
    || retry.requires_explicit_selection !== true
  ) {
    errors.push("algorithm-retry-must-use-explicit-a-continuity");
  }

  const fallbackTransitions = arrayOrEmpty(
    policy.fallback_transitions,
    "fallback-transitions-missing-or-invalid",
    errors,
  );
  if (fallbackTransitions.length !== 1) {
    errors.push("fallback-transition-set-mismatch");
  }
  for (const [index, unknownTransition] of fallbackTransitions.entries()) {
    if (!isRecord(unknownTransition)) {
      errors.push(`fallback-transition-invalid:${index}`);
      continue;
    }
    const from = unknownTransition.from;
    const to = unknownTransition.to;
    if (!isCapabilityTier(from) || !isCapabilityTier(to) || TIER_RANK[to] >= TIER_RANK[from]) {
      errors.push(`fallback-tier-transition-invalid:${String(from)}:${String(to)}`);
    }
    if (from !== "A" || to !== "B") {
      errors.push(`fallback-tier-transition-not-allowlisted:${String(from)}:${String(to)}`);
    }
    if (unknownTransition.requires_log !== true) {
      errors.push(`fallback-transition-log-required:${String(from)}:${String(to)}`);
    }
  }

  const worker = recordOrEmpty(policy.worker, "worker-tier-policy-missing-or-invalid", errors);
  if (worker.initial_tier !== "B") {
    errors.push("worker-initial-tier-invalid");
  }
  const escalationEdges = arrayOrEmpty(
    worker.escalation_edges,
    "worker-escalation-edges-missing-or-invalid",
    errors,
  );
  const normalizedEdges: string[] = [];
  for (const [index, unknownEdge] of escalationEdges.entries()) {
    if (!isRecord(unknownEdge)) {
      errors.push(`worker-escalation-edge-invalid:${index}`);
      continue;
    }
    const from = unknownEdge.from;
    const to = unknownEdge.to;
    normalizedEdges.push(`${String(from)}>${String(to)}`);
    if (!isCapabilityTier(from) || !isCapabilityTier(to) || TIER_RANK[to] <= TIER_RANK[from]) {
      errors.push(`worker-escalation-tier-transition-invalid:${String(from)}:${String(to)}`);
    }
  }
  if (!sameMembers(normalizedEdges, ["B>A", "A>S"])) {
    errors.push("worker-escalation-edge-set-mismatch");
  }
  if (
    worker.downgrade_within_same_task !== "reject"
    || worker.downgrade_requires_new_task !== true
  ) {
    errors.push("worker-downgrade-policy-invalid");
  }
}

function validateFailureDomainPolicy(
  root: Record<string, unknown>,
  aliases: Map<string, Record<string, unknown>>,
  models: Record<string, unknown>,
  errors: string[],
): void {
  const profiles = isRecord(root.profiles) ? root.profiles : {};
  const policy = recordOrEmpty(
    root.failure_domain_policy,
    "failure-domain-policy-missing-or-invalid",
    errors,
  );
  const independenceSets = arrayOrEmpty(
    policy.independence_sets,
    "failure-domain-independence-sets-missing-or-invalid",
    errors,
  );
  if (independenceSets.length === 0) {
    errors.push("failure-domain-independence-set-required");
  }

  for (const [index, unknownSet] of independenceSets.entries()) {
    if (!isRecord(unknownSet) || !isNonEmptyString(unknownSet.id)) {
      errors.push(`failure-domain-independence-set-invalid:${index}`);
      continue;
    }
    const profileNames = stringArray(unknownSet.profiles);
    if (!profileNames || profileNames.length < 2) {
      errors.push(`failure-domain-independence-members-invalid:${unknownSet.id}`);
      continue;
    }
    const domains: string[] = [];
    for (const profileName of profileNames) {
      const profile = profiles[profileName];
      if (!isRecord(profile)) {
        errors.push(`failure-domain-profile-unresolved:${unknownSet.id}:${profileName}`);
        continue;
      }
      const model = resolvedAliasModel(profile.default_model, aliases, models);
      if (!model || !isNonEmptyString(model.failure_domain)) {
        errors.push(`failure-domain-model-unresolved:${unknownSet.id}:${profileName}`);
        continue;
      }
      domains.push(model.failure_domain);
    }
    if (domains.length !== new Set(domains).size) {
      const collision = domains.find(
        (domain, domainIndex) => domains.indexOf(domain) !== domainIndex,
      ) ?? "unknown";
      errors.push(`failure-domain-collision:${unknownSet.id}:${collision}`);
    }
  }
}

export function validateSessionProfileManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["manifest-missing-or-not-an-object"] };
  }
  if (value.version !== 1) errors.push("schema-version-mismatch");
  if (
    typeof value.max_subagent_depth !== "number"
    || !Number.isFinite(value.max_subagent_depth)
    || !Number.isInteger(value.max_subagent_depth)
    || value.max_subagent_depth !== 1
  ) {
    errors.push("max-subagent-depth-invalid");
  }

  validateCapabilityDefinitions(value, errors);
  const { providers, models, readiness } = validateProvidersAndModels(value, errors);
  const aliases = validateAliases(value, providers, models, errors);
  validateProfilesAndHelpers(value, aliases, models, readiness, errors);
  validateTierPolicy(value, errors);
  validateFailureDomainPolicy(value, aliases, models, errors);

  return { valid: errors.length === 0, errors };
}

export function validateWorkerTierTransition(
  from: unknown,
  to: unknown,
  sameTask: boolean,
  manifest: SessionProfileManifest = sessionProfileManifest,
): ManifestValidation {
  const errors: string[] = [];
  if (!isCapabilityTier(from) || !isCapabilityTier(to)) {
    return { valid: false, errors: ["worker-tier-transition-tier-invalid"] };
  }
  if (from === to) return { valid: true, errors };

  if (TIER_RANK[to] < TIER_RANK[from]) {
    if (sameTask || manifest.tier_policy.worker.downgrade_requires_new_task) {
      if (sameTask) errors.push(`worker-downgrade-within-task-rejected:${from}:${to}`);
    }
    return { valid: errors.length === 0, errors };
  }

  const allowed = manifest.tier_policy.worker.escalation_edges.some(
    (edge) => edge.from === from && edge.to === to,
  );
  if (!allowed) errors.push(`worker-escalation-edge-not-allowed:${from}:${to}`);
  return { valid: errors.length === 0, errors };
}

if (import.meta.main) {
  const result = validateSessionProfileManifest(sessionProfileManifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}
