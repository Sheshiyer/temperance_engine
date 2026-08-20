# Mac mini → Public Temperance Glove Audit and GSD Workflow

Status: ratified for audit and workflow design; milestone activation held  
Date: 2026-08-19  
Repository baseline: `main` at `32f1dab`  
ISA slice: `ISC-761..ISC-788`

## Executive finding

The working Mac mini is not the artifact that should be distributed. It is the
reference installation of a product already rooted in this repository.
`~/.temperance_engine/product` resolves to the checkout containing this file:

```text
readlink ~/.temperance_engine/product == git rev-parse --show-toplevel
```

The hand-in-glove design is therefore partly correct already:

```text
public repository (source authority)
        │
        ├── symlinked/read-only product tree
        ├── copied or generated host integrations
        ├── mutable runtime state
        └── private provider authority
```

The missing structural piece is a versioned provenance contract that states,
for every installed surface, its source, destination, install mode, mutability,
verification probe, and uninstall/rollback behavior. Without that contract,
source/runtime drift has to be rediscovered manually.

## Scope and safety boundary

This audit is read-only except for this repository's planning artifacts and ISA
entries. It does not copy provider state, alter services, activate a GSD
milestone, publish a release, or synchronize the live host.

The existing GSD authorities are not currently in agreement:

- `.planning/config.json` names `full-native-integration-completion-audit`.
- `.planning/STATE.md` names `public-ready-docs-glove`.
- `.planning/ROADMAP.md` labels both a current docs milestone and an active
  full-native milestone.

This audit does not select or mutate one of those authorities. Phase numbering
and activation are held until the interactive milestone intake first reconciles
them. `.planning/config.json` retains `workflow.auto_advance: false`.

## Evidence snapshot

### Repository change wave

`git diff --name-status` reports 58 tracked modified/deleted files. The tracked
diff contains 2,092 insertions and 799 deletions. The untracked wave includes:

- `package/manifest-zone/` — local Manifest Zone web application.
- `package/hooks/codex/` and `package/hooks/claude/` — composed mode/GSD hooks.
- Manifest Bridge capability, CodeGraph, and workflow-projection sources.
- GSD rail map, goal, project-init, manifest, and command installers.
- `.temperance/` project/manifest metadata and planning JSON projections.
- A documentation site, architecture visuals, and GSD/goal guides.
- Installer, doctor, sandbox, and verification changes.

This is one unfinished release wave, not one reviewable commit.

The canonical repository verifier is also red at this baseline. `verify-all.sh`
invokes `verify.sh`, whose public-path guard finds existing hard-coded private
home and mounted-volume prefixes in relocation/runtime sources. The new public
audit contains neither prefix. This does not invalidate the planning slice, but
it is a release blocker that source convergence must close before packaging can
be described as release-green.

### Verified source/runtime parity and drift

| Surface | Probe result | Meaning |
|---|---|---|
| Product root | `readlink ~/.temperance_engine/product` resolves to this repository | The repo is already the product authority |
| Router | `diff -qr package/router ~/.temperance_engine/router` reports only live-only `temperance-search-evidence.sh` | Router is nearly converged; one file needs a product/overlay decision |
| Codex PromptProcessing hook | Repository and installed file are byte-identical | Source → host copy is current |
| Codex GSD command hook | Repository and installed file are byte-identical | Source → host copy is current |
| Codex SessionStart hook | Repository and installed file are byte-identical | Source → host copy is current |
| Claude PromptProcessing hook | Repository and installed file are byte-identical | Source → host copy is current |
| Manifest Bridge | Repository has newer/extra capability, CodeGraph, doctor, runtime-status, and workflow-projection surfaces | Source is ahead of the running installed copy; deployment is pending |
| Enrichment | Repository and installed trees differ; installed tree has live-only `stages/atlasRecall.ts` | Authority is ambiguous and must be reconciled before refresh |
| Temperance skills | All four installed `SKILL.md` files differ from repository versions | Skill install provenance is not currently closed |
| Parallel dispatch skill | Installed copy additionally contains `Workflows/`, `references/`, and `scripts/` | A fresh downloader receives an incomplete capability package |
| OmniRoute home | Contains environment, OAuth, SQLite, logs, history, backups, and runtime data | It is provider-owned private runtime state, never product payload |

## Hand-in-glove publication map

The following action words are lifecycle classifications, not permission to
perform the action in this audit.

### COPY

Byte-for-byte installation is appropriate only when the repository is already
the public authority and the installed target is immutable program material.

| Repository authority | Host destination | Verification |
|---|---|---|
| `package/hooks/codex/*.hook.ts` | `~/.codex/hooks/` | `cmp -s` per file |
| `package/hooks/claude/PromptProcessing.hook.ts` | `~/.claude/hooks/` | `cmp -s` |
| `package/router/*` governed executables | `~/.temperance_engine/router/` or managed symlink targets | manifest checksum set |
| `skills/temperance-{engine,native,algorithm,parallel-dispatch}/` | `~/.agents/skills/` plus Codex links | directory checksum excluding declared generated files |
| Manifest Bridge source/package | managed runtime installation | version and source digest readback |

### TRANSFORM

These surfaces contain portable behavior but require templating, path
generalization, dependency declaration, or public-safety review before they can
become product inputs.

| Live/reference surface | Product form | Required transformation |
|---|---|---|
| `temperance-search-evidence.sh` | `package/router/` or declared overlay | remove host assumptions; add tests; decide ownership |
| `stages/atlasRecall.ts` | `package/enrich/stages/` or declared overlay | prove generic inputs; remove personal memory coupling; add fixture tests |
| Installed parallel-dispatch support files | complete repository skill package | remove backups/DS_Store; generalize paths; retain license/attribution |
| LaunchAgent definitions | installer templates | parameterize home, ports, runtime paths, and optional services |
| Codex/Claude/OpenCode/Cursor configuration | managed-block templates | preserve user config; never copy whole host files |
| Mac-specific voice/Pulse integration | optional feature layer | explicit platform detection and no-voice fallback |

### REGENERATE

These artifacts belong to a host and must be created from public schemas or
live probes after installation.

| Runtime artifact | Regeneration authority | Verification |
|---|---|---|
| `.temperance/project.json` and manifest projections | project-init/manifest commands | schema validation and readback |
| GSD wrapper registrations | installed GSD core plus command installer | wrapper inventory |
| provider fleet ranking and quota snapshots | live provider/session observations | timestamp/freshness check |
| routing observations and reconciliation receipts | governed runtime | schema and permission check |
| service logs, PID/status, console build cache | service manager/runtime | health endpoints and process readback |
| backups | installer/update transaction | pre/post digest and restore rehearsal |

### NEVER-SHIP

| Private or mutable surface | Reason |
|---|---|
| `~/.omniroute/.env`, OAuth state, API-key exports, cookies, and credentials | secret-bearing provider authority |
| OmniRoute SQLite databases, WAL/SHM files, embeddings, call logs, and CLI history | private behavioral/runtime data |
| `~/.temperance_engine/state/`, `logs/`, `receipts/`, `backups/`, and `.omniroute-backups/` | operator state, evidence, and recovery material |
| native provider session stores and transcripts | provider-owned private continuity state |
| PAI personal memory, identity files, learning signals, and private voice packs | personal operator substrate |
| absolute user-home paths or mounted-volume assumptions in installer payloads | non-portable host identity |

No credential, token, cookie, private key, database body, or secret value is
included in this document.

## Highest-leverage architecture change

Add a versioned `package/install-surface-manifest.json` (name may be refined in
the phase discussion) consumed by install, update, doctor, verify, and uninstall.
Each entry should carry:

```yaml
id: codex-prompt-processing-hook
source: package/hooks/codex/PromptProcessing.hook.ts
destination: ${CODEX_HOME}/hooks/PromptProcessing.hook.ts
class: copy                 # copy | transform | regenerate | never-ship
mutability: immutable       # immutable | managed-block | host-state
platforms: [darwin, linux]
optional: false
verify: sha256
rollback: restore-backup
```

This changes the system's information flow and rules: drift becomes a failing
probe, not a future archaeology task. `install.sh`, doctor, sandbox tests, and
uninstall all operate from the same list instead of maintaining overlapping
inventories.

## Seven-stage GSD workflow

Milestone intake is a pre-phase. GSD assigns the six implementation phase
numbers from the repository's continuing phase sequence; this document does not
hard-code `1..6` or reset prior numbering. Each assigned phase is separately
planned and executed, and no later stage is pulled forward implicitly.

| Logical stage (not a GSD phase number) | Immediate dependency | GSD entry command | Durable output | Binary exit gate |
|---|---|---|---|---|
| Intake. Reconcile authorities, ratify, and freeze baseline | none | `$gsd-new-milestone "Public Temperance Glove"` | reconciled config/STATE/ROADMAP authority, approved goal, requirements, roadmap, assigned phase numbers, and unchanged baseline receipt | operator resolves the current authority disagreement; intake completes without silently overwriting a milestone |
| A. Specify install provenance | Intake | either `$gsd-discuss-phase <provenance-phase>` then `$gsd-plan-phase <provenance-phase>`, or skip discussion and run `$gsd-plan-phase <provenance-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` | install-surface manifest schema, ownership rules, and drift command | schema validates; every currently installed product surface has exactly one class and owner |
| B. Converge product source | Stage A | `$gsd-plan-phase <source-convergence-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` | reconciled router, hooks, Manifest Bridge, enrichment, Manifest Zone, four skills, and portable-path repairs | no unmapped live-only public capability; `verify.sh` public-path guard passes; focused suites and secret scan pass |
| C. Unify install/update/uninstall | Stage B | `$gsd-plan-phase <lifecycle-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` | manifest-driven installer, updater, doctor, backup, uninstall, and service templates | empty-home install and rollback rehearsal both exit zero |
| D. Rebuild documentation continuity | Stage C | `$gsd-plan-phase <documentation-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` | README, Quickstart, architecture, rollback, security, contributing, docs index/site updates | docs continuity suite exits zero; every public command exists and every diagram matches the manifest |
| E. Qualify clean hosts | Stages C–D | `$gsd-plan-phase <qualification-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` | macOS full-spine, macOS no-voice, and Linux/no-launchd qualification receipts | sandbox install, no-voice compatibility, provenance, health, and uninstall probes all pass |
| F. Review, slice, and release | Stage E | `$gsd-plan-phase <release-phase> --prd docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md`, then `$gsd-verify-work` and `$gsd-ship` | verification report, five reviewable commits, changelog/version proposal, and release checklist | full verifier passes on a clean clone; independent review has no Critical/P0/P1 item; human release approval recorded |

### Command discipline

- When a phase has unresolved decisions, run `$gsd-discuss-phase N` and then
  `$gsd-plan-phase N` without `--prd`, preserving the generated `CONTEXT.md`.
- When this PRD already locks the decisions, skip discussion and run
  `$gsd-plan-phase N --prd <this-file>` directly; do not combine the two paths.
- Substitute only phase numbers generated and recorded by milestone intake; do
  not infer them from the logical stage letters above.
- Run `$gsd-execute-phase N` only after the phase plan passes its plan checker.
- Run `$gsd-verify-work` after phase execution; do not substitute test intent for evidence.
- Run `$gsd-ship` only after the worktree is intentionally sliced and reviewed.
- Keep `workflow.auto_advance=false` throughout this milestone.

## Documentation update map

| Documentation family | Required update |
|---|---|
| `README.md` | product/runtime boundary, supported install postures, public feature inventory |
| `QUICKSTART.md` | clean install, optional integrations, first doctor/verify, uninstall |
| `docs/architecture.md` and architecture visuals | source→install→runtime→private-authority diagram generated from the manifest |
| `docs/rollback.md` | backup inventory, service stop order, file restore, config-block removal, validation |
| `SECURITY.md` | never-ship boundary, secret scanning, disclosure surface, local service exposure |
| `CONTRIBUTING.md` | manifest update rule, phase-scoped changes, verification requirements |
| `CHANGELOG.md` | grouped user-visible capability changes after commit slicing |
| `docs/README.md` and docs site | one current entry map; historical plans remain marked historical |

## Installer and runtime lifecycle update map

| Family | Required update |
|---|---|
| Installer | consume provenance manifest; copy/transform/regenerate by class |
| Hooks and skills | complete payloads, byte/directory provenance, safe managed upgrades |
| Services | platform-specific templates, loopback defaults, optional components, health checks |
| Mutable state | create private directories with schemas; never seed from developer state |
| Update/uninstall | backup-first replacement, exact installed inventory, reverse-order restoration |

## Verification matrix

| Gate | Probe | Pass condition |
|---|---|---|
| Source parity | manifest-driven checksum comparison | every immutable installed file matches declared source |
| Empty-home sandbox | `bash tests/sandbox-install.sh` | exits zero without developer home dependencies |
| No-voice/non-macOS | installer fixture with voice and launchd disabled | core install and verification exit zero |
| Secret boundary | public-tree secret/path scan plus never-ship assertions | zero secret values and zero private runtime payloads |
| Runtime smoke | bridge, console, proxy, Pulse, and OmniRoute health/contract probes | required services pass; optional services report explicit skip |
| Rollback | fixture install → update → uninstall/restore | pre-install fixture digests are restored |
| Provenance | doctor emits source/destination/digest/status | every product entry has one passing or explicitly optional result |
| Full regression | `./scripts/verify-all.sh` | exits zero on a clean clone |

## Five reviewable commit slices

1. Planning and provenance schema: ISA, audit, milestone/phase files, manifest schema.
2. Router and hook parity: router decision, Codex/Claude hooks, focused tests.
3. Manifest Zone and Bridge: UI, bridge capabilities, CodeGraph/workflow projection.
4. Enrichment and skill completeness: `atlasRecall` decision, four complete skill packages.
5. Lifecycle and public release: installer/update/uninstall, docs, sandbox matrix, rollback, changelog.

Each slice must pass its focused tests before the next slice begins. The full
verification run occurs after all five are assembled on a clean integration
branch.

## Ten pitfalls to prevent

1. Treating the `product` symlink as proof that every installed runtime byte equals source.
2. Copying any OmniRoute environment, OAuth, database, history, log, or backup artifact.
3. Mutating any claimed active milestone before config, STATE, and ROADMAP authority is reconciled.
4. Committing the 58-file tracked wave and untracked application as one unreviewable unit.
5. Assuming hook parity implies Manifest Bridge, enrichment, or skill parity.
6. Dropping `temperance-search-evidence.sh` without an explicit product-versus-overlay decision.
7. Dropping `atlasRecall.ts` during an enrichment refresh without a genericity decision and tests.
8. Publishing the parallel-dispatch skill without its workflows, references, and scripts.
9. Updating a running service without a backup, ordered restart, health probe, and restore receipt.
10. Letting documentation be hand-maintained independently of the future provenance manifest.

## Activation gate

This document is a PRD-quality input, not an activated milestone. The next
interactive command is:

```text
$gsd-new-milestone "Public Temperance Glove"
```

During that intake, confirm the milestone name, whether Linux qualification is
release-blocking or best-effort, and whether `atlasRecall.ts` is product behavior
or a private operator overlay. Reconcile config, STATE, and ROADMAP before the
intake writes them, then use the phase numbers GSD assigns; do not assume the
first implementation phase is numbered `1`.
