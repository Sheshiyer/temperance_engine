# Temperance Engine Planning Spine

Temperance Engine is the public/packageable operator surface for PAI. This
planning directory makes the product-engineering workflow explicit without
creating a second source of authority.

## Authority Order

1. `ISA.md` is the judge of accepted scope, criteria, decisions, and verification.
2. `docs/superpowers/specs/` is the Speckit-style design source for ratified surfaces.
3. `docs/superpowers/plans/` is the execution source when a ratified spec exists.
4. GSD phases organize work in flight; they do not ratify speculative surfaces.
5. CI proves the repo state through `scripts/verify-all.sh`.

## Product Intent

The product target is a unified thought-seed digital coworking space with an
assistant-first interface, a clear tool harness, and a repo workflow that turns
system understanding into shipped, verified increments.

## Active Guardrails

- Do not map design-only or pending-review specs into active GSD phases.
- Do not add a new preference store beside `ISA.md`.
- Do not vendor local PAI memory, private credentials, or local-only model access.
- Keep `.planning` descriptive and auditable; runtime behavior must still fail open.
