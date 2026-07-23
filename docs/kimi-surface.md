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
`[providers.temperance]` (relay `:20129`, `X-Temperance-Surface: kimi` header)
and `[models."temperance/temperance-auto"]`, plus at most one tagged line
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

## Skills matrix

kimi-cli merges skills across four scopes (Project > User > Extra > Built-in);
`merge_all_available_skills = true` merges all brand dirs.

| Scope | Path | How Temperance skills arrive |
| --- | --- | --- |
| Project | `<repo>/.agents/skills/` | Committed relative symlinks → `skills/` (work for any clone) |
| User (brand) | `~/.kimi/skills/` | `wire-multi-backend.sh` symlinks `temperance-engine`, `temperance-parallel-dispatch` |
| User (brand, merged) | `~/.claude/skills/`, `~/.codex/skills/` | Already present from the Claude/Codex installs |
| User (generic) | `~/.agents/skills/` | Skill-cluster hub tier (managed by `tier.mjs`) |
| Desktop | `daimon-share/daimon/skills/` | `wire-multi-backend.sh` symlinks the same two skills |

`temperance-doctor.sh` (`kimi_skills`) verifies the links resolve — which also
catches the repo's volume being unmounted when the clone lives on removable
storage.

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
  if an app update moves it.

## Rollback

`disable` on either script restores the config exactly and removes the hook
copy + state marker. Timestamped config backups live under
`~/.temperance_engine/backups/`. The wire-level skill links revert with
`./scripts/wire-multi-backend.sh --revert`.
