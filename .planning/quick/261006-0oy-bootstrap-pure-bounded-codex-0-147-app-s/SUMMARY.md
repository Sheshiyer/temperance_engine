---
status: complete
---
# 0oy source protocol candidate

Implemented one pure version-pinned Codex0.147 protocol helper with fixed bounded
intake and a conservative read-only lifecycle profile. No transport, process spawn,
configuration mutation or inference. Planned initialization/thread/turn/readback
transitions bind exact response IDs, retained thread/turn identity, resolved request
parameters and available persisted Full history. Terminal-before-response notifications
remain bounded pending evidence. Lost submission response permanently holds; no retry.
Unknown approval requests/notifications hold without blanket acceptance. Typed failed
or interrupted history stays unsuccessful; completed full history selects last agent
message or Plan fallback. All authority flags remain false.

Verification:15 focused inert fixtures pass0.011s; AST and diff checks clear.
Independent integration review clear at sourcef0bfc42f/test0f9613a4 after repairing initial-session retention. Initial thread response now retains sessionId; racing/subsequent started notifications and Full readback must match it. Added changed-session fixtures. Root reviewed source/contract and independently reran all15 inert tests successfully. Exact five-file source publication authorized; native/runtime adoption remains excluded.

Limits remain explicit: pure conservative supported-method/schema profile, unused
thread/tool payloads opaque bounded values, readOnly permissions only, reported version
not executable authentication. Full describes available persisted history rather than
all actual actions or global zero effects. Synchronous parsing/callbacks cannot be
preempted. Actual native transport/backpressure/resource/account/launchACK/per-turn
budget/Hands adapter joins and paid Build acceptance remain open.

GSD initialized using canonical copilot gsd-tools.cjs. The unrelated global gsd-tools
command first rejected existing project initialization without changing project files;
no project recreation/removal occurred. Unknown planning-config-key warnings retained.
