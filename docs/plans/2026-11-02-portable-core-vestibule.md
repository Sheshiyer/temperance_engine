# Portable core and Vestibule source sequence

Date: 2026-11-02. Base: 42b391b44b7655972d9322d87aa3865956a5165e. Release remains 0.8.0.

This plan precedes source construction. It implements a bounded review slice, not the v1.1 clean-host milestone.

1. Reuse public phase metadata and composition validation. Add a pure, no-profile phase/run contract with strict identity, bounded transitions and logical skill/lane intent. Do not add a planner, registry, provider resolver or acceptance ledger.
2. Prove a synthetic seven-phase cycle with no provider, profile, private storage or UI. Check illegal transitions, identity drift, terminal states and missing adapters.
3. Add one injected Vestibule orientation handler through the existing public lifecycle runner. The caller selects bounded public/synthetic context and a consumer. There are no default host reads, refreshes, repairs or writes.
4. Test lifecycle callback and consumer readback with an in-memory disposable replay ledger. Check stale/private/cross-plant data, replay, concurrent delivery, cancellation and callback/ledger failures.
5. Record source provenance, capability state and separate install/preimage/rollback requirements. Correct current routing and retired-surface prose without erasing historical evidence.
6. Run affected tests, type checks and documentation gates. Commit reviewable source only. Keep installation, native callback linkage, hosted authentication and acceptance held.

Other five advisory organ adapters remain optional declarations. Later organ containment pressure/process/lock changes require a separate source review. No installed runtime, provider configuration, memory store, scheduler, company catalog or vault receipt changes belong to this slice.
