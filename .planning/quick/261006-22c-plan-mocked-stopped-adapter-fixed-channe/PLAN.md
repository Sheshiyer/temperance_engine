# 22c — stageB mocked stopped adapter, PLAN ONLY

Root review before source implementation. Own a new pure/injected stopped-adapter helper, focusedfixtures, contract and laterGSD packet only. No Popen, pipe/nativeFD, syscall, actualchild, provider, config or rootadoption. Mockedfunctions can model bytes/identity/order only; labels do not become native proof. Existinglibraries unchanged; realbootstrap/resource/capture joins remainlater.

## Actual original-owner prerequisite

Designatedpayloadlaunch reservedonce by originalcreator beforebootstrap, actualfixedFD3/4 codec ACK+EOF retainedbyowner before confirmation+EOF. StageB must require explicit injected retainedowner receipt equality (nonce/counter/deadline/originalcreatorUIDbirth), but this is a trusted seam only; actualcodecjoin remainsmissing until laternativeadapter. No DTO selfecho treatedas authenticated ACK. No newnonce/refund/diskcounter/latest/retry on lostACK. Nativeimmediateparent mustoriginalcreator forcurrentcontract; separatelyspawnedsupervisor nestedparent remainsheld pending explicitparentcontract.

## FD5 status schema and native stop ordering

Declare FD5 childwriter→ownerreader. Fixed4byte unsignedbigendian length prefix, payload<=480UTF8bytes, exactlyoneframe thenEOF; boundedaggregate484bytes, no JSONparse beforelength/UTF8 checks, recursive duplicates/closedkeys/depth4/nodes32. Closed statusJSON keys: schema=`temperance.worker-stopped-status.v1`, nonce(original32lowerhex), counter(originalpostACK1..4), pid(actualretainedchildPID), stage=`before-payload-exec`. No childreportedbirth orstoppedflag counts as native proof. Writer writesboundedframe, closesFD5, thenstopsbeforepayloadexec. Owner readsframe+EOF underoriginaldeadline, then independentnative observation establishes exactPIDUIDbirth/parent andactualSSTOP. No dependenceonchildexit andnostoppedchildwriterleftopen. Mockedstopwait performs explicitnonblockingobservations, ≤50msnominalcadence, fixed256polls/originaldeadline-500msreserve; missing/false/reusedbirth holds.

## FD6 small atomic confirmation

Declare FD6 ownerwriter→childreader, separatefromlaunchFD3/4. Fixedbinaryframe69bytes: magic`TWR1`4, nonce16decodedbytes, counter1, originalabsoluteinvocationdeadline_ns8unsignedbigendian, retainedchildPID4, UID4, SHA256(canonicalretainedbirthUTF8)32. Fieldsderiveonlyfromretainedowner/nativechild. No arbitraryJSON/controlfields/FDselectors/env. Verify independentlyobservedPIPE_BUF exactint>=69 beforewrite. Nonblockingwrite once underoriginaldeadline; EAGAIN/partial/error holdswithsafecleanup, never retryreplay. Requireexact69bytewrite-return-count (notchildreceipt/readinessACK); fullwrite maybecomechildobservable afterSIGCONT, so lateruncertainty neverprovesnopayload orpermitsretry. Require, closeparentFD6writer, then freshnormalpressure/child+creatorbirth/UID/stoppedstate/resource/inventory immediatelybeforeSIGCONT. AfterSIGCONT child reads exact69bytes+EOF, comparesownretainedcontext, closesFD6 beforepayloadexec. This is a futureadapterprotocol; mockstage supplies no actualatomicity orSIGCONT.

## Retention, cleanup and test scope

RetainoriginalchildPIDUIDbirth atfirstindependentnativeobservation, neveroverwrite. ParentforwardedFDcopiescloseimmediatelyafterspawn inlaternativeadapter; failurecannotdropcleanupownership. Normalcleanupreserve500ms insideoriginaldeadline, separatelyonce≤500msemergencyheld/unverified; everylateractualsignal freshbirthmatches. Unknownidentity no signal/reapverified; exactunreapedhandle fallback separatelyreviewed. No processgroupauthority. Mockedstageflagsallfalse andcallbacksnonpreemptible; no Buildcaps.

Fixtures: missingactualownerACKseam, wrongnonce/counter/deadline/creator, fragmentedstatus/UTF8duplicate/unknownkeys/oversize/EOFextra/loststatus, independentstopfalse/reusedbirth/noexitdependency, parentclosefailure,69byteexactcontrol/smallatomicbound/partialwrite/EAGAIN no secondwrite, postwritepressureelevated orbirthdrift preventsSIGCONT, deadline/reserve/cancellation andlostACKslotconsumednoretry. No actualchild or nativepipefixture. Futureactualchildtest onlyfreshnormalpressure plusimplementedresource/owner/pipeguards; fixturefinalwriteACKstillseparaterole/schema notinthisunit.

Canonicalbirth freeze: exactASCII Darwin grammar darwin:([0-9]{1,20}):([0-9]{1,20}), sec>0/usec<1000000, boundedUTF8bytes beforeSHA256, noalternateformat/normalization. Originaldeadline signed64positive<=2^63-1 despiteuint64encoding; PID2..2^31-1/UID0..2^32-1 equalfirstretainedtoken.
