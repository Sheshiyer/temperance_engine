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

export const OmniRouteCatalogGuard: Plugin = async () => ({
  "chat.params": async (input) => {
    if (input.model.providerID !== "omniroute") return;

    const configuredBaseUrl =
      typeof input.provider.options?.baseURL === "string"
        ? input.provider.options.baseURL
        : process.env.TEMPERANCE_OMNIROUTE_BASE_URL ||
          "http://127.0.0.1:20128/v1";
    const liveModelIds = await fetchLiveModelIds(configuredBaseUrl);
    assertLiveModel(input.model.id, liveModelIds);
  },
});

export default OmniRouteCatalogGuard;
