---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Public Temperance Glove
status: planning
stopped_at: Phase 1 planned — ready for execute-phase
last_updated: "2026-08-20T16:45:00.000Z"
last_activity: 2026-08-20 — Phase 1 PLAN.md files written with --skip-ui; ecosystem version control added
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# Planning State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-08-19)

**Core value:** A fresh local machine can reproduce verified Temperance behavior from the public repository without inheriting the developer workstation's private state.
**Current focus:** Phase 1 — Provenance Contract and Read-Only Control Plane

## Current Position

Phase: 1 of 7 (Provenance Contract and Read-Only Control Plane)
Plan: 01-01, 01-02, 01-03
Status: Phase 1 planned (CLI --skip-ui) — ready for `/gsd:execute-phase 1`
Last activity: 2026-08-20 — Phase 1 plans + ecosystem VERSION/CHANGELOG control

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

| Phase | Plans | Status |
|---|---:|---|
| 1 | 3 | Planned |
| 2–7 | TBD | Not started |

## Accumulated Context

### Decisions

- v1.1 Public Temperance Glove is the sole active milestone; earlier authorities remain historical or held.
- 2026-08-20: Phase 1 planned with `/gsd:plan-phase 1 --skip-ui` (CLI doctor, no UI-SPEC). Plans 01-01/01-02/01-03. Ecosystem version planes: glove `VERSION` 0.1.0, OmniRoute pin 3.8.48, host `~/.temperance_engine/VERSION`. Phases 2–7 still require discuss-phase before PLAN.md.
- macOS Apple Silicon and Intel qualification blocks release; Linux remains visible best-effort evidence.
- `atlasRecall.ts` remains a private overlay and is excluded from public source, artifacts, inventories, and generated documentation.
- The manifest owns provenance mechanics only; `ISA.md` remains the acceptance judge.
- Five reviewable release commit slices constrain integration and review, not the seven-phase roadmap shape.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2 must close the existing `verify.sh` private-path guard failure through source convergence, not broad suppression.
- Phase 4/6 planning must prove meaningful LaunchAgent lifecycle control on both blocking macOS architectures or define an equivalent clean ephemeral Mac gate.

## Deferred Items

| Category | Item | Status | Deferred At |
|---|---|---|---|
| Release hardening | Artifact attestations and receipt pruning | Future v1.x | Milestone intake |
| Platform breadth | Additional Linux service managers and package-manager distribution | Future v1.x | Milestone intake |
| Private overlay | Generic public recall capability | Future milestone pending generic privacy-safe fixtures | Milestone intake |

## Session Continuity

Last session: 2026-08-20T08:11:52.790Z
Stopped at: Phase 1 planned — ready for `/gsd:execute-phase 1`
Resume file: .planning/phases/01-provenance-contract-and-read-only-control-plane/01-01-PLAN.md

## Historical state snapshot (preserved from 2026-08-17)

- Milestone: `public-ready-docs-glove`
- Phase: `execute`
- Status: `spine-live-four-surface-mode-bind`

## Historical glove snapshot (2026-08-16/17)

ISA Goal is still the judge: public-ready `Sheshiyer/temperance_engine` with install, verify, rollback, templates, and documentation.

What is **live now** (do not re-plan this):

- `./install.sh --with-spine` — Claude + Codex UPS compose, `/gsd:*` remotes on Claude/Codex/OpenCode/Grok, Manifest Zone, Pulse
- Mode-bind: `/gsd:*` skips the quiz; a native card only on a bare first prompt with no saved mode
- `/gsd:goal` + `.temperance/goal.json` (`temperance.goal.v1`) — last eval **met**
- Repo `AGENTS.md` (project-rail + mode-bind)
- `active_planner=isa` in `.temperance/project.json`
- Fleet combo `te-dispatch-paid`; Sol babysit only
- Docs map: `docs/README.md` · visual library: `docs/index.html`
- Codex CLI limits documented: `docs/codex-cli-limits.md` (no async hooks)

What is **historical** (do not execute):

- Vault relocation plans under `docs/plans/2026-08-0*`
- The 2026-08-02 native-integration completion audit below
- Retired stubs: `docs/parallel-dispatch.md`, `docs/multi-surface-architecture.md`

The former next command was `/gsd:progress` or `/gsd:goal --eval`; v1.1
supersedes that queue. Do not start a second `gsd-executor` swarm.

## Held Completion Audit (2026-08-02, retained)

The full objective remains active across Context Settings, direct CLI Code,
CLI Agents and native Hermes support, Cloudflare access, PAI/GSD/ISA ownership,
skill-cluster discovery, and governed parallel routing. The completion audit
must distinguish locally finished adapters from externally gated promotion and
must preserve the later authorization to use governed non-Codex OmniRoute
workers while keeping every Sol-family model outside worker dispatch.

## Historical Ratified Focus

Ratification source: the operator's 2026-08-02 authorization to use governed
non-Codex OmniRoute models while continuing the OmniRoute, Cloudflare, PAI,
GSD, Hermes, and skill-cluster integration plan with Sol excluded.

- Keep PAI, GSD, ISA, and skill clusters as the sole semantic-policy owners;
  Context Settings may optimize transport only after synthetic evidence passes.

- Pin installed OmniRoute 3.8.48's exact CLI command, loopback
  compression-preview route, OpenAPI body, and management-policy sources through
  an offline, non-authorizing readiness inspector. Version or source drift is
  `contract_unverified`, never a readiness conclusion.

- Accept no arbitrary prompt input. Embedded fixtures contain synthetic PAI
  order, GSD state, ISA, tool-schema, code, receipt, and injection canaries only.

- Without authority, send one anonymous synthetic denial canary and classify all
  engines held. Never reuse a browser session, dashboard password, cookie,
  machine token, or inference API key to force management access.

- A later live semantic matrix still requires process-bound authenticated
  transport with scope, expiry, and revocation evidence. No dormant socket/PID
  transport enters the current tree, and a scoped bearer token alone remains
  held because plaintext loopback does not authenticate the accepting process.

- Retain metadata-only, non-authorizing receipts. Keep global compression,
  active combo, custom system prompt, provider routing, Cloudflare, Hermes,
  MCP/A2A, EC2, and every Sol-family model unchanged.

Current implementation boundary:

- Offline static inspection is the default and performs no network request.
- Readiness uses a separate schema and cannot modify denial evidence.
- The inspector never executes the installed token loader or reads any
  credential source; it records only versioned source paths, hashes, and
  coarse contract markers.

- The live official CLI and direct loopback probes already returned exact
  management denial; they are historical evidence, not a recurring hook.

## Historical Completion Checklist

- [x] all named surfaces audited against live and repository evidence
- [x] exact Spark and governed non-Codex Council evidence reconciled
- [x] SystemsThinking selected launcher isolation as the feasible leverage point
- [x] pre-build Advisor refined global umask into artifact-local permissions
- [x] default-isolated launcher and explicit-zero warning implemented
- [x] private dispatcher artifacts implemented without worker umask drift
- [x] focused, documentation, native, and canonical gates pass
- [x] default-isolated exact Spark proof and protected invariant comparison pass
- [x] post-build Advisor, independent Cato, and reread reconciliation pass

Previously completed Context Settings qualification evidence remains intact:

- [x] installed route/OpenAPI/auth-policy inspection
- [x] anonymous denial and active machine-token rejection probes
- [x] three governed non-Codex council reviews with gateway attribution
- [x] ISA atomic criteria and GSD phase map
- [x] synthetic qualifier core, CLI, and adversarial tests
- [x] native documentation and structural integration gates
- [x] live denial-only metadata receipt with invariant equality
- [x] focused, native, documentation, and canonical verification
- [x] Advisor attempts recorded unavailable; independent Cato passes
- [x] ISA verification append and reread reconciliation

## Historical Evidence

- The offline readiness command reports `contract_verified` only because the
  installed 3.8.48 bytes match six reviewed SHA-256 pins and every ordered
  marker. Its receipt is instant, non-cacheable, non-replayable, tokenless, and
  explicitly disclaims package/module-graph integrity, transport, authorization,
  semantic qualification, mutation, and promotion.

- Focused readiness tests pass 15/15 with 264 assertions; the semantic-preview
  suite passes 13/13 with 91 assertions; native integration and the canonical
  `bash scripts/verify-all.sh` pass. Independent Cato reports no P0/P1.

- The protected before/after native projection is equal: OmniRoute PID `17555`,
  compression and custom prompt off, Quick Tunnel stopped, Hermes proposal-only,
  MCP dormant, A2A held, and dispatch Sol-free. The independently refreshed
  inventory is currently 27 connection rows across 25 provider families; its
  earlier 28-row snapshot changed outside this bounded non-mutating slice.

- External Codex workers now default to supported `--ignore-user-config` while
  retaining repository rules and explicit OmniRoute routing parameters. Exact
  value `0` alone opts out with a credential-free warning; `--ignore-rules` is
  absent and no Sol-family model is admitted.

- Dispatcher-owned output is established mode `700`; every retained artifact
  is mode `600` without changing the worker's inherited umask. Signal cleanup
  freezes, kills, and reaps complete worker trees before worktree cleanup and
  final hardening. Cato's former late mode-644 diff reproduction now passes.

- Accepted exact Spark receipt `tmp.RDcxO4QeKF` completed one substantive
  12-second attempt with no fallback and a unique correlation. Original
  ambient-config timeout and the final non-completing rerun remain rejected;
  timeout enlargement and Sol fallback were not used.

- Protected native projections remain equal. Provider inventory is 28
  connections/25 families, not two; compression and custom prompt stay off,
  Hermes stays proposal-only, MCP/A2A stay dormant/held, Quick Tunnel stays
  stopped, and the five-worker dispatch manifest remains Sol-free.

- Focused dispatcher, documentation continuity, native integration, syntax,
  diff hygiene, and the serial canonical verifier pass. Independent Cato's
  final private reproduction reports PASS with no remaining P0/P1.

- Installed source shows `/api/compression/preview` performs compression and
  returns diff, validation, and statistics without a settings-write call. Its
  management middleware executes before the route and requires authority.

- Anonymous synthetic preview returns `401 AUTH_001`. The documented local CLI
  machine token also returns `401 AUTH_001` on the active runtime, so it is not
  silently treated as valid evidence or bypassed with a browser credential.

- The current redacted snapshot reports master compression off, default mode
  off, no active combo, `preserveSystemPrompt:true`, custom prompt off, local
  Hermes absent, Quick Tunnel stopped, and Sol-free governed dispatch.

- Architecture, security, and semantic reviews completed through exact
  Antigravity, GitHub, and no-think Antigravity Sonnet 5 profiles. Gateway rows
  show distinct Antigravity/GitHub HTTP-200 attribution, zero retained request
  and response bodies, finite spend, no tools/persistence, and no Sol use.

- The selected design is a staged qualifier: the current unauthenticated run
  proves denial only; actual engine qualification waits for process-bound
  authenticated transport and exact synthetic semantic/invariant evidence.

- Live v2 receipt `20260802T053147600Z-78868-GCtUWE/receipt.json` is mode 600,
  tokenless, non-authorizing, held on HTTP 401, and records byte-identical
  governed projection hashes before and after the canary.

- Focused tests pass 13/13 with 91 assertions; native, documentation, diff, and
  full repository gates pass. Independent Cato passes after three P1 repairs;
  both Advisor attempts timed out and are not counted as approval.

## Next Governed Gate

- Retain the verified denial-only Context receipt and isolated-worker contract.
  Actual Lite/Headroom/minimal-RTK qualification, native Hermes Apply, named
  Cloudflare promotion, authenticated MCP/A2A, and genuine S/Algorithm remain
  closed until their separate process-bound or external authority gates pass.

- A successful authenticated semantic preview and the future one-shot
  process-bound transport adversarial matrix remain open under ISC-597,
  ISC-603, and ISC-607. The failed no-edit Forge attempt keeps ISC-612 open.

## Previous Command Code Evidence

- The focused gate passes 68 Bun tests and 208 assertions across the enrichment
  and direct Command Code adapter surfaces. The actual Bash e2e proves canonical
  one-line output, no body canaries, missing-source isolation, reserved-line
  spoof denial, missing-Bun denial, distinct same-model workspaces, and zero
  `command-code` launch after adapter failure.

- `bash tests/omniroute-native-integration.sh` passes the adopted Command Code
  ownership and every pre-existing native boundary. All three TypeScript entry
  points bundle, shell syntax passes, and `git diff --check` is clean.

- A live actual-renderer probe emitted exactly one pointer line and zero body or
  secret canaries. PAI/GSD/skill pointer targets, OmniRoute SQLite, the dispatch
  manifest, Hermes metadata, exact `cloudflared` PID state, and ports 20128/20129
  listener state were unchanged; the private proof artifact was removed.

- The canonical `bash scripts/verify-all.sh` exited zero and ended
  `Temperance Engine full verification passed` after running the new adapter
  unit and shell integration gates.

- The strict helper-ingestion fixture rejects a debug or secret preamble before
  document validation, AGENTS promotion, or Command Code launch. Same-model
  captures now directly prove task-to-AGENTS correlation, and mode assertions
  use native BSD `stat` plus a hermetically forced GNU `stat -c` branch. This is
  branch evidence, not a claim that the complete suite ran on a live Linux host.

- The native structural gate proves the Command Code helper imports the actual
  production pointer resolver and serializer; red controls distinguish reserved
  line, missing-Bun, and malformed-helper failures by their exact diagnostics.

- Independent Cato reproduced every focused, live, native, and canonical gate
  and returned PASS with no P0/P1. Its remaining same-UID validate/reopen race
  is constrained by random mode-600 files and remains non-authorizing.

- Two pre-build native audits ran through exact GitHub Sonnet 5 and no-think
  Antigravity Sonnet 5 profiles with private mode-600 outputs, finite spend, no
  tools or persistence, and gateway HTTP-200 attribution. Zero Sol-family model
  was dispatched.

- External promotion remains closed: native source credentials/denial probes,
  Hermes Apply authorization, named Cloudflare hostname/DNS/Access machine
  authority, scoped MCP/A2A ownership, and genuine S-provider authentication
  are not supplied by this local alignment.

### Open ISC Boundary Map (28)

| ISC | excluded category | why outside this local alignment |
|---|---|---|
| ISC-333 | genuine-S / EC2 provider promotion | requires authenticated genuine S provider evidence |
| ISC-334 | genuine-S / EC2 provider promotion | requires OmniRoute dashboard administration |
| ISC-335 | genuine-S / EC2 provider promotion | depends on completed S promotion evidence |
| ISC-336 | genuine-S / EC2 provider promotion | requires a live promoted EC2 Algorithm session |
| ISC-352 | named Cloudflare / remote authorization | requires a live remote anonymous-denial probe |
| ISC-353 | named Cloudflare / remote authorization | requires a dedicated constrained remote inference key |
| ISC-354 | named Cloudflare / remote authorization | requires an externally enforced endpoint allowlist |
| ISC-355 | named Cloudflare / remote authorization | requires an externally enforced rate limit |
| ISC-356 | named Cloudflare / remote authorization | requires an externally enforced spend limit |
| ISC-357 | named Cloudflare / remote authorization | requires live remote management denial evidence |
| ISC-358 | named Cloudflare / remote authorization | requires live provider-management disclosure denial |
| ISC-360 | named Cloudflare / remote authorization | requires an active approved transport rollback proof |
| ISC-382 | authenticated MCP/A2A upstream safety | requires bounded authenticated native A2A capability proof |
| ISC-430 | named Cloudflare / remote authorization | requires a promoted named tunnel and live catch-all probe |
| ISC-431 | named Cloudflare / remote authorization | requires a live Cloudflare Access denial probe |
| ISC-432 | named Cloudflare / remote authorization | requires an Access-authenticated allowlisted routing probe |
| ISC-446 | named Cloudflare / remote authorization | requires approved service-token or mTLS machine identity |
| ISC-447 | named Cloudflare / remote authorization | requires production tunnel credential placement evidence |
| ISC-448 | named Cloudflare / remote authorization | requires live pre-routing remote model denial |
| ISC-449 | named Cloudflare / remote authorization | requires dependency-ordered live remote rollback evidence |
| ISC-512 | named Cloudflare / remote authorization | requires exact signed external authority and safe preconditions |
| ISC-514 | named Cloudflare / remote authorization | requires a scoped production control-plane token file |
| ISC-515 | named Cloudflare / remote authorization | requires approved production secret sinks |
| ISC-519 | named Cloudflare / remote authorization | requires a production token-file connector launch |
| ISC-520 | named Cloudflare / remote authorization | requires durable production journaling and receipt sinks |
| ISC-523 | named Cloudflare / remote authorization | requires the complete live Access/origin/model canary matrix |
| ISC-525 | named Cloudflare / remote authorization | requires final production-fixture coverage before promotion |
| ISC-527 | named Cloudflare / remote authorization | requires durable one-use signed operator approval consumption |

Native Context Source activation and Hermes Apply remain separately held
promotion boundaries in this focus; neither is silently counted as completed by
the 28 open historical ISCs above.

## Previous Verified Cloudflare Focus

- The production adapter is isolated; the generic CLI stays preview-only.
- Credential sources, durable journals, redirect/content-type handling, and
  approval anti-replay passed hermetic tests and independent review.

- OmniRoute 3.8.48 cannot exactly represent the requested production policy,
  so prepare stops before its first packet with `omniroute_policy_not_exact`.

- Hostname, Access, DNS, scoped authority, live canaries, connector wiring, and
  network-partition evidence remain external gates.

## Previous Completion Checklist

- [x] `./scripts/verify-all.sh`
- [x] `bun test package/enrich`
- [x] `bash tests/docs-continuity.sh`
- [x] `bash tests/router-hardening.sh`

## Next Intake Rule

Move deferred specs into active phases only after their status becomes approved
or the operator explicitly ratifies that surface for implementation.

## Historical Intake Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-08-19 — Milestone v1.1 started
