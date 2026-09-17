# V4 Hand-in-Glove Architecture

## Contract

Temperance is the portable glove. A selected profile is the hand. The generic
runtime must start, diagnose itself, and remain useful when no personal profile
is present. A profile may add modules, symbolic roots, semantic route aliases,
and project candidates; it may not embed credentials or silently grant project
mutation authority.

The desired-state planner is the single decision boundary shared by onboarding,
doctor, non-interactive JSON, install, update, and repair. User interfaces do not
write configuration directly.

## Composition

1. The generic catalog declares capabilities and their dependency gates.
2. An explicitly selected profile adds personal module descriptors and symbolic
   bindings.
3. Host probes classify each module as unavailable, detected, configured,
   healthy, or enabled.
4. The planner resolves dependencies and emits the exact proposed operations.
5. A confirmed executor applies that immutable plan and records a redacted
   receipt.
6. Doctor reuses the same probes and desired state to report drift.

Discovery never implies enrollment. Growth maps, portfolio scans, and Git
remotes produce candidates only. A project capsule is created only after an
explicit approval, and removing that capsule never deletes the repository.

## Router Authority

`9router` is the successor package to OmniRoute. It is not installed beside
OmniRoute as a second authority.

- The initial package pin is exactly `9router@0.5.75`.
- 9Router owns provider connections, concrete combo membership, ordering,
  quotas, and fallback.
- Temperance and Noesis select and validate semantic combo aliases only.
- Hands receives a semantic alias through a route lease; it has no concrete
  combo-membership write capability.
- Legacy `.omniroute`, `.omnirouter`, OmniRoute executables, scheduled combo
  writers, and OmniRoute LaunchAgents are cutover inputs and are absent after
  activation.

9Router's bundled macOS autostart is not the Temperance service contract. In
0.5.75 it uses the package's network-exposed default host and does not bind the
selected `DATA_DIR`. Temperance therefore generates its own LaunchAgent with an
absolute executable, explicit data directory, loopback host
`127.0.0.1:20128`, managed logs, and no credential value.

Management operations use 9Router's local management API. The CLI management
token is derived inside the selected 9Router data directory and is never copied
into a profile, operation plan, log, or receipt. A gateway API key created for
direct clients is captured once into macOS Keychain; durable configuration
stores only its Keychain reference.

### Guided router setup

Provider and combo choices live in a private
`temperance.9router-guided-setup.v1` input. Provider entries name Keychain
references, never credential values. Combo entries are concrete because
9Router owns membership; Noesis continues to declare only required aliases.

The setup input is validated before review. Its canonical digest and exact
secret-free provider, combo, model, alias, and gateway-key-reference details
are embedded in the onboarding plan. Changing any seat after review changes
the digest and invalidates confirmation.

Repair is intentionally narrower than planning:

```bash
temperance onboard \
  --tui --repair \
  --host-profile "${HOST_PROFILE_PATH}" \
  --host-binding "${HOST_BINDING_PATH}" \
  --router-setup "${ROUTER_SETUP_PATH}" \
  --receipt-dir "${TEMPERANCE_RECEIPT_DIR}" \
  --select provider.9router
```

The TUI must display `COMMIT PLAN`, the bound configuration input, and the
final plan digest. Host mutation starts only after confirmation of that exact
digest. The effector resolves provider credentials from Keychain in memory,
creates fresh provider connections, combos, and one gateway key through the
local API, captures the gateway key into Keychain, and verifies provider,
combo, alias, model-count, and key metadata through API readback. It does not
edit pre-existing provider or combo objects.

If any create, capture, readback, receipt, or later operation step fails, the
executor deletes newly created keys, combos, and providers in reverse order
and restores the prior Keychain value. Created identities are recovered by
pre/post API difference when an upstream success response is malformed, so a
bad response cannot silently strand an untracked object.

## Route Continuity

A route context contains the admitted project, GSD step, phase, session, and
semantic alias. Opening a route lease pins that alias for one GSD step. A phase
change or mounted-project disconnect closes the lease and emits a checkpoint.
Resume preserves the admitted GSD step but requires a fresh session identifier
and a new lease. Concrete providers and models remain outside the lease because
9Router may realize the semantic alias differently over time.

## External Volumes

An external volume is admitted by an out-of-repository host binding that
contains the enrolled volume identity. Label matching alone is insufficient.
The adapter must verify the mounted identity and the configured canonical
subtree before project mutation becomes eligible.

An absent volume is a supported degraded state. The generic runtime, doctor,
and non-volume modules continue to work; mounted-project mutations, Obsidian
tunneling, and dependent organs remain held with actionable reasons.

## Cutover Invariants

The cutover planner is read-only. It inventories only allowlisted paths and
labels, never reads LaunchAgent contents, never follows symlinks while counting
managed files, and does not authorize destructive execution. Its stable digest
binds the reviewed scope.

Activation is ordered:

1. verify the replacement in isolation;
2. capture the redacted legacy manifest;
3. stop the legacy port owner and managed LaunchAgents;
4. revoke the exposed legacy gateway credential;
5. remove exact legacy state and scheduled writers;
6. transactionally install the reviewed runtime and exact router package;
7. generate secret-free, loopback-only services;
8. read back provider, combo, client, project, and doctor state;
9. prove degraded, active, and cold-start behavior.

The destructive executor accepts neither a naked cutover plan nor a source
checkout by itself. A replacement proof binds the full Temperance commit and
tree, the exact `9router@0.5.75` target, a staged-artifact digest, and digests
of the isolated install-surface and cutover-contract verification runs. The
TUI confirmation binds the cutover-plan digest and replacement-proof digest
into one short-lived operation digest. A changed host observation, replacement
artifact, source tree, or expired confirmation refuses execution before the
durable journal begins.

A proof can be emitted only from a clean committed checkout:

```bash
bun scripts/v4-replacement-proof.ts > "${REPLACEMENT_PROOF_PATH}"
```

The generator hashes `git archive HEAD`, runs the complete install-surface
verification, and runs the cutover planner, executor, journal, and proof
contract suites. Failed command output is not copied into the proof or its
error message.

The executor stages the fresh replacement before stopping anything. Failures
before credential revocation restore stopped services and discard even a
partially staged replacement. Credential revocation is the irreversible
boundary: after it, failures recover only from the already verified fresh
replacement. They never restore legacy bytes. The journal records action IDs,
digests, timestamps, and redacted failure codes; final receipts contain no
absolute host paths or credential values. Failure to finalize the receipt
after successful live readback is surfaced without tearing down the verified
replacement.

The portable cutover executor contains no macOS path, launchd, or Keychain
policy. `MacOsV4CutoverAdapter` is the bounded host layer: it may control only
the reviewed LaunchAgent allowlist, exact legacy state roots, Keychain
references, and a package symlink whose resolved `package.json` identifies
`omniroute`. Portable source staging and replacement installation remain
behind `V4ReplacementLifecycle`, so Noesis policy and Madara bindings cannot
become host-mutation authority.

No runnable legacy backup survives successful activation. Recovery is a fresh
install from reviewed source plus redacted receipts, not reactivation of stale
executables or credentials.
