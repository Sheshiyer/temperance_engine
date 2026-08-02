# OpenCode EC2 session profile

Use this profile on the Linux EC2 host after the local `omniroute` and
`temperance` provider blocks already exist in `$HOME/.config/opencode/opencode.json`.
The reconciler preserves their endpoints and environment references; it never
reads cloud metadata, resolves environment references, or writes credentials.
Its required local rollback backup is a byte-for-byte config copy protected at
mode `600`; keep credentials out of OpenCode JSON and use environment references.

## Prerequisites

- `opencode`, `jq`, and `perl`
- `sha256sum` (normal on Ubuntu) or `shasum`
- the local Temperance relay and OmniRoute endpoint already configured
- `TEMPERANCE_AUTO_READY=0` in the relay service until a live S lane is proven

Check the policy file before mutation:

```bash
jq empty package/router/temperance-session-profiles.ec2.json
jq -r '.aliases[].id' package/router/temperance-session-profiles.ec2.json
```

## Apply and validate

Choose a caller-stable rollout identifier. The script creates its own UTC-stamped
backup inside that rollout.

```bash
export TEMPERANCE_ROLLOUT_ID="ec2-session-$(date -u +%Y%m%dT%H%M%SZ)"
scripts/configure-opencode-session-profiles.sh --host-profile ec2 --apply
scripts/configure-opencode-session-profiles.sh --host-profile ec2 --validate
```

Validation is repeatable and non-mutating. It enforces this exact picker:

```text
temperance/temperance-auto
omniroute/te-free-burst
omniroute/te-plan
omniroute/temperance-coding
omniroute/te-build
```

Only `omniroute` and `temperance` are enabled. `temperance-auto` is the default
agent. The small/content B lane is `te-free-burst`. Because its forced-tool
canary failed closed, mutating B work uses `temperance-coding`, whose forced-tool
canary returned `200` with `evidence_check({value:TOOL_OK})`. The explicit A
lanes are `te-plan` and `te-build`. Mac-only Spark and `code-fast` are removed
from the managed EC2 surface.

## Compression transport boundary

The EC2 manifest carries the same literal-off request policy as the Mac host:

```json
{
  "transport_policy": {
    "omniroute_compression": {
      "mode": "off",
      "providers": ["omniroute", "temperance"]
    }
  }
}
```

Apply preserves unrelated provider headers, removes every case-insensitive
variant of `x-omniroute-compression`, and installs exactly one canonical
`x-omniroute-compression: off` value on both enabled providers. Validation reads
OpenCode's resolved configuration and fails if either effective provider differs.
The relay also overwrites the header at its final outbound boundary. This does
not enable compression and does not change the Algorithm/S readiness gate.

## Algorithm/S readiness gate

Both `temperance-auto` and `temperance-algorithm` bind to
`temperance/temperance-auto`. They do not bind to an invented S alias. The relay
environment variable is the activation gate:

- `TEMPERANCE_AUTO_READY=0`: Algorithm/S returns HTTP `503` with code
  `s_tier_unavailable` and stops.
- `TEMPERANCE_AUTO_READY=1`: use only after the live S lane has passed its
  readiness probes.

The relay treats an absent, empty, or unrecognized value as not ready. Only
`1`, `true`, `yes`, or `on` enable Algorithm/S, so a missing systemd environment
entry cannot silently promote the lane.

An operator may explicitly start a new A- or B-lane task after a visible S miss.
The reconciler never silently represents `te-plan`, `te-build`, or
`te-free-burst`, or `temperance-coding` as Algorithm/S.

### Falsification-only S-tier telemetry

The EC2 candidate manifest and CLI can disprove candidate claims or record that
the available evidence is inconclusive. They never establish provider identity,
operator authorization, or promotion readiness, and they never read or change
`TEMPERANCE_AUTO_READY`. A receipt therefore cannot create `te-algorithm`, open
the Algorithm/S gate, select a route, or authorize any provider.

The closed candidate outcome vocabulary is exactly:

```text
FALSIFIED
CONSISTENT_UNPROVEN
ENV_UNAVAILABLE
QUOTA_BLOCKED
TRANSPORT_FAIL
PINNING_UNVERIFIED
STRUCTURALLY_UNVERIFIABLE
```

Each receipt also records allowlisted `controlEvidenceCodes` for `pinBefore`,
`mismatch`, and `pinAfter`: `expected_404`, `transport_timeout`,
`transport_network`, `unexpected_status`, `invalid_response_shape`,
`nonce_missing`, `value_missing`, `attribution_missing`,
`unexpected_attribution`, or `expected_mismatch`. These are diagnostic labels,
not additional outcomes, and never retain raw bodies, vendor errors, or secrets.

Use fixture mode for deterministic offline evaluation of a sanitized fixture:

```bash
sudo install -d -o root -g root -m 0700 \
  /var/lib/temperance-engine/s-tier-readiness
sudo bun scripts/omniroute-s-tier-readiness.ts \
  --fixture /absolute/path/to/sanitized-s-tier-fixture.json \
  --output /var/lib/temperance-engine/s-tier-readiness/fixture-<UTC>.json
```

Live mode is explicit and must not be inferred from a key, environment variable,
or missing fixture flag. It sends bounded requests only to the manifest's exact
loopback endpoint, `http://127.0.0.1:20128/v1/chat/completions`:

```bash
sudo bun scripts/omniroute-s-tier-readiness.ts \
  --live \
  --key-file /etc/hermes/omniroute-proxy.key \
  --output /var/lib/temperance-engine/s-tier-readiness/live-<UTC>.json
```

The key path must be absolute and outside this repository, and the key must be a
regular non-symlink file with exactly one hard link. Accepted metadata is either
ownership by the invoking user with exact mode `0600`, or the protected-service
pattern: exact mode `0640`, UID `0`, a nonzero GID, and an immediate parent that
is a real directory with exact mode `0750`, UID `0`, and the same GID. On the
real EC2 host, use `/etc/hermes/omniroute-proxy.key` in place. Never copy it to a
different path and never chmod or chown it for this probe.

The key never appears in the manifest, receipt, command output, or request
telemetry. Create `/var/lib/temperance-engine/s-tier-readiness` explicitly as
root-owned mode `0700` and run the command as root so the receipt directory owner
matches the process. Each receipt is exclusively created at mode `0600`, contains
no response bodies or raw nonce, and carries a self-declared `expiresAt` after
the manifest's five-minute lifetime. No reaper or production consumer enforces
that timestamp; operators must reject expired receipts as stale local telemetry.

The probe schedule is serial and bounded: an impossible explicit-pin denial
runs before candidate work and a known attribution-mismatch control follows.
Eligible candidate probes run only when both early controls are exactly
expected; otherwise all candidate requests are skipped as already void. The
same impossible-pin denial always runs last. Unexpected pinning or malformed controls
void candidate interpretation. Even `CONSISTENT_UNPROVEN` means only that the
observations did not falsify the candidate during that run.

The governed sources are
`package/router/omniroute-s-tier-candidates.ec2.json`,
`package/router/omniroute-s-tier-readiness.ts`, and
`scripts/omniroute-s-tier-readiness.ts`. Running the live command requires a
separate operator decision; this runbook does not authorize it.

## Receipts, backups, and rollback

Apply prints both paths. Defaults are:

```text
$HOME/.temperance_engine/session-routing/rollouts/<rollout-id>.json
$HOME/.temperance_engine/backups/session-routing/<rollout-id>/opencode-ec2-<UTC>.json
```

Receipts and backups are mode `600`. Rollback verifies the host profile,
manifest hash, applied-config hash, backup hash, and managed skill links before
making any change. Use the same checkout and EC2 profile that created the
receipt:

```bash
scripts/configure-opencode-session-profiles.sh \
  --host-profile ec2 \
  --rollback "$HOME/.temperance_engine/session-routing/rollouts/<rollout-id>.json"
```

Any post-apply operator edit or link drift blocks rollback without partial
mutation. Never place API keys, tokens, passwords, or credential files in the
manifest, rollout identifier, receipt, or command line.
