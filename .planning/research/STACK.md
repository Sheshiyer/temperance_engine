# Stack Research

**Domain:** Downloadable, local-first installer and lifecycle manager for an AI operator runtime
**Researched:** 2026-08-19
**Confidence:** HIGH

## Recommendation in One Sentence

Keep the public shell entrypoints, put the new manifest, checksum, transaction, doctor, rollback, and uninstall logic in one dependency-free TypeScript lifecycle core run by a pinned Bun release, and qualify the same core on explicit macOS and Linux runner images using each platform's native service manager.

This milestone does **not** need another installer framework, configuration language, database, templating engine, or checksum package. The hard problem is one authoritative inventory and transaction model, not package acquisition.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | **1.3.14**, pinned for v1.1 qualification | Execute the TypeScript lifecycle core and its tests | Bun is already required by repository hooks and local services, runs TypeScript directly, provides a test runner, and supports macOS arm64/x64 plus Linux arm64/x64. Pinning the current stable release removes a moving variable from install and release receipts without introducing a second application runtime. |
| POSIX shell | POSIX `sh`; host-provided | Thin `install.sh`/`uninstall.sh` bootstrap, argument forwarding, and clear prerequisite failure | A public download must be able to explain a missing Bun runtime before TypeScript starts. Keep shell limited to platform detection and invocation; move inventory parsing, path safety, hashing, backup bookkeeping, and mutation ordering out of the current distributed shell scripts. |
| JSON install-surface manifest | Product contract `schemaVersion: 1`; JSON Schema **Draft 2020-12** vocabulary | Versioned source-to-destination provenance and lifecycle policy | JSON is already parsed by Bun/Node and by current repository tooling. A schema-version field is independent of the Temperance release version, permitting explicit migrations and fail-closed handling of unknown manifest generations. Draft 2020-12 is the current published JSON Schema draft. |
| TypeScript lifecycle core | Repository source; executed by Bun 1.3.14 | One implementation for `plan`, `install`, `update`, `doctor`, `verify`, `rollback`, and `uninstall` | A single typed core prevents the inventories in `install.sh`, doctor, verification, and uninstall from drifting. It can enforce constraints JSON Schema cannot express conveniently: unique destinations after variable expansion, platform eligibility, source containment, managed-block ownership, reverse rollback order, and mutually exclusive lifecycle classes. |
| SHA-256 via `node:crypto` | Bun's Node-compatible built-in API | File, directory, manifest, backup, and receipt digests | `createHash("sha256")` is portable across the two target operating systems and avoids branching between macOS `shasum` and Linux `sha256sum`. No checksum npm package or GNU coreutils dependency is needed. |
| GitHub Actions hosted runners | `macos-15`, `macos-15-intel`, `ubuntu-24.04` | Clean-VM release qualification | GitHub documents that hosted jobs receive fresh runner instances. `macos-15` is currently Apple Silicon and `macos-15-intel` covers the second supported Bun architecture; both should block v1.1. `ubuntu-24.04` should run the same lifecycle fixtures and Linux service checks as a visible but non-release-blocking compatibility job. Explicit labels avoid surprise migration from `*-latest`. |
| launchd LaunchAgents | Host macOS version | Per-user macOS service lifecycle | Temperance services are user-scoped and loopback-only, matching Apple's LaunchAgent model. Store templates in the product and render host paths at install time; validate with `plutil -lint`, then exercise `launchctl bootstrap`, `kickstart`, `print`, and `bootout` in the macOS release lane. |
| systemd units | Ubuntu 24.04 runner version | Best-effort Linux service lifecycle | Preserve the existing hardened unit approach, but make it another manifest-selected service template. Validate it with `systemd-analyze verify`; only run live `systemctl` probes when the test environment actually has systemd as the service manager. |

### Supporting Libraries

No new production npm dependency is recommended for the lifecycle path.

| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `node:fs` / `node:fs/promises` | Built into Bun 1.3.14 | Byte reads, `lstat`, permissions, same-directory temporary writes, rename, and directory walking | All install mutations and inventory reads. Write a temporary file beside its destination, set mode, then rename; never edit a managed target in place. |
| `node:path` | Built into Bun 1.3.14 | Normalization, containment checks, and platform-safe path construction | Expand only an allowlist of manifest roots such as `${HOME}`, `${CODEX_HOME}`, and `${TEMPERANCE_STATE_DIR}`; reject absolute source paths, `..` escapes, NUL bytes, and unresolved variables before planning mutations. |
| `node:crypto` | Built into Bun 1.3.14 | SHA-256 digests | Hash raw file bytes and canonical inventory records. Directory provenance should be a sorted JSON list of `{type,path,sha256,executable}` records, with symlink targets represented explicitly and timestamps/UIDs excluded. |
| `node:child_process` | Built into Bun 1.3.14 | Invoke platform service and validation commands without shell interpolation | Call `plutil`, `launchctl`, and `systemd-analyze` with argument arrays. Capture exit status and redacted output in receipts; never construct a command string from a manifest path. |
| `bun:test` | 1.3.14 | Contract, fixture, property-edge, and transaction tests | Test manifest rejection, path containment, deterministic digests, idempotent install, interrupted update recovery, rollback drift refusal, reverse-order uninstall, and platform selection. |

### Development and Release Tools

| Tool | Version / Surface | Purpose | Notes |
|------|-------------------|---------|-------|
| ShellCheck | **0.11.0** | Static analysis for retained `sh` and `bash` entrypoints | Pin the version in CI. Check POSIX launchers as `sh`; check platform service wrappers using their declared Bash dialect. Do not require ShellCheck on end-user machines. |
| `plutil` | macOS host tool | Validate rendered LaunchAgent property lists | Run both fixture rendering and `plutil -lint` before any `launchctl` mutation. Its absence is a macOS doctor failure, not an npm-install opportunity. |
| `systemd-analyze verify` | Ubuntu host tool | Validate Linux unit syntax and executable references | Run on rendered fixtures in the Linux job. Keep live service activation separate because GitHub-hosted Linux jobs do not promise a booted user/system manager suitable for every unit test. |
| Git | Host tool; current GitHub runner release | Produce source-faithful release archives | Build a tagged artifact from a commit/tag with `git archive --prefix=temperance-engine-vX.Y.Z/ <tag>`, never from a dirty worktree. Git documents that commit archives use the recorded commit time and embed the commit ID. Generate the archive twice in CI and require identical SHA-256 digests. |
| GitHub Actions | `actions/checkout@v6`, `oven-sh/setup-bun@v2`; pin full commit SHAs | Reproducible qualification workflow | The major versions are current in official examples. In the actual workflow, resolve each action tag to a reviewed full-length commit SHA and annotate the tag in a comment; GitHub identifies the full SHA as the immutable action reference. |
| Existing repository verifier | `./scripts/verify-all.sh` | Canonical release gate | Add lifecycle and clean-host suites beneath this existing authority. Do not create a competing top-level verifier. |

## Required Integration Shape

### 1. One Manifest, One Executable Contract

Recommended source boundary:

```text
package/install/
├── install-surface-manifest.json
├── install-surface-manifest.schema.json
├── contract.ts          # strict parse + semantic validation
├── paths.ts             # allowlisted root expansion + containment
├── inventory.ts         # manifest selection by platform/options
├── digest.ts            # canonical SHA-256 records
├── transaction.ts       # plan/apply/receipt/recover
├── managed-block.ts     # exact-marker merge and conflict checks
└── services.ts          # render/validate/start/stop adapters

package/services/
├── launchd/*.plist.template
└── systemd/*.service.template
```

The exact filenames may change, but the boundary should remain: pure manifest/transaction code must not import router, Manifest Bridge, UI, or private OmniRoute state.

The manifest should contain declarative facts only: stable ID, repository-relative source, destination-root token plus relative destination, lifecycle class (`copy`, `transform`, `regenerate`, `never-ship`), mutability, platforms, optionality, verification method, service ownership, and rollback action. It must not contain a developer home path, live port discovery, credentials, backup paths, or a snapshot of installed state.

Use a checked-in Draft 2020-12 schema for editor/CI interoperability, but make the dependency-free TypeScript semantic validator the runtime gate. A small fixed contract needs custom safety checks anyway; adding a general schema library would still leave path expansion, destination collision, and rollback-policy checks to custom code. Positive and negative fixtures should exercise both the structural schema and the semantic validator during CI.

### 2. Thin Existing Entry Points

Integration points:

| Existing surface | v1.1 role |
|------------------|-----------|
| `install.sh` | Parse only bootstrap flags, verify supported OS and Bun 1.3.14, then invoke lifecycle `plan`/`install`. Keep `--dry-run` as a no-write plan. |
| `uninstall.sh` | Invoke lifecycle `uninstall` against an installed transaction receipt; remove only owned bytes or managed blocks, in reverse dependency order. |
| `scripts/temperance-doctor.sh` | Preserve its user-facing command, but consume lifecycle `doctor --json` results for manifest provenance and platform/service status. |
| `verify.sh` and `scripts/verify-all.sh` | Call manifest validation, deterministic checksum tests, private-path/never-ship scans, and the existing regression suite. |
| `tests/sandbox-install.sh` | Retain the throwaway-home concept; replace hand-maintained landing lists with expected inventory selected from the manifest. Add update, rollback, and uninstall round trips. |
| Existing service scripts | Become small platform adapters over rendered templates and transaction receipts; they must not retain separate copy inventories. |

### 3. Transaction and Receipt Format

Use ordinary mode-`0600` JSON receipts in `${TEMPERANCE_STATE_DIR}/receipts/`, written atomically. Do not use SQLite. Each receipt should record:

- lifecycle/tool version, manifest schema version, release/tag/commit, platform and architecture;
- selected surface IDs and expanded destinations, without secret values;
- prior state (`absent`, `file`, `directory`, `symlink`, or managed block), backup reference, and prior digest;
- applied digest and ownership marker;
- service stop/start order and health result;
- operation status (`planned`, `applying`, `applied`, `rolling-back`, `rolled-back`, `failed`) and failure boundary.

Rollback and uninstall must compare current bytes to the receipt's applied digest before mutation. Drift means fail closed and report the exact surface ID; `--force` must not silently erase an operator edit. A failed install should replay completed receipt steps in reverse order.

### 4. Deterministic Checksum Rules

Use one implementation everywhere:

1. Walk only manifest-declared source entries.
2. Normalize recorded paths to repository-relative `/` separators.
3. Sort by UTF-8 byte order, not locale.
4. Hash file bytes; record only the executable bit rather than full host-specific mode bits.
5. Represent symlinks as `{type:"symlink", path, target}` and reject links that escape the declared product root.
6. Serialize records with a fixed property order and a final newline; hash those bytes with SHA-256.
7. Exclude timestamps, ownership, backup/runtime directories, logs, lockfiles generated during install, `.DS_Store`, and all NEVER-SHIP entries.

The release checksum file, manifest-source digest, installed-tree digest, and doctor comparison must call this same module. Do not implement parallel `shasum` and `sha256sum` code paths.

### 5. Service Template Rendering

Use a deliberately tiny renderer in the lifecycle core: exact allowlisted tokens, XML escaping for plist values, systemd specifier/quoting rules for unit values, and an error for every unknown or unexpanded token. Do not use `eval`, shell heredocs containing runtime values, or `envsubst`.

macOS is release-blocking:

- Render user LaunchAgents under a synthetic HOME and lint every plist.
- On `macos-15` arm64 and `macos-15-intel`, run install → bootstrap → health → update → rollback → health → uninstall → absence checks for required services.
- Exercise a separate no-voice path; voice remains optional and its absence must be an explicit skip.
- Assert loopback binding and that uninstall affects only labels and files recorded by the receipt.

Linux is best-effort:

- Run the same manifest, digest, transaction, managed-block, empty-HOME, and uninstall fixtures on `ubuntu-24.04`.
- Render Linux units and require `systemd-analyze verify` when available.
- Keep the Linux job visible and allowed to fail without making its individual assertions permissive. The release workflow should simply not depend on that job for v1.1.
- Skip launchd and voice explicitly; do not emulate them.

### 6. Clean-Host and Release Matrix

| Lane | Architecture | Release effect | Required probes |
|------|--------------|----------------|-----------------|
| `macos-15` | arm64 | **Blocking** | clean checkout, pinned Bun, empty HOME install, service lifecycle, update/rollback, doctor, uninstall, full verifier, artifact reproducibility |
| `macos-15-intel` | x64 | **Blocking** | same contract; confirms Intel Bun and path/service behavior |
| `ubuntu-24.04` | x64 | Advisory for v1.1 | empty HOME/no-voice install, manifest selection, checksum equality, unit validation, rollback/uninstall, full non-service regression |
| Optional `ubuntu-24.04-arm` | arm64 | Advisory | add only after the x64 lane is stable; it is not needed to prove v1.1 macOS readiness |

GitHub's VM is fresh, but its tool image is not minimal. Therefore each job must also set a synthetic HOME, use an explicit PATH for product prerequisites, assert the preflight dependency list, disable network after checkout/tool setup where feasible, and fail if any repository file contains a developer home or mounted-volume prefix. Never seed fixtures from the release engineer's workstation.

## Installation / Dependency Policy

There is no new production package install for the lifecycle layer:

```bash
# Required runtime, pinned by the release workflow and documented prerequisite
bun --version       # expected: 1.3.14 for v1.1 qualification
bun --revision      # record in the qualification receipt

# Lifecycle/core tests use built-ins only
bun test package/install tests/install-lifecycle.test.ts

# CI-only shell portability check
shellcheck --version  # pin 0.11.0 in CI
```

Do not add a root `npm install`/`bun install` step solely for lifecycle code. Existing nested applications keep their own lockfiles and dependency boundaries; the installer must not cause Bun's auto-install mode to fetch undeclared packages on a clean host.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Dependency-free Bun/TypeScript lifecycle core | Expand shell scripts and parse JSON with `jq` | Only for emergency maintenance of an already shell-only subcommand. It should not own new lifecycle inventory or transactions. |
| JSON manifest with `schemaVersion` | YAML or TOML manifest | Only if human-authored complexity later exceeds JSON's utility and a parser is already an unavoidable product dependency. That is not true for the small v1 contract. |
| Internal strict validator plus checked-in JSON Schema | Ajv/Zod runtime dependency | Add a validator library only if the contract grows into recursive, plugin-defined schemas whose validation cost exceeds the release/offline dependency cost. Path and rollback semantics will still require custom checks. |
| Native launchd and systemd templates | Cross-platform process supervisor | Use a supervisor only if the product later supports many service-manager-less platforms. v1.1 has one primary and one best-effort platform with established native managers. |
| Atomic JSON transaction receipts | SQLite installation database | Use a database only when concurrent writers or high-volume query requirements appear. Lifecycle operations should instead take one filesystem lock and produce auditable immutable receipts. |
| GitHub-hosted fresh VMs plus synthetic HOME | Docker-only clean-host tests | Containers are useful for Linux unit fixtures, but cannot qualify macOS LaunchAgents or reproduce the host service boundary. |
| Tagged `git archive` plus SHA-256 | Custom tar library or release bundler | Add a packager only when shipping compiled, signed, multi-artifact binaries. v1.1 distributes repository program material. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| A second lifecycle inventory in shell, doctor, or uninstall | It recreates the exact source/runtime archaeology this milestone is meant to eliminate. | One manifest selector and transaction core called by every command. |
| Homebrew formula, `.pkg`, Nix, or a curl-pipe installer in v1.1 | Each creates another ownership/update/uninstall contract before the canonical contract is proven. A curl-pipe path also weakens reviewability. | Download/clone a tagged immutable release, inspect it, verify its SHA-256, then run the repository entrypoint. |
| Handlebars, Mustache, EJS, or `envsubst` | Service files need a handful of typed tokens; general interpolation expands the injection and unresolved-variable surface. | A strict allowlist renderer with format-aware escaping. |
| `rsync`, GNU `sha256sum`, or GNU coreutils as macOS prerequisites | They are absent from stock macOS or diverge from BSD behavior, undermining clean-host qualification. | Bun filesystem APIs and `node:crypto`. |
| `jq` as a new lifecycle prerequisite | The new core already parses JSON. Requiring another binary makes bootstrap and macOS/Linux parity harder. | `JSON.parse` plus strict semantic validation. Existing optional scripts may retain their declared `jq` preflight until migrated. |
| Bash 5 as a product prerequisite | Stock macOS ships a different Bash line; requiring a package-manager shell makes the public installer less local and reproducible. | POSIX `sh` bootstrap plus Bun core; retained Bash scripts must remain compatible with their declared host lane. |
| Docker, devcontainers, or Nix as the macOS release proof | None exercises `~/Library/LaunchAgents`, the user bootstrap domain, or real macOS path/tool behavior. | Native `macos-15` and `macos-15-intel` hosted VMs. |
| SQLite or a network service for installed inventory | Lifecycle state is small, single-writer, and must remain inspectable during recovery. | Atomic mode-`0600` JSON receipts plus a filesystem lock. |
| Background auto-update daemon | It introduces network, trust, concurrency, and rollback authority beyond the v1.1 goal. | Explicit `update` command that plans, backs up, applies, verifies, and emits a receipt. |
| Copying a live plist/unit/config into the product | It captures host paths, ports, state, and possibly secrets. | Public templates plus manifest declarations and regenerated host values. |
| Checksums as a substitute for release immutability | A checksum published beside a mutable artifact does not prevent both from changing. | Immutable release/tag settings, reviewed action SHAs, tagged archive, and published SHA-256. Consider attestations/signing only as a separately scoped hardening phase. |
| Canary runtimes or floating `macos-latest`/`ubuntu-latest` labels | They move without a product change and can invalidate qualification evidence. | Exact Bun release and explicit runner labels. |

## Stack Patterns by Variant

**For the v1.1 macOS product path:**

- Require Bun 1.3.14 and native LaunchAgents.
- Gate release on both Apple Silicon and Intel macOS 15 jobs.
- Treat voice, external provider authority, and private memory as optional or NEVER-SHIP.
- Generate services and host state; never copy them from the reference Mac.

**For best-effort Linux:**

- Use the identical manifest parser, digest algorithm, receipts, and lifecycle commands.
- Select only entries declaring Linux support.
- Render systemd units and verify them on Ubuntu 24.04.
- Report unsupported macOS/voice surfaces as explicit skips, not missing files or silent success.

**For a service-disabled host or CI fixture:**

- Run install/update/doctor/rollback/uninstall against a synthetic HOME and state root.
- Render and lint service definitions without loading them.
- Require all non-service provenance and ownership checks to pass.

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| Bun 1.3.14 | macOS 13+ arm64/x64; Linux arm64/x64 | Bun's current installation docs state macOS 13+ and publish binaries for these architectures. Record both `bun --version` and `bun --revision` in release evidence. |
| Lifecycle TypeScript core | Bun 1.3.14 | Use Node-compatible built-ins only. Do not import Manifest Zone, Manifest Bridge's `pg` dependency, or headless package dependencies. |
| Install manifest schema v1 | Lifecycle tool v1.1 | Unknown schema versions fail before planning. Future tooling may read older receipts, but v1.1 must not guess how to apply a newer manifest. |
| JSON Schema Draft 2020-12 | Checked-in structural schema | Keep product `schemaVersion` separate from `$schema`; the former controls lifecycle compatibility. |
| Existing headless package | Node `>=22 <23` | Leave this current package boundary unchanged. Node 22 is not a new requirement for the lifecycle CLI, and the milestone should not consolidate unrelated runtimes. |
| `macos-15` | GitHub-hosted M1 arm64 runner | Primary release lane as documented by GitHub on the research date. |
| `macos-15-intel` | GitHub-hosted Intel runner | Secondary release-blocking architecture lane. |
| `ubuntu-24.04` | GitHub-hosted Linux x64 runner | Best-effort lane; use runner-provided systemd tooling and report its version in receipts rather than hard-coding a distro package version. |
| ShellCheck 0.11.0 | POSIX `sh` and repository Bash scripts | CI-only; pin it so a new warning release does not unexpectedly redefine the release gate. |

## Sources

- [Bun installation documentation](https://bun.sh/docs/installation) — verified current stable Bun 1.3.14, exact-version installation support, `bun --revision`, supported macOS/Linux architectures, and macOS 13+ requirement. **HIGH confidence**.
- [Bun package installation and CI documentation](https://bun.sh/docs/pm/cli/install) — verified official `oven-sh/setup-bun@v2`, frozen-lockfile guidance, and cross-platform lockfile behavior. **HIGH confidence**.
- [Bun auto-install documentation](https://bun.sh/docs/runtime/auto-install) — verified why lifecycle scripts must not contain undeclared package imports that trigger network resolution on a clean host. **HIGH confidence**.
- [Node.js Crypto API](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) — verified built-in SHA-256 hashing through `createHash`. Bun's Node compatibility is already exercised by this repository; qualification remains the product proof. **HIGH confidence for API, MEDIUM for complete Bun parity until CI passes**.
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) — verified published draft, metaschema, and specification date. **HIGH confidence**.
- [GitHub Actions runner selection](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job) — verified fresh-instance behavior and current `macos-15` arm64, `macos-15-intel`, and `ubuntu-24.04` labels. **HIGH confidence**.
- [GitHub custom action version guidance](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions) — verified that a full commit SHA is the immutable action reference. **HIGH confidence**.
- [GitHub build-system security guidance](https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-builds) — verified immutable release and workflow hardening recommendations. **HIGH confidence**.
- [Git `archive` documentation](https://git-scm.com/docs/git-archive) — verified commit/tag archive timestamps and embedded commit identity. **HIGH confidence**.
- [Apple Daemons and Services Programming Guide](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/) and [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — verified user LaunchAgent versus system daemon boundaries and per-user launch lifecycle. The guide is archived, so current host `launchd.plist(5)`, `launchctl(1)`, and `plutil(1)` man pages must remain the implementation authority. **MEDIUM-HIGH confidence**.
- [systemd upstream `systemd-analyze` source/help](https://github.com/systemd/systemd/blob/main/src/analyze/analyze.c) and [systemd manual](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html) — verified `verify` as the unit-file correctness check. **HIGH confidence**.
- [ShellCheck v0.11.0 release](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0) — verified latest stable version and macOS/Linux arm64/x64 binaries. **HIGH confidence**.

## Confidence Notes and Open Validation Items

- **HIGH:** The dependency-light lifecycle approach fits the repository's existing Bun/TypeScript, shell, receipt, SHA-256, sandbox, and native-service patterns without changing the validated router/runtime design.
- **HIGH:** Current runtime, CI action major versions, and runner labels were verified from official sources on 2026-08-19.
- **MEDIUM until phase execution:** Whether every required `launchctl` operation is permitted on both GitHub-hosted macOS runner variants must be proved with a spike. If service loading is runner-restricted, keep plist rendering/linting in hosted CI and add an ephemeral clean macOS release runner; do not weaken the release criterion or replace it with Docker.
- **MEDIUM until schema design:** The precise v1 manifest fields and managed-block grammar need phase-level threat modeling and negative fixtures. The recommended technologies do not depend on those naming decisions.

---
*Stack research for: v1.1 Public Temperance Glove*
*Researched: 2026-08-19*
