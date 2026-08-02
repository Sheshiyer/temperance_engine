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

export function capabilityTierForAgent(agent?: string): "S" | "A" | "B" {
  if (agent === "temperance-continuity") return "A"
  if (agent === "temperance-native" || agent === "temperance-worker" || agent === "code-fast") return "B"
  return "S"
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
