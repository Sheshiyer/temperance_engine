# Decision Log Template

Use this log for roadmap, scope, and requirement decisions.

## Metadata
- Project: temperance-engine
- Maintainer: Thoughtseed
- Last Updated: 2026-06-13

## Decision Entries

### DEC-001 — Prioritize **Safe Defaults:** The installer uses `$HOME` and user-overridable environment variables to prevent leaking machine-specific data as MVP must-have
- Date: 2026-06-13
- Status: Proposed / Accepted / Rejected / Superseded
- Owner: Thoughtseed
- Stakeholders Consulted:
- Context: Initial synthesis of NotebookLM report indicates highest impact in core workflow simplification.
- Options Considered:
  1. 
  2. 
  3. 
- Decision: Treat this capability as Must-have for MVP and gate release readiness on its acceptance tests.
- Rationale: Highest expected value with manageable effort and strong strategic alignment.
- Trade-offs:
- Impacted Artifacts: (PRD version, roadmap version, sprint ID)
- Risks Introduced:
- Mitigations:
- Follow-up Actions:
- Review Date:
- Supersedes / Superseded By:

---

### DEC-002 — Enforce POC gate before committing full roadmap
- Date: 2026-06-13
- Status: Proposed / Accepted / Rejected / Superseded
- Owner: Thoughtseed
- Stakeholders Consulted:
- Context: Top risks require evidence before locking downstream scope and commitments.
- Options Considered:
  1. 
  2. 
  3. 
- Decision: Run a 2-week POC and proceed only on Go criteria with explicit no-go fallback.
- Rationale: Reduces wasted build effort and improves confidence in roadmap sequencing.
- Trade-offs:
- Impacted Artifacts: (PRD version, roadmap version, sprint ID)
- Risks Introduced:
- Mitigations:
- Follow-up Actions:
- Review Date:
- Supersedes / Superseded By:
