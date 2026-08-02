---
name: temperance-algorithm
description: Run complex PAI work through the seven Algorithm phases with S-tier coordination, bounded workers, ISA evidence, and explicit escalation.
license: MIT
compatibility: opencode
metadata:
  owner: temperance-engine
  mode: algorithm
  capability-tier: s-coordinator
---

# Temperance Algorithm

Use this skill only after PAI classifies the request as `ALGORITHM`.

## Entry

1. Read `~/.Codex/PAI/Algorithm/LATEST`.
2. Read the complete versioned Algorithm file it names.
3. Use the project `ISA.md` as the single acceptance ledger.
4. Follow the phase and response contracts from the loaded Algorithm exactly.

## Seven-phase portfolio map

| Phase | Portfolio | Responsibility |
|---|---|---|
| Observe | `te-reason` | Intent, state, constraints, unknowns |
| Think | `te-reason` | Assumptions, alternatives, systemic effects |
| Plan | `te-plan` | Deliverables, dependencies, acceptance, handoffs |
| Build | `te-build` | Reversible implementation design |
| Execute | `te-dispatch` | Bounded independent worker tasks |
| Verify | `te-validate` | Fresh evidence and adversarial checks |
| Learn | `te-reason` | Decisions, verification, reusable learning |

## Tier and escalation policy

- The primary Algorithm coordinator remains S-tier for the session.
- Use `temperance-planner` for read-only planning.
- Use `temperance-worker` for independent B-tier execution slices.
- Use `temperance-validator` for read-only or command-only verification.
- Worker escalation is one-way: `B → A → S`.
- Never silently downgrade S-tier coordination. Retry explicitly through the
  `temperance-continuity` posture when the S lane is unavailable.
- A worker downgrade requires a new task identifier and a new frozen plan.
- Maximum subagent depth is one. Workers must not spawn more workers.

## Ownership

PAI and Temperance own mode, effort, acceptance, and escalation. OmniRoute
selects and fails over only inside the already selected governed combination.
Skills provide behavior; they are not routing authorities. Concrete provider
and model attribution must remain visible in route evidence.

## Cost posture

Spend S-tier tokens on architecture, planning, orchestration, and hard
judgment. Delegate bounded mechanical work to B-tier workers. Use the explicit
A-tier continuity posture for quota or rate-limit recovery.
