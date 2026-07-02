# Integrated System Hardening — Design (SP2 + SP3 + SP5 + SP1)

Date: 2026-07-02
Status: Approved design pending user review, pre-implementation
Branch: temperance-identity-port

## Context

A six-seam read-only audit of the live Mac mini runtime produced **36 gap findings**; a follow-up discovery pass found **~20 integrations** beyond the core stack (a second voice server, dead launchd jobs, secret sprawl, ~12 MCP servers, failing telemetry). The full scope is ~50 items across 7 sub-projects. This spec covers the four the user chose to do now, sequenced by risk:

1. **SP2 — Repo hardening** (temperance_engine; zero live risk; sandbox-tested; extends PR #2)
2. **SP5 — Dead-weight sweep** (live, low-risk, reversible)
3. **SP3 — Secrets & config hygiene** (live, sensitive; de-plaintext by us, rotation by user)
4. **SP1 — Voice reconciliation** (live, behavioral)

Deferred to later sub-projects (out of scope here): **SP4** codex parity (G5/G12/G13/G17), **SP6** PAI↔GSD arbitration (G9/G8/G21/G23), **SP7** skill-cluster USB single-point-of-failure (G10/G24/G25).

## Locked decisions

- **Voice target: peon-ping canonical, retire ElevenLabs `:8888`.** Revive peon-ping on `:31337`, launchd-persisted; point phase + completion signals at it; unload the ElevenLabs VoiceServer launchd job and stop using its key.
  - **TRADEOFF (confirm at review):** peon-ping plays canned mp3 sound *packs*, not spoken text. Retiring ElevenLabs means the Stop-hook "completion" signal becomes a peon pack sound, not a spoken summary. If spoken completions matter, choose "keep ElevenLabs as-is" instead.
- **Live changes are backup-first and reversible**; nothing touches the committed identity-port work or PAI methodology content.
- **Secret ROTATION is the user's action** — we remove plaintext and wildcard allowlists; the user rotates the exposed tokens.
- **Auth-required MCPs** (Higgsfield, PostHog, Supabase, claude.ai connectors) are left for the user to authorize via `/mcp` / connector settings — not touched here except where they generate dead-weight noise (SP5).

---

## SP2 — Repo hardening (temperance_engine)

Goal: the packaged installer is safe and its voice chain works, verifiable in the sandbox harness. All changes repo-side, appended to PR #2.

- **G1/G2 — packaged voice chain broken.** `package/pulse-compat/compat-server.ts` calls `peon.sh --pack X --category Y`, flags the real `peon.sh` rejects. Fix: correct the invocation to the real peon-ping CLI contract (determined from live `~/.claude/hooks/peon-ping/peon.sh` during planning). Add a harness assertion that the invocation matches peon.sh's accepted args.
- **G3 — installer can clobber live operator files.** A default `./install.sh` would overwrite `~/AGENTS.md` / `~/.config/opencode/AGENTS.md` with generic templates. Fix: `install-pai.sh` / `configure-opencode.sh` skip (with a printed warning) any target already containing a `temperance:identity` block or PAI doctrine marker, unless `--force`. Harness asserts a pre-populated target is preserved.
- **G4 — backup collision in `lib.sh`.** `backup_file` keys on basename+second, so same-named targets clobber. Fix: port the path-slug backup naming (already proven in `apply-identity.sh`) into `lib.sh backup_file`; update the harness restore assertion and add a same-basename collision regression.
- **G11/G20 — compat-server drift.** The repo server dropped `:8888` forwarding, `/health`, `/notify/personality`, path sandboxing. Given the live target is now peon-canonical, fix the repo server to match the intended peon-only contract and document what it deliberately omits (no silent behavior loss).
- **G26 — invalid template MCP command.** `templates/opencode.json.patch.json` uses `codegraph mcp`, which doesn't exist in codegraph 0.9.4. Fix: correct to the real subcommand (verified during planning) so a fresh install gets a working codegraph MCP.

Verification: `sh tests/sandbox-install.sh` green with new assertions; `./verify.sh` passes on a clean `git archive` checkout.
Rollback: git revert; repo-only.

---

## SP5 — Dead-weight sweep (live, low-risk)

Goal: remove dead/orphaned wiring that wastes cycles or skews telemetry. Each change backs up the edited file first.

- **N1 — Smart Focus Scheduler launchd job** fires 8×/day against a broken Shortcut. Fix: `launchctl bootout` + move the plist aside (backup).
- **N2/N3 — Hermes (`*.plist.removed`) and klear-karma (`*.plist.disabled`)** are already-disabled cruft. Fix: confirm not loaded; leave or archive per user (no active harm — lowest priority).
- **G32 — fieldtheory hooks** fire per-prompt / per-Read-Write-Edit for a nonexistent `~/.fieldtheory`. Fix: remove the two registrations from `settings.json` + `~/.codex/hooks.json` (scripts stay for re-enable).
- **G31 — double-registered ToolFailureTracker.** Remove it from the `Bash` matcher (catch-all already covers it) so failures aren't logged twice.
- **G33 — orphan hooks** (`VoiceCompletion.hook.ts`, `gsd-workflow-guard.js`, `gsd-statusline.js`) registered nowhere. Fix: leave files, note as intentionally-dormant (or wire `gsd-workflow-guard` if the setting is wanted — see SP6).
- **G16 — AgentOutputCapture 2MB unrotated debug log.** Fix: gate the debug writes behind an env flag and truncate the existing log.
- **G14 — MultiEdit skips SecurityValidator.** Add `SecurityValidator.hook.ts` to the MultiEdit matcher in both `settings.json` and `~/.codex/hooks.json` (or delete the matcher if MultiEdit is deprecated — verify at planning).
- **N5 — PostHog telemetry 91MB / 126 failed-event spool files.** Fix: clear the failed-event spool; confirm whether PostHog should stay enabled-but-unauthed (if unauthed indefinitely, disable the plugin to stop the spool growth) — surface to user.
- **G27 — CodeGraph index 3 weeks stale.** Fix: re-run `codegraph init -i` in `~/.agents` (or the incremental refresh command).
- **G22 — GSD 12 versions stale (1.30→1.42) + invisible update flag.** Fix: run the GSD update; note the `.gemini` cache-dir misdetection for SP6.

Verification: fresh session shows no fieldtheory spawns, single failure-log entry, MultiEdit gated, PostHog spool cleared, codegraph index mtime current, `gsd --version` ≥ 1.42.
Rollback: restore backed-up plists/config files; re-`launchctl bootstrap` if needed.

---

## SP3 — Secrets & config hygiene (live, sensitive)

Goal: no live API credentials sit in plaintext in agent config; allowlists don't embed tokens. We de-plaintext; **user rotates**.

- **G15 + sprawl.** Credentials found in plaintext across: `~/.claude/settings.json` (Meshy key, Cloudflare token, two `Authorization: Bearer` allowlist curls), `~/.claude/.env` (ElevenLabs key — becomes moot once `:8888` retired in SP1), `~/.codex/config.toml` `node_repl` env (Meshy key leak) and `[shell_environment_policy.set]`, and `~/.claude.json` / `config.toml` (Refero static bearer).
- Fix approach:
  1. Move `MESHY_API_KEY` (and any other real keys) to a single keychain/`.env` source read at runtime by the tool that needs it; remove from `settings.json` env, `node_repl` env, and `shell_environment_policy`.
  2. Replace token-bearing allowlist entries with wildcard forms (e.g. the existing `Bash(npx wrangler deploy:*)` makes the token-embedding entry redundant).
  3. Refero bearer: move to an env-sourced header if the MCP client supports it; otherwise document as an accepted local-only secret.
  4. **Flag for user rotation:** the exposed Cloudflare token, the co-property bearer, the Meshy key, and (if `:8888` retired) the ElevenLabs key — all should be rotated since they were in plaintext.

Verification: `grep` for the known key prefixes across the four files returns nothing; the tools that need keys still resolve them from the runtime source (smoke-test one).
Rollback: restore the backed-up config files.

---

## SP1 — Voice reconciliation (live, behavioral)

Goal: peon-ping is the single voice system, alive and persistent.

- **Revive peon-ping on `:31337`** and make it launchd-managed (`com.temperance.pulse-compat`, `KeepAlive`) using the live `~/.claude/PAI/PULSE/compat-server.ts` (peon-only, verified). Clear the stale PID first.
- **G19/G18 — protocol topology + user controls.** Repoint any consumer that must survive to `:31337`; make the compat server honor peon-ping's own controls (`.paused`, enabled flag, per-category toggles, rotation) instead of calling `afplay` directly and bypassing them.
- **Retire ElevenLabs `:8888`:** `launchctl bootout com.pai.voice-server`, move its plist aside (backup), stop referencing `ELEVENLABS_*`. (Ties to SP3.) **Completion signal becomes a peon pack sound** per the locked tradeoff.
- **G6 — dead VoiceGate hook** guards port `:8888` with a dead main-session check that blocks read-only `8888` commands while never gating the actual voice curls (which target `:31337`). Fix: remove/repair once `:8888` is retired.
- **G7/G29 — phase-detection contract.** Phase→pack + match strings are string-sniffed across ≥3 files with drift. Fix: extract one shared `phase-contract.json` (phase → pack → match-strings) consumed by the live server; align `docs/peon-ping-packs.md`. (Repo copy alignment folds into SP2.)
- **G30/G34 — dead `voice_id` payload.** Remove the ElevenLabs-era `voice_id` from live `CLAUDE.md`/Algorithm voice curls (ignored by the peon compat server).
- Also port the **ParallelDispatchContext hook + dispatch guide** to live (the original approach-B items) since they're voice-adjacent session wiring — hook to `~/.claude/hooks/`, registered in `settings.json` SessionStart (backup-first), guide to `~/.claude/PAI/PARALLEL-DISPATCH.md`.

Verification: `curl :31337/healthz` ok; a test `/notify` with "Entering the Observe phase." plays the glados pack and respects `.paused`; `:8888` no longer listening; new session emits the dispatch hook reminder in a `.planning/` project.
Rollback: `--remove` for identity is separate; for voice, restore the ElevenLabs plist + re-`bootstrap`, restore CLAUDE.md/settings.json from backups.

---

## Sequencing & gates

1. **SP2** fully (repo, no gate) → commit to PR #2 branch.
2. **SP5** (live, low-risk) → per-file backup; a single go/no-go before the batch of live edits.
3. **SP3** (live, sensitive) → go/no-go before edits; then user rotates flagged tokens.
4. **SP1** (live, behavioral) → go/no-go before retiring `:8888` and repointing voice.

Each live sub-project stops for explicit approval before its first write, consistent with the surgical/reversible discipline used for the identity port.

## Non-goals

- SP4 / SP6 / SP7 (deferred).
- Rotating secrets (user action).
- Authorizing the dead auth-required MCPs (user via `/mcp`).
- Any change to committed identity-port work, PAI methodology content, GSD internals, or skill-cluster contents.

## Verification (whole effort)

Per-SP verification above; plus a final re-run of the six-seam audit's cheap checks to confirm the fixed findings no longer reproduce, and `./verify.sh` green on a clean checkout.
