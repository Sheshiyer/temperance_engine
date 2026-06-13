# Backlog Scoring Template

Use this table to score and gate opportunities before sprint planning.

## Scoring Scales
- Reach: number of users/accounts affected in period
- Impact: 0.25 (low), 0.5 (medium), 1 (high), 2 (massive), 3 (game-changing)
- Confidence: 0-100%
- Effort: person-weeks (or normalized points)
- RICE Score = (Reach × Impact × Confidence) / Effort

## Opportunity Table

| ID | Initiative | Problem Solved | Value (1-5) | Effort (1-5) | Value/Effort Quadrant | Reach | Impact | Confidence % | Effort (RICE) | RICE Score | KANO Class | MoSCoW | Assumption Status | Risk Level | Dependency Notes | Decision |
|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|---|---|---|---|---|
| OP-01 | **Safe Defaults:** The installer uses `$HOME` and user-overridable environment variables to prevent leaking machine-specific data | Reduce friction in core journey | 5 | 2 | Quick Win | 800 | 2 | 80 | 2 | 640.0 | Must-have | Must | Unvalidated | H | Cross-team dependency check required | POC |
| OP-02 | **Secret Management:** The `SECURITY.md` guidelines strictly forbid the commitment of API keys, model tokens, or private memory folders | Reduce friction in core journey | 4 | 3 | Quick Win | 700 | 2 | 75 | 3 | 350.0 | Must-have | Must | Unvalidated | M | Cross-team dependency check required | Keep |
| OP-03 | **Local Network:** The Pulse compatibility server is restricted to `127.0.0.1:31337` to ensure local-only JSON POST operations | Reduce friction in core journey | 3 | 4 | Strategic Bet | 600 | 1 | 70 | 4 | 105.0 | Performance | Should | Unvalidated | M | Cross-team dependency check required | Keep |
| OP-04 | **Preserve Safety Boundaries:** Contributions must not include private memory, credentials, or bundled binaries with unclear licenses | Reduce friction in core journey | 2 | 2 | Strategic Bet | 500 | 1 | 65 | 2 | 162.5 | Performance | Should | Unvalidated | M | Cross-team dependency check required | Keep |
| OP-05 | **Skill Metadata:** When uploading to `skills.sh`, use the generated `assets/banner.png` and `assets/icon.png` | Reduce friction in core journey | 2 | 3 | Strategic Bet | 400 | 1 | 60 | 3 | 80.0 | Performance | Should | Unvalidated | M | Cross-team dependency check required | Keep |
| OP-06 | Personal AI Infrastructure | Reduce friction in core journey | 2 | 4 | Strategic Bet | 300 | 1 | 55 | 4 | 41.25 | Performance | Should | Unvalidated | M | Cross-team dependency check required | Keep |
| OP-07 | OpenCode | Reduce friction in core journey | 2 | 2 | Strategic Bet | 200 | 1 | 50 | 2 | 50.0 | Performance | Should | Unvalidated | M | Cross-team dependency check required | Keep |

## Exclusion Log (Won’t This Cycle)

| ID | Initiative | Why Excluded | Revisit Trigger | Target Review Date |
|---|---|---|---|---|
| EX-01 | Advanced automation bundle | Not required for first user value | Activation baseline achieved for 2 sprints | Next planning cycle |

## POC Candidate List (Top Risks)

| ID | Initiative | Core Risk | Hypothesis | Timebox | Success Criteria | Owner | Decision Date | Outcome |
|---|---|---|---|---|---|---|---|---|
| POC-01 | **Safe Defaults:** The installer uses `$HOME` and user-overridable environment variables to prevent leaking machine-specific data | Adoption and feasibility uncertainty | Simplified flow improves activation metrics | 2 weeks | Activation + completion lift vs baseline | Product + Eng | 2026-06-13 | Go / No-Go / Pivot |
