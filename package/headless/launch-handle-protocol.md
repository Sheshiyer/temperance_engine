# Private launch handle handshake

This source codec transports launch-count metadata on one host. It does not start a model or authorize execution, inference, or capacity. It uses the reviewed `launch-budget.py` reservation owner. No adapter or installation is included.

The production library has two APIs: `owner_exchange(context, retain_ack)` and `child_exchange(reserve)`. The owner uses FD3 for writing and FD4 for reading. The child uses FD3 for reading and FD4 for writing. Both channels must be distinct pipes with the stated access direction. The codec sets nonblocking and close-on-exec flags. Descriptor numbers cannot come from a packet, environment variable, or configuration. Private functions accept trusted test descriptors and observers only.

Each message has a four-byte unsigned big-endian length, followed by strict UTF-8 JSON. The length must be 1 through 16384 bytes before payload allocation. Duplicate keys, unknown fields, nonfinite numbers, malformed values, and extra messages are held.

| Message schema | Exact fields |
|---|---|
| `temperance.cli-launch-handle.v1` | `schema`, `directory`, `nonce`, `expected_counter`, `launch_limit`, `invocation_deadline_ns`, `exchange_deadline_ns`, `execution_authorized`, `capacity_authorization`, `inference_authorized` |
| `temperance.cli-launch-ack.v1` | Handle fields except `directory`, plus `counter` |
| `temperance.cli-launch-confirm.v1` | Same fields as acknowledgment |

Every authority flag is false. Directory is private runtime data and must not enter Git or public receipts. Nonce is 32 lowercase hex characters. Limit is 1 through 4. Counter is exactly expected counter plus one, within that limit. Acknowledgment and confirmation must preserve nonce, expected counter, limit, and both deadlines exactly. The reservation callback must return the exact existing `temperance.cli-launch-budget.v1` reserved receipt. Packet owner PID/birth is omitted: the reservation owner verifies the original retained record's live creator UID/PID/native birth.

The exchange has three messages:

1. Owner sends the handle on FD3. Child reads it and reserves once.
2. Child sends one acknowledgment and closes FD4. Owner validates that message and EOF, closes its FD4, and calls `retain_ack` before confirmation. That callback must retain the exact counter and return `None`.
3. Owner sends one matching confirmation and closes FD3. Child validates confirmation and EOF, closes FD3, then returns `metadata-ready`. Both APIs return a redacted receipt with all authority flags false.

One retained owner serializes counters and acknowledgments. If reservation, acknowledgment, retention, confirmation, cancellation, close, or deadline is uncertain, hold without refund, disk-counter discovery, handle repair, or recreation. A consumed slot stays consumed. Before confirmation, a missing acknowledgment or retention failure prevents child readiness. After confirmation bytes and EOF have been delivered, owner uncertainty cannot prove that the child did not become ready. Do not replay after that uncertainty. Confirmation is an irreversible bookkeeping commit point, not an execution grant.

Capture monotonic time before helper creation. Retain a conservative original invocation deadline of that time plus requested TTL, at most 120 seconds. Forward it unchanged; do not give each child a new TTL. Each exchange also has one absolute deadline at most two seconds from its start, reduced by the remaining invocation deadline. Deadlines require the same host monotonic clock domain. The codec checks before and after pipe operations, decoding, synchronous callbacks, EOF, and final closure. It cannot preempt synchronous callbacks or filesystem/native syscalls, bound callback allocation, or prove their total wall time. A late callback result holds even if reservation already consumed a slot.

The caller supplies trusted synchronous reserve and retention code. The codec neither reads record counters nor chooses a helper/import path. Same-UID cooperation and retained owner context are trust assumptions, not authenticated ancestry. Future adapters must close every duplicate pipe end at handoff, exclude transport descriptors from unrelated helpers, and close them before model children. Disposable tests prove the fixture's closure only. Full adapter inheritance, process lifetime, request/token caps, actual capacity, and native acceptance remain open.
