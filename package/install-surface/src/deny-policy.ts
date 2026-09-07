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

function compileRules(policy: DenyPolicy): Array<{ rule: DenyRule; expression: RegExp }> {
  return policy.rules.map((rule) => ({ rule, expression: new RegExp(rule.pattern, "u") }));
}

/**
 * Apply the same disclosure-safe policy to a single repository-relative path.
 * Tree COPY callers must call this for every leaf, not only the tree root.
 */
export function assertDenyPath(path: string, policy: DenyPolicy): void {
  for (const { rule, expression } of compileRules(policy)) {
    // A user-supplied policy may include a stateful global/sticky expression.
    expression.lastIndex = 0;
    if (!expression.test(path)) continue;
    throw new DenyPolicyError(
      rule.id,
      rule.disclosure === "safe-relative-path" ? path : undefined,
    );
  }
}

export function assertDenyPolicy(records: readonly SurfaceRecord[], policy: DenyPolicy): void {
  for (const record of records) {
    if (!("source" in record)) continue;
    assertDenyPath(record.source, policy);
  }
}
