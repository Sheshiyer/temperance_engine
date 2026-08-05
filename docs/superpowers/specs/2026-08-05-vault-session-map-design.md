# Vault Project Relocation — Session-Map (Piece C) — Design

**Issue:** Moving Git repositories out of the twc-vault Obsidian vault into a
portfolio-organized code root de-links every CLI coding tool's notion of
"sessions for this project," because every tool found so far keys its session
storage off the absolute working-directory path. The relocation subsystem
built in `package/relocation/*` moves the repository safely; nothing yet
accounts for what happens to Claude Code / Codex / OpenCode / Kimi / Copilot /
Craft Agent session history when that path changes.

**Status:** design (approved via `/superpowers:brainstorming` dialogue on
2026-08-05; not yet planned or implemented).

---

## 1. Problem

The owner's real goal is efficient, low-friction project management across
Claude, Codex, OpenCode, Kimi, and Paseo, eventually orchestrated through
OmniRoute (piece **D**). The stated blocker for D is that project/folder
management has no system today — repositories live nested inside the
Obsidian vault's own Git repository (`thoughtseed-labs`), causing git-in-git
conflicts and vault bloat, and there is no reliable way to know, after a
repository moves, where its prior CLI-tool session history went.

This work decomposes into four separable pieces, confirmed with the owner
2026-08-05:

- **(A) Physical sibling-repo relocation.** Already built and tested this
  session (`package/relocation/*`): grammar, packet, registry, capsule,
  guarded-rename transaction, pickup, rollback, end-to-end apply. Needs only
  its destination root repointed at `/Volumes/madara/2026/Projects/`.
- **(B) Nested-repo handling.** Not built. `thoughtseed-labs/CLAUDE.md`
  documents `hermes-aws-ts` as living *inside* `thoughtseed-labs`'s own
  working tree (`thoughtseed-labs/hermes-aws-ts/`), which itself has a
  worktree (`hermes-aws-ts/.codex-worktrees/runner-access-auth/`) with a
  third nested `.git`. Verified on disk 2026-08-05. This is a distinct case
  from A's sibling-repo model and needs its own design — out of scope here.
- **(C) The session-map — this document's scope.** For each moved project,
  durably record where its CLI-tool session history lived before the move
  and whether it can still be found after.
- **(D) The larger OmniRoute/cross-tool orchestration goal.** Deferred by
  the owner. C is explicitly meant to be the foundation D will eventually
  consume programmatically, not just human-readable prose — see §6.

## 2. Owner decisions (locked, from the brainstorm dialogue)

| # | Decision | Rationale given |
|---|----------|------------------|
| **D1** | Portfolio-first taxonomy approved: `Projects/<portfolio>/<repository>`, lifecycle/type as metadata, not folder structure. Only `thoughtseed/` and `tryambakam-noesis/` portfolio roots for now; everything else in the vault handled separately later. | Owner's explicit approval; matches the `Portfolio` type (`"thoughtseed" \| "tryambakam-noesis"`) already built into `project-registry.ts` — no rework needed there. |
| **D2** | Success bar for "don't lose sessions" is **findable, not automatic — but staged**: build a durable structured record now; treat full per-tool auto-resume as a later, explicit D-era enhancement. | Owner's explicit choice over "tools must auto-resume immediately" and "record-only forever." Matches "we can always reimport it... sessions can be linked" — a later, deliberate step, not automatic continuity today. |
| **D3** | The session-map is local-only, outside the vault (`~/.temperance_engine/session-maps/...`), never git-tracked or synced to the vault or the other founder's machine. | Owner's explicit choice over vault-committed (gitignored or per-founder-keyed) options. The map is inherently machine-specific — one founder's `~/.claude` paths mean nothing on the other's machine — while the *portable* facts (old/new path, GH repo) already live in the existing, vault-shared capsule/registry. |
| **D4** | v1 tool scope is exactly what the owner named: Claude Code, Codex, OpenCode, the Kimi family, Craft Agent, and GitHub's hosted agent/Copilot state — verified per-tool rather than guessed, not the full 15+ candidate directories found in `~/`. | Owner's explicit choice; built as a pluggable matcher list so more tools can be added later without a redesign. |
| **D5** | Session-map generation is a separate, independently re-runnable CLI step, not folded into the one-shot `apply` transaction. | Owner's explicit choice. New sessions keep accumulating at the new path in each tool long after the move — this isn't a one-time fact like "HEAD moved," so it needs the same repeatable re-confirmation model already used for the registry baseline and canary checks this session. |
| **D6** | Discovery mechanism is per-tool, decided from real inspection of each tool's actual storage (Approach 2), not a single blind hash-match strategy applied uniformly (Approach 1) or a fully manual checklist (Approach 3). | Owner's explicit choice: "Approach 2, go per-tool." |
| **D7** | Claude Code's de-link gets an active fix now (a reversible symlink), **default-on**, because it's cheap and safe. The other five tools stay record-only in v1, deferred to D, because fixing them means writing into another live application's private database/state file — a materially higher risk than anything read-only. | Owner's explicit choice over "record-only across all six tools" and over an opt-in `--relink` flag. |

## 3. Goal

For every project moved by piece A, produce a durable, structured,
per-project record of exactly which of six named CLI tools had session state
keyed to the old path, whether that state is still discoverable after the
move, and — for Claude Code specifically — leave the tool able to continue
that history at the new path without any manual hunting.

## 4. Non-goals (YAGNI / explicit deferrals)

- **Not** fixing the de-link for OpenCode, Copilot, Codex, or Kimi in v1.
  Their storage is a live SQLite database or a live JSON state file owned by
  another running application; an automated write into any of them is a
  materially different risk than anything built in this codebase so far
  (schema drift, file locking, corruption). Deferred to D, to be done
  deliberately, tool-by-tool, when that specific tool is actually being
  reopened for that project — not proactively across every historical
  project at once.
- **Not** resolving individual session files for Codex or Kimi. Both only
  expose a workspace-root-level index (`active-workspace-roots` /
  `electron-saved-workspace-roots` / `project-order` for Codex, `work_dirs`
  for Kimi) — v1 confirms *presence*, it does not walk into
  `~/.codex/sessions/YYYY/MM/DD/` or `~/.kimi/sessions/<opaque-id>/` to
  attribute individual files to a project.
- **Not** attempting a mechanism for Craft Agent. Its only per-project-shaped
  artifact found (`~/.craft-agent/workspaces/`) contains one generic entry
  (`my-workspace`), not evidence of a per-project convention. Recorded
  honestly as `unsupported` rather than guessing.
- **Not** reading any session/transcript *content*. Every matcher touches
  only existence, file stat, or specific known structural keys/columns —
  never prompt or response bodies. This is a hard invariant (§10), not a
  preference.
- **Not** piece B (nested-repo relocation) or piece D (OmniRoute
  orchestration) — see §1.

## 5. Real per-tool findings (verified 2026-08-05, structure only)

| Tool | Actual storage shape | Discovery mechanism | Confidence tier |
|---|---|---|---|
| **Claude Code** (`~/.claude/projects/`) | Folder-per-project, named by encoding the absolute cwd path (confirmed: `/Users/sheshnarayaniyer` → `-Users-sheshnarayaniyer`; exact character-escaping rules for `.` and other special characters still need one empirical check before implementation — do not assume from pattern-matching alone). | Deterministic path→foldername transform. | `path-derived` |
| **OpenCode** (`~/.local/share/opencode/opencode.db`) | SQLite. `project`, `session`, `workspace` tables; `session.directory`, `session.path`, `workspace.directory` columns, indexed (`session_project_idx`, `session_workspace_idx`). | Bounded read-only `SELECT` for exact path match. | `db-query-match` (highest) |
| **GitHub Copilot CLI** (`~/.copilot/data.db`) | SQLite. `projects.main_repo_path` (`UNIQUE`, indexed), `worktrees.path`, `workspaces.source_path`. | Bounded read-only `SELECT` for exact path match. | `db-query-match` (highest) |
| **Codex** (`~/.codex/`) | Sessions organized by **date** (`sessions/YYYY/MM/DD/`), not by path. `.codex-global-state.json` carries `active-workspace-roots`, `electron-saved-workspace-roots`, `project-order`. Separate cross-tool import indexes exist: `external_agent_session_imports.json` (`records`), `claude-cowork-import-history.json` (`accountSetupItems`, `connectorCandidates`, `projects`, `records`, `version`) — Codex already imports *from* Claude sessions. | Exact-string match against known JSON keys. | `workspace-root-index-match` — confirms presence only (see §4) |
| **Kimi** (`~/.kimi/`) | `sessions/` and `user-history/` are opaque-ID-keyed (e.g. `007caf892d1ae989d133249b7afd3073`), not path-derived. `kimi.json` has exactly one top-level key, `work_dirs`, an array of 241 known absolute paths. | Exact-string match against `work_dirs`. | `workspace-root-index-match` — same caveat as Codex |
| **Craft Agent** (`~/.craft-agent/`) | `workspaces/` contains a single generic entry (`my-workspace`) — no evidence of a per-project naming convention. | None found. | `unsupported` in v1 (§4) |

Two scope corrections from the tools originally guessed under "the Kimi
family": `.kimi-code`, `.kimi-webbridge`, `.kimi-work` are install-binary
directories only (`bin/`), not session stores — dropped. `.kimi_openclaw/workspace`
is a fixed global agent-persona scaffold (`AGENTS.md`, `IDENTITY.md`,
`BOOTSTRAP.md`, ...), not per-project session history — a different kind of
thing (agent identity, not session log), out of scope for the session-map,
possibly relevant to D later.

## 6. Data model

One JSON file per moved project:
`~/.temperance_engine/session-maps/<portfolio>/<repository>/map.json`, mode
`0600` (matches the existing receipt convention in
`~/.temperance_engine/receipts/`).

```json
{
  "stableId": "...",
  "portfolio": "thoughtseed",
  "repository": "...",
  "oldPath": "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/<repo>",
  "newPath": "/Volumes/madara/2026/Projects/thoughtseed/<repo>",
  "generatedAt": "...",
  "tools": [
    {
      "tool": "claude-code",
      "mechanism": "path-derived",
      "matched": true,
      "locator": "~/.claude/projects/-Volumes-...",
      "relinkAction": "created"
    },
    {
      "tool": "opencode",
      "mechanism": "db-query-match",
      "matched": true,
      "locator": "opencode.db: project.id=..."
    },
    {
      "tool": "copilot",
      "mechanism": "db-query-match",
      "matched": false
    },
    {
      "tool": "codex",
      "mechanism": "workspace-root-index-match",
      "matched": false
    },
    {
      "tool": "kimi",
      "mechanism": "workspace-root-index-match",
      "matched": true,
      "locator": "kimi.json: work_dirs[...]"
    },
    {
      "tool": "craft-agent",
      "mechanism": "unsupported",
      "matched": null
    }
  ]
}
```

Every tool entry is honest about *how* it was matched and at what
confidence — nothing is asserted that wasn't actually checked, same
discipline as `holdReasons` in the existing relocation code. Each matcher
runs against **both** `oldPath` and `newPath`; re-running later should show
tools moving from "no match at new path" to "matched" as the owner actually
starts using them there — the concrete signal for "has this project's
tooling really moved over."

`matched` is a three-state field, not a boolean:

- `true` — the matcher ran successfully and found the path.
- `false` (no `error` field) — the matcher ran successfully and did **not**
  find the path. A clean negative, not a failure.
- `false` with an `error` field — the matcher could not complete its check
  at all (malformed storage, missing file, locked database). Distinct from
  a clean negative; see §10.
- `null` — the tool is `unsupported` (Craft Agent only, §4); no check was
  attempted.

`claude-code`'s entry additionally carries `relinkAction`:
`"created" | "skipped-destination-exists" | "skipped-source-missing"` (§7).

## 7. Architecture

New module `package/relocation/project-session-map.ts`, alongside
`project-registry.ts` / `project-capsule.ts`:

- A `SessionStoreMatcher` interface — one implementation per tool
  (`ClaudeCodeMatcher`, `OpenCodeMatcher`, `CopilotMatcher`, `CodexMatcher`,
  `KimiMatcher`, `CraftAgentMatcher`). Each is independently fixture-tested:
  a temp SQLite file with the real schema for OpenCode/Copilot, a temp JSON
  file for Codex/Kimi, a temp folder tree for Claude Code. None touch the
  real `~/.claude`, `~/.codex`, etc. during tests — the same fixture-only
  discipline as every mutating function built this session.
- `buildSessionMap(oldPath, newPath, stableId, portfolio, repository)` runs
  every matcher and assembles the record from §6.
- `writeSessionMap()` — the only real filesystem write for the record
  itself, to `~/.temperance_engine/session-maps/<portfolio>/<repository>/map.json`,
  mode `0600`.
- **Old-path source of truth:** read from the already-built
  `RegistryEntryRecord.oldPath` (`project-registry.ts`), loaded via the same
  `registryEntryPath(portfolio, repository)` lookup already used to resolve
  `stableId` (§9) — not a separately-located rollback receipt, whose path is
  caller-chosen at apply time and isn't derivable from `--repository` alone.
  Not duplicated or re-derived.
- **Hardcoded tool-store paths, not `homedir()`-derived.** The source
  guards (`project-relocation-source-guards.test.ts`) hard-ban any
  `homedir()` call or bare `process.env.HOME` read across every production
  relocation file — the property that keeps this whole subsystem from ever
  doing an open-ended home-directory crawl. This module joins that guarded
  list, so its six tool-store paths must be hardcoded absolute literals
  (`/Users/sheshnarayaniyer/.claude/projects`, etc.), the same way
  `REGISTRY_HOST_ROOTS` and `PORTFOLIO_ROOTS` already are in
  `scripts/vault-project-relocation.ts` — not a new pattern.

## 8. The Claude Code active relink

The only write this module performs outside the vault repo / portfolio
registry / `~/.temperance_engine/` receipts boundary that every other piece
of this subsystem stays within. Gated hard:

- **Never clobber.** Create the symlink only if the *old* session folder
  exists **and** the *new* path's folder does **not** exist yet. If Claude
  Code was already opened at the new path before this ran, real session
  data would already be there — relinking must fail closed and record
  `relink_skipped_destination_exists`, never overwrite it.
- **Purely additive and reversible.** One `symlinkSync` call. Undoing it is
  deleting the symlink — no data transformation, nothing to corrupt.
- **One call site, mechanically enforced.** `attemptClaudeCodeRelink(oldSessionDir, newSessionDir)`
  is its own small, fixture-tested function (temp dirs only). A source-guard
  assertion confirms `symlinkSync` appears in the codebase exactly once,
  scoped to this function, so it cannot quietly spread to the other five
  tools later.
- **Default-on, with an escape hatch.** Runs automatically as part of
  `session-map` (owner decision D7) — no `--relink` flag required. A
  `--no-relink` flag exists to skip it for one run if ever needed.
- **Recorded, not silent.** Every outcome — `created`,
  `skipped-destination-exists`, `skipped-source-missing` — lands in the
  session-map record (§6), never just a side effect nobody sees.

## 9. CLI surface

```
bun scripts/vault-project-relocation.ts session-map \
  --repository <absolute-new-path> \
  [--no-relink]
```

`portfolio`, `repository` (name), and `stableId` are not passed as separate
flags. Portfolio is inferred from `--repository`'s path the same way `plan`
and `apply` already do it — `inferPortfolio()` prefix-matching against
`PORTFOLIO_ROOTS` — and repository name is the path's basename. `stableId`
then comes from reading the registry entry at
`registryEntryPath(portfolio, repository)` (`project-registry.ts`). If no
registry entry exists for that portfolio/repository, `session-map` fails
closed rather than guessing a stable ID.

Independently re-runnable (owner decision D5) — intended to be run once
right after `apply`, and again later as new sessions accumulate under the
new path across tools.

## 10. Error handling

- **Every matcher fails closed independently.** A malformed `opencode.db`,
  a missing `kimi.json`, a locked SQLite file — that tool's entry becomes
  `{ "matched": false, "error": "<reason>" }`; it never aborts the run for
  the other five. One tool changing its storage format someday should not
  blind the record to the other five.
- **Content boundary is a hard invariant, not a convention.** No matcher
  ever reads session/transcript content — only existence, stat, or specific
  known structural keys/columns. This gets its own guard test, same family
  as the existing "no transcript reference" source guard, extended to
  assert the new module never opens a `.jsonl`/session file for its body
  (only the specific whitelisted index files: `kimi.json`,
  `.codex-global-state.json`, `external_agent_session_imports.json`,
  `claude-cowork-import-history.json`, and the two SQLite files via
  bounded, column-scoped queries).
- **The relink is the sole exception to read-only**, bounded exactly as §8
  describes.

## 11. Testing

Same shape as everything else built this session:

- Every matcher: fixture-only tests (temp SQLite files with the real
  schema, temp JSON files, temp folder trees) covering matched, unmatched,
  and malformed-storage cases.
- `attemptClaudeCodeRelink`: fixture-only tests for all three outcomes
  (created / skipped-destination-exists / skipped-source-missing).
- Source guards: `project-session-map.ts` joins `PRODUCTION_RELOCATION_FILES`;
  new assertions for (a) no `homedir()`/`process.env.HOME`, (b) no session
  file content read outside the whitelisted index files, (c) `symlinkSync`
  appears exactly once, scoped to the relink function.
- `scripts/vault-project-relocation.ts`'s new `session-map` subcommand:
  argument-validation-only tests (never touches the real tool directories),
  matching the existing pattern for `apply`/`rollback` CLI tests.

## 12. Open verifications before implementation

1. ~~Claude Code's exact path→foldername character-escaping rules.~~
   **Resolved during Task 1 implementation (2026-08-05).** `.` is preserved
   literally; every other non-alphanumeric character (including `/` and,
   contrary to an earlier draft's wrong claim, `_`) becomes `-`. The
   implementer caught the `_` error by cross-checking against the plan's own
   test fixture; the controller independently confirmed it with a byte-level
   check of the real `~/.claude/projects/` folder name for
   `temperance_engine`. Transform: `path.replace(/[^A-Za-z0-9.]/g, "-")`.
2. Whether Claude Code's own session lookup actually follows a symlinked
   project folder transparently — believed true (plain filesystem lookup,
   no reason to expect otherwise) but not directly verified against Claude
   Code's own source; worth a real dry-run test before trusting it in
   production.
3. Craft Agent stays `unsupported` until a real per-project convention is
   found, if one exists at all — not blocking, since D4 already scoped v1
   to record `unsupported` honestly rather than guess.

## 13. Relationship to the already-built system

- Reuses the `Portfolio` type, `registryRootFor()`, and
  `registryEntryPath()` from `project-registry.ts` unchanged (D1), and reads
  `RegistryEntryRecord.oldPath` as the source of truth for the old path (§7)
  instead of inventing a new place to store that fact.
- Does **not** touch the six-file capsule or the project packet — both
  stay deliberately session-free per the existing anti-pattern rule
  (ISC-678: a project packet must never contain a native session
  identifier or transcript locator). The session-map is a new, separate,
  explicitly non-portable artifact for exactly that reason (D3) — the
  capsule is meant to be portable/shared; the session-map is meant to be
  neither.
- Joins the existing `verify-all.sh` gate and `PRODUCTION_RELOCATION_FILES`
  source-guard list, same as every other module built this session.
