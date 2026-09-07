---
status: in-progress
base: 09cbff5
workflow: gsd-quick
---
# RO-00 native tree COPY

Scope: lifecycle modules and temp-root tests. The coordinator explicitly authorized implementation, an isolated worktree, and exact-file commits. GSD quick initialized successfully; parent STATE and roadmap stay coordinator-owned.

1. Write failing tests for deterministic tree copy, required declared hashes, contained text sources, manifest preimages, promotion corruption, partial failure rollback, and drift/sentinel preservation.
2. Expand trees into deterministic bounded per-file operations. Require explicit source root and complete declared per-leaf hashes for trees. Preserve legacy file COPY while verifying the captured source hash. Journal prior-absent/preimage/expected hashes before mutations.
3. Verify focused tests and existing lifecycle/package tests. Record exact evidence and limitations; commit only owned files.

No service calls, installation, runtime configuration, merge, or push. Empty source directories do not create installed directories. Rollback manages declared leaves only. Existing fragment schema has no digest property, so declared hashes enter through executor options without modifying the schema.
