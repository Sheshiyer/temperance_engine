#!/usr/bin/env bun
/** Test-only OpenAI-compatible gateway used by tests/temperance-proxy-live.sh. */

const port = Number(process.env.TEMPERANCE_MOCK_PORT || 22330)

Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/v1/models") {
      return Response.json({ data: [
        { id: "temperance-coding", owned_by: "mock" },
        { id: "te-build", owned_by: "mock" },
        { id: "auto/best-coding", owned_by: "mock" },
      ] })
    }
    if (url.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      return new Response("not found", { status: 404 })
    }

    const body = await request.json() as Record<string, unknown>
    if (body.stream === true) {
      return new Response(
        'data: {"id":"mock-stream","model":"temperance-coding","choices":[{"delta":{"content":"MOCK_STREAM_OK"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      return Response.json({
        id: "mock-tool",
        model: body.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_mock",
              type: "function",
              function: { name: "write_file", arguments: '{"path":"x"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
      })
    }
    // Echo the latest user content so relay-side enrichment injection is
    // assertable end-to-end (tests grep for the <temperance-context> marker).
    const messages = Array.isArray(body.messages) ? body.messages : []
    const latestUser = [...messages].reverse().find((m) =>
      m && typeof m === "object" && (m as Record<string, unknown>).role === "user")
    return Response.json({ id: "mock-chat", model: body.model, choices: [{
      index: 0,
      message: { role: "assistant", content: "MOCK_OK" },
      finish_reason: "stop",
    }], echo: { latest_user_content: latestUser ? (latestUser as Record<string, unknown>).content ?? null : null } })
  },
})

console.log(`Temperance mock gateway listening on ${port}`)
setInterval(() => {}, 1000)
