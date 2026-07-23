import type { Plugin } from "@opencode-ai/plugin";

type ModelCatalogResponse = {
  data?: Array<{ id?: unknown }>;
};

export type CatalogFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/models`;
}

export async function fetchLiveModelIds(
  baseUrl: string,
  fetchImpl: CatalogFetch = fetch,
): Promise<Set<string>> {
  const response = await fetchImpl(modelsUrl(baseUrl), {
    headers: process.env.OMNIROUTE_API_KEY
      ? { Authorization: `Bearer ${process.env.OMNIROUTE_API_KEY}` }
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`OmniRoute catalog unavailable (HTTP ${response.status})`);
  }

  const body = (await response.json()) as ModelCatalogResponse;
  if (!Array.isArray(body.data)) {
    throw new Error("OmniRoute catalog response is malformed");
  }

  const ids = new Set<string>();
  for (const item of body.data) {
    if (typeof item.id === "string" && item.id.length > 0) ids.add(item.id);
  }
  return ids;
}

export function assertLiveModel(modelId: string, liveModelIds: Set<string>): void {
  if (!liveModelIds.has(modelId)) {
    throw new Error(
      `OmniRoute model denied: ${modelId} is absent from the live /v1/models catalog`,
    );
  }
}

let cachedLive: Set<string> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getLiveModelIds(baseUrl: string): Promise<Set<string>> {
  const now = Date.now();
  if (cachedLive && now - cachedAt < CACHE_TTL_MS) return cachedLive;
  try {
    const ids = await fetchLiveModelIds(baseUrl);
    cachedLive = ids;
    cachedAt = now;
    return ids;
  } catch {
    return cachedLive ?? new Set<string>();
  }
}

export const OmniRouteCatalogGuard: Plugin = async () => ({
  "chat.params": async (input, _output) => {
    if (!input?.model || !["omniroute", "temperance"].includes(input.model.providerID)) return;

    const configuredBaseUrl =
      typeof input.provider?.options?.baseURL === "string"
        ? input.provider.options.baseURL
        : process.env.TEMPERANCE_OMNIROUTE_BASE_URL ||
          input.model.providerID === "temperance"
            ? "http://127.0.0.1:20129/v1"
            : "http://127.0.0.1:20128/v1";
    const liveModelIds = await getLiveModelIds(configuredBaseUrl);
    if (liveModelIds.size > 0 && input.model.id) {
      assertLiveModel(input.model.id, liveModelIds);
    }
  },
});

export default OmniRouteCatalogGuard;
