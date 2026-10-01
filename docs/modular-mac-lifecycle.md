# Modular Mac lifecycle

Describes the portable Temperance Engine install/update/rollback lifecycle for
the `wt-mac-kit` distribution. This document is owned by Task 7 of the
2026-10-01 modular-mac plan. Physical installation gates remain pending until
the owner completes the Task 8 acceptance flows.

## Scope and limitations

This document covers the **distribution kit** lifecycle: install, update,
rollback and recovery semantics for the portable release closure. It does not
cover:

- Cambium organ activation, D1 writes, or shared-scheduler ownership transfers.
- Snow Gloves enrollment (external product; absent from both Mac profiles).
- OmniRoute or 9router credential provisioning (separate owner operations).
- Physical device proof, FileVault unlock sequences, or hardware-specific
  acceptance (Task 8; pending physical gate — see below).
- CLI/controller/TUI final integration (parallel Tasks 1–6; deferred to parent
  after those tasks merge).

**Pending physical gate:** Section 6 ("Workstation bootstrap" and "Always-on
node") records the required physical evidence steps. These steps require actual
hardware, an OS install, and an owner-reviewed destination packet. Source tests
and dry-run outputs cannot substitute for physical acceptance.

## Supported architectures and profiles

The portable kit currently admits **macOS arm64 with Bun 1.3.5**. x64 is held
until its toolchain and native artifact are independently verified. The legacy
installer's broader OS detection does not qualify those platforms as portable
kit releases.

The admitted design defines `workstation` and `always-on-node`. The former
selects local clients and recovery; the latter selects an explicit worker or
coordinator role, service recovery and resource limits. Neither depends on
Snow Gloves. These composed profile/controller paths are Tasks 1–6 integration
work; the current Task 7 test checks only the existing installer flag plans.
Do not describe shell flag combinations as accepted profile execution.

All personal OmniRoute overlays, including schema versions 1 and 2, are
unconditionally **held before effects**. The separately reviewed adapter is
not present. Do not infer activation from JSON shape or relabel a schema replay
as an upgrade. Existing operator config remains owner state.

## Trusted manual bootstrap

Obtain `verify-migration-kit.sh` independently from the reviewed channel,
along with its trusted checksum. Check that script before executing it. The
archive's `ARTIFACT-DIGEST.sha256` sidecar is useful for transport but does not
replace the operator/channel supplied expected digest.

Verification uses stock macOS `/bin/bash` 3.2, `/usr/bin/perl` (Digest::SHA,
File::Path, Fcntl), `/usr/bin/gzip`, and `/usr/bin/shasum`. If these tools or
modules are unavailable, bootstrap holds before extraction. No Git, Bun,
Node, Python, Homebrew, or agent CLI is assumed on the destination.

```sh
/bin/bash ./verify-migration-kit.sh \
  --archive "temperance-engine-${VERSION}-arm64.tar.gz" \
  --expected-digest "sha256:${TRUSTED_ARCHIVE_SHA256}" \
  --extract-to "$HOME/temperance-kit"
```

The destination must be absent, with an existing private parent owned by the
operator. A complete first streaming pass verifies raw POSIX ustar headers,
header checksums, canonical positive path grammar, regular-file/directory
types, member counts, octal sizes, decompressed bounds, duplicates and exact
bidirectional inner checksums before materializing any payload. PAX/GNU
extensions, links, special files, aliases and trailing nonzero data are
refused. Bounds are 500 MiB compressed, 200 MiB per member, 400 MiB payload,
20,000 headers and 440 MiB decompressed wire data. The manifest is limited to
4 MiB. Zero tar record padding after the end marker is limited to 64 KiB.

All work uses a new private staging directory and a private archive snapshot.
Only after full verification does the tool exclusively create the destination
and publish files with no-replace opens. This is **not an atomic directory
publication**: observers may see partial verified contents during copying.
On failure the tool removes only its owned destination after checking its
device/inode identity; a changed or unobservable identity is preserved with a
HOLD. Parent paths must remain under operator control. This path-based stock
implementation does not claim resistance to a hostile same-user process
replacing ancestors or racing an inode check.

### Exact toolchain pins

| Component | Pin / checksum |
|---|---|
| Bun | `1.3.5` |
| Official `bun-v1.3.5` arm64 ZIP | `db17588a4aea8804856825d4bead3f05e1f37276ca606f37e369b4f72f35d3fb` |
| Unpacked arm64 Bun binary | `66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3` |
| OpenTUI | `0.5.11` |
| AJV | `8.20.0` |
| TypeScript | `5.9.3` |
| Exact registry `bun.lock` bytes | `65083b07d3b402c932dee70b01ac4495a462de73a0a525484da9591a57371387` |

Prefer the bundled runtime after independently checking its binary checksum:

```sh
cd "$HOME/temperance-kit"
printf '%s  %s\n' \
  66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3 \
  toolchain/bun-1.3.5-arm64 | shasum -a 256 -c -
./toolchain/bun-1.3.5-arm64 --version
sh install.sh --dry-run
```

Require checksum success and exact version `1.3.5`. Frozen dependencies ship
inside the archive, so no dependency download is needed for the packaged CLI.
The legacy installer may require upstream tools for selected modules; actual
installation and service activation are separately reviewed destination work.
A bundled CLI is not proof of an offline installation of every module.

Alternatively obtain `bun-darwin-aarch64.zip` from the pinned official release,
verify the ZIP checksum above **before** unpacking with `ditto -x -k`, and
verify the unpacked binary against the binary checksum above. Keep it in a
chosen private tool directory. No remote shell installer or Homebrew fallback
is part of this trust chain.

## Offline builder inputs and evidence

The builder requires a source repository, an explicit approved commit, an
explicit private `TOOLCHAIN_CACHE_DIR` containing the official ZIP and verified
`bun-1.3.5-arm64/bun`, a frozen `--vendor-dir`, and an independently reviewed
`--expected-vendor-digest sha256:HEX`. It never searches broader host folders.
Stock macOS Bash 3.2 is supported. The output parent must already exist and be
operator-controlled. Publication creates each output file exclusively and
rolls back its own file identities on ordinary failure; it is not an atomic
three-file transaction or a defense against hostile ancestor replacement.

```sh
TOOLCHAIN_CACHE_DIR="$REVIEWED_CACHE" /bin/bash scripts/build-migration-kit.sh \
  --commit "$APPROVED_COMMIT" --vendor-dir "$REVIEWED_VENDOR" \
  --expected-vendor-digest "sha256:$REVIEWED_VENDOR_SHA256" \
  --out "$NEW_KIT_OUTPUT"
```

The independent frozen-tree digest is SHA-256 of the byte-sorted concatenated
inventory rows. Regular-file rows are `sha256  MODE  relative-path` plus LF,
where MODE is `0755` when any executable bit is set, otherwise `0644`. Symlink
rows are `link  relative-target  relative-path` plus LF. Only relative `.bin`
links to regular files within the vendor root are admitted. Their target and
bytes are bound by the inventory; the links are omitted from the kit because
the direct Bun build/runtime needs none. All other links are refused. Review
this inventory separately; the builder does not generate its own trust input.
Registry SRI describes package tarballs and cannot authenticate an unpacked
directory by itself.

The verified runtime structurally parses package.json and JSONC bun.lock,
checks exact package/workspace versions and full registry integrity values,
reconciles all 21 native/build/runtime dependencies, validates the manifest
lock schema and compiled fragments, and checks its COPY digests/modes against
committed blobs. The native `libopentui.dylib` must be a nonempty arm64 Mach-O
dylib. Its observed digest is bound to the reviewed vendor digest in kit
metadata; it is an observation, not independent release authority.

Source comes exclusively from committed blobs. Private planning/runtime trees,
redundant `.agents` symlink aliases, dependency/build output and VCS metadata
are excluded. Required installer scripts and explicit post-install checked paths remain
mandatory. The five public `.planning` authority inputs (PROJECT, ROADMAP,
STATE, REQUIREMENTS and config.json) are retained because compile/verify reads
them; all other planning paths remain excluded. The bundle is
privacy-scanned across all payload text, including vendored dependencies.
Known upstream documentation examples are normalized only when the exact file
path, observed file SHA-256 and exact example fragment match the allowlist;
adjacent content still receives the same checks. Known credential patterns
are checked in binary and text lines. The bundle must pass the independent
verifier before publication.
`--dry-run` performs read-only closure checks and writes no output.

The current accepted base has mismatched enrichment COPY hashes and an extra
`atlasRecall.ts` file still classified private by the owning project. It is
excluded from the portable payload; merely being committed does not promote
it. The actual release remains held pending separately reviewed source
classification and manifest reconciliation, then a fresh Tasks 1–6 build.
Do not refresh the manifest blindly to accept these bytes.
Synthetic fixture success proves the packaging contracts only. Task 8 still
requires physical boot, identity, FileVault recovery, power/network loss,
callback, backup and restore evidence.

## Install semantics

### First install

```sh
sh install.sh [--with-spine] [--with-relay] [--skip-voice] [--dry-run]
```

- All destination directories are created with `mkdir -p`.
- Existing files are backed up before overwrite (see Backup / rollback).
- Live operator surfaces (files containing a `temperance:identity` marker) are
  skipped unless `--force` is passed.
- Dry-run mode prints every planned action prefixed with `DRY_RUN:` and
  creates no files.

### Repeated install

Re-running `install.sh` without `--force` is idempotent for live operator
surfaces. Non-operator files are updated to the current source. Backups are
taken for each overwrite. User configuration written after the first install
(e.g., provider credentials, project approvals) is not touched by the
installer; those values live under `TEMPERANCE_STATE_DIR` and are separately
managed.

### Selecting a profile

| Goal | Flags |
|---|---|
| Full Thoughtseed member spine | `--with-spine` |
| Add relay / LaunchAgent | `--with-relay` |
| Exclude voice | `--skip-voice` |
| Include Claude Code surfaces | `--with-claude` |
| Include Codex surfaces | `--with-codex` |
| Override existing live files | `--force` |

Legacy flag-selection receipts are visible in installer stdout (`*_MODE=install|skip` lines)
and in `--dry-run` output before committing.

## Backup / rollback

Every overwrite is preceded by a timestamped backup:

```
$TEMPERANCE_BACKUP_DIR/<YYYYMMDDTHHMMSSZ>/<path-slug>
```

Default backup root:
```sh
TEMPERANCE_BACKUP_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}/backups"
```

Override before install:
```sh
TEMPERANCE_BACKUP_DIR=/my/backup/path sh install.sh
```

### Restore from backup

```sh
# List available backups
ls "$HOME/.temperance_engine/backups"

# Restore a specific file (slug uses __ for path separators)
cp "$HOME/.temperance_engine/backups/<timestamp>/<slug>" "<original-path>"
```

**Compatible release rollback:** To roll back to a prior release, restore from
the backup taken during that release's install. If no backup exists for the
prior state, the rollback is held pending manual recovery. A missing backup is
not permission to substitute current values.

**Binding rollback:** A recoverable configuration generation binds release
digest, module lock digest and binding schema. Rollback restores the
compatible release and binding generation together. Mismatched schema versions
hold effects and return `upgrade-required`.

## Workstation replacement (Task 8 — physical gate pending)

Requires actual hardware, OS install, and the owner-reviewed destination
packet. Steps are listed here as a reference; physical evidence is recorded
separately in the owning ISA.

1. Inspect old host; export only a reviewed capability manifest.
2. On the new Mac: Apple setup, verified release access, no assumed tooling.
3. Follow manual bootstrap (Section 4 above).
4. Authenticate clients and providers independently; retain
   `installed-but-awaiting-authentication` as a recoverable state.
5. Attach approved projects and run synthetic probes, then owner-approved canaries.
6. Keep old machine recoverable until destination cold boot and golden paths pass.

**Physical gate:** Owner must record receipts in the ISA. This document section
is pending until that flow completes.

## Always-on node addition (Task 8 — physical gate pending)

1. Inspect new Mac; choose worker vs coordinator; measure RAM/disk/OS/network.
2. Install only selected role packs with a fresh device identity.
3. Attach to the chosen router endpoint without copying Mac-local paths.
4. Prove one bounded job, stop/late-result exclusion, rollback and capacity
   limits before adding further nodes.

**Physical gate:** Owner must record receipts in the ISA. Pending.

## Unsupported overlay hold

Every `TEMPERANCE_PRIVATE_OVERLAY` request holds with zero effects, including
otherwise valid JSON and schema v1/v2. No personal adapter is shipped. Preserve
the existing configuration; a reviewed future adapter is required before any
overlay upgrade or apply can be demonstrated.

## Data classification

| Data class | Ships in release closure | Backed up by installer |
|---|---|---|
| Installer scripts, templates, skills | Yes | No (source) |
| Operator configuration, project approvals | No | Yes |
| Provider credentials, OAuth tokens | No | No (9Router owned) |
| Native session IDs, memory bodies | No | No |
| Private overlay bindings | No | Operator-managed |

## Further reading

- `docs/rollback.md` — exact rollback commands
- `docs/release-control.md` — version planes and release cut procedure
- `package/install-surface/docs/guided-onboarding.md` — wizard and TUI flow
- `package/install-surface/docs/agent-operations.md` — agent/headless interface
- `COMPATIBILITY.md` — toolchain pins (Bun 1.3.5, OpenTUI 0.5.11, AJV 8.20.0)
