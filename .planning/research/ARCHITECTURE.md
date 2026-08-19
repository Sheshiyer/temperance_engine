# Architecture Research

**Domain:** Portable local-runtime product installation, provenance, and lifecycle management
**Researched:** 2026-08-19
**Confidence:** HIGH — based on the ratified milestone audit and current repository lifecycle code

## Standard Architecture

### System Overview

Temperance Engine should keep the repository as the public product authority and add one narrow control plane for installed-file provenance. The provenance manifest describes how repository-owned surfaces land on a host; it does not decide product scope, acceptance, preferences, or runtime policy. `ISA.md` remains the sole acceptance authority.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                         Authority and Release Layer                      │
│                                                                          │
│  ISA.md ──accepts scope──► repository source ──described by──► manifest  │
│  (only acceptance judge)  (public product authority)       (provenance) │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ validate + resolve for host/profile
┌──────────────────────────────▼───────────────────────────────────────────┐
│                        Shared Lifecycle Control Plane                    │
│                                                                          │
│  manifest loader → destination resolver → planner → transaction engine  │
│          │                 │               │              │              │
│          └──────── read-only inspect API ──┘              └─ receipts    │
└───────────────┬─────────────────────┬──────────────────────┬─────────────┘
                │                     │                      │
      mutate through plan       inspect through plan   project facts
                │                     │                      │
┌───────────────▼──────────┐ ┌────────▼───────────┐ ┌───────▼─────────────┐
│ Lifecycle commands      │ │ Evidence commands │ │ Documentation       │
│ install / update        │ │ doctor / verify   │ │ generated fragments │
│ rollback / uninstall    │ │ clean-host gates  │ │ + authored guidance │
└───────────────┬──────────┘ └────────┬───────────┘ └─────────────────────┘
                │                     │
┌───────────────▼─────────────────────▼────────────────────────────────────┐
│                              Host Boundary                              │
│                                                                          │
│ immutable copies │ managed config blocks │ generated state │ services   │
│                     backups + receipts + ownership records               │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ explicit non-ownership boundary
┌──────────────────────────────▼───────────────────────────────────────────┐
│ Private / Provider Authority — observed when required, never packaged   │
│ OmniRoute auth/databases/logs/history; PAI memory; sessions; overlays   │
│ `atlasRecall.ts`; user-authored configuration outside managed blocks     │
└──────────────────────────────────────────────────────────────────────────┘
```

This architecture breaks both documented reinforcing loops:

- **R1 hidden drift:** every declared installed surface is detectable from the manifest, so a manual repair becomes visible drift instead of undeclared capability.
- **R2 documentation lag:** generated inventory and command fragments come from the same contract as lifecycle behavior, so workarounds cannot silently become documentation truth.
- **B1 provenance:** doctor reports source, destination, expected digest, observed digest, owner, and remediation from one resolved plan.
- **B2 release gate:** portability, provenance, rollback, and clean-host receipts become promotion inputs; a failure blocks macOS release promotion.

### Authority Model

| Authority | Owns | Must Not Own |
|---|---|---|
| `ISA.md` | Accepted scope, constraints, criteria, decisions, verification | Installed paths, file digests, host inventory |
| Repository source | Public program bytes, templates, schemas, tests, docs sources | Host-generated state, provider data, operator secrets |
| Install-surface manifest | Installed-file provenance and lifecycle mechanics | Product acceptance, operator preferences, runtime routing policy |
| Transaction receipt | What one lifecycle invocation observed and changed | Future desired state or product scope |
| Host configuration | User-authored settings outside marked managed blocks | Public product source truth |
| Private provider/runtime authority | Credentials, sessions, databases, histories, local observations | Public release payload |

The manifest is subordinate to the repository and ISA: adding a manifest entry cannot ratify a feature, and omitting an ISA-approved surface is a provenance failure rather than a scope change.

### Component Responsibilities

| Component | Status | Responsibility | Typical Implementation |
|---|---|---|---|
| Install-surface manifest | New | Versioned inventory of source, destination, lifecycle class, mutability, platform/profile eligibility, verification, dependencies, rollback, and uninstall policy | `package/install-surface-manifest.json` plus JSON Schema |
| Manifest validator | New | Reject duplicate IDs/destinations, invalid class fields, unsafe path variables, cycles, and `NEVER-SHIP` contradictions before mutation | TypeScript/Bun CLI with schema validation and semantic checks |
| Host/profile resolver | New | Expand a closed set of path variables and select Darwin/Linux plus install flags without evaluating arbitrary shell | Pure TypeScript library returning a resolved inventory |
| Lifecycle planner | New | Produce deterministic ordered actions and skips from manifest, host facts, and command intent | Pure TypeScript module; JSON plan output for tests and `--dry-run` |
| Transaction executor | New | Backup, apply, verify, restart, commit receipt, and reverse failed actions | TypeScript core invoking narrowly scoped filesystem/service adapters |
| Class adapters | New | Implement `COPY`, `TRANSFORM`, `REGENERATE`, and negative `NEVER-SHIP` semantics | Adapter registry keyed by class/adapter ID, never commands embedded in JSON |
| Service adapter | New | Render service templates, stop/start in dependency order, probe health, and restore prior definitions | Darwin launchd adapter; Linux systemd adapter marked best-effort |
| Receipt store | New | Persist append-only install/update/rollback/uninstall evidence and ownership | `$TEMPERANCE_STATE_DIR/receipts/lifecycle/<transaction-id>.json` |
| Documentation projection | New | Generate inventory tables, supported flags, paths, and lifecycle command fragments | Deterministic generator with checked-in output or CI diff gate |
| `install.sh` | Modified | Parse stable public flags, set environment, invoke lifecycle `install`, display plan/result | Thin POSIX shell wrapper |
| Update command | New public entrypoint | Resolve version transition, require preflight, apply backup-first transaction | Thin shell/CLI wrapper over shared engine |
| `uninstall.sh` | Modified | Remove only receipt-proven managed artifacts, restore managed blocks/backups when declared, preserve state by default | Thin wrapper over lifecycle `uninstall` |
| `scripts/temperance-doctor.sh` | Modified | Combine existing runtime readiness with manifest provenance status | Read-only consumer of resolved inventory plus existing health probes |
| `verify.sh` / `scripts/verify-install.sh` | Modified | Validate repository hygiene and installed provenance without private-host assumptions | Read-only manifest checks; no separate hard-coded file list |
| `scripts/verify-all.sh` | Modified | Run canonical source, lifecycle, docs, sandbox, and platform gates | Release gate orchestrator; Darwin failures block release |
| Existing install helpers | Modified/retired behind adapters | Stop carrying independent inventories; delegate copy/config/service work to shared lifecycle APIs | Compatibility wrappers during migration, then minimal adapters |
| Existing launchd scripts | Modified | Consume rendered templates and shared transaction/health conventions | Service adapter entrypoints, not independent installers |
| Linux systemd installer | Modified | Consume the same service description and receipt model | Best-effort adapter; results visible but non-blocking for v1.1 promotion |

### Lifecycle Class Contract

| Class | Source rule | Host action | Verification | Rollback / uninstall |
|---|---|---|---|---|
| `COPY` | Repository file/tree is canonical immutable program material | Byte-for-byte copy or declared symlink | File SHA-256 or deterministic tree digest | Restore preimage, or remove only if receipt proves creation by Temperance |
| `TRANSFORM` | Repository template and named public inputs are canonical | Deterministic adapter writes output or managed block | Adapter/version, input digests, output digest, semantic probe | Restore preimage or remove only the identified managed block |
| `REGENERATE` | Repository owns schema/generator, not generated bytes | Generate from current host facts or live probes | Schema plus semantic/freshness probe; never compare to developer output | Remove/recreate only declared generated artifact; preserve unrelated state |
| `NEVER-SHIP` | Negative boundary, not an install action | No payload action is permitted | Public-tree/path/secret scan and forbidden-source assertion | None; lifecycle engine must never back up or ingest the private content into receipts |

`NEVER-SHIP` entries should describe prohibited categories or path patterns without reading file bodies. This permits boundary verification without turning the manifest or receipts into an index of private material.

### Manifest Record Shape

The manifest should be data, not executable configuration. Adapter names come from a closed code registry.

```json
{
  "schema_version": "temperance.install-surfaces.v1",
  "entries": [
    {
      "id": "codex-prompt-processing-hook",
      "source": "package/hooks/codex/PromptProcessing.hook.ts",
      "destination": "${CODEX_HOME}/hooks/PromptProcessing.hook.ts",
      "class": "COPY",
      "mutability": "immutable",
      "platforms": ["darwin", "linux"],
      "profiles": ["codex", "spine"],
      "optional": true,
      "depends_on": [],
      "verify": { "kind": "sha256" },
      "rollback": { "kind": "restore-preimage" },
      "uninstall": { "kind": "restore-or-remove-owned" }
    }
  ]
}
```

Required top-level metadata should include schema version and product/release version. Each actionable entry needs a stable ID, source or generator, destination, class, mutability, platforms, profiles, dependency list, verification probe, rollback behavior, and uninstall behavior. Transform entries additionally require a registered adapter and template-input declaration; service entries require a template, service manager, health probe, and start/stop dependencies.

Do not place shell snippets, arbitrary environment-variable expansion, secrets, private absolute paths, live digests, or operator choices in the manifest. Release entries may carry expected repository-source digests as provenance fields; observed host digests belong only in receipts. Any generated digest projection is disposable build output derived from the manifest and repository, never another authority.

## Recommended Project Structure

```text
package/
├── install-surface-manifest.json       # versioned provenance contract
├── install-surface-manifest.schema.json
├── lifecycle/
│   ├── cli.ts                          # install/update/doctor/verify/rollback/uninstall
│   ├── manifest.ts                     # load + schema/semantic validation
│   ├── resolve.ts                      # platform/profile/path resolution
│   ├── plan.ts                         # pure desired-vs-observed planner
│   ├── inspect.ts                      # read-only provenance observations
│   ├── transaction.ts                  # backup/apply/verify/reverse/receipt
│   ├── receipt.ts                      # versioned receipt schema and I/O
│   ├── adapters/
│   │   ├── copy.ts
│   │   ├── transform.ts
│   │   ├── regenerate.ts
│   │   ├── managed-block.ts
│   │   └── service.ts
│   └── platform/
│       ├── darwin.ts                   # release-blocking launchd behavior
│       └── linux.ts                    # best-effort systemd behavior
├── service-templates/
│   ├── launchd/                        # parameterized plist templates
│   └── systemd/                        # parameterized unit templates
└── docs-projection/
    └── generate.ts                     # manifest-derived documentation facts

scripts/
├── lifecycle.sh                        # optional stable shell bridge to CLI
├── verify-all.sh                       # canonical release gate
├── verify-install.sh                   # installed-surface verification wrapper
└── temperance-doctor.sh                # readiness + provenance presentation

tests/
├── lifecycle/                          # schema, planner, adapter, transaction tests
├── fixtures/clean-home/                # synthetic host trees only
├── sandbox-install.sh                  # end-to-end clean-home qualification
└── docs-continuity.sh                  # generated-fragment/command consistency
```

### Structure Rationale

- **`package/lifecycle/`:** one implementation for all six lifecycle verbs prevents inventory and rollback rules from diverging across shell scripts.
- **Pure resolver/planner modules:** doctor, verify, dry-run, and mutation share decisions while read-only paths remain incapable of writing.
- **Registered adapters:** transformations stay reviewable and testable; the manifest cannot execute arbitrary code.
- **`service-templates/`:** source-controlled, parameterized definitions replace plist/unit bytes copied from a workstation.
- **Receipt schemas beside the engine:** rollback consumes versioned evidence from the action that actually occurred, not current manifest assumptions.
- **Docs projection separated from lifecycle:** docs consume manifest facts without making prose or acceptance criteria part of the install contract.

## Architectural Patterns

### Pattern 1: Functional Core, Imperative Shell

**What:** Resolve and plan lifecycle actions as pure data, then pass an immutable plan to a narrow executor. Shell scripts only normalize environment and UX.

**When to use:** Every install, update, doctor, verify, rollback, and uninstall invocation.

**Trade-offs:** Adds a typed core and migration work, but makes dry-run accurate, tests hermetic, and command behavior consistent.

```typescript
const inventory = resolveManifest(manifest, host, profile);
const observations = await inspect(inventory); // read-only
const plan = planLifecycle(command, inventory, observations);
if (command.mutates) await executeTransaction(plan);
```

### Pattern 2: Transaction Journal with Compensation

**What:** Every mutating action records a preimage and compensation before mutation. The executor moves through `planned → backed-up → applied → verified → committed`; failure reverses completed actions in reverse dependency order.

**When to use:** Install, update, rollback, uninstall, and service promotion.

**Trade-offs:** Requires durable receipts and careful crash recovery. It is substantially safer than timestamped backups with no mapping from backup to action.

### Pattern 3: Managed-Block Ownership

**What:** Transform user-owned configuration by replacing a uniquely identified Temperance block while preserving all content outside that block. Record preimage digest, block ID, and output digest.

**When to use:** Codex/Claude/OpenCode/Cursor configuration where whole-file replacement would destroy user choices.

**Trade-offs:** Format-aware adapters are needed for JSON/TOML and comment behavior differs by format. If a tool rewrites configuration semantically, verify the managed semantics rather than relying only on markers.

### Pattern 4: Evidence as a Product Output

**What:** Doctor and verification return structured provenance records that human output renders. Release qualification stores sanitized aggregate receipts, not private host content.

**When to use:** Drift detection, clean-host qualification, rollback proof, and promotion.

**Trade-offs:** Receipt schemas must be versioned and aggressively redact paths/values. Receipts prove an observed run; they never become desired-state authority.

### Pattern 5: Generated Facts, Authored Guidance

**What:** Generate factual documentation fragments—surface inventory, flags, paths, lifecycle commands, platform status—from the manifest and CLI help. Keep architecture rationale, security explanations, and tutorials authored.

**When to use:** README, Quickstart, architecture visuals, rollback, security, contributing, changelog, and docs index/site continuity.

**Trade-offs:** Generated boundaries and deterministic formatting must be maintained, but factual drift becomes a CI diff rather than an operator workaround.

## Data Flow

### Install / Update Flow

```text
operator flags + host facts + repository release
                    │
                    ▼
manifest load → schema/semantic validation → profile/platform resolution
                    │
                    ▼
read-only inspection → ordered plan + explicit skips + risk summary
                    │
                    ▼
preflight (paths, tools, ports, permissions, NEVER-SHIP assertions)
                    │
                    ▼
backup preimages → apply COPY/TRANSFORM/REGENERATE → render services
                    │
                    ▼
verify provenance → start/restart services → health probes
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
       success               failure
  commit receipt       compensate in reverse
  update current ref    restore services/files
          │                    │
          └─────────► final sanitized receipt
```

An update must never mutate directly from “current manifest” to “new manifest.” It computes a transition between the prior committed receipt (which snapshots the installed manifest version and entry identities) and the candidate manifest, so removed and renamed surfaces have explicit disposition.

### Doctor / Verify Flow

```text
manifest + host/profile → resolved inventory → parallel read-only observations
                                                   │
                        source digest / output digest / schema / service health
                                                   │
                                                   ▼
                       per-entry status: pass | drift | missing | skipped | blocked
                                                   │
                              human table + machine-readable JSON + exit policy
```

`doctor` should explain and recommend; `verify` should enforce. Both use the same observation records. Optional missing surfaces are explicit skips. Required Darwin failures are errors. Linux-only compatibility failures are visible best-effort results for v1.1, not silently converted to success.

### Rollback Flow

```text
rollback <transaction-id>
    ↓
load and validate original receipt → confirm host has not diverged unexpectedly
    ↓
stop affected services in reverse dependency order
    ↓
restore preimages / remove transaction-created artifacts / restore managed blocks
    ↓
restore service definitions and prior loaded/enabled state
    ↓
run prior-release provenance + health probes
    ↓
write a new rollback receipt referencing the original transaction
```

Rollback is itself a transaction. It never edits the original receipt and never assumes the current manifest still describes the old installation.

### Uninstall Flow

Uninstall reads the latest ownership chain, removes only artifacts whose current digest or managed-block identity matches a Temperance-owned record, restores displaced preimages where policy says to restore, unloads services in reverse order, and leaves mutable state/backups/receipts by default. A separate explicit purge option may remove product-owned state after listing exact targets, but must never touch provider authority, PAI memory, credentials, sessions, or user content.

### Documentation Flow

```text
manifest + CLI --help + service catalog
                  ↓
       deterministic docs projection
                  ↓
README / Quickstart / architecture tables / rollback inventory / docs index
                  ↓
continuity test compares generated fragments and validates every named command
```

Documentation generation consumes provenance facts only. It must not derive release claims from a local receipt; release claims come from clean-host qualification and ISA verification.

### Key Data Flows

1. **Source convergence:** reference-host discoveries are classified; only public, generalized inputs enter repository source, while `atlasRecall.ts` remains an uninstalled private overlay.
2. **Desired state:** manifest plus explicit install profile resolves to a deterministic inventory; no live host file can add a desired surface.
3. **Observed state:** inspection hashes or semantically probes destinations without changing them.
4. **Mutation:** the executor applies only actions in the validated plan after recording compensation data.
5. **Evidence:** each action and probe emits sanitized structured evidence joined by transaction ID and manifest/release version.
6. **Promotion:** clean macOS install/update/rollback/uninstall and canonical verification receipts feed the release gate; Linux results accompany the release as best-effort compatibility evidence.

## Trust Boundaries

| Boundary | Threat / Failure Mode | Required Control |
|---|---|---|
| Repository checkout → lifecycle engine | Modified or incomplete source is treated as releasable | Validate manifest/schema, source existence, release version, and declared source digests before host mutation |
| Manifest data → command execution | A data field becomes arbitrary shell/path execution | Closed path-variable allowlist, path normalization, adapter registry, no shell snippets or `eval` |
| Product installer → user configuration | Whole-file overwrite or accidental ownership expansion | Managed-block/semantic adapters, preimage backup, user-content preservation tests |
| User process → service manager | Privilege escalation or broad privileged writes | Pre-render exact definitions, narrow destinations, explicit privilege boundary, validate before `sudo` |
| Service template → local network | Public binding exposes local control planes | Loopback defaults; any non-loopback exposure is a separate explicit policy gate |
| Public source → private provider/runtime state | Secrets, histories, or personal memory enter payload/receipt | `NEVER-SHIP` assertions, secret/path scans, no recursive backup of private roots, receipt redaction |
| Repository source → private overlay | Source convergence deletes or publishes `atlasRecall.ts` | Declare overlay exclusion; never infer it as stale product drift; test refresh preserves it |
| Runtime state → desired state | Manual repair silently becomes product truth | Runtime is observed only; convergence always points back to manifest/repository source |
| Receipt → rollback | Tampered, stale, or wrong-host receipt restores unsafe bytes | Versioned schema, transaction/host identity, digest checks, explicit conflict refusal |
| Documentation → operator action | Stale commands create workaround loops | Generate factual fragments and execute docs continuity tests against actual entrypoints |
| Linux qualification → release claim | Best-effort results accidentally imply parity | Platform-qualified status in receipt and docs; Darwin remains the v1.1 blocking gate |

## Integration Points

### Existing Internal Boundaries

| Boundary | Communication | Integration Rule |
|---|---|---|
| `install.sh` ↔ lifecycle core | Environment + structured CLI result | Preserve public flags; stop directly enumerating install scripts once migrated |
| `scripts/lib.sh` ↔ transaction executor | Compatibility adapter during migration | Centralize backup naming, atomic replacement, permissions, and receipt writes |
| Existing hook/skill installers ↔ manifest | Stable entry IDs and registered adapters | Every installed artifact has exactly one owner; no script-only hidden inventory |
| Doctor ↔ inspector | JSON observation API | Add provenance checks without removing existing runtime readiness probes |
| Verify scripts ↔ validator/inspector | Exit codes + JSON summaries | Repository verification and installed verification remain distinct but share manifest parsing |
| Launchd/systemd scripts ↔ service adapter | Rendered definition + lifecycle operations | Existing health and recovery logic becomes adapter behavior, not duplicate service inventories |
| Manifest Bridge/Zone ↔ lifecycle receipts | Read-only projection, if exposed | UI may display status but cannot approve, install, update, or redefine provenance |
| Docs generator ↔ manifest/CLI | Read-only deterministic projection | Generated facts are delimited; prose remains human-reviewed |
| CI ↔ clean-host harness | Receipts and exit status | macOS full spine/no-voice gates release; Linux/no-systemd result is reported best-effort |

### External and Host Boundaries

| Service / Surface | Integration Pattern | Notes |
|---|---|---|
| launchd | Parameterized per-user LaunchAgent templates | Release-blocking on macOS; loopback-only; restore loaded state on rollback |
| systemd | Parameterized unit templates through existing rollout path | Best-effort for v1.1; keep receipts compatible with shared lifecycle schema |
| OmniRoute | Health/readiness observation only unless separately enabled | Its credentials, databases, logs, histories, and backups remain private authority |
| Pulse / Voice | Optional service adapter and health probe | No-voice installation is a first-class clean-host qualification lane |
| Codex/Claude/OpenCode/Cursor | Copies plus managed configuration transforms | Preserve user configuration and surface-specific optionality |

## Mutable-State Separation

Use four physically and semantically distinct roots:

| Root | Contents | Lifecycle Policy |
|---|---|---|
| Repository/product root | Immutable public sources, templates, schemas | Read during install; never written by runtime |
| Installed program surfaces | Copies, symlinks, rendered service/config artifacts | Owned per manifest entry and transaction receipt |
| `$TEMPERANCE_STATE_DIR` | Generated state, logs, receipts, backups, caches, locks | Created empty/from schema; excluded from release payload; preserved on default uninstall |
| Provider/private roots | OmniRoute state, auth, PAI memory, sessions, private overlays | Neither copied nor recursively inspected; referenced only through narrow health probes |

The existing `product` symlink is useful as a source locator but is not provenance evidence. Installed destinations still require per-entry verification. Runtime services should write only beneath declared mutable roots, never into the repository checkout.

## Rollback and Crash Recovery Invariants

1. A mutating transaction obtains a lifecycle lock before inspection-to-apply and records the candidate manifest/release version.
2. Every destructive step has persisted compensation data before it runs.
3. File replacement is staged beside the destination, permissions are validated, and rename is atomic where the filesystem permits.
4. Service definitions are validated before unloading a working service.
5. Health failure triggers reverse-order compensation; it never leaves newly written bytes presented as successful.
6. A crash leaves a non-committed journal that doctor reports and a later command can resume only after revalidation or roll back explicitly.
7. Rollback verifies the restored version with its own recorded inventory, not the candidate manifest.
8. Uninstall refuses to remove a drifted user-owned target automatically; it reports the conflict and requires an explicit reviewed resolution.
9. Backups and receipts are never stored inside scanned skill/plugin directories.
10. Default uninstall preserves mutable state and recovery evidence; purge is separate and target-enumerated.

## Scaling Considerations

This is a local product, so meaningful scale is installed-surface count and release frequency rather than user traffic.

| Scale | Architecture Adjustments |
|---|---|
| Current v1.1 surface | One manifest, one process, sequential mutation, parallel read-only hashing/probes |
| Hundreds of entries / many optional profiles | Cache source digests per release; topologically group independent reads and service domains |
| Multiple installed releases / channels | Keep immutable, versioned manifests with explicit channel metadata; never turn receipts into a package registry |

### Scaling Priorities

1. **First bottleneck:** repeated hashing and health probes; parallelize read-only inspection with bounded concurrency and cache only repository-source digests.
2. **Second bottleneck:** broad service restarts; compute affected dependency subgraphs so unchanged services stay running.

Do not introduce a daemon, database, or remote control plane for lifecycle management in v1.1. A local CLI plus files and receipts is adequate and easier to audit.

## Anti-Patterns

### Anti-Pattern 1: Parallel Inventories

**What people do:** Maintain separate destination lists in install, doctor, verify, uninstall, tests, and docs.

**Why it's wrong:** Each repair updates only some lists, recreating R1 and R2.

**Do this instead:** One manifest and resolver; each command adds command-specific policy over the same resolved entries.

### Anti-Pattern 2: Manifest as a Second ISA

**What people do:** Put feature acceptance, preferences, or runtime governance into the install manifest.

**Why it's wrong:** It creates conflicting authority and lets packaging details silently ratify product behavior.

**Do this instead:** Keep the manifest limited to installed provenance and lifecycle mechanics; ISA remains the judge.

### Anti-Pattern 3: Executable Manifest Entries

**What people do:** Store shell commands or unconstrained templates in JSON and execute them.

**Why it's wrong:** Validation cannot bound behavior and a source-data error crosses the host trust boundary.

**Do this instead:** Use closed adapter IDs implemented and tested in code.

### Anti-Pattern 4: Backup Without Transaction Identity

**What people do:** Timestamp copies in a backup directory and later guess which file belongs to which install.

**Why it's wrong:** Rollback becomes archaeology and cannot prove completeness or ordering.

**Do this instead:** Journal preimages, actions, service state, digests, and compensation under one transaction ID.

### Anti-Pattern 5: Whole-File Configuration Ownership

**What people do:** Copy developer config or replace the operator’s complete config file.

**Why it's wrong:** It imports private state and destroys user-authored settings.

**Do this instead:** Use managed blocks or semantic patches with exact ownership and reversible preimages.

### Anti-Pattern 6: Runtime-to-Source Promotion

**What people do:** Treat a live-only file as automatically canonical because it makes the reference host work.

**Why it's wrong:** Manual repairs become undeclared product behavior and may contain private coupling.

**Do this instead:** Classify, generalize, test, and ratify before source convergence. Keep `atlasRecall.ts` private for this milestone.

### Anti-Pattern 7: Success Receipts Without Failure Evidence

**What people do:** Write a receipt only after success.

**Why it's wrong:** Interrupted installs leave unexplained partial state.

**Do this instead:** Persist a journal before mutation and finalize it as committed, rolled-back, or recovery-required.

### Anti-Pattern 8: Platform Outcome Flattening

**What people do:** Make all platform checks warnings or all of them blockers.

**Why it's wrong:** Either macOS regressions ship or Linux best-effort work blocks the stated v1.1 policy.

**Do this instead:** Encode release policy outside surface provenance: Darwin qualification blocks promotion; Linux results remain explicit best-effort evidence.

## Dependency-Ordered Build Sequence

| Order | Build Slice | Depends On | Exit Gate / Risk Reduced |
|---|---|---|---|
| 1 | Freeze authority boundaries and lifecycle vocabulary | Ratified milestone intake | ISA remains sole judge; manifest scope is provenance-only; classes and mutable/private boundaries are unambiguous |
| 2 | Add manifest schema, semantic validator, and complete current-surface inventory | 1 | Every known surface has one stable ID, owner, class, destination rule, platform/profile, and negative boundary; no host mutation yet |
| 3 | Build pure resolver, inspector, and deterministic planner | 2 | Same fixture produces same plan; unsafe paths/cycles/duplicate destinations fail; doctor can report drift read-only (B1 begins) |
| 4 | Converge public source against the validated inventory | 2–3 | Router, hooks, Bridge, Zone, enrichment, and four skills have no unmapped public live-only capability; private overlay and never-ship scans pass |
| 5 | Implement transaction journal, COPY adapter, and managed TRANSFORM adapter | 3–4 | Empty-home install and idempotent re-install pass without services; preimages and compensation are proven |
| 6 | Add REGENERATE adapters and mutable-state initialization | 5 | Generated artifacts begin from public schemas/live probes, never developer state; runtime writes stay outside repo |
| 7 | Convert service definitions to templates and integrate Darwin adapter | 5–6 | launchd install/update/health/rollback is transactional and loopback-only; macOS lane becomes release-blocking |
| 8 | Integrate Linux systemd adapter as best-effort | 7 | Same service/receipt concepts work on Linux; failure is visible but does not block v1.1 promotion |
| 9 | Migrate update, rollback, and uninstall onto the engine | 5–8 | Install→update→rollback and install→uninstall restore fixture digests; drift conflicts refuse destructive action |
| 10 | Migrate doctor, verify-install, and canonical verify gates | 3–9 | No independent inventories remain; provenance/path/private-boundary failures block macOS promotion (B2 closes loop) |
| 11 | Generate documentation facts and enforce continuity | 2, 9–10 | Every documented command exists; inventory/diagram fragments match manifest; authored guidance remains reviewable |
| 12 | Clean-host qualification and release slicing | All prior | macOS full-spine and no-voice receipts pass; Linux receipt is attached; clean clone `scripts/verify-all.sh` passes before human promotion |

### Ordering Rationale

- Schema and read-only detection come before source convergence so every discovered drift has an explicit owner and disposition.
- Source convergence precedes mutation so the new engine never faithfully installs incomplete or private-coupled payloads.
- File transactions precede services because service rollout compounds rollback ordering and health risk.
- Darwin is implemented and gated before Linux because macOS is the release target; Linux reuses proven contracts without redefining them.
- Lifecycle behavior stabilizes before documentation generation, avoiding documentation that canonizes transitional commands.
- Clean-host qualification is last but its fixtures and receipt schema should be introduced early enough to shape every component.

## Qualification and Release Gate

The canonical promotion decision should consume, at minimum:

1. Manifest schema and complete-inventory validation.
2. Public-tree private-path/secret/`NEVER-SHIP` scan.
3. Clean macOS full-spine install, doctor, verify, update, rollback, uninstall, and post-uninstall preservation checks.
4. Clean macOS no-voice flow proving optional Pulse/Voice behavior fails open.
5. Linux/no-launchd or systemd best-effort compatibility receipt with explicit status.
6. Documentation continuity and generated-fragment diff check.
7. Clean-clone `scripts/verify-all.sh` result.
8. Sanitized provenance receipt linking release version, manifest version, platform, profile, and probe outcomes.

Any failed required macOS portability, provenance, private-boundary, rollback, or documentation-continuity check blocks promotion until repaired. A retry creates a new receipt linked to the failed one; it does not overwrite evidence.

## Sources

- `.planning/PROJECT.md` — current milestone intent, authority order, constraints, and platform policy (HIGH confidence)
- `docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` — ratified source/runtime audit, lifecycle map, verification matrix, and build stages (HIGH confidence)
- `docs/architecture.md` — current product/runtime components, services, ports, and public packaging boundary (HIGH confidence)
- `install.sh`, `uninstall.sh`, and `scripts/lib.sh` — current lifecycle orchestration and backup behavior (HIGH confidence)
- `scripts/verify-all.sh`, `scripts/verify-install.sh`, and `verify.sh` — current canonical verification and duplicated inventory/path gates (HIGH confidence)
- `scripts/temperance-doctor.sh` — current readiness checks and host-state observations (HIGH confidence)
- `scripts/temperance-manifest-bridge-launchd.sh`, `scripts/temperance-manifest-console-launchd.sh`, `scripts/temperance-proxy-launchd.sh`, and `scripts/install-temperance-proxy-systemd.sh` — current service promotion/rollback patterns (HIGH confidence)
- `scripts/rebuild-readme.sh`, `scripts/readme-continuity-check.sh`, and `tests/docs-continuity.sh` — existing documentation generation and continuity mechanisms (HIGH confidence)
- `tests/sandbox-install.sh` — current empty-home, idempotency, backup, rollback, and operator-file preservation fixtures (HIGH confidence)

---
*Architecture research for: v1.1 Public Temperance Glove*
*Researched: 2026-08-19*
