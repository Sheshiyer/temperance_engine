/**
 * Closed validator for the portable project packet's `.project/project.yaml`.
 *
 * Operates on an already-parsed value, not raw YAML text — parsing belongs
 * to project-packet.ts. Returns every violation found, not just the first,
 * since a held packet is reviewed by a human who wants the whole list.
 */

import { isCanonicalRepositoryBasename } from "./project-relocation-grammar";

export const REQUIRED_PACKET_FILES = [
  "PROJECT.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".project/CONTEXT.md",
  ".project/project.yaml",
  ".project/HANDOFF.md",
] as const;

const PACKET_STATUS_VALUES = new Set(["draft-held", "reviewed-held"]);
const IDENTITY_STATUS_VALUES = new Set([
  "pending-teamforge-verification",
  "verified-teamforge",
  "unknown",
]);
const PORTFOLIO_VALUES = new Set(["thoughtseed", "tryambakam-noesis"]);
// A project_id is a qualified stable identity: canonical segments joined by
// '.', which is how a nested repository's id stays unique across tenants
// (`parkarea.wiki` vs `iverif.wiki`). A depth-0 id has no dot and is unchanged.
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*$/;
const GITHUB_REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "packet_status",
  "project_id",
  "identity_status",
  "portfolio",
  "repository",
  "github_repository",
  "knowledge_ref",
  "governance",
  "routing",
  "commands",
  "context",
]);

const GOVERNANCE_KEYS = new Set(["default_interactive_client", "approval_profile"]);
const APPROVAL_PROFILE_VALUES = new Set(["founder-gated"]);

const ROUTING_KEYS = new Set([
  "authority",
  "deployment_profile",
  "verification_state",
  "credential_scope_ref",
  "plan_lane",
  "review_lane",
]);
const VERIFICATION_STATE_VALUES = new Set(["unverified", "verified"]);

const COMMAND_KEYS = new Set(["setup", "test", "verify"]);
const NOT_APPLICABLE = "not-applicable";

export interface ValidateProjectYamlOptions {
  approvedLanes: readonly string[];
}

export type ProjectYamlValidationResult = { valid: true } | { valid: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProjectYaml(
  value: unknown,
  options: ValidateProjectYamlOptions,
): ProjectYamlValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return { valid: false, errors: ["project.yaml must be an object"] };
  }

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown top-level key: ${key}`);
  }

  if (value.schema_version !== 1) {
    errors.push("schema_version must be exactly 1");
  }

  if (!PACKET_STATUS_VALUES.has(value.packet_status as string)) {
    errors.push(`packet_status must be one of ${[...PACKET_STATUS_VALUES].join(", ")}`);
  }

  if (typeof value.project_id !== "string" || !PROJECT_ID_PATTERN.test(value.project_id)) {
    errors.push("project_id must be a non-empty lowercase identifier");
  }

  if (!IDENTITY_STATUS_VALUES.has(value.identity_status as string)) {
    errors.push(`identity_status must be one of ${[...IDENTITY_STATUS_VALUES].join(", ")}`);
  }

  if (!PORTFOLIO_VALUES.has(value.portfolio as string)) {
    errors.push(`portfolio must be one of ${[...PORTFOLIO_VALUES].join(", ")}`);
  }

  if (typeof value.repository !== "string" || !isCanonicalRepositoryBasename(value.repository)) {
    errors.push("repository must be a canonical repository basename");
  }

  if (typeof value.knowledge_ref !== "string" || value.knowledge_ref.length === 0) {
    errors.push("knowledge_ref must be a non-empty string");
  } else if (looksLikeMachineLocalPath(value.knowledge_ref)) {
    errors.push("knowledge_ref must not be a machine-local absolute path");
  } else if (looksLikeSecret(value.knowledge_ref)) {
    errors.push("knowledge_ref must not look like a credential");
  }

  if (value.github_repository !== undefined) {
    if (typeof value.github_repository !== "string" || !GITHUB_REPOSITORY_PATTERN.test(value.github_repository)) {
      errors.push("github_repository must be an owner/repo identity when present");
    }
  }

  validateGovernance(value.governance, errors);
  validateRouting(value.routing, value.portfolio as string, options.approvedLanes, errors);
  validateCommands(value.commands, errors);
  validateContext(value.context, errors);

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function validateGovernance(governance: unknown, errors: string[]): void {
  if (!isPlainObject(governance)) {
    errors.push("governance section is required");
    return;
  }
  for (const key of Object.keys(governance)) {
    if (!GOVERNANCE_KEYS.has(key)) errors.push(`unknown key: governance.${key}`);
  }
  if (governance.default_interactive_client !== "codex") {
    errors.push("governance.default_interactive_client must be codex");
  }
  if (!APPROVAL_PROFILE_VALUES.has(governance.approval_profile as string)) {
    errors.push(`governance.approval_profile must be one of ${[...APPROVAL_PROFILE_VALUES].join(", ")}`);
  }
}

export function looksLikeSecret(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /^(sk|ghp|gho|ghu|ghs|AKIA)[-_]?[A-Za-z0-9]{16,}$/.test(value) ||
    (!isAbsolutePosixPath(value) && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(value)) ||
    /^[0-9a-f]{32,}$/i.test(value)
  );
}

/**
 * The base64-shape check treats `/` as a payload character, so a sufficiently
 * long absolute path made only of alphanumerics and separators matches it. The
 * relocation destination root has no hyphens or dots, which made every
 * alphanumerically-named repository's destination read as a credential and
 * abort its capsule write mid-relocation.
 *
 * Exempting absolute paths from *that one check* is safe: a leading slash
 * followed by slash-separated segments is not a credential encoding. The
 * key-material, token-prefix, and hex checks still run on every value, so
 * secrets embedded in or alongside a path are still caught.
 */
function isAbsolutePosixPath(value: string): boolean {
  return value.startsWith("/") && value.slice(1).includes("/");
}

function looksLikeMachineLocalPath(value: string): boolean {
  return /^(\/Users\/|\/home\/|\/Volumes\/|~\/)/.test(value);
}

const THOUGHTSEED_ONLY_AUTHORITY_TERMS = ["hermes", "cambium", "teamforge", "telegram", "paperclip"];

function validateRouting(
  routing: unknown,
  portfolio: string,
  approvedLanes: readonly string[],
  errors: string[],
): void {
  if (!isPlainObject(routing)) {
    errors.push("routing section is required");
    return;
  }
  for (const key of Object.keys(routing)) {
    if (!ROUTING_KEYS.has(key)) errors.push(`unknown key: routing.${key}`);
  }
  if (routing.authority !== "temperance-omniroute") {
    errors.push("routing.authority must be temperance-omniroute");
  }
  if (typeof routing.deployment_profile !== "string" || routing.deployment_profile.length === 0) {
    errors.push("routing.deployment_profile must be a non-empty string");
  } else if (looksLikeMachineLocalPath(routing.deployment_profile)) {
    errors.push("routing.deployment_profile must not be a machine-local checkout path");
  } else if (
    portfolio === "tryambakam-noesis" &&
    THOUGHTSEED_ONLY_AUTHORITY_TERMS.some((term) => routing.deployment_profile.toLowerCase().includes(term))
  ) {
    errors.push(
      "routing.deployment_profile names a cross-portfolio authority — a Tryambakam packet may not reference a Thoughtseed-only authority identifier",
    );
  }
  if (!VERIFICATION_STATE_VALUES.has(routing.verification_state as string)) {
    errors.push(`routing.verification_state must be one of ${[...VERIFICATION_STATE_VALUES].join(", ")}`);
  }
  if (typeof routing.credential_scope_ref !== "string" || routing.credential_scope_ref.length === 0) {
    errors.push("routing.credential_scope_ref must be a non-empty string");
  } else if (looksLikeSecret(routing.credential_scope_ref)) {
    errors.push("routing.credential_scope_ref must be a secretless reference, not an actual credential");
  }
  if (typeof routing.plan_lane !== "string" || !approvedLanes.includes(routing.plan_lane)) {
    errors.push("routing.plan_lane must belong to the approved te-* lane set");
  }
  if (typeof routing.review_lane !== "string" || !approvedLanes.includes(routing.review_lane)) {
    errors.push("routing.review_lane must belong to the approved te-* lane set");
  }
}

function validateCommands(commands: unknown, errors: string[]): void {
  if (!isPlainObject(commands)) {
    errors.push("commands section is required");
    return;
  }
  for (const key of Object.keys(commands)) {
    if (!COMMAND_KEYS.has(key)) errors.push(`unknown key: commands.${key}`);
  }
  for (const optionalField of ["setup", "test"] as const) {
    const command = commands[optionalField];
    if (typeof command !== "string" || command.length === 0) {
      errors.push(`commands.${optionalField} must be a non-empty string or ${NOT_APPLICABLE}`);
    }
  }
  if (typeof commands.verify !== "string" || commands.verify.length === 0 || commands.verify === NOT_APPLICABLE) {
    errors.push("commands.verify must be a real, non-empty command — there is no not-applicable escape");
  }
}

function validateContext(context: unknown, errors: string[]): void {
  if (!Array.isArray(context)) {
    errors.push("context must be an ordered array of canonical packet files");
    return;
  }
  const seen = new Set<string>();
  for (const entry of context) {
    if (typeof entry !== "string" || !(REQUIRED_PACKET_FILES as readonly string[]).includes(entry)) {
      errors.push(`context entry is not one of the six canonical packet files: ${String(entry)}`);
      continue;
    }
    if (seen.has(entry)) errors.push(`duplicate context entry: ${entry}`);
    seen.add(entry);
  }
  for (const required of ["PROJECT.md", ".project/project.yaml", ".project/HANDOFF.md"]) {
    if (!seen.has(required)) errors.push(`context is missing required entry: ${required}`);
  }
}
