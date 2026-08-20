# GSD HITL picker

GSD discuss/plan gates are **native picker cards**, not chat numbered lists.

Image of the intended surface: Codex CLI `AskUserQuestion` (arrow keys, Enter, `1`–`9`, `z` for Other). Grok Build uses the same contract via `ask_user_question`. OpenCode uses the `question` tool.

## Runtime → tool

**HITL seat ≠ execute seat.** Discuss/plan gates run on a picker-capable surface. Codex App babysits and executes after CONTEXT.md exists. Speculum (`:5173`) is glass — it does not own the answer.

| Surface | Tool | UI |
|---|---|---|
| Grok Build TUI | `ask_user_question` | Blocking question card. Tab/arrows, Enter, 1–9. **HITL seat.** Docs: `~/.grok/docs/user-guide/03-keyboard-shortcuts.md` |
| Claude Code | `AskUserQuestion` | Option tiles. **HITL seat.** |
| OpenCode TUI / app | `question` | Header + options; `permission.question = allow`. |
| Codex CLI | `AskUserQuestion` | Card **when the tool is on this turn’s list**. Probe; do not assume. |
| Codex App (ChatGPT desktop) | **none** (2026-08-20: discuss-phase stopped with “no AskUserQuestion control”) | Not a HITL seat. Write checkpoint; resume on Grok/Claude. |
| Speculum | none | Showcase of PLANNING. Does not replace the picker. |
| ChatGPT IAB | none | Opens Speculum URL. Not a picker. |

**Never** print `Reply 1, 2, or 3` on those surfaces.

### Missing picker on this turn

If the tool list has none of `AskUserQuestion` / `ask_user_question` / `question`: do not invent the tool, do not enable TEXT_MODE, write the discuss checkpoint, and resume `/gsd:discuss-phase N` on Grok or Claude.

Finish NOESIS/rail first **without listing choices**. Then call the picker tool. Options must not appear in PAI `CONTENT` / NATIVE body.

TEXT_MODE (plain numbered list) only when:
- user passed `--text`, or
- `workflow.text_mode: true`, or
- Claude `/rc` remote (App cannot forward TUI selections)

GSD's old note that "Codex has no AskUserQuestion" is **half-right for Codex App** and stale for Codex CLI. Do not treat vendor TEXT_MODE as permission to print numbered lists. Ignore `~/.codex/get-shit-done/` — wrappers read `~/.claude/get-shit-done`. The Temperance override is `GSD-TEXT-MODE-OVERRIDE.md`.

## Agent contract

1. Finish the rail/NOESIS/banner text first.
2. Then **call the picker tool**. Do not embed the options as markdown in the same bubble.
3. One question (or one Ask form) at a time unless the runtime card supports a multi-question walk (Grok and OpenCode do).
4. Mode pickers stay skipped after `/gsd:*` binds a mode. **Discuss gray-area questions still use the picker.**

## Config already set

- Grok: `~/.grok/config.toml` → `[toolset.ask_user_question] timeout_enabled = false`
- OpenCode: `~/.config/opencode/opencode.json` → `permission.question = allow`
- Init card: `rail-format.sh gsd-init discuss-phase`

## Verify

On Grok or Claude, `/gsd:discuss-phase` should show a blocking card. If you see `Reply 1, 2, or 3`, the agent skipped the tool (prompt miss). If Codex App says it has no `AskUserQuestion` control, that is a **missing widget** — checkpoint and resume on a HITL seat; do not print numbered lists.
