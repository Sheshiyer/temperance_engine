import type { SurfaceRecord } from "./types.ts";

export interface DenyRule {
  id: string;
  pattern: string;
  disclosure: "rule-only" | "safe-relative-path";
}

export interface DenyPolicy {
  schema: "temperance.install-surface.deny-policy.v1";
  version: { major: 1; minor: 0 };
  rules: DenyRule[];
}

export class DenyPolicyError extends Error {
  constructor(readonly ruleId: string, readonly disclosedPath?: string) {
    super(disclosedPath
      ? `DENY_POLICY_MATCH:${ruleId}:${disclosedPath}`
      : `DENY_POLICY_MATCH:${ruleId}`);
    this.name = "DenyPolicyError";
  }
}

export function assertDenyPolicy(records: readonly SurfaceRecord[], policy: DenyPolicy): void {
  const compiled = policy.rules.map((rule) => ({ rule, expression: new RegExp(rule.pattern, "u") }));
  for (const record of records) {
    if (!("source" in record)) continue;
    for (const { rule, expression } of compiled) {
      if (!expression.test(record.source)) continue;
      throw new DenyPolicyError(
        rule.id,
        rule.disclosure === "safe-relative-path" ? record.source : undefined,
      );
    }
  }
}
