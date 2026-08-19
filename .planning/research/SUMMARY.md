# Project Research Summary

**Project:** Temperance Engine v1.1 Public Temperance Glove
**Domain:** Downloadable, local-first AI-operator runtime installation and lifecycle management
**Researched:** 2026-08-19
**Confidence:** HIGH

## Executive Summary

Public Temperance Glove is not primarily a packaging refresh. It is the lifecycle and provenance layer that turns an already-working local operator system into a reproducible public product. Experts build this kind of product around one declarative inventory, a pure resolver/planner, a narrow transactional executor, platform-specific service adapters, append-only evidence, and clean-host qualification. The repository must remain the public source authority, while `ISA.md` remains the sole authority for accepted scope, criteria, decisions, and verification. The install-surface manifest is deliberately subordinate: it owns provenance and lifecycle mechanics only, never product acceptance, preferences, or runtime policy.

The recommended implementation is a pinned Bun 1.3.14, dependency-free TypeScript lifecycle core behind thin POSIX-shell entrypoints. A versioned JSON manifest and semantic validator feed the same resolver, inspector, planner, transaction engine, doctor, verifier, rollback, uninstall, tests, and factual documentation projections. Filesystem mutations are journaled before application; managed configuration is changed only through owned blocks or semantic projections; services are promoted in dependency order; receipts bind versions, digests, preimages, actions, health, and compensation. macOS is the release-blocking platform on both Apple Silicon and Intel lanes. Linux reuses the portable core and systemd adapter as visible best-effort evidence, but does not block v1.1.

The main risks are false convergence and unsafe authority expansion: packaging from a dirty or live workstation, weakening the existing path-hygiene guard, maintaining parallel inventories, shipping private runtime state, publishing or deleting the private `atlasRecall.ts` overlay, clobbering user configuration, or claiming reversibility without a complete transaction model. These risks determine the roadmap order. Freeze the baseline and ownership vocabulary first; build and validate the manifest and read-only plan next; converge public sources while keeping private state out; add transactional mutation and services only after the desired state is trustworthy; then synchronize documentation, qualify clean hosts, and finally prove the exact candidate from a clean Git tree. The existing `verify.sh` failure (`private local path found in public/install surface`) is therefore a source-convergence release blocker, not a warning to suppress.

## Evidence Classification

- **Primary-source facts:** Bun runtime support and version behavior, JSON Schema Draft 2020-12, GitHub-hosted runner labels/fresh-instance behavior, immutable GitHub Action SHA guidance, `git archive` behavior, launchd/LaunchAgent semantics, systemd validation and credentials, POSIX pathname behavior, XDG state separation, and artifact-attestation feasibility come from official specifications or vendor documentation cited below.
- **Repository-backed facts:** the v1.1 authority order, macOS/Linux support asymmetry, private-state boundary, private `atlasRecall.ts` decision, current lifecycle surfaces, existing verifier failure, documentation contradictions, and source/runtime drift come from `.planning/PROJECT.md`, the ratified audit, repository scripts, tests, and executed checks.
- **Repository inferences/recommendations:** the exact TypeScript module boundaries, seven-phase roadmap, transaction/receipt schema details, five architecture patterns, and decision to add no production dependency are synthesized design recommendations. They fit the repository and official platform constraints but still require phase-level tests and threat modeling.

## Key Findings

### Recommended Stack

Keep the existing public shell interface, but centralize lifecycle behavior in one typed core. No new production npm dependency, installer framework, configuration language, database, general templating engine, or checksum package is justified. The difficult problem is authoritative ownership and safe transaction semantics, not package acquisition.

**Core technologies:**

- **Bun 1.3.14, pinned:** executes the lifecycle TypeScript and `bun:test`; record both version and revision in release evidence.
- **POSIX `sh`:** retains thin `install.sh` and `uninstall.sh` bootstrap, platform detection, prerequisite reporting, and argument forwarding; it must not own inventory or mutation logic.
- **JSON manifest with product schema version 1:** declares stable IDs, repository-relative sources, destination-root tokens, `COPY`/`TRANSFORM`/`REGENERATE`/`NEVER-SHIP` class, mutability, platforms, optionality, verification, dependencies, rollback, and uninstall policy.
- **JSON Schema Draft 2020-12 plus a custom semantic validator:** schema supports editor/CI interoperability; TypeScript additionally rejects path escapes, destination collisions, class contradictions, cycles, and unsafe adapter combinations.
- **Dependency-free TypeScript lifecycle core:** provides manifest loading, resolution, inspection, deterministic planning, transaction execution, receipts, managed configuration, service adapters, and all lifecycle verbs.
- **Bun-compatible Node built-ins:** `node:fs`, `node:path`, `node:crypto`, and `node:child_process` provide atomic file operations, containment checks, portable SHA-256, and non-shell command invocation.
- **Native service managers:** checked-in parameterized LaunchAgent templates are authoritative for release-blocking macOS; systemd unit templates support best-effort Linux. Validate before promotion with `plutil -lint` and `systemd-analyze verify`.
- **Explicit CI platforms:** `macos-15` arm64 and `macos-15-intel` are release blockers; `ubuntu-24.04` publishes a non-blocking compatibility result. Pin GitHub Actions by reviewed full commit SHA.
- **Release tools:** ShellCheck 0.11.0 for CI-only shell analysis, `git archive` or a clean clone for exact-tree artifacts, and the existing `./scripts/verify-all.sh` as the sole top-level release verifier.

**Compatibility constraint:** keep the existing headless Node `>=22 <23` package boundary unchanged. Node 22 is not a new lifecycle prerequisite, and the lifecycle core must not import Manifest Zone, Manifest Bridge database dependencies, or other unrelated runtime packages.

### Expected Features

The complete behavior and operator-visible acceptance conditions are detailed in [FEATURES.md](./FEATURES.md). The table stakes are intentionally substantial because an incomplete installer would be unsafe rather than merely less polished.

**Must have (v1.1 table stakes):**

- Clean minimal, full-glove, and no-voice macOS installation from the exact tagged artifact or clean clone.
- Preflight that fails before mutation for missing required dependencies and clearly classifies optional ones.
- Explicit component/profile selection with `installed`, `skipped`, `unsupported`, and `failed` status.
- One versioned, complete install-surface provenance inventory used by every lifecycle command.
- Read-only human and machine-readable doctor output with source, destination, class, expected/actual evidence, status, and remediation.
- Idempotent install and managed-configuration preservation outside Temperance-owned blocks or semantic projections.
- Backup-first, version-aware update with required-service health gates and automatic reverse restoration on failure.
- Transaction-selectable rollback and receipt-driven, reversible, idempotent uninstall.
- Conservative default state retention; any purge is separate, target-enumerated, and never reaches provider or personal authority.
- Parameterized macOS service lifecycle with dependency-ordered stop/start and functional health checks.
- Best-effort Linux/no-launchd behavior with explicit, non-blocking compatibility evidence.
- Hard exclusion of credentials, provider sessions, databases, logs, histories, receipts, backups, personal PAI memory, developer paths, and `atlasRecall.ts` from public payloads.
- Documentation continuity driven by the stabilized CLI and manifest facts.
- Clean-clone release qualification binding tag, commit, artifact digest, manifest digest, platform/profile, skips, lifecycle results, and canonical verification.

**Should have (differentiators already justified for v1.1):**

- One provenance contract that changes install, doctor, verify, rollback, uninstall, tests, and docs together.
- Class-aware lifecycle behavior for immutable copies, deterministic transforms, host regeneration, and prohibited payload categories.
- Evidence-rich, redacted transaction receipts and drift-aware, non-mutating remediation guidance.
- Strong separation between product source, installed program material, mutable host state, and private/provider authority.
- Manifest-derived documentation facts with human-authored guidance.
- Honest asymmetric platform results instead of either silent Linux failure or unearned parity.

**Defer until after v1.1 validation:**

- Artifact attestation, richer receipt history/pruning, more Linux service managers, and package-manager distribution belong in later v1.x only after direct lifecycle semantics stabilize.
- Linux release parity, alternative distribution shells, and generic recall enrichment are v2+ considerations, not commitments.
- A GUI/notarized wrapper, cloud control plane, accounts, telemetry, silent self-update, repair-on-doctor, or whole-file configuration replacement are anti-features for this milestone.
- `atlasRecall.ts` remains a private overlay until a later milestone independently proves generic inputs, fixtures, and privacy safety.

### Architecture Approach

Use a **functional core with an imperative shell**. `ISA.md` accepts product behavior; repository source supplies public bytes and templates; the manifest describes how approved sources land; a pure resolver/inspector/planner computes desired-versus-observed actions; and a narrow executor applies an immutable plan under a transaction lock. Receipts are evidence of one invocation, never desired-state authority. Public/runtime/private roots remain physically and semantically separate, and no live host file may promote itself into desired state.

**Major components:**

1. **Install-surface manifest and validator** — define provenance-only records and reject incomplete, duplicate, unsafe, cyclic, or `NEVER-SHIP`-contradicting entries before any write.
2. **Host/profile resolver and inspector** — select Darwin/Linux and explicit profiles, expand only allowlisted roots, and make read-only provenance observations.
3. **Deterministic planner** — generate ordered actions and skips shared by dry-run, doctor, verify, and mutating commands.
4. **Transaction executor and receipt store** — persist preimages and compensation before mutation, atomically promote staged bytes, verify health/provenance, reverse failures, and write append-only evidence under private modes.
5. **Class and managed-configuration adapters** — implement class-specific copy, transform, regeneration, absence, ownership, digest, rollback, and uninstall semantics without executable commands in JSON.
6. **Darwin and Linux service adapters** — render/validate templates, preserve manager state, stop dependents first, start dependencies first, and perform functional health checks.
7. **Lifecycle command adapters** — keep install/update/rollback/uninstall thin and make doctor/verify consume the same read-only observations.
8. **Documentation projection and qualification harness** — generate factual inventory/CLI fragments and prove the exact artifact on clean hosts while keeping authored rationale under review.

**Key patterns:**

- Journal every mutation before application and compensate in reverse dependency order.
- Use exact managed blocks or semantic ownership, never whole-file ownership by convenience.
- Produce evidence as a first-class product output, including failures and recovery-required states.
- Generate facts from the manifest/CLI while keeping guidance authored.
- Keep repository/product source, installed program surfaces, `$TEMPERANCE_STATE_DIR`, and provider/private roots separate.

### Critical Pitfalls

1. **False baseline authority** — freeze commit, dirty-state disposition, milestone, exclusions, and platform promise before generating the manifest; never scrape a moving workstation as product truth.
2. **Private workstation leakage** — package only from a positive repository allowlist and exact Git tree; scan the final artifact for private paths, secrets, databases, logs, histories, backups, receipts, escaping links, and private overlays.
3. **`atlasRecall.ts` mishandling** — keep it out of Git artifacts, install inventory, generated docs, fixtures, and immutable checks; load only from a separately configured private overlay that public refresh neither ingests nor deletes.
4. **Weakening the red path guard** — classify paths by executable payload, synthetic fixture, historical evidence, and generated/vendor role. The current `verify.sh` failure must be repaired through source convergence and scoped policy, not broad exclusions.
5. **Parallel ownership inventories** — reject duplicate and overlapping destinations, instrument observed sandbox writes, and make all lifecycle commands consume the same resolved manifest.
6. **Unsafe filesystem/configuration mutation** — use `lstat`, no-follow/containment rules, hardlink refusal, staged same-directory writes, atomic rename, explicit modes, exact managed ownership, and adversarial path fixtures.
7. **Backups without transaction identity** — bind every preimage, prior absence, permission, service state, and completed step to a unique journal before mutation; rollback and uninstall must preserve drift rather than guess.
8. **Service and platform false positives** — validate definitions before stopping working services, promote in dependency order, require functional health, exercise stock macOS paths, and publish Linux limitations explicitly.
9. **Checksum and documentation overclaims** — use class-specific provenance and complete tree semantics; execute safe documented commands instead of proving only that expected words exist.
10. **Dirty-tree or in-place release proof** — release only from a clean candidate tree and install the built artifact into an empty home; source-checkout success is not artifact qualification.

## Implications for Requirements

Roadmap requirements should be phrased as operator-observable invariants, not implementation task completion:

- **Authority:** `ISA.md` remains the acceptance judge; GSD organizes ratified work; the manifest cannot add product scope.
- **Inventory closure:** every observed public install mutation maps to exactly one stable manifest record, and every required record is observed in qualification.
- **Privacy:** public source and artifacts contain no private runtime state or `atlasRecall.ts`; lifecycle commands neither recursively read nor mutate provider/private roots.
- **Path safety:** manifest resolution and filesystem operations cannot escape declared roots through absolute paths, traversal, symlinks, hardlinks, parent swaps, or unsafe recursive deletion.
- **Transactional safety:** every mutation has persisted compensation; required health failure restores prior file/config/service state; drift blocks destructive rollback or uninstall.
- **Configuration preservation:** bytes or semantics outside Temperance ownership survive install, update, rollback, and uninstall.
- **Platform policy:** required macOS lanes block promotion; Linux results remain visible and non-blocking for v1.1.
- **Evidence:** doctor is read-only; receipts are redacted and private by default; release evidence binds the exact candidate and preserves failures rather than overwriting them.
- **Verification convergence:** the existing path-hygiene failure closes during source convergence, and `./scripts/verify-all.sh` remains the canonical release gate.

## Implications for Roadmap

Based on combined research, use seven dependency-ordered phases. These phases preserve the ratified Intake/A–F structure while giving each phase a binary deliverable.

### Phase 1: Baseline and Authority Freeze (Intake)

**Rationale:** A manifest built from an unreconciled checkout can be internally consistent and still describe the wrong product.

**Delivers:** A reviewed baseline receipt naming the commit, dirty-state disposition, active milestone, authority order, lifecycle vocabulary, private-state boundary, macOS/Linux promise, and private-overlay decision.

**Addresses:** exact-candidate identity and reviewable release slicing prerequisites.

**Avoids:** moving-baseline drift, audit snapshots becoming silent authority, and accidental scope expansion.

### Phase 2: Provenance Contract and Read-Only Control Plane (Stage A)

**Rationale:** Ownership, path, class, permission, service-dependency, and rollback semantics must exist before source import or mutation.

**Delivers:** Manifest schema v1, semantic validator, complete current-surface inventory, closed adapter registry, safe resolver, inspector, deterministic planner, human/JSON observation model, and classified path-policy findings.

**Addresses:** versioned inventory, optional-component semantics, dry-run, explainable doctor foundation, private-boundary rules, and release-policy encoding outside provenance.

**Avoids:** duplicate destinations, executable manifest entries, manifest-as-second-ISA, unsafe paths, wrong checksum semantics, and parallel inventories.

### Phase 3: Public Source Convergence (Stage B)

**Rationale:** A safe engine must not faithfully install incomplete, private-coupled, or workstation-specific payloads.

**Delivers:** Reconciled public router, hooks, Manifest Bridge/Zone, enrichment, and complete skill packages; explicit private overlay separation; artifact/private scans; and a green, role-aware `verify.sh` path-hygiene gate.

**Addresses:** clean-source payload completeness, private-state exclusion, and preservation of existing runtime behavior without redesign.

**Avoids:** copying the reference home, publishing or deleting `atlasRecall.ts`, broad path-guard suppressions, and live-only capability becoming accidental product scope.

### Phase 4: Transactional Lifecycle and Platform Services (Stage C)

**Rationale:** Mutation begins only after desired state and public bytes are trustworthy; file transactions must work before service orchestration compounds rollback risk.

**Delivers:** Thin shell entrypoints; journal/receipt store; atomic `COPY`, managed `TRANSFORM`, and `REGENERATE` adapters; idempotent install; backup-first update; health-gated compensation; selectable rollback; reversible uninstall; explicit permissions; Darwin LaunchAgent lifecycle; and best-effort Linux systemd behavior.

**Addresses:** most v1.1 table stakes and the receipt/provenance differentiators.

**Avoids:** whole-file config ownership, link/path escapes, ambiguous backups, partial uninstall, unsafe modes, wrong service order, swallowed failures, and shell/platform divergence.

### Phase 5: Documentation as a Verified Interface (Stage D)

**Rationale:** Documentation should stabilize after public lifecycle commands, while generated facts must remain subordinate to the manifest rather than becoming another inventory.

**Delivers:** Synchronized README, Quickstart, architecture, rollback, security, contributing, changelog, docs index/site; deterministic manifest/CLI-derived fragments; and executable continuity checks for public commands and safe examples.

**Addresses:** documentation continuity and transparent platform/optional-component status.

**Avoids:** obsolete commands, wording-only tests, contradictory reversibility claims, and generated documentation becoming an acceptance authority.

### Phase 6: Clean-Host Qualification and Failure Rehearsal (Stage E)

**Rationale:** Unit and sandbox tests from a working checkout cannot prove artifact portability, recovery, or platform behavior.

**Delivers:** Artifact-based empty-home macOS minimal/full/no-voice install; doctor/verify/update/injected-failure/rollback/uninstall sequences; adversarial path/config/permission fixtures; release-blocking arm64/x64 results; and visible Linux best-effort receipts.

**Addresses:** clean install, automatic restoration, exact transaction rollback, reversible uninstall, platform qualification, and evidence-rich receipts.

**Avoids:** hidden host dependencies, optional services becoming required, path escape, incomplete restoration, false service health, and Linux parity overclaim.

### Phase 7: Reviewable Release and Exact-Candidate Proof (Stage F)

**Rationale:** Promotion evidence is valid only when it describes the clean, reviewable Git tree and downloadable bytes being released.

**Delivers:** Five focused review slices, clean integration tree, deterministic tagged artifact, final private/path/provenance scan, fresh-clone canonical verification, artifact lifecycle receipt, and explicit human approval under ISA criteria.

**Addresses:** release identity/integrity, clean-clone qualification, canonical verification, and publication evidence.

**Avoids:** dirty-worktree contamination, monolithic review, receipts from a different commit, and release-ready claims without exact-artifact proof.

### Phase Ordering Rationale

- Authority and negative boundaries precede inventory; inventory and read-only planning precede source convergence; trustworthy source precedes mutation.
- File/config transactions precede service promotion; Darwin is proven before Linux reuses the shared contract because macOS is the v1.1 release target.
- Lifecycle commands stabilize before factual docs generation; qualification exercises those public commands before final release slicing.
- Clean-host fixtures and receipt schemas should be introduced early as test scaffolding, but only the assembled exact candidate can satisfy the final release gate.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2:** threat-model the exact manifest fields, managed-block grammar, path containment, directory digest semantics, and duplicate/overlap rules; official primitives are known, but repository-specific policy is not fully named.
- **Phase 4:** spike `launchctl` lifecycle permissions on both hosted macOS runner variants and finalize crash recovery, fsync/rename, service-state restoration, and JSON/TOML semantic ownership behavior.
- **Phase 6:** determine whether hosted macOS can execute the full service lifecycle. If not, design an ephemeral clean-mac release runner without weakening the release criterion.

Phases with established patterns or repository-complete evidence (skip broad research-phase; use focused implementation validation):

- **Phase 1:** authority and baseline decisions are already locked in project artifacts.
- **Phase 3:** work is repository-specific source reconciliation governed by the ratified audit and classified inventory.
- **Phase 5:** deterministic projection plus authored guidance is a well-established pattern; focus on executable continuity coverage.
- **Phase 7:** clean-tree checks, `git archive`, artifact digests, immutable action references, and fresh-clone verification are documented patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Bun, JSON Schema, Node crypto, CI runners, Git archive, launchd, systemd, and ShellCheck claims are grounded in official sources; hosted-runner service permissions remain to be spiked. |
| Features | HIGH for v1.1 scope; MEDIUM for ecosystem comparison | Milestone boundaries and lifecycle acceptance come directly from project authorities; Homebrew/rustup comparisons establish expectations but do not prescribe Temperance architecture. |
| Architecture | HIGH for boundaries/order; MEDIUM-HIGH for exact schema | Authority separation and integration points are repository-grounded; module names, receipt fields, and managed-block grammar remain implementation recommendations. |
| Pitfalls | HIGH | Findings combine concrete repository behavior, the executed red verifier, the ratified audit, and official path/service specifications. |

**Overall confidence:** HIGH

### Gaps to Address

- **Hosted macOS service control:** verify full LaunchAgent bootstrap/kickstart/print/bootout behavior on both blocking runner architectures; provision a clean ephemeral Mac lane if hosted restrictions prevent meaningful service proof.
- **Manifest v1 details:** finalize class-specific required fields, destination-overlap rules, service DAG shape, mode/owner policy, managed-block identity, and schema migration behavior through negative fixtures.
- **Safe filesystem edge cases:** validate parent-swap resistance, no-follow primitives, atomic replacement/fsync behavior, hardlink refusal, and cross-filesystem boundaries on supported hosts.
- **Exact Linux destination policy:** align best-effort destinations with XDG conventions during phase planning without turning Linux into a v1.1 blocker.
- **Receipt retention:** deterministic rollback is required now; pruning and multi-version history UX should wait for observed usage.
- **Attestation priority:** technically feasible, but defer until the downloadable artifact and canonical workflow are stable enough that the attestation cannot bind ambiguous bytes.

## Sources

### Repository authorities and executed evidence (HIGH confidence)

- [`.planning/PROJECT.md`](../PROJECT.md) — milestone goal, authority order, macOS/Linux policy, privacy boundary, private overlay decision, and existing path-hygiene blocker.
- [`STACK.md`](./STACK.md), [`FEATURES.md`](./FEATURES.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), and [`PITFALLS.md`](./PITFALLS.md) — full research and source annotations synthesized here.
- [`docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md`](../../docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md) — ratified publication map, lifecycle stages, verification matrix, drift findings, and release slices.
- Repository lifecycle, service, verifier, sandbox, and documentation scripts cited in the four reports — current behavior and convergence gaps. `./verify.sh` was executed during research and exited 1 at the private local path guard.

### External primary/official references (HIGH confidence unless noted)

- [Bun installation documentation](https://bun.sh/docs/installation) — Bun 1.3.14 pinning, revision readback, architectures, and macOS baseline.
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) — structural schema vocabulary.
- [Node.js Crypto API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) — built-in SHA-256 API; full Bun behavior remains subject to product CI.
- [GitHub-hosted runner selection](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job) and [custom action version guidance](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions) — runner labels/fresh instances and immutable full-SHA action references.
- [Git archive documentation](https://git-scm.com/docs/git-archive) — exact-tree artifact and embedded commit behavior.
- [Apple launchd guidance](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — per-user LaunchAgent model; archived guidance is MEDIUM-HIGH and implementation should also consult current host man pages.
- [systemd credentials](https://github.com/systemd/systemd/blob/main/docs/CREDENTIALS.md) and [systemd-analyze](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html) — credential boundaries and unit validation.
- [POSIX pathname resolution](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html#tag_04_16) — absolute/relative paths, traversal, and symbolic-link semantics.
- [XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/0.8/) — Linux config/data/state/cache/runtime separation.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) — feasibility and verification requirement for deferred release attestation.
- [Homebrew FAQ](https://docs.brew.sh/FAQ) and [rustup documentation](https://rust-lang.github.io/rustup/) — secondary comparison for explicit update/uninstall and host-state coexistence, not architecture authority.

---
*Research completed: 2026-08-19*
*Ready for roadmap: yes*
