---
id: 260907-cmj
title: "Temporary-root replay for reviewed non-COPY lifecycle surfaces"
status: complete
base: 0a4f7713d3aeb5a833bc544e60fa179f6fffddf1
workflow: gsd-quick
scope: source-only
---

# G2: temporary-root replay for non-COPY lifecycle records

## Objective

Make the two public non-COPY records honest lifecycle participants without
touching a host installation. `configuration.codex-managed-block` must render
the committed Codex guidance into its declared managed block while preserving
user-owned bytes. `manifest.zone-project-state` has no governed producer in
this source tree, so it must be reported as explicitly unavailable and must
never be materialized from a synthetic placeholder.

The implementation must bind transform preimages, rendered output digests, and
modes before mutation; rollback and the install doctor must consume that same
binding. All verification uses injected temporary roots. It does not install to
the connected Mac, restart launchd, mutate OmniRoute, change a combo, invoke
Superset/Hands, or claim a runtime receipt.

## Locked scope and invariants

- `managed-template-v1` is the only registered non-COPY producer in this
  slice. It reads `templates/codex.AGENTS.md` through the supplied
  `repositoryRoot`, then replaces or appends exactly the
  `temperance-engine` managed block in `$CODEX_HOME/AGENTS.md`.
- The adapter must reject an unsafe source/destination, malformed, duplicate,
  unbalanced, or nested target markers, rather than guess which user content
  it owns. Bytes outside the declared block remain byte-for-byte unchanged.
- A pre-existing regular destination keeps its mode; an absent destination
  receives a declared safe regular-file mode. Every staged and promoted
  non-COPY output is checked for regular-file type, single link, exact mode,
  and SHA-256.
- Before the first non-COPY mutation, write a durable non-COPY transaction
  manifest containing each record/step, class, producer id, source digest when
  present, prior state (absent or preimage digest/mode), expected output
  digest/mode, ownership kind, and destination symbol. Bind the manifest hash
  in the journal `BEGIN` entry. A mismatched/missing manifest or destination
  drift makes recovery fail closed.
- Recovery restores an existing preimage through a fresh verified stage and
  restores its saved mode. It removes an originally absent destination only
  after it still equals the recorded produced digest/mode. It never traverses
  or removes an unknown sibling/sentinel.
- `manifest-zone-v1` remains semantically allowed by the schema but has no
  registered generator. Default-profile processing records an explicit
  `unavailable` outcome with `GENERATOR_UNAVAILABLE` and does no destination
  write; explicit selection fails with the same precise cause before mutation.
  It must not write the former HTML comment placeholder.
- Doctor verification uses the registered producer and the completed,
  current-lock transaction binding. It verifies only the managed block for a
  managed-block transform, preserves the distinction between user-owned
  outside bytes and product-owned content, verifies the bound mode, and never
  treats raw source/destination equality as transform proof. An unavailable
  generator or an absent/untrusted non-COPY binding reports `UNAVAILABLE`, not
  `PASS`, `SKIPPED`, or an inferred healthy state.

## Must-have truths

1. A temporary `$CODEX_HOME/AGENTS.md` with user text receives exactly one
   current Temperance block and retains all outside text and the existing file
   mode.
2. The lifecycle never emits a fake manifest-zone file; callers and doctor can
   distinguish unavailable generation from intentionally skipped/platform
   unsupported records.
3. A non-COPY rollback restores the original bytes and mode, refuses a
   destination altered after installation, and leaves an unrelated sentinel
   untouched.
4. The full public record set can be replayed against explicit temporary
   `HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `TEMPERANCE_STATE` bindings;
   no test uses the process defaults or writes a host path.

## Execution order

`01-producer-contracts` -> `02-lifecycle-recovery` ->
`03-doctor-and-full-replay`. The files shared by later tasks make each edge a
deliberate dependency; no task is safe to parallelize with its successor.

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Define and test governed non-COPY producer contracts</name>
  <files>package/install-surface/src/lifecycle/non-copy.ts, package/install-surface/src/types.ts, package/install-surface/test/non-copy.test.ts</files>
  <behavior>
    - A repository-contained, regular template source renders into one declared managed block while preserving bytes before and after that block.
    - Missing target markers append one bounded block; duplicate, crossed, unpaired, nested, symbolic, hard-linked, binary, or out-of-root inputs fail closed.
    - A present destination retains its mode; an absent destination receives the explicit regular-file mode carried by the producer result.
    - `manifest-zone-v1` returns a typed unavailable result with `GENERATOR_UNAVAILABLE`; it has no content or output hash.
  </behavior>
  <action>Create the narrow TypeScript producer registry and discriminated result contract before changing the executor. Keep `managed-template-v1` as the sole available producer: resolve its source below the injected repository root, validate it as an owned text regular file, and use a strict managed-block parser rather than calling the permissive helper blindly. Expose source digest, rendered output digest, output mode, ownership, and producer identity only for an available result. Add a typed unavailable branch for unimplemented generators; do not introduce a generic fallback renderer or change the semantic allow-list merely to hide its absence. Extend shared lifecycle/step types only as needed to distinguish `unavailable` from profile/platform `skipped` and `unsupported` without breaking existing COPY outcomes.</action>
  <verify>
    <automated>bun test package/install-surface/test/non-copy.test.ts</automated>
  </verify>
  <done>Pure producer tests pass using temporary directories only; the registry can render the real managed template and makes an unknown generator observable as unavailable without writing a placeholder.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Bind non-COPY mutations and recovery to verified state</name>
  <files>package/install-surface/src/lifecycle/executor.ts, package/install-surface/src/lifecycle/journal.ts, package/install-surface/src/lifecycle/planner.ts, package/install-surface/test/lifecycle.test.ts, package/install-surface/test/lifecycle-safety.test.ts</files>
  <behavior>
    - The executor removes unavailable optional generator steps before staging, reports the exact unavailable reason, and rejects an explicitly selected unavailable record before any destination mutation.
    - For a managed transform, the executor captures prior absent/preimage bytes and mode plus source/output digest/mode before `BEGIN`, validates stage and promotion, and writes a journal-bound non-COPY manifest.
    - An injected failure after a committed transform produces an abort receipt without overwriting the original target or an unrelated sentinel.
    - Rollback restores a saved preimage and mode only when the target still matches the recorded produced output; a drifted target causes a nonzero, non-destructive result. An originally absent target is removed only when it still matches the bound output.
  </behavior>
  <action>Wire the Task 1 registry into `createPlan`, `executePlan`, journal persistence, and `rollbackTransaction`. Perform producer availability resolution and explicit-selection handling before a journal/destination mutation; propagate the precise outcome through receipt rendering and CLI-visible results. Replace the TRANSFORM raw-copy branch and the REGENERATE comment branch with producer results. Capture and hash a non-COPY manifest before `BEGIN`, then verify staged/promoted content, type, link count, and mode against it. Update generic rollback so mixed COPY/non-COPY transactions are recoverable only from their respective verified manifests, using a fresh sibling stage for restoration and refusing unknown current content. Keep COPY tree semantics and current legacy fail-closed behavior intact. Write failure-injection and mode/preimage tests with `LifecycleIO` and `resolveRoot` mapped to `mkdtemp` roots; do not assign `HOME`, `CODEX_HOME`, or `TEMPERANCE_STATE` to host paths.</action>
  <verify>
    <automated>bun test package/install-surface/test/non-copy.test.ts package/install-surface/test/lifecycle.test.ts package/install-surface/test/lifecycle-safety.test.ts</automated>
  </verify>
  <done>Transactions bind and verify non-COPY state before mutation; unavailable generation has no synthetic output; recovery proves byte/mode restoration, drift refusal, and sentinel preservation in temporary roots.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Make doctor and full temporary-root replay consume the same contract</name>
  <files>package/install-surface/src/doctor/sections/install.ts, package/install-surface/test/doctor.test.ts, package/install-surface/test/full-surface-replay.test.ts</files>
  <behavior>
    - Doctor recognizes a managed transform only through the producer contract and its complete current-lock transaction binding; it accepts user-owned outside-block bytes, checks the managed block and bound file mode, and never reports a raw source-byte comparison as PASS.
    - Doctor reports `GENERATOR_UNAVAILABLE`/`UNAVAILABLE` for `manifest-zone-v1`, even though that record is optional; it does not claim the record was generated.
    - A test-owned full public plan installs all available public COPY records plus the managed transform into explicit temporary root bindings, records the generator as unavailable, and writes no real user root.
    - The same fixture injects a promotion/recovery failure and proves rollback restores pre-existing managed content/mode, removes only declared newly-created artifacts, and preserves an unknown sentinel.
  </behavior>
  <action>Replace class-generic doctor comparison with non-COPY producer-aware observations. Read only a completed, integrity-checked non-COPY manifest whose journal inventory digest matches the current lock; otherwise return an explicit unavailable/warning diagnostic without treating mutable source bytes as proof. For managed-block ownership, parse the current destination safely and compare the bounded product block against the producer’s current template, while retaining user-owned outside content as non-authoritative. Create a full-surface fixture that compiles the public records and calls the real lifecycle with injected `HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `TEMPERANCE_STATE` temporary roots and an explicit repository source root. Test normal replay, unavailable generator reporting, injected failure, rollback, corruption/drift refusal, and sentinel survival. Do not invoke launchctl, network, a provider gateway, Superset, Hands, or any installed host entrypoint.</action>
  <verify>
    <automated>bun test package/install-surface/test/full-surface-replay.test.ts package/install-surface/test/doctor.test.ts package/install-surface/test/non-copy.test.ts package/install-surface/test/lifecycle.test.ts package/install-surface/test/lifecycle-safety.test.ts && bun test package/install-surface/test && bun build package/install-surface/src/cli.ts --target bun --outfile /tmp/temperance-install-surface-g2-cli.js && bun build package/install-surface/src/doctor/orchestrator.ts --target bun --outfile /tmp/temperance-install-surface-g2-doctor.js</automated>
  </verify>
  <done>The doctor and lifecycle agree on the same bound non-COPY facts; an isolated full-surface replay and rollback pass without emitting a host-installation, service, combo, provider, or runtime claim.</done>
</task>

</tasks>

<threat_model>

## Trust boundaries

| Boundary | Description |
|---|---|
| repository template to lifecycle | A source template becomes product-owned bytes in a user-adjacent configuration file. |
| lifecycle to temporary destination | The executor changes a declared file beneath injected root bindings. |
| transaction manifest to recovery/doctor | Persisted hashes and modes authorize restoration and observation. |
| optional generator registry | A fragment may name a semantically allowed producer that is not implemented in this source tree. |

## STRIDE register

| Threat ID | Category | Component | Disposition | Mitigation |
|---|---|---|---|---|
| T-G2-01 | Tampering | managed-template-v1 input/output | mitigate | Repository containment, lstat/type/link checks, strict marker parsing, stage/promote digest and mode verification. |
| T-G2-02 | Tampering | rollback | mitigate | Journal-bound manifest hashes, preimage modes, current-output drift check, fresh verified restore stage, allowlisted removal only. |
| T-G2-03 | Spoofing | generator availability | mitigate | Typed producer registry; unregistered generator is explicit `GENERATOR_UNAVAILABLE`, never rendered by a fallback. |
| T-G2-04 | Repudiation | transaction/doctor evidence | mitigate | Bind non-COPY manifest digest in `BEGIN`; doctor accepts only completed current-lock bindings. |
| T-G2-05 | Elevation | root bindings and path handling | mitigate | Injected absolute temporary roots, containment checks, no process-default root reliance in tests, symlink/hardlink refusal. |
| T-G2-06 | Denial of service | malformed markers/manifests | mitigate | Fail closed with bounded parsing and clear diagnostics before mutation. |
| T-G2-07 | Information disclosure | doctor/receipts | accept | Keep symbolic destinations/digests only; do not add host paths, raw user content, prompts, provider data, or secrets to projections. |
</threat_model>

## Completion boundary

The task is complete when the focused and full install-surface test suite plus
the two Bun builds pass, and the quick-task summary records only source and
temporary-root evidence. A passing result does not authorize a host install,
launchd restart, Superset/Hands handoff, combo change, provider attempt, or
runtime claim.
