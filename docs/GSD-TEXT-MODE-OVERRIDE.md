# GSD TEXT_MODE override (Temperance)

This file **wins** over any sentence in `~/.claude/get-shit-done/workflows/*.md` that says `AskUserQuestion` is unavailable on Codex, Grok, OpenCode, or “non-Claude runtimes.”

On `/gsd:*` wrappers, the **HITL picker section is last on purpose**. “Execute the upstream workflow exactly” does **not** authorize TEXT_MODE numbered lists. Do not Read `workflows/discuss-phase/modes/text.md` unless `--text` or `workflow.text_mode: true`.

That sentence is **void for numbered lists**. It does not mint a picker on Codex App.

| Surface | Picker |
|---|---|
| Grok | `ask_user_question` (HITL seat) |
| Claude Code | `AskUserQuestion` (HITL seat) |
| OpenCode | `question` |
| Codex CLI | `AskUserQuestion` only if present on this turn |
| Codex App | often **none** — checkpoint + resume on Grok/Claude; never `Reply 1, 2, or 3` |

HITL seat ≠ execute seat. Speculum is glass, not the owner of the answer.

## When TEXT_MODE is allowed

Numbered chat lists (`Reply 1, 2, or 3`) **only** if:

- the user passed `--text`, or
- `workflow.text_mode: true` in GSD config

Otherwise: native picker card. Never embed options in PAI `CONTENT`.

## Tool map

| Surface | Tool |
|---|---|
| Grok CLI / Grok Build | `ask_user_question` |
| Claude Code | `AskUserQuestion` |
| OpenCode TUI / app | `question` (`permission.question = allow`) |
| Codex CLI | `AskUserQuestion` if on the tool list |
| Codex App | none — resume HITL seat |

## Agent rules

1. Finish rail / NOESIS first with **no option list** in the bubble.
2. Then call the picker tool. One question per card unless the runtime walks a multi-question form.
3. Forbidden in chat: `Reply 1, 2, or 3`, `Question N of M` numbered markdown, `Reply with 1, 2, or 3`.
4. `/gsd:*` already binds PAI mode — do not quiz MINIMAL/NATIVE/ALGORITHM. Discuss/plan **gates still use the picker**.
5. After the user answers a card, the next gate is still a card. Do not fall back to numbered markdown mid-phase.

See also: `GSD-HITL-PICKER.md`.
