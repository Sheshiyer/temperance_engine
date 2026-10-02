# Modular Mac lifecycle

The portable kit is intended to provide a verified release closure, a minimal
generic bootstrap, and the modular migration interface; the final integrated
archive still requires independent verification and qualification. `workstation` and `always-on-node` use the
same contracts and owner checks. Neither profile label installs modules, starts
services, authenticates a client, or establishes destination readiness.

Source Tasks 1–6, including the migration SDK, shared controller, TUI and split
production build, are accepted with bounded disposable-runtime evidence. Task 7
final immutable-kit qualification and Task 8 physical acceptance remain pending.
Source acceptance and earlier foundation-kit receipts are prerequisites; they do
not qualify the final integrated release. Physical acceptance is a separate
owner-approved migration gate, not a prerequisite for source-product completion.

## Release, profiles and private state

The portable closure admits macOS arm64 with Bun 1.3.5. x64 and other kit targets
remain held until their toolchain and native artifacts are independently verified.
The legacy source installer's broader platform handling does not extend the kit's
support matrix.

Both base profiles can use the same logical modules and backend `none`.
Destination-specific bindings, worker/coordinator roles, resources and service
ownership require explicit owner inputs and their own checks. `recovery` is a
controller scenario, not another shell installer profile. The shell installer
has no `--profile` flag. Selecting a TUI scenario changes the selected destination
context; retained source snapshot and plan profiles remain separately visible.

The reviewed growth model retains five operating organs and six cognitive organs.
The six Will desks are role filters within Will. Source references, work lineage,
consumer verdicts and freshness retain their distinct meanings; display does not
admit work, publish content, promote learning or enable a schedule. Adytum's
owner/consumer topic-parity requirements remain explicit holds where evidence is
missing. Snow Gloves is an external product, excluded from both base profiles;
an optional external reference grants no enrollment or activation authority.

Public snapshots contain bounded capability and provenance metadata. Private
host bindings, project approvals, local data and owner authority stay separate.
Credentials, native sessions, prompt/response bodies and private memory do not
belong in release archives or public migration snapshots. Manifest-only export
is a local write through an owner-supplied export seam; it is not a machine-data
backup. Provider sign-ins remain owned by their authentication systems.

## Trusted manual bootstrap

Obtain `verify-migration-kit.sh` and its expected checksum through the reviewed
channel. Verify the script before executing it. Obtain the expected archive
digest independently too; the archive's adjacent digest sidecar is transport
information and cannot establish its own trust.

Verification requires stock macOS `/bin/bash` 3.2, `/usr/bin/perl` with
Digest::SHA, File::Path and Fcntl, `/usr/bin/gzip`, and `/usr/bin/shasum`.
Missing prerequisites hold before extraction. Git, Bun, Node, Python, Homebrew
and agent clients are not required to verify the archive. Minimal installation
additionally uses stock shell tools, `uname -s`/`uname -m`, and Perl JSON::PP.

```sh
/bin/bash ./verify-migration-kit.sh \
  --archive "temperance-engine-${VERSION}-arm64.tar.gz" \
  --expected-digest "sha256:${TRUSTED_ARCHIVE_SHA256}" \
  --extract-to "$HOME/temperance-kit"
```

The destination must be absent beneath an existing private, operator-controlled
parent. Even an empty existing destination is refused. The verifier snapshots the
archive and completes a streaming verification pass before creating payload
files. It validates raw POSIX ustar headers, checksums, canonical paths, entry
types, sizes, duplicates and exact bidirectional inner-manifest membership.
PAX/GNU extensions, links, special files, aliases and trailing nonzero data hold.
Limits are 500 MiB compressed, 200 MiB per member, 400 MiB payload, 20,000 headers,
440 MiB decompressed wire data, a 4 MiB manifest and 64 KiB trailing zero padding.

Publication uses exclusive file creation. It is not atomic directory publication:
an observer can see partial verified contents during copying. On failure, cleanup
targets only the created destination after checking its device/inode identity.
Changed or unobservable identity holds and preserves the path. Parent directories
must stay under operator control; path checks do not establish protection against
a hostile same-user process replacing ancestors.

### Pinned runtime

| Component | Exact pin |
|---|---|
| Bun | `1.3.5` |
| Official arm64 Bun ZIP SHA-256 | `db17588a4aea8804856825d4bead3f05e1f37276ca606f37e369b4f72f35d3fb` |
| Unpacked arm64 Bun SHA-256 | `66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3` |
| OpenTUI | `0.5.11` |
| AJV | `8.20.0` |
| TypeScript | `5.9.3` |
| Registry bun.lock SHA-256 | `65083b07d3b402c932dee70b01ac4495a462de73a0a525484da9591a57371387` |

Before invoking packaged JavaScript, verify the bundled runtime:

```sh
cd "$HOME/temperance-kit"
printf '%s  %s\n' \
  66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3 \
  toolchain/bun-1.3.5-arm64 | /usr/bin/shasum -a 256 -c -
./toolchain/bun-1.3.5-arm64 --version
```

Require checksum success and exact version `1.3.5`. Frozen dependencies accompany
the CLI; no implicit dependency download is part of bootstrap. An alternative is
the pinned official `bun-v1.3.5` arm64 ZIP: check its digest before unpacking with
`ditto -x -k`, then check the unpacked binary digest. Neither a remote shell
installer nor a Homebrew fallback belongs to this trust chain.

## Minimal generic installation

The common bootstrap command is identical for either intended destination profile:

```sh
sh install.sh --preserve-existing \
  --skip-voice --skip-claude --skip-codex --skip-opencode --skip-cursor \
  --skip-gsd --skip-manifest --skip-relay --dry-run
```

Inspect the plan, then remove `--dry-run` to perform that same minimal operation.
Portable-kit transport markers automatically enable preservation. Explicit
`--preserve-existing` also selects this mode in a source checkout.

This mode creates only absent generic `$HOME/AGENTS.md` and
`$CODEX_HOME/hooks/skill_cluster_resolver.mjs` files and required directories,
including the agents directory. It preserves existing destination leaves as they
are, including changed or identical files and links, without adopting their
contents or making redundant backups. Unsafe linked or nondirectory parents
hold; new leaves use exclusive creation. Source templates/resolver must be
regular single-link files, checked before and during copying; newly written bytes
and modes are verified. Concurrent or uncertain path changes may hold. It is not
an atomic multi-file installation or a universal filesystem-preservation promise.

All optional clients, voice, GSD, Manifest, spine and relay setup are skipped,
as is CodeGraph setup. `--force` and every requested `--with-*` activation hold
before this mode creates anything, even if another flag would later skip it.
Unsupported kit OS/CPU, missing or malformed kit provenance and every nonempty
`TEMPERANCE_PRIVATE_OVERLAY` request also hold before installer effects. Provenance
is compatibility metadata inside an already verified archive, not device identity
or owner authorization. An overlay schema change cannot bypass its hold.

Successful output says **minimal bootstrap complete**. It does not claim full
repository verification, either migration profile's execution, client setup,
authentication, service health or restoration. The resolver file can be installed
without a JavaScript runtime; installation does not prove that resolver execution
is available.

### Legacy source-checkout setup

Outside preservation/kit mode, the existing optional installer behavior remains.
OpenCode and Cursor default to installation, voice is automatic, and flags such
as `--with-claude`, `--with-codex`, `--with-gsd`, `--with-manifest`, `--with-spine`
and `--with-relay` select broader setup. Those paths can require upstream tools
and distinct owner decisions. Their flags do not select a modular Mac profile.

Legacy copy paths may overwrite and take timestamped backups; live operator
markers affect some copies unless force is requested. These semantics are not
the minimal mode's preserve-existing guarantee. A timestamped shell backup is
not the migration executor's transaction preimage or proof of a compatible
release/binding rollback. Recovery must identify the actual prior state and
ownership; never copy an arbitrary backup over current configuration on the basis
of this document alone.

## Modular interface and recovery

After verifying the release, invoke its compiled entry with the bundled runtime:

```sh
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --json
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --snapshot "$PUBLIC_SNAPSHOT" --json
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --tui
```

See [guided onboarding](../package/install-surface/docs/guided-onboarding.md) for
the ten sections and [agent operations](../package/install-surface/docs/agent-operations.md)
for the closed command grammar. The shipped migration CLI supplies no production
owner ports. An explicitly supplied public snapshot supports viewing; inspection,
export, comparison, planning and transactional recovery remain held without the
required trusted owner implementations. A path, reference, digest or confirmation
keystroke cannot create that authority. `request-sign-in` records a human handoff;
it does not start provider authentication.

Trusted integrations use the shared controller and existing lifecycle executor.
Planning needs independently pinned source context and fresh inputs. Execution
requires a fresh exact final review, authenticated operation and claim nonce,
owned steps, compatible bindings/generation and current destination/preimage
observations. The existing journal, receipt, prepared outputs and preimages remain
the recovery store; no UI or export manifest replaces them.

Applying again with the same transaction ID is held (`TRANSACTION_EXISTS` in the
executor); it does not create a second operation or imply successful repetition.
Status/resume reobserve the retained operation. Compatible rollback restores
authenticated prior configuration only when the original release, module-lock,
binding/configuration-generation and actual preimage facts still agree. Missing,
foreign or drifted evidence holds; unknown effects require owner reconciliation.

Terminal claim release is separately authorized. After original work-review
expiry, a new release-only context must bind the original plan/review/operation,
state namespace and independently observed terminal evidence. It permits release
of the owned claim, not renewed apply/resume authority. Public views distinguish
the current action/outcome/effect from historical terminal status. Backup
availability, last durable step and restoration verification stay UNKNOWN where
the owner API does not expose them. Cancellation and rollback do not reverse
external sign-ins. A killed process is not evidence that cleanup completed.

## Build and qualification evidence

Build from an explicitly approved committed source A with the exact toolchain
cache, frozen vendor directory and independently reviewed vendor-tree digest:

```sh
TOOLCHAIN_CACHE_DIR="$REVIEWED_CACHE" /bin/bash scripts/build-migration-kit.sh \
  --commit "$APPROVED_COMMIT" --vendor-dir "$REVIEWED_VENDOR" \
  --expected-vendor-digest "sha256:$REVIEWED_VENDOR_SHA256" \
  --out "$NEW_KIT_OUTPUT"
```

The output parent must already be operator-controlled. Output files are published
exclusively; the three-file release publication is not one atomic transaction.
`--dry-run` performs closure checks without writing output.

The vendor digest binds byte-sorted inventory rows: `sha256  MODE  relative-path`
plus LF for regular files, with executable mode normalized to `0755` and other
files to `0644`; `link  relative-target  relative-path` plus LF for contained
`.bin` aliases. Those aliases are omitted from the kit. Other links are refused.
Registry SRI alone does not authenticate an unpacked dependency directory.

The builder checks exact package/lock values, all 21 dependencies, manifest schema
and COPY hashes/modes against committed blobs, and a nonempty arm64 Mach-O native
asset bound to the reviewed vendor digest. It excludes private source/runtime
trees, VCS metadata and prior generated output. Five required public planning
inputs remain in the closure. Privacy scanning includes generated outputs and
vendored text; narrowly pinned upstream examples do not exempt adjacent content.

The earlier enrichment COPY blocker was resolved by the reviewed foundation
source reconciliation. `atlasRecall.ts` remains excluded as private source;
that resolution did not admit it. The final integrated release still requires a
new committed-source build and independent qualification. Do not refresh COPY
receipts blindly or reuse a foundation archive as final Task 7 evidence.

The accepted source uses the genuine split production build. Every emitted
`dist` chunk must accompany its entry point; the inner manifest and archive
cover all regular payload files. A single entry-point hash does not establish
module closure or absence of eager native loading.

| Evidence | What it establishes |
|---|---|
| `verify.sh` | Repository/install source checks and selected regression guards; includes Node-dependent checks |
| `scripts/verify-all.sh` | Broader source and shell suites, including controlled local mocks; not final kit or provider proof |
| Static compiler result | Type compatibility of the checked source; no harness/runtime effects |
| Compiled-entry checks | Behavior of the exact compiled entry and chunks under the stated test conditions |
| Archive verification | Outer digest, raw archive structure and complete inner byte inventory |
| Final artifact/runtime qualification | Actual newly extracted installer, ownerless CLI, paired fictional SDK/OS-IO cases and current TUI/PTY cases under separately reviewed boundaries |
| Physical acceptance | Actual destination, identity, access, cold boot, recovery, backup/restore and owner-operated checks |

Record source A, its tree and full source/build/dependency identities, then the
new outer archive hash. Independently retained qualification receipt B refers to
that immutable archive. A later receipt/ISA acceptance commit may qualify A
without rebuilding solely to embed its own claim. If a source correction is
needed, review and commit it, then create and qualify a new artifact. Never patch
the extracted trusted kit in place.

Final Task 7 cases remain pending final source and immutable-artifact
admission. Required evidence includes real minimal bootstrap/repeat/refusal,
ownerless compiled CLI, both fictional profile plans with actual owned temporary
IO/recovery/rollback/release, current compiled TUI/PTY behavior, and final integrity
review. These cases do not establish production-owner, provider or physical proof.

### Accepted Task 6 evidence and its limits

The accepted source regression passed 1,270 tests with one explicit opt-in live-Mac
skip, zero failures and 27,432 assertions across 68 files; source and strict
owned-test TypeScript checks also passed. The retained disposable runtime used
the actual split production build. These records precede final kit construction
and must not be relabeled as tests of the future immutable archive.

Four actual compiled OpenTUI cases covered both base profiles at 80×24 and 120×40:
all ten sections, six Will-role rows, search, focus, held-owner presentation,
Help/back, logical detail anchors across resize, and Recovery. Complete Review
projections, digests, effects, rollback and Review navigation are separately
covered by source/TestRenderer tests. The actual cases opened the Filter menu
and returned; individual filter choices have source-test coverage. A separate
missing-native-asset case exercised the fixed fallback and headless parity.

For those five graceful/native cases, original pre-child terminal identities
were joined to named-path and fresh read-only descriptor observations. Exact
220-byte modes and positive dimensions matched before the observed descriptors
closed and output drained. The descriptor-attached PTY fixtures used `setsid`
without fixture-requested controlling-terminal acquisition. Explicit Ctrl-C
bytes and resize signals do not establish kernel-generated Ctrl-C, job control,
persistent-shell behavior, absence of later application controlling-terminal
acquisition, or native internals. Same-device reobservation does not establish
old-open-description continuity, zero OS-open effects, application-only causation
or protection against hostile path/device replacement.

Two separate synthetic-owner hard-close cases, one per profile, closed an owned
terminal connection after an actual exclusive rename, awaited cancellation and
retained incomplete/INTERRUPTED state without a commit-step or completed receipt.
A distinct process reopened the same operation and reproduced the retained state,
preserving owned destination/preimage bytes and foreign custody/sentinel modes.
Closed-channel terminal state is unavailable; restoration is not claimed. These
are temporary-root recovery observations, not power-loss durability, production
owner enrollment or physical migration proof. Earlier HOLD records remain
historical evidence. Final Task 7 must qualify its own admitted immutable artifact.

## Physical acceptance remains pending

Workstation replacement and always-on-node addition each require an actual
owner-reviewed destination packet. Target/access authority, device identity,
FileVault and login/cold-boot recovery, network/power loss, callback behavior,
backup destination, restoration and capacity/role constraints need their own
evidence. None is supplied by selecting a profile, compiling source or opening
the interface. Keep the prior machine recoverable until the owner accepts the
destination. This document invents no target, credential, backup or physical
acceptance receipt.
