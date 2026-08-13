# Orchestration Gap Register

Status is deliberately split between the safety slice addressed here and the remaining hardening work.

## Mapping and autonomy

1. [done] Name the generated skill index as resolution authority.
2. [done] Persist a plan and policy fingerprint.
3. [done] Distinguish automatic use from advisory injection.
4. [next] Unify classifier and portfolio task taxonomies.
5. [next] Fail CI on unmapped classifier outputs.
6. [next] Replace router sibling fallback with an explicit location contract.
7. [next] Emit `routing: degraded` instead of fabricated defaults.
8. [next] Type suggested skill, confidence, and activation requirement.
9. [next] Generate cluster README counts from the index.
10. [next] Make cluster reference audit a release gate.

## Research and planning

11. [done] Define machine-readable research and option input.
12. [done] Project options into the event plane.
13. [done] Keep recommendation distinct from selection.
14. [next] Require option costs, risks, dependencies, and rollback details.
15. [next] Require evidence citations for every recommendation.
16. [next] Add explicit revision/supersession relationships.
17. [next] Prevent approval of more than four options.
18. [next] Add research quality and recency checks.
19. [next] Add plan diff rendering between revisions.
20. [next] Let Swarm Architect emit the option contract natively.

## HITL and command authority

21. [done] Replace unconditional next-wave auto-dispatch policy.
22. [done] Add an expiring, plan-bound approval receipt.
23. [done] Keep UI approval from launching workers.
24. [done] Reserve approval and dispatch kinds from generic event ingestion.
25. [next] Authenticate the local approval command.
26. [next] Add reject and request-revision commands.
27. [next] Invalidate grants on plan or evidence revision.
28. [done] Use a transactional PostgreSQL control ledger, not JSONL, for claims.
29. [next] Add approval roles and delegated authority.
30. [next] Record consent text and operator intent.

## Swarm execution

31. [done] Block task-file creation without approval.
32. [done] Bound proposed concurrency to four.
33. [done] Preserve worktree requirement on parallel option.
34. [done] Atomically claim a single-use approval before dispatch.
35. [done] Revalidate Git head and source fingerprints at claim time.
36. [done] Revalidate a fresh quota snapshot at claim time.
37. [next] Enforce clean worktree and allowed project roots.
38. [next] Disallow backend/model overrides under a receipt.
39. [done] Add a lease and cancellation semantics; timeout/retry remain next.
40. [next] Require receipts for each task and dispatch terminal state.

## Event plane and visual system

41. [done] Project plans, approvals, skills, dispatches, and reports separately.
42. [done] Show an operator Decision Deck with explicit action.
43. [done] Make stale/offline telemetry a blocker, not a quiet state.
44. [done] Fix completed agents being shown as active.
45. [done] Apply `fresh_until` when ingesting an event.
46. [next] Add deterministic idempotency for id-less events.
47. [next] Add typed schema validation and version compatibility tests.
48. [next] Add accessibility/contrast, focus, aria-live, and touch-target checks.
