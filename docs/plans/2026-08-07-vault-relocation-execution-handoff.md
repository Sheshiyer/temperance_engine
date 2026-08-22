> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Vault Relocation — Execution Handoff (2026-08-07)

## Purpose

This is the doc to hand a fresh session that's picking up where this one left
off, to actually move the remaining Thoughtseed candidates and complete their
mapping into the canonical project-management record. It assumes no memory of
this session — everything it references is either already committed on
`main` of `temperance_engine`, or a real, currently-observable vault state,
checked directly while writing this, not assumed.

Read [`docs/plans/2026-08-04-vault-relocation-status-and-sequencing.md`](2026-08-04-vault-relocation-status-and-sequencing.md)
first for full historical context — its §§1–5a are the build history, §6 is
the current status this doc continues from directly.

## What's actually proven, right now

- **The move pipeline works on real state, not just fixtures.**
  `thoughtseed-brand-atlas` was relocated for real on 2026-08-06 — the
  first live `apply` this subsystem ever ran. It now lives at
  `<PROJECT_VOLUME>/2026/Projects/thoughtseed/thoughtseed-brand-atlas`.
- **The packet-content gate is closed for every remaining Thoughtseed
  candidate.** All 23 candidates named in the earlier inventory scan, plus
  `cambium`, have their required six-file relocation packet drafted,
  committed, and pushed. Two real bugs found and fixed in the drafting tool
  itself (silent AGENTS.md overwrite; wrong package-manager default for
  pnpm repos) — both shipped, not just noted.
- **New projects get this from birth now.** The `new-project` CLI
  subcommand scaffolds the packet, a `git init`'d tree, and a real registry
  entry for any brand-new project, so this retroactive-cleanup problem
  doesn't reopen every time a new engagement starts.
- **`team-forge-ts` is explicitly out of scope.** It's a retired repo
  (superseded management frontend), owner-confirmed 2026-08-07 as not
  needing to rejoin active infra. It has no packet and isn't part of this
  sequence — don't give it the same treatment as the other 23 without a
  fresh, separate decision to do so.

## The two phases that "moving files" actually means

The existing tooling implements Phase A completely. **Phase B does not exist
yet as a runnable step, and hasn't been completed even for the one repo
that's already moved.** Both are needed before a repo is genuinely "mapped
to the project," not just relocated on disk.

### Phase A — physical relocation (built, tested, proven)

`bun scripts/vault-project-relocation.ts apply --repository <path>
--manifest-digest <digest> --lock <path> --receipt-output <path>
[--registry-baseline-digest <sha256>]`

Moves the repository (atomic same-device rename, device/inode-guarded),
writes a registry entry (`project-registry.ts`'s `writeRegistryEntry`) with
its `transitions` array opened to `{ type: "reconciling", at, actor }`, and
writes the six-file capsule at the old path. This is what actually happened
for `thoughtseed-brand-atlas`. Its real registry entry right now:

```json
{
  "stableId": "thoughtseed-brand-atlas",
  "portfolio": "thoughtseed",
  "githubIdentity": "Sheshiyer/thoughtseed-brand-atlas",
  "oldPath": "<PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
  "packetDigest": "4d177cbd15dd3710c5ae2df8cb3789a221f7d4c1c879d3fcf743ed2d2bcaef43",
  "transitions": [
    { "type": "reconciling", "at": "2026-08-06T03:19:26.600Z", "actor": "vault-project-relocation-apply" }
  ]
}
```

One transition, type `reconciling`. Never closed.

### Phase B — reconcile + map to the canonical project-management record (built as a library, never wired in, never run)

`project-registry.ts` defines `appendReconciledTransition` — the function
that would close a `reconciling` entry into `reconciled` (requires
`ownerRatifier`, `closedAt`, `canonicalProjectRecord`,
`closureManifestDigest`). **No CLI subcommand calls it.** Grepped
`scripts/vault-project-relocation.ts` directly — zero references.

`project-management-record.ts` defines the writer for "the canonical main
project-management record" — `upsertProjectManagementRecord` /
`writeProjectManagementRecord`, a non-destructive, order-preserving upsert
grounded in the vault's own real template
(`thoughtseed-labs/80-templates/project-repo-context-template.md`), 22
tests, all against fixtures. **Never imported by the CLI.** Its target
directory, `thoughtseed-labs/20-operations/project-management/projects/`,
does not exist on disk — checked directly while writing this doc.

**This means: nobody has ever actually run "mapping to the project" for
real, not even once, not even for the canary.** The `entry.json` above sits
permanently in `reconciling` unless something closes it. Before this can
happen for the 23, one of two things needs to happen first, and it's a real
decision for the new session, not something to default silently:

1. **Build the missing assembly** — a `reconcile` (or similarly-named)
   CLI subcommand that composes `appendReconciledTransition` +
   `upsertProjectManagementRecord`/`writeProjectManagementRecord` into one
   callable, tested entrypoint, the same way `apply` composed Tasks 3/4/6/8
   into one callable entrypoint back on 2026-08-05. This is genuinely new
   code, not a bug fix — it deserves its own brainstorm → design → plan →
   SDD cycle, same rigor as `apply` itself got.
2. **Or do it by hand for the canary first**, as a one-off, to prove the
   real shape of a closed entry and a real project-management record before
   automating it — mirroring how the canary itself was hand-walked through
   Approval Boundary B before any of this was built.

Either way: **closing `thoughtseed-brand-atlas`'s reconciliation is
unfinished business from the last move, not a fresh task** — it's the
natural first thing to do before or alongside building the missing
assembly, since testing the assembly against a fixture is not the same
proof `apply` itself required.

## Current real blockers for the 23 — verified 2026-08-07, not assumed

Fresh `plan --dry-run` was run against all 23 immediately before this doc
was written. Every one shows exactly these two hold reasons, and only
these:

- **`packet_identity_pending_teamforge`** — every packet's `identity_status`
  is `pending-teamforge-verification`. This is the real, active TeamForge
  Cloudflare service (`https://forge.thoughtseed.space`) — **do not confuse
  with the retired `team-forge-ts` repo** (see above). This needs to
  actually run against the live service for each of the 23; nothing in this
  codebase can complete it automatically.
- **`working_tree_not_clean`** — every one of the 23 has real, uncommitted
  content sitting in its tree right now. This has been true since the
  original inventory scan on 2026-08-05 and hasn't resolved itself. Each
  needs its own owner review/checkpoint before its own `plan`/`apply` — the
  same discipline the canary needed before it moved. Do not attempt to
  "clean" any of these unilaterally; the dirty state may be real,
  in-progress work — this is per-repo, owner-side triage.

Neither blocker is a coding task. The one gap that *was* code-scoped
(missing packets) is closed.

## Exact procedure to move one repo, once its blockers clear

This mirrors what actually happened for `thoughtseed-brand-atlas`, adjusted
for the current CLI surface:

1. Confirm TeamForge identity verification has actually completed for this
   repo (external — how to check this against the live service isn't
   something this session determined; find out before relying on it).
2. Get the repo's working tree to genuinely clean (owner's call, per-repo).
3. `bun scripts/vault-project-relocation.ts plan --repository <path>
   --dry-run --output <receipt path>` — confirm `holdReasons: []` and note
   the printed `stableManifestDigest`.
4. Walk the exact Approval Boundary B checklist in
   [`docs/vault-project-relocation.md`](../vault-project-relocation.md)
   (source/destination, portfolio/stable-ID/GitHub identity, dirty status,
   path-consumer manifest, packet digest, manifest digest, registry path,
   capsule, pickup procedure, rollback command) — this is a deliberate,
   explicit approval step, not a rubber stamp.
5. `bun scripts/vault-project-relocation.ts apply --repository <path>
   --manifest-digest <digest-from-step-3> --lock <path> --receipt-output
   <path> [--registry-baseline-digest <sha256-if-the-registry-host-is-dirty>]`.
6. Independently verify the move: confirm the repo now exists at
   `<PROJECT_VOLUME>/2026/Projects/<portfolio>/<name>`, confirm a fresh
   `plan --dry-run` against the *old* path now reports
   `nested-repository`/`destination_exists` (proof it's genuinely gone from
   there, not just logged as moved).
7. **Phase B is still outstanding after this** — see above. Don't consider
   the repo "mapped to the project" just because step 6 passed.

## One unverified claim — do not build on it without re-checking

A note surfaced this session claiming `cambium`'s real implementation (a
`portfolio-cartographer` app, a `portfolio-workbench.ts` Worker route, etc.)
lives in an isolated worktree at
`<PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/.worktrees/cambium-portfolio-registry`,
separate from the primary `cambium` checkout. **Checked directly, could not
confirm any of it:** that worktree doesn't exist (the real ones are
`cambium-context-projections`, `cambium-operating-fabric`,
`cambium-release-20260728`, and a detached `cambium-prod-parity`), and a
filename search across the whole `thoughtseed` vault found zero matches for
`portfolio-cartographer`, `portfolio-workbench.ts`, or `portfolio-catalog*`
anywhere. If this note is accurate about *something* — just not the path it
gave — find out before ever planning or applying `cambium`, since the
relocation tooling only ever operates on the exact checkout path it's
given; it has no way to know a "more authoritative" copy exists elsewhere.

## Recommended order for the next session

1. Decide Phase B's shape (build the `reconcile` assembly, or hand-close the
   canary first — see above) before treating any of the 23 as fully done
   once moved, so the second real move doesn't repeat the same
   half-finished state as the first.
2. Re-check the `cambium` worktree claim before including it in any near-term
   plan.
3. Pick one of the 23 with a genuinely clean working tree and confirmed
   TeamForge verification as the second real canary, and walk the exact
   procedure above end to end, same rigor as the first — don't batch
   multiple repos into one apply run even once the tooling feels routine.
4. Only after a second real, independently-verified success, consider
   whether batching multiple applies in one session is safe — that
   decision doesn't belong in this doc, it belongs to whoever runs step 3.
