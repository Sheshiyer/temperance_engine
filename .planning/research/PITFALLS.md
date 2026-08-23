# Pitfalls Research

**Domain:** Public packaging and lifecycle management for an existing local-first operator system
**Project:** Temperance Engine v1.1 Public Temperance Glove
**Researched:** 2026-08-19
**Confidence:** HIGH — conclusions are grounded in the current repository, the ratified audit, an executed verifier, and primary platform specifications

## Critical Pitfalls

### Pitfall 1: Building on an unreconciled or moving baseline

**What goes wrong:**
Lifecycle work encodes the wrong authority, or a later phase quietly treats an audit snapshot as current truth. The ratified audit describes `main` at `32f1dab` and an unfinished 58-file wave; the inspected checkout is now at `dcc3720` with 86 dirty entries (57 tracked changes/deletions and 29 untracked entries). A manifest generated from one snapshot while installers or docs come from another will be internally consistent but false.

**Why it happens:**
The repository already has several planning and runtime authorities (`ISA.md`, `.planning`, design plans, installed host copies). It is tempting to start Stage A by scraping the live workstation or current dirty tree before Intake records exactly which commit and approved exceptions define the milestone baseline.

**How to avoid:**
At Intake, record the exact commit, `git status --porcelain=v1 -z` digest, active milestone, locked exclusions, platform promise, and atlasRecall decision. Treat the audit as evidence, not an automatically refreshed inventory. Stage A must consume the ratified baseline receipt. If the baseline changes, regenerate and review the receipt rather than silently updating counts.

**Warning signs:**

```bash
git rev-parse HEAD
git status --short
git diff --cached --name-only
```

- Audit counts or commit IDs disagree with the checkout.
- A generated manifest contains untracked files with no explicit approval.
- Stage names or phase numbers are inferred rather than assigned by milestone intake.

**Phase to address:**
Intake (blocking); recheck at Stage F.

---

### Pitfall 2: Turning the reference workstation into the distributable payload

**What goes wrong:**
Private OmniRoute environment files, OAuth/session state, SQLite/WAL data, logs, histories, receipts, backups, PAI memory, personal identity, voice packs, or provider credentials enter a release or seed a fresh install. A blacklist catches familiar names but misses renamed databases, new providers, symlink targets, or private data placed under an otherwise public-looking directory.

**Why it happens:**
The Mac mini is a working reference installation and contains capabilities not yet in the repository. Copying `~/.temperance_engine`, `~/.omniroute`, `~/.claude`, or an installed subtree appears to be the fastest way to converge source. `.gitignore` and the current grep-based secret/path checks can be mistaken for payload boundaries; they are not.

**How to avoid:**
Make repository source the only positive payload allowlist. Stage A assigns every entry exactly one class (`copy`, `transform`, `regenerate`, or `never-ship`) and an owner. Stage B imports individual reviewed capabilities, never home-directory trees. Release packaging must start from a named Git tree (`git archive` or a clean clone), then run filename, file-type, symlink-target, secret, database-signature, and private-path scans on the resulting artifact. Add negative fixtures named like `.env`, OAuth stores, SQLite/WAL/SHM files, histories, receipts, backups, and credential exports and assert that packaging refuses them even when nested or renamed.

**Warning signs:**

- `cp -R`, `rsync`, or archive commands have a source under a live home directory.
- The manifest contains a wildcard directory rather than enumerated public files.
- A release artifact contains `.env*`, `*.sqlite*`, `*-wal`, `*-shm`, `logs/`, `receipts/`, `backups/`, or a symlink escaping the artifact root.
- A clean-host test needs access to the developer's home, Keychain, mounted volume, or provider session.

**Phase to address:**
Stage A (classification), Stage B (source convergence), and Stage F (artifact scan).

---

### Pitfall 3: Either shipping or accidentally deleting the private `atlasRecall` overlay

**What goes wrong:**
`atlasRecall.ts` is promoted into `package/enrich` and leaks personal-memory coupling, or an enrichment refresh deletes the installed live-only stage before its private overlay status is made explicit. Both outcomes violate the locked v1.1 scope: atlasRecall is not public product behavior.

**Why it happens:**
Installed enrichment and repository enrichment currently drift. Existing refresh paths replace whole trees (`rm -rf`/`cp -R` or staged replacement), while non-deleting sync paths can retain unowned extras. Without a separate overlay mount, “make source and runtime match” has two unsafe interpretations.

**How to avoid:**
Keep atlasRecall absent from the public source manifest and release artifact. If the operator still needs it, define a separately configured private-overlay directory outside the immutable product/install tree; load it only when explicitly enabled, and report it as `private-overlay: present|absent` without hashing or copying its contents into public receipts. Stage B tests must prove both boundaries: public refresh does not ingest the overlay, and public refresh does not traverse/delete the separate overlay. Do not add generic fixtures or promotion language in v1.1; that is a later milestone decision.

**Warning signs:**

```bash
find package . -path '*/node_modules' -prune -o -name 'atlasRecall.ts' -print
git archive HEAD | tar -tf - | grep -F 'atlasRecall' && exit 1 || true
```

- atlasRecall appears under `package/`, skills, templates, test fixtures, generated docs, or a release archive.
- An installer “converges” the enrichment directory with `--delete` or `rm -rf` while the overlay still lives below that directory.
- Doctor reports it as an immutable product checksum instead of a private optional overlay.

**Phase to address:**
Stage B (blocking source/overlay separation); verify again in Stages E and F.

---

### Pitfall 4: Fixing the current path guard by weakening it instead of defining path policy

**What goes wrong:**
`verify.sh` stays permanently red, or it turns green because broad directories/tests/history were excluded while executable install sources still contain workstation paths. The current run exits 1 with `private local path found in public/install surface`; matches include real runtime constants, tests, historical plans, `ISA.md`, `.planning/NEXT-WAVE.json`, generated/node_modules content, and the audit itself. A single undifferentiated grep cannot tell unsafe runtime literals from historical evidence or synthetic fixtures.

**Why it happens:**
The guard scans nearly the whole public repository for `/Users/`, `<PROJECT_VOLUME>`, and `<SESSION_STORE>`. It has no file-role taxonomy, no fixture convention, and no generated-directory pruning. Developers then face pressure either to redact valuable historical records or add ever broader exclusions.

**How to avoid:**
Stage A defines path-policy scopes:

- **Zero-tolerance executable payload:** installer, updater, lifecycle library, service templates, runtime source, and shipped config templates contain no personal absolute path.
- **Parameterized tests:** use `mktemp`, `$HOME`, and explicit synthetic identities rather than the real username or volume.
- **Historical/decision evidence:** retain only when necessary, mark non-payload, and keep it out of the release artifact when appropriate.
- **Generated/vendor trees:** exclude by declared provenance, not opportunistic grep filters.

Replace the one-bit guard with output that lists `path`, `role`, `pattern`, and disposition. Add `/home/<user>`, alternate mount roots, URI/file references, plist/unit values, and symlink targets. Stage B is not complete until the scoped runtime/payload guard passes and the remaining historical exceptions are explicit and reviewable.

**Warning signs:**

```bash
./verify.sh                       # currently exits 1
grep -R -n -I -F -e '/Users/' -e '<PROJECT_VOLUME>' \
  scripts package templates install.sh uninstall.sh verify.sh
```

- The guard prints only a generic failure, not offending paths.
- `node_modules` or generated files influence the result.
- A suppression is directory-wide rather than tied to a classified non-payload file.
- Runtime code still defines `<OPERATOR_HOME>/...` constants after the guard is declared fixed.

**Phase to address:**
Stage A (policy), Stage B (repair and green guard), Stage F (artifact-only rerun).

---

### Pitfall 5: Keeping partial and overlapping install inventories

**What goes wrong:**
Install, update, doctor, verify, rollback, and uninstall disagree about what Temperance owns. One path upgrades a hook while another preserves or overwrites it; stale files survive; uninstall removes only a subset; provenance reports a healthy partial installation.

**Why it happens:**
The current top-level install calls several independent installers and then `wire-multi-backend.sh`. With spine enabled, Codex/Claude hooks can be copied by `install-spine.sh` and copied again later by `wire-multi-backend.sh`; enrichment is managed by both `install-pai.sh` and the wiring script; router state is copied with `rsync -a` without `--delete`; `verify-install.sh` maintains a separate hand-written `check_file` list; `uninstall.sh` consumes none of them.

**How to avoid:**
Stage A establishes one versioned manifest with unique IDs and exclusive destination ownership. Schema validation rejects duplicate destinations, overlapping directory/file ownership, missing rollback strategy, and unclassified discovered writes. Instrument a sandbox install to record every filesystem mutation and compare the mutation set to the manifest; fail on both extra writes and declared-but-unobserved required entries. Stage C routes install/update/doctor/verify/rollback/uninstall through the same resolved inventory and transaction ID. Compatibility wrappers may call the lifecycle engine, but must not carry their own lists.

**Warning signs:**

- The same destination appears in two scripts or two manifest entries.
- `verify-install.sh` grows another `check_file` line without a manifest change.
- `rsync`/copy succeeds while removed source files remain installed.
- Doctor says healthy although uninstall cannot name the same entry.
- Reinstall creates multiple backups for the same destination in one run.

**Phase to address:**
Stage A (single inventory contract), Stage C (all lifecycle consumers).

---

### Pitfall 6: Symlink, hardlink, and path-traversal writes escape managed roots

**What goes wrong:**
A crafted or merely pre-existing destination symlink causes install/config/permission operations to modify a file outside the managed root. A dangling symlink is treated as absent. A hardlinked config causes an in-place rewrite or chmod to affect another pathname. `..`, absolute source paths, token expansion, or a symlinked parent escapes the repository/home allowlist. Recursive removal follows an insufficiently validated target.

**Why it happens:**
Current `scripts/lib.sh` uses `test -e` (which misses dangling symlinks), plain `cp source destination`, and `mkdir -p` on destination parents. `wire-multi-backend.sh` has its own link behavior and records prior self-referential-link regressions. Shell pathname checks performed once are vulnerable to parent swaps between validation and mutation.

**How to avoid:**
In Stage A, manifest source paths must be normalized repository-relative paths; destination templates must resolve under an entry-specific allowlisted root after expansion. Reject empty components, `.`/`..`, NUL, unexpected absolute paths, and ambiguous `//`. In Stage C:

1. `lstat` every existing component; distinguish absent, dangling symlink, regular file, directory, symlink, and special file.
2. Reject symlinked parents and final symlinks for copy/transform/config entries unless the entry explicitly owns a symlink and its literal target is validated.
3. Refuse special files and managed config files with link count greater than one.
4. Stage new bytes beside the target, set mode, fsync where available, revalidate parent device/inode, then atomically rename.
5. Before recursive removal, prove the exact normalized target is a manifest-owned directory, is not a root/home/workspace root, and has the expected marker or receipt identity.

Add adversarial fixtures for destination symlink to an external sentinel, dangling link, symlinked parent, hardlinked target, `../` destination, source symlink escaping the repo, parent-path swap, and a same-name directory where a file is expected. Every fixture must leave the external sentinel byte-identical.

**Warning signs:**

- `test -e` is the only existence check around a destructive write.
- Plain `cp`, `chmod`, `chown`, `rm -rf`, or `ln -sfn` operates on an unverified manifest path.
- Tests assert normal symlink installation but not hostile/pre-existing links.
- Directory hashes ignore symlink entries and targets.

**Phase to address:**
Stage A (path/type policy), Stage C (safe filesystem primitives), Stage E (adversarial host tests).

---

### Pitfall 7: “Managed configuration” becomes whole-file ownership

**What goes wrong:**
User config, hooks, provider entries, formatting, or unrelated flags are overwritten. Reinstall duplicates managed blocks, accepts malformed markers, or removes a user's post-install edits during rollback. The current spine merge mutates `hooks.json` as a whole and strips `async` from every hook item, not only Temperance-owned entries.

**Why it happens:**
Whole-file JSON rewrites are simpler than field ownership, and marker-based text edits appear safe until duplicate/missing markers or concurrent edits occur. `--force` can become a blanket bypass instead of a scoped, receipt-bound override.

**How to avoid:**
The manifest must name the exact owned JSON pointer(s), hook IDs, or text block markers. Before mutation, parse and validate; refuse duplicate/unbalanced markers and type conflicts. Preserve unknown keys and byte-identical text outside the owned block where the format permits. Record the preimage digest and exact managed projection in the transaction receipt. Apply via a temporary file and atomic rename; rollback removes/restores only the owned projection when the current projection still matches the receipt, otherwise report drift and preserve the file. Test configs containing unknown keys, unrelated hooks with `async: true`, whitespace/order variation, a user collision at a managed key, malformed markers, duplicate markers, and edits made after install.

**Warning signs:**

- A lifecycle script calls `p.write_text(json.dumps(data...))` after touching unrelated objects.
- `--force` overwrites an entire operator file with no per-entry confirmation.
- Idempotency tests only compare the second install's exit code, not preservation of unrelated bytes.
- Rollback restores a whole old config after the user has made newer changes.

**Phase to address:**
Stage A (ownership schema), Stage C (reconciler and rollback tests).

---

### Pitfall 8: Backups exist, but rollback and uninstall are not transactions

**What goes wrong:**
An update fails after removing a destination, and recovery cannot identify the right preimage or prior absence. Uninstall leaves services, hooks, links, copied trees, generated state, or config blocks behind. It may also delete user-modified files. A “latest backup” from a different operation is restored. The current `uninstall.sh` only prints guidance, and `wire-multi-backend.sh --revert` removes some links but merely reports files that need manual restoration.

**Why it happens:**
Backup creation is implemented independently in several scripts. `scripts/lib.sh` keys backups by second plus a path slug, so repeated writes to the same destination in one second can overwrite the earlier preimage; other scripts use timestamp/PID plus basenames. There is no shared receipt tying backups to one install/update, no absence sentinel, no full service-state capture, and no reverse dependency order.

**How to avoid:**
Stage C introduces a unique transaction directory and receipt before the first mutation. For every entry record: manifest/version, source and rendered digests, destination, pre-state type/mode/owner/digest or `absent`, backup path/digest, post-state, service state, and completed step. Never overwrite a transaction backup. Promote all staged files only after every backup succeeds. On failure or explicit rollback: stop dependents, restore config/files/links in reverse mutation order, reload/start dependencies, run health/provenance probes, and write a restore receipt. Uninstall uses the installed receipt, removes only unchanged Temperance-owned bytes/blocks, preserves drift with a warning, and leaves private/mutable host state unless the user separately opts into removal.

Required rehearsal: foreign pre-existing files + fresh install + update with an injected mid-copy/service failure + rollback + uninstall; compare the complete fixture tree and service state to the pre-install snapshot, including paths that were originally absent.

**Warning signs:**

- Rollback selects `ls -1t ... | head -1`.
- A backup name lacks a transaction ID and original destination mapping.
- Install uses `rm -rf` before a complete staged copy and backup receipt exist.
- Uninstall contains only instructions or assumes all current bytes still match installation.
- A rollback test restores one file but not services, permissions, generated files, links, and absence.

**Phase to address:**
Stage C (blocking); full rehearsal in Stage E.

---

### Pitfall 9: Permissions and ownership are accidental side effects of copy and umask

**What goes wrong:**
Secrets, receipts, backups, state, or logs become group/world-readable; executable hooks lose execute bits; public source is unnecessarily private; root-installed Linux files are owned or writable incorrectly; an update preserves unsafe legacy modes. Doctor verifies content but not protection.

**Why it happens:**
Current generic helpers use `mkdir -p` and `cp` without a per-entry mode contract, while specialized scripts set modes selectively. Different umasks, `cp` implementations, root/user contexts, and restored backups yield different results.

**How to avoid:**
Add expected type, mode, and owner policy to each manifest entry or class. Use explicit creation modes: private state/backup directories `0700`, private files/receipts `0600`, public read-only data `0644`, and executables `0755` unless a tighter component contract applies. Validate owner/group for system installs and forbid setuid/setgid/sticky bits unless explicitly authorized. Set the staged file's mode before atomic promotion; preserve and restore the original mode/owner for user-owned preimages. Doctor and provenance output report mode/owner mismatches without printing secret content. Test under permissive and restrictive umasks and as both user-level macOS and root-level Linux fixtures.

**Warning signs:**

- `cp`/`mkdir` is relied on to choose final modes.
- A receipt contains a digest but no type/mode/owner.
- Tests check only file existence or content.
- A Linux service user can write its immutable release tree or read another service's credentials.

**Phase to address:**
Stage A (mode contract), Stage C (enforcement), Stage E (host assertions).

---

### Pitfall 10: Service promotion restarts in the wrong order or reports success through failure

**What goes wrong:**
The console starts against an old/offline bridge, hooks publish during a bridge gap, a new service runs against partially promoted files, or rollback restores bytes without restoring prior loaded/enabled/active state. Top-level install still exits zero. `install-spine.sh` installs bridge then console but swallows either failure with `|| say "... skipped"`; console health only proves the Vite root page, not bridge connectivity.

**Why it happens:**
Service scripts each have useful local backup/health behavior, but no shared dependency graph or transaction coordinates bridge, console, proxy, Pulse, and hook activation. Process-running and HTTP-responding are treated as equivalent to dependency-ready.

**How to avoid:**
Stage A declares service dependencies and health probes. Stage C follows a transaction sequence:

1. Render and validate all templates (`plutil -lint`; `systemd-analyze verify` when available).
2. Stage and back up all service files and program bytes.
3. Stop dependents first (console before bridge; publishers/hooks quiesced where required).
4. Promote dependencies first, reload the manager, start bridge, and verify its version/source digest/health.
5. Start console and verify both its page and a real bridge-backed read.
6. Only then activate hooks/publishers and commit the receipt.

Any required service failure must fail the top-level lifecycle command and trigger reverse restoration. Optional services must return an explicit `optional-skip` reason. Capture prior loaded/enabled/active state and rehearse both update failure and rollback. On Linux preserve the existing credential boundary (`LoadCredential=`); never copy the credential into a release.

**Warning signs:**

- `|| true` or `|| say ... skipped` wraps a required service promotion.
- Health checks look only for a process, static HTML marker, or port.
- Plists reference the mutable checkout rather than a receipt-bound installed version.
- Rollback restores a plist/unit but not manager state and dependent health.

**Phase to address:**
Stage A (dependency model), Stage C (promotion engine/templates), Stage E (failure injection).

---

### Pitfall 11: macOS success hides shell and Linux divergence

**What goes wrong:**
The documented install works only on the developer Mac or CI image. `/bin/sh` and Bash are conflated; macOS Bash 3.2, Homebrew Bash, and Linux Bash run different paths; BSD/GNU options (`stat`, `find`, `sort -z`, `readlink`, `sha256sum`/`shasum`) diverge; `launchctl`, `plutil`, `afplay`, `systemctl`, or `systemd-analyze` are invoked on the wrong host. Missing `bun`, `node`, `npm`, `python3`, `rsync`, or `jq` is discovered after mutation.

**Why it happens:**
`install.sh` is POSIX `sh` but delegates to Bash scripts and language runtimes. The macOS CI workflow installs Bash 4+ before verification, so it does not prove the stock-macOS shell path promised to users. `verify-install.sh` syntax-checks scripts, but syntax success is not a runtime portability test. Linux is best-effort, which can be misread as “untested.”

**How to avoid:**
At Stage C, perform a complete dependency/platform preflight before writes and dispatch to explicit platform adapters. Keep common lifecycle logic in a tested portable implementation; use `#!/usr/bin/env bash` only where Bash is declared, and set/document the minimum version. Normalize SHA-256 and stat operations behind helpers with fixture tests. Stage E runs:

- release-blocking clean macOS with stock `/bin/sh`, the documented dependency installation, voice enabled, and no-voice mode;
- a macOS path that does not assume Homebrew's prefix or the developer's mounted volume;
- best-effort Linux in a clean supported distribution with launchd/voice disabled and systemd tests isolated or containerized;
- missing-optional-dependency cases that exit cleanly with explicit skips;
- missing-required-dependency cases that fail before any fixture mutation.

Do not broaden scope to Linux parity: record failures and compatibility status, while macOS remains the only release-blocking platform for v1.1.

**Warning signs:**

- CI installs a newer shell but Quickstart does not.
- A `sh` script contains `[[`, arrays, `pipefail`, `local`, or brace-loop assumptions.
- A common script directly invokes platform-specific tools without dispatch.
- Sandbox tests pass only because developer tools are inherited from `PATH`.

**Phase to address:**
Stage C (adapters/preflight), Stage E (qualification). Scope remains macOS-blocking, Linux best-effort.

---

### Pitfall 12: One checksum rule is applied to copy, transform, regenerate, and directory surfaces

**What goes wrong:**
Valid transformed/generated files always appear drifted, or unsafe drift is normalized away. Directory checks miss stale files, symlinks, executable-bit changes, or empty directories. A generated machine path is compared to template bytes. Current examples show the risk: router sync does not delete stale files, while the Linux release `MANIFEST.sha256` hashes only `-type f`, excluding symlinks, modes, and empty directories.

**Why it happens:**
“SHA-256” sounds like a complete provenance strategy, but the correct comparison depends on install class. Ad hoc directory pipelines also differ across BSD/GNU tools and can be ambiguous if they do not bind relative path, entry type, and content.

**How to avoid:**
Stage A defines class-specific verification:

| Class | Correct provenance meaning |
|---|---|
| `copy` | Source bytes equal installed bytes; also verify declared type and mode. |
| `transform` | Render into staging; digest the exact rendered bytes. Receipt also binds template digest, renderer version, normalized non-secret inputs, and destination. Managed configs hash the owned projection/block and separately prove preservation of unowned data. |
| `regenerate` | Validate schema, generator version, safe inputs, freshness, permissions, and invariants. Do not claim equality with a repository source file. |
| `never-ship` | Assert absence from manifest payload, Git-tree artifact, installed immutable tree, and public receipts. |

For directories, hash a canonical, NUL-safe ordered stream containing relative path, entry type, declared mode, file digest or literal symlink target; declare exclusions for generated/mutable children. Reject unexpected entries for immutable directories. Store algorithm/schema versions in the provenance manifest so upgrades are explicit.

**Warning signs:**

- The manifest says only `verify: sha256` for every class.
- A directory digest is based on `find ... -type f` alone.
- `rsync` has no deletion or unexpected-entry check for an immutable tree.
- Doctor reports generated/state files as source drift or ignores unexpected immutable files.

**Phase to address:**
Stage A (semantics/schema), Stage C (implementation), Stage E (cross-platform golden fixtures).

---

### Pitfall 13: Documentation continuity proves wording, not lifecycle truth

**What goes wrong:**
Users follow commands that do not exist, omit required dependencies, or promise reversibility the code does not provide. Current concrete contradictions: Quickstart says the wiring changes are “all symlinks with backups — fully reversible,” but wiring also copies enrichment/hooks/desktop skills and revert only flags manual restoration; `docs/rollback.md` documents manual copying; `uninstall.sh` performs no deletion/restoration. The member Quickstart instructs `./verify.sh` even though the current path guard is red.

**Why it happens:**
Existing docs tests largely grep for phrases and specific historical invariants. README continuity is intentionally scoped to README/CHANGELOG/NotebookLM signals, so lifecycle changes can merge without executing documented commands or updating rollback/security/architecture pages.

**How to avoid:**
Stage D derives install-surface tables and diagrams from the manifest where possible. Extract every fenced public command from README, Quickstart, rollback, security, contributing, and docs index; execute safe commands against a sandbox or validate their `--help`/dry-run contract. Add assertions that install options, defaults, optional skips, doctor output, update/rollback/uninstall behavior, service names, and supported platforms match code. Keep historical plans explicitly historical and excluded from current operator navigation. A lifecycle behavior change must fail docs continuity until relevant docs and generated site pages update.

**Warning signs:**

- Docs tests use only `grep -q` for expected words.
- README says “fully reversible” without a full-tree rollback/uninstall receipt test.
- A command documented as succeeding is knowingly red on the release candidate.
- Architecture diagrams list surfaces absent from the manifest or omit installed destinations.

**Phase to address:**
Stage D; execute documentation probes again in Stages E and F.

---

### Pitfall 14: Dirty-worktree release contamination defeats reviewable slices

**What goes wrong:**
A release includes uncommitted or untracked files, omits intended files, or binds a version/commit that does not describe installed bytes. Private state may be present only in the local working tree. The five intended review slices collapse into one wave whose security and rollback implications cannot be audited independently.

**Why it happens:**
The installer and service scripts currently read directly from the checkout. The inspected tree has 86 dirty entries and zero staged files. Some current product surfaces are untracked. A successful local install therefore proves the working directory, not any downloadable Git revision.

**How to avoid:**
At Stage F, refuse packaging when tracked modifications, staged changes, or untracked non-ignored files exist. Do not provide a release bypass analogous to `TEMPERANCE_ALLOW_DIRTY_BUILD=1`. Build from a clean temporary clone or `git archive` of the exact proposed tag, record the commit in the artifact, and compare artifact inventory to `git ls-tree -r` plus declared generated outputs. Preserve the ratified five slice boundaries; each slice gets focused tests and an explicit manifest/lifecycle impact. Assemble them on a clean integration branch, run the full verifier, then review the final diff and release artifact independently.

**Warning signs:**

```bash
test -z "$(git status --porcelain=v1)" || exit 1
git diff --check
git ls-files --others --exclude-standard
```

- A build script copies from `$PWD` without a clean-tree gate.
- Version and source commit are recorded but artifact bytes came from a dirty tree.
- Untracked `package/`, hooks, docs, or `.temperance` files are needed for local success.
- One commit mixes schema, router/hooks, UI/bridge, enrichment/skills, lifecycle, and docs.

**Phase to address:**
Stage F; baseline awareness begins at Intake.

---

### Pitfall 15: Declaring release-ready without clean-clone, empty-home proof

**What goes wrong:**
All in-place tests pass because they can see ignored dependencies, node_modules, a product symlink, mounted-volume paths, Homebrew tools, existing configs, provider sessions, running services, or prior generated state. Downloaders receive an incomplete skill or missing untracked application. “macOS qualified” becomes shorthand for “works on this Mac.”

**Why it happens:**
`tests/sandbox-install.sh` isolates `$HOME`, which is valuable, but it runs from the dirty working checkout and inherits host tools and repository generated files. GitHub Actions checks out a clean commit, but current CI has not proved a downloadable v1.1 artifact, a complete update/rollback/uninstall cycle, or the exact release manifest. Existing sandbox assertions focus mainly on landing files, one backup restoration, idempotency, and a few guards.

**How to avoid:**
Stage E must install the candidate artifact into an empty home on macOS, not the developer checkout, and run install → doctor → verify → update fixture → injected failure/rollback → uninstall. Assert no reads outside artifact and declared system dependencies (trace or shim commands), exact manifest coverage, no optional service falsely required, no private path/state, complete skill package, mode/owner policy, and pre-install fixture restoration. Linux runs the documented best-effort subset and produces an honest receipt.

Stage F then repeats the canonical verifier from a new clone of the proposed tag, builds the downloadable artifact, installs that artifact into another empty home, and records commit, artifact SHA-256, platform/tool versions, options, manifest version, skipped optional features, and every command exit. Release claims must cite this receipt; a local dirty-tree pass or CI source pass is not equivalent.

**Warning signs:**

- The sandbox's repository root is the developer checkout.
- Tests pass with existing `node_modules` but dependency bootstrapping is untested.
- The artifact is never installed; only the source checkout is.
- Qualification receipts omit commit/artifact digest, platform, flags, skips, or uninstall result.
- A release is proposed while `./scripts/verify-all.sh` is red.

**Phase to address:**
Stage E (qualification harness), Stage F (release-blocking clean-clone proof).

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Add another destination list to a script | Fast local patch | Inventory divergence across install/doctor/uninstall | Never after Stage A; wrappers must consume the manifest |
| Preserve immutable directories without rejecting extras | Avoid deleting local additions | Stale/live-only code survives and provenance lies | Only for explicitly mutable/private-overlay directories |
| Use path/secret blacklists as the payload definition | Easy grep gate | New names and symlinked/private formats bypass it | Defense-in-depth only, never instead of a positive allowlist |
| Whole-file config rewrite | Simple implementation | User settings and concurrent edits are clobbered | Only for a newly created, exclusively Temperance-owned file |
| “Latest backup” rollback | Minimal receipt design | Restores unrelated/incorrect transaction | Never |
| Hash only regular file contents | Short digest code | Misses type, mode, links, stale paths, and empty dirs | Only for a manifest entry that is exactly one regular file |
| Swallow required service failures as optional skips | Installer appears resilient | Partial install is reported successful | Only when the manifest marks the service optional and records the skip |
| Test from the developer checkout | Fast feedback | Ignored/untracked/private dependencies contaminate proof | Fine before Stage E, never as release evidence |
| Keep docs as manually synchronized prose | Flexible writing | Commands and lifecycle promises drift | Narrative sections only; operational inventories/commands need executable checks |
| Add a dirty-build override to the public release path | Emergency convenience | Commit/version no longer identifies payload | Never for Stage F public artifacts |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| Codex and Claude hooks | Install the same hook from spine and wiring paths; strip unrelated hook flags | One manifest owner per destination; reconcile only Temperance hook IDs |
| Enrichment core | Replace the tree and either ingest or delete atlasRecall | Immutable public tree plus separate explicit private overlay |
| Router host copy | `rsync -a` without closure or unexpected-entry checks | Manifest-resolved staging and exact immutable-directory verification |
| Manifest Bridge + Console | Treat each HTTP listener as independently healthy | Dependency-ordered promotion and a console-to-bridge functional probe |
| launchd | Render plists against a mutable checkout and swallow bootstrap failure | Receipt-bound installed program path; lint, bootstrap, health, rollback |
| systemd relay | Copy credentials or treat enable as equivalent to start/health | Preserve `LoadCredential=`, reload manager, start, validate identity/bind/health |
| Pulse/voice | Let optional macOS integration block core or leak a private pack | Explicit optional entry, `--skip-voice`, no payload copy, recorded skip |
| GSD wrappers | Assume external GSD core exists or vendor a private copy | Install wrappers from manifest; detect external dependency and fail/skip explicitly |
| OpenCode/Cursor configs | Install a template over an existing config | Managed projection or copyable template; preserve unrelated values |
| Kimi desktop skills | Assume symlinks work across volumes; replace user directory | Explicit managed copy with marker, complete package, collision refusal |

## Performance Traps

The principal “scale” here is install-surface count and repeated lifecycle operations, not user traffic.

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Re-scan entire public tree for every entry | Slow doctor/verify; vendor/generated noise | Resolve manifest once; prune declared generated trees; cache only against manifest+tree digest | As source/docs/node_modules grow |
| Start/restart each service during each file copy | Port flaps, slow updates, transient hook failures | Stage all bytes, then one dependency-ordered service promotion | Any multi-file update |
| Create a full backup per overlapping installer | Rapid backup growth and ambiguous rollback | One transaction, one preimage per destination, content-deduplicate only after correctness | Reinstall/update loops |
| Hash large generated/mutable trees | Constant false drift and expensive verification | Schema/invariant checks for regenerate; scoped hashes for immutable payload | Manifest Zone dependencies, logs, histories, model/runtime state |
| Retry required service startup without total transaction timeout | Installer appears hung | Bounded per-service and transaction timeouts; emit last health/log evidence | Missing dependency, port collision, crash loop |

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Packaging from live home or dirty checkout | Private data or unreviewed code ships | Build from exact clean Git tree; scan final artifact |
| Following destination/source symlinks | Write/read escapes managed boundary | `lstat` components, allowlisted canonical roots, no-follow primitives, adversarial fixtures |
| Modifying hardlinked managed config | Changes another user-visible path | Refuse `nlink > 1`; promote via new inode and atomic rename |
| World-readable backup/state/receipt | Exposes provider/config/operator data | Explicit `0700` directories and `0600` private files; doctor mode checks |
| Logging rendered secrets or environment | Secrets enter public receipts/logs | Bind secret references/identifiers, never values; redact command output |
| Recursive removal based only on a path string | Deletes foreign or broad data | Receipt identity + marker + normalized allowlisted target + root guards |
| Treating localhost service as inherently safe | Other local users/processes may access state/control | Loopback plus least privilege, bounded endpoints, private state modes, explicit auth where needed |
| Putting secrets in systemd unit literals | Units are inspectable and configuration leaks | Keep existing `LoadCredential=`/credential-directory boundary |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Partial success exits zero | Operator trusts a broken glove | Required failure is non-zero; optional skip is named in receipt and doctor |
| `--force` is global | User cannot predict what will be overwritten | Show per-entry plan/conflict; require scoped confirmation or policy |
| Doctor reports only “missing/ok” | No clue whether drift is source, transform, mode, service, or optional | Emit ID, class, destination, expected/actual provenance, status, and repair action |
| Uninstall means “read these manual steps” | Product feels unsafe and unfinished | Dry-run plan plus manifest-driven reversible uninstall and preservation report |
| Rollback silently skips drift | User believes pre-state is restored | Fail closed, preserve current bytes, and print exact conflicting entry/recovery path |
| Linux best-effort sounds like parity | Users infer unsupported promises | Publish exact tested subset, skips, receipt, and macOS release-blocking status |
| Historical docs appear current | Users run obsolete/private-path commands | One current docs entry map; visible historical labels; executable command checks |

## "Looks Done But Isn't" Checklist

- [ ] **Provenance manifest:** Every discovered install mutation has exactly one ID/owner/class/destination, and duplicate/overlapping ownership is rejected.
- [ ] **Private boundary:** Final Git-tree artifact contains no secrets, databases, private state, private paths, escaping symlinks, or atlasRecall.
- [ ] **Path guard:** `./verify.sh` passes for the right scoped reasons and reports classified findings; it was not made green by a broad exclusion.
- [ ] **Copy provenance:** Installed copy bytes, type, and mode match the declared source.
- [ ] **Transform provenance:** Receipt binds template, renderer, safe inputs, exact rendered bytes, and preserved unowned config.
- [ ] **Regenerate provenance:** Schema/version/freshness/mode checks pass without pretending generated bytes equal source.
- [ ] **Directory closure:** Unexpected files, links, type/mode changes, and stale removed files fail immutable-directory verification.
- [ ] **Path safety:** Symlink, dangling-link, hardlink, `..`, source-escape, and parent-swap fixtures cannot touch external sentinels.
- [ ] **Permissions:** User and system installs pass explicit mode/owner assertions under multiple umasks.
- [ ] **Managed config:** Unknown keys/hooks and bytes outside managed blocks survive install, update, rollback, and uninstall.
- [ ] **Service order:** Console/bridge/proxy promotion, dependency health, prior manager state, and injected-failure recovery are proven.
- [ ] **Rollback:** Full fixture tree and service state return to the pre-transaction snapshot, including originally absent paths.
- [ ] **Uninstall:** Only receipt-owned unchanged bytes/blocks are removed; drift and private host state are preserved and reported.
- [ ] **macOS qualification:** Clean artifact install passes full spine and no-voice modes on the supported macOS baseline.
- [ ] **Linux qualification:** Best-effort suite produces an honest receipt; no release-parity claim is made.
- [ ] **Documentation:** Every public command exists and safe commands execute against the sandbox; diagrams/inventories match the manifest.
- [ ] **Release slices:** Each of the five ratified slices is reviewable and passes its focused gate before integration.
- [ ] **Clean-clone release:** Proposed tag is cloned afresh; artifact digest, install/update/rollback/uninstall, and full verifier all pass from that clone.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Private material entered an unpushed artifact | MEDIUM | Quarantine artifact; identify source/manifest entry; purge build output; add negative fixture; rebuild from clean tree |
| Private material entered Git history/release | HIGH | Stop distribution; rotate affected credentials; remove release; follow an approved history-remediation process; publish incident scope |
| atlasRecall copied into public tree | MEDIUM | Remove from payload/source, verify Git/artifact history, relocate operator copy to private overlay, add absence tests |
| Symlink/hardlink escape modified external file | HIGH | Stop lifecycle operation; preserve evidence; restore external file from independently verified backup; fix primitives and add exact exploit fixture |
| Config clobbered | MEDIUM | Preserve current file; recover receipt-bound preimage; three-way reconcile user changes with managed projection; never blind-copy backup |
| Service promotion failed | MEDIUM | Quiesce dependents; restore receipt-bound bytes and manager state in reverse order; start dependencies; run functional health probes |
| Backup missing or ambiguous | HIGH | Do not guess “latest”; preserve current state; use transaction evidence/manual reconciliation; mark rollback incomplete |
| Path guard remains red | LOW–MEDIUM | Export full classified match list; repair executable payload first; parameterize fixtures; document narrow historical exceptions |
| Docs claim exceeds implementation | LOW | Correct docs immediately, add executable continuity assertion, and withhold release claim until lifecycle proof exists |
| Dirty release artifact built | MEDIUM | Discard it; clean/slice/commit; clone exact candidate; rebuild and compare manifest/digest |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| Moving/unreconciled baseline | Intake | Commit + porcelain digest + locked-scope receipt reviewed before Stage A |
| Private state copied | A, B, F | Positive manifest allowlist; final artifact secret/type/path/symlink scan |
| atlasRecall leakage/deletion | B | Absent from Git artifact; separate overlay survives public refresh fixture |
| Hard-coded paths/red guard | A, B | Scoped finding report; executable/payload path guard exits zero |
| Partial/overlapping inventories | A, C | Unique destination/owner schema; observed sandbox writes equal manifest set |
| Symlink/hardlink/traversal | A, C, E | Adversarial fixtures leave external sentinels unchanged |
| Config clobbering | A, C | Unknown/unowned content survives install-update-rollback-uninstall |
| Rollback/uninstall gaps | C, E | Full pre-state tree/service digest restored; drift-preservation case passes |
| Permission drift | A, C, E | Type/mode/owner checks under multiple umasks and privilege contexts |
| Service restart order | A, C, E | Failure injection plus dependency functional health and manager-state restore |
| Platform/shell divergence | C, E | Stock macOS release-blocking matrix; Linux best-effort receipt |
| Wrong checksum semantics | A, C, E | Golden fixtures for copy/transform/regenerate/never-ship and directory closure |
| Stale documentation | D, E, F | Public commands exercised; generated inventory/diagrams match manifest |
| Dirty release contamination | F | Clean porcelain gate; exact Git-tree artifact; slice review receipts |
| Claims without clean-clone proof | E, F | Fresh clone → artifact → empty-home lifecycle → full verifier receipt |

## Recommended Stage Exit Additions

These checks sharpen the ratified exits without changing locked scope or stage order.

| Stage | Add to the binary exit gate |
|---|---|
| Intake | Baseline receipt pins commit, dirty-state disposition, milestone authority, macOS-blocking/Linux-best-effort promise, and atlasRecall-private decision. |
| A | Schema rejects duplicate/overlapping destinations, unsafe paths/types, missing mode/rollback/service metadata, and invalid class-specific verification. Every observed current install surface has exactly one owner/class. |
| B | Public artifact/source scan passes; current `verify.sh` path guard is green with classified exceptions; atlasRecall is absent and overlay-separated; immutable directory closure finds no unmapped live-only public capability. |
| C | One transaction engine drives all lifecycle commands; adversarial path/config/permission tests pass; required service failure rolls back; uninstall restores/preserves correctly. |
| D | Operational docs commands execute in sandbox, current navigation excludes historical plans, and manifest-generated inventory/diagrams match source. |
| E | Artifact-based empty-home macOS full/no-voice lifecycle receipts pass; Linux best-effort receipt is published; injected failures prove rollback and uninstall. |
| F | Tree is clean; five slices are reviewed; fresh clone of candidate tag builds the artifact; artifact install lifecycle and `./scripts/verify-all.sh` pass; human approval cites the receipt. |

## Sources

### Repository primary sources

- [`.planning/PROJECT.md`](../PROJECT.md) — ratified v1.1 goal, constraints, locked macOS/Linux and atlasRecall decisions.
- [`docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md`](../../docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md) — publication map, stage order, current drift, release slices, and verification matrix.
- [`install.sh`](../../install.sh), [`scripts/install-pai.sh`](../../scripts/install-pai.sh), [`scripts/install-spine.sh`](../../scripts/install-spine.sh), and [`scripts/wire-multi-backend.sh`](../../scripts/wire-multi-backend.sh) — current overlapping writes, backup methods, source-tree copies, product symlink, and service calls.
- [`uninstall.sh`](../../uninstall.sh) and [`docs/rollback.md`](../../docs/rollback.md) — current manual-only uninstall/rollback gap.
- [`verify.sh`](../../verify.sh), [`scripts/verify-all.sh`](../../scripts/verify-all.sh), and [`scripts/verify-install.sh`](../../scripts/verify-install.sh) — canonical verifier and current public-path guard. Executed 2026-08-19: `./verify.sh` exited 1 at `private local path found in public/install surface`.
- [`tests/sandbox-install.sh`](../../tests/sandbox-install.sh) — existing empty-HOME, idempotency, backup collision, dry-run, and live-operator guards; also evidence that current tests run from the working checkout.
- [`scripts/temperance-manifest-bridge-launchd.sh`](../../scripts/temperance-manifest-bridge-launchd.sh), [`scripts/temperance-manifest-console-launchd.sh`](../../scripts/temperance-manifest-console-launchd.sh), and [`scripts/install-temperance-proxy-systemd.sh`](../../scripts/install-temperance-proxy-systemd.sh) — current service promotion, health, rollback, credential, and digest behavior.
- [`QUICKSTART.md`](../../QUICKSTART.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), and [`tests/docs-continuity.sh`](../../tests/docs-continuity.sh) — current lifecycle claims and limits of documentation continuity checks.

### External primary/official references

- [POSIX.1-2024 Pathname Resolution](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html#tag_04_16) — `.`/`..`, absolute/relative path, and symbolic-link resolution semantics.
- [POSIX rationale for symbolic-link handling](https://pubs.opengroup.org/onlinepubs/9799919799/xrat/V4_xbd_chap01.html) — why utilities differ in whether they act on links or targets; supports explicit no-follow policy rather than assuming `cp`/`ln` behavior.
- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — primary `launchd` job structure and `ProgramArguments`/`KeepAlive` semantics.
- [systemd credentials documentation](https://github.com/systemd/systemd/blob/main/docs/CREDENTIALS.md) and [systemctl manual source](https://github.com/systemd/systemd/blob/main/man/systemctl.xml) — primary guidance for `LoadCredential=`, manager reload, enable/start, and restart distinctions.
- [Git `archive` documentation](https://git-scm.com/docs/git-archive) — creation of an artifact from a named Git tree and archive attribute behavior.

---
*Pitfalls research for: Temperance Engine v1.1 Public Temperance Glove*
*Researched: 2026-08-19*
