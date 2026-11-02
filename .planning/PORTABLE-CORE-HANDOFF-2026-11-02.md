# Portable phase core and Vestibule source handoff

This bounded slice is independent of the held v1.1 roadmap. Base source is 42b391b44b7655972d9322d87aa3865956a5165e. VERSION remains 0.8.0.

## Changed source

- `package/router/portable-phase-kernel.ts`: pure, no-profile process frames, strict run/task/manifest/phase identity, canonical phase advancement, bounded retries and descriptive lane/skill intent. Reuses public composition inspection and phase metadata. Every frame denies execution authorization and acceptance assertion.
- `package/install-surface/src/composition/vestibule.ts`: one injected read-only orientation provider and consumer through existing `runOrganLifecycle`. Bounded immutable cards, symbolic public/synthetic digest refs, event/plant/manifest provenance and freshness. Trusted callbacks are not sandboxed.
- Two new fixture files, source sequence, provenance/capability matrix and clarified current architecture/composition prose. Current router is OmniRoute. Retired Superset/Constellation and historical aliases are not activation targets.
- Existing ISA retains prior evidence and adds ISC-853..872. The last two remain held for install/rollback and native callback proof.

## Actual verification

Combined focused command (the six existing baseline files plus both new fixture files):

```sh
bun test package/router/phase-projection.v4.test.ts package/router/surface-portability.test.ts package/install-surface/test/composition.test.ts package/install-surface/test/composition-lifecycle.test.ts package/install-surface/test/composition-projection.test.ts package/install-surface/test/composition-owner-projection.test.ts package/router/portable-phase-kernel.test.ts package/install-surface/test/vestibule.test.ts
```

Result: 103 pass, 0 fail, 544 assertions across 8 files. The 18 new fixtures also pass alone with 129 assertions. Targeted TypeScript 5.9.3 checks include both modules and both new test files and pass. The full install-surface `bun run typecheck` also passes. STE docs gate: 40 files, 0 failures; baseline was not raised. `git diff --check` passes.

Independent review reproduced an expiry between validation and consumer entry. The final handler samples the delivery time and checks both deadline and context expiry before calling the consumer. The regression uses [t,t,t+2] with expiry t+1. Direct provider payload proxies and then getters are refused before await; native promises from trusted adapters remain outside isolation claims. Consumer cancellation is cooperative and unsettled timeout remains visible.

## Held and rollback

No source fixture proves real host installation, callback linkage, durable production ledger, hosted authentication, qualified long-context, clean-host v1.1 or semantic outcome acceptance. Other five organs remain optional declarations without portable adapters. Later pressure/process/lock promotion remains separate. No installed runtime, services, provider config, memory, scheduler, company catalog or vault receipts changed.

The install/preimage/rollback contract is documented in `docs/plans/2026-11-02-portable-capabilities.md`; its adapter and disposable-host probes are absent. Source rollback is a normal source revert. No live changes need reversal.

Original primary dirty checkouts and the independent staged README preparation are preserved. This slice does not edit README, push branches, merge, release or deploy.
