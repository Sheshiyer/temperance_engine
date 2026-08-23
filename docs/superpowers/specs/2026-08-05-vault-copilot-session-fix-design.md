> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Vault Project Relocation — Copilot Session Fix (Piece D, first slice) — Design

**Issue:** Piece C (session-map) built a durable, structured, per-project record
of which of six CLI tools had session state keyed to a repository's old
path, and fixed the de-link for Claude Code only (a reversible symlink).
The other five tools — OpenCode, GitHub Copilot CLI, Codex, Kimi, Craft
Agent — were deliberately left record-only, deferred to piece D: "to be
done deliberately, tool-by-tool, when that specific tool is actually
being reopened for that project — not proactively across every historical
project at once" (piece C design doc, §4).

This document scopes the first slice of piece D: an on-demand fix for
GitHub Copilot CLI's session/workspace database, and explicitly nothing
else — not OpenCode, not the larger OmniRoute cross-tool orchestration
goal.

**Status:** design (approved via `/superpowers:brainstorming` dialogue on
2026-08-05; not yet planned or implemented).

---

## 1. Problem

"Piece D" exists in the codebase today as exactly one named-but-unscoped
sentence: "The larger OmniRoute/cross-tool orchestration goal... C is
explicitly meant to be the foundation D will eventually consume
programmatically" (piece C design doc, §1). There is no plan, no ISA
criteria, no roadmap entry, and no code. Before any design work could
proceed, piece D itself needed to be decomposed and scoped — it was not
already a single well-defined unit of work.

### 1.1 What piece D is not, for this document

Real reconnaissance (2026-08-05, see §1.3) into the existing OmniRoute
system found it is a mature, already-promoted (enforce-mode) local
model-request gateway with a hard, already-load-bearing boundary:
`ISA.md:178` — "OmniRoute owns model routing only; it owns no project,
task, handoff, or session state." Nothing in this document touches
OmniRoute's code (`package/router/*`), its routing classifier/scorer
pipeline, or that boundary. This document is scoped entirely inside the
existing relocation/session-map subsystem (`package/relocation/*`,
`scripts/vault-project-relocation.ts`), extending piece C's own stated
next step rather than starting the OmniRoute-facing work piece D was
originally named for. A future document can pick up the OmniRoute-facing
half of piece D separately, once more of the tool-fix groundwork exists
to actually feed it.

### 1.2 What this document does cover

An on-demand CLI step: given a specific already-moved project and the
tool name `copilot`, read GitHub Copilot CLI's real local database,
determine whether that project's entries still point at the pre-move
path, and — only on separate, explicit invocation — rewrite them to the
post-move path across every table that holds it, consistently, or hold
and report cleanly if that's not safely possible.

### 1.3 Real reconnaissance (2026-08-05) — why this is scoped to Copilot only, not Copilot + OpenCode

Direct, read-only inspection of the real databases on this machine (never
mutated) found the two tools have meaningfully different risk profiles —
different from what piece C's existing matcher code alone would suggest:

**OpenCode** (`~/.local/share/opencode/opencode.db`, 5.94 GB, `journal_mode=wal`):
- The piece C matcher (`opencode-matcher.ts`) reads `session.directory`
  only. The actual "true" identity column is `project.worktree`
  (`TEXT NOT NULL`, **no `UNIQUE` constraint**) — a different column
  entirely, unindexed for path lookup.
- Four structures hold path data for the same conceptual project:
  `project.worktree`, `project_directory.directory` (composite PK
  `(project_id, directory)`, a many-directories-per-project junction
  table), `session.directory`, and `session.path` (a *relative* fragment,
  inconsistently populated — sometimes empty even when `directory` is
  set).
- A real, already-existing collision case was found on this machine (an
  out-of-band move, not run through this tool): `project.worktree` for
  one project is permanently stale (still the old path), while
  `project_directory.directory` and the newest `session.directory` rows
  for that *same* `project_id` were already silently rewritten to the
  new path by OpenCode itself. A fix touching only `session.directory`
  (piece C's current read) would leave the column-of-record
  (`project.worktree`) wrong forever.
- **The OpenCode desktop Electron app is running right now**, with an
  active `-wal`/`-shm` pair being written to continuously. A fix that
  opens `UPDATE` transactions against this file while the app holds it
  open is a live risk, not a theoretical one, and 5.94 GB makes broad
  scans expensive.
- Conclusion: OpenCode needs its own, separately-scoped design once the
  four-structure consistency question and the live-app-write question
  are worked through deliberately. Attempting it in the same slice as
  Copilot would combine two different problems (no-unique-key +
  live-process risk) into one plan.

**Copilot CLI** (`~/.copilot/data.db`, 2.7 MB, `journal_mode=wal`, app not
currently running):
- Four structures hold path data, all discovered by direct schema
  inspection: `projects.main_repo_path` (`TEXT NOT NULL UNIQUE`, indexed
  — **the one genuinely unique, safe upsert key** across both tools
  inspected), `worktrees.path` (no constraint, FK `project_id` CASCADE),
  `workspaces.source_path` (nullable, **NULL in all 17 real rows on this
  machine** — present in the schema but never populated in practice),
  and `workspace_checkout_bindings` (`repo_path`/`checkout_path`,
  composite PK `(workspace_id, repo_path)` — a fourth table piece C never
  touched at all).
- Real duplication/staleness measured directly: `projects` has 9 rows,
  all 9 `main_repo_path` values genuinely distinct (constraint verified,
  not assumed); 4 of those 9 (44%) already point at paths that no longer
  exist on disk, all `$HOME`-rooted paths from before an out-of-band move
  to the vault (`Selemene-engine`, `witness-agents`, `Sheshiyer`,
  `klear-karma-website-v2`) — none of the four has a matching new-path
  row yet. `worktrees` has 17 rows, 13 of 17 (76%) stale. A second,
  independent SQLite file, `~/.copilot/session-store.db`, exists
  alongside `data.db` with its own WAL — it keys on git-commit refs and
  file paths, not absolute repo paths the same way, and is explicitly
  out of scope for this document (a conscious exclusion, not an
  oversight — see §4).
- **The real collision shape this design must handle**, confirmed by the
  four already-stale `projects` rows above: because `main_repo_path` is
  `UNIQUE`, the day the user reopens one of those moved repos in the
  Copilot CLI app, it will create a **brand-new project row with a new
  UUID** at the new path — independent of the old, still-stale row. A
  fix that assumes "the new path has no existing row" will eventually be
  wrong; it needs to detect that case and refuse cleanly rather than
  attempt an automatic merge (§7.3).
- Conclusion: Copilot is the safer, better-understood first slice — one
  genuinely unique key, the app isn't currently holding the database
  open, and the real collision shape is now known and directly
  observable rather than hypothetical.

## 2. Owner decisions (locked, from the brainstorm dialogue)

| # | Decision | Rationale given |
|---|----------|------------------|
| **D-D1** | Piece D's actual shape, for this slice, is "extend piece C's tool fixes" — not a new coordination layer above OmniRoute, and not making OmniRoute itself session-aware. | Owner's explicit choice over the other two framings offered; matches piece C's own stated deferral language exactly, and avoids reopening an already-promoted (enforce-mode) OmniRoute boundary without a much more deliberate, separate decision. |
| **D-D2** | Fix timing is on-demand, per project + tool — a CLI step run deliberately when a specific already-moved project is about to be reopened in a specific tool. Not a proactive batch re-link of every already-moved project across all tools. | Owner's explicit confirmation of piece C's own original reasoning (§4 of that design): avoids writing into a live application's database for projects that may never be reopened in that tool. |
| **D-D3** | First slice covers Copilot CLI only, all four of its real path-bearing tables (`projects`, `worktrees`, `workspaces`, `workspace_checkout_bindings`). OpenCode is explicitly deferred to its own later, separately-scoped document. | Owner's explicit choice, made after real reconnaissance showed OpenCode has no unique key, four inconsistently-updated path columns (one already found stale on this machine), and a currently-running app holding an active WAL connection — a meaningfully different and larger problem than Copilot's. |
| **D-D4** | On a real collision (a project row already independently exists at the new path), the fix holds and reports — it does not attempt an automatic merge/re-parent of the old row's dependents onto the new row's `project_id`. | Directly continues the owner's own piece-B collision philosophy (E4: "flag the conflicts and we'll resolve them one by one" — no automatic preference). Re-parenting FK relationships across four tables safely is real, substantially riskier work that deserves its own deliberate scoping, not a guess folded into this slice. |

## 3. Goal

Given a specific project that piece A already relocated (or any project
with a known old/new path pair) and the tool name `copilot`: read the
real Copilot CLI database read-only, produce an exact, inspectable plan
of what would change (or a clear reason nothing can safely change), and —
only on a separate, explicit invocation — apply that plan as one
transaction across all four real path-bearing tables, leaving a durable
receipt of exactly what was written.

## 4. Non-goals (YAGNI / explicit deferrals)

- **Not** OpenCode. Its lack of a unique key, its four-structure
  consistency problem (one already found stale on this machine), and its
  currently-running-app write risk are each real enough to deserve a
  dedicated design, not a bolt-on to this one.
- **Not** Codex, Kimi, or Craft Agent. Codex and Kimi only expose a
  workspace-root-level JSON index (no per-session granularity, per piece
  C §4) — a "fix" there is a different, coarser operation than a SQL
  `UPDATE`, and deserves its own scoping once actually needed. Craft
  Agent has no per-project storage convention at all (piece C §4);
  nothing here changes that.
- **Not** `~/.copilot/session-store.db`. It keys on git-commit refs and
  file paths within a session, not on the project's absolute repository
  path the way `data.db`'s four tables do — a genuinely different data
  shape that doesn't fit this document's "rewrite the path" mechanism.
  Explicitly out of scope, not an oversight.
- **Not** an automatic merge for the collision case (§1.3, §7.3). Held
  and reported only; manual resolution is the owner's, same as every
  other collision surface built so far in this system.
- **Not** any change to `package/router/*`, OmniRoute's routing
  code, its classifier/scorer pipeline, or the `ISA.md:178` ownership
  boundary. This document does not touch, extend, or revise OmniRoute in
  any way.
- **Not** cleanup of the pre-existing stale rows found during
  reconnaissance (§1.3) beyond the one project actually being fixed on a
  given invocation. This tool fixes the specific project it's pointed
  at; it is not a bulk database-hygiene pass.
- **Not** reading any session/prompt/response content. Every table
  touched holds only paths, IDs, and timestamps — the same hard
  invariant piece C established (§10 of that design) continues here.

## 5. Real per-table findings (verified 2026-08-05, structure and current state)

| Table | Path column(s) | Constraint | Real state on this machine |
|---|---|---|---|
| `projects` | `main_repo_path` | `TEXT NOT NULL UNIQUE`, indexed (`idx_projects_main_repo_path`) | 9 rows, all distinct; 4 stale (no matching new-path row yet) |
| `worktrees` | `path` | `TEXT NOT NULL`, no unique constraint; FK `project_id` → `projects.id` (`ON DELETE CASCADE`) | 17 rows, 13 stale (76%) |
| `workspaces` | `source_path` | nullable, no constraint; FK `project_id`, FK `worktree_id` (`ON DELETE SET NULL`) | 17 rows, `source_path` NULL in all 17 — never populated in practice |
| `workspace_checkout_bindings` | `repo_path`, `checkout_path` | composite PK `(workspace_id, repo_path)` | 17 rows, mirrors the same stale old paths seen in `projects`/`worktrees` |

`workspaces.source_path` is excluded from the write plan (§7.2) — it is
schema-present but empty in every real row, and there is no observed
data to justify writing into it speculatively.

## 6. Data model

### 6.1 Plan shape

```json
{
  "portfolio": "thoughtseed",
  "repository": "...",
  "oldPath": "<PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/<repo>",
  "newPath": "<PROJECT_VOLUME>/2026/Projects/thoughtseed/<repo>",
  "generatedAt": "...",
  "status": "fixable" | "already-fixed" | "not-found" | "held",
  "holdReason": "new_path_project_already_exists:<projectId>" | null,
  "changes": [
    { "table": "projects", "column": "main_repo_path", "id": "<projectId>", "from": "<oldPath>", "to": "<newPath>" },
    { "table": "worktrees", "column": "path", "id": "<worktreeId>", "from": "...", "to": "..." },
    { "table": "workspace_checkout_bindings", "column": "repo_path", "id": "<workspaceId>|<oldPath>", "from": "...", "to": "..." }
  ]
}
```

`status` is honest about what was actually determined, matching the
`holdReasons`/three-state `matched` discipline established in piece C's
own data model (§6 of that design):

- `"fixable"` — a `projects` row exists at `oldPath`, no row exists at
  `newPath`, and a concrete list of table/row/column changes is ready to
  apply.
- `"already-fixed"` — no row exists at `oldPath` (either already fixed,
  or this project was never opened in Copilot CLI at all); nothing to
  do.
- `"not-found"` — `data.db` itself doesn't exist, or a required table is
  missing; cannot determine anything.
- `"held"` — a row exists at `oldPath` **and** an independent row already
  exists at `newPath` (§1.3's real collision shape). `holdReason` names
  the existing new-path project's ID for manual resolution. No changes
  are ever produced for a held plan.

### 6.2 Receipt shape

On a real `apply`, a receipt is written to
`~/.temperance_engine/receipts/copilot-session-fix/<portfolio>/<repository>-<timestamp>.json`,
mode `0600`, matching the existing receipt convention used by piece A's
rollback receipts. It records the plan that was applied (verbatim, from
§6.1) plus `appliedAt` and a post-apply re-read of every changed row,
proving the write actually landed as intended — the same "verify after
acting, don't just trust the write call" discipline used throughout this
whole system.

## 7. Architecture

### 7.1 Module

New file: `package/relocation/copilot-session-fix.ts`. Two exported
functions, mirroring piece A's `plan`/`apply` split:

- `planCopilotSessionFix(oldPath: string, newPath: string): CopilotSessionFixPlan`
  — opens `~/.copilot/data.db` **read-only** (`SQLite` opened with a
  read-only flag, not merely "no writes issued"), runs the lookups in
  §7.2, returns the plan shape from §6.1. Never opens a transaction,
  never issues `UPDATE`/`INSERT`/`DELETE`.
- `applyCopilotSessionFix(plan: CopilotSessionFixPlan): CopilotSessionFixReceipt`
  — refuses immediately (throws) if `plan.status !== "fixable"`. Runs the
  precondition checks in §7.4. Opens one write transaction and, as its
  first step **inside that transaction**, re-runs the same two lookups
  from §7.2 step 1-2 (row still exists at `oldPath`; still no row at
  `newPath`) — a plan can be minutes old by the time `apply` runs, and
  the database could have changed in between even with the app closed
  (e.g. a different process, a restore, a manual edit). Any mismatch
  aborts the transaction with a clean "plan is stale, re-run `plan`"
  error before a single `UPDATE` executes — the same pre-write
  revalidation discipline as piece A's guarded rename. Only once
  revalidated does it execute every change in `plan.changes` in table
  order (`projects` → `worktrees` → `workspace_checkout_bindings`),
  commit, re-read every changed row to confirm, write the receipt
  (§6.2), and return it.

### 7.2 Plan lookup mechanics

1. `SELECT id FROM projects WHERE main_repo_path = :oldPath` — zero rows
   → `status: "already-fixed"`. One row → continue with this
   `projectId`.
2. `SELECT id FROM projects WHERE main_repo_path = :newPath` — one row
   found → `status: "held"`, `holdReason` names that row's `id`, stop
   (no further queries needed; §1.3, §7.3).
3. Zero rows at `newPath` → build `changes`:
   - One `projects` row (`main_repo_path`).
   - `SELECT id, path FROM worktrees WHERE project_id = :projectId` —
     for every row whose `path` starts with `oldPath`, a `worktrees`
     change (string-prefix replace, not exact-match-only — worktree
     paths are `oldPath` plus a suffix, e.g.
     `.../copilot-worktrees/<repo>/<branch>`).
   - `SELECT workspace_id, repo_path, checkout_path FROM workspace_checkout_bindings WHERE repo_path = :oldPath OR checkout_path LIKE :oldPathPrefix`
     — a matching row can produce **up to two separate `changes` entries**
     (one for `repo_path` if it equals `oldPath` exactly, one for
     `checkout_path` if it starts with `oldPath`), both keyed by the same
     `(workspace_id, repo_path)` row identity captured at plan time, since
     `repo_path` is part of this table's composite primary key and
     changing it is itself one of the two possible column changes.
   - `workspaces.source_path` is never queried for changes (§5).
4. `status: "fixable"`, `changes` populated as above.

### 7.3 Collision handling

When step 2 above finds an existing row at `newPath`, the plan carries
`status: "held"` and nothing else — no partial changes, no attempt to
compare or reconcile the two rows' worktrees/bindings. The CLI reports
the held reason plainly (both project IDs, both paths) and exits
non-zero. A future, separately-scoped document can design the
re-parenting operation (moving `worktrees`/`workspace_checkout_bindings`
rows from the old `project_id` to the new one, then deciding what
happens to the now-orphaned old `projects` row) once it's actually
needed — this document does not guess at that design.

### 7.4 Precondition checks (apply only, never plan)

`applyCopilotSessionFix` refuses to open a write transaction if any of:

- The Copilot CLI process is currently running (checked by process name,
  matching the check already proven useful in reconnaissance —
  `ps aux` filtered for the Copilot CLI binary).
- `~/.copilot/data.db-wal` exists and is non-zero-length (an active,
  uncheckpointed WAL — a live-write signal even if the process check
  above is somehow inconclusive, e.g. a just-exited process that hasn't
  flushed yet).
- The plan's `status` is not `"fixable"` (§7.1).

Any refusal is a clean, typed error — never a silent no-op and never a
partial write.

### 7.5 CLI surface

New subcommand on the existing `scripts/vault-project-relocation.ts`:

```
bun scripts/vault-project-relocation.ts session-fix \
  --portfolio <thoughtseed|tryambakam-noesis> \
  --repository <name> \
  --tool copilot \
  [--dry-run]
```

`--tool` is required and validated against an allowlist containing
exactly `copilot` for this slice (not a free-text field) — adding
OpenCode later is a matcher-registration change, not a schema change to
this flag. Old/new paths are derived the same way `session-map` already
derives them (existing project-registry/session-map lookup by
portfolio+repository), not re-entered by the caller. `--dry-run` (or its
absence) selects `plan`-only vs. `plan` **and** `apply`. The command
always prints the plan (even when applying) so the caller sees exactly
what happened either way — matching `plan --dry-run`'s existing
"manifest, always shown" convention from piece A.

## 8. Testing strategy

Matches this system's established, non-negotiable discipline exactly:

- All logic in `copilot-session-fix.ts` — `planCopilotSessionFix`,
  `applyCopilotSessionFix`, the four-table change-building logic, the
  collision detection, the precondition checks — is tested exclusively
  against **fixture SQLite databases** created fresh per test (real
  `sqlite3`/`bun:sqlite`, real schema matching §5's real column
  definitions, populated with synthetic rows), never against
  `~/.copilot/data.db`. This mirrors every prior piece's fixture-only
  mutation-testing rule without exception.
- Fixture tests must cover, at minimum: the plain `"fixable"` case
  (single project, single worktree, single binding, no collision); the
  `"already-fixed"` case; the `"held"` collision case (both old-path and
  new-path project rows present); a project with zero `worktrees`/zero
  `workspace_checkout_bindings` rows (not every project has worktrees);
  a project with **multiple** `worktrees` rows needing the prefix-replace
  logic, not just an exact match; the precondition refusal paths (mock
  process-check and WAL-file-presence independently); and a post-apply
  re-read confirming every changed row landed correctly.
- Exactly one real-data proof step is permitted, matching piece B/C's
  "prove it for real" final task: a **read-only** `plan` (never `apply`)
  run against the actual `~/.copilot/data.db` on this machine, asserting
  it can correctly classify at least one of the four real stale projects
  found in reconnaissance (§1.3) as `"fixable"` with the expected
  `changes` shape. No automated test ever calls `applyCopilotSessionFix`
  against the real database. A real `apply` only ever happens via an
  explicit, manual, one-off CLI invocation — this document's `apply`
  path is built and tested, not proactively run, the same posture piece
  A's own `apply` command held throughout this whole project.

## 9. Relationship to the existing system

- Piece A (`package/relocation/project-relocation-*`) is untouched.
  Nothing here runs during, or is called by, the `apply`/`rollback`
  transaction.
- Piece B (nested-repo discovery) is untouched — no relationship; this
  document doesn't discover repositories, it fixes an already-known
  project's Copilot entries.
- Piece C (`project-session-map.ts` and its matchers) is extended, not
  modified: `session-fix` reuses the same portfolio+repository→old/new
  path lookup piece C already established, and the existing
  `copilot-matcher.ts` continues to answer "is this project's Copilot
  state still findable" for the session-map's own record-only report.
  This document adds the fix `copilot-matcher.ts` was always meant to be
  paired with eventually, without changing that matcher's own read-only
  contract.
- OmniRoute (`package/router/*`, `ISA.md:178`) is untouched, per §1.1 and
  §4 — no import, no call, no boundary change.

## 10. Open verifications before implementation

- The exact Copilot CLI process name/pattern to check in §7.4 needs one
  empirical confirmation (what `ps aux` actually shows when the app is
  genuinely running) before the implementation task can write the exact
  match string — do not assume from the binary's install-script name
  alone.
- Whether `worktrees.path`/`workspace_checkout_bindings.checkout_path`
  ever contain a path that is a **prefix of another real path** in the
  same database (e.g. `.../repo` and `.../repo-old`) needs a check
  against the real data before finalizing the prefix-replace logic in
  §7.2 — a naive `path.startsWith(oldPath)` could over-match in that
  case. If found, the fix is to require the character immediately after
  the prefix match to be `/` or end-of-string, not just any prefix
  match.
