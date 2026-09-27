import {
  createV4CutoverReview,
  verifyV4ReplacementProof,
  type V4CutoverConfirmation,
  type V4CutoverReview,
  type V4ReplacementProof,
} from "../../../router/v4-cutover-executor.ts";
import {
  verifyV4CutoverPlanDigest,
  type V4CutoverPlan,
} from "../../../router/v4-cutover-plan.ts";
import { hostIdentityMatches } from "./host-identity.ts";
import type { HostIdentityBindingV1 } from "./public-contracts.ts";
import { isSimpleConfirmationKey } from "./simple-confirmation.ts";

export interface V4CutoverViewRow {
  id: string;
  title: string;
  status: "ready" | "remove" | "replace" | "blocked" | "manual" | "not-needed";
  details: string[];
}

export interface V4CutoverViewPage {
  id: "overview" | "actions" | "managed-state" | "confirmation";
  title: string;
  rows: V4CutoverViewRow[];
}

export interface V4CutoverViewModel {
  title: "Temperance V4 destructive cutover";
  readiness: "ready" | "blocked";
  plan_digest: V4CutoverPlan["plan_digest"];
  proof_digest: V4ReplacementProof["proof_digest"];
  operation_digest?: V4CutoverReview["operation_digest"];
  blocking_reasons: string[];
  pages: V4CutoverViewPage[];
}

export type V4CutoverConfirmationState =
  | { status: "unconfirmed" }
  | { status: "confirmed"; confirmation: V4CutoverConfirmation };

function assertInputs(plan: V4CutoverPlan, proof: V4ReplacementProof, expectedHost: HostIdentityBindingV1): void {
  if (!verifyV4CutoverPlanDigest(plan)) throw new Error("CUTOVER_REVIEW_PLAN_INVALID");
  if (!verifyV4ReplacementProof(proof)) throw new Error("CUTOVER_REVIEW_PROOF_INVALID");
  if (!hostIdentityMatches(expectedHost, plan.host)) {
    throw new Error("CUTOVER_REVIEW_INTENDED_HOST_MISMATCH");
  }
}

export function createV4CutoverViewModel(
  plan: V4CutoverPlan,
  proof: V4ReplacementProof,
  expectedHost: HostIdentityBindingV1,
): V4CutoverViewModel {
  assertInputs(plan, proof, expectedHost);
  const blocked = plan.activation_blocked || plan.blocking_reasons.length > 0;
  const review = blocked ? undefined : createV4CutoverReview(plan, proof);
  const overview: V4CutoverViewRow[] = [
    {
      id: "target",
      title: `${plan.target.package}@${plan.target.version}`,
      status: blocked ? "blocked" : "ready",
      details: [
        "Fresh replacement; no runnable legacy backup survives activation.",
        `Host: ${plan.host.hardware_model} · ${plan.host.chip_model} · ${plan.host.architecture} · uid ${String(plan.host.user_id)}`,
        "Private intended-host binding: exact match",
        `Plan: ${plan.plan_digest}`,
        `Proof: ${proof.proof_digest}`,
        ...(review ? [`Operation: ${review.operation_digest}`] : []),
      ],
    },
    {
      id: "policy",
      title: "Replacement policy",
      status: "ready",
      details: [
        `Runnable backup: ${String(plan.policy.runnable_backup)}`,
        `Secret values recorded: ${String(plan.policy.secret_values_recorded)}`,
        `Destructive execution pre-authorized: ${String(plan.policy.destructive_execution_authorized)}`,
      ],
    },
  ];
  if (blocked) {
    overview.push({
      id: "holds",
      title: "Activation holds",
      status: "blocked",
      details: [...plan.blocking_reasons],
    });
  }
  const actions: V4CutoverViewRow[] = plan.actions.map((action) => ({
    id: action.id,
    title: `${action.order}. ${action.effect} ${action.target}`,
    status: action.status,
    details: [action.reason, `Required: ${String(action.required)}`],
  }));
  const managedState: V4CutoverViewRow[] = [
    ...plan.paths.map((path) => ({
      id: `path.${path.id}`,
      title: path.path,
      status: path.disposition === "remove"
        ? "remove" as const
        : path.disposition === "verify-absent" ? "not-needed" as const : "replace" as const,
      details: [`Observed: ${path.observed}`, `Files: ${path.file_count}`, `Disposition: ${path.disposition}`],
    })),
    ...plan.launch_agents.map((agent) => ({
      id: `launch-agent.${agent.label}`,
      title: agent.label,
      status: agent.disposition === "remove" ? "remove" as const : "replace" as const,
      details: [agent.path, `Observed: ${agent.observed}`, `Disposition: ${agent.disposition}`],
    })),
  ];
  const confirmation: V4CutoverViewRow[] = review
    ? [{
      id: "operation-digest",
      title: "Explicit destructive confirmation",
      status: "ready",
      details: [
        ...review.details,
        "Press Enter or y once on this Confirm page to confirm this exact operation digest.",
        "Fresh observation must still match before any journal or mutation begins.",
      ],
    }]
    : [{
      id: "confirmation-blocked",
      title: "Confirmation unavailable",
      status: "blocked",
      details: [...plan.blocking_reasons],
    }];
  return {
    title: "Temperance V4 destructive cutover",
    readiness: blocked ? "blocked" : "ready",
    plan_digest: plan.plan_digest,
    proof_digest: proof.proof_digest,
    ...(review ? { operation_digest: review.operation_digest } : {}),
    blocking_reasons: [...plan.blocking_reasons],
    pages: [
      { id: "overview", title: "Overview", rows: overview },
      { id: "actions", title: "Ordered actions", rows: actions },
      { id: "managed-state", title: "Managed state", rows: managedState },
      { id: "confirmation", title: "Confirm", rows: confirmation },
    ],
  };
}

export function advanceV4CutoverConfirmation(
  view: V4CutoverViewModel,
  state: V4CutoverConfirmationState,
  now: () => Date = () => new Date(),
): V4CutoverConfirmationState {
  if (view.readiness !== "ready" || !view.operation_digest) throw new Error("CUTOVER_CONFIRMATION_BLOCKED");
  if (state.status === "confirmed") return state;
  const confirmed_at = now().toISOString();
  if (!Number.isFinite(Date.parse(confirmed_at))) throw new Error("CUTOVER_CONFIRMATION_TIME_INVALID");
  return {
    status: "confirmed",
    confirmation: { confirmed: true, operation_digest: view.operation_digest, confirmed_at },
  };
}

export function isV4CutoverConfirmationKey(keyName: string): boolean {
  return isSimpleConfirmationKey(keyName);
}

export function advanceV4CutoverConfirmationFromKey(
  view: V4CutoverViewModel,
  pageId: V4CutoverViewPage["id"],
  keyName: string,
  state: V4CutoverConfirmationState,
  now: () => Date = () => new Date(),
): V4CutoverConfirmationState {
  if (pageId !== "confirmation" || !isV4CutoverConfirmationKey(keyName)) return state;
  return advanceV4CutoverConfirmation(view, state, now);
}
