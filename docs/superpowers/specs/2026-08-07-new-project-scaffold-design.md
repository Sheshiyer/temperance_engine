# New-Project Scaffolding Tool — Design

## Goal

Give every new `thoughtseed`/`tryambakam-noesis` project — created going
forward, starting at the moment a new client engagement begins — a
consistent structural identity from birth: the same six-file relocation
packet Part 1 (the packet-authoring tool) drafts retroactively for existing
projects, a folder skeleton informed by the delivery workflow the project
follows, and a real entry in the canonical work-object registry, rather than
a blank folder that only gets curated after the fact.

This is Part 2 of the vault-curation initiative. Part 1 (shipped
2026-08-06) curates *existing* project folders retroactively. Part 2 makes
*new* project folders start correctly, so the retroactive-curation gap Part
1 closed doesn't reopen every time a new client project is created.

## Background

Two existing subsystems this tool extends, confirmed by direct code
research rather than assumption:

**The packet pattern (Part 1).** `package/relocation/packet-evidence.ts` /
`packet-draft.ts` / `project-packet-schema.ts` define and validate the
six-file packet (`PROJECT.md`, `AGENTS.md`, `CLAUDE.md`,
`.project/CONTEXT.md`, `.project/project.yaml`, `.project/HANDOFF.md`).
`REQUIRED_PACKET_FILES` is a hardcoded closed list — `renderPacket` returns
a literal six-key object, and the schema's `TOP_LEVEL_KEYS`/`validateContext`
are closed `Set`s that reject anything outside the six. There is no
extension seam for a seventh file; adding one means editing three separate
hardcoded points in already-tested code. `PacketEvidence` is always built by
*reading an existing repository* (`gatherPacketEvidence(candidate, registry,
packageJson)`) — nothing in Part 1 synthesizes evidence for a repository
that doesn't exist yet.

**Two separate registries, not one.** This design initially assumed a
single "registry concept" Part 1 already uses; direct code research found
two, serving different moments in a project's life:

- `work-object-registry.v1.json` (read via `packet-evidence.ts`'s
  `CanonicalRegistry`/`RegistryWorkObject` types: `workId, name, kind:
  "sapling"|"program", programKind?, accountId?, lifecycle?, sourceRefs`).
  `workId` is a prefixed identifier (`sapling:cambium`,
  `program:cambium-operating-fabric`). **Nothing in the codebase writes to
  this registry — only reads.** Part 1 only ever matched candidates against
  entries that already existed.
- `project-registry.ts`'s `entry.json` (`RegistryEntryRecord`: `stableId`
  (plain repository basename, no prefix, no `kind` field at all),
  `portfolio`, `oldPath`, `packetDigest`, append-only `transitions`). This
  is a *relocation-transaction* record, created only when a project
  actually graduates out of the vault via `apply`. It has no bearing on
  project creation.

`PacketEvidence.projectId` and `RegistryEntryRecord.stableId` already share
the same plain-basename convention (both match
`isCanonicalRepositoryBasename`) — no unification work needed there. Only
`workId` uses the separate prefixed form, because it identifies an entry in
the separate canonical registry.

**The skill-clusters workflow system.**
`~/.agents/skill-clusters/workflows/registry.json` (version 2, no formal
JSON Schema — its only contract is a root `$comment`) currently defines
exactly one workflow, `website-delivery`, with nine stages
(`0-discover` … `8-close`, monotonic, single-digit, pattern
`<number>-<kebab-name>`). Each stage has `id`, `label`, `search_query`,
`skills[]` (all resolve against `skill-index.json`, confirmed
phantom-proof), and an optional `agents_skills[]`. There is no existing
notion anywhere of a workflow stage mapping to a folder — that mapping is
new design surface this tool introduces, not something it connects to an
existing spec.

## Out of scope

- Retroactively touching any of the 23 (now 24, pending disposition —
  `team-forge-ts` is retired and may not want this treatment at all)
  existing candidates from Part 1 — this tool only affects projects created
  after it ships.
- The `apply`/relocation flow itself, `entry.json`, or anything in
  `project-registry.ts` — a newly-scaffolded project starts in the vault
  and graduates via Part 1's existing relocation tooling later, unchanged.
- Promoting `identity_status` from `pending-teamforge-verification` to
  `verified-teamforge` — that's a separate, already-existing gap (the
  schema supports the value; nothing produces it) this tool doesn't
  address.
- Defining new skill-clusters workflows (e.g. an "app-delivery" workflow to
  parallel `website-delivery`) — this tool consumes whatever workflows
  exist in the registry; authoring new ones is a skill-clusters-side
  concern.
- A heavyweight pre-approved-digest gate on project *creation* itself
  (unlike `apply`, which requires one). Creating an empty scaffold has none
  of relocation's risk profile — no real git history, no existing content,
  nothing to lose, fully reversible by deleting the folder. `--dry-run`
  plus normal CLI argument validation is enough; copying `apply`'s
  heaviest safety mechanism here would be unjustified ceremony.

## Architecture

Four new modules in `package/relocation/`, following the same
pure-logic / thin-CLI-wrapper split Part 1 established, plus one new CLI
subcommand.

**`project-scaffold.ts`** (pure) — `synthesizeScaffoldEvidence(input)` →
`PacketEvidence`. Builds the same evidence shape `gatherPacketEvidence`
produces, but from CLI-supplied facts instead of reading an existing repo,
since none exists yet:
- `identityStatus` always starts `"pending-teamforge-verification"`.
- `knowledgeRef` starts as an explicit reviewable placeholder;
  `knowledgeRefIsPlaceholder: true`.
- `setupCommand`/`testCommand` start as reviewable placeholders.
- `verifyCommand` defaults to `"true"` — **not** `"not-applicable"`,
  because `project-packet-schema.ts` explicitly rejects that literal string
  for `commands.verify`. `"true"` is the same no-op fallback Part 1's
  `selectCommands` already uses when no real verify command exists.
- Every placeholder field is added to `needsReview`, matching Part 1's
  never-fabricate discipline. Output feeds the existing, unmodified
  `renderPacket` and `validateProjectYaml` — no changes to either.

**`workflow-provenance.ts`** (pure + one file read) —
`resolveWorkflowProvenance(typeId, workflowRegistryPath)` →
`{ stages: string[], workflowDigest: string } | null`. Reads
`workflows/registry.json`, finds the entry whose `id` matches `typeId`,
returns its `stages[].id` list verbatim and a sha256 hex digest of that
workflow entry's JSON (same "compute fresh, never trust caller input"
discipline as `stableManifestDigest` — no volatile field to exclude here,
since a workflow registry entry carries no timestamp). Returns `null` when
no workflow matches `typeId` — not an error; the caller falls back to a
fixed-folder-only scaffold. `renderWorkflowProvenanceMd(typeId, provenance)`
renders `.project/WORKFLOW.md`, recording the workflow id, its stage list,
and the digest. This file lives **outside** the six-file packet — it is not
added to `REQUIRED_PACKET_FILES`, `renderPacket`, or the schema's closed key
sets, which stay untouched. When no workflow matches, this file is not
created at all.

**`work-object-registry-write.ts`** (I/O) — `writeWorkObjectEntry(registryPath,
entry)`, a genuinely new write path (nothing writes to
`work-object-registry.v1.json` today; Part 1 only reads it).
`entry: RegistryWorkObject` with `workId` minted as `` `${kind}:${name}` ``.
Before writing, checks whether `workId` already exists in the registry file
and, if so, throws (`work_object_already_exists:<workId>`) rather than
overwriting — mirroring `project-registry.ts`'s established
refuse-not-clobber discipline (`registry_entry_history_rewrite_refused`,
`assertNoCompetingRegistryClaim`). Uses the same `writeOwnerOnly`-style
`0o700`/`0o600` write idiom as every other mutating write in this package.

**`scripts/vault-project-relocation.ts`** (modified) — adds the
`new-project` subcommand:

```
bun scripts/vault-project-relocation.ts new-project \
  --portfolio thoughtseed \
  --name client-x \
  --kind sapling \
  --type website-delivery \
  --registry-path <absolute work-object-registry.v1.json path> \
  --workflow-registry-path <absolute workflows/registry.json path> \
  --output <owner-only receipt path> \
  [--dry-run]
```

`--type` is optional; omitting it (or supplying a value that matches no
workflow) produces a fixed-folder-only scaffold with no error and no
`WORKFLOW.md`.

`--kind`'s exact allowed value set is unresolved and must be confirmed as
the first implementation step, not assumed here: direct code research
found `PacketEvidence.workObjectKind` typed as exactly
`"sapling" | "program"` in `packet-evidence.ts`, but earlier real work this
session matched existing registry entries with a `branch:` prefix (e.g.
`branch:bwssb`, `branch:valmark`, `branch:harsh-truths`) — meaning either
`RegistryWorkObject.kind` (the raw registry field, as opposed to the
possibly-narrower `PacketEvidence.workObjectKind` derived from it) supports
a third value the packet-evidence interface doesn't fully expose, or
`branch:`-prefixed entries are handled through a different path entirely.
The implementer must re-read `RegistryWorkObject`'s actual definition (not
just `PacketEvidence`'s) and the real `work-object-registry.v1.json`
directly to settle this before writing `--kind`'s validation, rather than
trusting either source alone.

## Data flow

1. Validate `--name` via the existing `isCanonicalRepositoryBasename`
   (imported from `project-relocation-grammar.ts`, not reimplemented).
   Compute the target vault path
   (`<vault-root>/<portfolio>/<name>`, using the same portfolio-root
   convention `inferPortfolio`/`REGISTRY_ROOTS`-adjacent code already
   uses) and hard-error if it already exists — no overwrite, ever.
2. If `--type` is supplied, call `resolveWorkflowProvenance`. Match →
   stage list + digest in hand for the dry-run report (step 4) and the
   real write (step 5). No match → proceed with an empty stage list; no
   error.
3. Call `synthesizeScaffoldEvidence`, then `renderPacket(evidence)`
   (unmodified Part 1 function) to get the six packet files' content.
   Validate the result against `validateProjectYaml` before writing
   anything — if a synthesized-evidence bug ever produced an
   invalid packet, this catches it before any filesystem mutation, not
   after.
4. If `--dry-run`: write nothing, print the plan (target path, stage
   folder list, workflow digest if any, WorkObject entry that would be
   written) and exit.
5. Otherwise, in order: create the target directory; write the six packet
   files under it; write `.project/WORKFLOW.md` if a workflow matched;
   create one empty subfolder per resolved stage id, verbatim (e.g.
   `0-discover/`, `1-brand/`, …) — no zero-padding transformation, since
   the source ids are already zero-free single digits and inventing a
   padding scheme for a >9-stage case that doesn't exist yet would be
   speculative; call `writeWorkObjectEntry` against
   `--registry-path`, erroring (and leaving already-written scaffold files
   in place, not rolling back — see Error handling) on a `workId`
   collision; write the owner-only receipt to `--output`.

## Error handling

- **Target path already exists** — hard error before any write
  (`scaffold_target_exists:<path>`). No partial-overwrite path exists.
- **`--name` fails `isCanonicalRepositoryBasename`** — hard error,
  reusing the exact same validation Part 1 already relies on everywhere
  else in this package.
- **`workId` collision in the work-object registry** — hard error
  (`work_object_already_exists:<workId>`) raised *after* the folder and
  packet files are already written (step 5 above), by design: the folder
  half of a scaffold is inert on its own (no registry claim, no relocation
  eligibility) and safe to leave in place for the operator to resolve —
  forcing a rollback of freshly-created, harmless files adds complexity
  Part 1's own relocation transaction machinery (which *does* need
  rollback, because it mutates a real pre-existing repository) doesn't
  need here. The receipt still records exactly how far the operation got.
- **`--type` matches no workflow entry** — not an error; documented
  fallback behavior (fixed-folder-only scaffold), consistent with the
  earlier design decision that project types without a defined workflow
  shouldn't block scaffolding.
- **Synthesized evidence fails `validateProjectYaml`** — hard error before
  any write (step 3), surfacing the exact validation errors returned by
  the existing, unmodified schema validator.

## Testing

- **`project-scaffold.test.ts`** — unit tests for
  `synthesizeScaffoldEvidence`: default placeholder values, `needsReview`
  population, and a direct assertion that `renderPacket` +
  `validateProjectYaml` accept its output (proving the six-file schema
  stays satisfied without any schema changes).
- **`workflow-provenance.test.ts`** — unit tests against a fixture
  `workflows/registry.json`: matched-type case (correct stage list +
  digest), unmatched-type case (`null`, no error), and a digest-stability
  check (same input twice → same digest; a changed workflow entry →
  different digest).
- **`work-object-registry-write.test.ts`** — unit tests for
  `writeWorkObjectEntry`: successful write to a fixture registry file,
  collision refusal against an existing `workId`, and file-permission
  assertions (`0o700`/`0o600`) matching the rest of the package's
  convention.
- **`vault-project-relocation-new-project.test.ts`** (CLI integration,
  mirroring `vault-project-relocation-draft-packets.test.ts`'s
  fixture-directory pattern) — end-to-end runs against fixture
  `--registry-path`/`--workflow-registry-path`/vault-root directories,
  never the real vault or the real skill-clusters install: a matched-type
  run producing stage folders + `WORKFLOW.md`, an unmatched-type run
  producing fixed-folder-only output, a `--dry-run` run asserting zero
  filesystem writes, a target-exists collision, and a `workId` collision.
- `verify-all.sh` (or equivalent existing test-aggregation script) updated
  to include the new test files, matching how Part 1 wired its own tests
  in.

## Verification against the real vault

Once implemented and reviewed, verify with `--dry-run` against the real
`--registry-path`/`--workflow-registry-path` first (report only, zero
writes), inspecting the reported target path, stage folders, and WorkObject
entry by hand before ever running a real (non-dry-run) scaffold. The first
real run should be a genuinely disposable test project (a throwaway name,
deleted afterward, with its WorkObject entry manually removed from the
registry) — not a real client engagement — the same canary discipline Part
1's `thoughtseed-brand-atlas` relocation followed before trusting the tool
against real work.
