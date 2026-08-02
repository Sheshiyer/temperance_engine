import { describe, expect, test } from "bun:test"
import { capabilityTierForAgent, enrichOpenCodeMessage, promptFromParts, stripTemperanceContext } from "./TemperanceFlowPluginCore"

const part = (text: string) => ({ id: "p", sessionID: "s", messageID: "m", type: "text" as const, text })

describe("Temperance OpenCode flow bridge", () => {
  test("extracts prompt text and strips previously injected context", () => {
    const prompt = promptFromParts([
      part("refactor the auth module"),
      part("<temperance-context>\nportfolio=te-build\n</temperance-context>"),
    ])
    expect(stripTemperanceContext(prompt)).toBe("refactor the auth module")
  })

  test("appends the shared enrichment block as a synthetic part", async () => {
    const parts = await enrichOpenCodeMessage([part("refactor the auth module")], { sessionID: "s", messageID: "m" }, "/tmp/temperance-opencode-test")
    const context = parts.map((p: any) => p.text || "").find((text: string) => text.includes("<temperance-context>"))
    expect(context).toContain("<temperance-context>")
    expect(context).toContain("mode/tier:")
    expect((parts.at(-1) as any).synthetic).toBe(true)
  })

  test("maps governed OpenCode agents to explicit capability tiers", () => {
    expect(capabilityTierForAgent("temperance-algorithm")).toBe("S")
    expect(capabilityTierForAgent("temperance-continuity")).toBe("A")
    expect(capabilityTierForAgent("temperance-worker")).toBe("B")
  })
})
