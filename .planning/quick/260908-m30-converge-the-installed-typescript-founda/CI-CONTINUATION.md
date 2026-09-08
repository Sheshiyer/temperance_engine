# CI Continuation — private-path verifier

## Scope

PR 33 at `c33042e71b6347b813a48c98b9c7eb83b2e27504` failed its private-path
verification because the scanner treated its own documented regex grammar,
sanitizer regexes, and deliberately synthetic negative-test data as leaked
paths. This continuation is limited to the verifier and its regression tests,
the affected synthetic test data, the deidentified changelog baseline, and
this quick record.

## Required behavior

- Preserve rejection of private filesystem paths in tracked product content.
- Permit only finite, line-scoped scanner grammar and explicitly marked,
  synthetic test examples; neither permission may cover arbitrary paths in the
  same file.
- Keep the regression proof disposable and source-only: accepted synthetic
  examples pass, while newly added real-looking paths in the same sources fail.
- Remove the real historical local volume path from `CHANGELOG.md`.
- Run the narrow verifier first, then `scripts/verify-all.sh`; record actual
  outcomes without claiming CI, host installation, or runtime effects.

## Non-goals

No dependency, lockfile, installer, service, routing, remote, or host-runtime
changes are part of this continuation.

## GitHub clean-checkout continuation — 2026-09-08

At source head3033f28 the local full verifier passed, but GitHub run34234011609 failed because its clean checkout never installed the already-declared AJV dependency. Add a frozen, script-disabled install in package/install-surface before verification. Do not change dependency versions or lockfiles.

README continuity run34234011717 also correctly detected the changelog redaction without refreshed README assets. Rebuild through the existing generator with NotebookLM regeneration explicitly disabled; record the local source revision and historical asset reuse in the asset manifest and README. No NotebookLM request or new research claim is made. Verify both exact-range continuity and private-path guards, then publish the finite correction.

The existing README generator emitted an unsupported `datatable` fence above20 rows and always labeled its command as a new NotebookLM pipeline run. Correct the source generator to retain the complete Markdown table and report the actual skip-regeneration command; preserve the JSON sidecar and source column.

Clean-checkout run34234384883 now passes the installer suite and reaches signed-probe policy checks, where the spawned `rg` command is unavailable on the runner. Declare ripgrep beside jq in CI; preserve the policy assertions. README continuity passed atd7c7678.

Run34234898934 reaches the Claude launcher suite, whose last four checks still inspect profiles in the operator's real home. Make the test use four disposable tokenless profiles and pass that home only to mocked launcher invocations. Assert their bytes stay identical and no canary persists. This preserves token non-persistence verification without certifying or reading installed profiles.
