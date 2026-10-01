# Guided onboarding

`onboard --tui` is a sequential wizard, not a tabbed dashboard:

1. Host — review the machine and explicitly selected personal profile, if any.
2. Projects — inspect existing approvals and mapped folders/repositories; select new approvals explicitly.
3. Providers — choose a provider and complete 9Router-owned sign-in.
4. Combos — select ordered live model members for each alias, then review the exact 9Router changes.
5. Organs and tools — request capabilities, re-probe dependencies, or explicitly defer held options.
6. Integrations — review application prerequisites without treating presence as live service health.
7. Review — confirm requested configuration and project approvals with Enter or y.

Use the arrow keys to choose a visible action and Enter to activate it. Back and
Continue are ordinary action rows. OAuth, combo setup, and refresh return to the
current step with pending selections preserved. Cancel does not save pending
project or module choices; completed provider authorizations are owned by
9Router and are not undone by cancelling the outer wizard.

## Persistence and authority

- `--project-capsules` loads approved project access; `--project-capsules-out` explicitly enables saving new approvals. Existing capsules are preserved.
- `--wizard-state` loads/saves owner-only requested-module preferences for this profile. Every launch re-probes; saved preferences are not admission or activation grants.
- Provider sign-in requires an explicit provider action. Credentials stay in 9Router.
- Combo setup currently supports a fresh combo/key state with existing OAuth providers. Existing combos, gateway keys, and occupied Keychain references are held, not overwritten.
- Seating choices alone do not authorize writes. A separate exact-plan review binds ordered members, alias mappings, and the gateway reference into the apply digest.
- Final wizard confirmation does not install every selected organ, certify a tunnel/dashboard, or establish 900k–1M context capacity. Those capabilities need their own operational evidence.

Generic Temperance needs no Noesis profile, mounted personal volume, or provider.
Personal paths and Keychain references belong in the explicitly supplied private
host binding, not in the portable core.

## Agents, health and telemetry

The same workflow is available as `onboard --agent`; `--step` and `--action`
operate on the shared controller without persisting approvals or bypassing
sign-in/review. The TUI exposes doctor/health and local event inspection via
visible actions or `d` / `l`; closing either report returns to the same step.
Use `--telemetry` to record bounded local metadata, `--health --json` for a fresh
health snapshot, and `--logs --json` for recent events.
See [agent operations](agent-operations.md) for the full runnable flow,
argument/state handoff, privacy boundaries, and exit-code semantics.


## Manual bootstrap

Obtain the reviewed verifier script and its independently supplied SHA-256
from the operator or pinned release channel. Verify that script before running
it. The adjacent archive sidecar alone does not establish trust.

The arm64 kit bootstrap requires stock macOS `/bin/bash` 3.2, `/usr/bin/perl`
(with Digest::SHA, File::Path and Fcntl), `/usr/bin/gzip`, and `shasum`.
Missing tools produce a bootstrap HOLD before payload extraction. No Git,
Bun, Node, Python, Homebrew or agent CLI is needed to verify the kit.

1. Use the trusted verifier to check and publish the kit into an **absent**
   directory beneath a private parent you own:
   ```sh
   /bin/bash ./verify-migration-kit.sh \
     --archive "temperance-engine-${VERSION}-arm64.tar.gz" \
     --expected-digest "sha256:${TRUSTED_ARCHIVE_SHA256}" \
     --extract-to "$HOME/temperance-kit"
   ```
   Supply `VERSION` and `TRUSTED_ARCHIVE_SHA256` from the reviewed channel.
   Even an existing empty destination is refused. Failed verification leaves
   no payload destination.
2. Verify the bundled Bun 1.3.5 binary before using it:
   ```sh
   cd "$HOME/temperance-kit"
   printf '%s  %s\n' \
     66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3 \
     toolchain/bun-1.3.5-arm64 | shasum -a 256 -c -
   ./toolchain/bun-1.3.5-arm64 --version
   ```
   Require both a successful checksum check and the exact version `1.3.5`.
   The kit already includes frozen dependencies; do not fetch dependencies as
   an implicit bootstrap step.
3. Inspect the existing installer plan:
   ```sh
   sh install.sh --dry-run
   ```
   Actual installation, client authentication and service activation require
   the reviewed destination packet and their prerequisites. The legacy
   installer may need external upstream tools for selected modules; a closed
   install-surface CLI does not establish an offline install of every module.

The alternative manual Bun ZIP procedure, exact ZIP checksum, builder inputs
and publication limits are in
[the modular Mac lifecycle](../../../docs/modular-mac-lifecycle.md).
The current distributable toolchain is arm64 only. x64 and other portable-kit
architectures remain held pending independent pin and runtime verification.
All personal overlay requests are held before effects; changing the overlay
schema alone cannot remove that hold. Both composed Mac profiles and the new
migration views need the Tasks 1–6 integration rebuild. Task 8 remains a
physical-device acceptance gate.
