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
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export const AUTO_MODEL = "temperance-auto"
export const ROUTING_MODELS = new Set([AUTO_MODEL, "temperance-routing"])
const DEFAULT_PORT = 20129
const DEFAULT_UPSTREAM = "http://127.0.0.1:20128/v1"
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

export type ProxyDependencies = {
  upstreamFetch?: typeof fetch
  planRunner?: (prompt: string) => Promise<RoutePlan>
  requestId?: () => string
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

function jsonResponse(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...extra },
  })
}

function logDecision(decision: RouteDecision): void {
  const path = process.env.TEMPERANCE_PROXY_LOG || join(process.env.TEMPERANCE_STATE_DIR || join(process.env.HOME || ".", ".temperance_engine", "state"), "openai-proxy.jsonl")
  try {
    mkdirSync(join(path, ".."), { recursive: true })
    appendFileSync(path, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      request_id: decision.request_id,
      requested_model: decision.requested_model,
      routed_model: decision.routed_model,
      mode: decision.mode,
      source: decision.source,
      task_type: decision.plan?.task_type || null,
      plan_id: decision.plan?.plan_id || null,
      correlation_id: decision.plan?.correlation_id || null,
      portfolio: decision.plan?.portfolio?.requested_portfolio || null,
      error: decision.error || null,
    })}\n`)
  } catch {
    // Telemetry is advisory; the request path remains fail-open.
  }
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

  const decision = await resolveRoute(body, deps)
  body.model = decision.routed_model
  logDecision(decision)
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

  let upstream: Response
  try {
    upstream = await fetchImpl(`${upstreamBase()}/chat/completions`, {
      method: "POST",
      headers: (() => {
        const h = forwardedHeaders(request)
        for (const [key, value] of Object.entries(planHeaders)) h.set(key, value)
        h.set("content-type", "application/json")
        return h
      })(),
      body: JSON.stringify(body),
    })
  } catch (error) {
    return jsonResponse({ error: { message: `OmniRoute upstream unavailable: ${error instanceof Error ? error.message : String(error)}`, type: "upstream_unavailable" } }, 503, planHeaders)
  }

  const headers = new Headers(upstream.headers)
  for (const [key, value] of Object.entries(planHeaders)) headers.set(key, value)
  if (body.stream === true || !upstream.ok) return new Response(upstream.body, { status: upstream.status, headers })

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
    return jsonResponse({ ok: true, service: "temperance-openai-proxy", automatic_model: AUTO_MODEL, upstream: upstreamBase() })
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
  console.log(`Temperance OpenAI proxy listening on http://${hostname}:${port}`)
  console.log(`Automatic model: ${AUTO_MODEL}; upstream: ${upstreamBase()}`)
}
