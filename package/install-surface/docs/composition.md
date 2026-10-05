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
