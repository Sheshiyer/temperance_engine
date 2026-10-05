# Manual RSS pressure point diagnostic

This helper is a manual one-shot metadata diagnostic. It has no hook, organ,
prompt, timer, service, installer or automatic retry registration. Importing it
performs no diagnostic. Default CLI invocation holds without querying metadata;
only an explicitly authorized `python3 -I -B .../rss-pressure-diagnostic.py
--manual-once` call may query. Actual census has not been accepted by the source
fixtures and must be separately authorized.

The helper derives current UID, shares one start+2s monotonic deadline across
bounded dependency loading, pressure-before, inventory, aggregation and
pressure-after. Darwin inventory uses fixed 4097 PID slots/max4096 rows,
TASKALL232/BSD136 and RSS metadata. A saturated/unknown/drifted query holds;
only existing exact ESRCH/zombie semantics may skip disappearance. Pressure is
an exact four-byte sysctl observation. No Backend.usage/proc_pid_rusage sampling,
all-UID physical census, process name/argv/cmdline/environment, account/provider
lookup, child, signal, kill/restart or configuration operation is implemented.
Native ABI name buffers are opaque and never extracted/projected.

Two fixed relative source dependencies are bounded to64KiB each with nonblocking
nofollow regular descriptors, exact reads/growth probe, metadata/path identity
and close checks, then matched to reviewed SHA256 pins. Detached bytes alone are
compiled. The inventory's exact fixed importlib sibling spec resolves to the
same preloaded native module through a local import shim; no global import
patch, second SourceFileLoader read, rewritten source or temporary source tree.
Existing inventory/observer bytes remain unchanged. This executes trusted pinned
code, not a Python sandbox or hostile same-UID isolation. Synchronous callbacks,
filesystem and ctypes calls cannot be preempted; late completion holds.

Private PID/UID/birth rows are transient, bounded and never printed or persisted.
The finite closed result contains only pinned source hashes, pressure statuses,
row/state counts and RSS sum/max as canonical decimal strings to avoid lossy
JSON numeric conversion. Failure discards totals and returns null aggregates
plus a fixed reason; no raw exception or partial-zero claim. All execution,
capacity, cleanup, causation, sustained and worker acceptance flags are false.
No source filename override, UID argument or arbitrary endpoint is exposed.
Trusted in-process fixture callbacks are not a hostile request interface.

RSS sums can double-count shared pages and exclude compressed/kernel/swap and
other-UID memory. A process may change between samples; this is not an atomic
census or historical lifetime. Low RSS cannot rebut elevated pressure; large RSS
alone does not identify its cause or authorize process action. Seven disabled
job point observations stay separate. No actual worker/native organ/canary or
operational criterion closes from source fixtures or a future diagnostic point.
