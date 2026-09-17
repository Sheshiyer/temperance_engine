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

No runnable legacy backup survives successful activation. Recovery is a fresh
install from reviewed source plus redacted receipts, not reactivation of stale
executables or credentials.
