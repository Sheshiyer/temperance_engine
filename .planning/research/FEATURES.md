# Feature Research

**Domain:** Downloadable, locally operated AI-operator runtime lifecycle
**Milestone:** v1.1 Public Temperance Glove
**Researched:** 2026-08-19
**Confidence:** HIGH for milestone scope and required behavior; MEDIUM for ecosystem comparisons

## Scope Boundary

This research covers only the new downloadable-product lifecycle: clean install,
optional components, provenance and doctor output, safe update, rollback,
uninstall, managed-configuration preservation, platform qualification,
documentation continuity, and release verification. Existing routing, mode
binding, Manifest Zone, Pulse, and native-integration behavior are dependencies,
not features to redesign here.

Locked boundaries:

- macOS qualification blocks release; Linux qualification is best-effort and
  publishes its result without blocking v1.1.
- `atlasRecall.ts` remains a private operator overlay and is absent from every
  public source archive, install manifest, generated file, and release artifact.
- Private runtime state, provider sessions, credentials, logs, histories,
  receipts, backups, databases, and personal PAI memory are never shipped.
- A sanitized release-qualification receipt may be published as release
  metadata; operator-local lifecycle receipts and backups remain host-private.

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any P1 behavior makes the product unsafe, irreproducible, or not truly
downloadable. Each row states an operator-visible acceptance condition.

| Feature | Why Expected | Complexity | Operator-observable acceptance |
|---------|--------------|------------|--------------------------------|
| Clean macOS install from a tagged source archive or clean clone | A downloadable product cannot depend on the maintainer's checkout, home directory, symlinks, or pre-existing state | HIGH | On a pristine supported macOS fixture, `./install.sh` exits zero; the documented first doctor and canonical verifier exit zero; no path resolves into the developer workstation |
| Preflight with actionable dependency and permission diagnostics | Operators need to know what is required before files or services change | MEDIUM | Preflight names each missing required dependency, distinguishes optional dependencies, shows intended destinations, and exits nonzero before mutation when a required prerequisite is absent |
| Explicit optional-component selection | Voice, provider integrations, GSD spine, editor hooks, bridge/console services, and other non-core surfaces must not be installed implicitly | MEDIUM | Install output and receipt list each component as `installed`, `skipped by operator`, `unsupported on platform`, or `failed`; doctor repeats the same inventory without treating an intentional skip as failure |
| Versioned install-surface provenance inventory | Install, update, doctor, verify, rollback, and uninstall need one shared statement of what Temperance owns | HIGH | Every public installable surface has exactly one manifest entry with source, destination template, lifecycle class, mutability, platform, optionality, verification probe, and rollback rule; schema validation exits zero |
| Explainable doctor output | A simple green/red result is insufficient when local files and services drift | HIGH | Human output identifies product version, manifest version/digest, platform, source, resolved destination, expected/actual digest or generated-state probe, ownership class, and `PASS`/`DRIFT`/`MISSING`/`SKIP` status per entry; machine-readable output represents the same facts |
| Idempotent reinstall | Re-running an installer is a normal recovery action and must not duplicate managed blocks, services, links, or PATH entries | HIGH | Running the same install twice produces no duplicate configuration markers or service registrations; the second receipt reports unchanged entries and doctor remains green |
| Backup-first, version-aware update | Operators must be able to upgrade without losing working configuration or being stranded on a half-applied version | HIGH | Update reports current and target versions, validates the target manifest before mutation, records pre-change digests/backups, applies only owned surfaces, and emits a transaction receipt tied to both versions |
| Health-gated update with automatic restoration on failure | Updating live local services can fail after files have been replaced | HIGH | A forced post-update health-probe failure returns nonzero and restores the pre-update file digests, managed blocks, service definitions, and prior service health; the receipt identifies the failed step and restoration result |
| Managed configuration preservation | Operators already have Codex, Claude, OpenCode, Cursor, and shell configuration that Temperance does not own | HIGH | Fixture keys and comments outside uniquely marked Temperance blocks are byte-for-byte unchanged after install, update, rollback, and uninstall; each managed block occurs at most once |
| Transaction-selectable rollback | Recovery must work independently of fetching a newer release or reconstructing old state by hand | HIGH | Given an update receipt, rollback identifies the exact transaction, stops affected services in declared order, restores backed-up content and registrations, restarts the prior service set, verifies health, and reports restored digests |
| Reversible, inventory-driven uninstall | An operator must be able to remove the product without guessing which files it touched | HIGH | Uninstall consumes the recorded installed inventory in reverse dependency order, stops/unregisters owned services, removes only Temperance-owned files/blocks, restores displaced pre-install files, and exits zero on a second no-op run |
| Conservative state-removal policy | Uninstalling program material must not destroy unrelated or private operator state | MEDIUM | Default uninstall reports retained host state and backups; any product-state purge requires a separate explicit confirmation/flag and still refuses to touch OmniRoute, provider, PAI-memory, or other external-authority directories |
| macOS service lifecycle support | macOS is the release-blocking reference platform and background components need observable registration and health | HIGH | Parameterized per-user service templates resolve without hard-coded homes; install/doctor/update/rollback/uninstall agree on registration status, PID/health when running, and ordered stop/start behavior |
| Best-effort Linux/no-`launchd` behavior | Linux users should receive the portable core without a false parity promise | MEDIUM | A Linux fixture never invokes `launchctl`; portable core install, doctor, verification, and uninstall complete or report a specific unsupported capability; Linux failure is visible in the release receipt but does not fail the v1.1 release gate |
| Private-state exclusion | The public payload must reproduce behavior without reproducing the maintainer | HIGH | Secret/path scans of the repository and packaged artifact find no credentials, private runtime databases, histories, logs, receipts, backups, personal PAI memory, mounted-volume assumptions, developer-home paths, or `atlasRecall.ts` |
| Documentation continuity | Public commands and lifecycle guarantees are part of the product interface | HIGH | README, Quickstart, architecture, rollback, security, contributing, changelog, docs index, and site point to one current lifecycle; every documented command exists and accepts the documented flags; manifest-derived diagrams/inventories match the release manifest |
| Clean-clone release qualification | Passing on the maintainer's live machine does not prove a portable release | HIGH | macOS full-spine and macOS no-voice clean-host receipts pass; secret/path, provenance, runtime smoke, rollback, uninstall, documentation, and `./scripts/verify-all.sh` gates pass from the exact release candidate |
| Release identity and integrity readback | Operators need to connect a download, an installed tree, and a verification receipt to one version | MEDIUM | Release notes and receipt name the tag, commit, artifact digest, install-manifest version/digest, supported-platform result, and canonical verifier result; doctor reads back the same installed identity |

### Differentiators (Competitive Advantage)

These behaviors create trust beyond a conventional copy-and-run installer.

| Feature | Value Proposition | Complexity | Operator-observable acceptance |
|---------|-------------------|------------|--------------------------------|
| One provenance contract for the entire lifecycle | Drift is diagnosed from declared ownership rather than rediscovered by archaeology in six scripts | HIGH | Changing one manifest fixture changes install, doctor, verification, rollback, and uninstall behavior consistently; tests fail if any lifecycle command maintains an undeclared parallel inventory |
| Classification-aware lifecycle (`copy`, `transform`, `regenerate`, `never-ship`) | Program material, templated integration, host-generated state, and prohibited payloads receive different safety rules | HIGH | Doctor displays the class for every entry; packaging rejects `never-ship`; update checksum-compares immutable copies without overwriting regenerated host state |
| Evidence-rich lifecycle receipts | Operators can explain exactly what changed and recover without trusting memory | HIGH | Install/update/rollback/uninstall receipts include transaction ID, versions, manifest digest, selected options, resolved targets, before/after digests, service actions, probe results, and backup references without secret values |
| Drift-aware doctor remediation | Operators learn whether an item is missing, locally modified, unsupported, or intentionally absent before taking action | MEDIUM | Each non-pass result includes a non-destructive next step; `doctor` itself performs no repair, update, service restart, or configuration mutation |
| Source/runtime/private-authority separation | The downloadable glove remains useful while operator identity and provider authority remain local and private | HIGH | The installed inventory clearly distinguishes product-owned files, generated host state, declared private overlays, and external provider authority; lifecycle commands refuse out-of-scope targets |
| Documentation derived from the same install truth | Docs drift becomes a release failure instead of a reader-discovered surprise | MEDIUM | A continuity test detects a manifest component, flag, command, or lifecycle diagram missing from the public docs and blocks the macOS release gate |
| Transparent asymmetric platform support | Users see an honest support contract instead of Linux either silently breaking or delaying the reference release | MEDIUM | Release receipt labels macOS `release-blocking` and Linux `best-effort`, preserves both test results, and never converts a Linux skip into a macOS pass |
| Verifiable release provenance attestation | A downloader can independently bind the artifact to its repository workflow and digest | MEDIUM | When published, the release artifact's attestation verifies against the canonical repository and the documented digest; failed verification is explicit and does not silently fall back to trust-by-filename |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Required Alternative |
|---------|---------------|-----------------|----------------------|
| Silent background self-update | Feels maintenance-free | Changes an operator's governed runtime without review, weakens rollback evidence, and conflicts with explicit phase/release approval | Explicit check/preview followed by an operator-invoked, receipt-producing update |
| Whole-file replacement of editor, agent, or shell configuration | Simplifies implementation | Erases unrelated user settings and makes uninstall unable to distinguish ownership | Uniquely marked, schema-aware managed blocks with outside-block preservation tests |
| Install every optional integration by default | Creates an impressive demo | Introduces undeclared dependencies, credentials, ports, services, and platform failures | Minimal core plus explicit flags/profiles; print `SKIP` with the reason for unselected components |
| Treat optional failure as global success or required failure as a warning | Keeps exit codes green | Makes doctor and automation untrustworthy | Typed required/optional status: required failures return nonzero; optional skips remain visible but non-fatal |
| Repair-on-doctor | Seems convenient | A diagnostic command that mutates files or restarts services destroys forensic value | Read-only doctor with an explicit remediation command or update plan |
| Destructive uninstall or blanket home-directory purge | Promises a perfectly clean machine | Can delete private state, provider sessions, user configuration, or unrelated files | Inventory-driven removal, pre-install restoration, retained-state report, separately confirmed product-state purge only |
| Ship the maintainer's runtime snapshot | Appears to guarantee parity | Leaks secrets and identity, embeds absolute paths, and distributes stale mutable evidence | Ship public source/templates/schemas; regenerate host state and probe provider authority locally |
| Promote `atlasRecall.ts` as a generic feature | Preserves reference-machine behavior | It is coupled to private memory and has no approved generic fixtures | Keep it as a declared private overlay; reconsider only in a later milestone with generic inputs and tests |
| Claim Linux parity in v1.1 | Broadens the support headline | Creates an unearned release promise and diverts the release gate from the proven reference platform | Publish best-effort Linux/no-`launchd` results and blockers while macOS remains authoritative |
| Make Linux qualification release-blocking | Maximizes nominal portability | Contradicts the locked milestone decision and can prevent shipping a verified macOS product | Block only on macOS; retain Linux failures as visible follow-up evidence |
| Bind installation to a mutable checkout or maintainer-only `product` symlink | Mirrors the reference machine cheaply | A symlink proves neither complete payload provenance nor clean-host reproducibility | Install from a tagged artifact/clean clone using manifest-resolved destinations and digest verification |
| Hand-maintain separate inventories in lifecycle scripts and docs | Lets each command evolve quickly | Guarantees ownership and documentation drift | One versioned manifest plus generated/validated projections |
| GUI installer, cloud control plane, account system, or remote telemetry for v1.1 | Makes the release look more productized | Adds unrelated authority, privacy, packaging, and support surfaces without improving the locked lifecycle goal | Keep a local CLI lifecycle with bounded receipts; revisit presentation layers only after lifecycle validation |
| Monolithic release commit | Avoids the work of slicing changes | Makes provenance, review, rollback, and regression localization harder | Five reviewable slices with focused tests, then one clean integration verification |

## Feature Dependencies

```text
[Locked privacy/classification rules]
    └──requires──> [Versioned install-surface manifest]
                       ├──requires──> [Converged public source payloads]
                       ├──drives────> [Clean install + optional selection]
                       ├──drives────> [Provenance doctor + verifier]
                       ├──drives────> [Update transaction]
                       └──drives────> [Inventory-driven uninstall]

[Managed-block ownership] ──requires──> [Install-surface manifest]
    ├──enables──> [Safe update]
    ├──enables──> [Rollback]
    └──enables──> [Reversible uninstall]

[Backup inventory + before/after digests]
    └──enables──> [Health-gated update]
                       └──enables──> [Automatic restoration]
                                              └──enables──> [Manual rollback]

[Platform service templates + optionality rules]
    ├──enables──> [macOS release-blocking qualification]
    └──enables──> [Linux/no-launchd best-effort qualification]

[Lifecycle commands stabilized]
    └──requires-before──> [Documentation continuity]
                              └──requires-before──> [Clean-host qualification]
                                                           └──requires-before──> [Release verification]

[Existing router/hooks/Bridge/Zone/enrichment/skill behavior]
    └──must-be-reconciled-without-redesign──> [Converged public source payloads]

[Private atlasRecall overlay] ──conflicts-with──> [Public release payload]
[Private runtime/provider/PAI state] ──conflicts-with──> [Any shipped artifact]
[Silent self-update] ──conflicts-with──> [Reviewable, rollback-safe lifecycle]
```

### Dependency Notes

- **The manifest requires locked ownership rules:** lifecycle automation is unsafe
  until each surface has exactly one classification, owner, mutability model,
  platform set, verification probe, and rollback rule.
- **Lifecycle work requires source convergence:** an installer must not encode
  current drift between the reference host and repository as the public truth.
- **Update and uninstall require managed-block identity:** preservation cannot be
  proved if Temperance cannot identify the exact configuration bytes it owns.
- **Rollback requires durable pre-change evidence:** a backup without its source
  transaction, original destination, digest, and service state is not a reliable
  restore point.
- **Qualification requires stabilized commands:** clean-host receipts must test
  the same interfaces documented for operators, not temporary phase scripts.
- **Release requires exact-candidate verification:** receipts from a dirty working
  tree or different commit do not qualify the downloadable artifact.
- **Existing runtime behavior is a compatibility dependency:** this milestone
  packages and verifies it; it does not reopen its routing or mode semantics.

## Operator-Observable Success Conditions

| Scenario | Setup and action | Required observable result |
|----------|------------------|----------------------------|
| First macOS install | Empty-home fixture; install documented minimal posture | Exit zero; only required core surfaces installed; explicit optional skips; doctor and canonical verifier green |
| Full-glove macOS install | Empty-home fixture; select all supported v1.1 components | Exit zero; each selected component appears once in inventory; required services are registered and healthy |
| No-voice macOS install | macOS fixture without voice dependency; select no-voice posture | Core install and verification pass; voice reports intentional skip; no hidden voice path is created |
| Linux compatibility | Linux fixture without `launchd`; install portable posture | No `launchctl` invocation; portable surfaces pass or precise unsupported statuses appear; receipt is informational for release |
| Optional dependency absent | Remove dependency used only by an unselected component | Install passes and doctor reports the component skipped; selecting that component produces an actionable preflight failure |
| Idempotent reinstall | Run the identical install twice | No duplicate block, link, service, or PATH entry; second receipt reports no material change |
| Preserve local configuration | Seed user-owned keys/comments around a managed block; update | Outside-block fixture digest is unchanged; exactly one updated Temperance block remains |
| Detect drift | Modify one immutable installed file after install; run doctor | Doctor returns `DRIFT`, identifies expected/actual digest and destination, and makes no repair |
| Successful update | Install N, update to N+1 | Receipt binds both versions and manifest digests; backups exist; doctor reports N+1; required services are healthy |
| Failed update restoration | Inject a failing required health probe during N→N+1 | Update exits nonzero; N file/config digests and service state are restored; receipt identifies failure and restore outcome |
| Manual rollback | Complete N→N+1, then select its transaction for rollback | N digests, managed blocks, and service state return; doctor reports N; rollback receipt is complete |
| Uninstall over pre-existing files | Seed target file/config, install, then uninstall | Original fixture digests return; owned services and managed blocks disappear; external/private state remains |
| Repeated uninstall | Uninstall an already-uninstalled fixture | Safe no-op with explicit `nothing installed`-equivalent status and zero destructive side effects |
| Privacy boundary | Inspect clean source archive and built release payload | No secret values, developer absolute paths, private runtime artifacts, personal PAI memory, or `atlasRecall.ts` |
| Documentation continuity | Run docs validation against release candidate | Every public command/flag resolves; lifecycle diagrams and inventories match the versioned manifest |
| Release candidate | Verify exact tagged artifact/clean clone on macOS | All macOS blockers pass, review has no Critical/P0/P1 issue, human approval is recorded, and receipt binds tag/commit/artifact/manifest digests |
| Attested artifact (post-v1.1 candidate) | Run documented attestation verification | Verification binds artifact digest to the canonical repository workflow; tampered artifact fails |

## MVP Definition

Here, “MVP” means the minimum v1.1 downloadable product, not a reduction of the
already-existing runtime behavior.

### Launch With (v1.1)

- [ ] Versioned install-surface manifest with complete ownership and lifecycle metadata.
- [ ] Clean macOS minimal and full-glove installs from the exact release candidate.
- [ ] Explicit optional-component selection and explicit required/optional status semantics.
- [ ] Read-only human and machine-readable provenance doctor.
- [ ] Idempotent, managed-block-safe installation.
- [ ] Backup-first update with health gating and automatic restoration.
- [ ] Transaction-selectable rollback and inventory-driven reversible uninstall.
- [ ] Conservative state retention and hard private-state/`atlasRecall.ts` exclusion.
- [ ] Parameterized macOS service lifecycle and no-voice posture.
- [ ] Best-effort Linux/no-`launchd` fixture with visible non-blocking receipt.
- [ ] Synchronized lifecycle documentation and manifest-derived/validated inventories.
- [ ] Clean-clone macOS release receipt tied to tag, commit, artifact, and manifest digests.

### Add After Validation (v1.x)

- [ ] Cryptographic artifact attestation — add when the canonical downloadable artifact and release workflow are stable enough to attest without ambiguity.
- [ ] Rich transaction history/pruning controls — add when multiple real updates demonstrate retention needs; preserve deterministic rollback first.
- [ ] Additional Linux service-manager templates — add per distribution only after the portable no-service path is reliable.
- [ ] Package-manager distribution — add only after direct install/update/uninstall semantics are stable and can be mapped without creating a second lifecycle authority.

### Future Consideration (v2+)

No v2 feature is committed by this research. The only adjacent promotion gates
worth preserving are:

- [ ] Broader platform parity — promote Linux to release-blocking only after support policy, fixtures, and maintainership justify it.
- [ ] Alternative distribution packaging — evaluate only after the direct lifecycle is stable and without creating a second ownership authority.
- [ ] Generic recall enrichment — reconsider in a separate milestone only with public schemas, generic fixtures, privacy review, and no dependency on personal memory.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Install-surface provenance manifest | HIGH | HIGH | P1 |
| Clean macOS install | HIGH | HIGH | P1 |
| Preflight and optional selection | HIGH | MEDIUM | P1 |
| Explainable human/JSON doctor | HIGH | HIGH | P1 |
| Idempotent install | HIGH | HIGH | P1 |
| Managed-config preservation | HIGH | HIGH | P1 |
| Backup-first health-gated update | HIGH | HIGH | P1 |
| Automatic failed-update restoration | HIGH | HIGH | P1 |
| Transaction-selectable rollback | HIGH | HIGH | P1 |
| Reversible uninstall | HIGH | HIGH | P1 |
| Private-state and `atlasRecall.ts` exclusion | HIGH | HIGH | P1 |
| macOS service qualification | HIGH | HIGH | P1 |
| Linux/no-`launchd` best-effort receipt | MEDIUM | MEDIUM | P1 |
| Documentation continuity | HIGH | HIGH | P1 |
| Exact-candidate release receipt | HIGH | HIGH | P1 |
| Artifact attestation | MEDIUM | MEDIUM | P2 |
| Rich receipt retention controls | MEDIUM | MEDIUM | P2 |
| Additional Linux service managers | MEDIUM | HIGH | P2 |
| Package-manager distribution | MEDIUM | HIGH | P2 |
| GUI/notarized app wrapper | LOW | HIGH | P3 |

**Priority key:**

- P1: Required for the v1.1 release contract.
- P2: Valuable after the direct lifecycle proves stable.
- P3: Separate productization work, not part of this milestone.

## Reference Lifecycle Analysis

The comparison is deliberately narrow. It uses official project documentation
to identify operator expectations, not to copy another tool's architecture.

| Lifecycle behavior | Homebrew | rustup | Temperance v1.1 approach |
|--------------------|----------|--------|--------------------------|
| Explicit update | Separates metadata update, outdated inspection, and package upgrade | Provides explicit update and self-update commands, including controls to disable automatic self-update | Explicit inspect/preview and operator-invoked update; no background mutation |
| Explicit uninstall | Provides documented uninstall paths and warns about destructive forced removal | Provides `rustup self uninstall` | Inventory-driven uninstall restores displaced content and preserves external/private state |
| Coexistence with existing host state | Uses owned prefixes and package metadata | Detects existing Rust and documents controlled coexistence and customizable homes | Uses manifest ownership plus managed blocks; never claims whole user config files |
| Installation visibility | Exposes installed/outdated package state through CLI commands | `rustup show` reveals selected/installed toolchain state | Doctor reveals every declared installed surface, provenance, digest/probe, optionality, and drift |
| Platform posture | Documents different default prefixes on macOS and Linux | Supports multiple platforms through one manager | Publishes an explicit asymmetric contract: macOS blocks v1.1, Linux is best-effort |
| Release provenance | Not the focus of the cited lifecycle page | Not the focus of the cited operator lifecycle page | Release receipt is P1; verifiable GitHub artifact attestation is a P2 hardening step |

## Roadmap Implications

1. **Freeze the ownership contract first.** No lifecycle command should be
   implemented against an incomplete or duplicated inventory.
2. **Converge source before packaging.** Resolve public/live drift and complete
   payloads while keeping existing runtime semantics unchanged.
3. **Build lifecycle as one transaction system.** Install, update, rollback,
   uninstall, doctor, and verify must share manifest parsing, receipts, backup
   identity, managed-block ownership, and required/optional status semantics.
4. **Stabilize platform behavior before docs.** Documentation should describe
   verified commands and derive inventories/diagrams from the manifest.
5. **Qualify clean hosts before release slicing.** macOS full/no-voice are hard
   gates; Linux/no-`launchd` is visible evidence, not a release blocker.
6. **Verify the exact artifact last.** Bind the clean-clone receipt to the tag,
   commit, artifact digest, and manifest digest after all reviewable slices are
   assembled.

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Locked feature boundary | HIGH | Directly specified by `.planning/PROJECT.md` and the ratified audit |
| Lifecycle behavior | HIGH | Derived from the audit's lifecycle map, verification matrix, and product core value |
| Existing-versus-new distinction | HIGH | Cross-checked against current README and Quickstart; existing routing/runtime features were excluded |
| Operator expectations | MEDIUM | Corroborated by official Homebrew and rustup lifecycle documentation, but Temperance has a more stateful integration surface |
| macOS service posture | HIGH | Milestone decision is explicit; Apple's official documentation confirms per-user launch-agent management as a native service model |
| Linux filesystem convention | MEDIUM | XDG specification is authoritative, but the exact Temperance Linux destination policy remains phase-specific |
| Artifact attestation | HIGH for feasibility, MEDIUM for v1.x priority | GitHub officially supports generation and verification; this milestone has not yet ratified it as P1 |

## Sources

### Project authorities

- [Temperance planning spine](../PROJECT.md) — milestone goal, locked platform/privacy decisions, active requirements, and authority order.
- [Mac mini → Public Temperance Glove audit](../../docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md) — provenance contract, publication classes, lifecycle map, verification matrix, documentation map, and release stages.
- [README](../../README.md) — already-built install postures and runtime behavior excluded from this feature research.
- [Quickstart](../../QUICKSTART.md) — already-built operator commands and current lifecycle documentation baseline.

### Official ecosystem references

- [Homebrew FAQ](https://docs.brew.sh/FAQ) — explicit update/upgrade/uninstall behavior, pinning, and destructive-removal cautions.
- [The rustup book: installation](https://rust-lang.github.io/rustup/installation/) — explicit uninstall, customizable install homes, and PATH behavior.
- [The rustup book: basic usage](https://rust-lang.github.io/rustup/basics.html) — explicit update and automatic self-update controls.
- [The rustup book: existing Rust installations](https://rust-lang.github.io/rustup/installation/already-installed-rust.html) — detection and controlled coexistence with host-managed state.
- [XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/0.8/) — separation of user configuration, data, state, cache, and runtime locations for Linux portability.
- [Apple Service Management](https://developer.apple.com/documentation/servicemanagement) — native macOS login-item, LaunchAgent, and LaunchDaemon roles and status management.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) — build-provenance claims and the requirement that consumers actually verify them.
- [GitHub: using artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) — supported release-artifact generation and verification flow.

---
*Feature research for: v1.1 Public Temperance Glove downloadable-product lifecycle*
*Researched: 2026-08-19*
