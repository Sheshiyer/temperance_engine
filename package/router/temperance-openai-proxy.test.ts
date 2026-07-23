import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleProxyRequest, injectContext, latestUserPrompt, readSessionContext, resolveRoute } from "./temperance-openai-proxy"

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
