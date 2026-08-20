# GSD + Manifest spine

Themed page: [site/gsd-spine.html](site/gsd-spine.html) · library: [index.html](index.html)

This is the Thoughtseed-member glove. Public `./install.sh` stays OpenCode/Cursor-first. Members run:

```bash
./install.sh --with-spine
./verify.sh
temperance-project-init --cwd . --check   # same probe as /gsd:doctor
```

## What you get

| Piece | Where | Role |
|---|---|---|
| `/gsd:*` wrappers | `~/.codex/prompts`, `~/.config/opencode/command`, `~/.grok/commands`, `~/.claude/commands` | Thin remotes. They read GSD 1.30.0 workflows. They do not fork GSD. Claude also gets native `/goal`. |
| `/gsd:doctor` | same | Host + project truth: Pulse, bridge, bind, IAB pref, STATE, ISA, `active_planner`, ranker age |
| UPS compose | `package/hooks/codex` and `package/hooks/claude` PromptProcessing | One `additionalContext`: classifier + `<temperance-rail>` + `<gsd-rail>` + `<pai-mode-offer>` |
| Session start | `SessionStartTe.hook.ts` | If `.planning/` exists, prefer `/gsd:progress` |
| Manifest LCARS / Speculum | `package/manifest-zone` on `:5173` | Named: `https://speculum.localhost:1355`. One Vas registry id at a time (`?project_id=<hashed id>`; the folder slug `temperance_engine` is not the id). Projection. |
| Manifest bridge | `package/manifest-bridge` on `:8766` | Event plane. Heartbeat + 180s stale window. |
| Product symlink | `~/.temperance_engine/product` | Always this clone. Scripts must not read the vault archive. |

## Picker, then IAB

A chat reply with three bullets is **not** a picker. The native widget is:

| Surface | Widget | After a mode exists |
|---|---|---|
| Grok Build | `ask_user_question` question card (↑↓, 1–3, Enter) | Print the Manifest URL. Grok has no ChatGPT IAB. |
| Codex CLI / Codex app | `AskUserQuestion` option tiles | Open ChatGPT **in-app browser** only. Shares `~/.codex`. |
| Claude Code / Claude.app | `AskUserQuestion` option tiles | Same IAB rule. Shares `~/.claude`. |
| OpenCode.app | same tiles if the surface has them | Wrappers + `AGENTS.md` mode-bind. |
| Cursor.app | no UPS hook | alwaysApply rule + template mode-bind. |

Skip the picker when any of these already bound a mode:

- a `/gsd:*` command (`gsd-rail-map.json`: help=MINIMAL, doctor/fast=NATIVE, goal/plan/execute=ALGORITHM)
- a session pick already saved
- the classifier already said ALGORITHM (auto)

Then print `https://speculum.localhost:1355/?mode=…&view=PLANNING` (Grok). Codex/Claude IAB: `http://127.0.0.1:5173`. Never Chrome, Safari, or an external browser for Speculum. Default project is the bound planning set, not ALL PROJECTS.

Every mode still shows the seven alchemical steps. Skill clusters and workflows change with the mode.

## Active planner

`.temperance/project.json` should set `active_planner` to `isa` or `gsd`. Cambium uses `isa` because GSD v0.3 is a closed historical milestone — next command is `/gsd:complete-milestone`, not `/gsd:execute-phase`.

## Design flow

Mapped GSD digest/produce + PAI alchemy + live combo init:

[GSD-PAI-DESIGN-FLOW.md](./GSD-PAI-DESIGN-FLOW.md) — host copy `~/.temperance_engine/docs/GSD-PAI-DESIGN-FLOW.md`

On every `/gsd:*` start, print:

```
~/.temperance_engine/router/rail-format.sh gsd-init <command>
```

Brand: `~/.claude/get-shit-done/references/ui-brand.md` (alchemical sigils, no emoji).

## `/goal` session loop

`/gsd:goal` (and Claude native `/goal`) wraps execute until named probes pass. See [gsd-goal-handoff.md](gsd-goal-handoff.md). It does not replace GSD or next-wave.

## Dual-fleet lock

`/gsd:execute-phase` writes `~/.temperance_engine/state/fleet-locks/<cwd-hash>.json` when next-wave emits tasks. A second `gsd-executor` swarm on the same `[P]` ids is forbidden while the lock is active (<2h).

## What install never does

- Vendor GSD core
- Copy API keys or TOML secrets
- `--apply` OmniRoute combos
- Bind OmniRoute to LAN (doctor prints bind; loopback is the member default)
- Make Sol a fleet head

## Codex CLI vs Codex app

Both share `~/.codex`. The **CLI** does not support `"async": true` hooks (it prints a skip warning and never runs them). Spine hooks stay **synchronous**. See [codex-cli-limits.md](codex-cli-limits.md). Resume old CLI threads with `codex resume` / `codex resume --last`.
