# Routing observation source integration review

This local source line descends from product baseline `89ffc27` and includes
RO-00 lifecycle work through `ffc4444`, the reviewed contract/copies/adapter,
strict Manifest admission, temporary installed receipt proof and pinned COPY
expectations. Integration remains local; no main merge or runtime rollout is
recorded here.

| Slice | Source checkpoint | Evidence and scope |
| --- | --- | --- |
| RO-00 lifecycle | `c341190`, `0a4f771`, `52a60ea`, `e4cc303` | Complete current installer suite passes in disposable roots; source hashes, modes, failure recovery and rollback remain enforced. |
| RO-01 contract | `df678b2` | Closed, deterministic, bounded receipt; observed/unavailable/ambiguous attribution and independent tool states. |
| RO-02 generated copies | `de0b629` | Router and bridge copies pass byte parity with the canonical contract. |
| RO-03 adapter | `201ea72` | Pure typed evidence adapter; independent review passed. No producer collection or routing mutation. |
| RO-04 Manifest | `c854e21` (equivalent reviewed source `61231de`) | Independent review passed after normalization, tail durability and current registry admission fixes. Opt-in policy remains absent from default runtime construction. |
| RO-05 installed receipt | `a40ee6e` | Real COPY plus bounded installed graph, strict receipt persistence/replay, uncertainty, corruption controls and restoration. |
| RO-06 layout and source ownership | `b386ea0`, `bf263d6` | Explicit runtime root and pinned source expectations; same twenty semantic records and authority fields. Independent reviews passed. |

The combined receipt tests passed 88 cases / 1,241 assertions. The updated
installer suite separately passed 241 cases / 10,474 assertions. Repeated tests
are not additive coverage counts. Exact command/scope evidence is in the nearby
RO-05 and RO-06 summaries. The source-only review gate is distinct from release,
installed-host acceptance and the user's required review-pr, prepare-pr and
pinned merge-pr gates.

## Remaining integration boundaries

1. Complete-package guarded CLI loading passed with frozen dependencies and
   temporary state. It does not exercise server listeners, watcher imports,
   PostgreSQL connectivity or all dynamic capability paths.
2. Actual host promotion must reconcile current dirty files and owning writers,
   prepare recoverable backups, and verify read-back/rollback against the exact
   installation manifest. Concurrent host work must remain preserved.
3. A provider/Superset Hands canary needs the existing project's current structured
   option/approval/claimed handoff and fresh quota check. A configured combo,
   synthetic receipt, source test or healthy gateway is not a provider attempt.
4. Organ Console and Constellation consumption still need their own acceptance
   evidence for stale/synthetic/unavailable/conflict display. The bridge projects
   state; it does not grant execution authority or perform those UI changes.
5. General Python retirement and the held release/milestone/cleanup work are
   separate slices. This change does not claim ecosystem-wide migration or lift
   v6.4, cold-boot UAT, Phase 31, merge or deletion gates.

For portfolio mapping, the separate Cambium intake lane retains the founder's
Cambium Website and Codigo/Decodik identities. Three existing repository identities
were reconciled using prepared mapping receipts. The founder subsequently approved
Session Atlas and Meristem as distinct modular Cambium organs, Somatic Canticles
under Tryambakam Noesis, and Synchronocities as a retained partner blog. Their
separate source lane committed the mapping as `e93fade`, then published and read
back exactly four local root headers after verified backup/restoration and the
75/38 directory census. Existing Labs Hands admission still passed its read-only
check. Session Atlas and Synchronocities remain reviewed mapping nodes pending
canonical catalog promotion; existing execution pins and prepared receipts were
preserved. Local header publication does not issue execution approvals.
