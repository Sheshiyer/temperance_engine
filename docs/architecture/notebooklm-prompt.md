# NotebookLM prompt — Temperance Engine architecture (2026-08-17)

Use this after uploading `docs/architecture.md`, `docs/gsd-manifest-spine.md`, `docs/gsd-goal-handoff.md`, `docs/pai-flow.md`, and `docs/architecture/SERVICES.md` as sources.

```
Create a 10-12 slide presentation for Thoughtseed members about Temperance Engine as it exists after the 2026-08 spine refresh. The audience is operators who already use Codex or OpenCode and need to see the live glove, not a generic AI-agent pitch.

Tone & Style:
- Direct, operator-facing, no sales language
- Use the real names: Manifest Zone, /gsd:goal, te-dispatch-paid, Pulse, OmniRoute
- Never use the retired console name; the live name is Manifest Zone
- Never imply Manifest can approve or launch work
- Never imply GSD is vendored or Sol leads the fleet

Slide Structure:

Slide 1: Title
- Temperance Engine — member glove
- OpenCode/Cursor-first public install, --with-spine for members
- Thoughtseed Labs · 2026-08-17

Slide 2: The problem
- Local agent setups sprawl across hooks, skills, voice, and routing
- July diagrams no longer matched the Mini
- Members need one picture of picker → Manifest Zone → GSD → /goal

Slide 3: Two install paths
- Public: ./install.sh (OpenCode/Cursor, no Claude required)
- Member: ./install.sh --with-spine (Codex + GSD remotes + Manifest + Pulse)
- Neither copies secrets or vendors GSD 1.30.0

Slide 4: Native picker, then IAB
- If the session has no PAI mode, show MINIMAL / NATIVE / ALGORITHM tiles first
- After the pick, open ChatGPT in-app browser only at 127.0.0.1:5173
- Never Chrome or Safari for Manifest

Slide 5: Manifest Zone
- LCARS on :5173, bridge on :8766
- STATE / ROADMAP / GOAL cards, projection only
- Authority wall: no approve, no launch, no second swarm

Slide 6: GSD rail
- /gsd:* wrappers on Claude Code, Codex, OpenCode, Grok
- They read GSD 1.30.0; they do not fork it
- /gsd:doctor and /gsd:goal are Temperance-owned
- active_planner is isa or gsd

Slide 7: How a session runs
- UPS compose: one additionalContext envelope
- Plan with /gsd:plan-phase or writing-plans
- Execute needs next-wave approval + dual-fleet lock
- Fleet combo is te-dispatch-paid; Sol is babysit only

Slide 8: /goal is a loop, not a planner
- .temperance/goal.json (temperance.goal.v1)
- Text from ISA Goal or GSD STATE
- Evaluator reuses doctor/ISA probes
- Fail → continue the same /gsd:* · Pass → stop

Slide 9: Local services map
- Pulse :31337 peon for phases; Voice :8888 for other TTS
- OmniRoute :20128 + relay :20129
- Bridge :8766 + Manifest Zone :5173
- Hourly reconcile stays dry-run

Slide 10: What install never does
- Vendor GSD, copy API keys, --apply every combo
- Bind OmniRoute to LAN as the member default
- Make Sol a fleet head
- Let Manifest authorize work

Slide 11: How to see it
- Open docs/architecture/architecture.html
- Then spine-and-goal.html and session-trace.html
- Run /gsd:doctor and temperance-goal --eval

Slide 12: Next step
- Clone, ./install.sh --with-spine, ./verify.sh
- Point ~/.temperance_engine/product at this clone
- Keep secrets in Keychain; rotate if they leaked
```
