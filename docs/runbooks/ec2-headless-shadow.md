# EC2 headless Temperance shadow rollout

This runbook installs and proves a route-only Temperance release beside Hermes. It does not enable native Hermes execution, install a model backend, change a Hermes unit, create a persistent Temperance unit, or grant approval.

## Invariants

- The AWS account, instance, security group, operator `/32`, Hermes release, services, and protected-path metadata are captured before installation.
- The Git source is clean and committed before packaging.
- The archive is immutable, content-manifested, and verified again on EC2.
- The release path is explicit: `/opt/temperance-headless/releases/<version>-<commit12>`.
- There is no `/opt/temperance-headless/current` symlink.
- `temperance-shadow` is a dedicated nologin system user and is not a member of `hermes`.
- The canary gets a private network namespace, `IPAddressDeny=any`, and no backend PATH.
- Hermes gateway and runner timer remain enabled and active with unchanged unit hashes and activation timestamps.

## Build

```bash
export TEMPERANCE_HEADLESS_OUTPUT_DIR=/absolute/evidence/artifacts
bash scripts/build-headless-shadow.sh
```

The build refuses a dirty Git tree, runs `test`, `standalone:audit`, and `standalone:smoke`, and prints a typed build result containing the release ID, source commit, archive path, and SHA-256.

## Upload and install

Upload the archive and `scripts/install-headless-shadow-archive.sh` to a temporary EC2 path. Run the installer as root with the exact build-result values:

```bash
sudo bash /tmp/install-headless-shadow-archive.sh \
  /tmp/temperance-headless-shadow-<release-id>.tar.gz \
  sha256:<archive-sha256> \
  <release-id>
```

The installer requires Node 22, verifies the archive and every file, creates the isolated user if needed, and atomically moves the root-owned release into place. Re-running the same manifest is idempotent. A different manifest at the same release path fails closed.

## Health snapshot

Use one stable session ID for before and after snapshots:

```bash
sudo bash /tmp/capture-ec2-shadow-health.sh <session-id> before
sudo bash /tmp/capture-ec2-shadow-health.sh <session-id> after /opt/temperance-headless/releases/<release-id>
```

Both JSON documents belong in the proof bundle. Gateway/timer active state, enabled state, activation timestamp, and unit hashes must match. The last runner result must remain `success` with exit status `0`.

## No-egress shadow canary

```bash
sudo systemd-run --quiet --wait --pipe --collect \
  --unit=temperance-shadow-<session-id> \
  --uid=temperance-shadow \
  --gid=temperance-shadow \
  --property=PrivateNetwork=yes \
  --property=IPAddressDeny=any \
  --property=RestrictAddressFamilies=AF_UNIX \
  --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=PrivateTmp=yes \
  --property=RestrictSUIDSGID=yes \
  --property=LockPersonality=yes \
  --property=UMask=0077 \
  --setenv=HOME=/nonexistent \
  /opt/temperance-headless/releases/<release-id>/bin/temperance-shadow \
  --envelope /opt/temperance-headless/releases/<release-id>/share/fixtures/hermes-shadow-attempt.v1.json
```

Pass means one `thoughtseed.temperance.shadow_decision.v1` JSON object with:

- `mode: "shadow"`
- all six guardrail booleans denying authority/side effects/backend/network/domain writes
- a logical backend and `backendAvailability: "not_probed"`
- the Thoughtseed contract generator skill and contract renderer policy
- reproducible `inputDigest` and `decisionDigest`

Run both invalid fixtures through the same isolation command. Each must exit non-zero with a typed error code (`missing_field` or `unknown_field`) and no decision receipt.

## Negative activation checks

```bash
test ! -e /opt/temperance-headless/current
test ! -L /opt/temperance-headless/current
systemctl list-unit-files 'temperance*' --no-legend --no-pager
id -nG temperance-shadow
sudo -u temperance-shadow test ! -r /etc/hermes/.env
```

Expected: no current path, zero persistent Temperance unit files, no `hermes` group membership, and no read access to Hermes secrets.

## Rollback

Because nothing is activated, rollback is deletion of only the exact release directory after its manifest has been archived:

```bash
sudo rm -rf /opt/temperance-headless/releases/<release-id>
```

Do not touch `/opt/hermes-aws-ts`, `/etc/hermes`, any Hermes service/timer, D1, or GSD state. Re-run the after-health snapshot. Remove the dedicated user/group only when there are no releases and no future shadow rollout is planned.

## Close access

Revoke the exact temporary security-group rule or `/32`, read the security group back to prove absence, and confirm SSH from the removed source no longer connects. Never leave a broad SSH rule as a rollout convenience.
