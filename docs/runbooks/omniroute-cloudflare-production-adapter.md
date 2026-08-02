# OmniRoute Cloudflare production-adapter boundary

Status: an unexecuted production composition boundary is locally implemented and
hermetically verified; its live path remains fail-closed. This runbook does not
authorize a Cloudflare write.

## What exists

`package/router/omniroute-cloudflare-production-adapter.ts` is the explicit
composition boundary for the already-tested promotion state machine. It is not
imported by `scripts/omniroute-cloudflare-promotion.ts`, performs no I/O at
module load, and has no default hostname, credential, connector, canary, or
approval authority.

The adapter provides locally testable production mechanics:

- Cloudflare and OmniRoute management credentials are read only from canonical
  owner-only regular mode-`600` files outside the repository. Symlinks,
  hardlinks, broad modes, argv, environment, dashboard sessions, and Wrangler
  login state are not fallback sources.
- Every external mutation receives a request-hash intent before the injected
  call. The file is `fsync`ed, uses Darwin `F_FULLFSYNC`, and the containing
  directory is full-synced after each exclusive create or atomic rename. Linux
  uses file and directory `fsync`; no cross-volume atomicity is claimed. A
  sanitized result containing the exact returned ID and state hash is persisted
  immediately afterward.
- Access and tunnel one-time secrets go directly to exclusive mode-`600` sinks.
  Their payloads are cleared from mutable buffers and never enter journal
  records, receipts, errors, or serialized results.
- HTTP is dependency-injected, timeout-bounded, uses `redirect: manual`, and
  rejects redirects, HTML Access pages, non-JSON responses, and oversized
  responses through closed error codes without body echoing.
- A network exception after a prepared intent is `manual_orphan`, never retried,
  and never an excuse to discover, adopt, or delete a same-name resource. Production
  recovery uses only an exact journal-recorded ID. Service tokens, OmniRoute
  keys, and tunnel configurations have no name-only recovery path.
- `createChallengeLedgerApprovalReplayPort` consumes the existing durable
  signed-probe challenge ledger as anti-replay state. Its results remain
  `authorizing:false`; the core's pinned Ed25519 signature, expiry, and prepared
  state checks are the authorization gate that must run first.

The focused test is:

```bash
bun test package/router/omniroute-cloudflare-production-adapter.test.ts
```

It currently passes 14 tests and 54 assertions. The fixtures reject symlinked
receipts, hardlinked operation records, and malformed records. Separately, code
inspection confirms recovery reads use the same owner/mode/link/inode checks as
credential reads and read only from the validated descriptor without reopening
the pathname; the fixture does not claim deterministic race injection. The
canonical working-tree gate `bash scripts/verify-all.sh` also exits `0` and ends with
`Temperance Engine full verification passed`. That script does not emit one
aggregate test/skip count, so none is claimed; this is not a clean-checkout or
live-Cloudflare result.

It uses an injected HTTP function and private temporary APFS directories. The
adapter has no global-fetch fallback, and the source guard finds no OmniRoute
POST path. The suite does not call Cloudflare, mutate OmniRoute, start
`cloudflared`, or create DNS. It deliberately cannot cover real Cloudflare error
shapes, Access admission, DNS/TLS behavior, connector lifecycle, live canaries,
rate/spend exhaustion, or network partitions; those remain external gates.

## Why prepare still refuses before its first packet

Installed OmniRoute 3.8.48 can create a no-log key with model allowlists, chat
endpoint categories, rate windows, spend limits, and scopes through
`POST /api/keys`. It cannot exactly represent four controls promised by the
current manifest:

| Promised control | Manifest field | Installed API mismatch |
|---|---|---|
| Requests per session | `remoteKey.policy.session.maxRequests` | No native field; `maxSessions` is concurrency, not a request count. |
| Session duration | `remoteKey.policy.session.maxDurationSeconds` | No native duration field. |
| Burst ceiling | `remoteKey.policy.rate.burst` | Rate windows exist, but no equivalent independent burst semantic. |
| Exact route | `remoteKey.policy.endpoints[0]` = `/v1/chat/completions` | `allowedEndpoints:["chat"]` includes several chat-family routes and unknown paths fail open. |

`buildOmniRouteKeyPlan` therefore returns
`supported:false, code:omniroute_policy_not_exact`, and `createRemoteKey`
aborts its local intent before any HTTP request. The adapter does not create a
weaker key and label it exact. A future ratified design must either narrow the
manifest to genuinely native controls or add an independently verified policy
enforcement seam before this gate can open.

## External gates that remain open

- an operator-selected hostname, exact account and zone, Access team, and
  audience;
- independently verified, resource-scoped DNS, Tunnel, Access Application,
  Access Policy, and Service Token write authority;
- strict external Cloudflare and OmniRoute management token files;
- real connector and six-canary implementations wired by a production-only
  composition root;
- a pre-issued approval challenge plus fresh signed prepared-state approval;
- staging evidence for Access identity, exact model attribution, disallowed
  model rejection, management denial, rate/spend exhaustion, rollback transport
  disappearance, and network partitions.

The Cloudflare Quick Tunnel stays stopped. The generic CLI remains preview-only
and returns exit `3` for prepare, promote, recover, and rollback. No dashboard
toggle, Cloudflare Tunnel enablement, or model-provider availability overrides
these gates.

## PAI, GSD, skills, and model routing

PAI owns request classification and the single ISA. GSD tracks this ratified
adapter iteration and keeps external promotion criteria open. Skill clusters
provide bounded capabilities; they do not inject a second routing policy.
OmniRoute may dispatch governed non-Codex models for analysis and review, while
Sol-family models remain excluded. Prompt compression stays off on governed
Temperance/OpenCode paths because exact system prompts, GSD state, ISA IDs, and
tool transcripts are policy-bearing data.

CLI Code and CLI Agents are integration clients of the same loopback OmniRoute
data plane. Native Hermes support should be previewed from OmniRoute's own docs
and settings surface, then reconciled into the existing Hermes configuration;
it is not a reason to expose the dashboard, enable A2A, or bypass the promotion
transaction.
