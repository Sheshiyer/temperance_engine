// Shared fail-closed guard: refuses to forward a request for a model ID that
// is absent from OmniRoute's live /v1/models catalog. Originally lived only
// in package/adapters/opencode/OmniRouteCatalogGuardCore.ts, protecting
// OpenCode's picker (a user/config-selected model string that can go stale
// when OmniRoute's catalog changes). Relocated here so
// temperance-openai-proxy.ts's own explicit-picker path (any caller that
// names a specific model rather than "temperance-auto") gets the same
// protection without depending on the OpenCode adapter package, which is
// slated for retirement. package/adapters/opencode/OmniRouteCatalogGuardCore.ts
// re-exports from this module rather than duplicating it.

type ModelCatalogResponse = {
  data?: Array<{ id?: unknown }>
}

export type CatalogFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/models`
}

export async function fetchLiveModelIds(
  baseUrl: string,
  fetchImpl: CatalogFetch = fetch,
): Promise<Set<string>> {
  const response = await fetchImpl(modelsUrl(baseUrl), {
    headers: process.env.OMNIROUTE_API_KEY
      ? { Authorization: `Bearer ${process.env.OMNIROUTE_API_KEY}` }
      : undefined,
  })
  if (!response.ok) {
    throw new Error(`OmniRoute catalog unavailable (HTTP ${response.status})`)
  }

  const body = (await response.json()) as ModelCatalogResponse
  if (!Array.isArray(body.data)) {
    throw new Error("OmniRoute catalog response is malformed")
  }

  const ids = new Set<string>()
  for (const item of body.data) {
    if (typeof item.id === "string" && item.id.length > 0) ids.add(item.id)
  }
  if (ids.size === 0) throw new Error("OmniRoute catalog contains no model IDs")
  return ids
}

export function assertLiveModel(modelId: string, liveModelIds: Set<string>): void {
  if (!liveModelIds.has(modelId)) {
    throw new Error(
      `OmniRoute model denied: ${modelId} is absent from the live /v1/models catalog`,
    )
  }
}

export function createCatalogCache(options: {
  ttlMs?: number
  fetchIds?: (baseUrl: string) => Promise<Set<string>>
  now?: () => number
} = {}): (baseUrl: string) => Promise<Set<string>> {
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000
  const fetchIds = options.fetchIds ?? ((baseUrl: string) => fetchLiveModelIds(baseUrl))
  const now = options.now ?? Date.now
  const cache = new Map<string, { ids: Set<string>; cachedAt: number }>()

  return async (baseUrl: string): Promise<Set<string>> => {
    const current = now()
    const cached = cache.get(baseUrl)
    if (cached && current - cached.cachedAt < ttlMs) return cached.ids
    const ids = await fetchIds(baseUrl)
    cache.set(baseUrl, { ids, cachedAt: current })
    return ids
  }
}

export const getLiveModelIds = createCatalogCache()
