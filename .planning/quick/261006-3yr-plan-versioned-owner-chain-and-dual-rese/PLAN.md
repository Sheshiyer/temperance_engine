# 3yr versioned owner-chain + two original receipts — PLAN ONLY

## Scope and preserved boundaries

Next proposal is ONE pure/injected retention state helper/test/contract/GSD, noactualbudget/FD/native ABI/process/spawn/signal/model/capacity. Existingv1pre-reservedprofile/context/stoppedprotocol stay byteunchanged. Newversioned owner-chain distinguishes originalnativecaller creator from actualsupervisor/directparent and worker; neverrewrites originalcreator into supervisor or insertschildtoken in existingACK. ActualCLOEXEC/parentloss/resource enforcement remainheld.

## Exact bounded closed intake

Initial `temperance.owner-chain-input.v2` EXACT7keys schema,directory,creator,created_ns,invocation_deadline_ns,exchange_deadline_ns,create_receipt. Plainexactdictkeys exactstr≤64beforehash/equality. Directory existingcodec canonical1..4096UTF8bytes, no NUL/empty/dot/dotdot. Creator EXACT4keys pid,uid,birth,kernel_start_token: PID2..2^31-1,UID0..2^32-1,exactDarwinbirth≤48ASCIIgrammar,kernel_start_token1..2^63-1. Kernelstarttoken is an opaque bounded reported continuity integer; no nanosecond unit is claimed. Future native observer conversion/unit provenance must be explicit rather than relabeling raw abstime ticks as ns. Originalcreated_ns0..2^63-1; invocation-created1..120s/exchange-created1..2s and exchange≤invocation, reportednow originalcreated≤now<exchange noreset.

Existingbudgetcreate receipt EXACT9keys/schema temperance.cli-launch-budget.v1/operationcreate/statuscreated/counter0/launch_limit EXACT2/nonce32lowerhex+3flagsFalse. Reservedreceipts EXACTsame9keys/reserve/reserved/counter1then2, same nonce/limit2/3False. Maximumtop7, nested4/9keys, copiedimmutableboundedscalars; literalUTF8 escapedaggregate≤16KiBbeforecopy/serialization/hash, noarbitraryMapping/get/str callbacks. Futurecodec handles use expected0for supervisorACK1 and expected1for workerACK2; existingwirekeys unchanged but v1profileonlycounter0notreusedforworker2. No newbudgetcreation/nonce orlatest/diskcounterrecovery.

## Reservation state before either create

`retain_two(reserve, observe_original_creator)` snapshots originalcontext. Checkcreator exactfirsttoken immediatelybeforefirstreserve, mark supervisor reservationintent BEFOREcallback(expected0), validresponse1retainedimmutable, observecreatorafter. Checkfreshdeadline/creator thenmark workerreservationintent BEFOREcallback(expected1); exactresponse2retainedimmutable, observecreatorafter. BOTHoriginalresponses required beforeANYsupervisor/worker create callback. Late/missing/lost/malformedsecondresponse permanentlyholds bothcreates; firstslot remainsconsumed uncertainty andsecondmayconsumed. No refund/newnonce/diskreread orreservecallbackretry, includingduplicateAPI calls.

Publicreceipt says reportedreservationresponsesretained notactualnativeissuance, counter values boundeddiagnosticcounts only/allauthorityFalse. Constructorinputcreate receipt also trustedreported, notcreatorauthentication. Callbackexceptionfinitewhitelist/no__str__; callbacksideeffectintent recordedbeforeinvoke andoriginalclockcheckedbefore/after(nonpreemptible).

## Immutable owner-chain and attempted creation

Separateclosed injectedprocess observation EXACT7keys pid,uid,birth,kernel_start_token,parent_pid,parent_uid,parent_birth, same PIDUID/birth/kernelstart bounds. Supervisor firsttoken PIDdistinctoriginalcreator,UIDsame, parentPIDUIDbirth exactoriginalcreator; worker PIDdistinctcreator/supervisor,UIDsame,parentPIDUIDbirth exactretainedsupervisor. Tokens are immutable onceobserved, neveroverwrite onrepeat/drift. No processgroup-only identity orPIDalone acceptance.

`create_supervisor(create_callback, observe_original_creator)` onlyafterbothreceipts: reobserveoriginalcreator, markintent BEFOREcallback, callback returns exacttrusted reported firstsupervisorprocess token, validatesdirectparent chain; reobservecreator and retainsupervisor. Anylost/false/malformed/latecallback holds/no secondcreate. `create_worker(create_callback, observe_supervisor, observe_original_creator)` onlyafter retainedsupervisor; reobserveboth firsttokens BEFOREcallback, markintent BEFORE, validateworkerparent supervisor, reobserveoriginalcreator/supervisor after before retainingworker. Reportedtokens cannotgrant nativeownership, resourcepolicy oractualrole flags. Future actualadapter mustproduce independentnative observations, notselfecho/syntheticcreate return.

No workercreate if originalcaller lost orsupervisor drift; independentlysafe survivingmonitorcleanup maycontinue under originaldeadline separately, but noexecutionextension. Conditionalmonitoralive is notSIGKILL/hostdeath orphan guarantee. Supervisor OSlaunch andworkereachconsumeoneoriginalslot; memory/resourcepolicy separatelyaccounts supervisor128MiB proposedunmeasured andworker128/zero-desc unmeasured; noBuildcaps/organlimitchanges.

## Provenance and eventual transport

Purev2retainedchain holdsreportedoriginalcreator/supervisor/worker tokens andreservedreceipts1+2 underoneoriginalnonce/deadline; all native authentication/issuer/capacity/execution flagsFalse. A newtyped privateFD7contextv2 is later sourceunit, not silentlyextendingv1 codec. ExistingACKchildidentity absent => ownertype-nativeobservation beforeconfirm remainsseparate join. Transfer lostACK/currentcontext uncertainty no replay. Nativeharness occurrence/account capacity notinferred fromPID/protocolrole.

## Meaningful pure regressions

Tworeserves exactly0→1and1→2 before firstcreate; originalnonce/limit/deadline unchanged; secondlost/malformed/late noeithercreate/no retry; creator drift aroundeitherreserve; boolcounter/unknownkeys/hostilekey no callbacks; supercreate lostresponse/no duplicate; workerwrongparent orsupervisor birth/kernelstart drift no workerpermit; workerlostresponse/no retry; immutablefirsttokens/stickyheld afternewobservations; allnative/auth/capacityFalse. Exactbounds and aggregateUTF8fixtures, callback__str__trap, clockbackwards/expiry. NoactualFD/native/process fixtures untilseparateconcretedesignreview.


## Root pre-code creation cleanup-candidate freeze

Creation callbacks do NOTuse the ordinary call() helper that checks postcallbackdeadline before returning the value. After a createcallback returns, firstvalidate and retain the FIRST bounded reported supervisor/worker token immediately, BEFORE postcallbackclock/creator/supervisor revalidation. Distinct first_reported_supervisor_token_retained/first_reported_worker_token_retained flags from supervisor_creation_admitted/worker_creation_admitted. Latecallback/creator drift permanentlyholds and keeps validfirstreportedcandidate without overwriting; that candidate is notnativecleanupauthority. Missing/lostcallbackresponse remainsunknown; neverinventPID/birth or recoverlatest. Invalidboundedtoken returns no candidate andheld. Postcallbackadmission still requires originalfreshclock/ownerchain observations. All observations reportedopaquecontinuity token, not actualnativeABI/unit attestation.
