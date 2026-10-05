---
status: in-progress
scope: standalone-source-only
---
# Durable bounded CLI launch reservations

Implement only reusable Python helper and focused standard-library tests. Create owner is actual parent PID/current UID, independently verified native birth; nested reserve verifies retained original live creator rather than helper parent; no owner/auth environment or CLI override. Trusted in-process injected observers/faults are tests only. Existing private directory, exclusive nonce record, <=4096-byte closed JSON, embedded inode/device identity, nonblocking flock, monotonic TTL<=120s, launch limit1..4. Reservation requires retained expected counter, increments durably before acknowledgment, and holds on counter mismatch (uncertain ack). No refund/recreate/reset API.

Test malformed/duplicate/torn/oversized data, identity reuse, expiry, lock/contention, inode replacement, symlinks, fsync failure and lost acknowledgment. Source only: no adapter, inference, grants, capacity or installed adoption. Separate create represents a distinct invocation; future caller must retain one handle and never recreate after uncertain acknowledgment. Same-UID cooperative filesystem boundary and synchronous syscall nonpreemption explicit. One retained owner serializes/acknowledges counter forwarding; no automatic nested adapter join or ancestry authentication is claimed. No ISA/STATE/source outside owned files; publication awaits review.
