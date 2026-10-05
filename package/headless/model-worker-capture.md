# Bounded model-worker capture (source bootstrap)

`lib/model-worker-capture.py` exposes `FinalSink(canonical_private_directory)` and
`collect(stdout_read_fd, stderr_read_fd, sink, deadline=..., terminal=..., cancelled=...)`.
The caller transfers ownership of distinct readable pipe descriptors. The FIFO is
exclusively created with mode 0600 beneath an owner-only directory, opened with
no-follow/nonblocking flags, and removed only after descriptor/path identity agrees.
Directory/path continuity is checked at cleanup, but this is not atomic writer pathname binding. A renamed/replaced parent can redirect a future writer before that check. Trusted private-directory ancestry, cooperative ownership and protection against malicious same-UID code remain caller policy; actual CLI pathname-binding proof is absent.
The FIFO path is private operational metadata; receipts contain no payload or paths.

The caller retains one same-host monotonic deadline before launching any work.
Capture accepts at most 120 seconds remaining and never renews it. Once a trusted
`Terminal(exited=True, exit_code=..., final_write_completed=...)` is observed,
remaining drain is at most 250 milliseconds inside that deadline. Callbacks are
trusted synchronous owner observations, checked before and after invocation; they
cannot be preempted. FIFO EOF is never a process termination observation. A local
keeper prevents EOF before an external writer opens. Explicit final-write completion
is required even for successful-empty output; absent writer evidence holds.

Fixed byte ceilings are 64 KiB per newline-delimited event frame (excluding LF),
4 MiB events, 1 MiB stderr, 256 KiB final and 5 MiB aggregate. Reads request at most
16 KiB or the remaining allowance plus one overflow byte. Overflow is checked before
retention. Private buffers are bounded; conversion to immutable returned bytes can
transiently require a second bounded copy. Event bytes are framing-only, **not JSON
syntax, Codex schema, terminal protocol or pre-effect validation**. Exact final FIFO
bytes are returned without reconstructing text from events. A held result discards
payloads, retains bounded counts and supplies false authority flags. Close uncertainty
holds; local descriptor closure does not prove process cleanup.

This primitive does not spawn, signal, supervise model RSS/physical footprint, admit
accounts, reserve slots, or authorize replay. The original invocation owner must keep
any consumed launch slot after failure, lost acknowledgement or cancellation. It must
separately join the launch handshake, verified process lifetime/resource policy and
actual CLI. Organ guard limits are not a model-worker resource policy.

Official [Codex 0.147 JSON processor](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
selects final text from terminal turn items, including a Plan fallback; failed or
interrupted turns suppress final emission. [Terminal backfill](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/exec/src/lib.rs)
can recover items absent from the streamed events, so the last streamed agent message
cannot universally reconstruct output-last-message. Its [final writer](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/exec/src/event_processor.rs)
uses `std::fs::write`, supporting a source/POSIX FIFO compatibility inference.
No installed binary FIFO execution was tested; the future join must establish that
compatibility and truthful final-write completion, including failure/empty outcomes.

No wire integration, model inference, default installation or live Build acceptance
is claimed by this bootstrap. Inert tests exercise capture ownership only.
