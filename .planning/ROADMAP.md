# GSD Roadmap

This roadmap maps only ratified work into GSD phases. Pending design surfaces
stay visible in `REQUIREMENTS.md` but do not become active execution phases.

## Active Milestone: Product-Engineering Workflow Hardening

Ratification source: operator request on 2026-07-09.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | Resolver planning-state flip | Current repo behavior and advisor flag | Tests name `.planning` absent and present contracts |
| Think | Product workflow authority | `ISA.md`, approved specs, current plans | `.planning/` records authority order and ratification policy |
| Plan | Ratified GSD mapping | `.planning/REQUIREMENTS.md` | Only ratified surfaces are mapped into active phases |
| Build | Verification spine | `scripts/verify-all.sh`, `.github/workflows/verify.yml` | Full local and CI verification use one script |
| Execute | Package hardening checks | Existing tests plus `bun test package/enrich` | `scripts/verify-all.sh` exits 0 |
| Verify | ISA continuity | `ISA.md` ISC-41..ISC-48 | Criteria and verification evidence are recorded |
| Learn | Future work intake | Pending specs in `REQUIREMENTS.md` | Deferred surfaces require explicit ratification before execution |

## Ratified Completed Surfaces

| Surface | Ratified source | Current state | ISA link |
|---|---|---|---|
| Public package baseline | `docs/plans/2026-06-12-temperance-engine.md` | Implemented and verified | ISC-1..ISC-27 |
| Temperance identity port and installer layering | `docs/superpowers/specs/2026-07-01-temperance-identity-port-design.md`; `docs/superpowers/plans/2026-07-01-temperance-identity-port.md` | Implemented and verified | ISC-33, ISC-34 |
| Unified PAI/GSD flow | `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md`; `docs/superpowers/plans/2026-07-05-unify-orchestrators-A-F.md` | Implemented and verified in `docs/pai-flow.md` | ISC-35..ISC-38 |
| Unified routing brain | `docs/superpowers/specs/2026-07-05-unify-routing-brains-design.md`; `docs/superpowers/plans/2026-07-05-unify-routing-brains.md` | Implemented and verified in router tests | ISC-39, ISC-40 |
| Routed parallel dispatch bridge | `docs/superpowers/specs/2026-07-04-routed-parallel-dispatch-bridge-design.md`; `docs/superpowers/plans/2026-07-04-routed-parallel-dispatch-bridge.md` | Completed dependency, reference only for new work | ISC-28..ISC-31 by superseded dispatch guidance |

## Deferred Until Ratified

These surfaces are important context, but they are not active GSD phases from
this directory until their specs are explicitly approved for implementation.

| Surface | Current repo document | Reason deferred |
|---|---|---|
| Integrated system hardening | `docs/superpowers/specs/2026-07-02-integrated-system-hardening-design.md` | Status says pending user review |
| GSD hook wiring and external project conversion | `docs/superpowers/plans/2026-07-06-gsd-hook-wiring-and-ratandevelopers-conversion.md` | Plan exists without a ratified local spec |
