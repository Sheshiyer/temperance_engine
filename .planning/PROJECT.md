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

## Core Value

A fresh local machine can reproduce verified Temperance behavior from the
public repository without inheriting the developer workstation's private state.

## Current Milestone: v1.1 Public Temperance Glove

**Goal:** Turn this repository into the portable source authority for a
downloadable, locally operated Temperance Engine without distributing
workstation-specific or private runtime state.

**Target features:**

- A versioned install-surface provenance manifest shared across installation,
  update, doctor, verification, rollback, and uninstall.
- Reconciled router, hooks, Manifest Bridge, Manifest Zone, enrichment, and
  complete Temperance skill packages.
- Manifest-driven lifecycle operations with backup-first upgrades, safe managed
  configuration blocks, platform service templates, and reversible uninstall.
- Continuous README, Quickstart, architecture, rollback, security, contributor,
  changelog, and documentation-site guidance.
- Clean-host qualification, reviewable release slices, provenance checks, and
  canonical verification.

## Requirements

### Validated

- The Mac mini reference installation already proves the product-root symlink,
  four-surface mode binding, Manifest Zone, Pulse compatibility, and governed
  local routing can coexist.
- The repository audit classifies installed surfaces as COPY, TRANSFORM,
  REGENERATE, or NEVER-SHIP and records the known source/runtime drift.

### Active

- [ ] Define one versioned provenance contract for every installed surface.
- [ ] Converge public product source without copying private runtime state.
- [ ] Make install, update, doctor, rollback, and uninstall consume one inventory.
- [ ] Keep public documentation synchronized with real commands and lifecycle behavior.
- [ ] Qualify macOS as release-blocking and Linux as best-effort compatibility.
- [ ] Produce reviewable commits and a clean-clone release verification receipt.

### Out of Scope

- Private OmniRoute authority, databases, logs, histories, receipts, backups,
  provider sessions, and personal PAI memory — host state is never product payload.
- Public promotion of `atlasRecall.ts` — it remains a private operator overlay
  unless a later milestone proves generic inputs and fixtures.
- Linux release parity — compatibility is exercised and documented, but macOS
  remains the release-blocking platform for v1.1.
- Cloudflare, Hermes Apply, MCP/A2A, EC2, and genuine-S promotion — these remain
  separately governed external-authority gates.

## Active Guardrails

- Do not map design-only or pending-review specs into active GSD phases.
- Do not add a new preference store beside `ISA.md`.
- Do not vendor local PAI memory, private credentials, or local-only model access.
- Keep `.planning` descriptive and auditable; runtime behavior must still fail open.

## Context

The ratified intake is
[`docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md`](../docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md).
It records the dirty working reference installation, source/runtime parity and
drift, publication boundaries, seven logical workflow stages, documentation
workstream, lifecycle map, verification matrix, and five intended commit slices.

The earlier `public-ready-docs-glove` and
`full-native-integration-completion-audit` labels are retained as historical or
held context. Neither is falsely marked completed by this transition.

## Constraints

- **Authority:** `ISA.md` remains the acceptance judge; GSD organizes ratified work.
- **Safety:** Private runtime state and absolute workstation paths never enter public payloads.
- **Platform:** macOS is release-blocking; Linux qualification is best-effort for v1.1.
- **Overlay:** `atlasRecall.ts` remains private unless later generic evidence promotes it.
- **Workflow:** `workflow.auto_advance=false`; phase and release transitions require explicit review.
- **Baseline:** The existing `verify.sh` path-hygiene failure must be closed during source convergence.

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Start `v1.1 Public Temperance Glove` as the sole active milestone | Reconcile conflicting config, STATE, and ROADMAP labels without inventing completion | ✓ Ratified 2026-08-19 |
| Preserve earlier milestone bodies as historical/held context | Their evidence and external gates remain useful but are not the current queue | ✓ Ratified 2026-08-19 |
| Make macOS release-blocking and Linux best-effort | Match the working reference platform while still testing portability | ✓ Ratified 2026-08-19 |
| Keep `atlasRecall.ts` private | Avoid shipping personal memory coupling without generic fixtures | ✓ Ratified 2026-08-19 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):

1. Move invalidated requirements to Out of Scope with reasons.
2. Move verified requirements to Validated with phase references.
3. Add newly discovered active requirements explicitly.
4. Record decisions that constrain later phases.
5. Recheck that Product Intent and Core Value remain accurate.

**After each milestone** (via `$gsd-complete-milestone`):

1. Review every requirement and decision.
2. Recheck the Core Value.
3. Audit Out of Scope and its reasons.
4. Update Context with the verified product state.

---
*Last updated: 2026-08-19 after v1.1 milestone intake confirmation*
