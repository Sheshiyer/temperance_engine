/**
 * OpenCode bridge for the shared Temperance enrichment flow.
 *
 * `chat.message` is the earliest OpenCode hook with the complete user prompt.
 * We append the normal synthetic `<temperance-context>` part so PAI/ISA/GSD
 * context reaches the agent. Actual model selection remains at the local
 * OpenAI proxy because OpenCode's plugin contract does not permit changing
 * `input.model` in a chat hook.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { enrich } from "../../enrich/index"

type TextPartLike = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  [key: string]: unknown
}

function partText(part: any): string {
  return part && part.type === "text" && typeof part.text === "string" ? part.text : ""
}

export function promptFromParts(parts: any[]): string {
  if (!Array.isArray(parts)) return ""
  return parts.map(partText).filter(Boolean).join("\n").trim()
}

export function stripTemperanceContext(prompt: string): string {
  return prompt.replace(/<temperance-context>[\s\S]*?<\/temperance-context>/gi, "").trim()
}

export async function enrichOpenCodeMessage(
  parts: any[],
  input: { sessionID: string; messageID?: string },
  cwd: string,
): Promise<any[]> {
  if (!Array.isArray(parts)) return parts || []
  const prompt = stripTemperanceContext(promptFromParts(parts))
  if (!prompt) return parts
  const context = await enrich({ prompt, cwd, surface: "opencode" })
  if (!context || parts.some((part) => partText(part).includes("<temperance-context>"))) return parts
  return [...parts, {
    id: `te-context-${input.sessionID}-${Date.now()}`,
    sessionID: input.sessionID,
    messageID: input.messageID || `te-message-${Date.now()}`,
    type: "text",
    text: context,
    synthetic: true,
  } as TextPartLike]
}

export const TemperanceFlowPlugin: Plugin = async ({ directory }) => {
  const cwd = directory || process.cwd()
  return {
    "chat.message": async (input, output) => {
      if (output && Array.isArray(output.parts)) {
        output.parts = await enrichOpenCodeMessage(output.parts, input, cwd)
      }
    },
    "chat.headers": async (input, output) => {
      if (output && output.headers) {
        output.headers["X-Temperance-Surface"] = "opencode"
        output.headers["X-Temperance-Session-ID"] = input.sessionID
      }
    },
  }
}

export default TemperanceFlowPlugin
