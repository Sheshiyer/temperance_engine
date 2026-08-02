import { describe, expect, test } from "bun:test"
import {
  dispatch,
  extractPromptText,
  handleCancel,
  handleInitialize,
  handleNewSession,
  handlePrompt,
  PROTOCOL_VERSION,
  type ChatMessage,
  type SessionState,
} from "./omniroute-acp-agent"

function sessions(): Map<string, SessionState> {
  return new Map()
}

describe("ACP agent: initialize", () => {
  test("echoes back the supported protocol version and declares minimal capabilities", () => {
    const result = handleInitialize({ protocolVersion: 1 })
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(result.agentCapabilities.loadSession).toBe(false)
    expect(result.agentInfo.name).toBe("omniroute-acp-agent")
  })

  test("rejects initialize without a numeric protocolVersion", () => {
    expect(() => handleInitialize({})).toThrow(/protocolVersion/)
  })
})

describe("ACP agent: session/new", () => {
  test("creates a session keyed by an injectable id and stores cwd", () => {
    const store = sessions()
    const result = handleNewSession({ cwd: "/repo" }, store, { newSessionId: () => "sid-1" })
    expect(result.sessionId).toBe("sid-1")
    expect(store.get("sid-1")).toEqual({ cwd: "/repo", messages: [], aborted: false })
  })

  test("rejects session/new without a cwd", () => {
    expect(() => handleNewSession({}, sessions())).toThrow(/cwd/)
  })
})

describe("ACP agent: extractPromptText", () => {
  test("joins multiple text blocks with a newline", () => {
    expect(extractPromptText([{ type: "text", text: "line one" }, { type: "text", text: "line two" }]))
      .toBe("line one\nline two")
  })

  test("rejects an empty prompt array", () => {
    expect(() => extractPromptText([])).toThrow(/non-empty/)
  })

  test("rejects unsupported content block types instead of silently dropping them", () => {
    expect(() => extractPromptText([{ type: "image" }])).toThrow(/unsupported prompt content block type "image"/)
  })
})

describe("ACP agent: session/prompt", () => {
  test("forwards session history to the chat runner and emits an agent_message_chunk notification", async () => {
    const store = sessions()
    store.set("sid-1", { cwd: "/repo", messages: [], aborted: false })
    const notifications: unknown[] = []
    let seenMessages: unknown
    const result = await handlePrompt(
      { sessionId: "sid-1", prompt: [{ type: "text", text: "hello" }] },
      store,
      {
        chatCompletion: async (messages) => {
          seenMessages = [...messages] // snapshot: `messages` is the live session array, mutated again after this call
          return "hi there"
        },
        notify: (n) => notifications.push(n),
      },
    )
    expect(result.stopReason).toBe("end_turn")
    expect(seenMessages).toEqual([{ role: "user", content: "hello" }])
    expect(store.get("sid-1")?.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
    expect(notifications).toEqual([{
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sid-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi there" } },
      },
    }])
  })

  test("accumulates multi-turn history across separate prompt calls", async () => {
    const store = sessions()
    store.set("sid-1", { cwd: "/repo", messages: [], aborted: false })
    const seen: unknown[] = []
    const deps = {
      chatCompletion: async (messages: ChatMessage[]) => { seen.push([...messages]); return "ok" },
      notify: () => {},
    }
    await handlePrompt({ sessionId: "sid-1", prompt: [{ type: "text", text: "first" }] }, store, deps)
    await handlePrompt({ sessionId: "sid-1", prompt: [{ type: "text", text: "second" }] }, store, deps)
    expect(seen[1]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ])
  })

  test("rejects an unknown sessionId", async () => {
    await expect(handlePrompt({ sessionId: "ghost", prompt: [{ type: "text", text: "hi" }] }, sessions()))
      .rejects.toThrow(/unknown sessionId/)
  })

  test("rolls back the pushed user turn when the chat runner throws, so a retry doesn't duplicate it", async () => {
    const store = sessions()
    store.set("sid-1", { cwd: "/repo", messages: [], aborted: false })
    await expect(handlePrompt(
      { sessionId: "sid-1", prompt: [{ type: "text", text: "hello" }] },
      store,
      { chatCompletion: async () => { throw new Error("upstream unavailable") } },
    )).rejects.toThrow(/upstream unavailable/)
    expect(store.get("sid-1")?.messages).toEqual([])
  })

  test("reports cancelled instead of end_turn when the session was cancelled mid-flight", async () => {
    const store = sessions()
    store.set("sid-1", { cwd: "/repo", messages: [], aborted: false })
    const result = await handlePrompt(
      { sessionId: "sid-1", prompt: [{ type: "text", text: "hello" }] },
      store,
      {
        chatCompletion: async () => {
          handleCancel({ sessionId: "sid-1" }, store)
          return "late answer"
        },
      },
    )
    expect(result.stopReason).toBe("cancelled")
  })
})

describe("ACP agent: JSON-RPC dispatch", () => {
  test("routes initialize/session/new/session/prompt through the full envelope", async () => {
    const store = sessions()
    const initResponse = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } }, store)
    expect(initResponse?.result).toMatchObject({ protocolVersion: 1 })

    const sessionResponse = await dispatch(
      { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/repo" } },
      store,
      { newSessionId: () => "sid-1" },
    )
    expect(sessionResponse?.result).toEqual({ sessionId: "sid-1" })

    const promptResponse = await dispatch(
      { jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: "sid-1", prompt: [{ type: "text", text: "hi" }] } },
      store,
      { chatCompletion: async () => "hello back" },
    )
    expect(promptResponse?.result).toEqual({ stopReason: "end_turn" })
  })

  test("returns a JSON-RPC error for an unknown method", async () => {
    const response = await dispatch({ jsonrpc: "2.0", id: 9, method: "session/load" }, sessions())
    expect(response?.error?.code).toBe(-32601)
    expect(response?.error?.message).toMatch(/method not found/)
  })

  test("returns null (no response) for a notification-shaped message, even on error", async () => {
    const response = await dispatch({ jsonrpc: "2.0", method: "session/load" }, sessions())
    expect(response).toBeNull()
  })

  test("authenticate is a no-op that declares no auth is required", async () => {
    const response = await dispatch({ jsonrpc: "2.0", id: 4, method: "authenticate", params: { methodId: "none" } }, sessions())
    expect(response?.result).toBeNull()
    expect(response?.error).toBeUndefined()
  })

  test("session/cancel acknowledges without requiring an existing session", async () => {
    const response = await dispatch({ jsonrpc: "2.0", id: 5, method: "session/cancel", params: { sessionId: "ghost" } }, sessions())
    expect(response?.result).toBeNull()
    expect(response?.error).toBeUndefined()
  })

  test("preserves the request id on both success and error responses", async () => {
    const ok = await dispatch({ jsonrpc: "2.0", id: "req-abc", method: "authenticate" }, sessions())
    expect(ok?.id).toBe("req-abc")
    const err = await dispatch({ jsonrpc: "2.0", id: "req-xyz", method: "nope" }, sessions())
    expect(err?.id).toBe("req-xyz")
  })
})

describe("ACP agent: real subprocess over stdio (newline-delimited JSON-RPC)", () => {
  test("initialize -> session/new -> session/prompt round-trips through a real spawned process and a real HTTP call", async () => {
    // Stands in for temperance-openai-proxy.ts: proves the agent's actual
    // network call (not a mocked chatCompletion) reaches an HTTP endpoint
    // with the right OpenAI-shaped body. Live OmniRoute is unreachable from
    // this sandbox, so this is the closest honest substitute.
    let receivedBody: unknown
    const mockProxy = Bun.serve({
      port: 0,
      fetch: async (request) => {
        receivedBody = await request.json()
        return new Response(JSON.stringify({ choices: [{ message: { content: "mock reply" } }] }), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    const proc = Bun.spawn(["bun", `${import.meta.dir}/omniroute-acp-agent.ts`], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TEMPERANCE_PROXY_BASE_URL: `http://127.0.0.1:${mockProxy.port}` },
    })
    try {
      const writer = proc.stdin
      const send = (message: object) => writer.write(`${JSON.stringify(message)}\n`)
      const decoder = new TextDecoder()
      const reader = proc.stdout.getReader()
      let buffer = ""
      const readLines = async (count: number): Promise<unknown[]> => {
        const lines: string[] = []
        while (lines.length < count) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim()
            buffer = buffer.slice(idx + 1)
            if (line) lines.push(line)
          }
        }
        return lines.map((line) => JSON.parse(line))
      }

      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })
      send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/repo" } })
      const [initResponse, sessionResponse] = await readLines(2)
      expect(initResponse).toMatchObject({ id: 1, result: { protocolVersion: 1 } })
      expect(sessionResponse).toMatchObject({ id: 2 })
      const sessionId = (sessionResponse as { result: { sessionId: string } }).result.sessionId

      send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: "hi" }] } })
      const [first, second] = await readLines(2)
      const notification = [first, second].find((m: any) => m.method === "session/update") as any
      const promptResult = [first, second].find((m: any) => m.id === 3) as any

      expect(notification?.params?.update).toEqual({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "mock reply" },
      })
      expect(promptResult?.result).toEqual({ stopReason: "end_turn" })
      expect(receivedBody).toMatchObject({
        model: "temperance-auto",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      })
    } finally {
      proc.kill()
      mockProxy.stop(true)
    }
  })
})
