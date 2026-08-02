#!/usr/bin/env bun
/**
 * Pure parsing/mapping logic for syncing PAI's native per-project memory
 * (~/.claude/projects/<slug>/memory/*.md -- frontmattered markdown, one file
 * per memory plus a MEMORY.md index) into OmniRoute's Memory feature.
 *
 * No network calls here by design: scripts/omniroute-memory-sync.sh owns the
 * OmniRoute admin-session auth (mirrors omniroute-temperance-reconcile.sh's
 * login pattern) and calls this module's CLI mode to get structured entries,
 * keeping the security-sensitive HTTP/Keychain path in one place (bash, the
 * pattern every other OmniRoute-mutating script in this repo already uses)
 * and the string-parsing logic in an independently-testable pure module.
 *
 * Verified against a real OmniRoute Memory entry (POST /api/memory,
 * 2026-08-02, via the live dashboard): request/response shape is
 * {type: "factual"|"episodic"|"procedural"|"semantic", key, content,
 * metadata}. Type mapping (PAI's four memory types -> OmniRoute's four) is a
 * judgment call documented in the design doc, not something OmniRoute itself
 * specifies -- feedback/procedural and reference/factual are close matches;
 * project/episodic and user/semantic are looser but the best fit among four
 * fixed options on each side.
 */

export type PaiMemoryType = "user" | "feedback" | "project" | "reference";
export type OmniRouteMemoryType = "factual" | "episodic" | "procedural" | "semantic";

const PAI_TO_OMNIROUTE_TYPE: Record<PaiMemoryType, OmniRouteMemoryType> = {
  feedback: "procedural",
  reference: "factual",
  project: "episodic",
  user: "semantic",
}

export function paiTypeToOmniRouteType(paiType: string): OmniRouteMemoryType {
  return PAI_TO_OMNIROUTE_TYPE[paiType as PaiMemoryType] ?? "factual"
}

export interface ParsedMemoryFile {
  name: string | null
  description: string | null
  type: string | null
  body: string
}

/**
 * Minimal frontmatter parser for the specific, fixed shape these files use:
 * `---\nkey: value\n...\n---\nbody`, with one nested `metadata:` block
 * (`  type: <value>` among its lines). Not a general YAML parser -- this
 * repo has no YAML dependency and doesn't need one for a shape this
 * constrained (see docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md
 * §1 for the verified real-file format this was written against).
 */
export function parseFrontmatter(source: string): ParsedMemoryFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source)
  if (!match) return { name: null, description: null, type: null, body: source }
  const [, frontmatter, body] = match
  const lines = frontmatter.split(/\r?\n/)
  let name: string | null = null
  let description: string | null = null
  let type: string | null = null
  let inMetadata = false
  for (const line of lines) {
    if (/^\S/.test(line)) inMetadata = false
    const topLevel = /^(\w+):\s*(.*)$/.exec(line)
    if (topLevel && !line.startsWith(" ")) {
      const [, key, rawValue] = topLevel
      const value = stripQuotes(rawValue.trim())
      if (key === "name") name = value || null
      else if (key === "description") description = value || null
      else if (key === "metadata") inMetadata = true
      continue
    }
    if (inMetadata) {
      const nested = /^\s+(\w+):\s*(.*)$/.exec(line)
      if (nested && nested[1] === "type") type = stripQuotes(nested[2].trim()) || null
    }
  }
  return { name, description, type, body: body.trim() }
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

export interface MemorySyncEntry {
  type: OmniRouteMemoryType
  key: string
  content: string
  metadata: { source: "pai-project-memory"; originFile: string; paiType: string | null }
}

const SAFE_KEY_SEGMENT = /[^a-zA-Z0-9._-]+/g

function sanitizeKeySegment(value: string): string {
  return value.replace(SAFE_KEY_SEGMENT, "-").replace(/^-+|-+$/g, "")
}

/** Builds the OmniRoute memory key, namespaced so it never collides with an
 * unrelated manually-added memory: `pai.<projectLabel>.<memory-name>`. */
export function memoryKey(projectLabel: string, memoryName: string): string {
  return `pai.${sanitizeKeySegment(projectLabel)}.${sanitizeKeySegment(memoryName)}`
}

export function fileToSyncEntry(
  projectLabel: string,
  fileBaseName: string,
  source: string,
): MemorySyncEntry | null {
  const parsed = parseFrontmatter(source)
  const name = parsed.name ?? fileBaseName.replace(/\.md$/, "")
  if (!parsed.body && !parsed.description) return null
  const content = [parsed.description, parsed.body].filter(Boolean).join("\n\n")
  return {
    type: paiTypeToOmniRouteType(parsed.type ?? ""),
    key: memoryKey(projectLabel, name),
    content,
    metadata: { source: "pai-project-memory", originFile: fileBaseName, paiType: parsed.type },
  }
}

export interface DirEntry {
  fileBaseName: string
  source: string
}

/** Pure: given already-read file contents (no fs access here -- the CLI mode
 * below owns reading the directory), returns every valid sync entry. Skips
 * MEMORY.md (the index, not a memory) and any file that fails to parse into
 * usable content. */
export function buildSyncEntries(projectLabel: string, files: readonly DirEntry[]): MemorySyncEntry[] {
  const entries: MemorySyncEntry[] = []
  for (const file of files) {
    if (file.fileBaseName.toLowerCase() === "memory.md") continue
    const entry = fileToSyncEntry(projectLabel, file.fileBaseName, file.source)
    if (entry) entries.push(entry)
  }
  return entries
}

if (import.meta.main) {
  const [command, ...args] = Bun.argv.slice(2)
  if (command === "list-entries" && args[0]) {
    const { readdirSync, readFileSync } = await import("node:fs")
    const { join, basename } = await import("node:path")
    const dir = args[0]
    const projectLabel = args[1] ?? basename(join(dir, ".."))
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((fileBaseName) => ({
        fileBaseName,
        source: readFileSync(join(dir, fileBaseName), "utf8"),
      }))
    process.stdout.write(`${JSON.stringify(buildSyncEntries(projectLabel, files))}\n`)
  } else {
    console.error("usage: pai-memory-frontmatter.ts list-entries DIR [PROJECT_LABEL]")
    process.exit(2)
  }
}
