import type { SurfaceRecord } from "./types.ts";

export const AUTHORITY_FILES = ["ISA.md", ".planning/REQUIREMENTS.md"] as const;

const PHASE_ONE_REQUIREMENTS = new Set([
  "PROV-01",
  "PROV-02",
  "PROV-03",
  "PROV-04",
  "PROV-05",
  "PROV-07",
  "DOCT-01",
  "DOCT-02",
  "DOCT-03",
  "DOCT-04",
  "DOCT-05",
  "SAFE-04",
  "SAFE-07",
]);

export interface AuthorityInputs {
  isaText: string;
  requirementsText: string;
}

export class AuthorityError extends Error {
  constructor(readonly recordIds: readonly string[]) {
    super("AUTHORITY_REFERENCE_INVALID");
    this.name = "AuthorityError";
  }
}

function hasCheckedIsaCriterion(isaText: string, citation: string): boolean {
  const escaped = citation.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^- \\[x\\] ${escaped}:`, "mu").test(isaText);
}

function hasRequirement(requirementsText: string, requirementId: string): boolean {
  const escaped = requirementId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\*\\*${escaped}\\*\\*`, "u").test(requirementsText);
}

export function assertAuthority(records: readonly SurfaceRecord[], inputs: AuthorityInputs): void {
  const invalid: string[] = [];
  for (const record of records) {
    const requirements = record.authority.requirement_ids;
    const requirementsValid = requirements.length > 0 && requirements.every((requirementId) => (
      PHASE_ONE_REQUIREMENTS.has(requirementId)
      && hasRequirement(inputs.requirementsText, requirementId)
    ));
    const isaValid = /^ISC-[0-9]+(?:\.[0-9]+)?$/u.test(record.authority.isa)
      && hasCheckedIsaCriterion(inputs.isaText, record.authority.isa);
    if (!requirementsValid || !isaValid) invalid.push(record.id);
  }
  if (invalid.length > 0) throw new AuthorityError(invalid.sort());
}
