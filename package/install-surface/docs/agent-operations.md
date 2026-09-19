# Agent and human operator flow

The guided TUI and headless commands share `wizard.ts`, its action IDs, and its
dependency gates. Neither renderer is an alternative permission system.
Noesis is optional; omit personal profile/binding arguments on a generic host.

Run from `package/install-surface` in the reviewed Temperance source checkout:

```sh
# Human or agent-controlled PTY: arrow keys and Enter; d health, l local logs.
bun src/cli.ts onboard --tui --telemetry

# Agent: enumerate the same ordered steps and currently enabled actions.
bun src/cli.ts onboard --agent
bun src/cli.ts onboard --agent --step host --action continue

# Fresh eligibility, management observations, install doctor, session admission.
bun src/cli.ts onboard --health --json

# Existing low-level doctor remains available; read-only, no implicit repair.
bun src/cli.ts doctor --report v2 --section install --json
bun src/cli.ts doctor --report v2 --section runtime --json

# Local operator events, never raw provider/service logs.
bun src/cli.ts onboard --logs --json --limit 50
```

Add the same `--catalog`, `--host-profile`, `--host-binding`,
`--project-capsules`, and `--wizard-state` inputs to TUI/agent/health invocations
when using a personal overlay. Do not include these inputs with `--logs`.
`--project-capsules-out` is supported only with TUI/agent; in agent mode it
declares a possible save destination but **does not write to it**.

## Agent instructions

1. Run `onboard --agent` with the explicitly selected profile inputs. Parse JSON;
   do not scrape ANSI output as the authoritative state.
2. Read `steps`, `step`, `state`, and `actions`. Use only an enabled action ID
   returned for that step. Never invent a shell command from display text.
3. Submit one `--action ID`. Carry returned `state.step` using `--step`,
   `selected_candidate_ids` using comma-separated `--project-select`, and
   `requested_module_ids` using comma-separated `--select` into the next call.
   To represent an explicitly empty module set, use `--select ,`.
4. Navigation and pending project selections are transient. Module selection
   and deferral invoke the same fresh dependency planner as the TUI. `refresh`,
   `health`, and `logs` are read-only actions; health/log results are included
   in the response. No action here persists approvals or activates an organ.
5. On `handoff.status=required`, stop automation at that boundary. Provider
   sign-in, combo seating/review, project saving, and final confirmation return
   to `onboard --tui --step STEP` with the same pending-state arguments.
   Ask the operator to complete sign-in or the exact-change review. Do not
   send confirmation keystrokes merely because an action is enabled.
6. After handoff, re-read state and run health. An observation is not an
   admission receipt; never infer a working 1M session from model/alias counts.

Agents can run the TUI through a supported PTY and send arrow/Enter keys for
navigation and inspection. Use the JSON interface for reliable unattended reads.
This does not authorize bypassing host computer-use restrictions or interacting
with a user's unrelated terminal sessions.

## Health meanings

- Dependencies report prerequisite eligibility, not active organ operation.
- Routing distinguishes adapter version, live management access, provider
  catalog records, and live model counts. Alias draft choices are not proof
  of persisted combo membership; selected-module admission supplies actual
  alias prerequisite holds.
- Install checks use the existing read-only doctor and reviewed inventory.
- Session admission checks the selected optional local policy. An absent
  policy is not proof of context capacity. The current gateway adapter hold
  remains visible. No inference request is sent by these commands.
- Obsidian application presence does not prove its tunnel/dashboard health.
  This feature does not add automatic remediation, a health server, or a
  background monitoring daemon.

`--health` exits 0 only when its required configuration checks pass; 1 means
held/unavailable. `--agent` exits 0 for a valid projection, even with disabled
actions or required handoffs: inspect the JSON, not just the process exit.
Invalid arguments/actions return 64 with a safe reason code.

## Local telemetry and logs

`--telemetry` opts in per TUI/agent/health invocation. It records only fixed
event/action names, step, outcome, duration, numeric counts, timestamp, and a
random run ID. No prompts, project paths, credentials, provider responses,
connection identifiers, callback URLs, or model outputs are logged.

Storage is `${TEMPERANCE_STATE:-$HOME/.temperance}/operator-events/events.v1.jsonl`.
The directory is owner-only (0700), the file owner-only (0600); the ring is
bounded to 1 MiB and 4096 events. Old events age out locally. There is no export
or network destination. `--logs` is read-only and does not create missing state.
Use `--run UUID` to filter a session; `--limit` accepts 1–200.

Unsafe or malformed log files are rejected, not dumped or overwritten. If
recording fails, the operation result reports telemetry `unavailable`; runtime
configuration is not reported failed solely because optional telemetry failed.
These events aid debugging but are **not authorization or recovery receipts**.
Existing governed mutation receipts retain their separate authority.
