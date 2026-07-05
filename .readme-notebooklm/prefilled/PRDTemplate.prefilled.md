# Temperance Engine — Prefilled PRD

# PRD Template

## 1. Document Control
- PRD Version: 0.1
- Status: Draft / Review / Approved / Superseded
- Owner: Sheshiyer
- Contributors: Product, Engineering, Design, Ops
- Last Updated: 2026-07-05
- Related Decision Log IDs: DEC-001, DEC-002

## 2. Problem & Opportunity
- Problem statement: The Temperance Engine, developed by Thoughtseed Labs, is a comprehensive packaging repository and one-time installer designed for local AI-operator runtimes. It specifically targets environments utilizing **OpenCode** and **Cursor**, providing a modular framework that consolidates scattered configurations, voice hooks, MCP servers, and search indexes into a reviewable, secure system.
- Who is affected: Primary target users experiencing the current workflow friction.
- Current workaround: Manual or fragmented process with inconsistent outcomes.
- Business impact: Slower adoption, lower conversion, and higher execution overhead.
- Opportunity size (qualitative/quantitative): Medium-to-high if core flow is simplified and instrumented.

## 3. Goals & Success Metrics
- North-star metric: Activation rate for first successful end-to-end task.
- Leading metrics (2-4): Time-to-value, completion rate, week-1 retention, task success rate.
- Baseline values: TBD (collect in sprint 1 instrumentation).
- MVP success threshold (done when): Target activation threshold is achieved for defined user segment.
- Non-goals: Nice-to-have automations, broad edge-case coverage, non-critical redesign.

## 4. Users & JTBD
- Primary user persona: Operator/manager executing repeatable workflow under time constraints.
- Secondary persona(s): Team lead, executive stakeholder.
- Jobs-to-be-done: Complete core workflow quickly, reliably, and with measurable outcomes.
- Top pain points: Unclear steps, fragmented tools, weak feedback loops.

## 5. Scope
### In Scope (MVP)
- **Backup-First Operations:** Every write operation is preceded by the creation of timestamped backups, ensuring full reversibility
- **command-code:** Primary and versatile, supporting 35 models but with higher latency (~10s startup)
- **kimi:** Optimized for long-horizon coding with a 262K context window

### Out of Scope (This Cycle)
- Advanced integrations not required for first user value
- Enterprise edge-case handling beyond MVP segment
- Non-essential UX polish work

## 6. Assumptions & Dependencies
### Assumptions
| ID | Assumption | Confidence (H/M/L) | Validation Plan | Status |
|---|---|---|---|---|
| A-1 | **Backup-First Operations:** Every write operation is preceded by the creation of timestamped backups, ensuring full reversibility | M | Validate via POC + surveys | Unvalidated |

### Dependencies
| ID | Dependency | Owner | Risk if Delayed | Mitigation |
|---|---|---|---|---|
| D-1 | Analytics event tracking pipeline | Engineering | Cannot measure success accurately | Instrument early in sprint 1 |

## 7. Requirements
### Functional Requirements
| ID | Requirement | Priority (MoSCoW) | Acceptance Criteria |
|---|---|---|---|
| FR-1 | **Backup-First Operations:** Every write operation is preceded by the creation of timestamped backups, ensuring full reversibility | Must | User can complete this flow with testable success criteria |
| FR-2 | **command-code:** Primary and versatile, supporting 35 models but with higher latency (~10s startup) | Should | User can complete this flow with testable success criteria |
| FR-3 | **kimi:** Optimized for long-horizon coding with a 262K context window | Should | User can complete this flow with testable success criteria |

### Non-Functional Requirements
| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Performance |  |
| NFR-2 | Reliability |  |
| NFR-3 | Security |  |

## 8. UX & Flow
- Core user journey: Discover value → set up quickly → complete first successful run → iterate.
- Edge cases: Incomplete input data, dependency delays, authorization failures.
- UX acceptance criteria: Users can finish core flow in minimal steps without external guidance.

## 9. Data Events & Analytics
| Event Name | Trigger | Properties | Owner | Metric Link |
|---|---|---|---|---|
| mvp_flow_started | User starts core workflow | user_id, segment, source | Product | Activation funnel |
| mvp_flow_completed | User completes core workflow | user_id, duration, outcome | Engineering | Completion rate |
| mvp_value_realized | User reaches first value moment | user_id, value_type | Product | Time-to-value |

## 10. Risks & Mitigations
| Risk ID | Category (Tech/Market/Ops/Legal) | Description | Severity | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | mvp_flow_started | User starts core workflow | user_id, segment, source | Product | Activation funnel |
| mvp_flow_completed | User completes core workflow | user_id, duration, outcome | Engineering | Completion rate |
| mvp_value_realized | User reaches first value moment | user_id, value_type | Product | Time-to-value |

## 11. POC Gate (If Required)
- Hypothesis: Reducing core flow friction and clarifying outcomes will improve activation.
- Timebox: 1 sprint (2 weeks)
- Success criteria: Improvement in activation leading metrics and positive qualitative feedback.
- Failure criteria: No measurable uplift after controlled rollout.
- Decision date: 2026-07-05
- Decision outcome: Go / No-Go / Pivot

## 12. Release Plan
- Sprint mapping (2-week cadence): Sprint 1 discovery+POC, Sprint 2 MVP build, Sprint 3 hardening.
- Milestones: POC gate, MVP feature-complete, launch readiness review.
- Rollback plan: Feature-flagged release with immediate rollback to stable path.
- Launch checklist: QA pass, analytics validation, stakeholder sign-off, support docs ready.

## 13. Open Questions
- Which CSV-identified segment should be prioritized first?
- Which report theme should drive Sprint 1 focus: Executive Summary?
- What is the minimum acceptable activation lift for go-live?

## 14. Approvals
- Product:
- Engineering:
- Design:
- Ops/Business:
