# Packet-Authoring Tool — Design

## Goal

Draft the six-file project packet (`PROJECT.md`, `AGENTS.md`, `CLAUDE.md`,
`.project/CONTEXT.md`, `.project/project.yaml`, `.project/HANDOFF.md`) that
`vault-project-relocation.ts plan` requires, for each of the 23 remaining
depth-0 candidate folders under `thoughtseed/` that don't have one yet — so a
human can review, commit, and approve each one toward relocation the same
way the canary (`thoughtseed-brand-atlas`) already did.

## Background

This morning's real `inventory` + `plan` run against the vault found 24
depth-0 candidates (folders that are standalone repos with canonical
basenames, sitting directly under the portfolio root). One,
`thoughtseed-brand-atlas`, already had a packet and has since been relocated
for real — the system's first live run. The other 23 are blocked by
`packet_missing` and (mostly) `working_tree_not_clean`; this piece addresses
only the packet gap. A dirty working tree stays a separate, per-project
human decision at plan/apply time, same as it already was for the canary.

Every one of the 23 remaining candidates matches to exactly one
`workObject` in the canonical registry
(`thoughtseed-labs/00-meta/work-object-registry.v1.json`) via its
`sourceInventory` entry's `workRefs` — confirmed by direct cross-reference,
not assumed. The registry already carries real, evidence-based `name`,
`sourceRefs` (often including a `vault:...` knowledge-doc pointer), and
`accountId`/`programKind`/`lifecycle` for programs. This is a stronger,
already-verified foundation than re-investigating each repo from raw git
state, so the generator draws from it as its primary evidence source.

## Out of scope

- The 18 nested (non-depth-0) candidates from this morning's scan — a
  packet can't make them "ready" regardless of content, since `plan`'s
  `source_not_under_approved_portfolio_root` hold is structural, not
  packet-related. Addressing those requires a parent-folder restructuring
  decision this piece doesn't make.
- Resolving dirty working trees — each candidate's tree must still be
  clean at its own plan/apply time; this tool only prepares the packet
  content, it doesn't touch git state.
- Resolving the 12 candidates (from this morning's inventory) with
  `checked_in_path_consumer` hits — a separate relocation blocker,
  unrelated to packet completeness.
- Running `plan` or `apply` against any of the 23 — this tool only drafts;
  moving anything remains a separate, per-project human decision.
- The `tryambakam-noesis` portfolio — its registry is unresolved wholesale
  per the existing sequencing doc; not this piece's concern.

## Architecture

Three new modules in `package/relocation/`, matching this package's
established split (pure evidence → pure rendering → thin I/O CLI wrapper),
each independently unit-tested against fixtures — the same fixture-only
discipline every other mutating module in this package already follows.

**`packet-evidence.ts`** (pure) — `gatherPacketEvidence(candidate, registry,
packageJson)` → a `PacketEvidence` object. For each candidate:
- Matches the folder to its registry `workObject` via `sourceInventory`
  (`path`'s basename → `workRefs[0]`, erroring loudly if a folder has zero
  or more than one `workRefs` entry, rather than guessing).
- Pulls `name`, `kind` (sapling/program), `programKind`/`accountId`/
  `lifecycle` (for programs), and the first `vault:`-prefixed `sourceRefs`
  entry (for `knowledge_ref`) from the matched `workObject`.
- Pulls `githubIdentity` from the candidate's own git remote, read fresh
  (not from the registry — its `repo:` sourceRefs are bare repository
  names like `repo:brandmint-v2`, never an `owner/name` GitHub identity,
  confirmed by inspecting the real registry). If the remote is missing or
  doesn't parse as `owner/name`, `githubIdentity` is omitted and
  `identity_status` falls back to `unknown`.
- Reads `package.json` `scripts` (if the file exists) for `build`/`test`
  keys to populate `commands.test`/`commands.verify` candidates.
- Every field that couldn't be confidently sourced (no `vault:` ref found,
  no `package.json`, no `build` script) is set to a clearly-flagged
  placeholder and the field name is added to `needsReview: string[]` —
  never silently fabricated.

**`packet-draft.ts`** (pure) — `renderPacket(evidence)` → the exact text of
all 6 files as a `Record<string, string>` keyed by their packet-relative
path. Reuses the real `thoughtseed-brand-atlas` packet's structure
verbatim: same section headings and boilerplate paragraphs in `AGENTS.md`/
`CLAUDE.md` (these are near-identical across projects by design — the
operating contract doesn't change per-project), project-specific content
only in `PROJECT.md`, `.project/CONTEXT.md`, `.project/HANDOFF.md`, and the
structured fields in `.project/project.yaml`. Always sets
`packet_status: draft-held`. Sets `identity_status: pending-teamforge-verification`
when a `githubIdentity` was read from the git remote — this tool has no way
to actually confirm a TeamForge slug, so it never claims
`verified-teamforge` (that status is reserved for a human's explicit
confirmation, as it was for the canary) — else `identity_status: unknown`
when no usable git remote exists.
`.project/HANDOFF.md`'s "Next action" section always reads "Review this
draft packet, resolve any items flagged in the review summary, commit, and
move to `reviewed-held`" rather than inventing a project-specific narrative
this tool has no evidence for.

**CLI wrapper** — a new `draft-packets` subcommand on
`scripts/vault-project-relocation.ts`, following the existing subcommands'
shape (`--portfolio`, `--output` for the review summary). Loads the
registry once, iterates the 23 named candidates, calls
`gatherPacketEvidence` → `renderPacket`, writes the 6 files into each
repo's real working tree (never committing — that stays a separate,
per-project human step, same as the canary), and writes one consolidated
review markdown listing every candidate with its `needsReview` fields
called out explicitly, following the same "no silent gaps" format as this
session's earlier classification-needed review document.

## Data flow

```
work-object-registry.v1.json ─┐
                               ├─> gatherPacketEvidence(candidate) ─> PacketEvidence
candidate's package.json ─────┘                                          │
                                                                          v
                                                                   renderPacket(evidence)
                                                                          │
                                                                          v
                                                          6 files written to candidate repo
                                                          (packet_status: draft-held, uncommitted)
                                                                          │
                                                                          v
                                                     one consolidated review markdown
                                                     (confident fields vs needsReview flags,
                                                      per candidate)
```

## Error handling

`gatherPacketEvidence` throws, naming the candidate, on: zero or multiple
`workRefs` matches, or a `project_id` that fails
`PROJECT_ID_PATTERN`/`isCanonicalRepositoryBasename` — these represent real
data problems worth a
human's attention immediately, not something to paper over with a
`needsReview` flag and continue. Everything else (missing `vault:` ref,
missing `package.json`, missing `build` script) degrades to a flagged
placeholder rather than a hard stop, since those are expected, common gaps
across 23 real, heterogeneous projects.

The CLI wrapper continues past a single candidate's evidence-gathering
error (records it in the review summary as `FAILED: <reason>`, moves to the
next candidate) rather than aborting the whole batch — a bad match on one
folder shouldn't block drafting the other 22.

## Testing

TDD each pure module against small synthetic fixtures: a fake 2-3-entry
registry object and a fake `package.json`, covering the confident-match
case, the no-`vault:`-ref case, the no-`package.json` case, and the
zero/multiple-`workRefs` error cases. `renderPacket`'s tests assert exact
section presence and the `packet_status`/`identity_status` field values,
not full-string equality against the whole file (too brittle across 6
files), except for the boilerplate `AGENTS.md`/`CLAUDE.md` sections, which
do get exact-match assertions since they're meant to be identical across
projects.

The CLI wrapper gets one integration test against a temp fixture directory
tree (2-3 fake candidate repos + a fake registry file), asserting the 6
files land in each fixture repo and the review summary correctly lists
confident vs. flagged fields — never pointed at the real vault, matching
every other CLI-level test in this package's test suite.

## Verification against the real vault

After the tests pass against fixtures, run `draft-packets` for real against
the 23 actual candidates as the final proof step (matching this package's
established "real vault proof" task pattern from every prior piece), then:
- Confirm all 23 repos have the 6 new files, uncommitted, via `git status`
  in each.
- Spot-check 3-4 drafted packets by hand against their real registry
  entries for accuracy.
- Run `plan --dry-run` against 2-3 of the now-packeted candidates and
  confirm `packet_missing` no longer appears in `holdReasons` (whatever
  else remains — dirty tree, path consumers — is expected and unrelated to
  this piece).
- Report the review summary's `needsReview` count so the founder knows how
  many fields across how many projects need real human input before any
  of these 23 could move to `reviewed-held`.
