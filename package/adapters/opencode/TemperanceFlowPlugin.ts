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
import { capabilityTierForAgent, enrichOpenCodeMessage } from "./TemperanceFlowPluginCore"

const TemperanceFlowPlugin: Plugin = async ({ directory }) => {
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
        output.headers["X-Temperance-Profile"] = input.agent
        output.headers["X-Temperance-Capability-Tier"] = capabilityTierForAgent(input.agent)
      }
    },
  }
}

export default TemperanceFlowPlugin
