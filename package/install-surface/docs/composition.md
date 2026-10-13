# Standalone modular composition

Temperance Engine owns reusable module contracts and native coordinator adapters.
It works without Cambium or Noesis Cambium. Noesis Cambium owns an optional personal
integration; Cambium owns company operations. Each plant owns its bindings and credentials.

Run `bun src/cli.ts composition inspect` from the install-surface package with a
JSON stdin packet containing `manifest` and optional `observations`. The example
`examples/standalone-composition.v1.json` requires no integrations or Superset.
The dedicated `src/composition/cli.ts inspect` uses the same implementation.

The contract declares a native coordinator, module owners, symbolic references
and dependencies. Inspection validates identity, plant isolation, dependency closure
and bounded fresh observations. It prints deterministic configuration evidence with
effects disabled. Caller-provided healthy or admitted observations never authorize
execution. Adapters must independently prove authorization, account capacity,
effects and owner read-back.

Optional organs, Hands, A2A, routing, Constellation, banners and islands share these
declarations. This source slice does not install or activate them. Reusable code
belongs here; personal profiles belong in Noesis Cambium; company admissions and
result lineage belong in Cambium.

Remaining implementation order: causal organ lifecycle; Git workspace admission
independent of Superset; per-account capacity and native handoff; lifecycle receipts;
typed companion actions; shared redacted projections and independent runtime acceptance.
Thoughtseed, HeyZack and external fleets retain distinct configuration and authority.

## Advisory causal lifecycle

`runOrganLifecycle` accepts explicit versioned subscriptions and public
`temperance.organ-lifecycle-event.v1` metadata. Harness adapters must translate
legacy/private events; the public contract never accepts prompts, tool output or
machine paths. There are no default triggers or automatic module activation.

An injected atomic ledger claims a stable plant/occurrence identity before any
callback. Dependency-ordered advisory handlers produce a terminal receipt. Replay,
missing handlers, failed dependencies, stale configuration, timeout and persistence
failure stay visible. A callback that ignores cancellation is reported as unsettled;
requesting cancellation does not prove termination. Configuration inspection never
grants execution or repair authority.

Handlers and ledger implementations are trusted caller dependencies. The runner
supplies metadata, cancellation and an advisory deadline; it provides no storage,
provider, subprocess or network adapter. This is not a sandbox for arbitrary code.
The host must bind these interfaces to its existing contained owners and durable
ledger, then prove real callback delivery and consumer readback independently.

## Common banner and island model

`bun src/cli.ts composition project` reads a bounded JSON packet containing
`manifest`, optional `observations`, `event` and `receipt`. It emits a single
immutable presentation model with lineage digests, fixed banner text and island
content. Declared targets remain visible when stale, held or unknown; `enabled`
requires fresh configuration evidence. Undeclared targets are omitted.

The receipt digest binds content and lineage; it does not authenticate a supplied
receipt. Native adapters must establish provenance before displaying the model as
an operational observation. The command supplies neither provider resolution nor
execution/acceptance authority. Installed native renderers and the optional Manifest
bridge consume this already-redacted model through their own bounded adapters.

### Contained owner observations

`composition owner-project` reads a bounded JSON stdin packet with `manifest`, optional `observations`, `event`, and `owner_observation`. The portable `temperance.lifecycle-owner-observation.v1` contract carries only fixed process dispositions and redacted lineage digests. It shares the banner/island target model while retaining “Owner process completed; acceptance unproved” wording. Process completion, replay, pending, and held outcomes remain distinct. Digests establish supplied-content consistency, not authenticity. No command dispatches organs or grants capacity, execution, or semantic acceptance.
