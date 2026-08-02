# OmniRoute native integration

This guide defines how Temperance adopts OmniRoute without moving policy,
planning, acceptance, memory, or tool-loop ownership out of the existing PAI
stack. It records the verified local rollout and the still-closed remote
promotion gate.

## Current state: locally promoted, remotely contained

- OmniRoute 3.8.48 listens only on `127.0.0.1:20128`.
- `REQUIRE_API_KEY` resolves to `true`; anonymous and invalid-Bearer catalog
  requests return HTTP 401.
- OpenCode/Codex and native Claude use separate Keychain-backed inference keys.
- The Claude key permits exactly four governed Claude model identifiers, only
  `chat` and `models`, sixty requests per minute, eight sessions, USD 10 daily,
  USD 50 weekly, and `noLog=true`.
- Ten payload artifacts created before `noLog=true` were irreversibly redacted;
  summary telemetry and a mode-600 metadata-only receipt remain.
- `temperance-opencode` and `temperance-claude` are the governed local launchers.
- Buffered Temperance proxy receipts copy the concrete serving provider and
  model only when OmniRoute supplies both response headers; the fields remain
  null otherwise. Completed streaming receipts require both final attribution
  trailers and record a transport error when either is absent. Streaming
  attribution is read only from bounded final OmniRoute SSE control trailers
  while response bytes remain unchanged.
- Native CLI Code dry-run discovery passed against an isolated Codex home with
  zero writes and unchanged governed profile hashes.
- The native Hermes mapping was learned once, but the recurring compiler now
  uses only the verified redacted local snapshot and fixed governed bindings.
  It retains a secretless proposal plus non-authorizing metadata receipt with
  no dashboard authentication, session, HTTP request, or Hermes state.
- Shared client enrichment now emits one fixed, pointer-only PAI/GSD/skill-index
  context-source catalog; it does not activate OmniRoute Context Sources.
- Context Settings remains globally off. The synthetic preview qualifier proves
  the local auth boundary without authority; a separate offline inspector pins
  the installed native CLI/OpenAPI/policy contract without executing its token
  loader or making a network request. Lite, Headroom, and minimal RTK remain
  held until native authorization and process-bound transport both exist.
- MCP scope enforcement is loaded as a dormant LaunchAgent precondition while
  MCP stays disabled and offline. A2A stays disabled.
- LaunchAgent restart persistence passed after adding bounded bootstrap retry
  and loopback manual-daemon recovery.
- Quick Tunnel stays disabled.
- No named OmniRoute tunnel, public hostname, Access application, Access policy,
  or Access service token is active.

## Architecture boundaries

PAI, GSD, ISA, and skill clusters remain policy owners; Codex and Hermes own
tool loops; OmniRoute owns authenticated transport optimization, model routing,
and receipts.

Dashboard/session login is separate from client API Bearer authentication.
A login redirect must never be treated as proof that `/v1` is protected.

GitHub skill discovery is discovery-only and must flow through `skill-index.json`
and cluster governance; never recommend direct installation.

Global compression, custom system prompt, MCP execution, A2A execution, and
Hermes writes stay unpromoted. Governed OpenCode and relay requests explicitly
send `x-omniroute-compression: off`; this is a transport guard, not a compression
promotion.

The practical flow is:

```text
PAI phase -> GSD plan -> ISA criteria -> skill selection
         -> exact governed launcher/model -> OmniRoute transport
         -> client tool loop -> ISA verification -> PAI completion
```

An OmniRoute receipt proves transport completion, not semantic acceptance.
`ISA.md` remains the single acceptance ledger.

## Why the dashboard shows two providers

OpenCode currently exposes two adapter namespaces: `omniroute` and
`temperance`. Those are client-side API adapters, not the upstream provider
inventory. A fresh native snapshot reports the current inventory directly; the
2026-08-02 snapshot found 28 upstream connections, 25 configured provider
families, and 26 active connection records. These counts may change without
altering either OpenCode adapter.

The topology badge is activity, not inventory. A blue `1` means one provider
family has an in-flight request. Green is current activity, red is the most
recent family whose newest request remains unsuccessful, and dim nodes are
configured or historically observed. Red has no age cutoff in 3.8.48, so an
old failure can remain visible without implying a current outage.

The same separation applies on `hermes-runner-01`. OmniRoute's service health
reports five configured, active connections, while an offline CLI launched as
`ubuntu` or with `HOME=/var/lib/omniroute` can still read a different SQLite
store and return empty provider lists. Those empty lists are not service
inventory evidence. The service-side combo list is nevertheless empty,
`TEMPERANCE_AUTO_READY=0`, and no `te-algorithm` or genuine S-tier probe receipt
exists, so Algorithm promotion remains closed.

An unpacked npm comparison of OmniRoute 3.8.49 against installed 3.8.48 found
the inspected A2A CLI, schema, MCP tool, task manager, task execution, and skill
control source files byte-identical. Cost analytics moves numeric parsing to a
shared helper. The compiled readiness source digest does change, so route
bundles are not claimed byte-identical; both packages nevertheless produce the
same fail-closed principal, task ownership, allowlist, create-path,
denial-receipt, and handler-proof blockers. The hashes and registry integrity
are recorded in
`docs/audits/omniroute-3.8.49-a2a-comparison.json`. Upgrading one patch
therefore supplies no evidence that closes an A2A promotion gate.

## Read-only native control-plane snapshot

Run the local observation surface without a dashboard session, admin key,
Keychain lookup, HTTP request, WebSocket subscription, or network access:

```bash
bun scripts/omniroute-native-status.ts | jq
```

The command returns one short-lived, versioned document with exactly five
layers: inventory, activity, policy, execution, and authority. It opens
`~/.omniroute/storage.sqlite` read-only, enables SQLite `query_only`, reads an
explicit projection inside one transaction, then verifies the database inode,
owner, mode, link count, OmniRoute PID, start identity, and loopback listener
did not change. The dispatch manifest receives the same owner, ancestry,
symlink, mode, link-count, size, schema, and identity checks. Any failed check
returns a fixed low-cardinality error code instead of a body, path, credential,
provider account, or exception string.

Collection requires exact database schema version `1`, requires the database
header and live readback to agree on WAL mode, requires stable correct-owner
non-writable `-wal` and `-shm` identities, rejects any hot rollback journal, and
sets SQLite `busy_timeout=0`. The 30-second value is the emitted
snapshot TTL; the read transaction itself is bounded to the immediate aggregate
queries and is never held for that TTL. Pre/post path checks are joined to
`O_NOFOLLOW` descriptor `fstat` checks. The listener PID must hold the same
database device/inode and run from the same hashed OmniRoute package and version
before and after collection. This protects against accidental path or runtime
drift; it is not cryptographic evidence against a malicious process already
running as the same local user.

This is intentionally an observation surface, not a second control plane. Its
output contains no mutation methods and always declares
`promotionAuthorized: false`. It never reads secret-bearing provider metadata
or raw request, response, MCP, A2A, or error bodies. OmniRoute management
responses can include credential-bearing connection fields, so they must never
be copied into snapshots, logs, fixtures, or agent context.

The snapshot separates what each layer can actually prove:

- Inventory is persisted connection, provider-family, model-intelligence, and
  governed-combo counts.
- Activity reports last persisted provider events. Live in-flight activity is
  explicitly unknown because it belongs to OmniRoute's WebSocket telemetry.
- Policy reports the effective compression master gate and the exact hashed
  dispatch manifest. A configured Caveman candidate remains ineffective while
  the master gate is off. When the master is on, effective compression is
  reported as `request-dependent` because request headers, routing overrides,
  active profiles, auto-trigger thresholds, and derived defaults outrank any
  single dashboard field. The manifest must contain zero `sol`, `sol-max`, or
  `solmax` targets across workers and direct CLI fallbacks;
  governed non-Codex worker, provider-family, and exact-target diversity are
  counted separately, and Spark is optional.
- Execution reports detected local CLI tools and persisted protocol counters.
  Hermes remains proposal-only; MCP and A2A configuration remains unknown
  without a server-authenticated read channel.
- Authority reports only closed external gates. Quick Tunnel is `stopped` only
  when its cleared state file agrees with two stable local process probes that
  no `cloudflared` process exists; any process makes the result `unsafe`. The
  snapshot cannot promote Cloudflare, contact protected EC2 Hermes,
  authenticate an S provider, or enable Algorithm routing.

Topology color semantics are bound to installed OmniRoute 3.8.48. If that
version changes, `versionBound` becomes false until the compiled dashboard
semantics are re-audited. The blue badge counts in-flight provider families;
green, amber, red, and dim nodes describe activity, recency, error, and
inventory state—not the number of configured providers.

## Ownership matrix

| Surface | Policy / execution owner | Adopt status | Promotion gate |
| --- | --- | --- | --- |
| Cloudflare transport | Policy: PAI/GSD/ISA/skill clusters. Execution: Cloudflare carries only approved OmniRoute inference traffic. | Local loopback only; remote promotion closed. | Explicit hostname plus Tunnel/DNS/Access/Service-Token write authority, Access configured before route, constrained remote key, and full denial probes. |
| Dashboard auth | Policy: OmniRoute admin UI boundary. Execution: dashboard session only. | Existing admin boundary. | Never use dashboard login as `/v1` authentication evidence. |
| Client API auth | Policy: OmniRoute inference boundary. Execution: Bearer-gated `/v1`. | Adopted locally. | Anonymous and invalid requests remain 401; every client uses its own constrained Keychain-backed key. |
| Context Settings engines | Policy: PAI/ISA defines semantic preservation. Execution: OmniRoute may transform transport payloads. | Master off; governed OpenCode providers and the relay force the native per-request override to `off`; preview-only candidates. | Redacted fixture matrix preserves PAI stages, GSD state, ISA criteria, tool schemas, code, and verification evidence before any non-off route is promoted. |
| Context Sources | Policy: PAI/GSD/skill clusters. Execution: shared clients resolve pointers. | Client-owned pointer catalog adopted for Claude, Codex, OpenCode, Kimi, and direct Command Code; OmniRoute Obsidian/Notion sources remain unpromoted. | A native source requires external secret resolution, read-only least scope, a dedicated pointer-only corpus, and body/write denial probes. |
| CLI Code | Policy: PAI/GSD/ISA/skills. Execution: OpenCode/Codex tool loop. | Governed launcher adopted; native dry-run discovery verified. | `temperance-opencode` stays Keychain-backed and existing Temperance profiles and finite limits remain authoritative. |
| CLI Agents and Hermes | Policy: PAI/GSD/ISA/skills. Execution: Hermes tool loop. | Prior native mapping is policy-pinned; offline secretless proposal-only v3 receipt verified; Apply forbidden. | Exact protected-host Hermes version and parser, dedicated inference-only credential delivery, subprocess isolation, canaries, and rollback before any unit/config/environment/data write. |
| MCP | Policy: skill clusters and PAI stage contract. Execution: explicit client-authorized tool calls. | Scope enforcement loaded; server disabled/offline; no client registered. | Explicit client authorization plus an end-to-end least-scope denial probe before enabling a transport. |
| A2A | Policy: skill clusters and PAI stage contract. Execution: Codex or Hermes. | Public card discovery only; server disabled. | Replace the ambient-env-only `/a2a` auth check with scoped-key/session enforcement, then prove anonymous denial and a bounded authenticated capability response. |
| Signed probe receipts | Policy: ISA defines expected subjects and non-claims. Execution: a separately trusted probe runner signs observations; the readiness consumer verifies integrity only. | Ed25519 verifier adopted; no production receipt or private key exists here. | Exact resource/instance binding plus independent Cloudflare authority or A2A handler proof; signer integrity alone never promotes. |
| GitHub skill discovery | Policy: skill clusters through `skill-index.json`. Execution: candidate discovery only. | Candidate-only adoption. | Results flow through cluster governance; never recommend direct installation. |
| `te-dispatch` | Policy: PAI/GSD/ISA decides fan-out. Execution: launcher selected by proven client wire. | Split adoption: native non-Codex Claude rails pass; Codex Responses members remain model-by-model gated. | Exact model, nontrivial output, receipt attribution, unique correlation, and no-Sol evidence per wire. Catalog presence is insufficient. |
| OBSERVE | Policy: PAI and `ISA.md`. Execution: client reads state. | Existing. | OmniRoute exposes transport facts only; it never becomes classifier or acceptance owner. |
| THINK | Policy: PAI and `ISA.md`. Execution: client reasoning loop. | Existing. | OmniRoute routes a selected model but does not own reasoning policy. |
| PLAN | Policy: GSD and `ISA.md`. Execution: client freezes route intent. | Existing. | `.planning` and frozen tasklists are authoritative before requests leave the client. |
| EXECUTE | Policy: PAI/GSD/ISA. Execution: exact governed launcher and model. | Heterogeneous non-Sol mode adopted. | Prefer proven non-Codex native rails; Spark is an optional compatibility rail, never an exclusive default; Sol remains forbidden. |
| VERIFY | Policy: `ISA.md`. Execution: client gathers fresh evidence. | Existing. | Fresh evidence, receipt attribution, secret hygiene, and false-green rejection are mandatory. |
| LEARN | Policy: PAI and `ISA.md`. Execution: client records decisions locally. | Existing. | OmniRoute never becomes a memory or preference owner. |
| COMPLETE | Policy: ISA and GSD closure rules. Execution: client closes work. | Existing. | Verified criteria plus unchanged ownership and protected-host boundaries. |
| GSD `.planning` | Policy: GSD. Execution: repo-local planning spine. | Existing. | Never rehome `.planning` into OmniRoute context storage. |
| `ISA.md` | Policy: ISA. Execution: repo-local acceptance ledger. | Existing. | Remains the sole acceptance and preference ledger. |
| `skill-index.json` | Policy: skill clusters. Execution: client-side lazy resolution. | Existing. | Remains canonical; discovery stays candidate-only and governed. |

## Client-owned pointer Context Source bridge

Temperance adopts the useful idea behind OmniRoute's Context Sources—a named,
attributable context catalog—at the existing shared client-enrichment seam. It
does not enable the native Obsidian or Notion integrations. Installed OmniRoute
3.8.48 stores per-key source `token`, `base_url`, and `vault_path` fields in its
SQLite database. Its Obsidian MCP catalog includes full-note reads, active-file
content, writes, patches, deletes, moves, and command execution. That contract is
broader than the pointer-only PAI boundary. The native Hermes Agent generator is
also not a credential sink: `keyId` lookup is not implemented and the rendered
YAML contains an `api_key` value.

The adopted resolver in `package/enrich/contextSources.ts` therefore performs
metadata and canonical-path operations only. It checks exactly three candidates
and never scans a context tree:

| Key | Fixed candidate | Root policy |
| --- | --- | --- |
| `pai` | `$HOME/.Codex/PAI/Algorithm/LATEST` | The installed PAI root may be a trusted symlink; the final candidate must be a non-symlink regular file contained under its canonical target. |
| `gsd` | `<cwd>/.planning/STATE.md` | `.planning` must be a real non-symlink directory contained under canonical `cwd`; the final candidate must be a non-symlink regular file. |
| `skills` | `$HOME/.agents/skill-clusters/skill-index.json` | The canonical cluster root may be a trusted symlink; the final candidate must be a non-symlink regular file contained under its canonical target. |

Each source fails independently to `null`. Unsafe roots, relative paths,
non-files, target or descendant escapes, sibling-prefix tricks, ASCII controls,
Unicode line separators, and envelope delimiters are rejected. File bodies are
never read, hashed, summarized, copied into a request, or persisted by this
resolver. The pure stage emits exactly one compact JSON line:

```text
context-sources: {"pai":"/canonical/path/Algorithm/LATEST","gsd":"/canonical/project/.planning/STATE.md","skills":"/canonical/skill-clusters/skill-index.json","material":"pointers-only"}
```

The metadata-only `lstat`/`realpath`/`stat` sequence retains a same-user TOCTOU
race, so this catalog is discovery evidence rather than authorization. Any
consumer that later dereferences a pointer must independently reopen, validate
ownership and link count, canonicalize, contain, authorize, and bound the
requested material.

Claude, Codex, OpenCode, and the Kimi relay consume the shared
`package/enrich/index.ts` assembler. The direct Command Code AGENTS renderer
preserves its existing Bash ISA/memory rendering semantics and delegates only
pointer projection to `package/adapters/command-code/context-sources-line.ts`,
which calls the same metadata-only resolver and pure serializer. Both the
documented TypeScript renderer and the actual shell dispatch path therefore emit
the same reserved pointer line. A separate validator rejects malformed JSON,
unexpected key order, unsafe pointers, or a forged second reserved line before
anything reaches stdout.

Command Code workspaces are unique per dispatch and owner-only. Their absolute
pointers are ephemeral runtime metadata, never committed configuration and never
authorization. The default `/tmp/temperance-dispatch` workspaces and result
artifacts may retain that metadata until the operator removes the explicit run
directory or the operating system clears temporary storage; do not publish those
artifacts without redacting the `context-sources:` line.

This bridge changes neither OmniRoute settings nor its SQLite store and creates no Obsidian/Notion credential, MCP/A2A registration, Hermes file, Cloudflare
route, provider connection, routing combination, or dispatch manifest. A later
native Context Source promotion must first provide a credential mechanism that
does not persist a reusable token in OmniRoute, expose only a dedicated
pointer-only corpus, remove every write-capable scope, and pass authenticated
allow/deny probes end to end.

Exact model attribution is checked independently of launcher exit status. In
the 2026-08-02 boundary audit, `gh-claude-sonnet-5` produced substantive output
and the gateway recorded `GITHUB | claude-sonnet-5 | complete`. The simultaneous
Antigravity request returned success to the client, but gateway logs showed
Sonnet 5 returning 404/429 and `claude-sonnet-4-6` serving as fallback. That
result was rejected as Sonnet 5 evidence and the task was redispatched on the
verified GitHub non-Sol rail.

## EC2 S-tier falsification surface

`package/router/omniroute-s-tier-candidates.ec2.json` preregisters the only EC2
candidate pins the falsifier accepts. The associated CLI is an observation
surface, not an authenticator or activation controller: every receipt declares
`integrityScope: unauthenticated_local_telemetry` and
`doesNotEstablish: [identity, readiness, authorization, promotion]`. No outcome can create
an alias, change routing policy, establish provider ownership, satisfy external
authority, or promote Algorithm/S. The CLI has no linkage to
`TEMPERANCE_AUTO_READY`.

Its exact closed outcome vocabulary is `FALSIFIED`, `CONSISTENT_UNPROVEN`,
`ENV_UNAVAILABLE`, `QUOTA_BLOCKED`, `TRANSPORT_FAIL`, `PINNING_UNVERIFIED`, and
`STRUCTURALLY_UNVERIFIABLE`. There is deliberately no `READY`, `AUTHORIZED`,
`IDENTIFIED`, or `PROMOTED` result. `CONSISTENT_UNPROVEN` means that the bounded
observations agreed with the requested pin and shape; it remains non-authoritative.

`controlEvidenceCodes` supplies low-cardinality diagnostics for `pinBefore`,
`mismatch`, and `pinAfter`. Its closed values are `expected_404`,
`transport_timeout`, `transport_network`, `unexpected_status`,
`invalid_response_shape`, `nonce_missing`, `value_missing`,
`attribution_missing`, `unexpected_attribution`, and `expected_mismatch`.
These codes never contain response bodies, vendor errors, identifiers, or
credentials, and they do not expand the candidate outcome vocabulary.

Fixture mode evaluates a sanitized observation document without network access:

```bash
sudo install -d -o root -g root -m 0700 \
  /var/lib/temperance-engine/s-tier-readiness
sudo bun scripts/omniroute-s-tier-readiness.ts \
  --fixture /absolute/path/to/sanitized-s-tier-fixture.json \
  --output /var/lib/temperance-engine/s-tier-readiness/fixture-<UTC>.json
```

Live mode must be requested explicitly. It accepts no environment credential
fallback and may call only the manifest's exact loopback endpoint,
`http://127.0.0.1:20128/v1/chat/completions`:

```bash
sudo bun scripts/omniroute-s-tier-readiness.ts \
  --live \
  --key-file /etc/hermes/omniroute-proxy.key \
  --output /var/lib/temperance-engine/s-tier-readiness/live-<UTC>.json
```

The credential path must be absolute and outside the repository, and the file
must be regular, non-symlink, and have exactly one hard link. The accepted
metadata shapes are deliberately closed: either exact mode `0600` owned by the
invoking user, or exact mode `0640` with UID `0` and a nonzero GID beneath an
immediate real-directory parent whose mode is exactly `0750`, UID is `0`, and GID
matches the file. The real EC2 credential is
`/etc/hermes/omniroute-proxy.key`; use it in place and never copy, chmod, or
chown it for probing. Its content never enters the receipt or output.

Create `/var/lib/temperance-engine/s-tier-readiness` explicitly as root-owned
mode `0700`, then execute the CLI as root so the directory owner matches the
process. The receipt is exclusively created at mode `0600`, stores sanitized
metadata rather than response bodies or the raw nonce, and carries a
self-declared `expiresAt` five minutes after issue. No reaper or production
consumer enforces that timestamp; an operator must reject an expired receipt as
stale local telemetry, never as retained authority.

Requests are serialized under per-request and total deadlines. An impossible
explicit-pin denial runs first, followed by a known attribution-mismatch
control. Candidate content and inert tool-shape probes run only when both early
controls are exactly expected; otherwise they are skipped because their results
would already be void. The same impossible-pin denial always closes the
schedule. The two denial controls detect
fallback or pin drift across the run; the mismatch control proves that the
instrument detects an expected attribution contradiction instead of treating
HTTP success as pin proof. Unexpected control behavior downgrades every
candidate to `PINNING_UNVERIFIED` or `STRUCTURALLY_UNVERIFIABLE`.

This surface supplies bounded negative evidence for a later human-controlled
promotion decision. It never closes the genuine S-provider authentication,
OmniRoute administrative authorization, host rollout, or live promotion gates.

## Context Settings promotion profile

The dashboard pipeline is a transport optimizer, not a replacement for PAI,
GSD, ISA, session memory, or skill routing. A configured stage has no runtime
effect while the Prompt Compression master switch is off. Keep the master off
during this rollout.

OmniRoute resolves compression in this order: per-request header, routing-combo
override, active profile, automatic trigger, then default. The global master
switch still gates every result, so a request header cannot turn compression on
while the master is off. Temperance uses that native header only as a negative
policy boundary:

```text
x-omniroute-compression: off
```

Both enabled OpenCode provider namespaces (`omniroute` and `temperance`) receive
the header through the host manifest and reconciler. The merge preserves every
unrelated custom header, removes all case-insensitive spellings of the
compression key, and installs one canonical lowercase key. The relay repeats
the same normalization immediately before its upstream fetch, so a client
cannot request `default`, `engine:*`, or a named compression combination through
automatic routing.

This is defense in depth, not end-to-end proof that a future engine is safe.
OpenCode resolved-config validation and controlled outbound request capture prove
the literal-off transport intent. A non-off policy still requires the fixture
promotion gates below, an attributable request receipt, and a separate manifest
change. Clients outside the governed OpenCode and relay paths remain a reason to
keep the global master off.

### Synthetic preview qualifier

Installed OmniRoute 3.8.48 implements preview as exactly
`POST http://127.0.0.1:20128/api/compression/preview`. The route accepts either
an explicit mode or an engine/pipeline selection, runs the native compression
implementation, and returns diff, validation, fallback, and token statistics.
It contains no settings-write call. The management policy runs before that
route, however, so a preview response is not anonymous functionality.

Run the authority-free boundary probe with no input arguments:

```bash
bun scripts/omniroute-context-preview.ts
```

This sends one embedded synthetic canary only. It requires an authentication
denial, holds every candidate, and writes a metadata-only, non-authorizing
receipt. On the active 2026-08-02 runtime, both the anonymous request and the
documented machine-bound local CLI token were rejected by the management
middleware with `401 AUTH_001`. The qualifier does not work around that result
with a browser session, dashboard password, cookie, client inference key, or
machine token.

### Offline native CLI readiness

The installed package contains a native `omniroute compression preview --file`
command. Its CLI source reads a JSON body and posts it to the same preview route.
The management source also contains a loopback-only CLI-token allow path. Those
source-level facts do not prove that the active client can authenticate.

The 3.8.48 client helper dynamically imports `node-machine-id` and silently
returns an empty value when that import fails. On this installation the helper
returns empty, so the shipped preview command sends no CLI token and receives
HTTP 401. Independent diagnostic requests using both token forms derived by the
installed server source also received management HTTP 401; the bounded JSON
observation recorded `AUTH_001`. That second observation makes the empty client
helper a real packaging bug, but not a sufficient explanation for every
active-server denial. The remaining locality/policy cause stays unproven and
held.

Inspect the installed static contract without repeating either live request:

```bash
bun scripts/omniroute-native-cli-readiness.ts
```

This command is offline by construction. It treats the installed package as
data, pins version 3.8.48, and compares every file in an exact relative source
allowlist against its reviewed whole-file SHA-256. Ordered unique markers then
explain the command, endpoint, OpenAPI body, token-helper fail-closed behavior,
and loopback management-policy contracts. It never imports or executes those
sources, never resolves a token, and has no live/network flag. Its separate
mode-600 receipt is non-authorizing: `contract_verified` means only that six
reviewed files at the resolved root match their pinned 3.8.48 bytes and static
markers. It does not certify complete package integrity, entrypoint bytes, or
the loaded module graph. Version,
digest, or marker drift becomes `contract_unverified`. Both results retain
machine-readable `packageIntegrityComplete:false`, `transportBound:false`,
authorization and promotion false,
and `blockingCondition:"401 AUTH_001 unresolved"`; neither claims semantic
safety or promotion readiness. The receipt is an `instant-observation`, is not
cacheable or replay-authorized, and no authorization, mutation, or promotion
consumer may treat it as sufficient evidence.

An authenticated semantic run is deliberately not implemented. Plaintext
loopback proves an address, not the identity of the process accepting a
connection. A same-user listener replacement could capture any reusable Bearer
token between separate pre/post process observations. The command therefore
accepts no credential or token-file argument and sends no authorization header.
A future live semantic matrix requires a transport that binds the established
connection to the observed OmniRoute process before releasing a credential, or
an OmniRoute-native one-use preview capability with equivalent server identity,
scope, expiry, and revocation evidence.
A scoped access token alone is not sufficient.

A zero-byte proof confirmed that an established loopback connection can be
matched to the expected OmniRoute PID through the exact reverse tuple before
request bytes are sent. That is feasibility evidence only. No socket/PID
transport module is shipped or hidden behind a flag because process identity
cannot repair rejected authorization, and a dormant alternate auth path would
weaken the current denial boundary.

The qualifier accepts no prompt text, body path, stdin body, workspace file, or alternate
endpoint.

The embedded matrix checks exact synthetic markers for the seven PAI stages,
GSD state, an ISA identifier, a tool schema, code, a receipt digest, and an
injection canary. Candidate order is fixed to Lite, Headroom, then minimal RTK.
The embedded matrix and response validator are pure, offline contract checks;
the live command does not transmit those multi-message fixtures. Any future
HTTP/auth/schema/validation/fallback/marker/order/invariant failure must hold
that candidate. Pre/post redacted snapshots already agree on runtime/database
identity, compression, governed dispatch, context-source ownership, custom
prompt, Hermes, and Cloudflare state. Receipts contain fixture identifiers and
hashes plus classifications only—never prompts, originals, compressed output,
diffs, response bodies, or credential material.

Even a future all-green authenticated preview would be evidence for a later
per-request experiment, not a configuration mutation.
This command never enables the master, selects an active combo, alters the custom system prompt,
or changes a governed manifest.

| Engine | Safe role | Current state | Promotion gate |
| --- | --- | --- | --- |
| Prompt Compression master | Enables only a previously accepted fixture profile. | Off. | Multiple redacted fixture classes pass semantic parity. |
| Session Dedup | Remove accidental duplicate blocks only. | Off. | Intentional repeated guardrails and criteria survive. |
| CCR (Retrieval) | Retrieve attributable context pointers. | Off. | Pointer provenance passes; private bodies stay client-side. |
| Lite | Whitespace/format cleanup. | Off; first synthetic preview candidate. | Code, Markdown, tool JSON, and exact-output probes round-trip. |
| RTK | Preview command-output filtering. | Off; third candidate pinned to minimal with raw retention disabled. | Failures, receipts, diffs, and VERIFY evidence never disappear. |
| Headroom | Compact tabular JSON transport. | Off; second synthetic preview candidate. | Every governed tool schema round-trips without shape loss. |
| Relevance | Candidate last-query scoring only. | Off. | Earlier constraints, decisions, and criteria cannot be discarded. |
| Caveman | Rule-based prose shortening. | Candidate `lite`, ineffective while master is off. | Prose-only fixture parity; never apply to code, schemas, criteria, or receipts. |
| Aggressive | Summarize and age old turns. | Held. | Separate high-risk loss analysis. |
| LLMLingua (SLM) | Model-assisted compression. | Held. | Local-model provenance, privacy, and semantic parity. |
| Custom system prompt | Short transport invariant only. | Off. | Must not duplicate PAI, GSD, ISA, skills, or repository rules. |

Recommended experiment order is Lite, then Headroom, then minimal RTK preview.
Session Dedup, CCR, Relevance, Caveman, Aggressive, Ultra, LLMLingua, and
Omniglyph remain held until the earlier fixtures establish a trustworthy
baseline.

## Governed launchers

```bash
# OpenCode: reads the existing Temperance key from Keychain.
temperance-opencode

# Native Claude: reads its separate key from Keychain and accepts only these.
temperance-claude antigravity-claude-sonnet-5
temperance-claude gh-claude-sonnet-5
temperance-claude no-think-antigravity-claude-sonnet-5
temperance-claude no-think-gh-claude-sonnet-5
```

The Claude shim removes `OMNIROUTE_API_KEY` before the real Claude process and
preserves only the translated Anthropic bearer required by native OmniRoute
launch. The profile settings remain tokenless. OpenCode continues to use
`{env:OMNIROUTE_API_KEY}` in config; the governed launcher supplies it at
execution time.

## Heterogeneous dispatch

Never use Sol for worker dispatch. Select an exact model and launcher from live
evidence:

1. Native Claude wire: the four allowlisted profiles pass. Antigravity and
   GitHub Claude each produced substantive, receipt-attributed audit results
   with no Sol use; their worker output files are private mode-600 evidence.
2. Codex Responses wire: Spark remains a known compatibility rail, but it is
   optional. Non-Codex candidates promote individually only after a bounded
   probe returns a nontrivial terminal result. External Codex workers ignore
   operator user configuration by default while retaining repository rules;
   exact zero is the audited opt-out. Every task packet is self-contained and
   cannot depend on ambient PAI hooks, user plugins, or prior conversation.
3. OpenCode wire: the governed launcher reads the authenticated catalog and
   exposes curated Temperance aliases; do not infer execution compatibility
   from the model list alone.

The initial Codex-wire non-Codex probes failed for distinct reasons: provider
credits, premature stream termination, duplicate tool definitions, and one
truncated `AL` tail falsely marked successful. The dispatcher now rejects
blank, diagnostic-only, `NO`, and short/truncated terminal results. These
failures are capability evidence, not justification for a dishonest downgrade.
Dispatcher-owned run directories and retained evidence are explicitly
owner-only. Permission hardening is scoped to those artifacts, so workers keep
the caller's normal umask for repository and shared-cache files.

## CLI Code, CLI Agents, Hermes, MCP, and A2A

- CLI Code can teach profile shape and validation rules. Run
  `scripts/omniroute-codex-preview.sh`; it uses OmniRoute's native
  `setup-codex --dry-run` against an isolated Codex home, verifies zero files
  written, and compares governed profile hashes before and after. Native
  previews currently suggest context windows that differ from the accepted
  Temperance limits, so they remain discovery evidence, not configuration.
- CLI Agents documents native Hermes Agent support. Its preview route creates
  the target directory, merges an existing `~/.hermes/config.yaml`, and its
  generator emits `api_key` fields; `keyId` is accepted but is not resolved
  into a runtime credential. Native Apply is therefore not an end-to-end safe
  connector. The first research pass established its five-role mapping, but an
  independent audit correctly rejected recurring dashboard login over plaintext
  loopback: PID or package checks cannot cryptographically bind a request to the
  intended same-user listener without a race.

  `scripts/omniroute-hermes-preview.sh` therefore makes no HTTP request and
  never reads the dashboard password. It consumes the existing redacted,
  read-only local snapshot, requires OmniRoute 3.8.48 runtime/database identity
  continuity plus exact presence of the five governed combos, and compiles a
  fixed proposal using Hermes' documented `provider: custom`, loopback `/v1`,
  and `${env:TEMPERANCE_HERMES_OMNIROUTE_API_KEY}` references. It rejects every
  pre-existing Hermes path and never creates one. Concurrent state is preserved
  and fails the run; there is no cleanup or deletion authority and therefore no
  directory-cleanup race. Its v3 receipt says `collectionTransport: "none"`,
  `adminCredentialAccessed: false`, `sessionCreated: false`,
  `nativeEndpointInvoked: false`, and `promotionReady: false`.

  The exact historical `session.cookie` was removed without reading its content
  after regular-file, owner, link-count, mode, and path validation. Current runs
  scan the canonical preview-receipt root before collection and completion and
  refuse any reintroduced cookie path. Native Apply stays blocked until the
  protected host's exact Hermes version proves config compatibility, a dedicated
  inference-only credential delivery contract, child-process isolation,
  canaries, and exact rollback.

  Hermes' official documentation treats `config.yaml` as non-secret settings,
  supports `${env:VAR}` substitution, and requires `provider: custom` for a
  top-level OpenAI-compatible endpoint. Those upstream contracts inform this
  proposal but do not authorize its installation:
  [configuration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/configuration.md),
  [providers](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/integrations/providers.md), and
  [environment variables](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/environment-variables.md).
- MCP is disabled/offline with 36 mapped tools and 18 declared scopes.
  `OMNIROUTE_MCP_ENFORCE_SCOPES=true` is now loaded before any client
  registration; that is a dormant precondition, not end-to-end authorization
  proof.
- A2A is disabled with zero tasks. `/.well-known/agent.json` is intentionally
  treated as public discovery metadata: anonymous and invalid-Bearer reads both
  return the six-skill card. The `/a2a` handler checks only an ambient server
  environment key, which is absent, rather than the governed database keys.
  Its companion `/api/a2a/tasks`, `/api/a2a/tasks/[id]`, and cancellation routes
  do not apply that same guard; the installed task list/read/cancel handlers are
  plain in-memory operations. The shipped CLI also posts `tasks.create` to
  `/api/a2a/tasks`, while the installed route exports only its list handler.
  OmniRoute synthesizes this ambient key as a `manage`-scoped credential, and
  the six A2A skills can invoke inference or read quota, cost, health, provider,
  and circuit state. Supplying it would therefore expose a process-wide
  management principal, neither create one least-privilege A2A authorization
  contract nor make the documented CLI surface coherent.
  Enabling A2A would fail the authenticated-promotion gate, so no key, task,
  client, launcher, or custom substitute was created.
- Neither MCP nor A2A becomes a PAI classifier, GSD planner, ISA verifier, or
  live skill installer.
- Context Sources may eventually expose pointers into `.planning`, `ISA.md`, and
  the skill index. OmniRoute must never persist the private bodies those pointers
  resolve to.

## Local auth operations

```bash
scripts/omniroute-client-auth.sh status
scripts/omniroute-client-auth.sh verify
scripts/omniroute-client-auth.sh restart-rehearsal
scripts/omniroute-client-auth.sh revocation-rehearsal
scripts/omniroute-client-auth.sh rollback /absolute/path/to/receipt.json
scripts/omniroute-redact-claude-artifacts.sh verify
scripts/omniroute-codex-preview.sh
scripts/omniroute-hermes-preview.sh
scripts/temperance-proxy-launchd.sh install
bash tests/temperance-proxy-launchd.sh
scripts/omniroute-local-rollback-rehearsal.sh \
  --launchd-backup /absolute/path/to/pre-change.plist \
  --codex-receipt /absolute/path/to/codex-preview/receipt.json \
  --hermes-receipt /absolute/path/to/hermes-preview/receipt.json
```

Receipts live below `~/.temperance_engine/receipts/`, with mode 700 directories
and mode 600 artifacts. Current Hermes v3 receipt directories contain exactly a
secretless proposal and metadata receipt. The compiler performs no dashboard
authentication or network collection and persists no source snapshot. Other receipt families
retain their separately documented identifiers, hashes, policies, and HTTP
results. The rollback rehearsal copies
only the public LaunchAgent plist into an isolated directory, proves exact
baseline restoration and exact promoted reapply, and leaves the running gateway
untouched.

OmniRoute 3.8.48 has a one-minute data-plane API-key validation cache. A live
revocation rehearsal observed HTTP 401 sixty seconds after deletion. For an
active compromise, first contain transport, drain bounded workers, restart the
loopback service to clear the cache, and then prove the revoked key returns 401.

## Cloudflare promotion gate

The local Wrangler session proves connector control-plane access, but no named
tunnel exists and current authority does not prove DNS Write, Access Apps and
Policies Write, or Access Service Tokens Write. Therefore remote promotion is
blocked safely.

Required authority and design:

1. Select an explicit Cloudflare-owned hostname and grant Tunnel/Connector
   Write plus DNS Write.
2. Grant Access Apps and Policies Write. For machine clients, also grant Access
   Service Tokens Write or provision mTLS.
3. Create the self-hosted Access application and `Service Auth` policy before
   publishing a route. Never use a browser-cookie dependency for agents.
4. Create a separate remote OmniRoute key with an exact model allowlist, only
   the required endpoint categories, finite request/session rates, finite daily
   and weekly spend, and `noLog=true`.
5. Create a remotely managed named tunnel whose only origin rule matches the
   approved inference hostname/path and forwards to `http://127.0.0.1:20128`.
   End ingress with `http_status:404`; dashboard and management paths remain
   unreachable through the tunnel.
6. Store the tunnel token and Access secret outside the repository, readable
   only by the launch principal. Do not put either in process arguments.
7. Prove, in order: anonymous Access denial, invalid origin Bearer denial,
   allowed-model success with attribution, management/path 404, disallowed-model
   denial before provider routing, rate/spend enforcement, and transport rollback.

Official requirements:

- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/

### Named-tunnel promotion transaction

Cloudflare promotion is a two-phase transaction, never a collection of manual
dashboard clicks. Its strict manifest names exactly one account, zone, hostname,
team domain, non-Sol/non-auto OmniRoute provider and model, a pinned operator
approval key ID plus SPKI SHA-256, bounded request and spend ceilings, and
private credential/journal/receipt locations. The hostname
must be a strict subdomain of the selected zone and the origin is fixed at
`http://127.0.0.1:20128`. Unknown manifest fields, name collisions, an existing
Cloudflare origin certificate, Quick Tunnel residue, a non-loopback listener,
or insufficient exact authority fail before mutation. The preflight also
rejects an exact FQDN record, a covering wildcard record, or apex flattening
that could make the hostname reachable before the transaction's DNS step.

`prepare` may create only private, non-routable objects:

1. A bounded `noLog=true` OmniRoute key with the exact provider/model and
   endpoint categories from the manifest.
2. A Cloudflare Access service token whose generated secret is written directly
   to its owner-only sink and never returned in logs, JSON, arguments, or the
   environment.
3. A self-hosted Access application and a `Service Auth` policy containing only
   the specific service-token include rule. `Everyone`, `Bypass`, reusable
   browser sessions, and public policies are invalid.
4. A remotely managed named tunnel configuration containing the exact hostname,
   loopback origin, `originRequest.access.required=true`, exact `teamName` and
   `audTag`, plus a terminal `http_status:404` ingress rule.
5. An owner-only tunnel token file and an unloaded LaunchAgent that invokes
   `cloudflared tunnel --token-file ... run`. The token never appears in process
   arguments or environment variables.

`prepare` cannot create DNS, start the connector, expose a public route, or
authorize promotion. It records write-ahead intent before every remote call,
records only owned identifiers and non-secret hashes afterward, and supports
deterministic recovery when an API succeeds and its returned identifier is
durably journaled before the public receipt. The fake adapter also exercises
same-name discovery with an exact ownership hash, but the production adapter
never treats a deterministic name as provenance. It accepts only a journaled
exact identifier or an independently read-back ownership field. If a request
outcome is ambiguous before the returned identifier is durable, recovery emits
a manual-orphan failure and refuses adoption or deletion. This is required for
Access service tokens, OmniRoute keys, and tunnel configurations, which lack a
safe create-time ownership metadata channel. The core can then reconstruct a
complete receipt or roll back only its proven prefix. It never starts a connector
or creates DNS while recovering.

`promote` requires a fresh, one-use approval receipt bound to the exact prepared
state digest. It starts the connector, proves healthy connections, creates the
single tunnel CNAME as the final public cutover, and immediately runs the
canaries below. A stale, replayed, differently bound, or already-consumed
approval cannot mutate anything. Before consumption, the core hashes the
provided Ed25519 public key's SPKI, matches it to the manifest pin, and verifies
the signature over the domain-separated canonical approval payload. The
injected adapter must then prove durable atomic consumption before mutation.
Failed canaries trigger the same complete rollback used by the operator command.

The executable six-canary contract requires all of the following against the
exact hostname:

- anonymous Access denial;
- invalid Access service-token denial;
- valid Access identity plus invalid OmniRoute Bearer denial;
- exact allowed-model success with expected serving attribution;
- disallowed-model rejection before provider routing;
- dashboard, management, and unmatched-path denial;
- every Access-allowed observation binds the exact audience, team issuer, and
  expected service-token principal; and
- every observation proves real hostname resolution and HTTP transport, so
  NXDOMAIN, timeout, or connection refusal can never masquerade as denial.

Rate/spend exhaustion and public transport disappearance after rollback remain
required production-adapter staging probes. They are not claimed by the current
mock-only canary suite.

The transaction owns only objects named in its private receipt. Rollback refuses
identifier/name drift, stops the connector first, deletes DNS, cleans up and
polls to zero active connections, deletes the tunnel configuration and object,
then deletes the Access policy/application, Access service token, OmniRoute key,
and owned local secret files. Re-running rollback is idempotent only when the
same receipt proves ownership; it never adopts or deletes colliding resources.
Cached DNS is why transport stops before DNS deletion.
If connector stop or DNS deletion fails, rollback records
`PROMOTION_STUCK_OPEN`, preserves Access and both credentials, returns nonzero,
and requires operator containment; it never continues by relaxing protection.

Cloudflare credentials are external inputs, not manifest content. The API token
must be supplied as an absolute regular owner-only mode-600 file with the exact
Tunnel, DNS, Access Application/Policy, and Service Token scopes for the selected
resources. It is never accepted through argv or environment variables. The
OmniRoute administrator credential follows the same file-only boundary.
Generated Access and tunnel secrets are sink-only. The public proof receipt may
contain identifiers, timestamps, state digests, policy summaries, and hashes,
but no reusable secret or credential path content.

The core package executes preview, prepare, promote, recover, and rollback
against an injected adapter, and its fake adapters exercise every state without
network access. The generic CLI deliberately exposes only a real zero-mutation
preview. Its mutating command names return exit 3 with
`production_adapter_and_exact_authority_required`; it never substitutes a
Wrangler login or environment credential for the missing production-only
composition root and exact authority.

The injected preflight is a contract input, not authenticated Cloudflare
evidence. Its `signatureValid` field cannot validate itself. A production-only
composition root must independently verify a short-lived authority signature
bound to the manifest hash, exact account, zone, hostname, application, tunnel
identifiers, collector identity, and observation time before invoking the core.
The isolated production adapter now implements strict credential files, journal
and secret sinks, HTTP boundaries, manual-orphan recovery, and durable atomic
approval anti-replay. Until the authority collector, exact OmniRoute policy
enforcement, concrete connector/canary ports, and staging suite exist, the
authority and real-side-effect ISA criteria stay open.

```bash
bun scripts/omniroute-cloudflare-promotion.ts preview \
  --manifest /absolute/path/to/strict-promotion-manifest.json

# Deliberately returns exit 3 and mutations:0 in the current package.
bun scripts/omniroute-cloudflare-promotion.ts prepare \
  --manifest /absolute/path/to/strict-promotion-manifest.json
```

Start from
`package/router/omniroute-cloudflare-promotion.example.json`, replace every
placeholder with exact selected identifiers, keep the secret and journal paths
outside the repository, and rerun preview. Preview validates structure and
prints stable hashes; it does not inspect permissions, create secrets, or grant
approval. The production adapter boundary is implemented and hermetically tested,
but it refuses before the first remote-key packet because OmniRoute 3.8.48 cannot
exactly enforce the manifest's session-request, session-duration, burst, and
single-path controls. Until that mismatch, exact resource-scoped authority, the
hostname, and a fresh approval are resolved, operators run preview only.
Quick Tunnel is never a fallback, and `noTLSVerify`, `cert.pem`, `Everyone`, and
`Bypass` are forbidden.

| Required live input | Owner | Current evidence | Promotion effect |
| --- | --- | --- | --- |
| Exact account, zone, hostname, team, and Access audience | Cloudflare administrator | Hostname/zone unselected | Blocks production adapter construction. |
| Resource-scoped Tunnel, DNS, Access App/Policy, and Service Token write token | Cloudflare administrator | Current Wrangler claims are insufficient | Blocks all control-plane mutation. |
| Strict external mode-600 Cloudflare token file | Local operator | Not provisioned | No argv/environment fallback exists. |
| Exact probe-passing non-Sol/non-auto model and bounded remote-key policy | Temperance/OmniRoute administrator | GitHub Sonnet rail verified locally; remote policy not authorized | Preview hash only. |
| OmniRoute administrative credential in a strict external file | OmniRoute administrator | Not provided | Blocks remote-key creation. |
| Reviewed production adapter and private journal/secret sinks | Temperance maintainer | Local boundary and adversarial fixtures pass; no production composition root | Generic CLI still returns exit 3. |
| Fresh one-use prepared-state approval | Human operator | Impossible before a real prepare receipt | Blocks connector and DNS cutover. |

### Read-only Cloudflare authority preflight

Run the repository preflight before any named-tunnel plan:

```bash
bun scripts/omniroute-cloudflare-readiness.ts

# Once an explicit hostname and machine-auth design exist:
bun scripts/omniroute-cloudflare-readiness.ts \
  --hostname inference.example.com \
  --zone-id expected-zone-id \
  --tunnel-id expected-tunnel-id \
  --machine-auth service-token
```

The wrapper invokes only `wrangler whoami --json`, or reads a supplied
`--whoami-file` fixture. Its versioned JSON omits the account ID, account name,
email, and token material. Exit 3 means the authority preflight remains closed;
exit 2 means the evidence could not be evaluated. The report can set
`permissionClaimsPass:true` when the selected account, hostname syntax,
Tunnel/Connector Write, DNS Write, Access Apps and Policies Write, and selected
machine-identity permission labels are present. Wrangler `whoami` does not
expose whether those labels are restricted to another resource or whether the
selected hostname belongs to an authorized zone. Therefore `resourceScope`,
`hostnameZoneAuthority`, and `ready` remain false. The signed-probe verifier
described below can bind an observation to exact expected resource identifiers,
but it deliberately cannot convert the signer's statement into Cloudflare
authority. The preflight does not create or authorize a deployment.

The current workstation is authenticated and exposes `connectivity:admin`, so
the connector-control gate passes. The current report remains `ready:false`
because DNS Write, Access Apps and Policies Write, an Access service-token or
mTLS write authority, and an explicit hostname are missing or unselected.
Unobservable permissions, multiple accounts without `--account-id`, and an
invalid hostname all fail their claim gates. A `--whoami-file` is explicitly
labeled fixture evidence and can never masquerade as a live authority result.

### Signed probe integrity contract

`package/router/signed-probe-receipt.ts` provides the shared cryptographic
envelope used by the two surface-specific readiness consumers. It does not
reuse routing-promotion HMAC keys. Receipts use Ed25519, a surface-specific
length-prefixed domain, deterministic canonical JSON, a 256-bit OS-generated
challenge, exact issuer/key/audience binding, signed `issuedAt`, `notBefore`,
and `expiresAt` timestamps, a maximum five-minute lifetime, and verifier-held
issued/consumed challenge lists. Verification uses the runtime's `node:crypto`
Ed25519 implementation, not a pure-JavaScript signature comparison.

Canonical payloads allow only NFC strings, booleans, nulls, safe integers,
arrays, and plain objects. They are capped at 65,536 UTF-8 bytes, depth 32, and
10,000 nodes. Owner-only receipt and ledger files must already be canonical;
the loader bounds raw bytes before parsing and rejects duplicate-key,
whitespace, escape, key-order, prototype-key, and post-parse shape ambiguity.
The verifier permits at most 30 seconds of future clock skew for
`issuedAt` and `notBefore`; expiry is strict and the signed issued-to-expiry
lifetime never exceeds 300 seconds.

Every receipt carries `claimScope: signer_integrity_only` and machine-readable
disclaimers for Cloudflare resource authority, A2A handler safety, and write
capability. The trusted public key is supplied separately; a receipt cannot
name or embed its own trust root. No verifier accepts a signing key.

The command-line readiness tools load an optional receipt from environment
variables so public trust material and challenge state do not enter process
arguments:

```bash
export TEMPERANCE_SIGNED_PROBE_RECEIPT=/private/path/receipt.json
export TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY=/trusted/path/probe-public.pem
export TEMPERANCE_SIGNED_PROBE_LEDGER=/private/path/challenge-ledger.json
export TEMPERANCE_SIGNED_PROBE_ISSUER=temperance-probe-runner
export TEMPERANCE_SIGNED_PROBE_KEY_ID=probe-key-2026-08
export TEMPERANCE_SIGNED_PROBE_AUDIENCE=temperance-cloudflare-readiness
export TEMPERANCE_SIGNED_PROBE_CHALLENGE=<64-lowercase-hex-characters>
```

The receipt and ledger must be owner-only files. Legacy fixtures may contain
`issuedChallenges` and `consumedChallenges` arrays keyed as
`<key-id>:<challenge>`. Production controller state uses the versioned
`temperance.signed-probe-challenge-ledger` schema instead. The readiness
preflight reads either form only as a point-in-time replay observation;
`replayState.authorizing` remains `false`, it never consumes state, and it never
writes a promotion input.

### Atomic challenge controller

`scripts/signed-probe-challenge-ledger.ts` is the separately bounded mutation
surface required by ISC-490. Create a dedicated exact-eUID state directory and
receipt directory before use; both must be canonical, non-symlink directories
with mode 700. Paths must be exact absolute NFC spellings: relative paths,
redundant separators, NULs, and raw `.` or `..` traversal are rejected before
any directory or target access:

```bash
install -d -m 700 /private/state/temperance-probes
install -d -m 700 /private/state/temperance-probes/receipts

bun scripts/signed-probe-challenge-ledger.ts issue \
  --ledger /private/state/temperance-probes/challenges.json \
  --receipt-dir /private/state/temperance-probes/receipts \
  --key-id probe-key-2026-08

bun scripts/signed-probe-challenge-ledger.ts consume \
  --ledger /private/state/temperance-probes/challenges.json \
  --receipt-dir /private/state/temperance-probes/receipts \
  --key-id probe-key-2026-08 \
  --challenge <64-lowercase-hex-characters>

bun scripts/signed-probe-challenge-ledger.ts status \
  --ledger /private/state/temperance-probes/challenges.json
```

The controller supports macOS and Linux and fails closed elsewhere. It anchors
ledger, lock, temporary, receipt, and backup names to trusted directory file
descriptors and uses `openat`/`renameat`/`unlinkat` with no-follow and exclusive
creation controls. Existing files must be regular, exact-eUID, single-link,
mode-600 files. An OS advisory lock serializes every writer and is released by
the kernel after process death, avoiding unsafe PID/age lockfile reclamation.
Every native descriptor is close-on-exec, so a spawned child cannot inherit and
prolong the lock after its parent dies.

The state directory must be on one supported local kernel/filesystem boundary.
macOS admits APFS only; Linux admits ext-family, XFS, Btrfs, or ZFS. HFS,
network filesystems, FUSE, SMB, NFS, tmpfs, and unknown types fail closed before
any state file opens. `flock` is not a distributed lock; never share one ledger
between hosts or containers with independent kernels.

Every transition increments a monotonic generation and records a random
operation identifier inside the same atomically replaced ledger object; there
is no separate counter file or wall-clock ordering dependency. Its durable
order is backup, prepared receipt, ledger
temporary file, file fsync, atomic rename, directory fsync, committed receipt,
then success output. `recover --receipt FILE` compares exact existence,
generation, operation identity, and SHA-256 state: an exact pre-state aborts the
prepared operation, an exact post-state finalizes it, and anything else is
drift. Unsupported directory fsync or native filesystem operations are errors,
never ignored compatibility warnings.

The exact pre-state is checked twice while the advisory lock is held: before
the ledger temporary file is created and again after that file is durable but
immediately before rename. Capacity checks, pruning, issuance, consumption,
recovery, and issuance revocation all share this same lock. If consumption and
revocation race, whichever commits first creates the terminal generation; the
loser observes consumed/revoked state or receipt drift and fails.

Challenges are 256-bit OS-generated nonces with at most five-minute lifetimes.
Issued, consumed, and revoked tombstones remain beyond maximum clock skew plus
a recovery margin. They prune only after `retainUntil`; the ledger rejects new
issuance instead of evicting a live entry when its 128-entry or 65,536-byte
bound is exhausted.

`status` is the capacity-warning surface: operators should alert before 96 of
128 entries. Retained entries are not permanent; after their explicit
`retainUntil`, the next successful issuance prunes them under the same lock. If
all 128 entries are still retained, issuance fails closed and the operator waits
for the earliest `retainUntil` or rotates to a separately approved key epoch;
there is no force-eviction command.

Rollback is intentionally monotonic. `rollback --receipt FILE --receipt-dir
DIR` accepts only the exact, still-current receipt for an unconsumed issuance
and writes a new `revoked` generation. It never restores earlier ledger bytes,
deletes replay history, or reverses consumption. A consumed challenge requires
key-epoch revocation for exceptional administrative response; it cannot be
reopened by this controller. Rollback receipts use the same operation schema
and explicitly carry `authorizing:false`.

All controller results and receipts state `authorizing:false`. The controller
is not imported by `omniroute-promotion.ts`, `multi-backend-router.sh`, or the
routing-policy promotion script. A future authorization controller must be
separately approved and must join signed integrity, independent surface
authority, and one successful atomic consumption without weakening any current
Cloudflare, A2A, Hermes, EC2, or routing gate.

For Cloudflare, the signed payload may bind the expected account, zone,
hostname, tunnel, and enumerated GET-only endpoints. Even a perfect signature
sets only `signedProbeState: integrity-only`; `resourceScope`,
`hostnameZoneAuthority`, and `ready` remain false until authenticated API
readbacks independently prove token policy resources and hostname ownership.

For A2A, use audience `temperance-a2a-readiness` and bind the installed package
version, source digest, exact isolated server instance, denial checks, declared
capabilities, timeout, idempotency, and error-taxonomy evidence. Missing safety
evidence is `indeterminate`; explicit failure is `fail`. A complete signed claim
still cannot satisfy handler dataflow proof, technical readiness, operator
authorization, or promotion.

### Read-only native A2A preflight

Inspect the installed OmniRoute package without sending a request or changing
its settings:

```bash
bun scripts/omniroute-a2a-readiness.ts

# Only after a separately authorized live denial probe exists:
bun scripts/omniroute-a2a-readiness.ts \
  --probe-receipt /absolute/path/to/mode-600-a2a-probe.json
```

The source preflight binds its observations to the installed package version
and a SHA-256 over the five A2A route implementations, API-key contract, task
manager, and native CLI. It looks conservatively for one scoped A2A principal
on the RPC, status, list, detail, and cancel routes; no ambient process-wide
`manage` principal; explicit owner enforcement; a bounded skill allowlist; and
coherent `tasks.create` POST support. These are source indicators, not handler
dataflow proof: keyword or bundled-source inspection can never set
`sourceReady:true` by itself.

Source inspection is not live readiness. A mode-600 receipt may claim an exact
source digest and package version, expire within five minutes, refuse its
own promotion claim, require human sign-off, and prove anonymous,
invalid-Bearer, forbidden-skill, CLI-create, and cross-principal read/cancel
behavior. Mode 600 provides confidentiality, not authenticity. A separate
Ed25519 signed probe may now establish signer integrity, exact isolated-instance
binding, and the completeness state of behavioral safety claims. It still
disclaims handler safety, cannot prove handler dataflow, and cannot authorize
promotion. `sourceReady`, `liveReceiptReady`, `technicalReady`,
`promotionAuthorized`, and `promotionReady` remain false. Operator authorization
is still a separate final gate after independent technical evidence exists.

OmniRoute 3.8.48 currently reports `sourceIndicatorsPass:false` and
`sourceReady:false`: the ambient management
key, unguarded companion routes, ownerless task map, unbounded hardcoded skills,
and CLI/server create mismatch remain visible. A2A therefore stays disabled,
with no task, client, credential, or custom replacement created.

## Rollback order

Remote rollback and local-auth rollback are separate operations.

For remote exposure:

1. Stop the named-tunnel connector so cached DNS cannot reach the origin.
2. Delete the exact owned DNS route, clean up tunnel connections, and poll until
   the Cloudflare API reports zero active connectors.
3. Delete the exact owned remote tunnel configuration and tunnel object.
4. Delete the exact owned Access policy and application, then revoke the Access
   service token and prove Access rejects it.
5. Revoke the constrained remote OmniRoute key and wait for a real HTTP 401;
   restart the drained loopback service if immediate cache invalidation is
   required.
6. Delete only secret files owned by the exact private transaction receipt.
7. Keep mandatory local client authentication enabled.
8. Verify loopback binding, Quick Tunnel stopped, local client canaries, and
   protected Hermes invariants before restoring any optional launcher.

For the local client-auth migration, use only the exact receipt that created
the dedicated key. Stop every remote transport first, drain workers, restore
the recorded flag and key state, then verify every listener and client. Never
restore an anonymous or all-interface origin while any remote route exists.

For the dormant MCP-scope LaunchAgent change, retain the timestamped pre-change
plist. `omniroute-local-rollback-rehearsal.sh` proves its bytes restore exactly
without disturbing the live service; an actual rollback must boot out the
agent, restore that exact plist, bootstrap it, and re-run authenticated health,
loopback, Quick-Tunnel, MCP, and A2A boundary probes.

The Temperance proxy has its own transactional LaunchAgent promotion. Before
mutating live files, `temperance-proxy-launchd.sh install` snapshots the complete
installed proxy, router, enrichment tree, and plist. It retries transient
`launchctl bootstrap` failures, requires bounded loopback health, and restores
the exact previous bytes plus the previous agent whenever copying, bootstrap,
or health verification fails. `tests/temperance-proxy-launchd.sh` exercises the
retry, mid-copy rollback, and failed-promotion recovery paths in isolation.

## Operator rules

1. Treat dashboard login and client API authentication as separate checks.
2. Keep Quick Tunnel disabled; a random URL is never a durable endpoint.
3. Keep Prompt Compression globally off until fixture parity passes.
4. Keep `ISA.md` as acceptance owner and `.planning` as planning owner.
5. Use exact non-Sol models through proven client wires; never equate catalog
   presence with working streams, tool schemas, or substantive output.
6. Keep external Codex tasks self-contained. Default isolation removes ambient
   user configuration but preserves repository-local rules; exact zero is the
   auditable emergency opt-out.
7. Preserve Hermes units, credentials, gateway state, and infrastructure unless
   a separately authorized host-specific plan says otherwise.
8. Keep A2A disabled until `/a2a` and every task-management route deny anonymous
   and invalid credentials through one governed, scoped principal boundary, and
   the native CLI's create/list/read/cancel contract passes coherently.
