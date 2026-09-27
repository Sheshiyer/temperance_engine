# Optional session rails

Temperance core does not require a personal profile, a particular provider, or a
long-context model. A host can select a session policy at
`$TEMPERANCE_STATE/session-policy.json` (state defaults to `$HOME/.temperance`),
or explicitly through `TEMPERANCE_SESSION_POLICY`. Explicit missing, blank,
malformed, and symlinked policy files are errors, not portable-core mode.

The policy owns semantic phase aliases and minimum/preferred context capacity.
It contains no credentials or concrete combo membership. 9Router retains
ownership of provider connections, combo members, ordering, and fallbacks.

## Admission versus configuration

The attempt admission contract checks phase identity, required skills/tools,
exact selected provider/connection/model, fresh quota and context evidence,
harness capacity, and reserved input/output budget. A selected long-session
floor applies even at E1. The effective capacity cannot exceed either the
provider or the harness. Each fallback needs its own evidence.

The current 9Router adapter has **no verified pre-attempt enforcement seam**.
Consequently selecting a policy holds governed inference with
`GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE`; it does not activate a 1M context window.
Changing a client setting or saving evidence cannot lift this hold. A trusted
adapter must call admission on every actual attempt, including internal
fallbacks, before the hold can be removed.

Shell phase dispatch and the shared Codex wire are checked before starting a
worker. The legacy Claude/OpenCode launchers are checked before retrieving a
key. The OpenAI proxy checks before catalog/planning/upstream activity and thus
covers ACP callers using that proxy. Direct clients talking to 9Router outside
these managed entrypoints are not governed by these checks and must not be
advertised as admitted Noesis sessions. The native Codex desktop session remains
distinct from a routed worker.

Onboarding checks live alias membership and model availability. Passing those
checks is not a context, entitlement, health, or quota certificate. Provider
sign-in requires the operator's OAuth/API-key action; no other application's
credential store is imported implicitly.

## Headers and recovery

One phase projection defines seven alchemical headers and primary koshas for
shell, Codex, and Claude hooks. Without an actual-attempt receipt, the concrete
worker is `UNVERIFIED`; neither a catalog's first model nor the native coordinator
model is presented as the worker.

Checkpoint helpers currently validate work identity, policy digest, and a fresh
session requirement only. They are not a persisted recovery service or a second
planner. Production continuation must attach to the existing GSD handoff and
Noesis route-lease adapter, then repeat fresh admission. Process-restart and
live continuation acceptance remain required before recovery is called ready.
