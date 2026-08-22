> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Repository Grammar Execution Plan

**Status:** Stage 1 pure grammar implementation is complete, Stage 2 has produced a read-only inventory probe, and Stage 3 has a six-file canary packet with the owner-supplied TeamForge slug, committed separately and bound into a clean held dry-run. The owner has closed ISC-760 and ISC-760.1–ISC-760.19 as policy. Exact manifest approval and live apply remain separate gates; no relocation, vault registry, session, Paseo, or filesystem move is authorized by this document.

**Authority:** [`ISA.md`](../../ISA.md) is the acceptance ledger. The existing [vault relocation implementation plan](2026-08-03-vault-project-relocation.md) remains the transaction authority. This addendum binds the ratified repository-name grammar to that plan.

## Ratified grammar contract

The implementation must enforce the following policy for a depth-one repository basename beneath exactly:

- `<PROJECT_VOLUME>/2026/Projects/thoughtseed/`
- `<PROJECT_VOLUME>/2026/Projects/tryambakam-noesis/`

The grammar is policy-only until the execution gates below pass:

1. Validate the raw basename before any normalization.
2. Admit only ASCII lowercase `a-z`, ASCII digits `0-9`, and ASCII hyphen-minus U+002D.
3. Exclude ASCII uppercase, underscore, dot, and every other unruled code point under the closed repertoire.
4. Permit the singleton basename `-`.
5. For names of length at least two, forbid a leading or trailing U+002D.
6. Permit interior U+002D runs, including `a--b`; the leading/trailing prohibitions still bind.
7. Compose permissions by intersection; no later permission repeals an earlier prohibition.
8. After raw validation, normalization is identity: the accepted ASCII basename is unchanged.
9. The durable identity key and operator-facing presentation both use that normalized name.
10. Reject a candidate when its normalized identity collides with an existing identity; do not suffix, overwrite, or silently disambiguate.
11. The owner policy trusts validity preservation without requiring a second post-normalization validation gate. A concrete writer may still fail closed on operational safety checks; it may not reinterpret this as permission to skip preflight.

The expected pure predicate is equivalent to:

```text
name == "-" OR name matches [a-z0-9](?:[a-z0-9-]*[a-z0-9])?
```

This expression is a test oracle, not permission to mutate a checkout or create a destination directory.

## Execution stages

### Stage 0 — Freeze and baseline

- Read the ISA and this addendum.
- Confirm `<PROJECT_VOLUME>/2026/Projects/` remains empty or record its exact approved baseline.
- Snapshot Git status, HEAD, canonical refs, worktree graph, submodules, LFS state, device/inode, and deterministic untracked/ignored inventories for only the two approved portfolio roots.
- Preserve existing dirty files, especially `_PROJECT-STATUS.md` and the existing relocation plans.
- Do not traverse provider homes, session stores, Paseo, dependency trees, caches, secrets, or remote Git state.

**Gate:** baseline is read-only, owner-visible, and reproducible.

### Stage 1 — Pure grammar implementation

Create the pure policy module and fixtures described in the existing relocation plan. Tests must cover:

- `-` accepted;
- `a`, `0`, `a0`, `a-b`, `a--b`, and `0--9` accepted;
- `-a`, `a-`, `--`, and `a---` rejected when the edge rule applies;
- uppercase, underscore, dot, whitespace, slash, NUL, non-ASCII dash variants, and unruled Unicode rejected;
- raw validation occurs before the identity normalization step;
- normalization is byte/codepoint identity for accepted ASCII names;
- identity and presentation projections equal the normalized name;
- collisions fail closed before any writer is reachable.

The module must be pure: no filesystem access, no Git calls, no registry writes, no provider/session access, and no network.

**Gate:** focused unit/property tests pass and the module has no mutation or external-state seam.

### Stage 2 — Read-only portfolio inventory

Run the existing inventory command only for `thoughtseed` and `tryambakam-noesis`:

```text
bun scripts/vault-project-relocation.ts inventory \
  --portfolio thoughtseed \
  --portfolio tryambakam-noesis \
  --output <owner-only-report.json>
```

The report must classify standalone repositories, nested repositories, linked worktrees, dirty states, symlinks, missing remotes, GitHub identity, destination collisions, and exact path consumers. Parentage is evidence, not portfolio authority.

Hold by default:

- `thoughtseed-labs` and every other nested knowledge-vault surface;
- linked or nested worktrees;
- ambiguous Snow Gloves/`10869` or mixed-lineage mappings;
- `hermes-aws-ts` and runtime/systemd/deployment/sync consumers;
- the dirty `_System/10865xseed` registry baseline;
- any repository with a collision, unresolved consumer, competing identity, or packet conflict.

**Gate:** the owner reviews the real report and approves mappings; no destination directory is created.

### Stage 3 — Packet and registry preflight

For one owner-selected canary only:

- prepare and validate the six-file packet as a separate reviewed repository change;
- verify Thoughtseed TeamForge identity or hold;
- verify the portfolio-specific knowledge registry and exact non-overlapping entry;
- validate the old-path consumer manifest;
- calculate the collision result from the normalized identity;
- prepare, but do not apply, the old-path capsule and registry-entry manifests.

The packet is a separately reviewed repository change. The relocation transaction
must not author or edit packet files inside the checkout. The owner-supplied
TeamForge slug is now recorded, but it does not itself approve the relocation
manifest or live apply.

**Gate:** packet, registry, consumer, and capsule manifests are all owner-visible and digest-bound.

### Stage 4 — Deterministic dry-run

Generate a byte-identical plan for exactly one canary:

```text
bun scripts/vault-project-relocation.ts plan \
  --repository <absolute-source-path> \
  --dry-run \
  --output <owner-only-manifest.json>
```

The manifest must bind:

- exact source and destination;
- portfolio, stable ID, GitHub identity, and knowledge authority;
- raw-name validation result, identity normalization, identity key, and presentation name;
- collision decision (`fail-closed`);
- source/Git/registry/packet/capsule digests;
- path-consumer result;
- same-device and destination-absence probes;
- exact rename, registry, capsule, pickup, verification, and rollback steps.

No `mkdir`, `rename`, `unlink`, registry write, capsule write, Git command that changes state, network operation, or client/session operation is allowed in dry-run.

**Gate:** the owner explicitly approves the exact manifest SHA-256 and canary.

### Stage 5 — One-canary apply (future, separately approved)

Only after the Stage 4 approval:

1. Acquire the exclusive transaction lock.
2. Re-read source parent, destination parent, source device/inode, source Git and packet digests, and registry baseline.
3. Abort on any drift, collision, competing registry claim, dirty-baseline violation, or path-consumer change.
4. Perform exactly one same-device atomic POSIX rename.
5. Re-read parent paths, device/inode, Git state, and packet digest.
6. Write only the approved registry entry, old-path capsule, and owner-only receipt.
7. Verify the pure resolver and one fresh approved client pickup.
8. For Thoughtseed, project only current operational facts into the main record and retain historical evidence in the registry entry.

No automatic staging, commit, push, session import, Paseo update, provider-store access, or packet edit is permitted.

### Stage 6 — Verification and rollback rehearsal

Verify exact pre/post invariants, then exercise rollback against a fixture and the canary receipt:

- source/destination identity and Git ref-set equality;
- explicit untracked/ignored-file digests;
- registry and capsule backlinks;
- fresh-client pickup without transcript/session import;
- no unexpected files or registry drift;
- rollback removes only receipt-matching generated paths and restores the original path;
- all unrelated vault, repository, provider, session, Paseo, and external state remains byte-identical.

**Gate:** the canonical verifier passes; a rollback receipt is retained; only then may a second canary be considered.

## Approval boundaries

The following are separate owner approvals, not implied by grammar ratification:

1. approval of the real read-only inventory and each portfolio mapping;
2. approval of one clean, low-coupling canary;
3. approval of the exact manifest SHA-256;
4. approval of the live apply transaction;
5. approval of any registry closure commit or later canary.

Until those approvals exist, execution stops at the dry-run boundary.

## Definition of done for this planning tranche

- the grammar contract is encoded as pure tests;
- the two-portfolio inventory is reproducible and read-only;
- one canary has a committed six-file packet, path-consumer report, and deterministic held dry-run digest; registry and capsule manifests remain future preflight artifacts;
- no move or rename has occurred;
- the user has an explicit manifest and canary approval surface.
