# Public Candidate Inventory — Phase 2 Success Criterion 1

**Scan date:** 2026-08-22
**Enumeration command:** `ls -d package/*/ skills/*/ scripts/*.sh templates/* bin/* 2>/dev/null`
**Total rows:** 13 surfaces (12 `package/*`/`skills/*` directories + `bin/`), plus top-level scripts/templates mapped per-file-group.
**Method:** each row's Ships-via cites a real fragment record id from `package/install-surface/fragments/{hooks,router,manifest,enrichment,skills,private-boundaries}.json`, or `repo-native` where the shipping route is a tracked install script.

| Surface | Capability | Ships via | Class | Private deps |
|---|---|---|---|---|
| `package/adapters` | Per-client adapter hooks and generators (codex PromptProcessing shim, command-code AGENTS.md generator/validator, kimi UserPromptSubmit, opencode catalog guard + hook) | repo-native (`scripts/configure-opencode.sh`, `scripts/install-spine.sh`; codex/kimi adapters installed by their relay configurators) | COPY | none |
| `package/enrich` | Shared enrichment core (context sources, contract, resolver pipeline) | `enrichment.json` record `enrichment.public-pipeline` → installed by `scripts/install-pai.sh` to `$PAI_HOME/PAI/enrich` | COPY | none |
| `package/headless` | Non-executing EC2 shadow runtime: Hermes-shaped attempt envelope → policy route → skill resolution → typed proof decision | repo-native (`scripts/build-headless-shadow.sh`, `scripts/install-headless-shadow-archive.sh`, `scripts/capture-ec2-shadow-health.sh`) | COPY | none |
| `package/hooks` | Claude + Codex session hooks (PromptProcessing both clients; Codex GSDCommand, SessionStart) plus ParallelDispatchContext shell hook | `hooks.json` records `hooks.codex.prompt-processing`, `hooks.codex.gsd-command`, `hooks.codex.session-start`, `hooks.claude.prompt-processing`; `ParallelDispatchContext.hook.sh` wired by `scripts/wire-session-hook.sh` | COPY | none |
| `package/install-surface` | Manifest compiler/loader/doctor/path-policy/private-registry for the fragment set itself | repo-native (consumed at release-build time by `package/install-surface/src/cli.ts`; fragments in `fragments/`) | COPY | none |
| `package/manifest-bridge` | Local manifest bridge runtime: polls `.planning/NEXT-WAVE.json` + project manifests, serves console data on :8766 | `manifest.json` record `manifest.bridge-runtime`; LaunchAgent via `scripts/temperance-manifest-bridge-launchd.sh` | COPY | none (poll cwd resolved from bridge's own working directory since `cwd` field dropped) |
| `package/manifest-zone` | Manifest Zone UI (project state deck, register/action rails) rendered in the host spine console | `manifest.json` record `manifest.zone-project-state` (REGENERATE: host derives project state); source shipped for spine import via `scripts/install-spine.sh` (`MANIFEST_CONSOLE_ROOT`) | REGENERATE (+COPY of source) | none |
| `package/paseo` | Orchestration-preferences schema example consumed by the paseo native-routing design | repo-native (referenced by `scripts/omniroute-temperance-combos.sh`, `scripts/paseo-vault-projects.ts`) | COPY | none |
| `package/pulse-compat` | Pulse compatibility notify server (voice phase notifications) | repo-native (`scripts/install-pai.sh` installs `compat-server.ts` to `$PAI_HOME/PAI/PULSE/`) | COPY | none |
| `package/router` | Governed routing runtime: GSD rail map, command install, goal handoff, temperance-goal dispatcher | `router.json` records `router.governed-runtime`, `configuration.codex-managed-block` (TRANSFORM of `templates/codex.AGENTS.md`) | COPY / TRANSFORM | none |
| `package/skill-resolvers` | Logical skill-cluster resolver used by headless shadow runtime | repo-native (installed alongside clusters by `scripts/install-skill-clusters.sh`) | COPY | none |
| `skills/temperance-engine`, `skills/temperance-native`, `skills/temperance-algorithm`, `skills/temperance-parallel-dispatch` | The four Temperance skill packages (algorithm doctrine, native mode, engine skill, parallel-dispatch protocol) | `skills.json` records `skills.temperance-engine`, `skills.temperance-native`, `skills.temperance-algorithm`, `skills.temperance-parallel-dispatch` | COPY | none |
| `bin/temperance` | Operator entrypoint wrapper (record/repair-duplicates dispatch to repo tooling) | repo-native (resolved relative to clone root; not installed into `$HOME`) | COPY | none |
| `scripts/*.sh` (top-level script plane) | Installers (`install-*`, `configure-*`, `wire-*`), gateway operators (`omniroute-*`), lifecycle (`temperance-proxy*`, `*-launchd.sh`), verification (`verify-install.sh`, `verify-all.sh`), doctor (`temperance-doctor.sh`), docs continuity (`rebuild-readme.sh`, `readme-continuity-check.sh`) | repo-native (`install.sh` orchestrates; `install-spine.sh` installs spine pieces; launchd scripts self-install agents) | COPY | none |
| `templates/*` | Client identity templates (AGENTS.md variants, CLAUDE.md.template, cursor rules, opencode config patch) | `router.json` record `configuration.codex-managed-block` (TRANSFORM); others installed by `scripts/configure-opencode.sh` and identity apply scripts | TRANSFORM / COPY | none |
| Vault relocation tooling | Thoughtseed-vault-specific project relocation runtime + its 157-test suite | **NEVER-SHIP** — excluded from the public payload entirely (Phase 2 Plan 01); maintained in the operator-private overlay outside this repository. Appears here exactly once as the symbolic exclusion record; no source path is cited because no public path exists. | NEVER-SHIP | operator-private overlay |

## Coverage proof

Every directory emitted by the enumeration command appears above exactly once:
`package/adapters`, `package/enrich`, `package/headless`, `package/hooks`, `package/install-surface`, `package/manifest-bridge`, `package/manifest-zone`, `package/paseo`, `package/pulse-compat`, `package/router`, `package/skill-resolvers` — all 11 `package/*` dirs mapped; all four `skills/*` dirs mapped as one row citing four fragment records; `bin/temperance` mapped; every `scripts/*.sh` group mapped; all seven `templates/*` files mapped across two rows.

## Privacy statement

No row contains an absolute home path, volume path, username, session-store name, credential, or private-overlay filename. The relocation row documents exclusion without naming any overlay content. Zero mentions of any never-shipped enrichment stage file.
