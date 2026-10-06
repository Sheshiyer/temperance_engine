---
status: complete
scope: reviewed-pure-source
---

# 4g5 reviewed pure source

Root approved the scoped pure implementation after initial PLAN f3d23b54. New private actor context helper, focused tests and contract implement exact15/16role schemas, separate trusted expected-context comparison, original clocks/dualretainedreceipt correlation and bounded single-frame parsing. Existingv1 sources untouched. Candidate retention remains in existingv2ownerchain; this codec provides no cleanup authority.

Focused source fixtures: `python3 -I -B -m unittest discover -s package/headless/test -p test_private_actor_context.py` passed15tests. Pure fixture scope only: no actualFD/budget/native/process/provider/SDK/library operations. Meaningful cases cover both roles/immutableexpected snapshots, wrongexpectedcontext, closedfields/counter/nonce/falseflags, supervisorrelation, originalexpiry/noreset,16384/16385wire ceiling,4096UTF8path/escapedserialization bound, recursiveescapedduplicate keys/malformedUTF8/numeric tokens,depth3/4/nodes192/193,partialextra/repeated/backwards/stickyclear,hostilekey/mapping callbacks,redactedallfalseprojection andcancellation.

Root and independent final review clear at helperbada8f9276d1a3a538a849a70de12c0a4394057d82fdcd6f3c5f9966dfbeaa95/test5fb03e8ec72fc21c48165e5f183958f8b57bb51e9663c6d29a5c402ee12be67b. Root independently reran15puretests0.007s; author15tests0.007s, AST2 anddiffcheckclear. No commit/push/installation or native acceptance. Native actor ownership/FD7, actual original reservations, authenticatedissuer/directparent observation/resourcepolicy/parentloss remain held.

Review corrections: root found prefix declaration was checked after combinedpayload append; intake now copies at most4prefix bytes first, validates declaration, then admits only declared remaining payload. Instrumentedbuffer fixtures prove no payload retained on combined/split oversizedprefix or extra data. Company found mutable retainedexpected state; constructor now freezes top/nested codec-owned snapshot, and private decode consumes only that validated immutable snapshot. Public decode still accepts exactplainDTO expected argument. Direct nestedmutation fixtures reject changed clock/creator/nonce. Updated15puretests passed0.007s; independent/root finalreview clear. Exactfivefile source publication authorized; no operational authority.
