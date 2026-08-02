#!/usr/bin/env bun
/**
 * Paseo-native OmniRoute provider: a minimal Agent Client Protocol (ACP)
 * agent that Paseo can spawn directly via its `agents.providers` config
 * (the same `extends: "acp"` mechanism it already uses for grok/kimi/
 * copilot/codex/pi -- see ~/.paseo/config.json), bypassing the OpenCode
 * plugin/proxy relay entirely.
 *
 * Transport: JSON-RPC 2.0, newline-delimited, over stdio -- verified against
 * the real `acp` Python SDK (v0.10.8 schema, PROTOCOL_VERSION=1) already
 * installed for Paseo's existing kimi-cli provider
 * (~/.local/share/uv/tools/kimi-cli/lib/python3.13/site-packages/acp), not
 * guessed. Method names, field aliases (camelCase on the wire), and the
 * session/update notification shape all come from that SDK's schema.py /
 * meta.py.
 *
 * Scope (v1, honestly bounded): implements initialize, session/new,
 * session/prompt, session/cancel (best-effort abort), and authenticate
 * (declares no auth methods). Text content blocks only -- image/audio/
 * resource blocks in a prompt are rejected with a clear error rather than
 * silently dropped. Responses are NOT streamed incrementally: this agent
 * buffers the full completion from temperance-openai-proxy.ts and emits it
 * as a single agent_message_chunk notification, then completes the turn.
 * load_session/list_sessions/fork_session/resume_session/set_session_mode/
 * set_session_model are not implemented (agentCapabilities.loadSession is
 * declared false; the others have no ACP capability flag to declare false,
 * so they respond with a JSON-RPC "method not found" error, which is valid
 * per the protocol for methods a client doesn't rely on).
 *
 * Delegates ALL model/provider selection to the existing, unmodified
 * temperance-openai-proxy.ts (routing-policy.ts + portfolio resolution +
 * fail-closed catalog guard, see omniroute-catalog-guard.ts) via a plain
 * HTTP call -- this file owns protocol translation only, not routing.
 */

import { randomUUID } from "node:crypto"

export const PROTOCOL_VERSION = 1
const DEFAULT_PROXY_BASE = process.env.TEMPERANCE_PROXY_BASE_URL || "http://127.0.0.1:20129/v1"
const DEFAULT_MODEL = process.env.TEMPERANCE_OMNIROUTE_MODEL_HINT || "temperance-auto"

export type JsonRpcId = number | string | null

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export type ChatMessage = { role: "user" | "assistant"; content: string }

export type SessionState = {
  cwd: string
  messages: ChatMessage[]
  aborted: boolean
}

export type TextContentBlock = { type: "text"; text: string }
type UnsupportedContentBlock = { type: "image" | "audio" | "resource_link" | "resource" }
type PromptContentBlock = TextContentBlock | UnsupportedContentBlock

export type ChatCompletionRunner = (messages: ChatMessage[]) => Promise<string>

export type AgentDependencies = {
  chatCompletion?: ChatCompletionRunner
  notify?: (notification: JsonRpcNotification) => void
  newSessionId?: () => string
}

const JSONRPC_METHOD_NOT_FOUND = -32601
const JSONRPC_INVALID_PARAMS = -32602
const JSONRPC_INTERNAL_ERROR = -32603

class JsonRpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export function handleInitialize(params: unknown): {
  protocolVersion: number
  agentCapabilities: { loadSession: boolean }
  agentInfo: { name: string; version: string }
} {
  const requested = params && typeof params === "object"
    ? (params as Record<string, unknown>).protocolVersion
    : undefined
  if (typeof requested !== "number") {
    throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "initialize requires a numeric protocolVersion")
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: "omniroute-acp-agent", version: "1" },
  }
}

export function handleNewSession(
  params: unknown,
  sessions: Map<string, SessionState>,
  deps: AgentDependencies = {},
): { sessionId: string } {
  const cwd = params && typeof params === "object" ? (params as Record<string, unknown>).cwd : undefined
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "session/new requires a non-empty cwd")
  }
  const sessionId = (deps.newSessionId ?? randomUUID)()
  sessions.set(sessionId, { cwd, messages: [], aborted: false })
  return { sessionId }
}

/** Extracts prompt text; throws on any non-text block rather than silently dropping content. */
export function extractPromptText(blocks: unknown): string {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "session/prompt requires a non-empty prompt array")
  }
  const parts: string[] = []
  for (const raw of blocks as PromptContentBlock[]) {
    if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") {
      throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "prompt block is missing a string type")
    }
    if (raw.type === "text") {
      const text = (raw as TextContentBlock).text
      if (typeof text !== "string") {
        throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "text content block is missing text")
      }
      parts.push(text)
      continue
    }
    throw new JsonRpcError(
      JSONRPC_INVALID_PARAMS,
      `unsupported prompt content block type "${raw.type}" -- this agent only supports text (v1)`,
    )
  }
  return parts.join("\n")
}

async function defaultChatCompletion(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${DEFAULT_PROXY_BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-temperance-surface": "paseo" },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages, stream: false }),
  })
  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } } >; error?: { message?: string } }
    | null
  if (!response.ok) {
    const message = payload?.error?.message || `temperance-openai-proxy returned HTTP ${response.status}`
    throw new Error(message)
  }
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new Error("temperance-openai-proxy response did not include assistant message content")
  }
  return content
}

export async function handlePrompt(
  params: unknown,
  sessions: Map<string, SessionState>,
  deps: AgentDependencies = {},
): Promise<{ stopReason: "end_turn" | "cancelled" }> {
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {}
  const sessionId = record.sessionId
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new JsonRpcError(JSONRPC_INVALID_PARAMS, "session/prompt requires a sessionId")
  }
  const session = sessions.get(sessionId)
  if (!session) {
    throw new JsonRpcError(JSONRPC_INVALID_PARAMS, `unknown sessionId: ${sessionId}`)
  }
  const text = extractPromptText(record.prompt)
  session.aborted = false
  session.messages.push({ role: "user", content: text })

  const runner = deps.chatCompletion ?? defaultChatCompletion
  let assistantText: string
  try {
    assistantText = await runner(session.messages)
  } catch (error) {
    // Roll back the pushed user turn so a retried prompt doesn't duplicate it.
    session.messages.pop()
    throw new JsonRpcError(
      JSONRPC_INTERNAL_ERROR,
      error instanceof Error ? error.message : String(error),
    )
  }

  if (session.aborted) {
    return { stopReason: "cancelled" }
  }

  session.messages.push({ role: "assistant", content: assistantText })
  const notify = deps.notify ?? (() => {})
  notify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: assistantText } },
    },
  })
  return { stopReason: "end_turn" }
}

export function handleCancel(params: unknown, sessions: Map<string, SessionState>): void {
  const sessionId = params && typeof params === "object" ? (params as Record<string, unknown>).sessionId : undefined
  if (typeof sessionId === "string") {
    const session = sessions.get(sessionId)
    if (session) session.aborted = true
  }
}

export async function dispatch(
  message: JsonRpcRequest,
  sessions: Map<string, SessionState>,
  deps: AgentDependencies = {},
): Promise<JsonRpcResponse | null> {
  const isNotification = message.id === undefined
  try {
    let result: unknown
    switch (message.method) {
      case "initialize":
        result = handleInitialize(message.params)
        break
      case "session/new":
        result = handleNewSession(message.params, sessions, deps)
        break
      case "session/prompt":
        result = await handlePrompt(message.params, sessions, deps)
        break
      case "session/cancel":
        handleCancel(message.params, sessions)
        if (isNotification) return null
        result = null
        break
      case "authenticate":
        result = null
        break
      default:
        throw new JsonRpcError(JSONRPC_METHOD_NOT_FOUND, `method not found: ${message.method}`)
    }
    if (isNotification) return null
    return { jsonrpc: "2.0", id: message.id ?? null, result }
  } catch (error) {
    if (isNotification) return null
    const jsonRpcError = error instanceof JsonRpcError
      ? error
      : new JsonRpcError(JSONRPC_INTERNAL_ERROR, error instanceof Error ? error.message : String(error))
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: jsonRpcError.code, message: jsonRpcError.message },
    }
  }
}

async function runStdioLoop(): Promise<void> {
  const sessions = new Map<string, SessionState>()
  const write = (payload: JsonRpcResponse | JsonRpcNotification): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  }
  const deps: AgentDependencies = { notify: write }

  let buffer = ""
  for await (const chunk of process.stdin) {
    buffer += chunk
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      let message: JsonRpcRequest
      try {
        message = JSON.parse(line) as JsonRpcRequest
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })
        continue
      }
      const response = await dispatch(message, sessions, deps)
      if (response) write(response)
    }
  }
}

if (import.meta.main) {
  runStdioLoop().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
