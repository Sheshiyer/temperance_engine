---
phase: quick
plan: 260907-fxk
status: complete
source_baseline: 71d0793
evidence_class: source-only-synthetic
---

# RO-03 pure routing observation adapter

Implemented `package/router/routing-observation-adapter.ts` and its synthetic tests. The only production imports are `node:util` for intrinsic proxy detection and the existing router-local generated contract. Canonical and generated contracts are unchanged.

## Public seam

`adaptRoutingObservation(input, context)` accepts unknown runtime values against exported exact TypeScript interfaces `RoutingObservationEvidence` and `RoutingObservationContext`. Context supplies observation/project tokens, timestamps, evidence mode, source provenance and the explicit receipt policy. Evidence supplies request outcome, an available bounded attempt record collection or explicit unavailable state, and tool lifecycle coverage or explicit unavailability.

Each attempt has an observation binding (opaque token or explicit null), ordinal, phase, outcome, termination, and available or unavailable identity. Only a unique bound terminal success with completed/non-streamed termination and a reviewed provider/model pair yields observed attribution. Identical duplicate assertions collapse; distinct successful ordinals remain ambiguous. Conflicting assertions for the same successful bound ordinal remain ambiguous regardless of input order, including incomplete termination contradictions. Unbound, foreign or unfinished success evidence remains unavailable. Failed earlier attempts cannot replace the serving identity. Unsupported catalog pairs never reach receipt content or its digest.

Tools remain independent of request outcome and attribution. Complete zero/nonzero counts require complete coverage and explicit terminal evidence. Failure, open tools and missing coverage stay incomplete, with deterministic reason precedence: failure, open tools, then coverage. Missing instrumentation remains unavailable with no counts. The seam never accepts a requested/configured head, HTTP status, raw trailer, connection/account data, free-form metadata or private evidence bag.

Descriptor-first detachment rejects getters, proxies (including revoked proxies), nonplain prototypes, hidden/symbolic keys, cycles, coercion hooks, malformed strings and sparse/oversized arrays without calling caller code. Counts and ordinals are bounded to 10,000; a full 10,000-attempt fixture verifies linear grouping. Input and context stay unchanged. Rejections use fixed `INVALID_EVIDENCE` or `INVALID_CONTEXT` adapter codes; validated receipt generation retains the contract result type.

## Verification receipts

- `bun test package/router/routing-observation-adapter.test.ts package/contracts/routing-observation-receipt.v1.test.ts` — exit 0; 36 pass, 0 fail, 842 assertions, final run 75 ms.
- `bun --no-env-file test package/router/routing-observation-adapter.test.ts package/contracts/routing-observation-receipt.v1.test.ts` — exit 0; 36 pass, 0 fail, 842 assertions, 138 ms.
- `node scripts/sync-routing-observation-contract.mjs --check` — exit 0; `{"ok":true,"changed":[]}`.
- Adapter source test verifies the exact import closure and absence of process/environment, IO/network, logging, clock/random and dynamic-import access.
- `git diff --check`, plus `git diff --no-index --check /dev/null` for each new TypeScript file — no whitespace diagnostics.
- Self-review tightened same-attempt contradiction precedence and added regression cases for pending and incomplete success assertions, plus the full evidence bound.

Only the two assigned TypeScript files and this quick plan/summary were created/updated by the worker. No tracked pre-existing source changes were made by that worker. No install, merge, push, host/runtime/provider/combo/database/Superset action, live observation or external execution claim is established by these source tests.

## Independent review and coordinator checkpoint

Independent Astra review returned PASS with no actionable findings. Its separate
synthetic probes checked 216 attempt variants, 432 ordering comparisons and 140
tool combinations, in addition to the 36-test suite. The coordinator reran the
no-env suite (36 pass / 842 assertions) and contract parity check before source
commit `201ea72`.

The coordinator records this completion only in the GSD quick-task table.
RO-04 bridge admission, installed-layout proof and host integration retain their
separate acceptance boundaries.
