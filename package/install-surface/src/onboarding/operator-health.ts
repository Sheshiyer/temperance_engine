import { createHash } from "node:crypto";
import type { DoctorCondition } from "../types.ts";
import type { OnboardingPlanV1 } from "./contracts.ts";
import type { NineRouterRoutingSurface } from "./nine-router-provider-capabilities.ts";

export const OPERATOR_HEALTH_SCHEMA = "temperance.operator-health.v1" as const;
export type OperatorHealthStatus = "PASS" | "HOLD" | "UNAVAILABLE";
export type OperatorHealthGroup = "dependencies" | "routing" | "installation" | "session";

export interface OperatorHealthCheck {
  id: string;
  group: OperatorHealthGroup;
  status: OperatorHealthStatus;
  reason_code: string;
  summary: string;
  next_action: string;
  /** Only selected requirements or observed installation failures block the aggregate. */
  required: boolean;
  verification_scope: "prerequisites" | "catalog" | "installation" | "admission" | "unverified";
}

/** Full doctor V1/V2 reports fit this structural, data-only projection input. */
export interface OperatorInstallObservation {
  trustworthy: boolean;
  overall_condition: DoctorCondition;
  sections?: readonly {
    id: string;
    condition: DoctorCondition;
    checks: readonly { id: string; condition: DoctorCondition; reason_code: string }[];
  }[];
}

export interface OperatorHealthOptions {
  plan: OnboardingPlanV1;
  routing?: NineRouterRoutingSurface;
  /** True only when management catalog/model reads actually succeeded. */
  routingObserved?: boolean;
  install?: OperatorInstallObservation;
  sessionAdmission?: { ok: boolean; reasonCode: string };
  observedAt?: string;
}

export interface OperatorHealthReport {
  schema: typeof OPERATOR_HEALTH_SCHEMA;
  version: { major: 1; minor: 0 };
  observed_at: string;
  overall_status: OperatorHealthStatus;
  readiness_scope: "configuration-only";
  context_capacity: "unverified";
  checks: OperatorHealthCheck[];
  groups: Array<{ id: OperatorHealthGroup; status: OperatorHealthStatus; check_ids: string[] }>;
  counts: {
    checks: number;
    pass: number;
    hold: number;
    unavailable: number;
    required_holds: number;
    required_unavailable: number;
    modules_requested: number;
    modules_eligible: number;
    modules_held: number;
    modules_not_selected: number;
    active_modules_verified: 0;
    provider_records_connected: number | null;
    provider_options_unconnected: number | null;
    live_provider_models: number | null;
    alias_drafts: number;
    alias_drafts_ready: number;
    alias_drafts_held: number;
    alias_drafts_unseated: number;
  };
}

const GROUPS: readonly OperatorHealthGroup[] = ["dependencies", "routing", "installation", "session"];
const MODULE_REASONS = new Set([
  "BINARY_MISSING", "VERSION_MISMATCH", "APPLICATION_MISSING", "MOUNT_ABSENT", "MOUNT_UUID_MISMATCH",
  "PATH_MISSING", "PATH_INACCESSIBLE", "SECRET_REFERENCE_MISSING", "SECRET_UNAVAILABLE",
  "ROUTING_ALIAS_MISSING", "ROUTING_ALIAS_AMBIGUOUS", "ROUTING_COMBO_MISSING", "ROUTING_COMBO_AMBIGUOUS",
  "ROUTING_COMBO_EMPTY", "ROUTING_COMBO_CHANGED", "ROUTING_MODEL_UNAVAILABLE", "ROUTING_MODEL_NESTED",
  "ROUTING_API_UNAVAILABLE", "ROUTING_AUTH_UNAVAILABLE", "ROUTING_RESPONSE_INVALID", "VARIABLE_MISSING",
  "VARIABLE_INVALID", "HTTP_UNAVAILABLE", "UNSUPPORTED_PLATFORM", "PROBE_FAILED",
  "DEPENDENCY_BLOCKED", "DEPENDENCY_MISSING", "DEPENDENCY_CYCLE",
]);
const SESSION_REASONS = new Set([
  "SESSION_ADMISSION_ARGUMENT_INVALID", "SESSION_POLICY_INVALID", "SESSION_POLICY_MISSING",
  "SESSION_ALIAS_MISMATCH", "SESSION_ALIAS_UNKNOWN", "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE", "GATEWAY_ADAPTER_UNSUPPORTED",
]);
const noAction = "No action required for this observation.";

function safeIdentifier(value: string): string {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)
    ? value
    : `redacted-${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function aggregate(checks: readonly OperatorHealthCheck[]): OperatorHealthStatus {
  if (checks.some(({ required, status }) => required && status === "HOLD")) return "HOLD";
  if (checks.some(({ required, status }) => required && status === "UNAVAILABLE")) return "UNAVAILABLE";
  return "PASS";
}

function moduleAction(reason: string): string {
  if (reason.startsWith("ROUTING_")) return "Refresh 9Router observations and resolve the selected routing requirement.";
  if (reason.startsWith("MOUNT_")) return "Check the selected volume and its configured identity in onboarding.";
  if (reason.startsWith("SECRET_")) return "Resolve the declared credential reference without placing secrets in configuration.";
  if (reason === "APPLICATION_MISSING") return "Install the selected application or deselect its integration.";
  if (reason === "BINARY_MISSING" || reason === "VERSION_MISMATCH") return "Install the selected tool's supported version and rerun health.";
  if (reason.startsWith("DEPENDENCY_")) return "Resolve the selected module's prerequisites in onboarding.";
  return "Review the selected module's setup and rerun its prerequisite checks.";
}

/** Pure projection: eligibility/catalog observations never establish activation or a 1M session. */
export function projectOperatorHealth(options: OperatorHealthOptions): OperatorHealthReport {
  const timestamp = options.observedAt ?? options.plan.generated_at;
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("OPERATOR_HEALTH_OBSERVED_AT_INVALID");
  const checks: OperatorHealthCheck[] = [];
  const add = (check: OperatorHealthCheck): void => { checks.push(check); };
  const requestedModules = options.plan.modules.filter(({ requested }) => requested);

  for (const module of [...options.plan.modules].sort((left, right) => left.id.localeCompare(right.id))) {
    const id = `dependencies.${safeIdentifier(module.id)}`;
    if (!module.requested || module.status === "not-selected") {
      add({ id, group: "dependencies", status: "UNAVAILABLE", required: false, reason_code: "MODULE_NOT_SELECTED",
        summary: "Optional module is not selected.", next_action: "Select this module only if its integration is needed.", verification_scope: "unverified" });
    } else if (module.status === "eligible" && module.holds.length === 0) {
      add({ id, group: "dependencies", status: "PASS", required: true, reason_code: "MODULE_PREREQUISITES_MET",
        summary: "Prerequisites are eligible; runtime activation is unverified.", next_action: "Verify runtime behavior separately before treating the module as active.", verification_scope: "prerequisites" });
    } else {
      const reasons = [...new Set(module.holds.map(({ reason_code }) => MODULE_REASONS.has(reason_code) ? reason_code : "MODULE_PREREQUISITES_UNVERIFIED"))].sort();
      if (reasons.length === 0) reasons.push("MODULE_PREREQUISITES_UNVERIFIED");
      for (const reason of reasons) add({ id: `${id}.${reason.toLowerCase()}`, group: "dependencies", status: "HOLD", required: true,
        reason_code: reason, summary: "A selected module prerequisite is held.", next_action: moduleAction(reason), verification_scope: "prerequisites" });
    }
  }

  const routingRequired = requestedModules.some(({ id, holds }) => id === "provider.9router" || holds.some(({ reason_code }) => reason_code.startsWith("ROUTING_")));
  const routing = options.routing;
  const observed = options.routingObserved === true && routing !== undefined;
  // A version-mismatched projection suppresses catalog choices. Suppressed
  // choices are unknown, not evidence of zero upstream connections/models.
  const catalogObserved = observed && routing.compatible;
  const connected = catalogObserved ? new Set(routing.provider_options.filter(({ state }) => state === "connected").flatMap(({ connection_ids }) => connection_ids)).size : null;
  const unconnected = catalogObserved ? routing.provider_options.filter(({ state }) => state === "held").length : null;
  const modelCount = catalogObserved && Number.isSafeInteger(routing.live_model_count) && routing.live_model_count >= 0 ? routing.live_model_count : null;
  const drafts = routing?.alias_seats ?? [];
  add({ id: "routing.adapter", group: "routing", required: routingRequired,
    status: routing ? routing.compatible ? "PASS" : "HOLD" : "UNAVAILABLE",
    reason_code: routing ? routing.compatible ? "ROUTER_ADAPTER_COMPATIBLE" : "ROUTER_ADAPTER_INCOMPATIBLE" : "ROUTING_NOT_OBSERVED",
    summary: routing?.compatible ? "Adapter version is compatible; this does not prove management connectivity." : "A compatible routing adapter has not been established.",
    next_action: routing?.compatible ? noAction : "Check the selected router version or leave routing unselected.", verification_scope: routing ? "prerequisites" : "unverified" });
  add({ id: "routing.connectivity", group: "routing", required: routingRequired,
    status: observed ? "PASS" : options.routingObserved === false && routingRequired ? "HOLD" : "UNAVAILABLE",
    reason_code: observed ? "ROUTING_MANAGEMENT_OBSERVED" : options.routingObserved === false ? "ROUTING_MANAGEMENT_UNAVAILABLE" : "ROUTING_CONNECTIVITY_UNVERIFIED",
    summary: observed ? "Read-only management observations succeeded; inference health remains unverified." : "No successful management observation is available.",
    next_action: observed ? noAction : "Refresh routing observations; start the local router only if selected.", verification_scope: observed ? "catalog" : "unverified" });
  add({ id: "routing.providers", group: "routing", required: routingRequired,
    status: connected === null ? "UNAVAILABLE" : connected > 0 ? "PASS" : "HOLD",
    reason_code: connected === null ? "PROVIDER_RECORDS_UNVERIFIED" : connected > 0 ? "PROVIDER_RECORDS_OBSERVED" : "PROVIDER_CONNECTION_REQUIRED",
    summary: connected !== null && connected > 0 ? "Provider connection records are observed; active sessions are not established." : "No connected provider record has been verified by this observation.",
    next_action: connected !== null && connected > 0 ? noAction : !catalogObserved ? "Verify adapter compatibility and refresh management observations first." : "Connect a needed provider through the guided onboarding flow.", verification_scope: catalogObserved ? "catalog" : "unverified" });
  add({ id: "routing.models", group: "routing", required: routingRequired,
    status: modelCount === null ? "UNAVAILABLE" : modelCount > 0 ? "PASS" : "HOLD",
    reason_code: modelCount === null ? "LIVE_MODEL_CATALOG_UNVERIFIED" : modelCount > 0 ? "LIVE_PROVIDER_MODELS_OBSERVED" : "LIVE_PROVIDER_MODELS_UNAVAILABLE",
    summary: modelCount !== null && modelCount > 0 ? "Provider model choices are observed; quota, tools and context capacity remain unverified." : "No current provider model choices are established.",
    next_action: modelCount !== null && modelCount > 0 ? "Select combo members from current provider choices when needed." : !catalogObserved ? "Verify adapter compatibility before interpreting model availability." : "Refresh the model catalog after connecting a provider.", verification_scope: catalogObserved ? "catalog" : "unverified" });
  add({ id: "routing.aliases", group: "routing", status: "UNAVAILABLE", required: false,
    reason_code: drafts.length > 0 ? "ALIAS_SELECTION_DRAFT_ONLY" : "ALIAS_MEMBERSHIP_NOT_OBSERVED",
    summary: "Seat drafts do not prove live combo membership; module admission holds remain authoritative.",
    next_action: "Run selected routing-alias prerequisite probes for live membership checks.", verification_scope: "unverified" });

  const install = options.install;
  const installSections = install?.sections?.filter(({ id }) => id === "install");
  const installationCheck = (id: string, condition: DoctorCondition): void => {
    const status: OperatorHealthStatus = condition === "PASS" ? "PASS" : ["DRIFT", "FAIL", "WARN"].includes(condition) ? "HOLD" : "UNAVAILABLE";
    const reason = condition === "PASS" ? "INSTALLATION_CHECK_PASSED" : condition === "DRIFT" ? "INSTALLATION_DRIFT" : condition === "FAIL" ? "INSTALLATION_CHECK_FAILED" : condition === "WARN" ? "INSTALLATION_WARNING" : "INSTALLATION_CHECK_UNAVAILABLE";
    add({ id, group: "installation", status, required: condition === "DRIFT" || condition === "FAIL", reason_code: reason,
      summary: status === "PASS" ? "Installation observation passed; running service activation is not implied." : status === "HOLD" ? "Install doctor reported an installation issue." : "An installation check is unavailable or outside scope.",
      next_action: status === "PASS" ? noAction : "Review the install-only doctor report before changing installed files.", verification_scope: status === "UNAVAILABLE" ? "unverified" : "installation" });
  };
  if (!install || (installSections !== undefined && installSections.length === 0)) {
    add({ id: "installation.observation", group: "installation", status: "UNAVAILABLE", required: false, reason_code: "INSTALLATION_NOT_OBSERVED",
      summary: "No install-scoped doctor observation is included.", next_action: "Run the install-only doctor when installation verification is needed.", verification_scope: "unverified" });
  } else if (!install.trustworthy) {
    add({ id: "installation.observation", group: "installation", status: "HOLD", required: true, reason_code: "INSTALLATION_EVIDENCE_UNTRUSTWORTHY",
      summary: "The supplied install doctor observation is not trustworthy.", next_action: "Rerun the install-only doctor and resolve its evidence failure.", verification_scope: "unverified" });
  } else if (installSections === undefined) installationCheck("installation.summary", install.overall_condition);
  else for (const section of installSections) {
    installationCheck("installation.summary", section.condition);
    for (const check of [...section.checks].sort((left, right) => left.id.localeCompare(right.id))) installationCheck(`installation.check.${safeIdentifier(check.id)}`, check.condition);
  }

  const session = options.sessionAdmission;
  if (!session) add({ id: "session.admission", group: "session", status: "UNAVAILABLE", required: false, reason_code: "SESSION_ADMISSION_NOT_OBSERVED",
    summary: "Managed session admission has not been observed.", next_action: "Check the managed session gate when using a selected session policy.", verification_scope: "unverified" });
  else if (session.ok && session.reasonCode === "OPTIONAL_SESSION_POLICY_NOT_SELECTED") add({ id: "session.admission", group: "session", status: "PASS", required: false, reason_code: "OPTIONAL_SESSION_POLICY_NOT_SELECTED",
    summary: "No optional session policy is selected; long-context readiness is not implied.", next_action: noAction, verification_scope: "admission" });
  else add({ id: "session.admission", group: "session", status: session.ok ? "PASS" : "HOLD", required: true,
    reason_code: session.ok ? "SESSION_ADMISSION_ACCEPTED" : SESSION_REASONS.has(session.reasonCode) ? session.reasonCode : "SESSION_ADMISSION_HELD",
    summary: session.ok ? "Admission accepted the request; running-session and context-capacity proof are not included." : "Managed session admission is held independently of provider or combo setup.",
    next_action: session.ok ? "Verify per-attempt evidence before claiming active long-context operation." : "Resolve the session gate's capability evidence before managed dispatch.", verification_scope: "admission" });

  const counts: OperatorHealthReport["counts"] = {
    checks: checks.length, pass: checks.filter(({ status }) => status === "PASS").length,
    hold: checks.filter(({ status }) => status === "HOLD").length, unavailable: checks.filter(({ status }) => status === "UNAVAILABLE").length,
    required_holds: checks.filter(({ status, required }) => required && status === "HOLD").length,
    required_unavailable: checks.filter(({ status, required }) => required && status === "UNAVAILABLE").length,
    modules_requested: requestedModules.length,
    modules_eligible: requestedModules.filter(({ status, holds }) => status === "eligible" && holds.length === 0).length,
    modules_held: requestedModules.filter(({ status, holds }) => status === "blocked" || holds.length > 0).length,
    modules_not_selected: options.plan.modules.filter(({ requested, status }) => !requested || status === "not-selected").length,
    active_modules_verified: 0,
    provider_records_connected: connected, provider_options_unconnected: unconnected, live_provider_models: modelCount,
    alias_drafts: drafts.length, alias_drafts_ready: drafts.filter(({ state }) => state === "ready").length,
    alias_drafts_held: drafts.filter(({ state }) => state === "held").length, alias_drafts_unseated: drafts.filter(({ state }) => state === "unseated").length,
  };
  return { schema: OPERATOR_HEALTH_SCHEMA, version: { major: 1, minor: 0 }, observed_at: new Date(timestamp).toISOString(),
    overall_status: aggregate(checks), readiness_scope: "configuration-only", context_capacity: "unverified", checks,
    groups: GROUPS.map((id) => {
      const members = checks.filter(({ group }) => group === id);
      return { id, status: members.some(({ required }) => required) ? aggregate(members) : members.some(({ status }) => status === "PASS") ? "PASS" : members.some(({ status }) => status === "HOLD") ? "HOLD" : "UNAVAILABLE", check_ids: members.map(({ id: checkId }) => checkId) };
    }), counts };
}

/** Render the same public-safe snapshot used by agent/API consumers. */
export function renderOperatorHealth(report: OperatorHealthReport): string {
  const lines = [
    `Operator health: ${report.overall_status} · configuration-only`,
    `Observed: ${report.observed_at}`,
    "Eligibility is not activation. Context capacity and active sessions remain unverified.",
    `Checks: ${report.counts.pass} pass, ${report.counts.hold} hold, ${report.counts.unavailable} unavailable.`,
  ];
  for (const group of report.groups) {
    lines.push("", `${group.id}: ${group.status}`);
    for (const id of group.check_ids) {
      const check = report.checks.find((candidate) => candidate.id === id);
      if (!check) continue;
      lines.push(`  ${check.status} ${check.id} · ${check.reason_code}`, `    ${check.summary}`);
      if (check.status !== "PASS") lines.push(`    Next: ${check.next_action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
