Execution admitted by the owner on 2026-10-01 for Tasks 1–8 in their owning repositories. Earlier proposal-only and Task 1–2 adoption text below records the review state; it does not limit this execution. Physical effects require the actual reviewed destination packet.

# Modular Mac Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Respect Temperance's approved routing and owning repository before dispatching any worker.

**Status:** proposed, 2026-10-01. Review and planning are delivered; implementation,
installation and migration are not authorized by this artifact.

**Goal:** Extend the existing Temperance install surface into a modular,
recoverable setup for a replacement workstation and an added always-on Mac,
preserving the integrated Cambium/Temperance organ and evidence loop.

**Architecture:** Keep one headless controller and lifecycle authority, using
the existing OpenTUI wizard and install-surface journal/executor. Add a
manifest-only migration contract, destination profile planning and evidence
joins, including owner-bound organ relationships; then prove one local
transaction before connecting remote fleet scheduling.

**Tech Stack:** existing Bun/TypeScript, AJV and OpenTUI, typed native adapters,
macOS launchd/OS credentials and repository-native tools. Preserve the current
install-surface source pins: Bun `1.3.5`, OpenTUI `0.5.11`, AJV `8.20.0`,
TypeScript `5.9.3`; a version change needs its own compatibility review.

**Spec:** [modular Mac design](../specs/2026-10-01-modular-mac-design.md).
**Evidence:** `cambium:docs/architecture/2026-10-01-modular-mac-system-review.md`
and `cambium:docs/architecture/2026-10-01-modular-mac-system-map.json`.
The `cambium:docs/architecture/2026-10-01-growth-ecosystem-review.md`
and `cambium:docs/architecture/2026-10-01-growth-file-coverage.json`
define integration and source-fidelity requirements.

## Global constraints

- Generic implementation owner: Temperance distribution, `package/install-surface`.
- The owner execution request admits distribution source work. Host, provider, cloud and external-product effects require their own exact scope.
- Root ISA remains review acceptance; future owner ISAs own implementation acceptance.
- Reuse `onboarding` and `lifecycle`; no second journal, routing catalog or secret store.
- Use `temperance migrate` for new commands; existing lifecycle verbs retain semantics.
- First slice: manifest-only export and local fixture effects. No credentials,
  provider calls, real services, cloud writes, production data or native session import.
- Workstation replacement and node addition have equal priority and separate flows.
- Cambium, Temperance and connected organs work together through owned
  contracts; operational stores, credential and release authorities stay distinct.
- Neither Mac profile requires Snow Gloves. This plan creates no Snow Gloves
  pack, copies its catalog, or installs/updates/uninstalls its services.
- Cambium is the integrated compiler/admission and receipt owner;
  its operational store and deployment lifecycle are outside this executor.
- Personal OmniRoute and distribution 9router remain explicit, distinct choices.
- Keep optional UI/headless independence, scope holds and fresh admission evidence.
- Every executor uses the owning project's declared checks and exact-path commits.

## Review focus

1. A new host has the same model/UID as the old host: hardware facts alone must
   not establish unique device identity or transfer approvals.
2. The old host disappears during a remote effect: preserve unknown outcome and
   reconcile it, rather than admit a destination replay.
3. User files change after preview: invalidate approval and preserve those bytes.
4. A selected TUI native artifact fails to load or the terminal disconnects:
   headless recovery still works and the terminal is restored.
5. The public catalog preselects 9router while OmniRoute occupies port 20128:
   hold the migration without replacement, credential access or fallback.

## Delivery sequence

| Tranche | Owner | Deliverable | Acceptance before next tranche |
|---|---|---|---|
| A: portability join | Temperance distribution with Cambium/personal-runtime/Hermes owner review | Organ relationships, contracts, compatibility, read-only inventory/export/diff | Synthetic integrated task path, schema/privacy and fidelity; no effects |
| B: local recovery | Same install surface | Destination plan, one owned-file transaction, resume/rollback | Fault injection and exact preimage restoration |
| C: TUI integration | Same install surface | Existing wizard extension and operations/recovery views | Shared agent action semantics and keyboard/terminal proof |
| D: release kit | Distribution plus selected source owners | Verifiable installer/runtime closure and private overlay binding | Clean-root install, no mounted-volume dependency, rollback |
| E: both physical flows | Owner and real destination Mac | Workstation readiness and always-on boot/recovery | Actual device golden paths and cold-boot/restore receipts |
| F: optional expansion | Each independent owning product | Shared scheduling, paid/public delivery or further fleet services, if later requested | Separate specs and authority; no combined product or installer |

Do not implement F to compensate for missing A–E. Snow Gloves' pilot is
context for its own product, not the Temperance node contract or a dependency
of this plan. A–E must remain usable with Snow Gloves entirely absent.

## Repository and file ownership

All Task 1–7 paths below are relative to the **Temperance distribution**.
They are proposed edit targets and are not created by this review. Existing
paths were verified; new names define the suggested decomposition.

| Area | Existing seam | Proposed addition |
|---|---|---|
| Contracts | `src/onboarding/public-contracts.ts`, `contract-schema.ts` | `src/migration/contracts.ts`, `schema.ts` |
| Inventory | `src/doctor`, `onboarding/system-adapter.ts`, `volume-adapter.ts` | `src/migration/inspect.ts`, `adapter.ts` |
| Export/diff | Existing canonical JSON, deny/path policy | `src/migration/export.ts`, `diff.ts` |
| Plan | `src/onboarding/composition.ts`, `planner.ts` | `src/migration/planner.ts` |
| Transaction | `src/lifecycle/executor.ts`, `journal.ts`, `receipts.ts` | `src/migration/recovery.ts`, typed bridge into existing executor |
| Human/agent UI | `src/onboarding/wizard.ts`, `tui.ts`, `operator-report-tui.ts` | `src/migration/controller.ts`, `tui.ts` |
| CLI | `src/cli.ts` | `src/migration/cli-args.ts` |

## Integration prerequisites

Carry the five operating and six cognitive organs as relationships with
owner/version/digest, inputs, trigger, scope, selected plant, artifact,
consumer, verdict and freshness. The six Will desks are roles, not agents.
Retain extract/feed/read/edit effects, canonical WorkObject and pack scope,
separate memory planes and current owner gates. No public account or native
session store is exported.

Cambium/Hermes topic parity currently holds Adytum: eight consumer topics
versus nine owner topics. Repair belongs to the owner source repositories
as a separately admitted change, before an actual Adytum connection. A
passing self-contained vendored test cannot prove current owner parity.
Keep all four capability-hit modes disabled. The enrollment JSON is an
effectful input; retain exact-file approval, fingerprint and map readback.

## Task 1: Declare the capability snapshot and compatibility join

**Files:** create `package/install-surface/src/migration/contracts.ts`,
`schema.ts`, `test/migration-contracts.test.ts`; extend existing public
contracts only where the owner approves an additive versioned join.

**Consumes:** current onboarding module/project references and symbolic root
tokens. **Produces:** `MigrationSnapshotV1`, `MigrationTargetV1`,
`MigrationFindingV1`, `validateMigrationSnapshot(value): ValidationResult`.

Snapshot fields: schema/version, observation time, source release and module
lock digests, selected profile, logical module refs, evidence dimensions,
toolchain requirements, data classifications and held requirements. Exclude
private binding values, credential bodies, session identifiers and raw logs.
Device authorization requires a separate issued device identity; current
`host-identity.ts` hardware/UID matching is only a compatibility observation.

- [ ] Write fixtures for workstation, added worker and recovery profiles.
- [ ] Define typed organ/interlink evidence references without copying owner
  catalogs. Include trigger, admission, artifact, consumer and verdict separately.
- [ ] Preserve cell verbs and per-WorkObject pack/plant binding; reject task,
  owner, contract or source-digest substitution and staleness.
- [ ] Model current Adytum parity hold and disabled capability-hit modes;
  enrollment flags never issue destination execution authority.
- [ ] Declare external product references separately from owned modules;
  prove Cambium/Snow Gloves references grant no install or state authority.
- [ ] Assert closed fields, schema-major holds, duplicate module refs,
  missing source/lock digest, invalid evidence time and forbidden payloads.
- [ ] Run `bun test test/migration-contracts.test.ts` and capture its initial failure.
- [ ] Implement validators and source-owned references; do not copy owner catalogs.
- [ ] Run the test and `bun run typecheck`; commit only this task's paths.

Concrete assertion the test must cover:

```ts
expect(validateMigrationSnapshot({ ...validSnapshot, credential: "fixture" }).ok).toBe(false);
expect(validateMigrationSnapshot({ ...validSnapshot, version: { major: 99, minor: 0 } }).reason)
  .toBe("UPGRADE_REQUIRED");
```

## Task 2: Implement bounded inspect/export/diff

**Files:** create `src/migration/{adapter,inspect,export,diff}.ts`,
`test/migration-inspect.test.ts`, `test/migration-export.test.ts`,
`test/migration-diff.test.ts`, all under `package/install-surface`.

**Consumes:** `MigrationSnapshotV1` and an injected read-only
`MigrationProbeAdapter`. **Produces:** `inspect(adapter)`,
`exportManifest(snapshot, destination)`, `diff(source, target)`.

Adapter methods resolve only approved roots/artifacts and safe service
metadata. No arbitrary glob, shell command, env dump, HTTP provider call or
credential-store read. Inspect returns evidence with unknown states when an
owner cannot be read. Export validates the complete snapshot again before
an atomic private write. Destination is explicit and must not be a symlink.

- [ ] Use fake adapters with counters; prove zero write/network/auth calls.
- [ ] Inspect the synthetic integrated task chain and the Hermes variant.
  Distinguish contract presence, artifact, consumption and independent verdict.
- [ ] Keep canonical knowledge references and derived indexes separate;
  show stale PDF/source pairs and unresolved links as findings, not approvals.
- [ ] Cover denied roots, missing volume, non-regular file, path traversal,
  malformed service metadata and native binary present with unsupported version.
- [ ] Verify no private values or native IDs survive export; round-trip exact bytes/digest.
- [ ] Test release/binding/module/version differences and 'unknown' evidence
  as meaningful findings rather than false readiness.
- [ ] Implement and run the three focused tests plus typecheck; commit exact paths.

```ts
expect(fakeAdapter.effects).toEqual([]);
expect(diff(installedButUnauthenticated, fullyReady).findings)
  .toContainEqual(expect.objectContaining({ reason: "AUTHENTICATION_PENDING" }));
```

First optional real-host proof is a separately authorized manifest-only
inventory. It does not transfer project source, WIP, private memory or credentials.

## Task 3: Compose destination plans without router cutover

**Files:** create `src/migration/planner.ts`,
`test/migration-planner.test.ts`; integrate with
`src/onboarding/{composition,planner,core-catalog}.ts` through reviewed seams.

**Consumes:** snapshot, destination binding requirements, explicit profile,
module selections and backend. **Produces:** `MigrationPlanV1` with ordered
steps, dependencies, source/lock/binding digests, preconditions, effect classes,
verification probes, rollback requirements and holds.

- [ ] Prove both base profiles compose without optional browser/media/native packs.
- [ ] Prove both compose with no Snow Gloves installation, catalog or enrollment;
  reject plans that claim Cambium/Snow Gloves-owned state or service paths.
- [ ] Test cycles, duplicate owners, conflicting destinations, Node 22/26
  environments, unavailable disks and capacity unknown before admission.
- [ ] Test OmniRoute selected with unsupported adapter: held, zero router effects.
- [ ] Test port 20128 occupied and catalog 9router preselection: no implicit replacement.
- [ ] Implement the pure planner; run tests/typecheck and commit exact paths.

```ts
expect(personalPlan.holds).toContainEqual(expect.objectContaining({ reason: "ROUTER_ADAPTER_UNVERIFIED" }));
expect(personalPlan.steps.some(step => step.effect === "router-replacement")).toBe(false);
```

## Task 4: Bridge one local transaction and prove recovery

**Files:** create `src/migration/recovery.ts`,
`test/migration-recovery.test.ts`; modify existing
`src/lifecycle/{executor,journal,receipts}.ts` only where the new fault tests
demonstrate a required extension. Reuse prepared surfaces and preimage logic.

**Consumes:** exact reviewed `MigrationPlanV1` and an existing lifecycle
transaction reference. **Produces:** explicit status/resume/rollback views
bound to the same source, destination, plan and configuration generation.

- [ ] Create one harmless owned configuration fixture in a temporary root;
  include a pre-existing identical unowned file and a differing user-owned file.
- [ ] Reject changed source, lock, binding, destination and preimage after review.
- [ ] Inject termination/failure before and after each journal append, stage,
  verification, promotion and receipt write. Restart from disk-only state.
- [ ] Reconcile matching observed bytes; hold differing bytes; preserve
  unknown effects; test two writers and stale ownership.
- [ ] Roll back exact owned preimages and compatible binding/release generation;
  preserve unowned files and history. Run tests/typecheck and commit exact paths.

```ts
expect(await restoredBytes(userOwnedPath)).toEqual(originalUserBytes);
expect(await recoveryView(interruptedOperation)).toMatchObject({ status: "incomplete" });
expect(await resumeWithChangedBinding(interruptedOperation)).toMatchObject({ status: "manual-recovery" });
```

The recovery bridge cannot depend on OpenTUI, Speculum, credentials or network.
Remote-effect reconciliation is an interface hold in this slice, not a fake implementation.

## Task 5: Expose shared CLI and agent actions

**Files:** create `src/migration/{controller,cli-args}.ts`,
`test/migration-controller.test.ts`, `test/migration-cli.test.ts`;
modify `src/cli.ts` only to route the new subcommand.

**Consumes:** plan/snapshot/operation results. **Produces:** one closed
`MigrationViewV1` with current step, evidence, enabled action IDs, safe
reason codes and required human handoffs, shared with the TUI.

- [ ] Assert `inspect`, `export`, `diff`, `plan`, `status` are effect-classed;
  mutations require the exact digest and fresh adapter preflight.
- [ ] Test bad flags/action IDs and changed/expired review; reject arbitrary argv.
- [ ] Test authentication pending as recoverable; valid projections do not
  falsely return profile-ready from a successful process exit.
- [ ] Implement routing and action view; test Ctrl-C preserving interrupted/unknown outcomes.
- [ ] Run focused tests/typecheck and existing operator CLI regression suite; commit exact paths.

## Task 6: Add rich migration and recovery views to existing OpenTUI

**Files:** create `src/migration/tui.ts`, `test/migration-tui.test.ts`;
modify `src/onboarding/{wizard,tui,operator-report-tui}.ts` only for navigation
joins and renderer reuse.

**Consumes:** `MigrationViewV1` action contract. **Produces:** guided scenario
selection, module list/detail, exact-change review and recovery screen.

- [ ] Add Ecosystem/Organs/Work/Knowledge views using the same action contract;
  explain each owner, source, input, trigger, artifact, consumer and verdict.
- [ ] Keep Will desk views as role filters. A selection cannot admit work,
  promote learning, publish, arm a cadence or alter provider configuration.
- [ ] Add test views for replacement workstation and worker addition, held
  authentication, drift, interrupted transaction and unsupported backend.
- [ ] Assert keyboard-only navigation at 80x24 and 120x40, focus restoration,
  textual status labels and the same enabled actions as agent mode.
- [ ] Show plan/source/binding digests, effects and rollback before confirmation.
  Cancellation preserves completed external sign-ins rather than promising undo.
- [ ] Test missing native assets, renderer failure and disconnect; restore
  terminal state and display a headless recovery path.
- [ ] Run focused TUI/wizard/controller regressions; capture a real PTY flow
  with synthetic inputs before claiming interface acceptance; commit exact paths.

Avoid a renderer rewrite or framework upgrade. OpenTUI official testing and
cleanup docs are references; local pinned APIs remain the implementation authority.

## Task 7: Build the verified portable kit and private overlay join

**Files:** distribution `install.sh`, `scripts/verify-install.sh`,
`package/install-surface/docs/{guided-onboarding,agent-operations}.md`;
create `tests/migration-kit.sh` and `docs/modular-mac-lifecycle.md`.
Personal-runtime source staging is a separately reviewed owner adapter;
no personal runtime files are edited by this distribution task.

**Consumes:** reviewed release lock, built runtime closure and optional
private overlay requirements. **Produces:** checksum-bound artifact,
trusted manual bootstrap entry and clean-root install/restore receipt.

- [ ] Build from approved source with exact lockfiles; include required
  OpenTUI native artifact/assets for the target architecture.
- [ ] Test missing Bun/Git/Homebrew and unsupported architecture without
  assuming an agent exists before bootstrap.
- [ ] Install into a disposable home/state root with the old external
  volume absent; verify no personal path, credential, memory or session payload ships.
- [ ] Test selected profile, repeated installation, changed user config,
  compatible release/binding rollback and unsupported overlay hold.
- [ ] Run owner-required verification and package integrity checks; document
  physical gates as pending; commit exact release-kit paths without tagging/deploying.

## Task 8: Perform the two physical acceptance flows

This is an owner-operated rollout packet, not automated approval. Target
identity, hardware, OS, backup/restore destination, access, chosen release,
profiles and allowed mutations must be reviewed before installation.

- [ ] Workstation: run trusted entry, inspect and review destination plan,
  complete fresh sign-ins, attach selected projects and prove one accepted
  headless work unit plus one chosen native-client callback, independently
  verified artifact, owner receipt and bounded Cortex/Nutrix learning proposal.
- [ ] Always-on node: issue a fresh Temperance device identity without Snow
  Gloves, attach explicit endpoint/scope,
  prove one bounded job, stop/late-result handling and zero duplicate writers.
- [ ] On each relevant physical profile, rehearse power/network loss, boot/login,
  FileVault/keychain access, resource caps and remote recovery.
- [ ] Restore from independent backup and roll back the owned configuration;
  read back exact artifacts and keep source/installed/live evidence separate.
- [ ] Record physical receipts in the owning ISA. Old-host retirement,
  router replacement, remote services and paid operations remain separate decisions.

## Later plans: keep them independently reviewable

Create separately requested owner specs/plans for shared-node scheduling,
Hermes remote handoff, approved Vault backups and measured Temperance
capacity/soak. Snow Gloves enrollment/secrets remain on its own roadmap,
outside the migration release. Any future interoperability must be optional,
bind existing resources and preserve independent product ownership; it must
not duplicate D1, router catalogs, topic maps, budgets or project authority.

## Definition of completion

Local product completion requires A–D synthetic/packaged evidence with one
shared controller and owned recovery semantics. Migration acceptance requires
the actual E receipts for both selected scenarios. F is a later optional
capability set. A green test run, visible TUI, application presence or healthy
port cannot collapse these definitions into a full-system migration claim.

The owner has admitted full execution with Temperance Parallel Dispatch. Source work proceeds in isolated worktrees; physical effects await the exact destination packet and its scoped authority.
