# GSD + PAI design flow

GSD stays the planner/executor. PAI (Temperance) binds mode, alchemy, OmniRoute combo, Manifest view, and the `/goal` loop. This file is the mapped design flow. Live init card: `rail-format.sh gsd-init <command>`. Brand: `~/.claude/get-shit-done/references/ui-brand.md`.

## Digest and produce

```
digest                          produce
------                          -------
ISA ## Goal  or                 .temperance/goal.json
GSD .planning/STATE.md    -->   text · planner · gsd_command · evaluator
/gsd:goal --ensure              /gsd:goal --eval
                                pass -> stop
                                fail -> same /gsd:* continues
```

CLI: `node ~/.temperance_engine/router/temperance-goal.mjs --cwd . --ensure|--eval`

Do not invent a third goal. `active_planner=isa` reads ISA. Else STATE.

## Lifecycle (PAI inside GSD)

```
♄ OBSERVE   /gsd:new-project  /gsd:map-codebase  /gsd:goal --ensure
            combo te-reason   Manifest PLANNING

☿ THINK     /gsd:discuss-phase  /gsd:research-phase  /gsd:discovery-phase
            combo te-reason

☉ PLAN      /gsd:plan-phase  /gsd:ui-phase  /gsd:add-phase
            combo te-plan    (complex -> te-plan-max via classify)

♃ BUILD     sequential plans on te-build (non-[P])

♂ EXECUTE   /gsd:execute-phase
            combo te-build -> te-dispatch-paid
            [P] waves: temperance-next-wave + temperance-batch
            lock: ~/.temperance_engine/state/fleet-locks/<cwd-hash>.json
            banner: ♂ GSD · RUBEDO · EXECUTE · WAVE n/m

♀ VERIFY    /gsd:verify-phase  /gsd:review  /gsd:validate-phase
            combo te-validate

☽ LEARN     /gsd:complete-milestone  /gsd:goal --eval
            combo te-reason
```

Authority: GSD workflows under `~/.claude/get-shit-done/workflows/`. Wrappers do not fork them.

## Combo and model map

Source of command -> combo: `~/.temperance_engine/router/gsd-rail-map.json`

| Group | Commands (examples) | Combo | Alchemy |
|---|---|---|---|
| init | new-project, map-codebase, goal --ensure | te-reason | OBSERVE / THINK |
| plan | discuss-phase, research-phase | te-reason | THINK |
| plan | plan-phase, ui-phase, add-phase | te-plan | PLAN |
| execute | execute-phase, execute-plan, autonomous | te-build then te-dispatch-paid | EXECUTE |
| execute | quick | te-build | BUILD |
| execute | fast | te-fast | -- |
| verify | verify-phase, review, add-tests | te-validate / te-build | VERIFY / BUILD |
| ops | goal --eval, complete-milestone | te-reason | LEARN / EXECUTE |

Live seats (not the map) come from OmniRoute `combos` via `sync-provider-fleet` / `rank-paid-fleet` / `classify-route.py`.

- Capacity heads: Trae / OpenRouter free / Spark / Command Code promo only
- Paid fleet: `te-dispatch-paid` ranked from CodexBar + snapshots
- Max pin: `te-plan-max` (Fable / Sol-max) -- never a default GSD execute head
- Media: `te-write-media` plans; elevenlabs / runway stay native endpoints

## Shown at init

Every `/gsd:*` start must print the init card (no emoji):

```
~/.temperance_engine/router/rail-format.sh gsd-init execute-phase
```

Example:

```
+--------------------------------------------------------------+
| ♂ GSD · RUBEDO · EXECUTE · /execute-phase                    |
| mode ALGORITHM · combo te-build → te-dispatch-paid · EXECUTION |
+--------------------------------------------------------------+
  ·  group     execute
  ·  alchemy   EXECUTE
  ·  workflow  ~/.claude/get-shit-done/workflows/execute-phase.md
  ·  goal      active · <one sentence>
  ·  stack     te-build
     > 1  trae/work
       2  cursor/composer-2.5
  ·  stack     te-dispatch-paid
     > 1  cursor/composer-2.5
       2  claude/claude-sonnet-5
  ·  fleet     temperance-next-wave + te-dispatch-paid
```

Hooks inject the same facts as `<gsd-rail>` (`GsdCommand.hook.ts` / PromptProcessing). Manifest URL: `http://127.0.0.1:5173/?mode=…&view=…&gsd=…`.

## HITL seat ≠ execute seat

Discuss/plan gates run on Grok TUI or Claude Code (`ask_user_question` / `AskUserQuestion`). Codex App often has no picker — write a checkpoint and resume on a HITL seat; do not print `Reply 1, 2, or 3`. Speculum (`:5173`) showcases PLANNING; it does not own the answer. See [GSD-HITL-PICKER.md](GSD-HITL-PICKER.md).

## What this flow must not do

- Fork GSD 1.30.0
- Spawn a second gsd-executor swarm on locked `[P]` ids
- Auto-approve next-wave
- Put Sol/Fable on te-fast / te-build / te-swarm-s
- Copy `storage.sqlite` as a backup
- Use Chrome/Safari for Manifest
