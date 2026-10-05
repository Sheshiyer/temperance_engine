# Git project identity evidence

`git-project inspect` reads bounded private JSON stdin `{capsule,binding,worktree_root?,mode?}`. `mode` is read or write and defaults to read. It uses the local Git probe internally; packets cannot supply probes, clocks, volume proofs or authority. Exit zero includes valid held evidence; malformed input returns a fixed error and nonzero exit. No remote operation or Git mutation is performed.

Approved portable capsules and private host bindings determine primary paths and access. Linked worktrees require exact fresh Git inventory membership, matching common directory, HEAD/branch and inventory generation. External linked paths are supported. Local probing rereads identity to reject drift and excludes ambient Git redirection and global/system Git config. Output contains finite reasons, symbolic identity and fingerprints, never private paths or credentials.

The injected library seam accepts trusted bounded volume observations. The public CLI deliberately has no volume observer yet: required declared volume bindings remain held. No-origin repositories remain held pending a portable approved local identity contract. Undeclared volumes are not discovered.

A verified result is source identity evidence. It grants no execution or lease authority, does not certify a clean working tree or authenticate external observations. Source/ISA/task fingerprints, capacity reservations and owner grant/atomic claim checks are required separately before Hands execution. Existing Superset admission is unchanged.

## Versioned Git authority context

`src/execution/git-authority-contracts.ts` defines additive Git-only v2 ticket, grant and admission context shapes. Legacy Superset records are not cast or populated with invented identities. Pure eligibility checks bind reviewed workspace/source fingerprints, exact ticket and reviewed grant fingerprints, phases/lanes, effort, timing and budgets. PlanMax requires Plan at E4/E5 and matches the public phase map.

Every result remains context-only, with execution, capacity and lease flags false and `claim_status:held-authority-migration`. Reviewed fingerprints establish consistency, not authentication. Re-evaluating serialized records does not prove fresh Git state or consumed-grant replay exclusion. The owning grant, capacity reservation, atomic claim ledger and versioned storage migration remain required before execution.

## Private Hands context

The Git Hands envelope binds separately verified primary and selected worktree evidence to fresh private workspace, source, ISA, tasks and lease context. Both inventories use deterministic codepoint ordering, including mixed-case paths. The envelope contains private paths and is rejected by public projection inputs. Its fingerprints prove context consistency only; all execution, capacity and lease authority remains false. An authenticated grant and the owning atomic claim ledger must still authorize execution.
