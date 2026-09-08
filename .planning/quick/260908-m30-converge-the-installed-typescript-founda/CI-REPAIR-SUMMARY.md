---
status: complete
workflow: gsd-quick
scope: source-only
base: c33042e71b6347b813a48c98b9c7eb83b2e27504
final_commit: e1404ab8c40bbd72b2c41b2f41dbaa8fcb4f879f
latest_pinned_router_source: d2c016b944337ba6d5da9e6800fe09009ea843df
---

# Product CI repair continuation — summary

## Delivered

- Repaired the private-path scanner's false-positive handling with a finite,
  auditable grammar for scanner literals and explicitly marked synthetic
  negative-test data. The regression still rejects a newly introduced actual
  private-looking path in each admitted source category.
- Replaced the public changelog's historical local volume path with a
  deidentified description.
- Reconciled the local product routing fixtures and policy harness with the
  canonical `noesis-*` portfolio names, while retaining separately intentional
  company-edge `te-*` lifecycle compatibility coverage.
- Kept native CLI readiness and routing-policy checks independent of ambient
  host configuration. The optional live OmniRoute inspection remains explicitly
  opt-in and is skipped in the default source gate.
- Corrected the Codex dispatcher mock to honor the real `-o` /
  `--output-last-message` contract, so a successful mock invocation has a
  substantive final-message artifact.
- Repaired the full sandbox installer fixture without weakening production
  behavior. It first proves that missing external GSD workflows fail closed
  before destination writes, then derives disposable workflow fixtures from
  the checked-in rail map for the isolated install, rollback, and re-install
  proof.

## Commits

- `98aaa31` — records the bounded CI continuation.
- `1120b9e` — hardens private-path verification and its regression proof.
- `26b95d2`, `d71036d` — aligns local portfolio source and refreshes its
  governed source pin.
- `895309d`, `87fa3c3`, `d2c016b`, `ba3a57d`, `82fcf1d` — makes native
  readiness, ledger metadata, and optional runtime inspection hermetic; the
  latest router-source expectation/lock pin is
  `d2c016b944337ba6d5da9e6800fe09009ea843df`.
- `92f469b`, `8165c8f`, `7464d65` — correct public doctor documentation,
  isolate canonical portfolio test fixtures, and honor the Codex mock output
  contract.
- `e1404ab` — seeds only map-derived external GSD workflows in the disposable
  sandbox and preserves the missing-workflow fail-closed proof.

## Verification

- `bash tests/verify-install-private-path-guard.sh` passed through the full
  verifier, including its accepted-literal and same-file real-path rejection
  cases.
- `sh tests/sandbox-install.sh` passed **35 checks**: missing external GSD
  workflow rejection before writes; source-derived fixture setup; full isolated
  install; re-install backups; dry-run; byte-exact rollback; collision guards;
  GSD mode gating; live-content guard; and pulse contract checks.
- `bash scripts/verify-all.sh` passed after the repair. It reran the
  install-surface suite (**242 tests, 11,235 assertions**), enrichment and
  router suites, classifier/policy/dispatcher regressions, sandbox installer,
  identity and wiring checks, and platform-script guards.
- The existing owner checks remain green: the routing-observation contract
  generator check, installed layout proof, and COPY/semantic inventory were
  not changed after their `d2c016b` source/lock pin.
- `git diff --check` passed before each continuation commit.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Test fixture drift] Seeded external GSD workflows inside the
   disposable installer root.**
   - The sandbox invoked `--with-gsd` with an empty external GSD root, while
     the reviewed installer correctly rejects absent mapped workflows before
     generating any wrapper.
   - The test now derives only required non-special workflow names from
     `package/router/gsd-rail-map.json` and explicitly proves the empty-root
     failure before fixture creation.
   - Production installer behavior and GSD ownership remain unchanged.

2. **[Rule 1 - Mock contract mismatch] Modeled Codex final-message output.**
   - The dispatcher test mock previously returned success without creating the
     output file requested by the real Codex interface.
   - The mock now writes a substantive final message when `-o` or
     `--output-last-message` is supplied, allowing the test to prove the real
     completion contract.

## Held Boundary

This is source and disposable-installation evidence. No host installation,
launchd/service change, listener change, live gateway probe, provider call,
credential access, database mutation, remote update, tag, merge, or deployment
occurred. The default verifier's live OmniRoute inspection was skipped because
`TEMPERANCE_ALLOW_LIVE_INSPECTION` was not enabled. This continuation therefore
does not certify any installed runtime or intentional LAN listener behavior.

## Self-Check: PASSED

- The continuation record exists at its quick-task path.
- Every listed continuation commit resolves in this branch.
- The final working tree was clean after `e1404ab` and the full verifier.
