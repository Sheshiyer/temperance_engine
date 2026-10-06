# 2q8 source candidate

Implemented the bounded owner-side status/release adapter and explicit encoder dependency, with child FD5/6 roles distinct from internally transferred owner endpoint numbers. Existing libraries remain unchanged. Expected creator/first-child context is retained before status; independent stopped observation must match before the once-only 69-byte control write.

Author verification: `python3 -I -B package/headless/test/test_model_worker_status_fd.py` — 13 mock fixtures passed (final author run 0.002 seconds). Actual published StoppedProtocol is exercised with injected syscall/callback seams. No actual FD/child/native/provider operations occurred. AST and source hashes are recorded in the review handoff. Root independently reran all 13 mocks successfully; independent source review cleared the final hashes after the continuation correction. Publication is authorized for this source/mock unit.

Tests cover status fragmentation and EAGAIN, EOF/reader-close ordering, wrong birth, insufficient PIPE_BUF/partial write, wrong encoder packet, invalid peer safe cleanup, identity replacement refusal, flag drift, expired cleanup, close failure once-only peer cleanup, explicit encoder requirement and post-write observation ordering.

This is source/mock evidence only. Actual original FD3/4 launch codec ACK/EOF ownership join, child bootstrap, native resource/signal/reap and writer provenance remain missing. Callback claims are trusted assertions rather than authentication. Two-FD adapter teardown bounds exclude additional outer protocol checks; caller teardown after outer hold remains required. Synchronous callbacks/syscalls are not preemptible, check-act races remain cooperative, and full control write is not child readiness or no-payload proof.

Independent review found a repeated direct-continuation boundary. Fixed with a sticky attempt guard before the callback; false/exception results hold continuation_unverified and cannot retry, including after new observation. Added direct success/false/exception callback-count regression. Resource-policy approval remains exclusively the outer StoppedProtocol responsibility.
