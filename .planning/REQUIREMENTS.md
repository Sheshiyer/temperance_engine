# Requirements: Temperance Engine v1.1 Public Temperance Glove

**Defined:** 2026-08-19
**Core value:** A person can download one public Temperance Engine artifact, install a chosen local glove safely, understand every managed surface, and reverse every lifecycle action without importing the maintainer's private machine state.

## Milestone Scope

v1.1 turns the public repository into the source authority for a reproducible local installation. The Mac mini is a reference installation and migration input, never a publishable source of truth. macOS on Apple Silicon and Intel is release-blocking; Linux support is best-effort and must fail or skip honestly.

## v1.1 Requirements

### Authority and Inventory

- [ ] **PROV-01** — A maintainer can validate the versioned installation-manifest schema before any lifecycle action runs.
- [ ] **PROV-02** — Every included installed surface resolves to exactly one stable manifest record with an owner and classification.
- [ ] **PROV-03** — Manifest validation rejects duplicate or overlapping destination ownership before mutation.
- [ ] **PROV-04** — Manifest sources are repository-relative and destinations use allowlisted root tokens rather than workstation-specific absolute paths.
- [ ] **PROV-05** — Semantic validation rejects path escapes, dependency cycles, contradictory classifications, and unsafe adapter combinations.
- [ ] **PROV-06** — Install, update, doctor, verify, rollback, and uninstall consume the same resolved inventory.
- [ ] **PROV-07** — Manifest entries cannot expand the public product beyond the explicitly ratified ISA and milestone scope.

### Installation and Profiles

- [ ] **INST-01** — Users can select documented `minimal`, `full`, and `no-voice` profiles whose contents are explicit before installation.
- [ ] **INST-02** — A user can complete a clean macOS install from the exact release artifact or clean release checkout.
- [ ] **INST-03** — Preflight detects missing required dependencies and exits before changing the target machine.
- [ ] **INST-04** — Missing optional dependencies produce visible skips, while explicitly selecting an unavailable optional capability fails with actionable guidance.
- [ ] **INST-05** — Every profile entry reports `installed`, `skipped`, `unsupported`, or `failed` in human-readable and machine-readable output.
- [ ] **INST-06** — Repeating an identical install does not duplicate managed blocks, links, services, PATH entries, or other owned state.
- [ ] **INST-07** — Installation preserves user-authored configuration outside Temperance-owned blocks and records each owned block.

### Doctor and Provenance

- [ ] **DOCT-01** — Users can run a read-only doctor command that explains installation and health in human-readable form.
- [ ] **DOCT-02** — Automation can request the same doctor observations as stable JSON without triggering repair.
- [ ] **DOCT-03** — Each doctor entry reports source, destination, class, expected state, actual state, status, and remediation.
- [ ] **DOCT-04** — Drift produces an explicit `DRIFT` result or non-zero exit without modifying the machine.
- [ ] **DOCT-05** — Doctor distinguishes required failures from optional skips and unsupported platform capabilities.

### Transactional Lifecycle

- [ ] **LIFE-01** — The lifecycle executor writes a compensation journal before each mutation it performs.
- [ ] **LIFE-02** — Update creates backups first and binds the transaction to before-and-after version and manifest digests.
- [ ] **LIFE-03** — Managed files are staged and promoted atomically within the destination filesystem while preserving declared modes.
- [ ] **LIFE-04** — A failed required health check automatically restores files, configuration, and service state from the transaction journal.
- [ ] **LIFE-05** — Users can select a retained transaction and restore its exact preimage and service state.
- [ ] **LIFE-06** — Rollback and uninstall refuse destructive changes when unrecognized drift makes ownership ambiguous.
- [ ] **LIFE-07** — Uninstall restores pre-existing content, removes only owned artifacts, and becomes a no-op when safely repeated.
- [ ] **LIFE-08** — Receipts describe actions, failures, and restoration outcomes while redacting private values and modes.

### Platform and Services

- [ ] **PLAT-01** — launchd definitions are rendered from parameterized templates and validated before promotion.
- [ ] **PLAT-02** — Service transitions stop dependents before dependencies and start dependencies before dependents.
- [ ] **PLAT-03** — Release-blocking service checks use functional probes rather than process-presence checks alone.
- [ ] **PLAT-04** — Apple Silicon and Intel macOS qualification lanes must pass before a v1.1 release.
- [ ] **PLAT-05** — Linux uses a best-effort adapter, never invokes launchd tooling, and reports unsupported or non-blocking gaps explicitly.

### Privacy and Filesystem Safety

- [ ] **SAFE-01** — Release packaging starts from a positive repository allowlist that can be printed and reviewed as an exact candidate inventory.
- [ ] **SAFE-02** — Release artifacts exclude credentials, private databases, logs, histories, receipts, backups, personal memory, private atlases, and `atlasRecall.ts`.
- [ ] **SAFE-03** — Lifecycle commands never recursively traverse provider caches, private state roots, or personal memory roots.
- [ ] **SAFE-04** — Path resolution rejects absolute manifest sources, traversal, and destinations outside allowlisted roots.
- [ ] **SAFE-05** — Symlink, hardlink, parent-swap, and unexpected path-type hazards fail closed before mutation.
- [ ] **SAFE-06** — Recursive deletion is prohibited; removal targets are explicitly enumerated from verified ownership records.
- [ ] **SAFE-07** — Verification applies classification-aware checksum rules to copied, transformed, generated, and private-overlay surfaces.

### Documentation and Release Qualification

- [ ] **RELS-01** — README and Quickstart document commands that users can copy to install, inspect, verify, update, rollback, and uninstall safely.
- [ ] **RELS-02** — Architecture, rollback, security, and contributing documentation match the manifest and lifecycle behavior.
- [ ] **RELS-03** — Factual inventories are generated or validated from the manifest while explanatory guidance remains intentionally authored.
- [ ] **RELS-04** — The existing `verify.sh` private-path guard passes before release; no maintainer-specific absolute path remains in the public candidate.
- [ ] **RELS-05** — Sandbox qualification covers clean `minimal`, `full`, and `no-voice` installs plus update, rollback, and uninstall.
- [ ] **RELS-06** — Release qualification starts from a clean tree and binds the tag, commit, artifact, and manifest digests.
- [ ] **RELS-07** — The milestone lands as five reviewable commit slices, passes the canonical verification suite, has no open Critical/P0/P1 findings, and receives human approval.

## Future Requirements

- **ATST-01** — Sign release artifacts and provide independently verifiable provenance attestations.
- **RCPT-01** — Add a configurable, privacy-preserving transaction-receipt retention and pruning policy.
- **LNX-01** — Support additional Linux service managers after the systemd adapter and macOS release path stabilize.
- **DIST-01** — Distribute through package managers after direct artifact installation is proven reproducible.
- **RCLL-01** — Consider a generic public recall capability only after it passes privacy, portability, and non-personal-data tests.

## Out of Scope

| Item | Reason |
|---|---|
| GUI installer | v1.1 proves a transparent local lifecycle core and CLI first. |
| Cloud control plane, accounts, or telemetry | The glove is local-first and must not require centralized identity or observation. |
| Silent updates | Updates require an explicit operator action and visible transaction receipt. |
| Mutating `doctor --repair` | Doctor remains observational; lifecycle commands own mutation. |
| Whole-file ownership of user configuration | Temperance owns only declared blocks and managed artifacts. |
| Full Linux parity | Linux is best-effort for v1.1; macOS qualification is release-blocking. |
| Public `atlasRecall.ts` or personal memory | These remain private overlays and are excluded from release artifacts. |

## Traceability

Roadmap phases will populate requirement-to-phase mappings after this requirements set is approved.

| Requirement | Phase | Status |
|---|---|---|
| _Pending roadmap_ | — | Unmapped |

**Coverage:** 46 v1.1 requirements; 0 mapped; 46 awaiting roadmap assignment.

## Ratification Record

`.planning` is an execution map, not a design authority. A surface can become an active GSD phase only when at least one ratification signal is present.

### Ratification Signals

- `ISA.md` contains checked criteria for the surface.
- A spec in `docs/superpowers/specs/` has an approved or ratified status.
- The operator explicitly asks for the surface to be implemented in the current repository.

### Mapped Surfaces

| Surface | Status | Active in `.planning` | Source |
|---|---|---:|---|
| Product-engineering workflow hardening | Ratified by operator request | yes | 2026-07-09 request |
| Public package baseline | Ratified by checked ISA criteria | yes, as completed reference | `docs/plans/2026-06-12-temperance-engine.md` |
| Temperance identity port and installer layering | Approved design and implemented | yes, as completed reference | `docs/superpowers/specs/2026-07-01-temperance-identity-port-design.md` |
| Unified PAI/GSD flow | Ratified by checked ISA criteria | yes, as completed reference | `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md` |
| Unified routing brain | Ratified by checked ISA criteria | yes, as completed reference | `docs/superpowers/specs/2026-07-05-unify-routing-brains-design.md` |
| Routed parallel dispatch bridge | Completed dependency and reference-only bridge | no new active phase | `docs/superpowers/specs/2026-07-04-routed-parallel-dispatch-bridge-design.md` |
| Integrated system hardening | Approved design pending user review | no | `docs/superpowers/specs/2026-07-02-integrated-system-hardening-design.md` |
| GSD hook wiring and external conversion | Plan exists, no ratified local spec | no | `docs/superpowers/plans/2026-07-06-gsd-hook-wiring-and-ratandevelopers-conversion.md` |
| OmniRoute Paseo-native routing overhaul | Ratified by operator request via `/superpowers:brainstorm` dialogue, 2026-08-02 | queued, not active | `docs/superpowers/specs/2026-08-02-omniroute-paseo-native-routing-design.md` |
| Memory, compression, OmniGlyph, and free-tier leverage | Ratified by operator review request, 2026-08-02 | queued, not active | `docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md` |
| Mac mini to Public Temperance Glove reconciliation | Ratified and activated by operator request, 2026-08-19 | active as milestone v1.1 | `docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` |

## Existing Verification Spine

- Resolver tests cover `.planning` absent and present.
- Documentation continuity asserts the planning spine names GSD, Speckit, ratified surfaces, and `scripts/verify-all.sh`.
- CI calls `scripts/verify-all.sh` for package verification.

---
*Requirements defined and approved: 2026-08-19*
