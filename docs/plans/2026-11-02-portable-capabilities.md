# Portable source capability matrix

Date: 2026-11-02. Release baseline: 42b391b44b7655972d9322d87aa3865956a5165e, VERSION 0.8.0. This branch adds source for review. It does not qualify a new release.

## Evidence levels

Source means code and fixtures exist at a revision. Installed means a receipt binds the selected bytes to a target. Runtime means the actual host callback was observed. Accepted means the owning ISA criteria passed. These levels remain separate. A configuration observation or digest proves neither authenticity nor permission. Koshas describe work layers; they are not security boundaries.

| Area | State | Source evidence | Installed / runtime / accepted |
| --- | --- | --- | --- |
| Five Koshas and seven phases | Shipped | `package/router/phase-projection.v4.ts` | Host-specific; source metadata grants no authority |
| Composition and lifecycle | Shipped | Existing `composition/contracts.ts`, `inspect.ts`, `lifecycle.ts`, projections and fixtures | Adapters must prove actual linkage and durable atomic ledger |
| Pure phase/run bookkeeping | Draft | New `package/router/portable-phase-kernel.ts`, seven-phase no-profile fixture | Not installed; host execution and acceptance unproved |
| Skill and lane intent | Draft | Logical `work.<phase>` and `phase.<phase>`, explicitly unsupported | No resolver, provider roster or admission adapter supplied |
| Vestibule orientation | Draft | New injected `composition/vestibule.ts`, synthetic callback and consumer readback | Real native callback, consumer integration and install held |
| Adytum, Nutrix, Auspex, Circulator, Praeceptor | Held | Public declarations and lifecycle subscriptions | Concrete portable adapters absent; no inference, repair, memory promotion or cadence activation |
| Organ containment | Optional shipped source | Previously reviewed guard source only | Later pressure, process and lock changes require a separate source-promotion slice |
| Hosted router authentication, clean-host v1.1, qualified long-context, durable recovery | Held | Existing source and qualification plans | Not established by these source fixtures |
| Portable install/preimage/rollback adapter for this slice | Gap | Contract below only | No install transaction or rollback proof performed |

## Source provenance

The new contract is independently authored against the public composition and phase-projection APIs. It reconciles the concepts of ordered phases, process states, bounded retries and no-profile startup with the private pure kernel reference at `5e764dbfebe1122d76753a42435c3d85e610553a` (`router/v4-kernel-contract.ts`, SHA-256 `5bc7c4678cbea88e5934c06d5de8c098959f8bf836c34c6656599b601304d8c6`). No private implementation is vendored. Private module admission, registry, provider resolution, skill selection, result verification, organ scripts and host bindings are excluded. No license claim for private source is made.

Public phases retain their existing alchemical labels. This slice reuses that metadata rather than changing historical presentation to match another kernel. Full private v4 envelope compatibility and effort fast paths are not claimed. The new schema names distinguish these smaller public process frames from private run envelopes.

## API and responsibilities

`startPortableRun` validates through the existing composition inspector and starts an Observe frame. `transitionPhase` checks a closed process transition table. `advancePhase` requires exact run, task, composition and phase identity plus completed process state, and advances in canonical order. `retryPhase` creates a bounded new attempt for a failed or blocked phase. Frames always carry `execution_authorized: false` and `acceptance_asserted: false`. The `admitted` process label is bookkeeping only; it grants no external admission or lease. No function runs work or marks the ISA accepted.

`phaseIntent` describes a Kosha, logical lane and skill intent. It always reports `unsupported`: this module has no adapter registry or capability admission policy. The existing composition, host router, executor and owning ISA remain their respective authorities.

`createVestibuleHandler` accepts trusted `provide`, `consume` and `now` callbacks and returns only the `organ.vestibule` callback for the existing lifecycle. The provider receives the lifecycle event, abort signal and deadline. Its context must bind the same plant, occurrence and manifest digest; canonical UTC timestamps have an exclusive expiry and at most a five-minute lifetime. Up to 16 bounded items use `public:sha256:<digest>` or `fixture:sha256:<digest>` provenance. Private visibility, arbitrary URLs, paths, extra fields, getters, proxies and malformed inputs are refused. Text filters are bounded input hygiene, not a secrecy detector or sandbox. The caller is responsible for selecting genuinely public context. Native promises from the trusted provider can perform their own assimilation before this handler receives a value. That behavior belongs to the provider boundary; the handler does not sandbox callbacks. No personal memory plane is read or merged.

An immutable advisory card reaches the consumer only after freshness and cancellation checks. The consumer receives the same abort signal. A consumer that has begun cannot be forcibly undone. The lifecycle truthfully records timeouts and unsettled callbacks, and commit failure stays `persistence-failed`; consumer readback alone is not durable acceptance. Synthetic in-memory ledgers are test fixtures, not a production ledger implementation.

## Installation and rollback contract — held

No installer registration or activation is part of this slice. A future install adapter must bind exact reviewed source digests, target identity, requested module set, preimages (including absent files), ownership and mode to a plan. It must reject changed preimages before apply, back up prior bytes, and emit a bounded transaction receipt. Real callback linkage and consumer readback must be separately observed on that target.

Rollback must operate only on receipt-owned bytes. It must refuse post-install drift, restore exact prior bytes and modes, remove only newly created receipt-owned artifacts, and retain a read-back result. It must not mutate provider state, memory, schedules or another plant. Missing preimages, concurrent changes, callback failures and interrupted apply/rollback require disposable-host fixtures before this gate can pass.

Until that adapter and its probes exist, installation, runtime and acceptance remain held. Source rollback is a normal revert of the source commit; there are no live runtime changes to undo.
