import { describe, expect, test } from "bun:test"
import { handleProxyRequest, latestUserPrompt, resolveRoute } from "./temperance-openai-proxy"

function plan(model = "te-build") {
  return {
    plan_id: "rp_test",
    correlation_id: "tc_test",
    task_type: "long-horizon",
    selected_order: [{ backend: "omniroute", model }],
    portfolio: { requested_portfolio: "te-build", selected_model: model, source: "portfolio", enforcement: "shadow" },
  }
}

function request(body: Record<string, unknown>, stream = false): Request {
  return new Request("http://127.0.0.1:20129/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream }),
  })
}

describe("Temperance OpenAI proxy", () => {
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
    })
    expect(response.status).toBe(200)
    expect(forwarded?.model).toBe("auto/best-fast")
    expect(response.headers.get("X-Temperance-Route-Mode")).toBe("direct")
    expect((await response.json()).model).toBe("auto/best-fast")
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
