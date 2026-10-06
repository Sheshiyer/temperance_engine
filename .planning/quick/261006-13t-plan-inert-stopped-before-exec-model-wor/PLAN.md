# 13t — phase-two inert stopped bootstrap proposal

Status: PLAN ONLY, pending root review. Phase-one pure contracts are published at 9646696. This proposal does not launch a process or enable Build. Separate 0xm planning and organ-channel ownership remain untouched.

## Ownership and interface

A later authorized unit would own a dedicated public `package/headless/lib/model-worker-bootstrap.py`, inert fixture, contract and its GSD packet only. It must not edit organ guards, launch codec, native CLI configuration or Noesis wire/seat/tasklist. The caller supplies retained original owner/ACK state, original monotonic deadline and a closed metadata-calibration policy. Build policy remains absent. The bootstrap never creates a fresh nonce, reloads a disk counter to resolve uncertainty, refunds a consumed slot, renews the deadline or treats codec readiness as execution authority.

Phase two should first define a trusted injected process adapter, then exercise a fixed inert fixture only. No arbitrary executable/argument/environment selection is exposed by a public CLI. Any later real native metadata calibration requires separate resource/pressure and launch-budget joins; even a version probe cannot calibrate paid-worker memory. Host pressure elevated or unavailable holds before child creation.

## Stopped-before-exec protocol

Create one exact child through the owned adapter, retain direct-child handle and obtain PID/UID/native birth while the child is stopped before executing its fixed inert payload. The child must explicitly acknowledge stopped/bootstrap state; observing a PID alone is insufficient. Preserve original creator identity and compare both creator and child birth again before release. Missing, contradictory or lost acknowledgement holds without retry. The phase-one observation DTO does not itself establish parent-child relationship or native identity; actual acquisition belongs to a separately reviewed adapter.

Forward only explicitly owned descriptors needed by the fixed fixture, with close-on-exec/default-close-fds preserved elsewhere. Close parent copies immediately after successful child creation; on spawn/close failure retain child cleanup ownership. Use finite framed bootstrap metadata with bounded aggregate buffers and a shared externally retained deadline. Exact descriptor roles must be frozen before implementation; this is separate from organ FD3/4 plumbing and must not accidentally inherit its capability. No raw output enters public receipts.

## Deadline and cleanup

Normal bootstrap, observation, release and cleanup share the original deadline; reserve normal cleanup time before release. Every signal requires fresh native birth equality against the retained first birth; unknown or reused descendants receive no signal. Cleanup is direct-child-only in this phase and cannot claim descendant containment. Adapter calls are synchronous and cannot provide an unconditional hard wall guarantee.

If the original deadline has expired or an observation fails, a once-captured separate best-effort emergency cleanup reserve may be proposed (at most 500 ms), never used for execution or admission. Its result remains held and cleanup-unverified unless exact independent termination evidence exists. An expired clock must not suppress safely proven termination of the retained unreaped direct child. Any stronger Popen fallback ownership argument must be reviewed explicitly; no generic PID/process-group kill is authorized.

## Acceptance fixtures and remaining joins

Use injected adapters for no-spawn pressure hold, stop acknowledgement loss/mismatch, creator/child replacement before release, deadline expiry during callbacks, closed descriptor roles, parent-copy EOF, close failures, cancellation, retained counter/nonce/deadline continuity and attempted-but-unverified emergency cleanup. A fixed self-expiring inert child fixture may be considered only after root authorizes phase-two implementation and its test process/resource bounds. No native CLI or provider request is an acceptance fixture.

Resource enforcement, physical/RSS native backend, finite birth inventory, model-worker output collector, final-write evidence, app-server protocol transport and actual launch-budget acknowledgement joins remain subsequent reviewed units. Proposed phase-one 128 MiB/10 s limits are unmeasured declarations, not implemented enforcement or capacity authorization. Phase-two implementation requires root review of this plan before edits.
