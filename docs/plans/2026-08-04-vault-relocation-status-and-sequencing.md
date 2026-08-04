# Vault Project Relocation — Status and Execution Sequencing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the tasks below one at a time, with an owner review checkpoint after each. Do not batch Task 4, Task 6, Task 7, and Task 8 into one session — each writes or moves real state and needs its own gate.

**Goal:** Give an accurate, verified read of what the vault relocation initiative has actually built and proved so far, name the two blockers discovered during this review, and sequence the remaining work against the existing task/stage authorities without re-specifying content that already exists.

**Authority:** [`ISA.md`](../../ISA.md) is the acceptance ledger. [`2026-08-03-vault-project-relocation.md`](2026-08-03-vault-project-relocation.md) is the transaction authority (Tasks 1–9). [`2026-08-03-vault-project-relocation-design.md`](2026-08-03-vault-project-relocation-design.md) is the architecture authority. [`2026-08-04-repository-grammar-execution.md`](2026-08-04-repository-grammar-execution.md) is the current execution-stage authority (Stages 0–6). **This document adds no new policy, authorizes no mutation, and creates no destination directory.** It is a status readback plus a sequencing map for the unbuilt remainder.

## Global Constraints

- Destination root is exactly `/Volumes/madara/2026/Projects/` — confirmed empty on disk as of this review.
- Portfolio allowlist is exactly `thoughtseed` and `tryambakam-noesis`.
- No relocation, registry write, capsule write, or filesystem move is authorized by this document or by anything reviewed below.
- Every remaining task ends at a dry-run or fixture gate, not a live mutation, unless a separate document records explicit owner approval of an exact manifest digest.

---

## 1. Verified current status (2026-08-04)

This was checked directly against the filesystem and Git state, not assumed from prior notes.

| Area | State | Evidence |
|---|---|---|
| Repository-basename grammar (Task 1 / Stage 1) | **Done, tested, wired into CI** | `package/relocation/project-relocation-grammar.ts` + `.test.ts`; `bun test package/relocation/` → 6 pass, 0 fail, 28 assertions; wired into `scripts/verify-all.sh`. ISC-758–760.19 all `[x]` in ISA.md. |
| Two-portfolio read-only inventory (Task 2 / Stage 2) | **Built; source-root bug fixed 2026-08-04, not yet re-run live** | `scripts/vault-project-relocation.ts inventory` implements classification, held-reasons, destination-collision checks. Both portfolio roots are now correct (see Blocker 1); a live `inventory` scan against the corrected `tryambakam-noesis` root hasn't been run yet to confirm. |
| Old-path consumer audit (Task 2A) | **Module built and tested 2026-08-04; not yet run against the real canary** | `package/relocation/project-path-consumers.ts` + `.test.ts` — 35 tests, all green, TDD throughout (RED confirmed before each GREEN except the final unresolvedConsumers/serialization pass, which only asserted properties the prior tasks' implementation already guaranteed). Classifies matches into the full closed vocabulary (repository-config-or-script, git-worktree-administration, submodule, mcp-client-project-config, hook, launchd-or-systemd, deploy-script, sync-job, documentation, cross-repository-reference); scans checked-in text only (`git ls-files`, real temp-repo fixtures prove untracked/gitignored content is never read); reads host-config surfaces only from an exact caller-supplied file list (no directory walking — proved by a fixture asserting a sibling file outside every supplied root/surface is never touched); resolves linked-worktree `.git` files via the bounded two-hop `.git/worktrees/*/gitdir` lookup. Wired into `scripts/verify-all.sh` next to the grammar test; `bun test package/relocation/` is 41/41 green (6 grammar + 35 path-consumers). **Deliberately not done yet:** no default/curated `hostConfigSurfaces` list exists — the module takes it as an explicit parameter by design (matches "explicitly enumerated," not "auto-discovered"), so an actual audit run against `thoughtseed-brand-atlas` still needs someone to enumerate the real host-config surfaces worth checking (LaunchAgents, MCP client configs, etc.) before Stage 3's path-consumer gate can be considered satisfied by more than the CLI's existing inline grep. |
| Canary selection | **Done** | Owner selected `thoughtseed-brand-atlas` (standalone repo, not `temperance_engine` itself, not on the always-held list). |
| Portable packet (Task 3) | **Schema validator + reader built and tested 2026-08-04** | `package/relocation/project-packet-schema.ts` (closed `validateProjectYaml`, 39 tests) + `package/relocation/project-packet.ts` (file-presence check, digest, a minimal hand-rolled parser for this project's own closed YAML subset, and `readAndValidatePacket()` tying it together, 13 tests). The already-committed `thoughtseed-brand-atlas` packet (commit `66d0b8a`) was read straight from its Git HEAD via `git show` and validated end-to-end — it passes cleanly, both as a drift-checked fixture and via the real parser. 93/93 tests green across all four relocation test files, wired into `verify-all.sh`. **Deliberately not done:** no external `yaml` npm package was added (this repo has no `package.json`/`node_modules` for this module family) — the parser only handles this schema's own flat/one-level-nested/list shape, not general YAML. |
| Deterministic dry-run (Task 5 / Stage 4) | **Done for the one canary, holdReasons empty** | ISA.md changelog records three successive dry-runs against `thoughtseed-brand-atlas`, converging to `ready:false` (a hardcoded field — read `holdReasons`, not `ready`) with **zero hold reasons**, packet digest `4d177cbd…`, HEAD `30e994a0…`, no path consumers, no destination collision. A manifest-approval readback confirmed no drift afterward. |
| Portfolio knowledge registries (Task 4) | **Built and tested 2026-08-04; never invoked against a real registry host** | `package/relocation/project-registry.ts` (42 tests total incl. below) — registry root/entry paths for both ratified roots (ISC-730/731), a pure append-only reconciliation transition log (`reconciling`→`reconciled`, refuses to double-close, refuses empty-log closure, ISC-732/733/737/743/747), `relocationEvidenceRef()` (ISC-745), `assertNoCompetingRegistryClaim()` (ISC-711), `assertRegistryHostClean()` (clean-or-exact-approved-baseline gate, ISC-727), and `writeRegistryEntry()` (the only I/O — refuses to shorten or tamper with an already-written history, tested exclusively against temp fixture directories). `package/relocation/project-capsule.ts` — pure `renderCapsuleFiles()` for the six-file capsule (content is built entirely from structured input, never copied from arbitrary repo content, so `.git`/provider/transcript data is structurally impossible to leak in), plus `writeCapsule()`/`verifyCapsuleFiles()`, both fixture-only. **Verified after the fact:** the real `thoughtseed-labs` still has no `relocation-registry/` directory, and `/Volumes/madara/2026/Projects/` is still empty — nothing in this task touched real vault state. **Bug caught and fixed mid-task:** the secret-detection heuristic reused from Task 3 initially flagged `packetDigest` and Git HEAD/refs digests as "looks like a secret" because they're legitimately 32+/64-char hex strings — fixed by excluding digest fields from that scan. **Deliberately not built:** the actual file format of "the canonical Thoughtseed main project-management record" (no real example exists to ground it in, unlike Task 3's packet) — the reconciliation log and evidence-ref logic are fully built and tested, but applying them to that real record's storage mechanism is left to Task 6 or a dedicated follow-up once that format is known. |
| Receipt-bound transaction (Task 6) | **Core built and tested 2026-08-04; no live-apply entrypoint exists** | `package/relocation/project-relocation-transaction.ts` (22 tests) — `acquireExclusiveLock()`/`releaseLock()` (atomic `O_CREAT\|O_EXCL` lock file), `runPreflight()` (pure composition of every required gate: standalone-repository, same-device, destination-absence, manifest-digest match, packet validity, unresolved-consumer count, competing-registry-claim, reporting every failing gate at once), `performGuardedRename()` (the one atomic same-device rename, bracketed by a device/inode re-read immediately before and after — **both mandatory attack tests pass**: source-replacement, where the source is deleted and a decoy dropped at the same path between capture and rename, and parent/path-swap, where the parent directory itself is swapped out from under an unchanged child path; both are caught by the same device/inode check and refuse to rename), and `recordPostRenameArtifacts()` (composes Task 4's registry+capsule writers, reporting an explicit, honest held state — not a silent loss — when the capsule write fails after the registry write already succeeded). 157/157 tests green across all seven relocation test files, wired into `verify-all.sh`. **Verified after the fact:** the real `thoughtseed-brand-atlas` is still at its original path, `/Volumes/madara/2026/Projects/thoughtseed/` doesn't exist, and `thoughtseed-labs`'s `relocation-registry/` still doesn't exist — every mutating function in this module was tested exclusively against temp fixture directories. **Deliberately not done:** `scripts/vault-project-relocation.ts` was NOT modified to add a live `apply` subcommand, and no end-to-end orchestrator function assembles preflight+lock+rename+record into one callable entrypoint yet. Building that assembly is what would make this "the thing you'd run against the real canary," and that step is intentionally deferred until a separate, explicit Approval Boundary B conversation — not bundled into building and testing this module. |
| Fresh-client pickup resolver (Task 7) | **Pure resolver built and tested 2026-08-04; live-client canary not attempted** | `package/relocation/project-pickup.ts` (7 tests) — `resolvePickupBootstrap()` takes only a repository root, the approved lane set, and an optional expected digest (ISC-703: no provider/session/transcript input anywhere in the signature). Validates packet completeness and digest before reading anything; reads exactly `PROJECT.md`, `.project/project.yaml`, `.project/HANDOFF.md` — proved with a fixture that an extra out-of-band file (containing a fake credential and a fake "next action" line) never influences a single output field, digest included. Regression-tested directly against the real `thoughtseed-brand-atlas` packet (read-only — confirmed the repo's Git status stayed clean afterward): resolves `stableId`, `portfolio`, `branch`, `baseCommit`, `verificationCommand`, `objective`, `nextAction`, and `completedWork` all correctly on the first attempt. **Interpretive calls made, not literal spec text — flagging for review:** `objective` is drawn from `PROJECT.md`'s "## Purpose and boundaries" first paragraph (HANDOFF.md has no literal "objective" field in the real packet); `blocker` defaults to the string `"none"` when no "## Blockers" heading exists (the real committed HANDOFF.md has no such heading today). **Not done:** the live fresh-client pickup canary (ISC-724–726) is explicitly a manual, post-move step per the design doc — it requires starting a real Codex/Claude session with no import, which is out of scope for an automated test suite and hasn't been attempted. |
| Rollback (Task 8) | **Built and tested 2026-08-04; no live-apply entrypoint exists** | `package/relocation/project-relocation-rollback.ts` (21 tests) — `verifyCapsuleAgainstReceipt()` (drift, missing-file, and unexpected-file detection against a digest-bound receipt), `verifyRegistryEntryAgainstReceipt()` (drift detection, and refuses an already-`reconciled`/committed entry per ISC-743's permanence guarantee — untouched, never-written entries are correctly treated as a safe no-op), `loadRollbackReceipt()` (fails closed on a missing receipt file), `assertRollbackAllowed()` (composes capsule + registry + destination-identity + linked-worktree checks, reporting every failing gate at once), and `performRollback()` (only mutates after the gate passes: deletes the six verified capsule files, removes the now-empty generated `data/`/`handoffs/` subdirectories bottom-up, then reuses Task 6's `performGuardedRename()` in reverse for the final atomic rename-back — which gives the old-path-collision race check for free, since that function already refuses if anything reappears at its target immediately before renaming). Every fail-closed path was tested end-to-end through `performRollback` itself, not just at the gate-function level: capsule drift, missing receipt, and destination drift all leave every byte untouched. 185/185 tests green across all nine relocation test files, wired into `verify-all.sh`. **Verified after the fact:** the real `thoughtseed-brand-atlas` is still at its original path with a clean Git status, and `/Volumes/madara/2026/Projects/thoughtseed/` still doesn't exist. **Deliberately not done:** same boundary as Task 6 — no CLI entrypoint, no receipt-producing step wired into the (still nonexistent) live-apply orchestrator. A rollback receipt has to come from *somewhere*; that "somewhere" doesn't exist yet either. |
| Docs + full verify-all wiring + source guards (Task 9) | **Not started beyond the one grammar-test line already wired.** | |
| Destination root | **Confirmed empty** | `ls -la /Volumes/madara/2026/Projects/` → no entries besides `.`/`..`. |

**Bottom line:** the project is exactly where its own docs say it should be — sitting at the Stage 4 dry-run gate for one canary, inside the Aug 3 doc's "Planning-only boundary." No repository has moved. No registry entry exists. The code that could perform a live move has not been written.

---

## 2. Two blockers found during this review — both addressed 2026-08-04

### Blocker 1 — Tryambakam inventory source root is wrong — **FIXED**

`PORTFOLIO_ROOTS["tryambakam-noesis"]` in `scripts/vault-project-relocation.ts` now
reads `/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis` (was
`_System/10865xseed`). Verified: `bun test package/relocation/` still 6 pass / 0
fail / 28 assertions; `bun run scripts/vault-project-relocation.ts` (no args) still
prints usage and exits 2 with no filesystem side effects. Line 211's
`tn_registry_baseline_unresolved` hold reason is untouched by this fix and
continues to hold every Tryambakam candidate closed, independent of Blocker 2
below. The file is untracked (part of the existing uncommitted relocation work),
so this shows as no `git diff` output and an unchanged `??` status — expected,
not a sign the edit didn't apply.

**Not yet done:** an actual `inventory --portfolio tryambakam-noesis` run against
the corrected root, to confirm the real ~55 TN repositories now enumerate
correctly. That's a live (if read-only) scan of the vault and wasn't run as part
of this fix — do it before treating the TN inventory as trustworthy.

### Blocker 2 — Both candidate knowledge-registry hosts are dirty — **thoughtseed-labs baseline recorded by owner decision**

Owner decision 2026-08-04: the current dirty state of `thoughtseed-labs` is
accepted as the exact approved baseline for Task 4 registry-entry creation,
the same treatment already given to `_System/10865xseed`. Evidence captured at
decision time:

- HEAD: `ad8560518f76673d50edb50b9f73304b078c4d58`
- Modified/untracked file count (`git status --porcelain=v2 --untracked-files=all`): **122**
- Status digest (SHA-256 of that porcelain output): `fca9b98746c88b8ddf70bcc928b028d9c7a01fd7ee87205ef49a14d6c60a0ff9`

**Caveat, not a formality:** this count was **96** files when first checked earlier
in this same review and **122** roughly fifteen minutes later — the tree is
actively moving, not static. "Baseline" implies a fixed point; this one visibly
isn't holding still. Task 4's registry writer should re-capture HEAD/count/digest
immediately before it writes and compare against this recorded baseline rather
than trusting it blindly — if they've diverged further, that's new drift since
this approval, not covered by it.

**Re-confirmed 2026-08-05:**

- HEAD: `90ffc943de3b40d3cc9e6bbdbc0fe2052588832f` — **moved** since the baseline was recorded (was `ad855051…`).
- Modified/untracked file count: **122** — unchanged.
- Status digest: `fca9b98746c88b8ddf70bcc928b028d9c7a01fd7ee87205ef49a14d6c60a0ff9` — **byte-identical** to the recorded baseline.

The dirty-file set is exactly the same 122 files with the exact same content as when the baseline was approved — `assertRegistryHostClean()` only compares this porcelain-status digest, so it would still pass against the recorded baseline right now. But HEAD advancing while the uncommitted set stayed frozen means **something is actively committing to `thoughtseed-labs` in the background** — this is not a static repository being safely held for review; it's live, and a real commit landed between the baseline being recorded and this re-check. The status-digest match is real and mechanically verifiable, but it doesn't cover HEAD — a future commit could just as easily touch files inside the current dirty set (changing the digest) or land unrelated to it (leaving the digest matching while the repo keeps moving underneath). Re-confirm again, immediately, before any real `apply` — this baseline should not be treated as good indefinitely just because it passed once and passed twice.

**Re-confirmed again, same day, 2026-08-05:**

- HEAD: `90ffc943de3b40d3cc9e6bbdbc0fe2052588832f` — **unchanged** from the immediately-prior re-check (no new commits landed in between).
- Modified/untracked file count: **122** — unchanged.
- Status digest: `fca9b98746c88b8ddf70bcc928b028d9c7a01fd7ee87205ef49a14d6c60a0ff9` — still byte-identical to the originally approved baseline.

This is the first check where nothing moved at all between two consecutive re-checks — the background commit activity observed in the prior re-check has gone quiet, at least for this window. This is still only a point-in-time read, not proof the repository has stopped moving for good: re-confirm again immediately before any real `apply`, exactly as before. `assertRegistryHostClean()` would pass against the recorded baseline right now.

**Formal ratification note:** this document records the decision and its
evidence; it does not create an ISA.md `Decision N` / ISC entry in your
established ratification format (Advisor pre/post-review cycle, IST timestamp,
explicit scope boundary). Add one yourself, or ask me to, if you want this
decision to carry the same ledger weight as the ISC-760.x series.

### Original findings (for reference)

`scripts/vault-project-relocation.ts` defines:

```ts
const PORTFOLIO_ROOTS = {
  thoughtseed: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed",
  "tryambakam-noesis": "/Volumes/madara/2026/twc-vault/_System/10865xseed",
} as const;
```

`_System/10865xseed` is the **TN knowledge-registry seed** (a single Git repository — install scripts, `noesis/` package, docs) — the same directory the design doc calls "the dirty seed" and explicitly says never to scan or enable. It is not a container of candidate repositories. The real Tryambakam working-repository portfolio lives at `/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis/`, which holds ~55 real candidates (`Selemene-engine`, `astrolens`, `noesismirror-web`, `witness-agents`, etc.).

As written, an `inventory --portfolio tryambakam-noesis` run would enumerate `10865xseed`'s internal subdirectories (`koshas`, `noesis`, `tasks`, `tests`, `docs`, …) as if they were relocation candidates, and would never see the real TN repositories at all. This doesn't affect the current canary (it's on the Thoughtseed side, whose root is correct), but it means **the "two-portfolio inventory is reproducible" claim in the Stage-execution doc's definition of done is not actually true for the Tryambakam half**, and must not be trusted until fixed.

**Fix is a one-line constant change** (source root only — the ratified TN *registry* root, `_System/10865xseed/projects/<repository>/`, is a separate value used later for Task 4 and is unaffected by this fix).

### Blocker 2 — Both candidate knowledge-registry hosts are currently dirty

The design doc requires: *"The selected registry repository must be clean or have an owner-approved exact baseline plus a non-overlapping entry path."* Checked directly:

- `thoughtseed-labs` (Thoughtseed registry host): **96 modified files**, and `20-operations/project-management/relocation-registry/thoughtseed/` **does not exist yet**.
- `_System/10865xseed` (Tryambakam registry host): **40 modified files** — already flagged dirty in the design doc, TN apply already correctly held on this.

This means Task 4's registry-write step cannot proceed for *either* portfolio yet — including for the already-approved `thoughtseed-brand-atlas` canary — until the owner either cleans `thoughtseed-labs`'s working tree or records an explicit approved baseline digest for it (the same treatment already anticipated for `10865xseed`). This is a decision for the owner, not something to resolve unilaterally — a 96-file dirty tree in the company knowledge vault may be legitimate in-progress work.

---

## 3. Remaining execution sequence

Each row binds to the existing Task numbers in the Aug 3 plan and Stage numbers in the Aug 4 addendum — see those documents for the full test/fixture specification. This table only orders the work and names the gate; it does not restate content that already exists there. A bite-sized TDD breakdown should be written just before each task starts (the same way Stage 1's grammar module and Stage 2/4's CLI were actually built) — writing all of it now would go stale the moment the registry-baseline decision changes shape.

| Order | Task | Scope | Primary ISC clusters | Gate before starting |
|---|---|---|---|---|
| 1 | **Fix Blocker 1** | Correct `PORTFOLIO_ROOTS["tryambakam-noesis"]` in `scripts/vault-project-relocation.ts` to `/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis`; regenerate the inventory report for both portfolios | ISC-750, ISC-751 | None — read-only fix, owner sign-off requested below |
| 2 | **Resolve Blocker 2** (owner decision, not code) | Owner chooses: clean `thoughtseed-labs`, or record an explicit approved baseline digest, before any registry entry can be written | design doc §Knowledge Registries | Owner decision |
| 3 | Task 2A hardening | **Done 2026-08-04** — `package/relocation/project-path-consumers.ts`, 35 tests, wired into `verify-all.sh`. Still needs: an owner-curated `hostConfigSurfaces` list and one real run against `thoughtseed-brand-atlas` before this gate counts as closed for the canary. | ISC-709, ISC-710 | Task 1 (this doc) done |
| 4 | Task 3 | **Done 2026-08-04** — `project-packet-schema.ts` + `project-packet.ts`, 52 tests, wired into `verify-all.sh`. The committed `thoughtseed-brand-atlas` packet validates cleanly end-to-end. | ISC-661–678, ISC-714–716 | none |
| 5 | Task 4 | **Done 2026-08-04** — `project-registry.ts` + `project-capsule.ts`, 42 tests, wired into `verify-all.sh`. Never invoked against a real registry host — fixture-only. The "canonical main project-management record" file format is still unknown and deliberately deferred. | ISC-624–625, ISC-642.1, ISC-651, ISC-697–700, ISC-711, ISC-727, ISC-730–749 | Blocker 2 resolved |
| 6 | Task 6 | **Core done 2026-08-04** — `project-relocation-transaction.ts`, 22 tests, wired into `verify-all.sh`. Lock, preflight, guarded rename (both mandatory attack tests pass), and post-rename recording are all built and tested against fixtures only. | ISC-638–660, ISC-707–708, ISC-712–713, ISC-716, ISC-728–729 | Tasks 3–4 done and tested |
| 10 | **End-to-end apply assembly** | **Done 2026-08-05** — `package/relocation/project-relocation-apply.ts` (`applyRelocationTransaction()`, 11 tests incl. a full apply-then-rollback round trip against a fixture), plus CLI `apply`/`rollback` subcommands in `scripts/vault-project-relocation.ts`. A real bug was caught and fixed before shipping: hashing the raw timestamped plan report would have made no two independently-generated plans of the same real state ever match — `plan --dry-run` now also prints a timestamp-excluded `stableManifestDigest`, verified deterministic against the real canary twice in a row. Still fixture-only — never invoked against a real repository. | (assembly, not a numbered ISC range) | Tasks 3/4/6/8 done |
| 7 | Task 7 | **Pure resolver done 2026-08-04** — `project-pickup.ts`, 7 tests, wired into `verify-all.sh`. The live fresh-client pickup canary is a manual post-move step, not yet attempted. | ISC-693–694, ISC-701–703, ISC-717, ISC-724–726 | Task 6 done |
| 8 | Task 8 | **Done 2026-08-04** — `project-relocation-rollback.ts`, 21 tests, wired into `verify-all.sh`. Rehearsed end-to-end against fixtures (happy path + every fail-closed gate). No live canary rehearsal yet — there's no receipt-producing live transaction to rehearse against. | ISC-652–653 | Task 6 done |
| 9 | Task 9 | **Done 2026-08-04** — [`docs/vault-project-relocation.md`](../vault-project-relocation.md) (canonical reference doc), `project-relocation-source-guards.test.ts` (9 tests — proves by direct source inspection, comments stripped first, that every Git subcommand across the subsystem is read-only and no file references homedir/Paseo/.ssh/id_rsa/credentials.json/PEM keys/transcripts), and `tests/vault-project-relocation.test.ts` (9 tests — real read-only CLI runs of `inventory`/`plan --dry-run` against the actual vault, plus argument-validation failure modes). Also filled the standing "inventory/plan/CLI tests" gap from the original Task 2/5 spec, which was never built as separate tested modules. 64 previously-open relocation ISC criteria checked in ISA.md against this session's actual tested code (not a live apply) — see today's changelog entry there for the exact list and what was deliberately left open. | ISC-654–657, ISC-704–706 | Tasks 2A–8 done |
| — | **Approval Boundary A (formal close-out)** | **Presented 2026-08-05** — one consolidated, fresh, corrected two-portfolio scan (127 entries), ready for owner review. Full findings in §5 below. | design doc §Approval Boundary A | after Task 1 (this doc) |
| — | **Approval Boundary B (live apply)** | Present exact source/destination, portfolio/stable-ID/GitHub identity, dirty/untracked status, path-consumer manifest, packet digest, manifest SHA-256, registry path, six-file capsule, pickup procedure, rollback command — then apply exactly one digest-approved canary | design doc §Approval Boundary B | Tasks 1–9 all done and passing |

---

## 4. Recommended immediate next action

**Every original task plus the end-to-end apply assembly is now built and tested.** 227 relocation tests pass across 12 files, wired into `verify-all.sh` (the full non-relocation suite was not re-run this session — deliberately, since it touches live OmniRoute/Hermes/Cloudflare state). Nothing has moved a real repository — every mutating function has only ever been invoked against temp fixture directories, re-verified after every task including the assembly step, and the source guards prove that structurally. Canonical reference documentation lives at [`docs/vault-project-relocation.md`](../vault-project-relocation.md), including a full Approval Boundary B checklist; this file remains the progress ledger.

**There is no more code-scoped work left before a real apply.** What remains is entirely the owner-side checklist in `docs/vault-project-relocation.md`'s "Approval Boundary B" section. In order:

1. ~~Curate and approve the actual `hostConfigSurfaces` list for a real Task 2A audit run against `thoughtseed-brand-atlas`.~~ **Done 2026-08-05** — 12 real host-config files reviewed and checked with the actual `auditPathConsumers()` module (not a fixture): zero matches, zero unresolved consumers. Receipt at `~/.temperance_engine/receipts/vault-project-path-consumers/`, mode `0600`. Full list and rationale in `docs/vault-project-relocation.md`.
2. ~~Re-confirm `thoughtseed-labs`'s registry-host baseline.~~ **Re-confirmed twice 2026-08-05.** First re-check: status digest still byte-identical (122 files, same content) to the approved baseline, but HEAD had moved (`ad855051…` → `90ffc943…`) since original approval — the repo was actively receiving commits in the background. Second re-check (this one): HEAD **unchanged** at `90ffc943…`, count and digest still identical — no drift since the first re-check. `assertRegistryHostClean()` would still pass right now. Re-confirm again immediately before any real apply; a quiet window is not proof the repo has stopped moving for good. Full detail in §2.
3. ~~Review Task 7's two interpretive calls.~~ **Reviewed and closed 2026-08-05.** `objective` sourced from PROJECT.md: confirmed as intended, no change — a deliberate, well-grounded choice, and ISC-679 (which specifically requires HANDOFF.md to carry it) was already correctly left unchecked, not silently claimed. `blocker` defaulting to `"none"` on an absent section: **found a real, if small, self-correction** — ISC-686 had been checked in the 2026-08-04 changelog entry on the reasoning that the resolver's default satisfied "records blockers or an explicit none value," but ISC-686's own criteria-table row requires the *file* to record that, not the resolver to infer it silently. ISC-686 corrected back to unchecked in ISA.md, with a dated changelog entry explaining why. **Owner decision: keep the lenient default, document the limitation, no code change** — recorded in `docs/vault-project-relocation.md`'s "Fresh-client pickup" section.
4. ~~Decide the file format for Thoughtseed's "canonical main project-management record."~~ **Decided and built 2026-08-05.** Format grounded in the vault's own real, referenced template (`thoughtseed-labs/80-templates/project-repo-context-template.md`). Writer: `package/relocation/project-management-record.ts`, 22 tests — non-destructive, order-preserving upsert that never touches human-editorial frontmatter fields or narrative prose after first creation, proven against a fixture carrying real human-authored content across every upsert scenario. 249/249 relocation tests pass. Verified after the fact: the real `thoughtseed-labs` has no `20-operations/project-management/projects/` directory — fixture-only, same as everything else. Not yet wired into `project-registry.ts` or the apply assembly — that requires a live closed reconciliation, which hasn't happened.
5. ~~Formally close Approval Boundary A.~~ **Closed 2026-08-05** — full consolidated findings in §5 below. Two things surfaced worth your attention: `hermes-aws-ts` no longer exists at its expected path (nothing to hold, but worth confirming that's expected), and two candidates (`plexus-ts`, `plexus-ts-github-settings-ota-review`) share one GitHub remote — a same-portfolio identity collision the current code doesn't guard against, though neither is the canary.
6. Once 2 and 4 are settled: run `plan --dry-run` fresh, review its `stableManifestDigest`, and walk through the itemized Approval Boundary B checklist explicitly — that is the only remaining gate before `apply` could be run for real, and it is a separate, explicit conversation, not a natural continuation of this one.

---

## 5. Approval Boundary A — formal close-out (2026-08-05)

Fresh, corrected scan of both approved portfolios: 127 total entries. Receipt at
`~/.temperance_engine/receipts/vault-project-relocation-inventory/20260804T191634Z-boundary-a/report.json`,
mode `0600`.

| | thoughtseed | tryambakam-noesis |
|---|---|---|
| Immediate children | 70 | 57 |
| Candidates | **29** | **0** |
| Held | 41 | 57 |

**Named holds from the design doc, checked individually, not assumed:**

- `hermes-aws-ts` — **does not currently exist** under `01-Projects/thoughtseed/`. The design doc's instruction to hold it is moot right now, not satisfied by a rule — there's nothing there to hold. Worth a sanity check: has it moved, been renamed, or was it already retired since the design doc was written?
- Snow Gloves / `10869` — all four (`snow-gloves-os`, `snow-gloves-ci-fix`, `snow-gloves-variable-contracts`, `10869`) correctly held (`owner_mapping_or_active_control_hold`).
- "Linked Snow Gloves worktrees" — **not verifiable by this scan.** The three `*worktrees*`-named top-level entries (`.codex-worktrees`, `.worktrees`, `Skill-clusters.worktrees`) are unrelated generic worktree-container directories, not Snow Gloves-specific. If Snow Gloves has linked worktrees, they'd live inside `snow-gloves-os`'s own `.git/worktrees/`, one directory level this inventory doesn't descend into. Held regardless (Snow Gloves itself is held), but the specific worktree claim is unconfirmed, not confirmed-absent.
- `thoughtseed-labs` — held (`pinned_knowledge_vault`), as required.
- `_System/10865xseed` (Tryambakam registry seed) — outside this scan's source roots by design (it's a registry root, not a portfolio source root); its dirty/unresolved status is tracked separately and unchanged.

**New finding from this review, not previously flagged:** two candidates share the
same GitHub remote — `plexus-ts` and `plexus-ts-github-settings-ota-review` both
point at `github.com/Sheshiyer/plexus-ts`. `assertNoCompetingRegistryClaim()` only
checks the *other* portfolio's registry, not same-portfolio siblings — if both were
ever approved as separate relocation candidates, nothing in the current code stops
two registry entries from claiming the same GitHub identity within one portfolio.
Neither is the current canary, so this doesn't block anything today, but it needs an
owner decision (which one is canonical, or are they intentionally distinct) before
either is ever approved.

**Dirty-state reality check:** of the 29 thoughtseed candidates, only **2** have a
clean working tree right now — `thoughtseed-brand-atlas` (the canary) and
`plexus-ts-github-settings-ota-review`. The other 27 are currently dirty. "Candidate"
here means "not held for a structural reason" — it does not mean "ready to move
today." Each would need its own clean-or-checkpointed working tree at its own
plan/apply time, same as the canary already required.

**Canary re-confirmed:** `thoughtseed-brand-atlas` — standalone, clean (`git status`
empty), correct GitHub remote, `holdReasons: []`. The original recommendation stands
against this fresh data.

**Tryambakam-noesis:** all 57 entries held, entirely on `tn_registry_baseline_unresolved`
— consistent and expected; no change from the corrected-root scan run right after
Blocker 1 was fixed.

This is the complete artifact Approval Boundary A calls for. Formal closure means you've
now seen it — nothing above blocks anything, but the `hermes-aws-ts` absence and the
`plexus-ts` naming collision are both worth a quick look before this is treated as
fully settled.
