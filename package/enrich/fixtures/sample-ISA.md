---
project: sample_fixture
effort: E3
phase: in-progress
---

## Problem

A sample ISA excerpt used by stage tests. It intentionally includes the sections
the guardrails/isaPointer stages parse, plus Anti-criteria under ## Criteria.

## Principles

- Paths must be generalized through `$HOME` and environment variables.
- Every enrichment stage is a pure function over ResolvedContext.
- Isolate all I/O to the single resolver; stages read, never fetch.

## Constraints

- The resolver must fail-open and never throw out of the pipeline.
- Memory fields carry PATHS only, never file contents.
- The context block must stay under a few short lines per stage.

## Out of Scope

Bundling private memory, credentials, or proprietary voice packs is out of scope.
Rewriting live operator surfaces in place (content replacement) is out of scope.

## Goal

Emit a compact, fail-open `<temperance-context>` block for every UserPromptSubmit event.

## Criteria

- [x] ISC-1: enrich() never throws.
- [ ] ISC-2: empty stage lines are dropped from the block.
- [ ] ISC-3 (Anti: the block must never contain raw file bodies, only pointers).
Anti: never scan `~/.agents/skill-clusters/skills` wholesale at startup.
Anti: never block the prompt; the hook is advisory-only.

## Verification

- `bun test` passes for all stage units.
