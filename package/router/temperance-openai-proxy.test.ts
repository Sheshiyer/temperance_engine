import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { automaticReadiness, handleProxyRequest, injectContext, latestUserPrompt, readSessionContext, resolveRoute } from "./temperance-openai-proxy"

function plan(model = "te-build") {
  return {
    plan_id: "rp_test",
    correlation_id: "tc_test",
    task_type: "long-horizon",
    selected_order: [{ backend: "omniroute", model }],
    portfolio: { requested_portfolio: "te-build", selected_model: model, source: "portfolio", enforcement: "shadow" },
  }
}

function request(body: Record<string, unknown>, stream = false, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:20129/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream }),
  })
}

const KIMI_HEADERS = { "x-temperance-surface": "kimi" }
const TEST_BLOCK = "<temperance-context>\nmode/tier: ALGORITHM / E3 | reason: test | source: classifier\n</temperance-context>"
const ORIGINAL_AUTO_READY = process.env.TEMPERANCE_AUTO_READY
const ORIGINAL_PROXY_LOG = process.env.TEMPERANCE_PROXY_LOG

beforeEach(() => {
  process.env.TEMPERANCE_AUTO_READY = "1"
  process.env.TEMPERANCE_PROXY_LOG = join(mkdtempSync(join(tmpdir(), "temperance-proxy-test-")), "routes.jsonl")
})

afterAll(() => {
  if (ORIGINAL_AUTO_READY === undefined) delete process.env.TEMPERANCE_AUTO_READY
  else process.env.TEMPERANCE_AUTO_READY = ORIGINAL_AUTO_READY
  if (ORIGINAL_PROXY_LOG === undefined) delete process.env.TEMPERANCE_PROXY_LOG
  else process.env.TEMPERANCE_PROXY_LOG = ORIGINAL_PROXY_LOG
})

describe("Temperance OpenAI proxy", () => {
  test("fails automatic routing closed when readiness evidence is absent", () => {
    const previousReady = process.env.TEMPERANCE_AUTO_READY
    const previousReason = process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON
    delete process.env.TEMPERANCE_AUTO_READY
    delete process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON
    try {
      expect(automaticReadiness()).toEqual({
        ready: false,
        reason: "A verified S-tier coordinator is unavailable on this host.",
      })
    } finally {
      if (previousReady === undefined) delete process.env.TEMPERANCE_AUTO_READY
      else process.env.TEMPERANCE_AUTO_READY = previousReady
      if (previousReason === undefined) delete process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON
      else process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON = previousReason
    }
  })

  test("fails automatic routing closed for an unrecognized readiness value", () => {
    const previousReady = process.env.TEMPERANCE_AUTO_READY
    process.env.TEMPERANCE_AUTO_READY = "unknown"
    try {
      expect(automaticReadiness().ready).toBe(false)
    } finally {
      if (previousReady === undefined) delete process.env.TEMPERANCE_AUTO_READY
      else process.env.TEMPERANCE_AUTO_READY = previousReady
    }
  })

  test("accepts only explicit affirmative readiness strings", () => {
    const previousReady = process.env.TEMPERANCE_AUTO_READY
    try {
      for (const value of ["1", "true", "TRUE", "yes", "on", " on "]) {
        process.env.TEMPERANCE_AUTO_READY = value
        expect(automaticReadiness().ready).toBe(true)
      }
      for (const value of ["", "0", "false", "no", "off", "null", "undefined", "unknown"]) {
        process.env.TEMPERANCE_AUTO_READY = value
        expect(automaticReadiness().ready).toBe(false)
      }
    } finally {
      if (previousReady === undefined) delete process.env.TEMPERANCE_AUTO_READY
      else process.env.TEMPERANCE_AUTO_READY = previousReady
    }
  })

  test("fails automatic routing closed when this host has no verified S tier", async () => {
    const previousReady = process.env.TEMPERANCE_AUTO_READY
    const previousReason = process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON
    const previousLog = process.env.TEMPERANCE_PROXY_LOG
    const receiptDir = mkdtempSync(join(tmpdir(), "temperance-s-gate-"))
    process.env.TEMPERANCE_AUTO_READY = "0"
    process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON = "Authenticate an S-tier coordinator before Algorithm mode."
    process.env.TEMPERANCE_PROXY_LOG = join(receiptDir, "routes.jsonl")
    let upstreamCalls = 0
    try {
      expect(automaticReadiness()).toEqual({
        ready: false,
        reason: "Authenticate an S-tier coordinator before Algorithm mode.",
      })
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "plan the migration" }],
      }), {
        upstreamFetch: async () => {
          upstreamCalls += 1
          return new Response("unexpected")
        },
        requestId: () => "s-gate",
      })
      expect(response.status).toBe(503)
      expect(response.headers.get("X-Temperance-Route-Source")).toBe("s-tier-fail-closed")
      expect(response.headers.get("Retry-After")).toBe("60")
      expect((await response.json()).error.code).toBe("s_tier_unavailable")
      expect(upstreamCalls).toBe(0)

      const health = await handleProxyRequest(new Request("http://127.0.0.1:20129/health"))
      expect((await health.json()).automatic_ready).toBe(false)
    } finally {
      if (previousReady === undefined) delete process.env.TEMPERANCE_AUTO_READY
      else process.env.TEMPERANCE_AUTO_READY = previousReady
      if (previousReason === undefined) delete process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON
      else process.env.TEMPERANCE_AUTO_UNAVAILABLE_REASON = previousReason
      if (previousLog === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previousLog
    }
  })

  test("the S-tier gate never blocks an explicit Native or continuity model", async () => {
    const previousReady = process.env.TEMPERANCE_AUTO_READY
    process.env.TEMPERANCE_AUTO_READY = "false"
    let forwarded: Record<string, unknown> | undefined
    try {
      const response = await handleProxyRequest(request({
        model: "te-fast",
        messages: [{ role: "user", content: "quick bounded task" }],
      }), {
        upstreamFetch: async (_url, init) => {
          forwarded = JSON.parse(String(init?.body))
          return new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } })
        },
        liveModelIds: async () => new Set(["te-fast"]),
      })
      expect(response.status).toBe(200)
      expect(forwarded?.model).toBe("te-fast")
    } finally {
      if (previousReady === undefined) delete process.env.TEMPERANCE_AUTO_READY
      else process.env.TEMPERANCE_AUTO_READY = previousReady
    }
  })

  test("extracts the latest user prompt without reclassifying message parts", () => {
    expect(latestUserPrompt([
      { role: "system", content: "system" },
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: "answer" },
      { role: "user", content: "refactor the router" },
    ])).toBe("refactor the router")
  })

  test("keeps explicit picker models as direct overrides", async () => {
    const decision = await resolveRoute({ model: "auto/best-coding", messages: [{ role: "user", content: "fix it" }] }, {
      requestId: () => "direct",
    })
    expect(decision.mode).toBe("direct")
    expect(decision.routed_model).toBe("auto/best-coding")
    expect(decision.source).toBe("explicit-picker-override")
  })

  test("routes automatic work through the frozen OmniRoute plan", async () => {
    const decision = await resolveRoute({ model: "temperance-auto", messages: [{ role: "user", content: "refactor the auth layer" }] }, {
      planRunner: async () => plan("te-build"),
      requestId: () => "automatic",
    })
    expect(decision.mode).toBe("automatic")
    expect(decision.routed_model).toBe("te-build")
    expect(decision.plan?.correlation_id).toBe("tc_test")
  })

  test("uses the compatibility combo for tool-carrying automatic requests", async () => {
    const decision = await resolveRoute({
      model: "temperance-auto",
      messages: [{ role: "user", content: "edit the file" }],
      tools: [{ type: "function", function: { name: "write_file" } }],
    }, { planRunner: async () => plan("te-build") })
    expect(decision.routed_model).toBe("temperance-coding")
    expect(decision.source).toBe("tool-safe-compatibility")
  })

  test("gives concurrent automatic requests distinct request traces", async () => {
    const [first, second] = await Promise.all([
      resolveRoute({ model: "temperance-auto", messages: [{ role: "user", content: "same task" }] }, { planRunner: async () => plan() }),
      resolveRoute({ model: "temperance-auto", messages: [{ role: "user", content: "same task" }] }, { planRunner: async () => plan() }),
    ])
    expect(first.request_id).not.toBe(second.request_id)
    expect(first.plan?.correlation_id).toBe(second.plan?.correlation_id)
  })

  test("route receipts bind session, task, profile, tier, and concrete attribution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-route-receipt-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    try {
      await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "refactor the API" }],
      }, false, {
        "x-temperance-session-id": "session-test",
        "x-temperance-profile": "temperance-algorithm",
        "x-temperance-capability-tier": "S",
      }), {
        planRunner: async () => plan("te-algorithm"),
        upstreamFetch: async () => new Response(JSON.stringify({
          id: "receipt-test",
          model: "gpt-5.6-sol-max",
          choices: [],
        }), {
          headers: {
            "content-type": "application/json",
            "x-omniroute-provider": "codex",
            "x-omniroute-model": "gpt-5.6-sol-max",
            "x-omniroute-session-id": "omniroute-session",
          },
        }),
        requestId: () => "request-test",
      })
      const receipt = JSON.parse(readFileSync(logPath, "utf8").trim())
      expect(receipt.session_id).toBe("session-test")
      expect(receipt.task_id).toBe("tc_test")
      expect(receipt.profile).toBe("temperance-algorithm")
      expect(receipt.capability_tier).toBe("S")
      expect(receipt.decision).toBe("frozen-plan")
      expect(receipt.resolved_provider).toBe("codex")
      expect(receipt.resolved_model).toBe("gpt-5.6-sol-max")
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("buffered receipts preserve missing OmniRoute attribution as null", async () => {
    const logPath = process.env.TEMPERANCE_PROXY_LOG!
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "buffer without attribution" }],
    }), {
      planRunner: async () => plan("te-build"),
      upstreamFetch: async () => new Response(JSON.stringify({ choices: [] }), {
        headers: { "content-type": "application/json" },
      }),
      requestId: () => "buffered-null-attribution",
    })
    expect(response.status).toBe(200)
    const receipt = JSON.parse(readFileSync(logPath, "utf8").trim())
    expect(receipt.resolved_provider).toBeNull()
    expect(receipt.resolved_model).toBeNull()
    expect(receipt.error).toBeNull()
  })

  test("passes direct requests and routing headers through unchanged", async () => {
    let forwarded: Record<string, unknown> | undefined
    const response = await handleProxyRequest(request({
      model: "auto/best-fast",
      messages: [{ role: "user", content: "quick answer" }],
    }), {
      upstreamFetch: async (_url, init) => {
        forwarded = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ id: "chatcmpl_direct", model: forwarded.model, choices: [] }), {
          headers: { "content-type": "application/json" },
        })
      },
      requestId: () => "direct-request",
      liveModelIds: async () => new Set(["auto/best-fast"]),
    })
    expect(response.status).toBe(200)
    expect(forwarded?.model).toBe("auto/best-fast")
    expect(response.headers.get("X-Temperance-Route-Mode")).toBe("direct")
    expect((await response.json()).model).toBe("auto/best-fast")
  })

  test("denies an explicit model absent from the live catalog without forwarding upstream", async () => {
    let upstreamCalled = false
    const response = await handleProxyRequest(request({
      model: "stale/removed-model",
      messages: [{ role: "user", content: "quick answer" }],
    }), {
      upstreamFetch: async () => {
        upstreamCalled = true
        return new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } })
      },
      requestId: () => "denied-request",
      liveModelIds: async () => new Set(["auto/best-fast", "te-fast"]),
    })
    expect(response.status).toBe(404)
    expect(upstreamCalled).toBe(false)
    expect(response.headers.get("X-Temperance-Route-Source")).toBe("explicit-picker-denied-stale-catalog")
    expect((await response.json()).error.code).toBe("model_denied")
  })

  test("fails closed (denies, does not fail open) when the live catalog itself is unreachable", async () => {
    let upstreamCalled = false
    const response = await handleProxyRequest(request({
      model: "auto/best-fast",
      messages: [{ role: "user", content: "quick answer" }],
    }), {
      upstreamFetch: async () => {
        upstreamCalled = true
        return new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } })
      },
      liveModelIds: async () => { throw new Error("OmniRoute catalog unavailable (HTTP 503)") },
    })
    expect(response.status).toBe(404)
    expect(upstreamCalled).toBe(false)
    expect((await response.json()).error.message).toMatch(/catalog unavailable/i)
  })

  test("automatic routing is never subject to the explicit-picker catalog guard", async () => {
    let liveModelIdsCalled = false
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "quick answer" }],
    }), {
      planRunner: async () => plan("te-fast"),
      upstreamFetch: async () => new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } }),
      liveModelIds: async () => { liveModelIdsCalled = true; return new Set() },
    })
    expect(response.status).toBe(200)
    expect(liveModelIdsCalled).toBe(false)
  })

  test("forces a client compression-on request to literal off upstream", async () => {
    let outbound = new Headers()
    let outboundBody = ""
    const originalBody = {
      model: "auto/best-fast",
      messages: [{ role: "user", content: "keep this prompt byte-stable" }],
    }
    const expectedBody = JSON.stringify({ ...originalBody, stream: false })
    const response = await handleProxyRequest(request(originalBody, false, { "x-omniroute-compression": "on" }), {
      upstreamFetch: async (_url, init) => {
        outbound = new Headers(init?.headers)
        outboundBody = String(init?.body ?? "")
        return new Response(JSON.stringify({ choices: [] }), {
          headers: { "content-type": "application/json" },
        })
      },
      requestId: () => "compression-on",
      liveModelIds: async () => new Set(["auto/best-fast"]),
    })

    const compressionEntries = [...outbound.entries()].filter(([key]) =>
      key.toLowerCase() === "x-omniroute-compression"
    )
    expect(compressionEntries).toEqual([["x-omniroute-compression", "off"]])
    expect(outboundBody).toBe(expectedBody)
    expect(response.headers.get("x-omniroute-compression")).toBeNull()
  })

  test("canonicalizes a mixed-case compression header after route metadata", async () => {
    let outbound = new Headers()
    await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "route without compression" }],
    }, false, { "X-OmNiRoUtE-CoMpReSsIoN": "engine:caveman" }), {
      planRunner: async () => plan("te-build"),
      upstreamFetch: async (_url, init) => {
        outbound = new Headers(init?.headers)
        return new Response(JSON.stringify({ choices: [] }), {
          headers: { "content-type": "application/json" },
        })
      },
      requestId: () => "compression-mixed-case",
    })

    const compressionEntries = [...outbound.entries()].filter(([key]) =>
      key.toLowerCase() === "x-omniroute-compression"
    )
    expect(compressionEntries).toEqual([["x-omniroute-compression", "off"]])
    expect(outbound.get("x-temperance-route-source")).toBe("frozen-plan")
  })

  test("preserves streaming bytes and forwards frozen-plan headers", async () => {
    let forwarded: Record<string, unknown> | undefined
    const upstreamStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"choices\":[]}\n\n"))
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
        controller.close()
      },
    })
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "refactor the API" }],
    }, true), {
      planRunner: async () => plan("te-build"),
      upstreamFetch: async (_url, init) => {
        forwarded = JSON.parse(String(init?.body))
        return new Response(upstreamStream, { status: 200, headers: { "content-type": "text/event-stream" } })
      },
      requestId: () => "stream-request",
    })
    expect(forwarded?.model).toBe("te-build")
    expect(response.headers.get("X-Temperance-Correlation-ID")).toBe("tc_test")
    expect(await response.text()).toContain("data: [DONE]")
  })

  test("finalizes streaming receipts from split OmniRoute attribution trailers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-stream-receipt-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    const chunks = [
      `data: ${"x".repeat(1_100)}\r`,
      '\n: x-omniroute-provi',
      'der=tr@edge\r\n: x-omniroute-model=gemini-3-',
      'flash-solo@edge\rdata: [DONE]\r\n\r\n',
    ]
    const expectedBytes = new TextEncoder().encode(chunks.join(""))
    try {
      const upstreamStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
          controller.close()
        },
      })
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "stream the receipt" }],
      }, true, {
        "x-temperance-session-id": "stream-session",
        "x-temperance-profile": "temperance-auto",
        "x-temperance-capability-tier": "S",
      }), {
        planRunner: async () => plan("temperance-coding"),
        upstreamFetch: async () => new Response(upstreamStream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-omniroute-provider": "stale-provider",
            "x-omniroute-model": "stale-model",
          },
        }),
        requestId: () => "stream-receipt-request",
      })

      expect(existsSync(logPath)).toBe(false)
      const returnedBytes = new Uint8Array(await response.arrayBuffer())
      expect(Array.from(returnedBytes)).toEqual(Array.from(expectedBytes))
      const lines = readFileSync(logPath, "utf8").trim().split("\n")
      expect(lines).toHaveLength(1)
      const receipt = JSON.parse(lines[0])
      expect(receipt.session_id).toBe("stream-session")
      expect(receipt.resolved_provider).toBe("tr@edge")
      expect(receipt.resolved_model).toBe("gemini-3-flash-solo@edge")
      expect(receipt.error).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("marks a completed stream without both attribution trailers as failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-stream-missing-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    try {
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "missing attribution" }],
      }, true), {
        planRunner: async () => plan("temperance-coding"),
        upstreamFetch: async () => new Response(": x-omniroute-provider=tr\n\ndata: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      })
      await response.text()
      const receipt = JSON.parse(readFileSync(logPath, "utf8").trim())
      expect(receipt.resolved_provider).toBe("tr")
      expect(receipt.resolved_model).toBeNull()
      expect(receipt.error).toBe("stream_attribution_missing")
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("records cancellation before propagating it upstream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-stream-cancel-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    let cancelCalls = 0
    try {
      const upstreamStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: partial\n\n"))
        },
        cancel() {
          cancelCalls += 1
        },
      })
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "cancel this stream" }],
      }, true), {
        planRunner: async () => plan("temperance-coding"),
        upstreamFetch: async () => new Response(upstreamStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      })
      const reader = response.body!.getReader()
      await reader.read()
      await reader.cancel("test cancellation")
      expect(cancelCalls).toBe(1)
      const lines = readFileSync(logPath, "utf8").trim().split("\n")
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]).error).toBe("stream_cancelled")
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("marks a successful streaming response with no body as failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-stream-bodyless-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    try {
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "bodyless stream" }],
      }, true), {
        planRunner: async () => plan("temperance-coding"),
        upstreamFetch: async () => new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      })
      expect(await response.text()).toBe("")
      const receipt = JSON.parse(readFileSync(logPath, "utf8").trim())
      expect(receipt.error).toBe("stream_body_missing")
      expect(receipt.resolved_provider).toBeNull()
      expect(receipt.resolved_model).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("marks a non-success streaming response as an upstream HTTP error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-stream-http-error-"))
    const logPath = join(dir, "routes.jsonl")
    const previous = process.env.TEMPERANCE_PROXY_LOG
    process.env.TEMPERANCE_PROXY_LOG = logPath
    try {
      const response = await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "rate limited stream" }],
      }, true), {
        planRunner: async () => plan("temperance-coding"),
        upstreamFetch: async () => new Response("data: rate limited\n\n", {
          status: 429,
          headers: { "content-type": "text/event-stream", "retry-after": "2" },
        }),
      })
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("2")
      expect(await response.text()).toBe("data: rate limited\n\n")
      const receipt = JSON.parse(readFileSync(logPath, "utf8").trim())
      expect(receipt.error).toBe("upstream_http_429")
    } finally {
      if (previous === undefined) delete process.env.TEMPERANCE_PROXY_LOG
      else process.env.TEMPERANCE_PROXY_LOG = previous
    }
  })

  test("injects enrichment into the latest user message for kimi-surface requests", async () => {
    let forwarded: Record<string, unknown> | undefined
    const history = { role: "user", content: "earlier turn" }
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [
        { role: "system", content: "sys" },
        history,
        { role: "assistant", content: "done" },
        { role: "user", content: "refactor the auth layer" },
      ],
    }, false, KIMI_HEADERS), {
      planRunner: async () => plan("te-build"),
      enrichRunner: async () => TEST_BLOCK,
      sessionContext: () => null,
      upstreamFetch: async (_url, init) => {
        forwarded = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ id: "x", model: "te-build", choices: [] }), { headers: { "content-type": "application/json" } })
      },
    })
    const messages = forwarded?.messages as Array<Record<string, unknown>>
    expect(messages[3].content).toBe(`${TEST_BLOCK}\n\nrefactor the auth layer`)
    expect(messages[1].content).toBe("earlier turn")
    expect(messages[0].content).toBe("sys")
    expect(response.headers.get("X-Temperance-Enrichment")).toBe("injected")
  })

  test("kimi enrichment uses the sidecar cwd when fresh, relay cwd otherwise", async () => {
    const seen: string[] = []
    const deps = (session: { cwd: string } | null) => ({
      planRunner: async () => plan(),
      sessionContext: () => session ? { schema_version: "temperance-kimi-session-v1", cwd: session.cwd, ts: Date.now() } : null,
      enrichRunner: async (input: { cwd: string }) => { seen.push(input.cwd); return TEST_BLOCK },
      upstreamFetch: async () => new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } }),
    })
    await handleProxyRequest(request({ model: "temperance-auto", messages: [{ role: "user", content: "task" }] }, false, KIMI_HEADERS), deps({ cwd: "/tmp/kimi-project" }))
    await handleProxyRequest(request({ model: "temperance-auto", messages: [{ role: "user", content: "task" }] }, false, KIMI_HEADERS), deps(null))
    expect(seen[0]).toBe("/tmp/kimi-project")
    expect(seen[1]).toBe(process.cwd())
  })

  test("enrichment failure forwards the request unmodified (fail-open)", async () => {
    let forwarded: Record<string, unknown> | undefined
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "task text" }],
    }, false, KIMI_HEADERS), {
      planRunner: async () => plan(),
      sessionContext: () => null,
      enrichRunner: async () => { throw new Error("enrich blew up") },
      upstreamFetch: async (_url, init) => {
        forwarded = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } })
      },
    })
    const messages = forwarded?.messages as Array<Record<string, unknown>>
    expect(messages[0].content).toBe("task text")
    expect(response.headers.get("X-Temperance-Enrichment")).toBe("skipped")
  })

  test("never enriches client-enriched or untagged surfaces", async () => {
    let calls = 0
    const deps = {
      planRunner: async () => plan(),
      enrichRunner: async () => { calls += 1; return TEST_BLOCK },
      upstreamFetch: async () => new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } }),
    }
    const untagged = await handleProxyRequest(request({ model: "temperance-auto", messages: [{ role: "user", content: "task" }] }), deps)
    const opencode = await handleProxyRequest(request({ model: "temperance-auto", messages: [{ role: "user", content: "task" }] }, false, { "x-temperance-surface": "opencode" }), deps)
    expect(calls).toBe(0)
    expect(untagged.headers.get("X-Temperance-Enrichment")).toBeNull()
    expect(opencode.headers.get("X-Temperance-Enrichment")).toBe("not-applicable")
  })

  test("replaces a stale context block instead of stacking a second one", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "<temperance-context>\nold line\n</temperance-context>\n\nactual ask" }],
    }
    expect(injectContext(body, TEST_BLOCK)).toBe(true)
    const content = (body.messages as Array<Record<string, unknown>>)[0].content as string
    expect(content).toBe(`${TEST_BLOCK}\n\nactual ask`)
    expect(content.match(/<temperance-context>/g)?.length).toBe(1)
  })

  test("injects into array-content user messages by unshifting a text part", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: [
        { type: "text", text: "describe this image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
      ] }],
    }
    expect(injectContext(body, TEST_BLOCK)).toBe(true)
    const parts = (body.messages as Array<Record<string, unknown>>)[0].content as Array<Record<string, unknown>>
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: "text", text: TEST_BLOCK })
    expect(parts[1].text).toBe("describe this image")
    expect(parts[2].type).toBe("image_url")
  })

  test("streaming kimi requests carry the injected block upstream, response passthrough untouched", async () => {
    let forwarded: Record<string, unknown> | undefined
    const upstreamStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
        controller.close()
      },
    })
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "stream this" }],
    }, true, KIMI_HEADERS), {
      planRunner: async () => plan("te-build"),
      sessionContext: () => null,
      enrichRunner: async () => TEST_BLOCK,
      upstreamFetch: async (_url, init) => {
        forwarded = JSON.parse(String(init?.body))
        return new Response(upstreamStream, { status: 200, headers: { "content-type": "text/event-stream" } })
      },
    })
    const messages = forwarded?.messages as Array<Record<string, unknown>>
    expect(messages[0].content).toBe(`${TEST_BLOCK}\n\nstream this`)
    expect(await response.text()).toBe("data: [DONE]\n\n")
  })

  test("readSessionContext enforces schema, cwd, and freshness", () => {
    const dir = mkdtempSync(join(tmpdir(), "te-kimi-session-"))
    const path = join(dir, "session-context.json")
    const now = 1_800_000_000_000
    const write = (value: unknown) => writeFileSync(path, JSON.stringify(value))
    write({ schema_version: "temperance-kimi-session-v1", session_id: "s1", cwd: "/tmp/p", ts: now - 1_000, prompt_hash: "abc123" })
    expect(readSessionContext(path, now, 120_000)?.cwd).toBe("/tmp/p")
    write({ schema_version: "temperance-kimi-session-v1", cwd: "/tmp/p", ts: now - 300_000 })
    expect(readSessionContext(path, now, 120_000)).toBeNull()
    write({ schema_version: "some-other-schema", cwd: "/tmp/p", ts: now })
    expect(readSessionContext(path, now, 120_000)).toBeNull()
    write({ schema_version: "temperance-kimi-session-v1", ts: now })
    expect(readSessionContext(path, now, 120_000)).toBeNull()
    writeFileSync(path, "{corrupt")
    expect(readSessionContext(path, now, 120_000)).toBeNull()
    expect(readSessionContext(join(dir, "missing.json"), now, 120_000)).toBeNull()
  })

  test("passes upstream errors and status codes unchanged", async () => {
    const response = await handleProxyRequest(request({
      model: "temperance-auto",
      messages: [{ role: "user", content: "try again" }],
    }), {
      planRunner: async () => plan(),
      upstreamFetch: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "2" },
      }),
    })
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("2")
    expect((await response.json()).error.message).toBe("rate limited")
  })
})

describe("gateway key resolution", () => {
  async function authHeaderWith(env: Record<string, string | undefined>): Promise<string | null> {
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    let seen: string | null = null
    try {
      await handleProxyRequest(request({
        model: "temperance-auto",
        messages: [{ role: "user", content: "hi" }],
      }), {
        planRunner: async () => plan(),
        upstreamFetch: async (_url, init) => {
          seen = new Headers(init?.headers).get("authorization")
          return new Response(JSON.stringify({ choices: [] }), { headers: { "content-type": "application/json" } })
        },
      })
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
    return seen
  }

  test("reads the key from OMNIROUTE_API_KEY_FILE when the env var is unset", async () => {
    // This is the path EC2/systemd depends on: the Keychain fallback is darwin-only,
    // so without a file source the relay has no way to find a key on Linux.
    const dir = mkdtempSync(join(tmpdir(), "temperance-key-"))
    const keyPath = join(dir, "omniroute-proxy.key")
    writeFileSync(keyPath, "sk-from-file\n")
    expect(await authHeaderWith({
      OMNIROUTE_API_KEY: undefined,
      OMNIROUTE_API_KEY_FILE: keyPath,
    })).toBe("Bearer sk-from-file")
  })

  test("OMNIROUTE_API_KEY still wins over the key file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "temperance-key-"))
    const keyPath = join(dir, "omniroute-proxy.key")
    writeFileSync(keyPath, "sk-from-file")
    expect(await authHeaderWith({
      OMNIROUTE_API_KEY: "sk-from-env",
      OMNIROUTE_API_KEY_FILE: keyPath,
    })).toBe("Bearer sk-from-env")
  })

  test("an unreadable key file degrades to no authorization header, not a crash", async () => {
    expect(await authHeaderWith({
      OMNIROUTE_API_KEY: undefined,
      OMNIROUTE_API_KEY_FILE: join(tmpdir(), "definitely-not-here-temperance.key"),
      TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE: "temperance-test-absent-service",
    })).toBeNull()
  })
})
