# RO-04 Manifest admission implementation

Status: source implementation committed as `61231de`; independent Astra review PASS. Installation, service, live endpoint, provider and consumer results remain outside this slice.

The coordinator independently reran the 49-test no-env suite (267 assertions), generated-contract parity check and diff check before committing the nine exact source/test paths. The reviewer independently verified the same suite and seven selected legacy regressions (29 assertions). Review fixed normalization-reachable discriminator bypass, loss after unterminated log tails, stale registry authority, and duplicate registry IDs. No remaining material finding was reported within this bounded review.

## Delivered

Observation admission is opt-in through an injected trusted `RoutingObservationPolicy`. Default ManifestStore, ManifestCatalog, server and offline CLI construction remain observation-disabled. The same `admitRoutingObservation` validator runs before generic normalization, before catalog registration, during direct store admission and during durable replay. It verifies the exact envelope, shared RO-01 receipt contract/digest, registry binding and bounded injected-clock skew. Observation registration is rebuilt from a successful current registry read and fails closed on removed entries, malformed/unreadable registry or duplicate IDs in either order; generic cached metadata recovery stays intact. Receipt bytes and evidence status remain immutable; the optional typed projection derives freshness independently.

Reserved discriminator detection includes normalization-reachable whitespace/truncation variants and nested receipt schemas, without treating ordinary prose mentioning routing observations as a new event. Raw decoding rejects duplicate observation keys, invalid encoding, malformed JSON and oversized input with fixed codes. Generic duplicate-key behavior remains compatible, while a duplicate cannot hide a reserved discriminator. HTTP and CLI observation responses include only fixed errors or validated identity; rejected fields never reach observation diagnostics.

A per-stream exclusive directory lock surrounds replay/check/append for every opt-in writer. There is no stale-lock stealing. Appending after an unterminated tail inserts a separating newline in the same append call without rewriting historical bytes; corrupt and valid tail cases survive restart. Read failure fails closed before append and retains the previous snapshot; release failure returns a fixed error and leaves the lock for separately authorized recovery. Exact retries append nothing, increment no event count and notify no subscriber. Conflicts preserve the first validated receipt; replay conflicts and live conflict attempts produce bounded counts. Live conflict flags survive refresh within the store lifetime; only conflicts present in durable history reconstruct after process restart. Conflicting bodies are never appended by supported admission.

## Owned files

| File | Result |
|---|---|
| `package/manifest-bridge/src/routing-observation.ts` | Strict admission, trusted policy and projection types, discriminator reservation, raw decoder, compact response and CLI emit seam. |
| `package/manifest-bridge/src/event-input.ts` | Actual POST /events delegate accepting a fake async byte stream and response object; no socket required. |
| `package/manifest-bridge/src/contract.ts` | Prevent generic normalization from laundering reserved observations. |
| `package/manifest-bridge/src/store.ts` | Shared admission/replay, locked writer stream, immutable observations, freshness, conflicts and fixed rejection counters; injected read/release fault seams. |
| `package/manifest-bridge/src/catalog.ts` | Validation before registration, registered-project enforcement, explicit aggregate collection and dynamic replay registration checks. |
| `package/manifest-bridge/src/types.ts` | Additive optional typed routing_observations field. |
| `package/manifest-bridge/src/server.ts` | Delegate POST /events to the tested byte handler. |
| `package/manifest-bridge/src/cli.ts` | Bounded stdin decoding and compact observation emit; hook conversion cannot launder observation envelopes. |
| `package/manifest-bridge/test/routing-observation.test.ts` | Synthetic privacy/admission/replay/projection/clock/concurrency/HTTP/CLI and legacy regressions. |
| This quick directory | Scoped plan and summary only; no STATE modification. |

Canonical/generated contracts, router, installer and lockfiles were not edited. Parent installed the existing frozen bridge dependencies only in this worktree package so legacy tests could load; no dependency version or lock change is part of RO-04.

## Integration API

- `new ManifestStore(file, projectId, policy)` and `new ManifestCatalog(root, policy)` enable the explicitly injected policy. No env flag enables it.
- `RoutingObservationPolicy`: `receipt_policy` (shared ReceiptPolicy), unique `project_bindings` pairs, `max_clock_skew_ms` (integer 0..300000), `now: () => number`; optional trusted `isProjectRegistered(projectId, projectRef)` callback.
- Exact actor: `product-routing-adapter`; exact source: `temperance-router`; kind: `routing.observation.recorded`; event schema: `temperance.manifest.event.v1`.
- ID: `observationEventId(receipt.receipt_id)` returns `evt_${receipt_id}`. Envelope timestamps exactly equal receipt timestamps; status is synthetic or observed from evidence_mode; payload is exactly receipt; evidence is []; redaction is bounded-preview. No optional/free-form envelope keys; seq is accepted only during replay and regenerated by the bridge.
- Collection key: `observationKey(receipt)` = project_ref + ':' + observation_id. Value: validated receipt, derived freshness, bounded conflict_count.
- `handleEventPost` is the actual server delegate and listener-free HTTP test seam. `emitEventInput` is the CLI emit seam. Both can import independently of server/control-ledger/network dependencies.

## Verification

- `bun test package/manifest-bridge/test/routing-observation.test.ts`: 49 passed, 0 failed, 267 assertions after the whitespace reservation, unterminated-tail and current/duplicate-registry review fixes.
- Environment-cleared variant: 49 passed, 0 failed, 267 assertions using `env -i PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/bun --no-env-file test package/manifest-bridge/test/routing-observation.test.ts`.
- Selected existing `bridge.test.ts` cases: 7 passed, 0 failed, 29 assertions; 52 intentionally filtered. Selection: payload redaction; hook safe summaries; classifier prompt omission; replay/dedup; two-project isolation; registry refresh; concurrent stale catalog registry writers.
- Concurrency includes two actual separate Bun processes with cleared child environments, a synthetic file barrier and one shared temporary receipt stream; one acceptance, no conflicting append, deterministic retry after restart. No listeners or services are opened.
- Fault tests inject durable read denial and lock-release exceptions; results contain only fixed errors and no private error markers.
- Full listener-based bridge suite, live HTTP/SSE, provider execution, external consumer compatibility, installed layouts, dependency closure and deployment are outside this source slice. Parent owns later temporary installation and source integration evidence.

## Limits

Policy/catalog membership and hashes validate declarations and public-source provenance; they do not authenticate a producer or prove an external provider succeeded. All fixtures are synthetic. There is no collector, external writer enrollment, auto-dispatch or approval consumption. Direct file appends bypassing the tested owning admission protocol remain unauthorized. A stale lock requires explicit recovery; this implementation never guesses that a competing writer is dead. Invalid-line diagnostic counters count rejected processing attempts (bounded at 10000), while projection conflict counts rebuild from valid conflicting durable records plus live attempts retained by that store instance.

## Independent review receipt

Independent source review returned PASS after reproducing and closing: normalization-reachable whitespace discriminator bypass; accepted receipts merging into unterminated log tails; stale registry-cache authority after removal/read failure; and ambiguous duplicate registry IDs. Regression tests cover each finding, both duplicate row orders and repeated active rows. Reviewer independently confirmed 49 synthetic tests / 267 assertions and 7 legacy tests / 29 assertions passing. Source/test scope is frozen for parent integration; this worker made no commit.
