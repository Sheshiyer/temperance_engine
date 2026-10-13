# 1bl — native observation backend proposal

PLAN ONLY, root review required before implementation. Phase-one contracts and phase-two injected state machine do not supply native launch, accounting, host-pressure admission, pipe bounds or process cleanup. Actual Build remains held; no provider or CLI worker is a proposed test.

## Smallest unit and ownership

Own a new public `package/headless/lib/model-worker-native-observation.py`, focused mocked/native-current-process metadata test, contract and its own GSD packet. Do not modify organ guard, launch codec, bootstrap, capture, app-server protocol, Noesis adapters or shared native configuration. A subsequent separately reviewed integration joins this backend to injected observation contracts. Source inspection may reuse fixed ABI patterns from published organ guard; the dedicated model-worker policy stays distinct and its Build maxima stay unset.

## Fixed Darwin metadata contract

Use direct libproc calls without shell/ps output. Validate fixed BSD/task layout and exact returned byte counts before trusting fields; return only PID/UID/parentPID/state/birth and bounded RSS metadata. Birth uses kernel start sec/usec with retained exact identity and valid state mapping; process names, argv, environment and credentials are neither obtained nor projected. Compare original creator and target birth before and after each usage sample. Unknown, exited, replaced or unsupported state holds.

Use fixed `proc_pid_rusage(pid, RUSAGE_INFO_V0=0, raw-structure-address)` with signed native result exactly zero. Validate structure size96 and physical/start/exit offsets72/80/88. Keep retained kernel-start continuity, require nonzero start and zero exit, and enforce separate RSS/physical ceilings. Native query failure, wrong size/layout, bool masquerading as integer or identity drift holds. Linux physical accounting is explicitly unsupported; no fabricated zero and no unbounded ps fallback.

Host pressure is a separate exact-size sysctl observation: only level1 normal; levels2/4 elevated, unknown/error unavailable. Admission/release integration later must require fresh normal pressure before any real child. The backend may expose pressure metadata but cannot grant launch authority. Synchronous ctypes calls have before/after deadline checks, not preemption or unconditional hard wall guarantees.

## Initial verification boundary

Mock fixed native functions for byte-count, wrong ABI, query failure, state mapping, UID/parent/birth drift and kernel-start changes. A bounded current-process-only metadata check may validate the real fixed ABI and own PID identity after root authorizes implementation; it launches no native CLI or child and cannot calibrate paid-worker memory. Public receipts remain finite/redacted with execution, capacity, containment, cleanup and actual-role flags false.

Finite process inventory (fixed<=4096 capture before allocation, total lifetime policy and immutable birth retention), actual stopped-before-exec bootstrap, every-signal identity proof, retained launch ACK/counter channels, finite pipes and collector terminal/final evidence remain subsequent joins. No all-UID footprint sampling; initially observe only explicitly retained creator/target PIDs. Do not call a model worker an organ or alter organ160MiB/120s/24desc ceilings. Original execution deadline and500ms normal cleanup reserve remain unchanged; emergency best-effort cleanup is separately bounded and always held/unverified without exact termination proof. No native launch acceptance follows from this backend alone.
