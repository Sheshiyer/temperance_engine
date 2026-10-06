---
status: complete
scope: standalone-source-only
---
# Private launch metadata safety bootstrap

New stdlib codec/protocol doc/15focused tests only; launch-budget.py remains exact reviewed297157 bytes. Public owner_exchange and child_exchange use literalFD3/4 with no env/config/FD selection. Private trusted test descriptors/clock/cancellation/read/write/close seams are not production-selection surfaces. Closed length-prefixed16KiB messages reject duplicates/UTF8/nonfinite/unknown fields; separate pipe direction/nonblocking/CLOEXEC and finite ACK/confirmationEOF.

Child reserves once then ACK+closesFD4; owner verifies ACK+EOF, closesFD4, retains immutable ACK before confirmation; child verifies confirmation+EOF and closes both before metadata-ready. Original conservative same-host invocation deadline captured BEFORE helpercreate stays unchanged; transport deadline<=2s/remaininginvocation, checked around IO/parser/callbacks/EOF/closure. Trusted synchronous reserve/retain callbacks cannot be preempted or allocation-bounded by codec. No global total-wall or model/process lifetime claim.

Pre-confirmation missing/lostACK, retain failure, cancellation, partial/extra frames and deadline prevent readiness; consumed slot never refunded/reset/recovered by disk count/new nonce. Post-confirmation owner cleanup uncertainty may leave child metadata-ready; fixture explicitly proves this limit rather than fabricating zero-current-launch. All receipt authority flagsfalse. Originalcreator UID/PID/birth verified by reservation owner, not serialized authentication. SameUID cooperative, no ancestry/capacity proof.

Focused codec15tests pass0.909s; combined sourcebudget+codec33tests passed, AST compile and git diff check pass. Actual nested disposable fixture uses fixed APIs with ONE originaltestcreator record, verifies retained counter and FD3/4 closure before an inert child; retainfailure consumes slot but marker stays absent. Initial nested generatedscript newline escaping failed, fixture corrected and fresh suite passed. No provider/model/service/runtime or installed adapters. Future tasklist/seat/wire inherited-copy closure and actual deadlines remain unimplemented. Root reviewed codec and independently reran15 fixtures (0.914s). Transport independent source/doc review is clear at exact source5a93e979 and test9b02c0b0 hashes. Exact five-file source publication approved, with final combined33-test suite passing. No ISA/STATE, runtime or adapter changes.
