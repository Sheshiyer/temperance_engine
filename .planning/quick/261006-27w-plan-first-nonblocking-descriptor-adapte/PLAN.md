# 27w — first nonblocking descriptor adapter, PLAN ONLY

Root review before implementation. Proposed narrowunit owns new public captureFDadapter helper/test/contract/GSD only. Existingblockingcollector and purecapturestep/stoppedprotocol/codec untouched. Implement OSboundary source with injected syscall mocks ONLY initially; no actualFD/pipe/child/native/provider tests or rootinstallation. No stdout/stderr/final captureworker enabled by this plan.

## Scope and authority

Adapter supplies identity(name), zero-wait read(name,maximum), terminal(), close_keeper(), abort_keeper(), close(name) to published CaptureStep. Caller explicitly transfers three reader descriptors plus finalFIFOkeeper descriptor and trusted originalabsolute deadline; no CLI/envFDselector, executable or allocationgrant. Terminal/final-writeACK remains trusted separateowner callback, not inferred from exit0/EOF. FD3/4 actuallaunchcodec and FD5/6 bootstrap channels are not these streamroles; no implicitaliasing or capabilities forwarded. ActualoriginalownerACK/nativechild/bootstrap/resource/signal/reap joins remainfuture.

## Immutable descriptor intake and flags

Readrolesstdout/stderr/final must be three distinctnonnegative exactintFDs; keeper a distinctFD boundtosame finalFIFO inode. Discover each validtransferredFD identity independently before anyadmission failure, so invalidfirst cannotleak validpeers. Capture first fstat device/inode/type and readable/writableaccessmode; never overwrite/recoverfromlaterreplacement. Validate pipes/FIFOs only, readerO_RDONLY andkeeperO_WRONLY (anybroaderaccess requiresseparatereview). Finalkeeperidentity mustmatchfinalreader device/inode/FIFOtype; stdout/stderr readeridentities distinctfromfinal andeachother. Descriptoridentity is sameUIDcooperative ownership, not a securitytoken or exclusiveFDtable proof.

Before every fcntl flag change/read/close revalidate originalidentity. Set O_NONBLOCK and FD_CLOEXEC onlyafterretainedmatching identity and accessmodechecks. Recheckafterflagchanges; unknown/replaced FD holds and mustnotbeclosed/mutatedasnewtoken. Neverblock onreadiness/select/sleep; os.read request<=16KiB andownerremaining+1, EAGAIN/EWOULDBLOCK→None, b''→EOF. Native readexception finitehold, no rawbytes/errors inreceipts. CaptureStep checksretention/frame/aggregatecaps beforeappend; this adapter cannotallocatearbitrarycaller maximum or skipouterbounds. Originalsigned64deadline<=120sinitialremaining before/aftereachordinarysyscall, notnewTTL. Synchronoussyscalls stillnotpreemptible.

## Keeper and cleanup lifecycle

Keeper closesonce onlyaftertrustedterminal through close_keeper, validatingfirstkeeperidentity; abort_keeper is distinctheldteardown action, neverfinalACK. PrewriterFIFOEOF cannotcomplete becausekeeperremainsopen; purestep alreadytreatstransientEOFpending. AllknownoriginalFDs attemptedindependentlyonconstructor/heldfailure, exactFDsclosedatmostonce, replacement/unknownnotclosed. Cleanup identity checks remainavailable afteradmissiondeadline expiry toavoidleaks, but boundedbest-effort/unknownresults stayheld; noexecutionrenewal. Closefailure cannotpreventcleanupofotherownedFDs. Firstreasonpreserved andprivatebuffers discardedbycapturestep independentlyonceFDcleanup. Actualdescriptorclosing errors/FDreuseafterchecks retaincooperativeTOCTOUlimit; nohostile sameUID exclusionclaim.

## Source/mock acceptance

Mocks: exactreadflags/accessmode/FIFOtype, wrongkeeperinode, invalidfirstvalidpeer, duplicateFD, firstidentityreplacementduringdiscovery/flagchange/read/close,0allocationafteroversizedrequestedread, EAGAINnonblockingNone/EOF, nativeexceptionredacted, deadlinebeforeflags/latecall, terminalnotinferred, keeperonlytrustedterminal vsheldabort, closefailurecontinuespeers/no doubleclose and replacementpreserved. TestthroughactualCaptureStepinprocesswithmocksyscalladapter for fragmentedframes/remaining+1/caps/poll/drain/postcloseheldpayloadclear, notmockedwholecapturepromise. NoactualFDtests until separateapproval; noactualchild eventhenwithoutimplementedpressure/resource/ownerproof.

Status/releaseFD5/6 write/readadapter separatelaterunit mustfreezeverified69byteatomicbound/partialEAGAINheld, statuswriterclose/nativeSSTOP andfreshpressurebirthbeforeSIGCONT. This readadapteralone grantsno execution, capacity, containment, cleanupverification or Buildacceptance.

Finalfreeze: exactlyatmost4uniquetransferredFDs; once-onlyteardown atmostoneidentityquery+onecloseattemptperFD, markattemptbeforeclose andneverretryevenexpired. RetainfirstF_GETFL/F_GETFD/accessmode; revalidatemodebeforemutation. Check-set-rechecknotatomicCLOEXEC/FDtableexclusion.
