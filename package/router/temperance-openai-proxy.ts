#!/usr/bin/env bun
/**
 * Temperance's OpenAI-compatible request seam.
 *
 * OpenCode plugins can enrich a message and change generation parameters, but
 * they do not expose an official hook for replacing the selected model. This
 * small local relay therefore sits in front of OmniRoute for the automatic
 * `temperance-auto` model. It delegates intent classification and portfolio
 * resolution to the existing frozen router, forwards the original OpenAI
 * request (including tools), and leaves every non-automatic picker model alone.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { enrich } from "../enrich/index"
import type { EnrichInput } from "../enrich/contract"
import { assertLiveModel, getLiveModelIds } from "./omniroute-catalog-guard"

export const AUTO_MODEL = "temperance-auto"
export const ROUTING_MODELS = new Set([AUTO_MODEL, "temperance-routing"])
/**
 * Surfaces whose <temperance-context> enrichment is injected HERE, server-side.
 * Kimi's hook runner honors block/allow only (no additionalContext), so the
 * relay is the only seam that can carry enrichment into kimi sessions. Client-
 * enriched surfaces (opencode plugin, claude/codex prompt hooks) must never be
 * listed: enriching them again would stack duplicate blocks.
 */
export const ENRICHMENT_SURFACES = ["kimi"] as const
const SESSION_CONTEXT_SCHEMA = "temperance-kimi-session-v1"
const DEFAULT_PORT = 20129
const DEFAULT_UPSTREAM = "http://127.0.0.1:20128/v1"
const OMNIROUTE_COMPRESSION_HEADER = "x-omniroute-compression"
const OMNIROUTE_COMPRESSION_MODE = "off"

export function automaticReadiness(): { ready: boolean; reason: string | null } {
  const value = (process.env.TEMPERANCE_AUTO_READY || "").trim().toLowerCase()
  const ready = ["1", "true", "yes", "on"].includes(value)
  return {
    ready,
    reason: ready
      ? null
      : (process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON || "A verified S-tier coordinator is unavailable on this host."),
  }
}
const SCRIPT_DIR = import.meta.dir
const DEFAULT_ROUTER = join(SCRIPT_DIR, "multi-backend-router.sh")

export type RoutePlan = {
  plan_id?: string
  correlation_id?: string
  task_type?: string
  selected_order?: Array<{ backend?: string; model?: string }>
  portfolio?: {
    requested_portfolio?: string
    selected_model?: string
    source?: string
    enforcement?: string
  }
}

export type RouteDecision = {
  requested_model: string
  routed_model: string
  mode: "automatic" | "direct"
  source: string
  plan: RoutePlan | null
  prompt: string
  request_id: string
  error?: string
}

export type SessionContext = {
  schema_version?: string
  session_id?: string
  cwd?: string
  ts?: number
  prompt_hash?: string
}

export type EnrichmentOutcome = {
  surface: string | null
  enrichment: "injected" | "skipped" | "not-applicable"
  cwd_source: "session-context" | "relay-cwd" | null
  prompt_hash_match: boolean | null
}

export type ProxyDependencies = {
  upstreamFetch?: typeof fetch
  planRunner?: (prompt: string) => Promise<RoutePlan>
  requestId?: () => string
  enrichRunner?: (input: EnrichInput) => Promise<string>
  sessionContext?: () => SessionContext | null
  liveModelIds?: (baseUrl: string) => Promise<Set<string>>
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const candidate = part as Record<string, unknown>
      return text(candidate.text ?? candidate.content)
    })
    .filter(Boolean)
    .join("\n")
}

export function latestUserPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return ""
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== "object") continue
    const candidate = message as Record<string, unknown>
    if (candidate.role === "user") {
      return contentText(candidate.content)
        .replace(/<temperance-context>[\s\S]*?<\/temperance-context>/gi, "")
        .trim()
    }
  }
  return ""
}

function hasTools(body: Record<string, unknown>): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0 || body.tool_choice !== undefined
}

/** Surface tag set per-provider via custom_headers (mirrors the opencode plugin's chat.headers). */
export function detectSurface(headers: Headers): string | null {
  const value = headers.get("x-temperance-surface")
  return value ? value.trim().toLowerCase() : null
}

function stripContextBlocks(value: string): string {
  return value.replace(/<temperance-context>[\s\S]*?<\/temperance-context>\s*/gi, "")
}

/**
 * Prepend a fresh <temperance-context> block to the LATEST user message only,
 * replacing (never stacking on) any block already present there. Prior-turn
 * messages stay byte-identical: on client-enriched surfaces history legitimately
 * carries old blocks, and rewriting history would corrupt cache affinity.
 */
export function injectContext(body: Record<string, unknown>, block: string): boolean {
  const messages = body.messages
  const trimmed = block.trim()
  if (!Array.isArray(messages) || !trimmed) return false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== "object") continue
    const candidate = message as Record<string, unknown>
    if (candidate.role !== "user") continue
    const content = candidate.content
    if (typeof content === "string") {
      candidate.content = `${trimmed}\n\n${stripContextBlocks(content).trimStart()}`
      return true
    }
    if (Array.isArray(content)) {
      const cleaned = content.filter((part) => {
        if (!part || typeof part !== "object") return true
        const record = part as Record<string, unknown>
        if (typeof record.text !== "string") return true
        record.text = stripContextBlocks(record.text)
        return record.text.trim().length > 0
      })
      cleaned.unshift({ type: "text", text: trimmed })
      candidate.content = cleaned
      return true
    }
    return false
  }
  return false
}

function sessionContextPath(): string {
  return process.env.TEMPERANCE_KIMI_SESSION_CONTEXT
    || join(process.env.TEMPERANCE_KIMI_STATE || join(process.env.HOME || ".", ".temperance_engine", "kimi"), "session-context.json")
}

/** Read the hook-written cwd sidecar; reject unknown schemas and stale entries. */
export function readSessionContext(path: string, nowMs: number, ttlMs: number): SessionContext | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as SessionContext
    if (candidate.schema_version !== SESSION_CONTEXT_SCHEMA) return null
    if (typeof candidate.cwd !== "string" || candidate.cwd.length === 0) return null
    if (typeof candidate.ts !== "number" || nowMs - candidate.ts > ttlMs || candidate.ts > nowMs + ttlMs) return null
    return candidate
  } catch {
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`enrichment timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Server-side enrichment for surfaces that cannot inject context client-side.
 * Fail-open and latency-bounded: any error or timeout forwards the request
 * unmodified, with the skip visible in the decision log.
 */
async function applyEnrichment(
  body: Record<string, unknown>,
  decision: RouteDecision,
  surface: string | null,
  deps: ProxyDependencies,
): Promise<EnrichmentOutcome> {
  const outcome: EnrichmentOutcome = { surface, enrichment: "not-applicable", cwd_source: null, prompt_hash_match: null }
  if (!surface || !(ENRICHMENT_SURFACES as readonly string[]).includes(surface)) return outcome
  if (!decision.prompt) {
    outcome.enrichment = "skipped"
    return outcome
  }
  const ttlMs = Number(process.env.TEMPERANCE_KIMI_SESSION_TTL_MS || 120_000)
  const session = deps.sessionContext ? deps.sessionContext() : readSessionContext(sessionContextPath(), Date.now(), ttlMs)
  const cwd = session?.cwd || process.cwd()
  outcome.cwd_source = session?.cwd ? "session-context" : "relay-cwd"
  if (session?.prompt_hash) {
    // Advisory only: streaming retries and interleaved sessions make strict matching brittle.
    const digest = createHash("sha256").update(decision.prompt).digest("hex")
    outcome.prompt_hash_match = digest.startsWith(session.prompt_hash.toLowerCase())
  }
  const timeoutMs = Number(process.env.TEMPERANCE_ENRICH_TIMEOUT_MS || 2_000)
  const runner = deps.enrichRunner ?? ((input: EnrichInput) => enrich(input))
  try {
    const block = await withTimeout(runner({ prompt: decision.prompt, cwd, surface: "kimi" }), timeoutMs)
    outcome.enrichment = injectContext(body, block) ? "injected" : "skipped"
  } catch {
    outcome.enrichment = "skipped"
  }
  return outcome
}

function requestId(deps: ProxyDependencies): string {
  return `te_req_${(deps.requestId?.() ?? randomUUID()).replace(/[^A-Za-z0-9._-]/g, "")}`
}

function compatibilityModel(): string {
  return process.env.TEMPERANCE_OMNIROUTE_MODEL || "temperance-coding"
}

async function runRouterPlan(prompt: string): Promise<RoutePlan> {
  const router = process.env.TEMPERANCE_ROUTER_PATH || DEFAULT_ROUTER
  const proc = Bun.spawn(["bash", router, "--plan-json", prompt], {
    env: { ...process.env, TEMPERANCE_BACKENDS: "omniroute" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ])
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Temperance router exited ${exitCode}: ${stderr.trim()}`)
  }
  const parsed: unknown = JSON.parse(stdout)
  if (!parsed || typeof parsed !== "object") throw new Error("Temperance router returned a non-object plan")
  return parsed as RoutePlan
}

function selectedOmniModel(plan: RoutePlan | null): string | null {
  const first = plan?.selected_order?.[0]
  return first?.backend === "omniroute" && typeof first.model === "string" ? first.model : null
}

export async function resolveRoute(
  body: Record<string, unknown>,
  deps: ProxyDependencies = {},
): Promise<RouteDecision> {
  const requested = text(body.model) || compatibilityModel()
  const id = requestId(deps)
  if (!ROUTING_MODELS.has(requested)) {
    return {
      requested_model: requested,
      routed_model: requested,
      mode: "direct",
      source: "explicit-picker-override",
      plan: null,
      prompt: latestUserPrompt(body.messages),
      request_id: id,
    }
  }

  const prompt = latestUserPrompt(body.messages)
  let plan: RoutePlan | null = null
  let source = "frozen-plan"
  try {
    plan = await (deps.planRunner ?? runRouterPlan)(prompt)
  } catch (error) {
    // The compatibility combo is the existing gateway rail. It keeps the
    // OpenCode surface available while making the degradation observable.
    source = "classifier-fail-open-compatibility"
    return {
      requested_model: requested,
      routed_model: compatibilityModel(),
      mode: "automatic",
      source,
      plan: null,
      prompt,
      request_id: id,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let routed = selectedOmniModel(plan) || compatibilityModel()
  // The compatibility combo is the only route with an established tool-loop
  // probe. Automatic tool requests never promote an unverified named portfolio.
  if (hasTools(body)) {
    routed = compatibilityModel()
    source = "tool-safe-compatibility"
  }

  return {
    requested_model: requested,
    routed_model: routed,
    mode: "automatic",
    source,
    plan,
    prompt,
    request_id: id,
  }
}

function upstreamBase(): string {
  const value = process.env.TEMPERANCE_OMNIROUTE_BASE_URL || DEFAULT_UPSTREAM
  const normalized = value.replace(/\/$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

function gatewayKey(): string {
  if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY
  // File-backed key: the systemd-native shape (a 0640 file owned by the service user,
  // or LoadCredential=). The Keychain branch below is darwin-only, so on Linux this is
  // the only way the relay can find a key without putting it in the unit's environment.
  const keyFile = process.env.OMNIROUTE_API_KEY_FILE
  if (keyFile) {
    try {
      return readFileSync(keyFile, "utf8").trim()
    } catch {
      // Fall through: an unreadable key file behaves like no key at all, which
      // forwardedHeaders() already handles by sending no authorization header.
    }
  }
  if (process.platform === "darwin" && process.env.USER) {
    const result = Bun.spawnSync([
      "security", "find-generic-password", "-a", process.env.USER,
      "-s", process.env.TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE || "OmniRoute Temperance API Key", "-w",
    ], { stdout: "pipe", stderr: "ignore" })
    if (result.exitCode === 0) return new TextDecoder().decode(result.stdout).trim()
  }
  return ""
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("content-length")
  headers.delete("connection")
  const key = gatewayKey()
  if (key) headers.set("authorization", `Bearer ${key}`)
  return headers
}

/** Freeze OmniRoute compression only after every client and route header exists. */
function enforceCompressionBoundary(headers: Headers): void {
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase() === OMNIROUTE_COMPRESSION_HEADER) headers.delete(key)
  }
  headers.set(OMNIROUTE_COMPRESSION_HEADER, OMNIROUTE_COMPRESSION_MODE)
}

function jsonResponse(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...extra },
  })
}

function logDecision(
  decision: RouteDecision,
  enrichment?: EnrichmentOutcome,
  requestHeaders: Headers = new Headers(),
  upstreamHeaders: Headers = new Headers(),
  transportError: string | null = null,
): void {
  const path = process.env.TEMPERANCE_PROXY_LOG || join(process.env.TEMPERANCE_STATE_DIR || join(process.env.HOME || ".", ".temperance_engine", "state"), "openai-proxy.jsonl")
  try {
    mkdirSync(join(path, ".."), { recursive: true })
    appendFileSync(path, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      request_id: decision.request_id,
      session_id: requestHeaders.get("x-temperance-session-id") || upstreamHeaders.get("x-omniroute-session-id"),
      task_id: decision.plan?.correlation_id || decision.request_id,
      profile: requestHeaders.get("x-temperance-profile") ||
        (decision.requested_model === AUTO_MODEL ? "temperance-auto" : "explicit-picker"),
      capability_tier: requestHeaders.get("x-temperance-capability-tier") ||
        (decision.requested_model === AUTO_MODEL ? "S" : "operator-override"),
      decision: decision.source,
      requested_model: decision.requested_model,
      routed_model: decision.routed_model,
      resolved_provider: upstreamHeaders.get("x-omniroute-provider"),
      resolved_model: upstreamHeaders.get("x-omniroute-model"),
      mode: decision.mode,
      source: decision.source,
      task_type: decision.plan?.task_type || null,
      plan_id: decision.plan?.plan_id || null,
      correlation_id: decision.plan?.correlation_id || null,
      portfolio: decision.plan?.portfolio?.requested_portfolio || null,
      surface: enrichment?.surface ?? null,
      enrichment: enrichment?.enrichment ?? "not-applicable",
      enrichment_cwd_source: enrichment?.cwd_source ?? null,
      prompt_hash_match: enrichment?.prompt_hash_match ?? null,
      error: transportError || decision.error || null,
    })}\n`)
  } catch {
    // Telemetry is advisory; the request path remains fail-open.
  }
}

export type StreamAttribution = {
  provider: string | null
  model: string | null
}

const MAX_ATTRIBUTION_LINE_LENGTH = 1_024
const ATTRIBUTION_TRAILER = /^:\s*x-omniroute-(provider|model)=([^\u0000-\u0020\u007f]{1,256})\s*$/iu

/**
 * Incrementally read OmniRoute's SSE attribution trailers without retaining
 * response content. State is bounded to one short control line; oversized
 * data lines are discarded until their next newline.
 */
export function createStreamAttributionParser(): {
  push: (chunk: string, final?: boolean) => StreamAttribution
  value: () => StreamAttribution
} {
  let pending = ""
  let droppingOversizedLine = false
  let ignoreLeadingLf = false
  const attribution: StreamAttribution = { provider: null, model: null }

  const inspect = (line: string): void => {
    const match = ATTRIBUTION_TRAILER.exec(line.replace(/\r$/, ""))
    if (!match) return
    if (match[1].toLowerCase() === "provider") attribution.provider = match[2]
    else attribution.model = match[2]
  }

  const snapshot = (): StreamAttribution => ({ ...attribution })

  const finishLine = (): void => {
    if (!droppingOversizedLine) inspect(pending)
    pending = ""
    droppingOversizedLine = false
  }

  return {
    push(chunk: string, final = false): StreamAttribution {
      for (const character of chunk) {
        if (ignoreLeadingLf) {
          ignoreLeadingLf = false
          if (character === "\n") continue
        }
        if (character === "\r") {
          finishLine()
          ignoreLeadingLf = true
          continue
        }
        if (character === "\n") {
          finishLine()
          continue
        }
        if (droppingOversizedLine) continue
        pending += character
        if (pending.length > MAX_ATTRIBUTION_LINE_LENGTH) {
          pending = ""
          droppingOversizedLine = true
        }
      }

      if (final) {
        if (pending || droppingOversizedLine) finishLine()
        ignoreLeadingLf = false
      }
      return snapshot()
    },
    value: snapshot,
  }
}

function streamWithDeferredReceipt(
  upstream: Response,
  decision: RouteDecision,
  enrichment: EnrichmentOutcome,
  requestHeaders: Headers,
  responseHeaders: Headers,
): Response {
  if (!upstream.body) {
    logDecision(decision, enrichment, requestHeaders, new Headers(), "stream_body_missing")
    return new Response(null, { status: upstream.status, headers: responseHeaders })
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const parser = createStreamAttributionParser()
  let logged = false

  const finish = (transportError: string | null = null): void => {
    if (logged) return
    logged = true
    const attribution = parser.push(decoder.decode(), true)
    const receiptHeaders = new Headers(upstream.headers)
    receiptHeaders.delete("x-omniroute-provider")
    receiptHeaders.delete("x-omniroute-model")
    if (attribution.provider) receiptHeaders.set("x-omniroute-provider", attribution.provider)
    if (attribution.model) receiptHeaders.set("x-omniroute-model", attribution.model)
    const receiptError = transportError ||
      (!attribution.provider || !attribution.model ? "stream_attribution_missing" : null)
    logDecision(decision, enrichment, requestHeaders, receiptHeaders, receiptError)
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          finish()
          controller.close()
          return
        }
        parser.push(decoder.decode(result.value, { stream: true }))
        controller.enqueue(result.value)
      } catch (error) {
        finish("stream_read_error")
        controller.error(error)
      }
    },
    async cancel(reason) {
      finish("stream_cancelled")
      await reader.cancel(reason)
    },
  })

  return new Response(body, { status: upstream.status, headers: responseHeaders })
}

async function modelsResponse(fetchImpl: typeof fetch): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetchImpl(`${upstreamBase()}/models`, {
      headers: gatewayKey() ? { authorization: `Bearer ${gatewayKey()}` } : undefined,
    })
  } catch (error) {
    return jsonResponse({ error: { message: `OmniRoute upstream unavailable: ${error instanceof Error ? error.message : String(error)}`, type: "upstream_unavailable" } }, 503)
  }
  if (!upstream.ok) return upstream
  const payload = await upstream.json() as Record<string, unknown>
  const data = Array.isArray(payload.data) ? payload.data : []
  if (!data.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === AUTO_MODEL)) {
    data.push({ id: AUTO_MODEL, object: "model", owned_by: "temperance", permission: [] })
  }
  return jsonResponse({ ...payload, data }, upstream.status)
}

async function chatResponse(request: Request, fetchImpl: typeof fetch, deps: ProxyDependencies): Promise<Response> {
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object")
    body = parsed as Record<string, unknown>
  } catch (error) {
    return jsonResponse({ error: { message: error instanceof Error ? error.message : "invalid JSON", type: "invalid_request_error" } }, 400)
  }

  const requested = text(body.model) || compatibilityModel()
  const readiness = automaticReadiness()
  if (ROUTING_MODELS.has(requested) && !readiness.ready) {
    const decision: RouteDecision = {
      requested_model: requested,
      routed_model: requested,
      mode: "automatic",
      source: "s-tier-fail-closed",
      plan: null,
      prompt: latestUserPrompt(body.messages),
      request_id: requestId(deps),
      error: readiness.reason || "S-tier unavailable",
    }
    const headers = {
      "Retry-After": "60",
      "X-Temperance-Request-ID": decision.request_id,
      "X-Temperance-Route-Mode": decision.mode,
      "X-Temperance-Route-Source": decision.source,
      "X-Temperance-Requested-Model": decision.requested_model,
      "X-Temperance-Routed-Model": decision.routed_model,
    }
    logDecision(decision, undefined, request.headers, new Headers(), decision.error || null)
    return jsonResponse({
      error: {
        message: readiness.reason,
        type: "temperance_s_tier_unavailable",
        code: "s_tier_unavailable",
      },
    }, 503, headers)
  }

  // Explicit-picker models (any caller naming a specific model rather than
  // temperance-auto/temperance-routing) must exist in OmniRoute's live
  // catalog before this proxy forwards them. Automatic routing never needs
  // this check: multi-backend-router.sh's portfolio resolution already only
  // ever proposes models fetched live from OmniRoute (see
  // resolve_portfolio_for_type/omniroute_catalog_json). This closes the same
  // staleness gap package/adapters/opencode/OmniRouteCatalogGuard.ts closes
  // for OpenCode's picker -- ported here so every caller of this proxy gets
  // it, not just OpenCode.
  if (!ROUTING_MODELS.has(requested)) {
    try {
      const ids = await (deps.liveModelIds ?? getLiveModelIds)(upstreamBase())
      assertLiveModel(requested, ids)
    } catch (error) {
      const denied: RouteDecision = {
        requested_model: requested,
        routed_model: requested,
        mode: "direct",
        source: "explicit-picker-denied-stale-catalog",
        plan: null,
        prompt: latestUserPrompt(body.messages),
        request_id: requestId(deps),
        error: error instanceof Error ? error.message : String(error),
      }
      const headers = {
        "X-Temperance-Request-ID": denied.request_id,
        "X-Temperance-Route-Mode": denied.mode,
        "X-Temperance-Route-Source": denied.source,
        "X-Temperance-Requested-Model": denied.requested_model,
      }
      logDecision(denied, undefined, request.headers, new Headers(), denied.error || null)
      return jsonResponse({
        error: {
          message: denied.error,
          type: "temperance_model_denied",
          code: "model_denied",
        },
      }, 404, headers)
    }
  }

  const decision = await resolveRoute(body, deps)
  body.model = decision.routed_model
  const enrichment = await applyEnrichment(body, decision, detectSurface(request.headers), deps)
  const planHeaders: Record<string, string> = {
    "X-Temperance-Request-ID": decision.request_id,
    "X-Temperance-Route-Mode": decision.mode,
    "X-Temperance-Route-Source": decision.source,
    "X-Temperance-Requested-Model": decision.requested_model,
    "X-Temperance-Routed-Model": decision.routed_model,
  }
  if (decision.plan?.plan_id) planHeaders["X-Temperance-Plan-ID"] = decision.plan.plan_id
  if (decision.plan?.correlation_id) planHeaders["X-Temperance-Correlation-ID"] = decision.plan.correlation_id
  if (decision.plan?.task_type) planHeaders["X-Temperance-Task-Type"] = decision.plan.task_type
  if (decision.plan?.portfolio?.requested_portfolio) planHeaders["X-Temperance-Portfolio"] = decision.plan.portfolio.requested_portfolio
  if (enrichment.surface) planHeaders["X-Temperance-Enrichment"] = enrichment.enrichment

  let upstream: Response
  try {
    upstream = await fetchImpl(`${upstreamBase()}/chat/completions`, {
      method: "POST",
      headers: (() => {
        const h = forwardedHeaders(request)
        for (const [key, value] of Object.entries(planHeaders)) h.set(key, value)
        h.set("content-type", "application/json")
        enforceCompressionBoundary(h)
        return h
      })(),
      body: JSON.stringify(body),
    })
  } catch (error) {
    logDecision(
      decision,
      enrichment,
      request.headers,
      new Headers(),
      error instanceof Error ? error.message : String(error),
    )
    return jsonResponse({ error: { message: `OmniRoute upstream unavailable: ${error instanceof Error ? error.message : String(error)}`, type: "upstream_unavailable" } }, 503, planHeaders)
  }

  const headers = new Headers(upstream.headers)
  for (const [key, value] of Object.entries(planHeaders)) headers.set(key, value)
  if (body.stream === true && upstream.ok) {
    return streamWithDeferredReceipt(upstream, decision, enrichment, request.headers, headers)
  }
  if (!upstream.ok) {
    logDecision(
      decision,
      enrichment,
      request.headers,
      upstream.headers,
      `upstream_http_${upstream.status}`,
    )
    return new Response(upstream.body, { status: upstream.status, headers })
  }
  logDecision(decision, enrichment, request.headers, upstream.headers)

  // Preserve the OpenAI response shape while making the selected route visible
  // in a header; the requested synthetic id remains client-facing for buffered
  // responses. Streaming stays byte-for-byte transparent above.
  const raw = await upstream.text()
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    payload.model = decision.requested_model
    headers.set("content-type", "application/json")
    return new Response(JSON.stringify(payload), { status: upstream.status, headers })
  } catch {
    return new Response(raw, { status: upstream.status, headers })
  }
}

export async function handleProxyRequest(
  request: Request,
  deps: ProxyDependencies = {},
): Promise<Response> {
  const url = new URL(request.url)
  const fetchImpl = deps.upstreamFetch ?? fetch
  if (url.pathname === "/health" || url.pathname === "/") {
    const readiness = automaticReadiness()
    return jsonResponse({
      ok: true,
      service: "temperance-openai-proxy",
      automatic_model: AUTO_MODEL,
      automatic_ready: readiness.ready,
      automatic_unavailable_reason: readiness.reason,
      upstream: upstreamBase(),
      enrichment_surfaces: [...ENRICHMENT_SURFACES],
    })
  }
  try {
    if (url.pathname === "/v1/models" && request.method === "GET") return await modelsResponse(fetchImpl)
    if (url.pathname === "/v1/chat/completions" && request.method === "POST") return await chatResponse(request, fetchImpl, deps)
    return jsonResponse({ error: { message: "not found", type: "invalid_request_error" } }, 404)
  } catch (error) {
    return jsonResponse({ error: { message: error instanceof Error ? error.message : String(error), type: "proxy_error" } }, 500)
  }
}

if (import.meta.main) {
  const port = Number(process.env.TEMPERANCE_PROXY_PORT || DEFAULT_PORT)
  const hostname = process.env.TEMPERANCE_PROXY_HOST || "127.0.0.1"
  Bun.serve({
    port,
    hostname,
    fetch: (request) => handleProxyRequest(request),
  })
  console.log(`the Caduceus: Temperance OpenAI proxy listening on http://${hostname}:${port}`)
  console.log(`Automatic model: ${AUTO_MODEL}; upstream: ${upstreamBase()}`)
}
