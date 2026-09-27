---
status: complete
base: 09cbff5
workflow: gsd-quick
---
# RO-00 mode-preserving committed-source COPY inventory

Scope: bind every public COPY source leaf to a reviewed Git-tree digest and
regular-file mode, then prove the isolated CLI lifecycle in temporary roots.
The coordinator authorized implementation and bounded temporary-root tests.

1. Add failing tests for source-root CLI resolution, case-insensitive inventory
   collisions, executable mode preservation, source-mode mismatch, and
   compiled-declaration receipt linkage.
2. Extend the COPY contract through types, schemas, semantic validation,
   lifecycle preparation, stage/promotion verification, journal snapshots, and
   rollback so contents and modes are restored together. Legacy records remain
   readable but install/update fail closed without a complete declaration.
3. Correct the two stale Codex hook source/destination names and add the
   directly imported hook dependencies as independently owned COPY records.
4. Add a deterministic TypeScript generator/checker that reads a supplied full
   Git commit tree, never the working tree, and materializes only reviewed COPY
   expectations plus separate provenance.
5. Regenerate the public lock and prove compilation, deterministic check,
   focused lifecycle tests, and a temporary-root CLI install/rollback from an
   unrelated working directory. Do not install into host paths, alter services,
   mutate live combo state, merge, push, or deploy.

G2 remains held until a separately reviewed temporary-root full-surface
installation proves source-hidden import/replay behavior, injected failure,
rollback, and unknown-sentinel preservation across all non-COPY interfaces.
