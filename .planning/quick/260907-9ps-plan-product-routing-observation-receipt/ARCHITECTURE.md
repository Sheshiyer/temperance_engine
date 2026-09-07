# Routing observation receipt — architecture proposal

Status: proposal; documentation only, 2026-09-07. Product baseline and inspected-file evidence are in [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md). Execution boundaries and tasks are in [the quick plan](260907-9ps-PLAN.md).

## Purpose and invariant

Expose bounded evidence about one routed request without giving an observation authority to select routes, claim worker completion, approve execution, or change provider state. Success means deterministic, privacy-safe receipt projection with uncertainty preserved through producer, bridge persistence/replay, and later consumer rendering.

The independent schema is `temperance.routing-observation-receipt.v1`. It is not the host activity receipt, generic canary result, an approval, a dispatch success record, or an ISA acceptance verdict. Product code currently contains proxy attribution handling but lacks the dedicated host activity/canary/attribution modules described in the research context. Reimplement the reviewed minimal semantics under product ownership; no blanket host copy.

## Data flow and ownership

Reviewed typed synthetic attempt/tool evidence → product pure adapter → strict receipt → Manifest special-kind admission → durable validated event → explicit routing-observation projection → snapshot/SSE → later Organ Console adapter.

A future host collector is outside this slice. It must convert provider-specific private evidence into approved typed inputs locally, with independent authority and tests. Receipt content validation cannot authenticate the producer or independently establish that an external provider succeeded. The trust level remains local observation; source SHA provenance proves bytes, not remote execution.

## Receipt allowlist

All objects reject additional keys recursively. No arbitrary metadata, evidence pointer, message, label, URL, file path, free-form error, raw prompt, prompt hash, tool argument, tool output, connection ID, account ID/email, endpoint, or credential field exists. Do not truncate or redact such data into an accepted receipt. Reject it with a fixed code before persistence, registration, diagnostics, SSE or response echo.

| Field | Proposed contract |
|---|---|
| `schema` | Exact schema literal. |
| `receipt_id` | `ro_` plus full 64 lowercase SHA-256 hex; digest of canonical validated content excluding this field. |
| `observation_id` | Opaque, product-issued random observation token, fixed `obs_` + 32 lowercase hex. Stable for retries; never copied/derived from an account, connection, URL, raw prompt or external request ID. |
| `project_ref` | Approved opaque registered product project token; bounded registry membership, not a cwd or a user label. |
| `observed_at`, `fresh_until` | Canonical UTC ISO timestamps with milliseconds. Caller supplied, ordered; expiry bounded by approved freshness policy. |
| `source` | Exact `product-routing-adapter`; `evidence_mode` is `synthetic` or `local-observation`. Synthetic input can never render as a live fact. |
| `provenance` | Exact `product_source_commit` (40 lowercase hex), `closure_sha256` (64 hex), `contract_sha256` (64 hex). These cover public source only, never private input. |
| `request` | `outcome`: `succeeded`, `failed`, or `unavailable`; no requested provider/head included as observed attribution. |
| `attribution` | Discriminated union below. |
| `tools` | Discriminated union below. |

Limits: maximum encoded receipt 4 KiB; no arrays or extensible nested bags in v1; strict finite numeric integer counts 0–10,000; no coercion, prototypes, getters, control characters, non-finite values, inherited keys or unexpected encoding. JSON decoding and byte limits precede object validation. Internal TypeScript input tests include hostile objects even though external JSON cannot encode getters. Error codes are closed enums with bounded strings; rejection responses never contain supplied values.

Attribution union:

- `observed`: exactly one successful-attempt binding in the reviewed typed evidence; fields `state`, `provider`, `model`, `successful_attempt_ordinal`, and `evidence_basis` (`terminal-attempt-record`). Provider/model must be members of an explicit reviewed canonical catalog of public provider/model identifiers, with length/character limits; regex alone is insufficient. Ordinal is local 1–10,000, never a connection identifier. The matching terminal attempt must belong to this observation and have `succeeded` outcome. Successful stream termination, where applicable, must be proven. An HTTP 200, configured combo head, last attempted provider, or unbound SSE trailer cannot satisfy this condition.
- `unavailable`: exactly `state` and `reason_code` (`no_successful_attempt`, `missing_attribution`, `evidence_unavailable`, or `unsupported_identity`). No provider/model/ordinal fields. A successful request with missing attribution remains unavailable.
- `ambiguous`: exactly `state` and `reason_code` (`conflicting_attribution` or `multiple_successful_bindings`). No winner, provider/model, or ordinal fields. Conflicting sources cannot be resolved by latest timestamp or preferred provider. A later success after failed attempts is observed only when the successful attempt binding is unique.

No `resolved` field or user-facing resolved-provider label is emitted by this slice. A later consumer may describe a serving provider only for an observed successful binding. Unknown public identity maps to unavailable, not arbitrary passthrough. Requested route information, if ever needed, requires a separate schema extension and separate visual semantics.

Tool union:

- `completed`: complete tool lifecycle coverage is asserted by the trusted typed input; `started_count` equals `completed_count`, `failed_count` is zero, no open tool remains, and terminal evidence is present. Zero tool calls qualifies only with explicit complete coverage proving zero.
- `incomplete`: lifecycle evidence exists and shows an open/failed tool or incomplete coverage. Counts are consistent (`completed_count + failed_count <= started_count`), reason is `open_tools`, `tool_failed`, or `coverage_incomplete`.
- `unavailable`: exactly `state` and `reason_code` (`not_instrumented` or `evidence_unavailable`); omit counts. Absence of tool telemetry cannot become zero or completed.

Attribution, request outcome, and tool state are independent dimensions. A provider-success receipt can have incomplete/unavailable tools; none establishes semantic task completion. The adapter never invents evidence to meet a desired label.

## Pure adapter contract

Proposed `adaptRoutingObservation(input, context)` accepts pre-parsed typed attempt/tool evidence and explicit context (opaque refs, timestamps, source provenance, canonical identity catalog). It returns a validated receipt or a closed rejection code. It performs no IO, clock reads, environment access, database reads, endpoint calls, logging, dispatch or mutations. It does not import host activity/canary modules or the proxy. Caller-owned inputs are unchanged. All ignored input categories are structurally disallowed at this seam; raw host receipts cannot be supplied directly.

Canonical serialization sorts keys deterministically and rejects unsupported values. `receipt_id` covers every accepted content field. Repeated identical inputs yield identical bytes and ID. The digest does not hash excluded private content. Source assertions are an input trust boundary, not proof created by the hash.

## Shared contract source and installed layout

Choose one product-owned canonical, self-contained TypeScript contract under proposed `package/contracts/routing-observation-receipt.v1.ts`, using only supported built-ins and no sibling-relative runtime imports. A proposed deterministic sync script produces byte-identical generated files. Every generated file carries the same canonical ownership notice already present in the canonical bytes. Never edit generated copies directly.

| Source ownership | Repository runtime copy | Installed runtime copy |
|---|---|---|
| `package/contracts/routing-observation-receipt.v1.ts` | `package/router/contracts/routing-observation-receipt.v1.ts` | `<STATE>/router/contracts/routing-observation-receipt.v1.ts` |
| Same canonical source | `package/manifest-bridge/src/contracts/routing-observation-receipt.v1.ts` | `<STATE>/runtime/manifest-bridge/src/contracts/routing-observation-receipt.v1.ts` |
| Router adapter | `package/router/routing-observation-adapter.ts` | `<STATE>/router/routing-observation-adapter.ts` |
| Bridge special-kind module | `package/manifest-bridge/src/routing-observation.ts` | `<STATE>/runtime/manifest-bridge/src/routing-observation.ts` |

Router and bridge import their own generated copy; neither assumes that `package/router` and `package/manifest-bridge` remain siblings after installation. The canonical source and sync script are build-time product files and need not be installed. `sync --check` compares complete bytes and fails on missing copies. Any future shared dependency must either be internalized in this self-contained contract or added to generation, closure, both installation trees, and import-negative controls together.

Existing install-surface fragments already declare whole-tree COPY ownership for router and bridge. Prove that the executor recursively captures the new files and their hashes; semantic install lock changes are needed only if records change. Source-hash inventory and compiled manifest digest are separate: a compiled semantic lock digest alone is not content dependency closure.

Legacy `scripts/install-spine.sh` rsyncs router to `<STATE>/router`, while `scripts/temperance-manifest-bridge-launchd.sh` launches `product/package/manifest-bridge/src/cli.ts` from the product checkout. The fragment describes `<STATE>/runtime/manifest-bridge`. This divergence is verified source behavior, not an installed runtime receipt. A later implementation must converge the owning launch/install path or explicitly retain and test both supported layouts. No successful repository import may be used to bypass installed-layout proof. No LaunchAgent edit or restart occurs here.

## Manifest admission, replay, dedup and projection

Reserve kind `routing.observation.recorded` under `temperance.manifest.event.v1`. It deliberately avoids the existing broad `route.*` and `source === omniroute` projection. Envelope is separately strict: exact event schema, deterministic ID derived from receipt ID, timestamp/expiry equal to receipt fields, source `temperance-router`, status `synthetic` for fixtures or `observed` for local observations (freshness handled separately), approved project ID bound to `project_ref`, payload exactly the receipt, `evidence: []`, fixed actor, and no session/task/agent/correlation/free-form fields. Stored `seq` is bridge-owned and never accepted as client authority. Existing `redaction: bounded-preview` may remain for envelope compatibility but does not attest receipt safety.

Admission must happen before generic `normalizeEvent` can replace unknown schemas, discard unknown envelope fields, truncate strings, redact payloads, or create random IDs. Unknown observation-like versions/kinds must be rejected or held as unsupported, not admitted through a generic-event fallback. The generic path must not admit the new receipt schema under a different kind/source.

| Boundary | Required treatment |
|---|---|
| HTTP `POST /events` and CLI emit | Raw byte limit, exact envelope/receipt checks, fixed-code errors, no raw echo; no new producer-write endpoint needed. |
| `ManifestCatalog.ingest` | Validate before `ensureProject`, so bad observations cannot create registry rows; require registered project binding for this special kind. |
| `ManifestStore.ingest` | Apply the same validator before append; do not rely on server checks because direct API users exist. |
| `ManifestStore.replay` | Revalidate persisted entries, receipt digest, binding, and schema before apply. Reject corrupt, forged, oversized or incompatible entries with bounded diagnostics; continue to later valid records. Never reinterpret old generic events as new receipts. |
| Dedup | Index `(project_ref, observation_id)` and canonical content digest. Identical retry is a no-op with no append/count/SSE side effect. Same observation key with different content is a `receipt_conflict` rejection, not silent dedup or last-writer-wins. Rebuild index from valid durable records on restart. |
| Persistent replay conflict | Deterministically retain the first admitted immutable record and expose only a bounded conflict flag/count, never the conflicting body. Do not upgrade or overwrite its serving attribution. |
| Freshness | Derive stale/fresh from immutable receipt timestamps and injected clock; replay does not rewrite receipt bytes/hash or make expired evidence fresh. Freshness is distinct from attribution state and tool state. Reject future/out-of-policy times during admission under explicit bounded clock skew. |
| Store projection | Add an optional typed `routing_observations` collection keyed by project plus observation ID; it contains exactly validated receipt and derived freshness/conflict state. No spread of untrusted payload into state. |
| Catalog snapshots | Initialize/merge this collection explicitly in single-project and all-project snapshots; maintain project isolation and no key collisions. Existing `routes`, approvals, dispatches, waves and task-completion fields remain unaffected. |
| SSE and diagnostics | Publish only the validated envelope/projection. Accepted and dedup responses contain a small typed result and validated identity; rejection includes only fixed code. Do not forward exception messages, evidence pointers or user fields into logs. |

Require serialized single-writer admission for each project receipt stream; do not claim the existing in-memory `seen` set gives multi-process uniqueness. Before enabling external writers, either route writes through the owning bridge or add tested lock/transaction admission shared by every writer. An offline direct append bypass cannot be an authorized producer. Test two concurrent ingestion attempts through the supported writer and restart/retry behavior; any unproven cross-process writer path remains disabled. This slice adds no auto-dispatch, approval consumption, or background collector.

For snapshot compatibility, introduce the collection as an additive optional field at the public type boundary with readers defaulting missing to empty; verify existing consumers tolerate it. If any strict external consumer rejects it, explicitly version the state protocol before activation. Do not silently change the meaning of `routes` or retrofit historical rows.

## Fixtures and tests

All fixture identities and bodies are synthetic. Never sanitize and commit a real host receipt. Cover the following with meaningful assertions at contract, adapter and installed bridge boundaries:

- Unique success with binding; requested head differing from actual success; failed first attempt then bound success; HTTP success without binding; missing trailers; contradictory attribution; multiple possible successes; unknown provider/model; no successful attempt.
- Completed tools with explicit zero/nonzero coverage; open tools; tool failure; partial coverage; absent instrumentation; successful provider with incomplete tools; impossible/negative/overflow counts.
- Extra envelope and nested fields; credentials under innocuous keys; URL/email/path/control-character values; raw prompt and tool-output markers; malicious error text; invalid digest/schema/versions/refs; reused IDs; mismatch between envelope and receipt; oversized bytes; prototype/getter/coercion attempts.
- Stable canonical bytes/id, unchanged inputs, no IO imports, no clock/env dependence; generated contract mismatch and missing dependency are hard failures.
- Direct store, catalog, CLI, HTTP handler validation with fake request/response and injected filesystem fixtures; malformed receipt creates no registry/event/state/SSE record and no raw diagnostic echo.
- Exact retry before/after restart; conflicting same observation; direct replay of invalid/old/corrupt lines; later valid line survives; stale does not become observed-fresh; different projects do not collide; fresh receipts never authorize dispatch or task completion.
- Snapshot optional-field compatibility and legacy route/approval behavior unchanged. In-memory handler tests are not live endpoint checks.

## SHA dependency closure and isolated install proof

Before implementation promotion, generate a product-source manifest from an explicit allowlist: canonical contract/schema, generated copies, adapter and bridge special-kind module, every changed transitively imported local module, sync/provenance generators, relevant package manifests/locks, install fragments and compiled lock, installer/lifecycle owners, and the smoke/tests/fixtures supporting acceptance. Include entrypoints and resolved import edges, repository-relative paths, regular-file size and SHA-256, product commit, toolchain versions, generated-owner mapping, and a canonical root digest. Reject symlinks/escapes, omitted/missing dependencies, unsupported dynamic imports and unexpected external dependencies. Bun/runtime built-ins are recorded as runtime dependencies, not silently called source files. Existing `pg` dependency remains pinned by bridge lock when the full bridge graph is tested; no host `node_modules` borrowing.

The evidence manifest must not include host absolute paths, live state, account IDs, URLs, raw requests, or tool output. A checksum of the root manifest does not substitute for validating its entries and complete import graph. The baseline hash table in this packet is inspection evidence only, not this future closure proof.

Build a test-owned temporary root with explicit state/home/config paths supplied to installer adapters; do not repurpose the shell's HOME/CODEX_HOME or use default global destinations. Stub or inject service/network/process integrations. If an installer cannot target the temporary root without touching global state, hold and refactor its test seam before the smoke. Use the real COPY/lifecycle logic with a minimal reviewed fixture manifest, not ad hoc copying as the only installation proof.

Install router and bridge under the exact fragment destinations, hide access to repository and host dependencies from the spawned import check, clear ambient module resolution through an explicit child-process environment, and import both installed entrypoints by absolute temporary paths. Run the same synthetic receipt through adapter, admission, durable temporary-store replay and snapshot. Assert both generated contracts match canonical SHA; all installed dependencies match source manifest; only allowed temporary paths were written; no network or service manager ran. Remove one contract dependency and alter one byte separately: both must fail before the observation can be admitted.

Keep evidence classes separate: source tests; temporary installation; installed imports; synthetic bridge projection; rollback restoration. None demonstrates live provider resolution or real Organ Console behavior.

## Rollback and staged rollout gates

| Gate | Entry evidence | Exit / hold condition |
|---|---|---|
| G0 packet | This source-inspected documentation | Human review of implementation scope and schema; no runtime change. |
| G1 source | Approved implementation tasks | Focused fixture tests, dependency closure, parity, source commit and review; no install implied. |
| G2 temporary installation | G1 artifacts | Real installer-adapter dry-run/apply in temporary root, installed import/replay, corruption failures and rollback proof. |
| G3 source integration | G1/G2 and repository approval | Exact files integrate through normal review; no runtime authority inferred from merge. |
| G4 host installation | Separate explicit operator authorization and fresh host inventory | Reviewed owning-writer install, verified backups/read-back and scheduled convergence if applicable; no provider/combo/account mutation. Host/product divergences are resolved explicitly. |
| G5 live observation | Separate bounded producer/collector authorization | Known source, successful-attempt binding where present, unavailable/ambiguous preserved; no auto-dispatch or generic canary escalation. |
| G6 consumer | Separate Organ Console plan and acceptance | Version-aware projection, fixtures and UI checks in that repository; read-only claims only. |

For G2, preserve a test fixture prior installation: byte hashes, modes, file list, absent files, ownership metadata and prior manifest. Prove the backup readable and byte-equivalent before apply. Inject failure after a copied file and before read-back; restore prior bytes/modes, remove only newly created allowlisted files, and prove unknown sentinel files untouched. Re-import prior version and compare inventory against baseline. Exercise rollback conflict on externally modified files: fail closed instead of overwriting another writer. New observation event history stays separate/additive so binary rollback does not require destructive history rewriting; verify older readers ignore or omit the optional collection safely.

A later real runtime rollback must be separately planned against actual owners, service sources and installed receipt. No broad uninstall, reset, recursive cleanup, root-tree overwrite or plain copy of live WAL-backed databases. This documentation task does not make or test a real host backup, restart services, or claim rollback readiness.

## Organ Console consumer lane

Create a separate plan in Organ Console after the producer schema and fixtures are reviewed. Consume only the explicit routing-observation projection, never generic route labels or host private JSONL. Map attribution states and tool states independently, render stale/synthetic/unavailable/conflict visibly, and never infer completed work from provider response success. Unsupported/missing schema renders unavailable without reading legacy private data. Projection does not enroll projects, grant authority, dispatch tasks, select providers, or write upstream state. Consumer fixtures and UI acceptance belong to that repository and cannot be claimed by product bridge tests. No Organ Console files are accessed or changed in this quick task.
