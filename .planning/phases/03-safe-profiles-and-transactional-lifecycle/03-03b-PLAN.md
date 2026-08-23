---
phase: 03-safe-profiles-and-transactional-lifecycle
plan: 03b
type: execute
wave: 3b
depends_on: ["03-01", "03-02", "03-03a"]
files_modified:
  - package/install-surface/src/lifecycle/planner.ts              # new
  - package/install-surface/src/lifecycle/executor.ts             # new
  - package/install-surface/src/lifecycle/receipts.ts             # new
  - package/install-surface/src/cli.ts                            # install|update|rollback|uninstall|receipt verbs
  - package/install-surface/test/lifecycle.test.ts                # new
autonomous: false
requirements:
  - PROV-06
  - INST-04
  - INST-05
  - INST-07
  - LIFE-02
  - LIFE-03
  - LIFE-07
  - LIFE-08
must_haves:
  truths:
    - "All four mutating verbs consume the profile-resolved CompileResult from Plan 03-02 — one inventory, one digest, shared with doctor v2 receipts (PROV-06)"
    - "Failed application never reads as committed: exit non-zero, receipt status=failed, manifest-after absent (Phase 3 SC3)"
    - "User-authored content outside Temperance-owned blocks survives install/update and is recorded in the receipt (INST-07); uninstall restores displaced content and is idempotent (LIFE-07)"
    - "Receipts carry zero private values: symbolic paths only (LIFE-08); every planned entry reports installed/skipped/unsupported/failed in the summary report (INST-05)"
    - "Missing optional dependencies produce visible skips; explicitly selecting an unavailable optional capability fails with actionable guidance (INST-04)"
  artifacts:
    - package/install-surface/src/lifecycle/planner.ts
    - package/install-surface/src/lifecycle/executor.ts
    - package/install-surface/src/lifecycle/receipts.ts
    - package/install-surface/src/cli.ts (five new verbs)
    - package/install-surface/test/lifecycle.test.ts
  key_links:
    - "receipt.inventory_digest == CompileResult.digest == doctor v2 inventory_digest on same tree+profile"
    - "03-03a's journal + hazards are consumed here — safety layer gates all mutation"
---

<objective>
Implement the transactional lifecycle consumer layer: planner, executor, and receipts modules in install-surface, exposed as `temperance install | update | rollback | uninstall | receipt` verbs that persist compensatable transactions under `TEMPERANCE_STATE`, refuse ambiguous destruction, and preserve user content. Depends on 03-03a's safety primitives (journal + hazards).
</objective>

<context>
Split from original 03-03 per checker scope-sanity blocker. This plan owns the consumer layer; 03-03a owns the safety primitives it depends on.

Ratified decisions 2–3: executor as `package/install-surface/src/lifecycle/{planner,executor,receipts}.ts` with thin shell wrappers; transactions at `<TEMPERANCE_STATE>/transactions/<txid>/...`.

Code facts: record variants carry `verification` + `rollback` policies (`types.ts`); `compileFragments(): CompileResult` is THE resolved-inventory API; CLI dispatch at `cli.ts:62-87`; 03-03a provides `Journal` (journal.ts) + hazard preflight + dependency preflight (both in hazards.ts — dependency checks are invoked via the hazards module's `preflightDependencies` step within `hazards()`, not a separate top-level export).

Standing constraints: doctor read-only forever; failed apply ≠ committed; shell-script thinning happens here via deprecation notices (decision 2).
</context>

<tasks>

## Task 1: Planner + executor — staged atomic promotion (LIFE-02/03/07, type: execute)

**Files:** `src/lifecycle/planner.ts`, `src/lifecycle/executor.ts` (new), cases in `test/lifecycle.test.ts`.

**Action:**
1. Planner input `{verb, profileResult: CompileResult}`; output ordered steps honoring `depends_on` topologically (cycle → `PLAN_DEPENDENCY_CYCLE`), one family per class:
   - `COPY`: stage → sha256 verify → promote
   - `TRANSFORM`: render via allowlisted adapter → verify per `verification.adapter_id` → promote
   - `REGENERATE`: invoke `generator_id` → semantic-probe verify → promote
   - Managed-block destinations: read existing file, splice marker-delimited Temperance block, preserve ALL outside-block content byte-exactly (INST-07)
   - `NEVER-SHIP`: planner refuses (`PLAN_NEVER_SHIP_MUTATION`)
2. Executor ordering per step: hazards(step) → `journal.append(STAGE)` → stage into `<dest-dir>/.temperance-stage-<step>` SAME filesystem, declared mode → verify → `journal.append(COMMIT_STEP)` → atomic rename promotion. Preimage of displaced bytes → `preimage/<step_id>` (policy `restore-backup`) or removal-list (policy `remove-installed`).
3. Verb semantics: `install` fresh (fails if owned-and-present unless `--force`), `update` reconcile preserving outside-block content, `uninstall` restore-preimages/remove-installed per record policy, idempotent second run exits 0 (LIFE-07), `rollback --select <txid>` replays COMPENSATE entries reverse order.
4. Verify failure mid-run: ABORT appended, staged removed, preimages intact, exit 1, receipt `status:"failed"`, manifest-after NOT written (failed apply ≠ committed).
5. Per-entry outcome taxonomy (INST-05): final summary renders EVERY planned entry as installed | skipped(reason) | unsupported(platform) | failed(record_id, reason) — no silent omissions.
6. **Unavailable optional capability (INST-04 second clause):** when a record declares an optional dependency (via03-03a's `requires` schema extension) and that dependency is missing, the planner marks the record `skipped(DEPENDENCY_MISSING, <remediation>)` in the outcome taxonomy. However, when the user explicitly selected that record's capability via `--profile` or `--force` and the dependency is unavailable, the executor exits non-zero with `CAPABILITY_UNAVAILABLE` listing the missing dependency and actionable remediation text (install command / URL) — this is a hard failure, not a silent skip. Test proves: explicit selection of a record with a missing optional dependency fails with guidance text, while the same record under a broader profile is silently skipped.

**Verify:** `bun test package/install-surface/test/lifecycle.test.ts 2>&1 | tail -3` — must include: outside-block preservation verbatim; killed-mid-promotion restorable byte-exactly; double-uninstall idempotent; rollback byte-equal assertion; outcome taxonomy covers all four states on a mixed fixture.

**Acceptance criteria:** All four verbs green on fixtures; INST-07 preservation; failed-apply proves receipt=failed AND no manifest-after AND original bytes intact.

## Task 2: Receipts — redaction + digest linkage (LIFE-08, PROV-06, type: execute)

**Files:** `src/lifecycle/receipts.ts` (new), cases in `test/lifecycle.test.ts`. (CLI wiring of the `receipt` subcommand moves to Task 3 which owns `src/cli.ts`.)

**Action:**
1. Success receipt: `{schema:"temperance.lifecycle.receipt.v1", txid, verb, profile, inventory_digest, started_at, finished_at, status:"committed", steps:[{id, record_id, destination_symbolic, outcome}], user_content_preserved:[...], manifest_after_digest}`; before/after canonical bytes persisted alongside.
2. `inventory_digest` MUST equal the input `CompileResult.digest` — same value doctor v2 reports (test asserts doctor-vs-receipt equality over an injected fixture tree).
3. Redaction: symbolic paths everywhere (`$HOME/...`, `$TEMPERANCE_STATE/...`); serialized-receipt grep gate for `/Users/`, `/Volumes/`, home literals.
4. `readReceipt(txid)` module API only in this task — returns the receipt object programmatically. CLI subcommand wiring (`temperance receipt [--select <txid>] [--json]`) lands in Task 3.

**Verify:** `bun test package/install-surface/test/lifecycle.test.ts 2>&1 | tail -3`

**Acceptance criteria:** Receipt schema-valid, digest-linked to doctor, redaction-clean, retrievable both programmatically and via CLI within this task's own checkpoint.

## Task 3: CLI mutating verbs (type: execute)

**Files:** `src/cli.ts`.

**Action:**
1. Add to argv dispatcher: `install [--profile P] [--dry-run] [--force]`, `update [--profile P] [--dry-run]`, `uninstall [--profile P] [--dry-run]`, `rollback --select <txid>`, `receipt [--select <txid>] [--json]` (read-only; consumes `readReceipt()` from Task 2's receipts module). `--dry-run` prints planner output (steps, symbolic destinations, hazards found, dependency check results) with ZERO writes — test asserts fs snapshot identical.
2. Explicit invocation only, no prompts. Platform filtering already handled by compile-time eligibility; a profile yielding zero applicable records exits 2 `NO_APPLICABLE_RECORDS`.
3. Deprecation notices added to `scripts/install-spine.sh`, `scripts/install-pai.sh`, `scripts/install-gsd.sh` pointing at the verbs (decision 2 thinning step 1; actual script retirement is a later consumer-migration wave, mirroring the doctor's M5/M6 pattern).

**Verify:**
```bash
bun run package/install-surface/src/cli.ts install --profile minimal --dry-run 2>&1 | head -15
bin/temperance doctor --record 2>&1 | grep -qi 'read-only' && echo 'guard holds'
bun test package/install-surface 2>&1 | tail -3
```

**Acceptance criteria:** Dry-run zero-writes (fs snapshot test); guard intact; scripts carry notices but remain functional; suites green.

## Task 4: Full-plan verification gate (type: verify)

```bash
# 1. Whole-suite green
bun test package/install-surface package/manifest-bridge 2>&1 | tail -5

# 2. PROV-06 concreteness — FIXTURE-DRIVEN
bun test package/install-surface/test/lifecycle.test.ts -t 'digest linkage' 2>&1 | tail -3

# 3. Privacy sweep extends to lifecycle sources
grep -R -nE '/Users/[A-Za-z0-9_.-]+|\.craft-agent|sqlite' package/install-surface/src/lifecycle/ \
  && echo 'FAIL: private pattern in lifecycle' || echo 'lifecycle clean'

# 4. Failed-apply rehearsal re-run by name
bun test package/install-surface/test/lifecycle.test.ts -t 'failed apply' 2>&1 | tail -3

# 5. Repo gate still green
TEMPERANCE_ROOT="$PWD" bash scripts/verify-install.sh >/dev/null 2>&1 && echo 'verify-install PASS'
```

**Acceptance criteria:** All gates green; digest linkage demonstrated on fixtures inside the suite (gate 2), never against the operator's real state root.
</tasks>

<verification>
```bash
# Rollback exactness + crash recovery re-runs by name
bun test package/install-surface/test/lifecycle.test.ts -t 'rollback restores' 2>&1 | tail -3
bun test package/install-surface/test/lifecycle.test.ts -t 'crash recovery' 2>&1 | tail -3

# Profile integration: lifecycle consumes 03-02's filtered inventories end-to-end
bun test package/install-surface/test/profiles.test.ts -t 'deterministic' 2>&1 | tail -3

# Doctor untouched: v2 emits five sections, v1 default intact, guard holds
bun run package/install-surface/src/cli.ts doctor --report v2 --json | python3 -c "
import json,sys; r=json.load(sys.stdin)
assert r['schema']=='temperance.doctor.report.v2'; print('doctor v2 intact')"
bin/temperance doctor --record 2>&1 | grep -qi 'read-only' && echo 'guard holds'
```
</verification>

<success_criteria>
- One profile-resolved CompileResult feeds compile, doctor, and all four mutating verbs; receipt digest == doctor digest on fixtures (PROV-06 demonstrated).
- Staged same-filesystem atomic promotion with declared modes; displaced bytes restorable byte-exactly (LIFE-02/03).
- Outside-block user content preserved + receipted; uninstall idempotent (INST-07, LIFE-07); every entry reported installed/skipped/unsupported/failed (INST-05).
- Receipts symbolic-clean and CLI-retrievable; retention prunes complete-only (LIFE-08).
- Deprecation notices on shell scripts (incremental delivery: notices now, script retirement in a later consumer-migration wave mirroring doctor's M5/M6 pattern); doctor guard intact.
</success_criteria>
