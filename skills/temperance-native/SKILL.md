---
name: temperance-native
description: Execute one bounded PAI Native-mode task quickly with proportionate verification and no orchestration overhead.
license: MIT
compatibility: opencode
metadata:
  owner: temperance-engine
  mode: native
  capability-tier: b-first
---

# Temperance Native

Use this skill only after PAI classifies the request as `NATIVE`.

## Contract

- Complete one bounded lookup, command, or single-surface change.
- Prefer the current session's `te-fast` coordinator.
- Use the configured B-tier small model for titles and summaries.
- Do not create an ISA, multi-step plan, agent team, or provider route.
- Verify the result with one direct probe proportionate to the action.
- If the work expands into design, debugging, multiple files, or orchestration,
  stop and escalate the request to the `temperance-algorithm` posture.

## Ownership

PAI and Temperance own mode selection. This skill supplies behavior only; it
does not select providers, modify OmniRoute combinations, or copy model
catalogs into the prompt.

## Output

Follow the repository's `NATIVE` response contract from `AGENTS.md`.
