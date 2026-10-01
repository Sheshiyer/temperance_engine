# Modular Mac physical acceptance packet

Status: prepared procedure, physical acceptance pending. Neither destination
has been supplied or observed. Every ISC-925–940 remains open. This document
is a blank owner run sheet, not an installation command or evidence receipt.

Authority: [Task 8 plan](superpowers/plans/2026-10-01-modular-mac.md),
[design](superpowers/specs/2026-10-01-modular-mac-design.md), and
[ISA](../ISA.md). Use the exact reviewed release and its verified interface
when Tasks 1–7 are accepted. Do not turn illustrative or proposed command
names from design documents into a runnable rollout procedure.

The replacement workstation and additional always-on node have equal
acceptance requirements. Cambium, Temperance and the connected organs remain
one ecosystem with distinct owner authorities. Neither profile depends on
Snow Gloves. This packet does not inspect, remove, enroll or configure it.

## Release and owner preflight

Complete a separate row set for each destination in restricted owner evidence.
Portable copies of this packet contain field names and evidence references
only. Keep credentials, unlock/recovery keys, serial numbers, usernames,
private paths, endpoint secrets and private binding preimages out of it.

| Required input | Workstation evidence reference | Always-on-node evidence reference |
|---|---|---|
| Reviewed target pseudonym, model, chip and exact macOS build | | |
| Reviewed local access and recovery access | | |
| Independent backup identity and restore destination | | |
| Exact owned restore artifact and trusted digest stored outside the restore target | | |
| Chosen release commit, archive digest and independent verifier evidence | | |
| Selected profile, modules, runtime/backend and resource limits | | |
| Restricted binding reference, configuration generation and destination observation | | |
| Exact final plan digest, later final review, freshness and permitted effects | | |
| Owner, review time and separate effect authorization reference | | |

For the workstation, also select the native client and exact callback to prove.
For the node, supply its real endpoint, bounded role and scope; no example
endpoint or borrowed old-host identity is a substitute. A declared endpoint
or issued identity does not establish current runtime or admission evidence.

Do not proceed if the selected architecture, release, native assets, private
owner adapter, destination scope or independent backup is held. Public
9router declarations and a personal OmniRoute plant are distinct: neither
preselection nor a port conflict permits replacement. Any unsupported overlay
remains held until its own owner adapter is verified.

Review permitted local effects against the actual final proposal after its
digest exists. Immediately before effects, the verified lifecycle boundary
must check fresh destination identity/observations, exact prepared intent,
configuration generation, preimages and exclusive ownership. A plan hash,
source acceptance, JSON shape or selection action grants no execution authority.

## Evidence recording

Use independent labels for source, released, installed, configured,
authenticated, admitted, runtime, verified artifact and physical observation.
An exit code or journal marker does not collapse these into profile readiness.
Each physical observation needs its target, release/plan binding, observed
facts, time, verifier/owner and restricted evidence reference. Do not copy raw
responses or secret-bearing output into this document.

For each step below, record `pending`, `held`, `observed-pass` or
`observed-fail` in the restricted owner run sheet. Empty fields mean pending.
A hold or failure stops dependent steps; it does not authorize a repair,
credential change, remote operation or a retry with a different release.

## Workstation run sheet

| Step | Owner observation and required evidence | ISC |
|---|---|---|
| W1 — target and access | Confirm the selected physical target/model/chip/macOS build and reviewed access against preflight. | 925 |
| W2 — independent backup | Read the selected restore artifact from the independent backup, verify its trusted digest held outside the restore target, and record the actual restore destination. | 927 |
| W3 — trusted bootstrap | Observe the verified release entry on that target; independently verify installed bytes and architecture. Record source/release/installed states separately. | 929 |
| W4 — fresh sign-in | Owner completes only the selected fresh sign-ins through the verified client/provider flow. Record safe status and owner evidence; never record tokens. | 931 |
| W5 — bounded headless work | Attach only reviewed projects, execute one admitted bounded work unit, and independently verify the exact artifact against its task criteria. Bind task, artifact and verifier to this target. | 933 |
| W6 — native callback | Exercise the selected real native-client callback and independently verify the intended effect and artifact. A terminal message or placeholder webhook is insufficient. | 934 |
| W7 — recovery rehearsals | Rehearse boot/login, selected secure FileVault/keychain access, resource caps and applicable power/network interruption and recovery. Observe only the boot/service mode actually selected and verified by the release. | 937 |
| W8 — independent restore | Restore the selected exact owned artifact to the reviewed destination from the independent backup; a fresh verifier reads restored bytes and matches the external trusted digest. Keep configuration rollback evidence separate. | 939 |
| W9 — owned configuration rollback | Separately review and authorize rollback of the exact owned configuration generation. Verify the bound preimage and current state before effects, perform only the verified owned rollback, then independently read back restored bytes/mode and preserved unowned files. Hold incompatible release/binding or uncertain effects. | Task 8 plan |
| W10 — owner receipt and learning proposal | Owner signs the target-bound outcome. Produce only the bounded Cortex/Nutrix learning proposal required by the plan; proposal and promotion remain separate owner states. | Task 8 plan |

A secure unlock rehearsal does not require exposing or recording a recovery
key. A service restart is held if the selected release has no verified boot
service; do not assume every profile installs a LaunchAgent or LaunchDaemon.
Cancellation preserves already completed external sign-ins. Restore from
backup and rollback of owned configuration are separate operations with
separate review, preimage and exact-byte/mode readback evidence.

## Always-on-node run sheet

| Step | Owner observation and required evidence | ISC |
|---|---|---|
| N1 — target and access | Confirm selected physical target/model/chip/macOS build, endpoint scope and local/remote recovery access against preflight. | 926 |
| N2 — independent backup | Independently read and verify the selected restore artifact/digest and actual restore destination. | 928 |
| N3 — scoped identity | After review and separate effect authorization, use the verified owner issuance flow for a fresh Temperance identity. Read it back against the exact reviewed fingerprint and scope; planning does not issue it. | 930 |
| N4 — bounded job | Run one explicitly admitted bounded job within the reviewed resources; an independent verifier binds its exact artifact and verdict to this target/task. | 932 |
| N5 — stop and late result | Exercise the reviewed stop flow and observe that a late result cannot commit the stopped job. Unknown remote outcomes remain owner holds. | 935 |
| N6 — writer ownership | Use a read-only owner-bound observation to prove zero duplicate writers for the selected scheduler/resource scope. Concurrent mutation rejection belongs in an isolated disposable test, not a second real apply. | 936 |
| N7 — recovery rehearsals | Rehearse cold boot/login, selected secure FileVault/keychain access, power/network loss, resource limits and real remote recovery through the reviewed access path. Verify only selected proven boot/service behavior. | 938 |
| N8 — independent restore | Restore the selected owned artifact from the independent backup to the reviewed destination; independently reread bytes and match its externally held digest. Record exact owned-configuration rollback separately. | 940 |
| N9 — owned configuration rollback | Separately review and authorize rollback of the exact owned configuration generation. Verify bound preimages, release/binding compatibility and current state, perform only the verified owned rollback, then independently read back restored bytes/mode and preserved unowned files. Hold unknown effects or unobservable ownership. | Task 8 plan |
| N10 — owner receipt | Owner signs the node-specific observed outcome and unresolved holds, bound to its release, final plan, scoped identity and job. | Task 8 plan |

No automatic identity cloning, stale-claim takeover, lease transfer, cadence
arming or remote replay is part of this packet. An unobservable owner remains
a hold. The node learning proposal is not an additional physical gate in the
admitted plan. Existing D1 operational writer, Plexus human ceiling and
artifact-verifier boundaries remain intact.

## Blank restricted owner records

These are field lists for two separate records stored under owner-controlled
access. They are not generated receipts and contain no fabricated timestamp,
digest, endpoint, identity or pass value. Record a private binding digest only
in storage explicitly approved for that restricted evidence.

| Field | Workstation record | Node record |
|---|---|---|
| Target pseudonym; model/chip/macOS build | | |
| Access and recovery access evidence | | |
| Release commit/archive digest; independent archive verifier | | |
| Profile/modules/runtime/backend; resource limits | | |
| Final plan digest; final review time/expiry; effect authorization | | |
| Restricted destination/binding/configuration evidence reference | | |
| Independent backup identity; selected restore artifact; trusted digest reference | | |
| Actual restore destination and independent readback evidence | | |
| Fresh sign-in/native callback evidence (workstation) | | Not applicable |
| Fresh scoped identity/readback evidence (node) | Not applicable | |
| Bounded task/job and artifact/verifier/criteria evidence | | |
| Stop/late-result and zero-duplicate-writer evidence (node) | Not applicable | |
| Power/network/resource/boot/FileVault/keychain/recovery evidence | | |
| Exact owned-configuration rollback/preimage/readback evidence | | |
| Per-step results; unresolved holds; follow-up owner | | |
| Bounded Cortex/Nutrix proposal reference (workstation) | | Not applicable |
| Owner, observation time, verification/sign-off reference | | |

Only actual fresh observations can close ISC-925–940 in the owning ISA. A
completed source document, synthetic fault test, portable archive or physical
receipt template does not close them. Both profile receipts are required;
one successful destination does not stand in for the other.

## Separate owner decisions

Old-host retirement, deletion, router replacement, production Cambium/D1 or
topic-map changes, cloud/provider activation, paid operations, shared-node
scheduling and Hermes remote handoff require their own reviewed scope and
owner authority. Snow Gloves enrollment/secrets/lifecycle stays on its
independent roadmap. Physical acceptance here does not authorize those effects.
