---
status: complete
workflow: gsd-quick
scope: source-only
base: 0a4f7713d3aeb5a833bc544e60fa179f6fffddf1
---

# G2 temporary-root non-COPY lifecycle — summary

## Delivered

- Added the strict TypeScript `managed-template-v1` producer. It reads the
  reviewed repository template through an injected repository root, replaces
  exactly one `temperance-engine` managed block, preserves all outside bytes,
  preserves an existing regular-file mode, and rejects malformed, duplicate,
  unbalanced, nested, symbolic, or hard-linked ownership evidence.
- Bound mixed COPY and TRANSFORM installs to one `surface-manifest.v1` before
  their first destination mutation. The manifest records each prepared output,
  source identity where applicable, exact output/preimage digests and modes,
  and is SHA-256-bound in the journal `BEGIN` entry.
- Hardened rollback to restore only manifest-owned leaves. Any unbound journal
  stage, commit, or compensation entry now fails before changing a destination;
  a manifest transaction never falls through to legacy journal-path recovery.
- Kept `manifest-zone-v1` explicit: it reports `GENERATOR_UNAVAILABLE`, writes
  no synthetic output, and fails before any transaction or destination mutation
  when explicitly selected.
- Made the install doctor consume the same current-lock transaction proof. It
  combines record-level receipt outcomes with exact expanded journal leaf IDs,
  verifies output and preimage artifacts, source, managed block, and mode, and
  distinguishes unavailable/untrusted proof from safe content or mode drift.
- Made the production atomic writer set the requested mode on its open file
  descriptor before data is durable, so restrictive caller umasks cannot alter
  staged, restored, journal, or receipt modes.
- Added a full checked-in public-inventory replay in disposable roots for
  Darwin and Linux. It proves normal replay, explicit generator refusal,
  current-lock doctor observation, corruption refusal before compensation,
  failed promotion, failed recovery, retry, exact rollback, and sentinel
  preservation.

## Verification

- `bun test package/install-surface/test` — **241 pass, 0 fail, 9,998
  assertions** across 17 files.
- `bun build package/install-surface/src/cli.ts --target bun --outfile
  /tmp/temperance-install-surface-g2-cli.js` — passed.
- `bun build package/install-surface/src/doctor/orchestrator.ts --target bun
  --outfile /tmp/temperance-install-surface-g2-doctor.js` — passed.
- `bun --no-env-file package/install-surface/src/cli.ts write-lock` produced
  the reviewed current digest
  `sha256:955ca4022e2b1b03a911dd0b40f64000e5f3e69d4927692894a48944b6a0789a`.
- The production CLI was exercised by a disposable-root tree COPY test under
  umask `077`; installed `0644`/`0755`, restored `0640`, and receipt `0600`
  modes all read back exactly.
- Two independent Astra reviews found and drove corrections to receipt/leaf
  binding, rollback scope, mode setting, marker syntax, and doctor proof
  classification. The final re-audit reported PASS with no material findings.
- `git diff --check` passed.

## Held boundary

This is source and disposable-root evidence only. It did not install to the
connected Mac, restart launchd, alter OmniRoute or any combo, invoke a
provider, touch SQLite, execute Superset/Hands, publish Manifest/Organ Console
state, push, merge, or deploy. A reviewed host-installation gate remains
required before any installed-runtime or ecosystem-flow claim.
