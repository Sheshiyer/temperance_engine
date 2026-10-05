# Reusable bounded MCP stdio transport

Approved cohesion continuation after native memory incident. Native Codex remains the primary workspace; shared config and existing native clients are preserved.

## Ownership

Standalone product owns generic bounded newline JSON framing, serial request handling, bounded response/backpressure and finite shutdown. Noesis owns tool handlers, native registration and generated exact-byte local adapter copies. No pooling across client authority; no provider/routing admission changes.

## Work

1. Inspect current stdio lifecycle and aggregate process metadata without logging raw argv or private contents.
2. Add portable bounded transport with64KiB request frame, bounded pending input,1MiB response and finite write timeout. Validate UTF8 and fragmented frames; reject oversize before parse and honor backpressure. EOF/signals/errors close within finite bounds; do not replay uncertain tool effects.
3. Integrate both private MCP servers through declared exact-byte generated owner module; fixtures assert public/private parity. Existing tools and admission contracts retained.
4. Verify fragmentation, oversize, serial ordering, stalled output, EOF/partial EOF, signal teardown and no private error leakage using bounded injected streams and disposable process fixtures.
5. Independently review, commit exact paths and push owning branches. Runtime adoption only after baseline comparison, backup, source parity and disposable client proof. Never kill unrelated MCP/native app processes.

## Acceptance

No unbounded line assembly or output backlog; no aggregate input bypass via multiple frames; closed finite diagnostic outcomes; effect authority remains with tool owners. Separate source, fresh-process fixture, installed bytes and actual native-client lifecycle acceptance. Host pressure recurrence and sustained canary remain open.
