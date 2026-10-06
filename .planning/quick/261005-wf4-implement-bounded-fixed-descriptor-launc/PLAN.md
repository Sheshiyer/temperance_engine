---
status: in-progress
scope: standalone-source-only
---
# Fixed descriptor launch metadata handshake

Independent transport design review accepted three-message FD3/FD4 handshake with irreversible post-confirmation uncertainty explicitly distinguished from pre-confirmation no-readiness holds. Implement only stdlib codec, focused tests, small protocol doc, PLAN/SUMMARY. Public APIs use literal FD3/4; no CLI/env/config selection, no models/providers.

Closed <=16KiB length frames, exact handle/ACK/confirmation keys, duplicate refusal, pipe directions/nonblocking/CLOEXEC and finite EOF. One absolute exchange deadline <=2s and original conservative invocation deadline captured BEFORE helpercreate, <=120s, forwarded unchanged. Synchronous reserve/retain callbacks checked before/after, never claimed preemptible. Retain ACK before confirm, close descriptors before ready. Lost ACK/cancel/partial/expiry holds without diskcounter recovery/refund/newhandle. After confirmation delivery, owner uncertainty cannot retroactively prove child not ready. All authorityfalse, samehost monotonic/sameUID cooperative only. Future adapter inheritance and actual process/request lifetime remain held.

Meaningful inert pipe/nested subprocess, retained original helper handle, corruption/lostACK/cancellation/EOF/deadline/close fixtures; no native provider/runtime. Review candidate before exact publication; other files untouched.
