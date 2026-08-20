# Phase 1: Provenance Contract and Read-Only Control Plane - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-20
**Phase:** 01-provenance-contract-and-read-only-control-plane
**Areas discussed:** Manifest organization, Private-boundary records, Public doctor command, Doctor presentation and exits

---

## Manifest Organization

### Authoring model

| Option | Description | Selected |
|---|---|:---:|
| Domain fragments plus compiled inventory | Contributors edit domain JSON fragments; a deterministic resolver emits one canonical inventory. | ✓ |
| One canonical JSON manifest | Contributors edit one large file directly. | |
| the agent's discretion | Planner chooses while preserving deterministic output and zero unnecessary dependencies. | |

**User's choice:** Domain fragments plus compiled inventory.
**Notes:** The combined inventory is derived; fragments remain the authored source.

### Compiled inventory location

| Option | Description | Selected |
|---|---|:---:|
| Committed lockfile | Commit the generated lockfile, reject regeneration drift in CI, and package the reviewed bytes. | ✓ |
| Release artifact only | Generate the combined inventory only during packaging. | |
| the agent's discretion | Planner chooses while guaranteeing deterministic digest binding. | |

**User's choice:** Committed lockfile.
**Notes:** Preferred filename is `install-surface-manifest.lock.json`.

### Surface identity

| Option | Description | Selected |
|---|---|:---:|
| Immutable semantic ID plus digest | Readable IDs survive moves; digests track content changes separately. | ✓ |
| Path-derived IDs | Source moves become removal and recreation. | |
| Opaque generated IDs | IDs survive moves but reduce human readability. | |

**User's choice:** Immutable semantic ID plus digest.
**Notes:** Intentional identity changes require explicit migration.

### Schema evolution

| Option | Description | Selected |
|---|---|:---:|
| Strict versions with explicit migrations | Reject unknown fields/versions; use minor additions and explicit breaking migrations. | ✓ |
| Current plus previous major | Support two major versions concurrently. | |
| Forward-tolerant parsing | Ignore unknown fields when possible. | |

**User's choice:** Strict versions with explicit migrations.
**Notes:** Validation fails before mutation.

---

## Private-Boundary Records

### NEVER-SHIP representation

| Option | Description | Selected |
|---|---|:---:|
| Symbolic records plus deny policy | Explain known exclusions and enforce generic private patterns separately. | ✓ |
| Symbolic records only | Represent only explicitly known exclusions. | |
| Deny policy only | Enforce exclusions without named manifest explanations. | |

**User's choice:** Symbolic records plus deny policy.
**Notes:** Public records never contain absolute private paths or secret values.

### Private overlay visibility

| Option | Description | Selected |
|---|---|:---:|
| Presence and policy only | Report logical identity, presence, and policy without paths, traversal, or digests. | ✓ |
| Resolved path without contents | Expose the host path but not contents. | |
| Do not mention overlays | Omit private-overlay observations entirely. | |

**User's choice:** Presence and policy only.
**Notes:** Host identity must not leak into logs or receipts.

### Unexpected deny match

| Option | Description | Selected |
|---|---|:---:|
| Fail before mutation or packaging | Stop and identify the symbolic rule; never silently alter the candidate. | ✓ |
| Automatically exclude and continue | Remove the match and finish with a changed candidate. | |
| Warn without blocking | Report the match while allowing the action. | |

**User's choice:** Fail before mutation or packaging.
**Notes:** Show repository-relative offending paths only when safe.

### Registry ownership

| Option | Description | Selected |
|---|---|:---:|
| Host-owned private registry | Store versioned metadata under the operator Temperance state root. | ✓ |
| Gitignored project configuration | Store registrations within each project. | |
| Environment variables only | Supply bindings per process/session. | |

**User's choice:** Host-owned private registry.
**Notes:** Restrictive permissions are mandatory; public tools never traverse registered roots.

### Missing or unsafe registry

| Option | Description | Selected |
|---|---|:---:|
| Absence normal; unsafe metadata fails | Missing means no overlays; malformed/insecure/escaping metadata fails. | ✓ |
| Warn for every condition | Treat absence and unsafe states alike as warnings. | |
| Fail when absent or invalid | Require a registry for every installation. | |

**User's choice:** Absence is normal; unsafe metadata fails.
**Notes:** No registry is a healthy public installation state.

### Public metadata fields

| Option | Description | Selected |
|---|---|:---:|
| Minimal allowlist | Expose only schema, logical ID, class, enabled, presence, and policy-rule ID. | ✓ |
| Descriptive metadata | Also expose labels, providers, and notes. | |
| Aggregate status only | Expose only counts and overall status. | |

**User's choice:** Minimal allowlist.
**Notes:** Paths and opaque bindings remain inside the private adapter.

### Optional overlay health

| Option | Description | Selected |
|---|---|:---:|
| Optional-state ladder | Map disabled/unregistered to SKIPPED, present to PRIVATE, missing enabled to WARN, and unsafe metadata to FAIL. | ✓ |
| Enabled and missing fails | Make unavailable enabled overlays fail complete doctor. | |
| Private state never affects health | Report privately without influencing overall health. | |

**User's choice:** Optional-state ladder.
**Notes:** Optional private availability cannot redefine the public product contract.

### Unregistration behavior

| Option | Description | Selected |
|---|---|:---:|
| Remove registration only | Delete only the registry record and retain a minimal private receipt. | ✓ |
| Retain disabled tombstone | Keep the logical record indefinitely. | |
| Remove registration and data | Delete the registered overlay root. | |

**User's choice:** Remove registration only.
**Notes:** Overlay data is never traversed, modified, moved, or deleted.

---

## Public Doctor Command

### Public entry point

| Option | Description | Selected |
|---|---|:---:|
| `temperance doctor` | Compose install, privacy, and runtime sections behind one public command. | ✓ |
| Expand `manifest-bridge doctor` | Make the bridge component own whole-product diagnosis. | |
| `temperance install doctor` | Keep installation diagnosis separate from runtime health. | |

**User's choice:** `temperance doctor`.
**Notes:** Component doctors remain available for focused diagnosis.

### Mutation boundary

| Option | Description | Selected |
|---|---|:---:|
| Never; repairs use separate commands | Every doctor remains read-only; repair gets separate safety contracts. | ✓ |
| Top-level doctor only stays read-only | Preserve mutating flags on component doctors. | |
| Allow explicit `--repair` | Permit mutation when a repair flag is supplied. | |

**User's choice:** Never; repairs use separate commands.
**Notes:** Existing mutating doctor flags must be moved, not grandfathered.

### Section selection

| Option | Description | Selected |
|---|---|:---:|
| Complete default plus `--section` | Run everything by default; repeatable filters produce partial reports. | ✓ |
| Doctor subcommands | Use nested install/runtime/privacy commands. | |
| No filtering | Always run every section. | |

**User's choice:** Complete by default with `--section` filters.
**Notes:** Supported examples are install, privacy, and runtime.

### Component failure

| Option | Description | Selected |
|---|---|:---:|
| Collect all available evidence | Bound each section, mark UNAVAILABLE, and continue collecting. | ✓ |
| Fail immediately | Stop at the first section failure. | |
| Skip unavailable sections | Continue without treating missing evidence as unhealthy. | |

**User's choice:** Collect all available evidence.
**Notes:** Overall health is computed only after all bounded sections finish.

---

## Doctor Presentation and Exits

### Default human report

| Option | Description | Selected |
|---|---|:---:|
| Drift-first summary plus `--verbose` | Lead with health, non-healthy items, and remediation; expand safe details on request. | ✓ |
| Exhaustive report by default | Print every surface and field on each run. | |
| Overall status only | Require JSON for detail. | |

**User's choice:** Drift-first summary with `--verbose` details.
**Notes:** JSON remains complete under every human presentation mode.

### Condition vocabulary

| Option | Description | Selected |
|---|---|:---:|
| Explicit conditions | PASS, DRIFT, WARN, FAIL, SKIPPED, UNSUPPORTED, PRIVATE, UNAVAILABLE. | ✓ |
| Pass/warn/fail only | Put all distinctions in subordinate reason codes. | |
| Numeric severities | Translate numeric levels into human prose. | |

**User's choice:** Explicit condition vocabulary.
**Notes:** Every check also carries a stable reason code and severity.

### Process exits

| Option | Description | Selected |
|---|---|:---:|
| Three-level contract | Separate healthy reports, reports with findings, and doctor malfunction. | ✓ |
| Binary success/failure | Collapse findings and malfunction into one nonzero outcome. | |
| One code per status | Assign a unique exit number to every condition. | |

**User's choice:** Three-level contract.
**Notes:** Exit 0 = no actionable finding; 1 = actionable finding; 2 = no trustworthy report.

### JSON compatibility

| Option | Description | Selected |
|---|---|:---:|
| Versioned document envelope | Emit one stable, deterministically ordered whole-report schema. | ✓ |
| Streaming JSON Lines | Emit each check independently as it completes. | |
| Loosely structured JSON | Mirror human output without a compatibility promise. | |

**User's choice:** Versioned document envelope.
**Notes:** The envelope includes generation time, scope, requested sections, overall condition, exit code, manifest digest, and ordered records. Breaking changes require a new schema major version.

## the agent's Discretion

- Exact fragment filenames and domain grouping.
- Internal adapter boundaries and timeout durations.
- Stable reason-code names and implementation sequence.
- JSON minor-version field naming that preserves the locked envelope contract.

## Deferred Ideas

- Repair command implementation and transaction safety belong to Phase 3.
- Overlay registration/unregistration mutation commands belong to a later lifecycle plan.
- Full public source convergence and packaging enforcement belong to Phase 2.
