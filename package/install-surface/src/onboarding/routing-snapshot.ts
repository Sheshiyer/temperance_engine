import type { OnboardingPlanV1, OnboardingProfileV1 } from "./contracts.ts";
import { NineRouterApiClient, type NineRouterAvailableModel, type NineRouterCatalogSnapshot } from "./nine-router-api.ts";
import { createNineRouterRoutingSurface, NINE_ROUTER_PROVIDER_CAPABILITY_VERSION, type NineRouterRoutingSurface } from "./nine-router-provider-capabilities.ts";
import type { HostProfileV1, NineRouterGuidedSetupV1 } from "./public-contracts.ts";

interface RoutingConnection { dataDirectory: string; baseUrl: string; }
interface RoutingObservation { catalog: NineRouterCatalogSnapshot; models: NineRouterAvailableModel[]; }

export interface OnboardingRoutingSnapshot {
  routing?: NineRouterRoutingSurface;
  /** Present only after both read-only management observations succeeded. */
  connection?: RoutingConnection;
}

/** One read-only routing projection shared by terminal text and interactive onboarding. */
export async function readOnboardingRoutingSnapshot(options: {
  plan: OnboardingPlanV1;
  profile: OnboardingProfileV1;
  hostProfile?: HostProfileV1;
  routerSetup?: NineRouterGuidedSetupV1;
  observe?: (connection: RoutingConnection) => Promise<RoutingObservation>;
}): Promise<OnboardingRoutingSnapshot> {
  const { plan, profile, hostProfile, routerSetup } = options;
  const dataDirectory = profile.variables.NINE_ROUTER_DATA_DIR;
  const healthUrl = profile.variables.NINE_ROUTER_HEALTH_URL;
  if (!hostProfile && !dataDirectory && !healthUrl && profile.routing_aliases.length === 0) return {};

  let observation: RoutingObservation | undefined;
  let connection: RoutingConnection | undefined;
  if (dataDirectory && healthUrl) {
    try {
      const candidate = { dataDirectory, baseUrl: new URL(healthUrl).origin };
      const observe = options.observe ?? (async (binding: RoutingConnection): Promise<RoutingObservation> => {
        const api = new NineRouterApiClient(binding);
        const [catalog, models] = await Promise.all([api.readCatalog(), api.readAvailableModels()]);
        return { catalog, models };
      });
      observation = await observe(candidate);
      connection = candidate;
    } catch { /* Bound but unavailable is distinct from an unselected host profile. */ }
  }
  const gatewayReferenceId = routerSetup?.gateway_key.secret_reference_id;
  const routerVersionHeld = plan.modules.find(({ id }) => id === "provider.9router")?.holds
    .some(({ reason_code }) => reason_code === "BINARY_MISSING" || reason_code === "VERSION_MISMATCH") ?? true;
  return {
    ...(connection ? { connection } : {}),
    routing: createNineRouterRoutingSurface({
      routerVersion: routerVersionHeld ? "unavailable-or-mismatched" : NINE_ROUTER_PROVIDER_CAPABILITY_VERSION,
      requiredAliases: hostProfile?.required_routing_aliases ?? profile.routing_aliases.map(({ combo }) => combo),
      catalog: observation?.catalog,
      availableModels: observation?.models,
      declaredSecretReferenceIds: routerSetup
        ? routerSetup.providers.map(({ credential_reference_id }) => credential_reference_id).filter((id) => id !== gatewayReferenceId)
        : [],
      providerPreferences: hostProfile?.routing_provider_preferences,
    }),
  };
}
