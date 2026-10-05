# Pure Codex0.147 app-server protocol bootstrap

`lib/codex-app-server-protocol.py` implements a conservative version-pinned profile,
not a native Hands adapter. It does not spawn Codex, communicate over stdio/network,
install a service, load account configuration, or authorize any model/tool action.

An owner creates `Protocol(expected, deadline=..., clock=..., cancelled=...)` with a
single retained same-host monotonic deadline, at most120 seconds remaining. Expected
private server home, requested model/provider/cwd/approval policy/read-only sandbox,
and one synthetic text input are detached. `request(method)` plans each message once
and advances state before exposing its bytes; transport delivery uncertainty requires
`lost_response()` and permanently holds. No retries, environment/latest identity
recovery or renewed deadline exist. Future adapters must connect trusted retained
launch acknowledgements, eligibility/account capacity and separate per-turn admission.
A process-launch counter is not an inference-request counter.

The planned sequence is initialize response, initialized notification, thread/start
resolved-parameter parity, one turn/start response, exact turn/completed notification,
then correlated thread/read with includeTurns true. Thread and turn started/terminal
notifications racing their responses are bounded and retained without inferring the
missing response. Request IDs1–4 are fixed per isolated instance. Thread/session/turn IDs and
resolved model/provider/cwd/approval/sandbox must match; final thread version must be
0.147.0 and non-ephemeral. Strings are internal; public receipts expose no content,
identifiers or private paths.

Decode ceilings:1MiB per message,8MiB cumulative incoming bytes, depth32 before JSON
parse,131072 non-whitespace lexical characters outside strings before parse,65536
postdecode nodes,4096 items per turn/history list,8 pending notifications,256KiB final
message/Plan text. Strict UTF8, nonfinite rejection and recursive duplicate-key checks
precede promotion. This is a distinct app-server message profile, not an extension of
the exec64KiB event collector. Future framing/backpressure/deadline/process/resource
joins remain necessary. Parsing and owner callbacks are synchronous, not preemptible;
clock/cancellation are checked around transitions. Non-result item payloads and unused
thread metadata remain bounded opaque values, not complete schema/action validation.

Only the planned response shapes and thread/turn started/completed notifications are
supported. Other notifications and all server requests—including approval requests—
hold; there is no blanket accept or policy amendment. A future transport owner must
handle rejection/interrupt/cleanup. Unsupported experimental fields hold at closed
response boundaries. The initial profile is read-only; workspace-write/Build permission
support requires a separate reviewed extension rather than a default widening.

Successful promotion requires one exact matching turn with itemsView full and status
completed. Summary does not supply full history. Terminal and readback failure/error
must agree; failed/interrupted results remain unsuccessful. Last available agentMessage
is selected, otherwise last Plan; empty typed text is allowed, absent text holds.
Summary/full final text contradiction holds. This is available persisted app-server
history, not proof of all actual actions, business zero effects or semantic acceptance.
Every receipt keeps execution, capacity, actual phase-role, pre-effect and replay flags
false. The reported version is protocol metadata, not executable/source authentication.

Primary pinned sources:

- [Thread and turn schema](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs): itemsView full describes available persisted history; terminal status/error/times are typed.
- [Completion emitter](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/bespoke_event_handling.rs): completion normally includes only last agent message Summary, otherwise NotLoaded.
- [Thread reader](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/request_processors/thread_processor.rs): ephemeral includeTurns is rejected; non-ephemeral loaded history provides readback. Workspace-write can persist trust into the server home.
- [Exec backfill/final selection](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/exec/src/lib.rs) and [JSON final selection](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs): terminal readback and Plan fallback explain why last streamed exec message cannot universally replace the final sink.
- [Generated input schema](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server-protocol/schema/typescript/v2/UserInput.ts): text input uses text_elements despite most protocol fields being camelCase.

Fixtures use disposable synthetic content and actual pinned field casing/nullability.
No fixture establishes actual native CLI compatibility, paid capacity or complete
adapter acceptance. No model inference or configuration mutation is performed.
