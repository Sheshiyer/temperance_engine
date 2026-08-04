# Vault Project Relocation Implementation Plan

> **Planning-only boundary:** Both registry locations are ratified. Do not execute this plan until the user reviews a real read-only inventory, selects one canary, and separately approves that canary's exact manifest digest.

**Goal:** Relocate only approved `thoughtseed` and `tryambakam-noesis` working repositories into `/Volumes/madara/2026/Projects/<portfolio>/<repository>` while preserving Git bytes, durable knowledge links, portable project pickup, and deterministic rollback. Native sessions and Paseo are not migration dependencies.

**Architecture:** A pure TypeScript inventory and policy layer creates a closed-schema plan. Each repository carries one portable project packet for Codex, Claude, OpenCode, or Kimi. A receipt-bound transaction may rename exactly one same-device standalone repository after explicit digest approval, verify it, write the correct portfolio registry record, create a compact old-path capsule, and certify a fresh-client pickup without importing a transcript.

**Tech stack:** Bun/TypeScript, Git plumbing, POSIX filesystem primitives, strict YAML/JSON schemas, fixture repositories, Markdown packet renderers.

## Global Guardrails

- Treat `thoughtseed` and `tryambakam-noesis` as the exact portfolio allowlist.
- Treat every other folder as immutable and out of scope.
- Pin Thoughtseed Labs at its current path.
- Do not create destination portfolio directories before an approved apply needs them.
- Do not read, copy, modify, reconcile, or require native provider-session stores.
- Do not modify Paseo or make it an acceptance dependency.
- Do not change Hermes, Cambium, TeamForge, TN Paperclip, Kimiclaw, Snow Gloves, Selemene, Cloudflare, Tauri, cron, provider, or secret state.
- Never run network Git, history-rewrite, garbage-collection, or pruning operations.
- Preserve unrelated working-tree changes; do not stage or commit `_PROJECT-STATUS.md`.
- Keep Thoughtseed and Tryambakam identity, secrets, knowledge, and execution authorities isolated.

## Task 1: Encode Scope and Authority Policy

**Files:**

- Create: `package/relocation/project-relocation-policy.ts`
- Create: `package/relocation/project-relocation-policy.test.ts`
- Create: `tests/fixtures/project-relocation/scope/`

### Tests first

Prove that only these destinations resolve:

```ts
expect(resolveDestination("thoughtseed", "temperance_engine")).toBe(
  "/Volumes/madara/2026/Projects/thoughtseed/temperance_engine",
);
expect(resolveDestination("tryambakam-noesis", "Selemene-engine")).toBe(
  "/Volumes/madara/2026/Projects/tryambakam-noesis/Selemene-engine",
);
expect(() => resolveDestination("other", "repo")).toThrow("portfolio_not_allowed");
```

Also reject traversal, absolute repository names, symlink escape, non-canonical spellings, source paths outside the two portfolios, Thoughtseed Labs, cross-portfolio registry references, and authority profiles that mix Thoughtseed and TN.

Run: `bun test package/relocation/project-relocation-policy.test.ts`

Expected: PASS only after the minimum pure policy exists.

## Task 2: Build Read-Only Repository Inventory

**Files:**

- Create: `package/relocation/project-relocation-inventory.ts`
- Create: `package/relocation/project-relocation-inventory.test.ts`
- Create: `scripts/vault-project-relocation.ts`
- Create: `tests/fixtures/project-relocation/inventory/`

Classify standalone repositories, linked worktrees, nested repositories, pinned knowledge vaults, plain directories, unsafe symlinks, dirty repositories, missing remotes, and destination collisions. Capture canonical path, kind, Git common directory, HEAD, branch, refs digest, remotes, porcelain-v2 digest, worktree graph, submodules, LFS state, deterministic untracked/ignored inventories, device number, proposed portfolio, mapping evidence, mapping ambiguity, and proposed destination.

Source parent names are evidence, not authority. Hold `snow-gloves-os`, `10869`, personal/mixed-lineage surfaces, and every path/packet/knowledge disagreement until the owner approves an explicit repository-to-portfolio mapping.

Inventory must not inspect arbitrary contents, dependency trees, caches, provider homes, session stores, Paseo, secrets, or remote Git state.

Expose only:

```text
bun scripts/vault-project-relocation.ts inventory \
  --portfolio thoughtseed \
  --portfolio tryambakam-noesis \
  --output <owner-only-report.json>
```

The report uses a mode-`0700` directory and a mode-`0600` file. Unknown commands and additional portfolios fail closed.

Run: `bun test package/relocation/project-relocation-inventory.test.ts`

## Task 2A: Build a Bounded Old-Path Consumer Audit

**Files:**

- Create: `package/relocation/project-path-consumers.ts`
- Create: `package/relocation/project-path-consumers.test.ts`
- Create: `tests/fixtures/project-relocation/path-consumers/`

Search checked-in text and an explicit allowlist of host configuration surfaces for the exact canonical source path and approved aliases. Classify repository config/scripts, Git worktree administration, submodules, MCP/client project config, hooks, launchd/systemd, deploy scripts, sync jobs, documentation, and cross-repository references.

Never traverse provider transcript/session databases, credentials, caches, dependency trees, or arbitrary home directories. A runtime consumer without a separately approved cutover rule holds the repository. Serialize the bounded search roots, patterns, exclusions, matches, and unresolved consumers into the canary manifest.

Run: `bun test package/relocation/project-path-consumers.test.ts`

## Task 3: Define the Portable Packet Schema

**Files:**

- Create: `package/relocation/project-packet-schema.ts`
- Create: `package/relocation/project-packet-schema.test.ts`
- Create: `package/relocation/project-packet.ts`
- Create: `package/relocation/project-packet.test.ts`
- Create: `tests/fixtures/project-relocation/packet/`

Require these canonical packet files:

- `PROJECT.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.project/CONTEXT.md`
- `.project/project.yaml`
- `.project/HANDOFF.md`

Validate a closed `project.yaml` schema containing stable ID, portfolio, repository/GitHub identity, knowledge reference, governance profile, approval gates, routing authority, portfolio-specific deployment profile, secretless credential-scope reference, verification state, optional `te-*` lanes, setup/test/verify commands, and ordered context files. A Thoughtseed ID must match TeamForge or the repository remains held. A TN routing profile remains unverified until its endpoint, config namespace, and credential authority are proved TN-local.

Reject secrets, tokens, credentials, native-session identifiers, provider account data, prompt/response bodies, transcript locators, machine-local checkout paths, dependency state, unknown keys, and cross-portfolio authority. `CONTEXT.md` contains bounded invariants and canonical knowledge pointers, never copied corpora or live task history. Existing rich `AGENTS.md` or `CLAUDE.md` files must be reported for review rather than overwritten.

Packet authoring is a separately reviewed repository change before migration approval. The relocation transaction treats the complete packet as read-only input and preserves its digest; it never creates or edits packet files inside the checkout.

Run: `bun test package/relocation/project-packet-schema.test.ts package/relocation/project-packet.test.ts`

## Task 4: Define Portfolio Registry and Capsule Schemas

**Files:**

- Create: `package/relocation/project-registry.ts`
- Create: `package/relocation/project-registry.test.ts`
- Create: `package/relocation/project-capsule.ts`
- Create: `package/relocation/project-capsule.test.ts`
- Create: `tests/fixtures/project-relocation/capsule/`

Bind each portfolio to its ratified knowledge authority:

- Thoughtseed → `thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed/<repository>/`
- Tryambakam → `/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/<repository>/`

The transaction is the sole writer and selects exactly one registry from the packet's `portfolio`. A duplicate stable ID or GitHub identity in the other registry fails before mutation; no precedence or automatic merge exists.

The selected registry repository must be clean or have an owner-approved exact baseline and non-overlapping entry path. Because `_System/10865xseed` is currently reported dirty, TN apply stays held until that baseline is resolved. The registry entry, old capsule, and owner-only receipt are explicit approved mutation exceptions; every other byte remains unchanged.

Thoughtseed registry entries are keyed by verified TeamForge `project_id` and append a `reconciling` transition event. Displayed status is derived from the append-only event log. After all repository acceptance gates pass, merge only current operational facts into the canonical main project-management record, add a content-addressed `relocation_evidence_ref` (`sha256:<digest>`), and store its resolvable path separately. Read back that record, bind its digest into a closure manifest, then append a `reconciled` transition with tool actor, owner ratifier, `closed_at`, `canonical_project_record`, and `closure_manifest_digest`.

The closed Thoughtseed registry entry retains historical source/destination paths, owner ratification, integrity evidence, receipts, and rollback evidence. Verify repository identity through HEAD and canonical ref-set equality plus explicit untracked/ignored-file digests, never Git packfile bytes. Freeze the evidence through a reviewed Git closure commit plus entry/manifest SHA-256 digests. Do not delete, move, flatten, or silently rewrite it. Later re-verification or supersession appends a new event. Tryambakam records remain TN-local and do not merge into Thoughtseed project management.

Render a six-file old-path capsule containing `PROJECT.md`, `project-links.md`, `data/project.yaml`, `handoffs/relocation.md`, `handoffs/integrity-manifest.json`, and `handoffs/rollback.md`.

Require exact registry and packet digest backlinks plus lossless closure-manifest fixtures. Reject `.git`, provider state, native session metadata, transcript content, credentials, dependency outputs, portfolio-external authority, and any closed-entry deletion or in-place historical rewrite.

Run: `bun test package/relocation/project-registry.test.ts package/relocation/project-capsule.test.ts`

## Task 5: Add Deterministic Plan and Dry-Run

**Files:**

- Create: `package/relocation/project-relocation-plan.ts`
- Create: `package/relocation/project-relocation-plan.test.ts`
- Modify: `scripts/vault-project-relocation.ts`
- Create: `tests/vault-project-relocation.test.ts`

Generate byte-identical plans for identical inventories. A plan names exactly one repository, one proposed same-device rename, its authority profile, old-path consumer manifest, registry-conflict result, pre-existing packet digest, six capsule files, verification probes, and rollback steps.

Add:

```text
bun scripts/vault-project-relocation.ts plan \
  --repository <absolute-source-path> \
  --dry-run \
  --output <owner-only-manifest.json>
```

Hash source, destination, Git, portfolio registry, and fixture provider/Paseo stores before and after the test. Assert exact equality. The dry-run may write only its mode-`0600` manifest.

Run: `bun test package/relocation/project-relocation-plan.test.ts tests/vault-project-relocation.test.ts`

## Approval Boundary A: Review the Real Inventory

Run only the read-only inventory against the two approved portfolios. Review repository classifications, dirty state, worktrees, nested repositories, collisions, remotes, GitHub identities, and path consumers.

Hold `hermes-aws-ts`, the dirty `_System/10865xseed` seed, ambiguous Snow Gloves/`10869` portfolio mappings, linked Snow Gloves worktrees, and any repository with systemd, runtime, sync, build, deployment, or companion-document path dependencies. Recommend one low-coupling, clean standalone canary. Do not expose live apply until the user approves the inventory, repository-to-portfolio mapping, canary, and manifest contract.

## Task 6: Implement Receipt-Bound Rename

**Files:**

- Create: `package/relocation/project-relocation-transaction.ts`
- Create: `package/relocation/project-relocation-transaction.test.ts`
- Modify: `scripts/vault-project-relocation.ts`
- Extend: `tests/vault-project-relocation.test.ts`
- Create: `tests/fixtures/project-relocation/transaction/`

Require exact manifest digest, exclusive lock, one standalone candidate, same device, destination absence, unchanged source and Git preflight digests, valid authority profile, zero competing registry claims, an approved path-consumer manifest, and a validated pre-existing packet digest.

Inject failure before and after every mutation point. Verify either exact automatic recovery or a held state with explicit instructions. Implement one atomic same-filesystem POSIX rename, then Git/filesystem verification, portfolio registry creation, old capsule creation, live pickup, Thoughtseed main-record projection when applicable, and registry closure. Immediately before rename, re-read the canonical parent paths plus source device/inode and reject any mismatch; re-read them again after rename. The threat model excludes a hostile privileged or same-user process racing outside the relocation lock; test source replacement and parent/path-swap attempts explicitly. Do not create or edit repository packet files. Stage, commit, push, launch, import, and reconcile nothing automatically.

Linked worktrees and nested repositories remain rejected until graph-specific plans are separately approved.

Run: `bun test package/relocation/project-relocation-transaction.test.ts tests/vault-project-relocation.test.ts`

## Task 7: Implement Packet Resolution and Define Live Pickup

**Files:**

- Create: `package/relocation/project-pickup.ts`
- Create: `package/relocation/project-pickup.test.ts`
- Create: `tests/fixtures/project-relocation/pickup/`

Build a pure bootstrap resolver that starts from a fixture checkout, validates packet digests, resolves only allowlisted context files, and emits a bounded client-neutral bootstrap. Client adapters may select Codex, Claude, OpenCode, or Kimi; OmniRoute metadata may select a routing profile and lane but cannot create or recover a native session.

The resolver contract uses no provider or transcript input and demonstrates that it can report the stable ID, portfolio, objective, branch/base commit, completed state, next action, blocker, and verification command. This fixture does not certify a real client.

Live acceptance is a separate post-move canary: start one approved real client with its normal authentication/runtime configuration, no resume/import/session identifier, and no prior project transcript. Require it to report the same stable ID and next action as the pure resolver. A live Kimi/Claw routed-execution proof remains held while the TN deployment profile is unverified; packet pickup may still be proved with Codex or Claude.

Run: `bun test package/relocation/project-pickup.test.ts`

## Task 8: Implement Drift-Safe Rollback

**Files:**

- Create: `package/relocation/project-relocation-rollback.ts`
- Create: `package/relocation/project-relocation-rollback.test.ts`
- Modify: `scripts/vault-project-relocation.ts`
- Extend: `tests/vault-project-relocation.test.ts`

Delete only transaction-generated files whose paths and digests match the receipt. Remove only generated empty directories. Rename the repository back and verify the preflight state.

Registry drift, capsule drift, destination drift, old-path collisions, unexpected files, missing receipt, committed registry records, and worktree inconsistencies must fail without removing bytes.

Run: `bun test package/relocation/project-relocation-rollback.test.ts tests/vault-project-relocation.test.ts`

## Task 9: Documentation and Verification Gate

**Files:**

- Create: `docs/vault-project-relocation.md`
- Modify: `scripts/verify-all.sh`
- Modify: `ISA.md`

Document the authority split, inventory, packet, dry-run, exact approval digest, portfolio registries, capsule, fresh-client pickup, rollback, pinned vault, and separately deferred outer-vault Git cleanup.

Add focused policy, inventory, path-consumer, packet, registry, capsule, plan, transaction, pickup, rollback, and CLI tests to `scripts/verify-all.sh`.

Source guards must prove that production relocation code contains no provider-home traversal, Paseo import/reconciliation, network Git, history rewrite, credential access, transcript access, cross-portfolio authority, or automatic staging/commit/push.

Run: `scripts/verify-all.sh`

Expected final line: `Temperance Engine full verification passed`.

## Approval Boundary B: Apply One Live Canary

Present and seek explicit approval for:

- exact source and destination;
- portfolio, stable ID, GitHub identity, and knowledge authority;
- dirty/untracked/ignored status;
- worktree, submodule, LFS, and path-consumer classification;
- exact old-path consumer manifest and held/remediated result;
- exact packet digest and validation conflicts;
- manifest SHA-256;
- exact registry path and expected digest;
- exact six-file capsule;
- pure resolver result and exact live-client pickup procedure;
- rollback command and refusal conditions.

Apply only that digest-approved canary. Do not begin another repository in the same approval.

## Separately Planned Work

- remaining repositories and graph-dependent worktrees;
- Thoughtseed companion-document updates if Codex becomes a durable named control surface;
- TN Kimiclaw/Tauri/Paperclip/Snow Gloves/Selemene implementation;
- Paseo re-indexing after paths stabilize;
- native-session import experiments, if ever desired;
- every other portfolio;
- historical outer-vault pack analysis, compaction, or history rewrite.
