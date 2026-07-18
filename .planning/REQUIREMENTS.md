# Ratification Requirements

`.planning` is an execution map, not a design authority. A surface can become
an active GSD phase only when at least one ratification signal is present.

## Ratification Signals

- `ISA.md` contains checked criteria for the surface.
- A spec in `docs/superpowers/specs/` has an approved or ratified status.
- The operator explicitly asks for the surface to be implemented in the current
  repo, as with the 2026-07-09 workflow-hardening request.

## Mapped Surfaces

| Surface | Status | Active in `.planning` | Source |
|---|---|---:|---|
| Product-engineering workflow hardening | Ratified by operator request | yes | 2026-07-09 request |
| Public package baseline | Ratified by checked ISA criteria | yes, as completed reference | `docs/plans/2026-06-12-temperance-engine.md` |
| Temperance identity port and installer layering | Approved design and implemented | yes, as completed reference | `docs/superpowers/specs/2026-07-01-temperance-identity-port-design.md` |
| Unified PAI/GSD flow | Ratified by checked ISA criteria | yes, as completed reference | `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md` |
| Unified routing brain | Ratified by checked ISA criteria | yes, as completed reference | `docs/superpowers/specs/2026-07-05-unify-routing-brains-design.md` |
| Routed parallel dispatch bridge | Completed dependency and reference-only bridge | no new active phase | `docs/superpowers/specs/2026-07-04-routed-parallel-dispatch-bridge-design.md` |
| Integrated system hardening | Approved design pending user review | no | `docs/superpowers/specs/2026-07-02-integrated-system-hardening-design.md` |
| GSD hook wiring and external conversion | Plan exists, no ratified local spec | no | `docs/superpowers/plans/2026-07-06-gsd-hook-wiring-and-ratandevelopers-conversion.md` |

## Verification Requirements

- Resolver tests must cover `.planning` absent and present.
- Docs continuity must assert the planning spine exists and names GSD, Speckit,
  ratified surfaces, and `scripts/verify-all.sh`.
- CI must call `scripts/verify-all.sh` for package verification.
