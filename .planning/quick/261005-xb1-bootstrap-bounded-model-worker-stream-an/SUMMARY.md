---
status: complete
---
# xb1 source bootstrap candidate

Implemented a standalone collector without model/process launch or wire integration.
Fixed byte/frame/aggregate limits apply before retention; output is private exact bytes
or a held result with payload discarded. Final FIFO uses exclusive private creation,
keeper writer, retained identities and cleanup continuity. Trusted terminal observation
must independently establish final-write completion even when final output is empty.
One retained deadline covers capture and at most 250 ms drain, with freshness checked
after cleanup and immutable byte conversion. Synchronous owner callbacks/filesystem
operations remain nonpreemptible; late completion holds.

Verification: `python3 -I -B package/headless/test/test_model_worker_capture.py`:
20 passed, 0.528 seconds. Final AST parsing and diff checks passed. Meaningful cases include frame boundary, each stream
and aggregate cap, delayed writer, missing writer, partial EOF, cancellation, finite
held-pipe drain, late callback, invalid/duplicate descriptors, close failure, selector
close failure, late cleanup, creation-open failure and parent replacement.

Independent review identified four initial cleanup/deadline defects and then an
invalid-first-descriptor cleanup gap. Each was repaired with focused regression.
Root then found registration overwrote retained descriptor identity. The immutable first identity is now revalidated before flag mutation/registration, including the final sink identity; a real dup2 fixture holds and preserves the replacement descriptor. Final independent narrow review clear at source7b53673a/testfb19f56a. Root independently reran all 20 fixtures: pass, 0.512 seconds. Root source/docs approval authorizes exact five-file source publication; no installed adoption.

Scope: framing only, no JSON or Codex semantic/protocol validation, proof75 or replay
authority. Bounded private allocations do not contain worker RSS/physical footprint.
No process termination/cleanup proof, launch-budget handshake, native adapter, provider
call, model execution, install or live Build acceptance. Caller retains consumed slots.
Directory continuity checks do not close writer pathname TOCTOU or malicious same-UID
ancestry; actual CLI FIFO compatibility remains unverified. Official Codex0.147 source
permits a FIFO-writer inference; terminal item backfill and Plan fallback prohibit
universal final-text reconstruction from streamed agent messages.
