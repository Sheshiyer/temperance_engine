---
phase: 03-safe-profiles-and-transactional-lifecycle
plan: 03a
type: execute
wave: 3a
depends_on: ["03-01", "03-02"]
files_modified:
  - package/install-surface/src/lifecycle/journal.ts              # new
  - package/install-surface/src/lifecycle/hazards.ts              # new
  - package/install-surface/src/types.ts                          # requires schema extension (Task 3)
  - package/install-surface/test/lifecycle-safety.test.ts         # new
autonomous: false
requirements:
  - LIFE-01
  - LIFE-05
  - LIFE-06
  - SAFE-03
  - SAFE-05
  - SAFE-06
  - INST-03
must_haves:
  truths:
    - "The compensation journal entry is written and flushed BEFORE each mutation (LIFE-01); a crashed run is recoverable roll-forward or exact rollback from the journal alone (LIFE-05)"
    - "Symlink/hardlink/parent-swap/wrong-path-type hazards fail closed BEFORE any mutation and are re-checked per-step (SAFE-05); removal targets are enumerated record destinations only — zero recursive deletion (SAFE-06)"
    - "Rollback/uninstall REFUSE when unrecognized drift makes ownership ambiguous (LIFE-06) instead of destroying unknown content"
    - "Preflight detects missing required dependencies declared by records and exits before changing the machine (INST-03)"
    - "Traversal bound (SAFE-03): plan-time rejection of records carrying `..`, absolute, or provider-cache-shaped relative paths"
  artifacts:
    - package/install-surface/src/lifecycle/journal.ts
    - package/install-surface/src/lifecycle/hazards.ts
    - package/install-surface/test/lifecycle-safety.test.ts
  key_links:
    - "Journal + hazards are consumed by 03-03b's executor — the safety layer gates all mutation"
---

<objective>
Implement the safety foundation for the transactional lifecycle: compensation journal (written before mutation, crash-recoverable) and hazard preflight (fail-closed checks for symlinks, hardlinks, drift, traversal, dependencies). This is the prerequisite for 03-03b's planner/executor/receipts consumer layer.
</objective>

<context>
Split from original 03-03 per checker scope-sanity blocker (7 tasks / 9 files exceeded threshold). This plan owns the safety primitives; 03-03b owns the consumers that depend on them.

Ratified decisions 2–3 (`08-DISCUSSION-LOG.md`): transactions at `<TEMPERANCE_STATE>/transactions/<txid>/{journal.json, preimage/, receipt.json, manifest-before.json, manifest-after.json}`, retention last-N.

Code facts (checker-verified): `path-policy.ts` provides `ALLOWED_ROOT_TOKENS`, `assertDestination`, `segmentRelationship`; record variants carry `verification` + `rollback` policies (`types.ts`); `compileFragments(): CompileResult` is THE resolved-inventory API; doctor/orchestrator.ts:114 has stateRoot resolution; ObservationIO.execFile seam at orchestrator.ts:32.
</context>

<tasks>

## Task 1: Journal — compensation written before mutation (LIFE-01/05, type: execute)

**Files:** `src/lifecycle/journal.ts` (new), cases in `test/lifecycle-safety.test.ts`.

**Action:**
1. Transaction layout under `TEMPERANCE_STATE` resolution (reuse existing env-or-default wiring from `doctor/orchestrator.ts:114`; literal home path never appears in code): `transactions/<txid>/{journal.json, preimage/, receipt.json, manifest-before.json, manifest-after.json}`. `txid` = monotonic counter + short random suffix, lexicographically sortable.
2. `Journal.append(entry)` fsyncs THEN returns — callers mutate only after it resolves (ordering enforced by API shape). Entry kinds: `BEGIN{verb, profile, inventory_digest}`, `STAGE{step_id, destination_symbolic, mode}`, `COMMIT_STEP{step_id}`, `COMPENSATE{step_id, method}`, `ABORT{reason}`, `COMPLETE{receipt_ref}`.
3. Crash recovery: opening a tx dir whose journal lacks `COMPLETE`/`ABORT` offers exactly roll-forward (resume pending steps) or `rollback --select <txid>`; both driven off the journal alone. Test proves simulated mid-run crash (BEGIN+STAGE present, no COMMIT_STEP) recovers to pre-transaction bytes.
4. Retention: keep last N COMPLETE tx dirs (default 5), prune oldest first; never touch incomplete ones.

**Verify:** `bun test package/install-surface/test/lifecycle-safety.test.ts 2>&1 | tail -3` (injected temp-dir fs only).

**Acceptance criteria:** Journal-before-mutation provable; crash-recovery green; retention prunes complete-only.

## Task 2: Hazards — fail-closed preflight + drift refusal (SAFE-05/06, LIFE-06, type: execute)

**Files:** `src/lifecycle/hazards.ts` (new), cases in `test/lifecycle-safety.test.ts`.

**Action:**
1. Preflight over the PLANNED step list before journal BEGIN: per destination, `assertDestination` then lstat-probe for symlink (any component), hardlink (st_nlink>1), parent-swap risk, wrong path type → `HazardError(code)` before any write. Codes: `DEST_SYMLINK`, `DEST_HARDLINK`, `PARENT_SWAP`, `PATH_TYPE_CONFLICT`.
2. Per-step re-check immediately before each mutation (TOCTOU closure).
3. **Drift refusal (LIFE-06):** for update/uninstall/rollback, compare destination bytes against BOTH the pre-image recorded in the referenced transaction AND the expected managed content; unrecognized drift on an `exclusive-path` destination (file differs from everything we can account for) → refuse with `OWNERSHIP_AMBIGUOUS` listing the drifted paths, exit non-zero, zero mutations. Managed-block destinations refuse only when drift exists OUTSIDE the block.
4. Removal enumeration: remove ONLY paths enumerated in verified record destinations (`exclusive-path`) or marker-delimited block ranges; remover takes paths from records, never directory scans. `segmentRelationship` rejects a step that is an ancestor of another record's destination without a declared dependency edge.
5. Traversal bound (SAFE-03): plan-time rejection test for records carrying `..`, absolute, or provider-cache-shaped relative paths.

**Verify:** `bun test package/install-surface/test/lifecycle-safety.test.ts 2>&1 | tail -3`

**Acceptance criteria:** Every planted hazard fails with zero writes; sibling file survives uninstall; drifted exclusive-path file blocks uninstall until acknowledged.

## Task 3: Dependency preflight (INST-03, type: execute)

**Files:** `src/lifecycle/hazards.ts` (same module), cases in `test/lifecycle-safety.test.ts`.

**Action:**
1. Records may declare required runtime dependencies (extend record schema minimally: optional `requires: [{kind:"http-health", url_token:string} | {kind:"binary", name:string}]`; absent = no requirement, all 18 current records unaffected).
2. Preflight checks each `requires` entry (HTTP probe via injectable fetch; binary via PATH lookup through injected execFile) and fails with `DEPENDENCY_MISSING` + remediation text BEFORE journal BEGIN — machine untouched.
3. Doctor v2 host section (Plan 03-01) later derives its probes FROM these declarations rather than duplicating them — note in code comment referencing spec §3.2 derivation table.

**Verify:** included in safety suite run above.

**Acceptance criteria:** Missing-dependency fixture fails pre-execution with actionable remediation; zero-write proven.

## Task 4: Safety verification gate (type: verify)

```bash
# 1. Safety suite green
bun test package/install-surface/test/lifecycle-safety.test.ts 2>&1 | tail -5

# 2. Hazard fail-closed: zero writes per planted hazard
bun test package/install-surface/test/lifecycle-safety.test.ts -t 'hazard' 2>&1 | tail -3

# 3. Crash recovery
bun test package/install-surface/test/lifecycle-safety.test.ts -t 'crash' 2>&1 | tail -3

# 4. Drift refusal
bun test package/install-surface/test/lifecycle-safety.test.ts -t 'drift' 2>&1 | tail -3

# 5. Privacy sweep
grep -R -nE '/Users/[A-Za-z0-9_.-]+|\.craft-agent|sqlite' package/install-surface/src/lifecycle/ \
  && echo 'FAIL: private pattern in lifecycle' || echo 'lifecycle clean'
```

**Acceptance criteria:** All safety gates green; zero-write hazard proofs; crash recovery byte-exact; drift refusal blocks ambiguous destruction.
</tasks>

<verification>
```bash
# Full safety suite
bun test package/install-surface/test/lifecycle-safety.test.ts 2>&1 | tail -5

# Existing suites untouched
bun test package/install-surface 2>&1 | tail -3

# Repo gate
TEMPERANCE_ROOT="$PWD" bash scripts/verify-install.sh >/dev/null 2>&1 && echo 'verify-install PASS'
```
</verification>

<success_criteria>
- Journal precedes every mutation; crash mid-run recoverable from journal alone (LIFE-01/05).
- Hazards + dependency checks fail closed pre-flight AND per-step; drift-refusal blocks ambiguous destruction (LIFE-06); removal enumeration-only; siblings survive (SAFE-05/06).
- Traversal bound rejects unsafe paths (SAFE-03); missing deps detected pre-mutation (INST-03).
- All safety primitives ready for 03-03b's executor to consume.
</success_criteria>
