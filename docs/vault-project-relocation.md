# Vault Project Relocation

Reference documentation for the subsystem that relocates approved `thoughtseed` and
`tryambakam-noesis` working repositories out of the TWC Obsidian/PARA vault tree into
`/Volumes/madara/2026/Projects/<portfolio>/<repository>`, while preserving Git history,
stable project identity, portfolio knowledge records, portable pickup, and rollback.

This document describes what the code *is* and how its pieces fit together. For current
build status, what's tested versus deferred, and the next approval gate, see
[`docs/plans/2026-08-04-vault-relocation-status-and-sequencing.md`](plans/2026-08-04-vault-relocation-status-and-sequencing.md)
— that file is a progress ledger and changes as work lands; this file is the stable
reference. The original transaction authority is
[`docs/plans/2026-08-03-vault-project-relocation.md`](plans/2026-08-03-vault-project-relocation.md)
(Tasks 1–9) and the architecture authority is
[`docs/plans/2026-08-03-vault-project-relocation-design.md`](plans/2026-08-03-vault-project-relocation-design.md).

## Authority split

No single actor owns the whole relocation. Each authority owns exactly one layer:

| Layer | Owner | Scope |
|---|---|---|
| Local interactive governance | Codex (default) | Plans, acceptance evidence, approved transaction receipts — coordinates, gains no durable authority |
| Local Git checkout | one approved same-device rename | Same repository bytes at the new address |
| GitHub | read-only remote identity readback | Remote ownership, permissions, PRs, CODEOWNERS unchanged |
| Thoughtseed knowledge registry | single writer, `portfolio: thoughtseed` records only | One digest-bound knowledge record per repository |
| Tryambakam knowledge registry | single writer, `portfolio: tryambakam-noesis` records only | One digest-bound knowledge record per repository |
| OmniRoute | model-call routing only | Owns no project, task, handoff, or session state |
| Native client stores (Codex/Claude/OpenCode/Kimi session data) | each provider, unread by this subsystem | Historical sessions remain untouched; fresh pickup never imports them |

A filesystem path is a current address, not identity — the stable project ID is the
durable identity, carried in the packet (`project_id`) and the registry entry
(`stableId`). Thoughtseed and Tryambakam identities, secrets, schedulers, and runtimes
stay isolated: a Tryambakam packet can never reference a Thoughtseed-only authority
(Hermes, Cambium, TeamForge, Telegram, Paperclip), enforced by both the packet schema
validator and an executable source guard.

## Pinned vault

`/Volumes/madara/2026/twc-vault/` remains the PARA/Obsidian knowledge system.
`/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-labs/` remains a
nested knowledge vault at its current path — it is never a relocation candidate, and
the inventory CLI holds it explicitly (`pinned_knowledge_vault`). Historical pack
analysis, compaction, or history rewriting of the outer vault repository is a
separately planned, separately approved project — this subsystem never runs a
history-rewrite, garbage-collection, or pruning Git command, proven by an executable
source guard (`package/relocation/project-relocation-source-guards.test.ts`) that
scans every production file's actual `git` invocations, not just its documentation.

## Inventory

`bun scripts/vault-project-relocation.ts inventory --portfolio <name> --output <path>`

Read-only. Classifies every immediate child of the two approved portfolio source
roots — standalone repository, nested repository (not its own Git root), or
not-a-repository — and reports a disposition of `candidate` or `held` with named hold
reasons (non-canonical basename, always-held list membership, pinned knowledge vault,
destination collision, or for Tryambakam, the still-unresolved TN registry baseline).
Writes only the caller-supplied report file, mode `0600`, inside a mode `0700`
directory. No destination directory is created. Portfolio source roots:

- `thoughtseed` → `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed`
- `tryambakam-noesis` → `/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis`

(Note: this is the source root for *candidate repositories*, distinct from the
Tryambakam *registry* root below — the two are easy to conflate and an earlier version
of this script did, until it was corrected.)

## Portable packet

Each managed repository carries one canonical packet, prepared and reviewed as its own
change *before* relocation approval — the relocation transaction treats it as read-only
input and never creates or edits a packet file inside a checkout:

```text
<repository>/
├── PROJECT.md
├── AGENTS.md
├── CLAUDE.md
└── .project/
    ├── CONTEXT.md
    ├── project.yaml
    └── HANDOFF.md
```

`package/relocation/project-packet-schema.ts` validates `.project/project.yaml`
against a closed schema: stable ID, packet/identity status, portfolio (exact
two-value allowlist), repository (must pass the ratified basename grammar),
GitHub identity (owner/repo shape when present), knowledge reference, governance
(Codex as the only `default_interactive_client`), routing (`temperance-omniroute`
authority, an approved `te-*` lane for `plan_lane`/`review_lane`, a secretless
`credential_scope_ref`), commands (`setup`/`test` may say `not-applicable`; `verify`
never can), and an ordered `context` list drawn only from the six canonical files.
Anti-patterns are rejected: secret-shaped values, machine-local absolute paths, and
(for Tryambakam) any Thoughtseed-only authority term. `package/relocation/project-packet.ts`
adds file-presence checking, a NUL-separated SHA-256 packet digest, and a minimal
parser for this project's own closed YAML subset (deliberately not a general YAML
library — this repository has no `package.json`/`node_modules` for this module
family, and the format is fully self-controlled).

## Dry-run and the exact approval digest

`bun scripts/vault-project-relocation.ts plan --repository <path> --dry-run --output <path>`

Read-only — no `mkdir`, `rename`, `unlink`, registry write, capsule write, or
state-changing Git command runs in this path. Produces a manifest binding source,
destination, portfolio, repository classification, packet digest and identity status,
path-consumer scan result, collision result, and hold reasons. `ready` is a hardcoded
`false` in the schema — the actual signal is an empty `holdReasons` array, which an
owner reviews before approving. Approval means: the owner reviews this exact manifest,
computes or accepts its SHA-256, and that digest becomes the one thing a live apply is
authorized to match against (`manifest_digest_mismatch` fails preflight otherwise).

## Old-path consumer audit

`package/relocation/project-path-consumers.ts` searches for a repository's old-path
references in exactly two bounded domains, never anywhere else: checked-in text (`git
ls-files` across explicitly supplied repository roots — never gitignored or untracked
content) and an explicit, caller-supplied list of host configuration file paths (never
a directory walk). Matches are classified into a closed vocabulary (repository
config/script, Git worktree administration, submodule, MCP/client config, hook,
launchd/systemd, deploy script, sync job, documentation, cross-repository reference).
A linked-worktree lookup is bounded to exactly the candidate's own
`.git/worktrees/*/gitdir` pointer files — never a general filesystem walk. Every match
is currently unresolved (there is no approved-cutover-rule concept yet), so any match
holds the repository.

## Portfolio registries

Bound to their ratified knowledge authorities:

- Thoughtseed → `thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed/<repository>/`
- Tryambakam → `/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/<repository>/`

`package/relocation/project-registry.ts` is the sole writer, selecting exactly one
registry from the packet's `portfolio` field — `assertNoCompetingRegistryClaim()`
fails closed before mutation if the *other* portfolio's registry already claims the
same stable ID or GitHub identity. `assertRegistryHostClean()` requires the registry
host repository to be clean, or to match an explicit owner-approved baseline digest
exactly — any further drift beyond that baseline fails closed.

Thoughtseed entries are event-sourced and append-only: `appendReconcilingTransition()`
opens an entry (only on an empty log), `appendReconciledTransition()` closes it (only
from an open `reconciling` state, never twice), and `projectStatus()` projects the
displayed status from the last event. `writeRegistryEntry()` is the only I/O — it
refuses to persist a transitions array that is shorter than, or diverges from, what's
already on disk, so history only grows and is never rewritten. A closed
(`reconciled`) entry is a permanent historical record — Task 8's rollback explicitly
refuses to touch one.

### The canonical main project-management record (decided 2026-08-05, not yet built)

The reconciliation registry entry above is a ledger, not the thing a human browses.
The design doc calls for a separate step on closure: merge current operational facts
into Thoughtseed's "canonical main project-management record." No code exists for
this yet (Task 4 deliberately left it unbuilt) — this section records the decided
format, grounded in what the vault already does, not invented from the abstract spec.

`thoughtseed-labs/20-operations/project-management/` already holds a real, referenced
template for exactly this concept: `80-templates/project-repo-context-template.md`,
used today by `project-repo-context-library.md` to track projects like HeyZack. Its
frontmatter convention (`type`, `owner`, `status`, `created`, `updated`, `tags`,
`source_of_truth`, `sync_status`, `founder_visibility`, `related`) and body structure
(Context snapshot, Current read, Verified live surfaces, Repo inventory,
Implementation signals, Knowledge gaps, Next write-back actions) are already
established across multiple documents in that directory — not a one-off. Its
"Lifecycle status" field and "register or reconcile the TeamForge slug" write-back
item already anticipate exactly this kind of reconciliation.

**Decision:** one Markdown file per project, not a shared multi-project file (the
existing library file holds many projects as sections — the design doc wants one
addressable, digest-bindable record per project), at
`thoughtseed-labs/20-operations/project-management/projects/<repository>.md`,
reusing the existing template's frontmatter and body sections as-is, plus one new
`## Relocation` body section and a handful of new frontmatter fields carrying exactly
what the design doc requires and nothing invented beyond it:

```yaml
---
type: project-record
doc_type: project-repo-context
project_id: <verified TeamForge project ID>
portfolio: thoughtseed
repository: <repository>
github_repository: <owner/repo>
current_path: <exact current absolute repository path>
lifecycle_status: active | paused | completed | archived
relocation_evidence_ref: sha256:<digest>      # only present once a reconciliation has closed
relocation_evidence_path: <relative path to the closed relocation-registry entry>   # kept separate from the ref, per ISC-746
owner: ceo
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_of_truth: vault
sync_status: mapped
founder_visibility: both-founders
tags: [project, repo-context, relocation]
related:
  - ../relocation-registry/thoughtseed/<repository>/
---
```

Followed by the template's existing sections unchanged, plus:

```markdown
## Relocation

- Current repository path: <exact current path>
- Verified GitHub identity: <owner/repo>
- Relocation evidence ref: sha256:<digest>
- Relocation evidence path: <path to the closed registry entry>
- Closure manifest digest: <digest>
```

This satisfies ISC-734 (current path), ISC-735/745 (evidence ref, exact `sha256:`
form), ISC-746 (evidence path kept separate from the ref), and ISC-622/623
(lifecycle/type as metadata) directly. It deliberately does **not** duplicate old
path, transition history, owner ratification, or other historical fields — those
stay solely in the closed registry entry, never copied here, satisfying ISC-744's
anti-duplication requirement by construction rather than by convention alone.

**Built and tested 2026-08-05.** `package/relocation/project-management-record.ts`
(22 tests) — `renderNewProjectManagementRecord()` for a brand-new record,
`upsertFrontmatter()` and `upsertRelocationSection()` for an existing one, combined
in `upsertProjectManagementRecord()`, with `writeProjectManagementRecord()` as the
only I/O. Unlike every other file this package writes, this one can carry real
human-authored narrative prose, so the upsert path is a line-level, order-preserving
splice rather than a full re-serialization: fields that are genuine machine-derived
facts (`current_path`, `lifecycle_status`, the relocation evidence fields, `updated`)
are replaced in place on every write; human-editorial fields (`owner`, `status`,
`created`, `tags`, `source_of_truth`, `sync_status`) are set only when a record is
first created and never touched again; `related` gets append-only treatment so a
human's existing links are never disturbed and the registry link is never duplicated;
and any unrecognized future key is preserved untouched, in its original position.
Proven with a fixture carrying real narrative prose ("must never be silently
reflowed, reworded, or reordered by an automated writer") that survives every upsert
scenario tested — new file, existing file with a stale Relocation section, existing
file with a section after Relocation, and the full frontmatter-plus-body path
together. 249/249 relocation tests pass, wired into `verify-all.sh` and the source
guards. **Verified after the fact:** the real `thoughtseed-labs` has no
`20-operations/project-management/projects/` directory — every test wrote only to
temp fixture files, never the real vault. Neither `project-registry.ts` nor the
apply assembly calls this writer yet — wiring it into the actual reconciliation
closure flow (which only exists conceptually, since Task 4's `appendReconciledTransition`
requires a live, closed transaction that hasn't happened) is separate follow-up work.

## Old-path capsule

After a verified rename, the old address becomes a six-file knowledge capsule —
`package/relocation/project-capsule.ts`:

```text
<old-project-path>/
├── PROJECT.md
├── project-links.md
├── data/
│   └── project.yaml
└── handoffs/
    ├── relocation.md
    ├── integrity-manifest.json
    └── rollback.md
```

`renderCapsuleFiles()` is pure — every byte comes from structured input fields, never
copied from arbitrary repository content, so `.git` internals, provider state, and
transcripts are structurally impossible to end up inside a capsule. `writeCapsule()`
enforces the six-file list as closed on both sides: every required file must be
present in the render, and nothing outside that list may be written.

## Fresh-client pickup

`package/relocation/project-pickup.ts` — `resolvePickupBootstrap()` is a pure
resolver. Its signature accepts only a repository root, the approved routing-lane set,
and an optional expected packet digest; there is no provider, native-session, or
transcript input anywhere in the function (ISC-703). It validates packet completeness
and digest, then reads exactly three files — `PROJECT.md`, `.project/project.yaml`,
`.project/HANDOFF.md` — to resolve stable ID, portfolio, objective, branch, base
commit, completed work, next action, blocker, and verification command. Anything else
on disk, even sitting right next to the packet, never influences the output — proven
by a fixture test with a planted decoy file.

**Known, accepted limitation (reviewed 2026-08-05, left as is by owner decision):**
`objective` is sourced from `PROJECT.md`'s "Purpose and boundaries" paragraph rather
than `.project/HANDOFF.md` — a deliberate choice since the real committed packet has
no HANDOFF.md objective field, and ISC-679 (which requires HANDOFF.md specifically)
is correctly left unchecked in ISA.md to reflect that. `blocker` defaults to the
literal string `"none"` when no `## Blockers` heading exists in HANDOFF.md — this
cannot currently distinguish "the packet author explicitly confirmed there are no
blockers" from "the section was simply never filled in." ISC-686 is correspondingly
left unchecked in ISA.md rather than treating the default as satisfying it. This was
reviewed and the lenient default was kept intentionally rather than making the
resolver throw on an absent Blockers section — revisit if a packet author's silence
on blockers ever needs to be distinguishable from an explicit all-clear.

This pure resolver is a fixture proof, not a client certification. Live acceptance is
a separate, manual, post-move step: start one approved real client (Codex or Claude —
Kimi/Claw routed execution stays held while the TN OmniRoute deployment profile is
unverified) with its normal auth/runtime configuration, no resume, no import, no prior
project transcript, and confirm it reports the same stable ID and next action as the
pure resolver.

## Rollback

`package/relocation/project-relocation-rollback.ts` is drift-safe and receipt-bound.
`loadRollbackReceipt()` fails closed if the receipt file is missing.
`assertRollbackAllowed()` composes every gate and reports all failures at once before
anything is touched: capsule integrity (every one of the six files must match its
recorded digest exactly — a drifted, missing, or unexpected extra file holds the whole
rollback, never a partial delete), registry-entry integrity (drift, or an
already-`reconciled`/committed entry, both hold), destination identity (the same
device/inode check Task 6 uses for source-replacement and parent-swap protection, run
in reverse), and a bounded check that the destination has no linked worktrees. Only
after every gate passes does `performRollback()` mutate anything: delete the six
verified capsule files, remove the now-empty generated subdirectories bottom-up, then
reuse Task 6's `performGuardedRename()` in reverse for the final atomic rename-back —
which also gives the old-path-collision race check for free, since that function
already refuses if anything reappears at its target immediately before renaming.

## The receipt-bound transaction (Task 6)

`package/relocation/project-relocation-transaction.ts` is the only module that can
actually move a directory. `acquireExclusiveLock()`/`releaseLock()` use an atomic
`O_CREAT|O_EXCL` lock file. `runPreflight()` composes every required gate (standalone
repository, same device, destination absence, manifest digest match, packet validity,
zero unresolved path consumers, zero competing registry claims) as a pure function,
reporting every failing gate at once. `performGuardedRename()` is the one atomic
same-device POSIX rename, bracketed by a device/inode re-read immediately before and
after the call — this is what catches source-replacement and parent/path-swap races:
a path string alone proves nothing once time has passed since it was first captured,
only its `(device, inode)` pair does. `recordPostRenameArtifacts()` composes the
registry and capsule writers, reporting an explicit, honest held state — never a
silent loss — when the capsule write fails after the registry write already
succeeded.

## The end-to-end apply transaction

`package/relocation/project-relocation-apply.ts` assembles every module above into one
callable operation, `applyRelocationTransaction()`. It gathers repository
classification and device identity itself (read-only `git rev-parse`, in the same
spirit as the CLI's own `classifyRepository`); everything else — packet validation,
the path-consumer audit, and the fresh manifest digest — is caller-supplied, so this
orchestrator never duplicates policy that already lives in Task 2A/3's modules or the
CLI's own plan-building logic. Sequence: gather every preflight gate and refuse before
touching anything if any fails (fixture-proven for every gate: digest mismatch,
invalid packet, unresolved consumers, competing registry claim, dirty unbaselined
registry host, destination collision, non-standalone repository) → acquire the
exclusive lock → `performGuardedRename()` → capture Git HEAD and a refs snapshot
(`sha256` of `git show-ref`) both before and after the rename, since the "after" value
cannot exist before the rename runs and so can never be meaningful caller input →
`recordPostRenameArtifacts()` → write a rollback receipt in exactly the shape
`loadRollbackReceipt()` expects → release the lock. A full apply-then-rollback round
trip is proven end to end against a fixture: the repository lands back at its exact
original path with its exact original content, and the capsule that apply wrote is
gone.

`scripts/vault-project-relocation.ts` exposes this as CLI subcommands:

```text
bun scripts/vault-project-relocation.ts apply \
  --repository <absolute-source-path> \
  --manifest-digest <owner-approved-stable-manifest-digest> \
  --lock <absolute-lock-path> \
  --receipt-output <absolute-receipt-path> \
  [--registry-baseline-digest <sha256>]
bun scripts/vault-project-relocation.ts rollback \
  --receipt <absolute-receipt-path>
```

`plan --dry-run` now also prints a `stableManifestDigest` — the plan's content hashed
with its `generatedAt` timestamp excluded, so regenerating a plan against unchanged
real state reproduces the identical digest (verified twice in a row against the real
canary during this build). That's the value an owner approves and later quotes to
`apply --manifest-digest`; hashing the raw timestamped report would have made every
independently-generated plan of the same real state fail to match, defeating the
entire point of an exact-digest approval gate. This bug was caught and fixed before
any CLI wiring shipped.

**Building and testing this assembly is not the same action as running it.** Every
test for `applyRelocationTransaction()` and for the CLI's `apply`/`rollback`
subcommands runs exclusively against temp fixture directories; the CLI-level tests
that do touch real paths are argument-validation cases that fail before either command
reads or writes anything. Pointing this code at a real repository for the first time
is a distinct, separately-approved action — see Approval Boundary B below.

## The session-map (piece C)

`session-map --repository <absolute-new-path> [--no-relink]` records, per
project, which of six CLI tools (Claude Code, OpenCode, GitHub Copilot CLI,
Codex, Kimi, Craft Agent) had session state keyed to the project's old vault
path, and whether that state is still discoverable after the move. Output:
`~/.temperance_engine/session-maps/<portfolio>/<repository>/map.json`, mode
`0600`. Never git-tracked, never synced — inherently machine-specific.

For Claude Code specifically, a reversible symlink (default-on; disable with
`--no-relink`) is created so the tool continues its old session history at
the new path, gated never-clobber: only when the old session folder exists
and the new one does not.

Independently re-runnable — run once right after `apply`, and again later as
new sessions accumulate at the new path. Full design:
[`docs/superpowers/specs/2026-08-05-vault-session-map-design.md`](superpowers/specs/2026-08-05-vault-session-map-design.md).

## Approval Boundary B — before this code ever touches a real repository

Per the design doc, running `apply` against a real canary for the first time requires
the owner to separately approve, itemized:

- exact source and destination path;
- portfolio, stable ID, and GitHub identity;
- dirty/untracked status of the source repository;
- the `stableManifestDigest` printed by a fresh `plan --dry-run` run, taken immediately
  before apply;
- the exact registry entry path and the registry host's clean/baseline status;
- the exact six-file capsule content that will be written;
- the pickup procedure (live fresh-client canary, not yet attempted for any repository);
- the exact rollback command and receipt path.

**The Thoughtseed registry-host baseline was re-confirmed twice on 2026-08-05.**
Both times the dirty-file status digest (122 files) came back byte-identical to the
originally approved baseline — `assertRegistryHostClean()` would still accept it
right now. Between the original approval and the first re-check, `thoughtseed-labs`'s
HEAD commit moved while the uncommitted set stayed frozen, meaning the repository was
actively receiving commits in the background, not sitting static for review. The
second re-check found HEAD unchanged from the first — the background commit activity
had gone quiet for that window. The digest check doesn't cover HEAD at all, so a
matching digest is real evidence but never a guarantee nothing else has changed, and a
quiet window between two checks is not proof the repository has stopped moving for
good. Re-confirm again, immediately, before any real `apply` — see
[the status doc](plans/2026-08-04-vault-relocation-status-and-sequencing.md) §2 for
the exact HEAD/count/digest values from all three checks.

**The `hostConfigSurfaces` curation and real Task 2A audit run are done (2026-08-05).**
Twelve host-level configuration files were reviewed and checked directly against the
real `thoughtseed-brand-atlas` canary using the actual `auditPathConsumers()` module,
not a fixture: `~/.claude.json`, `~/.claude/launch.json`, `~/.claude/settings.json`,
`~/.codex/config.toml`, three PAI/Temperance-owned LaunchAgents
(`com.pai.thermal-guard`, `com.pai.voice-server`,
`com.temperance.engine.{omniroute,openai-proxy,reconcile}`), and the three shell
profile files (`.zshrc`, `.zprofile`, `.bash_profile`). Deliberately excluded:
dozens of timestamped LaunchAgent backup/disabled/removed files (historical
snapshots, not live host state) and third-party plists with no plausible connection
to a Thoughtseed project path (Adobe, Epic Games, Google, Steam, and others).
Result: **zero matches, zero unresolved consumers** — the repository is brand new and
not yet wired into any of this machine's automation. Receipt at
`~/.temperance_engine/receipts/vault-project-path-consumers/`, mode `0600`. Worth
noting for context, not a blocker: `crontab -l` was checked separately (it isn't a
regular file `auditPathConsumers()` can read) and has real, active entries for
*other* Thoughtseed/Tryambakam repositories — confirming this class of consumer is
genuinely live in this environment, not theoretical, even though none of them
currently reference this canary.

## Verification

```bash
bun test package/relocation/
bun test tests/vault-project-relocation.test.ts
```

Both are read-only against real vault paths where they touch real paths at all (the
inventory and dry-run CLI invocations); every other test in the suite runs exclusively
against temp fixture directories and never a real portfolio repository or registry
host.
