import { describe, expect, test } from "bun:test"
import {
  buildSyncEntries,
  fileToSyncEntry,
  memoryKey,
  paiTypeToOmniRouteType,
  parseFrontmatter,
} from "./pai-memory-frontmatter"

// Byte-for-byte the real file this was written against:
// ~/.claude/projects/-Volumes-.../memory/kimi-surface-live.md, read 2026-08-02.
const REAL_MEMORY_FIXTURE = `---
name: kimi-surface-live
description: "Kimi CLI + desktop app wired live as governed Temperance surfaces (2026-07-23) — relay-side enrichment, semantic TOML lifecycle, rollback paths"
metadata:
  node_type: memory
  type: project
  originSessionId: 17cf56ef-48ac-48ba-ac13-38d4ddf7fe8e
  modified: 2026-07-23T16:49:15.683Z
---

Kimi is live as a Temperance client surface (both kimi-cli 1.49.0 and the desktop app's daimon runtime).

Non-obvious facts:
- **kimi-cli cannot inject hook context** (UserPromptSubmit is block/allow only).
`

describe("paiTypeToOmniRouteType", () => {
  test("maps all four PAI types to their OmniRoute counterpart", () => {
    expect(paiTypeToOmniRouteType("feedback")).toBe("procedural")
    expect(paiTypeToOmniRouteType("reference")).toBe("factual")
    expect(paiTypeToOmniRouteType("project")).toBe("episodic")
    expect(paiTypeToOmniRouteType("user")).toBe("semantic")
  })

  test("defaults an unknown or missing type to factual rather than throwing", () => {
    expect(paiTypeToOmniRouteType("")).toBe("factual")
    expect(paiTypeToOmniRouteType("something-new")).toBe("factual")
  })
})

describe("parseFrontmatter", () => {
  test("parses the real memory file format exactly", () => {
    const result = parseFrontmatter(REAL_MEMORY_FIXTURE)
    expect(result.name).toBe("kimi-surface-live")
    expect(result.description).toBe(
      "Kimi CLI + desktop app wired live as governed Temperance surfaces (2026-07-23) — relay-side enrichment, semantic TOML lifecycle, rollback paths",
    )
    expect(result.type).toBe("project")
    expect(result.body).toContain("Kimi is live as a Temperance client surface")
    expect(result.body).not.toContain("---")
  })

  test("returns the whole source as body when there is no frontmatter block", () => {
    const result = parseFrontmatter("just plain text, no frontmatter")
    expect(result.name).toBeNull()
    expect(result.type).toBeNull()
    expect(result.body).toBe("just plain text, no frontmatter")
  })

  test("does not confuse an indented body line for a metadata key", () => {
    const source = `---
name: x
metadata:
  type: reference
---
  this indented body line must not be read as frontmatter
type: not-a-real-field
`
    const result = parseFrontmatter(source)
    expect(result.type).toBe("reference")
    expect(result.body).toContain("this indented body line must not be read as frontmatter")
  })
})

describe("memoryKey", () => {
  test("namespaces under pai.<project>.<name>", () => {
    expect(memoryKey("temperance_engine", "kimi-surface-live")).toBe("pai.temperance_engine.kimi-surface-live")
  })

  test("sanitizes unsafe characters instead of producing an invalid key", () => {
    expect(memoryKey("my project!", "note (draft)")).toBe("pai.my-project.note-draft")
  })
})

describe("fileToSyncEntry", () => {
  test("builds a complete entry from the real fixture", () => {
    const entry = fileToSyncEntry("temperance_engine", "kimi-surface-live.md", REAL_MEMORY_FIXTURE)
    expect(entry).not.toBeNull()
    expect(entry?.type).toBe("episodic")
    expect(entry?.key).toBe("pai.temperance_engine.kimi-surface-live")
    expect(entry?.content).toContain("Kimi CLI + desktop app wired live")
    expect(entry?.content).toContain("Kimi is live as a Temperance client surface")
    expect(entry?.metadata).toEqual({
      source: "pai-project-memory",
      originFile: "kimi-surface-live.md",
      paiType: "project",
    })
  })

  test("falls back to the filename as the memory name when frontmatter has none", () => {
    const entry = fileToSyncEntry("proj", "untitled.md", "---\ndescription: has no name field\n---\nbody text")
    expect(entry?.key).toBe("pai.proj.untitled")
  })

  test("returns null for a file with neither description nor body content", () => {
    expect(fileToSyncEntry("proj", "empty.md", "---\nname: empty\n---\n")).toBeNull()
  })
})

describe("buildSyncEntries", () => {
  test("skips MEMORY.md (the index) and processes real memory files", () => {
    const entries = buildSyncEntries("temperance_engine", [
      { fileBaseName: "MEMORY.md", source: "# Memory Index\n\n- [x](x.md)" },
      { fileBaseName: "kimi-surface-live.md", source: REAL_MEMORY_FIXTURE },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe("pai.temperance_engine.kimi-surface-live")
  })

  test("skips files that produce no usable content instead of throwing", () => {
    const entries = buildSyncEntries("proj", [
      { fileBaseName: "empty.md", source: "---\nname: empty\n---\n" },
      { fileBaseName: "real.md", source: REAL_MEMORY_FIXTURE },
    ])
    expect(entries).toHaveLength(1)
  })
})
