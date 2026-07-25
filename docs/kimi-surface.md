# Kimi surface (CLI + desktop app)

Kimi is wired as a Temperance client surface in two installations that share
one config schema:

- **kimi-cli** — `~/.kimi/config.toml` (repaired/upgraded via `uv tool install kimi-cli --force`)
- **Kimi desktop app** — the embedded daimon runtime at
  `~/Library/Application Support/kimi-desktop/daimon-share/config.toml`

Kimi was already a *dispatch backend* (the `kimi` CLI rail in
`temperance-batch`); this document covers the opposite direction — Kimi as a
*host surface* whose chats route through the governed Temperance lane.

## Why enrichment is relay-side here

Claude Code, Codex, and OpenCode inject the `<temperance-context>` block
client-side (prompt hooks / plugin). Kimi cannot: its hook runner parses
`UserPromptSubmit` stdout **only** for a `permissionDecision` — there is no
`additionalContext` injection (verified in kimi-cli 1.47.0 and 1.49.0,
`kimi_cli/hooks/runner.py`). The relay is therefore the injection seam:

```
kimi picks temperance/temperance-auto
  → provider custom_headers tag the request X-Temperance-Surface: kimi
  → temperance-openai-proxy (:20129)
      reads ~/.temperance_engine/kimi/session-context.json (hook-written cwd sidecar)
      runs the shared enrich({prompt, cwd, surface:"kimi"}) — fail-open, ≤2s
      prepends <temperance-context> to the LATEST user message only
      resolves the frozen route plan (classifier → portfolio)
  → OmniRoute (:20128) governed portfolios
```

Injection is gated strictly on the `kimi` header value so client-enriched
surfaces are never double-enriched. Outcomes are observable in
`~/.temperance_engine/state/openai-proxy.jsonl` (`surface`, `enrichment`,
`enrichment_cwd_source`, `prompt_hash_match`) and in the
`X-Temperance-Enrichment` response header.

## The hook (sidecar + telemetry)

`package/adapters/kimi/UserPromptSubmit.hook.sh` is registered in the Kimi
config and, on every prompt:

- writes `~/.temperance_engine/kimi/session-context.json`
  (`temperance-kimi-session-v1`: `session_id`, `cwd`, `ts`, advisory
  `prompt_hash`) so the relay can resolve the project's ISA/`.planning`;
- appends a `surface: "kimi"` line to
  `~/.claude/MEMORY/OBSERVABILITY/mode-classifier.jsonl`.

It always exits 0 with empty stdout — it can never block a prompt. **Known
limitation:** the sidecar is last-writer-wins across concurrent Kimi sessions;
the relay enforces a freshness TTL (`TEMPERANCE_KIMI_SESSION_TTL_MS`, default
120 s) and falls back to its own cwd, where the resolver's home-based ISA
discovery still applies.

## Enable / disable

```bash
# CLI (health-gates the relay first, incl. kimi enrichment capability)
./scripts/configure-kimi-relay.sh --dry-run
./scripts/configure-kimi-relay.sh enable          # + --set-default, --no-hook
./scripts/configure-kimi-relay.sh disable

# Desktop app (same core, parameterized)
./scripts/configure-kimi-desktop-relay.sh enable
./scripts/configure-kimi-desktop-relay.sh disable

# Readiness
./scripts/temperance-doctor.sh --require-kimi
```

Both scripts edit the user/app-owned TOML by appending **one marker-delimited
managed block** (`# --- temperance:managed:start (...) ---`) containing
`[providers.temperance]` (relay `:20129`, `X-Temperance-Surface: kimi` header),
`[models."temperance/temperance-auto"]`, and the pinned `omniroute/*` portfolio
models (see below), plus at most one tagged line
rewrite (the `hooks = []` line on the CLI; `--set-default` optionally). The
file stays byte-identical outside the managed region, and `disable` restores
it exactly (recorded originals live in the state markers under
`~/.temperance_engine/relay/kimi-provider.json` /
`kimi-desktop-provider.json`). Candidates are TOML-validated with bun before
the atomic write; a user-authored `[providers.temperance]` aborts the enable.

**Normalization caveat:** kimi-cli rewrites `config.toml` in its own canonical
serialization on every run — the temperance tables survive semantically, but
comments (including the managed-block markers) do not. The lifecycle handles
both states: while the state marker says the temperance tables are managed,
`enable` dedupes and `disable` removes them **by table header** (plus the
`[[hooks]]` entry whose `command` is the installed hook), so re-enable stays
idempotent and disable stays clean after any number of kimi runs. Byte-identical
restore therefore only applies before kimi first normalizes the file; the
doctor's `kimi_provider` check is likewise semantic, not marker-based.

`default_model` is never changed without `--set-default` — the governed lane is
opt-in from Kimi's model picker, exactly like OpenCode's.

## Pinned portfolios (`omniroute/*`)

**`temperance-auto` cannot reach a named portfolio from this surface.** The relay
pins any request carrying tools to `temperance-coding`
(`temperance-openai-proxy.ts`, source `tool-safe-compatibility`), and kimi always
sends tools. The classifier still runs and still resolves a portfolio — the
response carries `X-Temperance-Portfolio: te-build` — but the routed model is
`temperance-coding` regardless. That header is advisory on kimi.

Pinning a model by name is therefore the only way to select a portfolio here. It
takes the `explicit-picker-override` path (`mode: direct`), and **enrichment still
applies** — injection is gated on the surface header, not on route mode. `enable`
emits these five, all `tool_calling`-capable:

| Picker entry | Combo | ctx |
| --- | --- | --- |
| `omniroute/te-build` | `te-build` | 1048576 |
| `omniroute/te-validate` | `te-validate` | 200000 |
| `omniroute/te-fast` | `te-fast` | 200000 |
| `omniroute/best-coding` | `auto/best-coding` | 1048576 |
| `omniroute/best-reasoning` | `auto/best-reasoning` | 1048576 |

`te-reason`, `te-creative`, `te-plan`, and `te-dispatch` are deliberately absent —
they lack `tool_calling`, so they would degrade or fail on a surface that always
sends tools. `--no-combos` emits `temperance-auto` alone.

Two reasons these are managed rather than left to the user: they carry
`provider = "temperance"`, so a hand-authored copy becomes a dangling reference
the moment `disable` removes the provider; and being inside the block means an
app update that regenerates the config loses them together with everything else,
so one `enable` restores the whole lane. The `omniroute/` prefix (rather than
`temperance/`) is load-bearing — the user-authored guard refuses to enable when it
finds a `[models."temperance/…` table it did not write.

**Global tuning is not managed.** `[loop_control]`, `[background]`, and
`[mcp.client]` are app-owned; both shipped configs already define
`[loop_control]`, and emitting a second one is a duplicate-table TOML error that
`validate_toml` would reject. Step budget, retry count, and tool timeouts stay
hand-edited and are lost on a desktop app update — re-apply them after the
`enable` that recovers from drift.

## Skills matrix

kimi-cli merges skills across four scopes (Project > User > Extra > Built-in);
`merge_all_available_skills = true` merges all brand dirs.

| Scope | Path | How Temperance skills arrive |
| --- | --- | --- |
| Project | `<repo>/.agents/skills/` | Committed relative symlinks → `skills/` (work for any clone) |
| User (brand) | `~/.kimi/skills/` | `wire-multi-backend.sh` symlinks `temperance-engine`, `temperance-parallel-dispatch` |
| User (brand, merged) | `~/.claude/skills/`, `~/.codex/skills/` | Already present from the Claude/Codex installs |
| User (generic) | `~/.agents/skills/` | Skill-cluster hub tier (managed by `tier.mjs`) |
| Desktop | `daimon-share/daimon/skills/` | `wire-multi-backend.sh` copies (not symlinks) the same two skills |

`temperance-doctor.sh` (`kimi_skills` for the CLI, `kimi_desktop_skills` for
the app) verifies these resolve — the CLI check also catches the repo's
volume being unmounted when the clone lives on removable storage.

**Desktop skills are real copies, not symlinks — this is load-bearing.** The
daimon's skill scanner does not follow a symlink whose target lives on a
different volume/mount than `daimon-share` itself: every custom skill it
recognized before this fix resolved to a path on the boot volume
(`~/.agents/skills/...`); a symlink into a repo clone on another volume
(e.g. a repo clone on removable storage) was silently invisible to it, even though `test -e`,
`readlink -f`, and kimi-cli's own (Python-based) skill loader all resolved the
exact same symlink without issue. `wire-multi-backend.sh` therefore installs
the desktop copies via `copy_skill_dir()`: it refreshes them idempotently on
every run, tags each with a `.temperance-managed` marker so a same-named user
skill is never clobbered (foreign content is backed up, not deleted), and
`--revert` only removes copies that carry that marker. If the repo skill
content changes, re-run `./scripts/wire-multi-backend.sh` to refresh the
desktop copy — it does not update automatically like the CLI's symlink does.

## Desktop app caveats

- The daimon config is **app-managed** (`.kimi-provisioned`,
  `plugin-gateway-managed.json`): an app update may regenerate it and drop the
  managed block. The state marker records `config_sha256`; the doctor's
  `kimi_desktop_drift` check flags divergence, and re-running
  `configure-kimi-desktop-relay.sh enable` is the idempotent recovery.
- The desktop hook copy lives at
  `~/.temperance_engine/kimi/hooks/temperance-user-prompt-submit.sh` — outside
  the app directory — so it survives app updates.
- The daimon config contains a plaintext `api_key`; the configure scripts never
  print config contents, and backups are written `chmod 600` in a `700` dir.
- Which daimon config file the runtime authoritatively loads was probed
  behaviorally at enable time; override with `TEMPERANCE_KIMI_DESKTOP_CONFIG`
  if an app update moves it. **It has moved** — see below.

## Desktop app 3.1.5: the agent kernel is not kimi-cli

Verified 2026-07-25 against Kimi.app 3.1.5 / daimon-bundle 0.5.49. The desktop
agent kernel is **`@moonshot-ai/agent-core`** (bundled JS), not the Python
kimi-cli. The two share a config *shape* but not a config *schema*, and the
runtime logs its real path on every start:

```
daimon/logs/adapter.log:
  startup kimi-code paths homeDir=…/daimon/runtime/kimi-code/home
                          configPath=…/daimon/runtime/kimi-code/config.toml
```

`daimon/config.json` → `agents.defaults.agentFile` names the same file.
`daimon-share/config.toml` — the file `configure-kimi-desktop-relay.sh` targets —
appears **zero** times in any log. The managed block therefore sits in a file the
app never reads: on 3.1.5 the desktop lane is inert, even though `enable`
succeeds and every sha/state check stays green. `temperance-doctor.sh` now
detects exactly this as `kimi_desktop_target` (warn-level; the CLI lane is
unaffected).

**Do not "fix" it by repointing `TEMPERANCE_KIMI_DESKTOP_CONFIG` at the
agentFile.** agent-core does not implement the provider shape we emit — zero
occurrences of `openai_legacy` or `custom_headers` in the bundle — and it carries
strict schemas, so writing our block there risks breaking app startup. Routing
the desktop app through the relay needs a provider shape agent-core actually
accepts (`openai` / `anthropic` / `kimi`), which is unbuilt.

**What agent-core supports in that config is much narrower than kimi-cli.** Its
`loop_control` implements `max_steps_per_turn` only:

| key | kimi-cli | agent-core |
| --- | --- | --- |
| `loop_control.max_steps_per_turn` | yes | **yes** |
| `loop_control.max_retries_per_step` | yes | no |
| `loop_control.max_ralph_iterations` | yes | no |
| `loop_control.reserved_context_size` | yes | no |
| `loop_control.compaction_trigger_ratio` | yes | no |
| `background.*` | yes | no |
| `mcp.client.tool_call_timeout_ms` | yes | no |

The familiar `Turn exceeded maxSteps=N. If max_steps_per_turn is too small,
raise it in config.toml (loop_control.max_steps_per_turn)` message is emitted by
agent-core — so that error on the desktop app is fixed in
`daimon/runtime/kimi-code/config.toml`, not in `~/.kimi/config.toml`. Keep hand
edits there to supported keys: the daimon rewrites that file on startup
(`sync=updated`), and unsupported tables are at best ignored and at worst a
strict-schema startup failure.

## Rollback

`disable` on either script restores the config exactly and removes the hook
copy + state marker. Timestamped config backups live under
`~/.temperance_engine/backups/`. The wire-level skill links revert with
`./scripts/wire-multi-backend.sh --revert`.
