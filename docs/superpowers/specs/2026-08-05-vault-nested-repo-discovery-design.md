> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Vault Project Relocation — Nested-Repo Discovery (Piece B) — Design

**Issue:** The vault-relocation inventory scanner only enumerates immediate
children of each portfolio root, by deliberate design (a bounded scan, never
an arbitrary filesystem walk). Any independently-versioned Git repository
sitting two or more directory levels deep — inside a non-git "container"
folder, or inside another already-held repository's working tree — is
completely invisible to `inventory`/`plan`, even though nothing about
relocating it is actually unsafe once it's found.

**Status:** design (approved via `/superpowers:brainstorming` dialogue on
2026-08-05; not yet planned or implemented).

---

## 1. Problem

The design doc for piece C ([`2026-08-05-vault-session-map-design.md`](2026-08-05-vault-session-map-design.md))
originally framed piece B narrowly: *"`hermes-aws-ts` lives inside
`thoughtseed-labs`'s own working tree — a distinct case from piece A's
sibling-repo model."* Real reconnaissance on 2026-08-05 showed this framing
undersold both the actual scope and the actual nature of the problem.

### 1.1 The real scope is much larger than one repo

A bounded scan (2–5 levels deep, both portfolio roots only) for every `.git`
marker found **105 entries**, not one:

- **64 are Git worktrees** (`.worktrees/`, `.codex-worktrees/`) — a `.git`
  *file* pointing at a parent repo's shared object store, not an
  independent repository. Relocating one alone would sever it from that
  store. Worktrees are not relocation candidates and stay entirely out of
  scope for this piece.
- **41 are genuinely independent nested repositories** — their own full
  `.git` directory, own history, own (usually GitHub) remote.
  `hermes-aws-ts` is one of 41, not a special case. They cluster inside
  non-git "container" folders: `klear-karma` alone has 7, `Tirak` has 6,
  `website` and `Somatic-Canticles-book` have 4 each, plus singles/pairs
  under `HeyZack`, `iverif`, `parkarea`, `Archive`, `Coproperty`, `safvr`,
  `kristudios`, `Airdronauts`, `ashwinsheth-group`, `FMRL-reactnative`,
  `BV-PIP`, `Selemene-engine`, `Selemene-engine-worktrees`, and two under
  `_archive`. 31 of the 41 are under `thoughtseed`, 10 under
  `tryambakam-noesis`.
- Cross-referencing those 41 container folders against the existing
  inventory's `"nested-repository"` classification confirms **all of them
  have zero independent Git identity of their own** — they are plain
  organizing folders, not repositories, that happen to contain repositories
  as children or grandchildren.

### 1.2 This is a discovery problem, not a relocation-safety problem

Directly testing `git rev-parse --show-toplevel` against four of the 41
deep candidates (`hermes-aws-ts`, `klear-karma/kkv2-admin-panel`,
`Tirak/Backend/tirak-backend-alpha01`, `Coproperty/dashboard-0.1`) showed
**every one resolves to itself** — meaning the existing classifier
(`classifyRepositoryKind` / `classifyRepository`, see §1.3) would call all
41 `"standalone-repository"`, not `"nested-repository"`, if it were ever
pointed at them directly. Piece A's guarded-rename, registry, and capsule
pipeline is purely path/device/inode-based downstream of that one
classification gate (confirmed by direct code reading — see §1.3) and
would already relocate any of these 41 correctly today, given an exact
path.

The actual gap is narrower and safer than "nested repos need new
relocation-safety logic": **the inventory scanner never looks past
immediate children, so these 41 real candidates are simply never found.**
Piece B is a bounded-discovery extension, not a new mutation-safety layer.

### 1.3 What the existing code actually does today (verified 2026-08-05)

- Two **duplicate** implementations of the same classification logic exist:
  `classifyRepository()` in `scripts/vault-project-relocation.ts:206-233`
  (uses `resolve()`) and `classifyRepositoryKind()` in
  `package/relocation/project-relocation-apply.ts:52-61` (uses
  `realpathSync()`, with an inline comment explaining why — macOS resolves
  `/tmp` → `/private/tmp`, and a `resolve()`-only comparison would
  misclassify anything under a symlinked path as nested).
- Nested-ness is checked **exactly once**, at the inventory/preflight
  classification gate, and produces only a hold (`"nested-repository"` as
  the raw literal at inventory time; `not_standalone_repository:nested-repository`
  at apply preflight time — no dedicated semantic hold-reason string exists
  today).
- Nothing downstream of that gate — `performGuardedRename`,
  `recordPostRenameArtifacts`, the registry writer, the capsule writer —
  receives or checks `repositoryKind` at all. They operate purely on
  `source`/`destination` paths and `(device, inode)` pairs.

### 1.4 A real collision, not a hypothetical one

`Archive/team-forge-ts` and the real, actively-worked-on `team-forge-ts` at
the portfolio root share the exact same GitHub remote
(`github.com/Sheshiyer/team-forge-ts.git`), confirmed by direct
`git remote -v` on both. The Archive copy is a stale snapshot, 4 days
behind the real one's HEAD at investigation time. This is exactly the kind
of collision piece B's discovery must catch structurally — not something
to notice only after two registry entries have already been created for
the same underlying project.

## 2. Owner decisions (locked, from the brainstorm dialogue)

| # | Decision | Rationale given |
|---|----------|------------------|
| **E1** | Design the general discovery mechanism now; scope actual execution to one real canary (deferred to the implementation plan). The other 40 candidates get individually reviewed and relocated later using the same mechanism, not batch-processed in this pass. | Owner's explicit choice over building for full batch coverage of all 41 immediately — matches how piece A was built (one canary, then reusable). |
| **E2** | Discovery is a depth-capped recursive scan bounded to the same two already-approved portfolio roots — not an explicit hand-curated allowlist of container folders. | Owner's explicit choice. Naturally finds today's 41 and any future ones without requiring re-approval of a list every time a new nested repo appears; still bounded (fixed depth, fixed roots, `.git`-marker-only, zero content reads), consistent with the codebase's existing scanning discipline. |
| **E3** | Extend the existing `inventory` command (Approach 1) rather than build a separate `discover-nested` command or rely on purely manual discovery. | Owner's explicit choice over a parallel command (regression-safer but duplicative and a clunkier two-tool workflow) and over no new code at all (defeats the actual point of bulk discoverability). Naturally motivates consolidating the two duplicate classifiers found in §1.3 while touching this code anyway. |
| **E4** | Collision detection flags every conflicting candidate and holds all of them — no automatic preference (not "prefer depth-0," not "prefer most recent commit"). The owner resolves each conflict individually. | Owner's explicit choice: "flag the conflicts and we'll resolve them one by one." Matches the existing `assertNoCompetingRegistryClaim`'s own "no precedence, no merge" philosophy. |
| **E5** | `--max-depth` defaults to `0` (today's exact behavior, unchanged, when the flag is omitted). Deep scanning is opt-in per invocation for the first real run against the live vault, not on by default. | Owner's explicit choice over always-on-by-default, given how much the real candidate counts jump (of the 41 total, 31 are `thoughtseed` — taking its candidate count from 29 toward 60 — and 10 are `tryambakam-noesis`) and how many will immediately hold on a collision. Can revisit making it the default later once the owner has done a first real, reviewed pass. |

## 3. Goal

Extend the existing `inventory` command so that independently-versioned Git
repositories nested two or more levels below a portfolio root — inside a
non-git container folder, or inside another repository's working tree — are
discoverable and correctly classified, with enough provenance for the owner
to judge each one, and with same-identity collisions (basename or GitHub
remote) caught structurally before any registry entry is ever written.

## 4. Non-goals (YAGNI / explicit deferrals)

- **Not** relocating all 41 discovered candidates in this pass — piece B
  builds the mechanism; execution against the other 40 (beyond the one
  canary) is deferred, individually owner-approved work (§2, E1).
- **Not** treating Git worktrees as candidates or as containers worth
  descending into further — a `.git` *file* excludes that path from
  candidacy and stops the scan there (§1.1).
- **Not** a new mutation-safety layer for the guarded rename, registry
  writer, or capsule writer — §1.3 confirmed these are already
  classification-agnostic; nothing about them needs to change for deep
  candidates once discovered.
- **Not** automatically resolving collisions — every conflict is flagged
  and held for individual owner review (§2, E4).
- **Not** making deep scanning the default inventory behavior — stays
  opt-in via `--max-depth` for now (§2, E5).
- **Not** reading file content anywhere in the scan — only `.git`
  existence and type (file vs. directory), matching the zero-content-read
  discipline of every other scanner in this subsystem.
- **Not** investigating or resolving what `Archive/team-forge-ts` actually
  is beyond flagging it as a collision (§1.4) — that's an owner decision,
  not something this design makes for them.

## 5. Data model

`InventoryRecord` (`scripts/vault-project-relocation.ts`) gains two fields:

```typescript
interface InventoryRecord {
  // ...existing fields unchanged...
  depth: number;                       // 0 = today's direct children; 1+ = levels below the portfolio root
  immediateParentPath: string | null;  // set only when depth > 0
}
```

New hold reasons, additive to the existing set:

- `competing_candidate_claim:basename:<name>` — two or more candidates in
  this inventory run share a repository basename.
- `competing_candidate_claim:github_identity:<owner/repo>` — two or more
  candidates in this inventory run share a normalized GitHub remote
  identity.

Both hold reasons apply to **every** member of the colliding set, not just
the "extra" ones — there is no default winner (§2, E4).

## 6. Discovery algorithm

Bounded to the same two already-approved portfolio roots
(`PORTFOLIO_ROOTS`) — never leaves them. For **every** direct child that is
a directory at depth 0, walk downward up to `--max-depth` levels (default
`0`, i.e. no walk unless explicitly requested — §2, E5), regardless of that
direct child's own `repositoryKind`:

> **Correction (found during Task 7 implementation, 2026-08-05):** the
> original text here gated the walk on the direct child *not already being*
> `"standalone-repository"`, on the assumption there's nothing left to find
> inside an already-clean repository. That assumption is false for this
> vault: `thoughtseed-labs` — the container for `hermes-aws-ts`, this
> design's own §1.1 motivating example — is itself a standalone repository.
> Under the original gate, discovery could never recurse into it, so the
> headline case this whole piece exists to solve was structurally
> undiscoverable by the algorithm meant to solve it. The gate is removed;
> the walk now runs for every depth-0 directory unconditionally. This does
> not create a double-reporting risk — `discoverNestedGitRoots` only
> inspects a directory's *children* for a `.git` marker, never the starting
> directory itself, so a direct child that is itself a standalone repo is
> still recorded exactly once, by the existing depth-0 `inventoryEntry()`
> path, same as before.

- Directory has its own `.git` **directory** → candidate found. Classify it
  (trivially resolves to `"standalone-repository"`, per §1.2's direct
  verification). Record `depth` and `immediateParentPath`. **Stop
  descending** into it — a repository's own internal contents are never
  walked, exactly like today's depth-0 candidates are already treated as
  leaves.
- Directory has a `.git` **file** (worktree admin pointer) → excluded from
  candidacy. Stop descending — worktrees are not containers worth looking
  inside either.
- Directory has neither → keep descending, up to the depth cap. Skip
  `node_modules` explicitly (pointless and potentially large to walk, never
  contains a real project's own `.git`).
- Never reads file content — existence and type (`statSync().isDirectory()`
  vs. a plain file) only.

## 7. Collision detection pass

After the full candidate list is built for a given `inventory` run
(existing depth-0 candidates plus any newly-discovered deeper ones), a new
cross-candidate pass runs before the report is written:

- Group all candidates by repository basename. Any group with 2+ members:
  hold every member with `competing_candidate_claim:basename:<name>`.
- Group all candidates by normalized GitHub remote identity (`owner/repo`
  lowercased). Any group with 2+ members: hold every member with
  `competing_candidate_claim:github_identity:<owner/repo>`.

This is **new and additive** — distinct from the existing
`assertNoCompetingRegistryClaim` (`package/relocation/project-registry.ts`),
which checks a single candidate against the *other portfolio's registry*
(already-relocated entries, checked at apply time). This new pass checks
*within one inventory run*, before anything is registered — catching
duplicates like `Archive/team-forge-ts` at the earliest possible point
rather than only at apply time, and independent of which portfolio either
candidate belongs to. Both checks stay; they guard different stages and
neither replaces the other.

## 8. Classifier consolidation

**Correction (2026-08-05, caught while writing the implementation plan):**
reading both functions in full — not just the earlier summary — showed
they are not fully identical. `classifyRepositoryKind()`
(`package/relocation/project-relocation-apply.ts:52-61`) does exactly one
thing: compare `git rev-parse --show-toplevel` against the path. The CLI's
`classifyRepository()` (`scripts/vault-project-relocation.ts:206-233`) does
that *plus* gathers `gitCommonDir`, `head`, `branch`, `remotes`, and a
status digest — richer, not just a duplicate. Only the toplevel-vs-path
comparison itself is genuinely duplicated logic.

The shared function is that comparison alone, using the more careful
`realpathSync()` normalization (the apply-side version's own inline
comment already explains why — macOS symlink resolution — a real bug
class the CLI-side `resolve()`-only version is more exposed to). It does
**not** land in `project-relocation-grammar.ts` — that file explicitly
documents itself as having "no filesystem, Git, registry, client-session,
or network seam," and a function that shells out to `git` and calls
`realpathSync` would violate that file's own stated contract. It lands in
a new file, `package/relocation/project-repository-classification.ts`.
`classifyRepositoryKind()` is replaced by a direct call to the shared
function; `classifyRepository()` calls it internally for the
toplevel/repositoryKind piece, then gathers its additional metadata as it
already does. Both call sites' existing tests must keep passing unchanged
after the switch.

## 9. CLI surface

```
bun scripts/vault-project-relocation.ts inventory \
  --portfolio thoughtseed \
  --portfolio tryambakam-noesis \
  --output <path> \
  [--max-depth <n>]
```

`--max-depth` defaults to `0` — omitting it reproduces today's exact
behavior and report shape, byte-for-byte (§2, E5). Passing `--max-depth 5`
(covers the deepest real case found, `website/v2-archive/thoughtseed-2026/site`,
with a small margin) opts into the deep scan for that run.

## 10. Testing

Same fixture-only discipline as every other module in this subsystem — no
test ever touches the real vault:

- Depth/parent recording: fixture tree with a `.git` directory at depth 3;
  confirm `depth: 3` and the correct `immediateParentPath`; confirm the
  scan does not descend into it further.
- Worktree exclusion: fixture `.git` *file* (not directory) at some depth;
  confirm it's excluded from candidates and the scan doesn't descend past
  it either.
- `node_modules` skip: fixture with a `.git`-less `node_modules` tree;
  confirm the scanner doesn't walk into it.
- Basename collision: two fixture candidates sharing a basename (one at
  depth 0, one at depth 3); confirm both get
  `competing_candidate_claim:basename:...` and neither is left clean.
- GitHub-remote-identity collision: two fixture repos with the same
  `origin` URL; confirm both get
  `competing_candidate_claim:github_identity:...`.
- Classifier consolidation: the merged function gets its own fixture tests
  for the standalone/nested/not-a-repository cases; both call sites keep
  passing their existing tests unchanged after switching to the shared
  import.
- `--max-depth 0` (default): CLI-level test confirms the report is
  byte-identical in shape to today's inventory output when the flag is
  omitted.

## 11. Relationship to the already-built system

- Reuses `PORTFOLIO_ROOTS`, `InventoryRecord`, and the existing
  `inventory` command's report-writing path unchanged in shape (only
  additive fields).
- Reuses and consolidates `classifyRepository()` /
  `classifyRepositoryKind()` rather than adding a third implementation
  (§8).
- Does not touch `performGuardedRename`, `recordPostRenameArtifacts`, the
  registry writer, or the capsule writer — confirmed classification-agnostic
  in §1.3, so nothing there needs to change for deep candidates.
- The new collision pass is additive to, not a replacement for, the
  existing `assertNoCompetingRegistryClaim` (§7).
- Piece C's session-map is unaffected — it operates on whatever
  `--repository <path>` it's given, regardless of how that path was
  discovered.
