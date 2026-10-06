# 48l read-only native spawn ABI + v2 actor ordering — PLAN ONLY

## Scope and current source evidence

This packet owns only this PLAN. No ctypes loading/calls, native attr/file-action initialization, process/FD/budget creation, spawn, signal, provider, config or installed changes. No new context implementation. Existing v1 bytes remain unchanged; published41g retains reported two-reservation responses/candidates only, not actual native issuance/owner-chain proof.

Literal local SDK inspection: spawn.h lines51–52 define BOTH posix_spawnattr_t and posix_spawn_file_actions_t as opaque void* typedefs; attr setflags takes short, actions adddup2/addclose and init/destroy are declared. sys/spawn.h declares START_SUSPENDED0x0080, SETSID0x0400, CLOEXEC_DEFAULT0x4000. SDK libSystem.tbd lists relevant symbols but is link-stub evidence, NOT proof currently loaded symbols or runtime ABI success. Python3.14.7 exposes os.posix_spawn with OPEN/CLOSE/DUP2 actions and setsid keyword; its documented signature has no arbitrary attr flags/START_SUSPENDED/CLOEXEC_DEFAULT arguments. No posix_spawn was called. Thus Python availability alone cannot establish required unknown-FD exclusion or stopped native launch support.

## Next bounded READ-ONLY audit unit proposal

Own one future audit helper/test/contract/packet only, no spawn implementation. First pure/mock audit validates exact finite SDK declaration/flag/prototype evidence and closed capability result. Source snapshots <=64KiB per selected header excerpt or bounded whole-file intake, finite total <=256KiB, exact paths/no-follow/regular metadata continuity. No broad SDK/library scan, arbitrary path/CLI/env selector or private content.

A separately reviewed loader-only metadata point could check exact currentprocess architecture/pointer/short sizes and required libSystem symbol availability, without invoking any native symbol. Bound original monotonic deadline<=2s before loading/attribute resolution; ordinary failures finite/unavailable, before/after checks nonpreemptible. Exactsymbol whitelist: posix_spawn, posix_spawnattr_init/destroy/setflags/getflags, posix_spawn_file_actions_init/destroy/adddup2/addclose. No guessing opaque structure sizes, no ctypes private attr layout, no dlsym call-through/init/setflags/spawn. Header+symbol evidence yields declared/available only; readiness/unknown-inheritance exclusion/native stopped behavior remain false until distinct ABI/native semantics tests are authorized. SDK version/build/runtime architecture mismatch holds. All execution/capacity/native_readiness flags false.

Meaningful mocks: Python lacks required flags despite spawn exposure; SDK typedef nonopaque/missing symbol/prototype mismatch; loader exception or late return; wrong-size scalar; SDK vs runtime mismatch; missing symbol; no native function invoked even reported symbols available; exact finite source/symbol whitelist/no duplicate or unknown inputs. Actual loader-only point requires separate root decision after source/static review.

## v2 private actor contexts — ordering proposal, NOT implementation

Original caller remains native creator of the SAME limit2 budget/nonce/original clock anchors. It must retain actual reserve response1 (supervisor slot) AND response2 (worker slot) before ANY OS create. Lost second response blocks both creates; no refund/new nonce/latest/disk-counter recovery. The existing codec HANDLE/ACK is closed and v1 remains unchanged: no child identity or extra fields appended to it, no counter2 silently passed to counter0-only v1 profile.

Future versioned private contexts need distinct explicit actor roles: original-owner-to-supervisor carries original creator, original receipts1+2 and first retained supervised-launch context; supervisor-to-worker carries original creator PLUS independently retained supervisor/directparent token and original receipt2. Each role must preserve original deadline/created/exchange anchors, and define whether the original exchange has already expired rather than resetting it at supervisor/worker creation. Native child token is retained by owner observation BEFORE confirmation and separately matched to bounded reported status; ACK is not child authentication or directparent proof.

Before either actor context codec is implemented, freeze exact closed schemas/key counts/scalar/UTF8 aggregate bounds and role enum, retained expectedcounter join, issuer/trusted-owner vs native observation provenance, producer/consumer authority, FD7 capability ownership and all-false projections. Pure41g candidates are cleanup candidates only; shape-valid wrong relation cannot authorize signal. Actual native birth/kernel-start unit provenance stays independent of reported opaque continuity token.

Future supervisor separately accounts its OS slot and proposed unmeasured128MiB policy; worker128MiB/zero-desc does not hide supervisor. Paid turn/inference admission is separate. Fresh normalpressure precreate/precontinue, native first birth/UID/directparent, finite inventory/pipes/capture and birth revalidation before every signal remain prerequisites. Conditional monitor-alive/catchable-failure cleanup is not SIGKILL/hostdeath/orphan guarantee. No suspended self-timer expiry claim.

## Holds and integration order

1. Review this plan and choose bounded read-only audit source unit; no native function call yet.
2. Source/mock audit and independent review; optional separately authorized loader-only point proves symbols, not spawn semantics.
3. Separate pure v2 actor-context schemas/codec plan (not this unit), with dual original receipts and explicit owner-chain roles; v1 unchanged.
4. Only after FD topology/CLOEXEC ABI, actual codec ownership, normal-pressure resource enforcement, native supervisor birth and parent-loss design are accepted can any fixed inert child test be proposed. Build/model remains held and no Build caps are invented.
