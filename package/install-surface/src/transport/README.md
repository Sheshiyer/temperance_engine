# Bounded owner stdio

`startBoundedMcpStdio` owns one raw-byte readable/writable pair. Supply a trusted
`handleRequest(request, {signal})` and optionally a fixed `invalidJsonResponse`
JSON value. Undefined whole responses produce no output. The controller exposes
`closed` and `close("shutdown" | "signal")`; the process owner handles signals
and maps receipt reasons to its own exit contract.

Hard ceilings are 65,536 bytes per incoming frame, 262,144 pending bytes including
active frames, 256 pending/active frames, and 1,048,576 bytes per response including
its newline. Handler and EOF drain deadlines are 30 seconds, and each output
write deadline is 10 seconds. Options may only lower these ceilings. Delivered
chunks are budgeted before parsing or invoking a handler. Raw UTF8 fragments are
assembled within the frame bound. Complete queued frames drain on EOF; a partial
trailing frame then closes with `partial-eof`.

Handlers execute serially. The transport snapshots supported plain JSON data into
owned bounded UTF8 bytes without invoking getters, proxies or `toJSON`. It rejects
nonfinite numbers, sparse arrays, cycles, excessive depth/nodes and unsupported
values. Enumerable own string properties are projected; hidden and symbol
properties are omitted. Result production belongs to the handler: the transport
cannot bound an already allocated owner object or the engine's internal property
enumeration. Owners must bound tool results before returning them. The serializer
makes no whole-object key-array or unbounded JSON string copy.

Output waits for its write callback and, when needed, `drain`, before handling the
next request. A completed write describes the local stream boundary, not a client
acknowledgement. Failures, deadlines and owner shutdown never retry a request.
Receipts contain only finite reasons/counts and explicitly confer no effect
authority. An interrupted handler remains `unsettled`; the cooperative AbortSignal
does not prove its effects were canceled. Timers cannot interrupt synchronous
JavaScript or synchronous subprocess calls; handlers retain their own external
execution deadlines.

Injected streams and clocks are trusted owner adapters. A readable must honor
pause/backpressure rather than accumulate an independent unbounded source queue.
Closing destroys both owned streams. This helper does not register native clients,
install wrappers, admit tool authority or share streams between clients.
