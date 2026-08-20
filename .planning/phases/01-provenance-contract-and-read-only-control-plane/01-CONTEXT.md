# Phase 1: Provenance Contract and Read-Only Control Plane - Context

**Gathered:** 2026-08-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 defines and validates the public install-surface provenance contract, its deterministic resolved inventory, the private-boundary metadata contract, and the strictly read-only `temperance doctor` interface. It covers PROV-01–05, PROV-07, DOCT-01–05, SAFE-04, and SAFE-07.

This phase may create schema, resolver, validation, inspection, and reporting behavior. It does not converge the repository payload (Phase 2), perform installation or repair mutations (Phase 3), implement service lifecycle control (Phase 4), or qualify release hosts (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Manifest Organization

- **D-01:** Contributors author domain-specific JSON fragments. A deterministic resolver validates and combines them into one canonical inventory.
- **D-02:** The generated inventory is committed as `install-surface-manifest.lock.json`. CI must reject regeneration drift, and release artifacts package those exact reviewed bytes.
- **D-03:** Every surface has an immutable, human-readable semantic ID that survives source moves. Content changes are tracked independently through digests; intentional identity changes require an explicit migration.
- **D-04:** Schema validation is strict. Unknown fields and unsupported versions fail closed. Additive changes increment the minor version; breaking changes require a new major version and an explicit migration path.

### Private-Boundary Records

- **D-05:** Known NEVER-SHIP surfaces appear as public-safe symbolic records. A separate generic deny policy blocks emerging secret, database, log, history, memory, backup, and private-root patterns.
- **D-06:** Public doctor output may report only a private overlay's logical identity, presence state, and exclusion policy. It must never print its resolved path, traverse its contents, or calculate its digest.
- **D-07:** An unexpected deny-policy match stops validation, mutation, and packaging before side effects. The error names the symbolic rule and shows a repository-relative offending path only when safe; the candidate is never silently altered.
- **D-08:** Optional private overlays register in a versioned, host-owned private registry under the operator Temperance state root with restrictive permissions. The repository is never the registry authority.
- **D-09:** An absent private registry is healthy and means no overlays. Malformed records, unsafe permissions, or bindings escaping the operator-owned state root fail privacy validation.
- **D-10:** Public tooling may read only registry schema version, logical overlay ID, overlay class, enabled state, presence status, and policy-rule ID. Paths, opaque bindings, labels, provider names, and notes stay private.
- **D-11:** Overlay health uses an optional-state ladder: disabled or unregistered is `SKIPPED`; enabled and present is `PRIVATE`; enabled but missing is `WARN`; malformed, insecure, or policy-violating registry state is `FAIL`.
- **D-12:** Unregistering removes only the host-owned registry record. It never traverses, moves, modifies, or deletes overlay data. A private local receipt retains only logical ID and timestamp.

### Public Doctor Command

- **D-13:** `temperance doctor` is the single public inspection entry point. It composes named install-provenance, private-boundary, and runtime-health sections; component doctors remain available for focused diagnostics.
- **D-14:** Every doctor command is permanently read-only. Existing mutating doctor flags must move to separately governed repair or lifecycle commands with their own preview, backup, and confirmation contracts.
- **D-15:** Running without filters checks every section. Repeatable `--section install`, `--section privacy`, and `--section runtime` filters narrow execution and mark the report explicitly partial.
- **D-16:** Sections execute with bounded timeouts. A crashed, timed-out, or unavailable section becomes `UNAVAILABLE`; remaining sections continue, and overall health is calculated after evidence collection finishes.

### Doctor Presentation and Exits

- **D-17:** Human output is drift-first and remediation-first: overall health, section summaries, every non-healthy item, and actionable remediation appear first. `--verbose` expands every public-safe inventory record and observation.
- **D-18:** Human and JSON reports share `PASS`, `DRIFT`, `WARN`, `FAIL`, `SKIPPED`, `UNSUPPORTED`, `PRIVATE`, and `UNAVAILABLE`. Every check also carries a stable reason code and severity.
- **D-19:** Process exits use three levels: `0` for a trustworthy report without actionable findings, `1` for a trustworthy report with actionable findings, and `2` when doctor cannot produce a trustworthy report because of invalid arguments, schema, or orchestration failure.
- **D-20:** `temperance doctor --json` emits one versioned document envelope containing generation time, complete/partial scope, requested sections, overall condition, exit code, manifest digest, and deterministically ordered section/check records. Breaking compatibility changes require a new schema major version.

### the agent's Discretion

Downstream research and planning may choose exact fragment filenames and groupings, internal module boundaries, timeout durations, reason-code names, and implementation sequencing. Those choices must preserve all decisions above, introduce no new production dependency without justification, and keep the authored fragments plus committed lockfile as the only public provenance authority.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Authority and Acceptance

- `.planning/PROJECT.md` — Core value, authority order, product boundary, platform posture, and private-overlay decision.
- `.planning/REQUIREMENTS.md` — Approved Phase 1 requirement wording and milestone traceability.
- `.planning/ROADMAP.md` — Phase 1 goal, dependency position, requirement allocation, and observable success criteria.
- `ISA.md` — Acceptance judge for ratified scope and verification evidence; the manifest must not become a competing preference store.

### Public Glove Provenance

- `docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` — COPY/TRANSFORM/REGENERATE/NEVER-SHIP model, source/runtime evidence, lifecycle boundaries, manifest seed, and verification matrix.
- `docs/manifest-control-plane.md` — Existing Manifest Bridge/console responsibilities, observational safety boundary, redaction posture, and component-doctor behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `package/manifest-bridge/src/contract.ts`: strict normalization, schema literals, bounded redaction, and safe evidence-pointer patterns can inform public manifest and report validation.
- `package/manifest-bridge/src/doctor.ts`: reusable check/report formatting and runtime observations exist, but `repairDuplicateEvents` and `repair_duplicates` violate the new universal read-only doctor contract and must be separated.
- `package/manifest-bridge/src/types.ts`: established literal schema constants and discriminated status/state types provide a compatible TypeScript style.
- `package/manifest-bridge/src/cli.ts`: existing `doctor`, `--json`, and `--verbose` routing can become a component adapter behind the new top-level command.
- `package/manifest-bridge/src/catalog.ts`: atomic temporary-file promotion and bounded registry locking are established local persistence patterns; the install manifest itself remains a separate public authority.

### Established Patterns

- Schema names are explicit versioned strings such as `temperance.manifest.doctor.v1`.
- Human and machine reports are produced from the same structured object.
- Loopback/runtime observations remain bounded and secret-free.
- Atomic file replacement uses a same-directory temporary followed by rename.
- Observer failures are isolated so remaining evidence can still be collected.

### Integration Points

- A new install-surface schema/resolver layer should sit beside, not inside, the event-catalog authority in `package/manifest-bridge/src/`.
- `temperance doctor` must compose install, privacy, and existing Manifest Bridge runtime adapters without parsing rendered human text.
- `verify.sh` and `scripts/verify-all.sh` must validate fragment compilation, lockfile drift, unsafe paths, duplicate ownership, and JSON compatibility.
- The eventual installer, updater, rollback, and uninstall commands consume the same resolved inventory in later phases.

</code_context>

<specifics>
## Specific Ideas

- Preferred generated filename: `install-surface-manifest.lock.json`.
- Preferred command: `temperance doctor` with repeatable `--section` filters, `--verbose`, and `--json`.
- Each JSON check record must include stable ID, source, destination token, class, expected state, actual state, condition, reason code, severity, remediation, and public-safe evidence.
- Private overlay examples such as `atlasRecall.ts` remain explainable symbolically while their host paths and contents remain invisible.

</specifics>

<deferred>
## Deferred Ideas

- Actual repair commands and their transactional safety contract belong to Phase 3.
- Private overlay registration/unregistration mutation commands belong to a later lifecycle plan; Phase 1 defines only their ownership and observation contracts.
- Public source convergence and release-tree deny enforcement across the complete payload belong to Phase 2, built on this phase's contract.

</deferred>

---

*Phase: 01-provenance-contract-and-read-only-control-plane*
*Context gathered: 2026-08-20*
