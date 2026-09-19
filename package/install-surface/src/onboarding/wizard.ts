import type { OnboardingPlanV1 } from "./contracts.ts";
import type { NineRouterRoutingSurface } from "./nine-router-provider-capabilities.ts";
import type { ProjectCapsuleV1 } from "./public-contracts.ts";
import { approveProjectCandidates } from "./project-discovery.ts";

export const ONBOARDING_WIZARD_STEPS = ["host", "projects", "providers", "combos", "modules", "integrations", "review"] as const;
export type WizardStepId = (typeof ONBOARDING_WIZARD_STEPS)[number];
export interface OnboardingWizardOptions {
  initialStep?: WizardStepId;
  selectedCandidateIds?: readonly string[];
  existingProjectCapsules?: readonly ProjectCapsuleV1[];
  allowProjectCapsuleSave?: boolean;
  routing?: NineRouterRoutingSurface;
  allowRoutingAuthorization?: boolean;
  allowRoutingSeating?: boolean;
  allowModuleReplan?: boolean;
  hostDescription?: string;
  notice?: string;
}
export interface OnboardingWizardState {
  step: WizardStepId;
  selectedCandidateIds: string[];
  selectedModuleIds: string[];
  notice?: string;
}
type WizardAction =
  | { kind: "next" | "back" | "refresh" | "seat" | "save" | "confirm" | "info" }
  | { kind: "project" | "module" | "authorize"; id: string }
  | { kind: "defer"; ids: string[] };
export interface WizardRow {
  id: string;
  title: string;
  description: string;
  details: string[];
  disabled?: boolean;
  action: WizardAction;
}
export interface OnboardingWizardView {
  step: WizardStepId;
  stepNumber: number;
  title: string;
  why: string;
  next: string;
  summary: string;
  rows: WizardRow[];
}
export type WizardEffect =
  | { kind: "cancel" | "refresh" | "seat" | "save" | "confirm" }
  | { kind: "authorize"; providerId: string }
  | { kind: "replan"; selectedModuleIds: string[] };
export interface OnboardingWizardResult {
  confirmed: boolean;
  confirmed_at?: string;
  plan_digest: OnboardingPlanV1["plan_digest"];
  selected_module_ids: string[];
  save_project_capsules: boolean;
  project_capsules: ProjectCapsuleV1[];
  routing_authorization_provider_id?: string;
  resume_step?: WizardStepId;
  selected_candidate_ids?: string[];
  routing_seating_requested?: boolean;
  refresh_requested?: boolean;
}

const COPY: Record<WizardStepId, { title: string; why: string; next: string }> = {
  host: { title: "Host", why: "Verify the machine and portable profile for this setup.", next: "Next: choose projects and review their access." },
  projects: { title: "Projects", why: "Approve project access explicitly; discovery grants no authority.", next: "Next: connect the providers you want to use." },
  providers: { title: "Providers", why: "Connect providers through 9Router; credentials stay with their owner.", next: "Next: assign live models to semantic combos." },
  combos: { title: "Combos", why: "Fit phase aliases to live models before dispatch can proceed.", next: "Next: choose runtime organs and tools." },
  modules: { title: "Organs & tools", why: "Selections are re-probed; held modules are never enabled.", next: "Next: verify applications and third-party integrations." },
  integrations: { title: "Integrations", why: "Check application dependencies before requesting integrations.", next: "Next: review the exact configuration before confirming." },
  review: { title: "Review", why: "Save requested configuration and explicit project approvals.", next: "Confirm finishes immediately; it does not certify activation or 1M readiness." },
};
function availableCandidates(plan: OnboardingPlanV1): Set<string> {
  return new Set((plan.project_candidates ?? []).filter(({ path_present, selectable }) => path_present && selectable !== false).map(({ id }) => id));
}
export function createOnboardingWizardState(plan: OnboardingPlanV1, options: OnboardingWizardOptions = {}): OnboardingWizardState {
  const available = availableCandidates(plan);
  return {
    step: options.initialStep && ONBOARDING_WIZARD_STEPS.includes(options.initialStep) ? options.initialStep : "host",
    selectedCandidateIds: [...new Set(options.selectedCandidateIds ?? [])].filter((id) => available.has(id)).sort(),
    selectedModuleIds: plan.modules.filter(({ requested }) => requested).map(({ id }) => id).sort(),
    notice: options.notice,
  };
}
export function canConfirmOnboardingWizard(plan: OnboardingPlanV1): boolean {
  return plan.operating_mode !== "blocked" && plan.install_order.length > 0
    && !plan.modules.some(({ requested, status }) => requested && status === "blocked");
}
function info(id: string, title: string, description: string, details: string[] = []): WizardRow {
  return { id, title, description, details, action: { kind: "info" } };
}
function action(id: string, title: string, description: string, value: WizardAction, disabled = false, details: string[] = []): WizardRow {
  return { id, title, description, details, action: value, disabled };
}

export function createOnboardingWizardView(plan: OnboardingPlanV1, state: OnboardingWizardState, options: OnboardingWizardOptions = {}): OnboardingWizardView {
  const stepNumber = ONBOARDING_WIZARD_STEPS.indexOf(state.step) + 1;
  const pendingWithoutSave = state.selectedCandidateIds.length > 0 && !options.allowProjectCapsuleSave;
  const confirmable = canConfirmOnboardingWizard(plan) && !pendingWithoutSave;
  const rows: WizardRow[] = [state.step === "review"
    ? action("confirm", "Confirm requested setup", confirmable ? "Enter saves choices and finishes" : pendingWithoutSave ? "Unavailable — pending project approvals need a save destination" : "Unavailable — resolve or defer held modules", { kind: "confirm" }, !confirmable, [`Plan: ${plan.plan_digest}`, "Saves requested configuration and configured project approvals.", "Does not imply every organ is active or a 1M-context model is ready."])
    : action("continue", "Continue →", COPY[state.step].next, { kind: "next" }, false, ["Go to the next setup step without saving pending choices."])];
  if (stepNumber > 1) rows.push(action("back", "← Back", `Return to ${COPY[ONBOARDING_WIZARD_STEPS[stepNumber - 2]!].title}`, { kind: "back" }));
  rows.push(action("refresh", "Refresh checks", "Re-probe this step; keep pending choices", { kind: "refresh" }));
  if (state.step === "host") {
    rows.push(info("host", options.hostDescription ?? "Current host", `Profile: ${plan.profile_id}`, [`Mode: ${plan.operating_mode}`, plan.dry_run ? "Read-only plan." : "Commit plan; exact review required."]));
    for (const module of plan.modules.filter(({ id }) => id === "provider.9router" || id === "storage.madara")) rows.push(info(`host.${module.id}`, module.title, module.status, module.holds.map(({ reason_code, message }) => `${reason_code}: ${message}`)));
  }
  if (state.step === "projects") {
    const saveProjects = action("save-projects", "Save projects and close", options.allowProjectCapsuleSave ? `${state.selectedCandidateIds.length} new approvals; existing approvals preserved` : "Unavailable — no capsule save destination", { kind: "save" }, !options.allowProjectCapsuleSave, ["Explicitly saves project approvals and exits.", "Does not confirm or activate the runtime plan."]);
    const existing = options.existingProjectCapsules ?? [];
    const existingIds = new Set(existing.filter(({ approved }) => approved).map(({ id }) => id));
    for (const capsule of existing) rows.push(info(`existing.${capsule.id}`, `${capsule.approved ? "✓ Approved" : "○ Existing"} · ${capsule.id}`, `${capsule.access} · ${capsule.relative_path}`, ["Existing capsule preserved.", `Repository: ${capsule.repository_identity}`, `Root: ${capsule.root_variable}`, `Access: ${capsule.access}`]));
    if (!existing.length) for (const capsule of plan.project_enrollments ?? []) rows.push(info(`existing.${capsule.id}`, `${capsule.approved ? "✓ Approved" : "○ Existing"} · ${capsule.id}`, capsule.access, ["Existing enrollment preserved."]));
    for (const candidate of plan.project_candidates ?? []) {
      const available = candidate.path_present && candidate.selectable !== false;
      const selected = state.selectedCandidateIds.includes(candidate.id);
      const approved = existingIds.has(candidate.id);
      rows.push(action(`project.${candidate.id}`, `${approved ? "✓ Approved" : !available ? "! Unavailable" : selected ? "✓ Approve" : "○ Choose"} · ${candidate.display_name}`,
        !available ? `PROJECT_PATH_UNAVAILABLE · ${candidate.mapping_status ?? "path missing"}` : approved ? "Existing approval preserved" : !options.allowProjectCapsuleSave ? "Unavailable — configure a project capsule save destination" : `${candidate.access} · Enter ${selected ? "removes pending approval" : "approves"}`,
        { kind: "project", id: candidate.id }, !available || approved || !options.allowProjectCapsuleSave,
        [`Repository: ${candidate.repository_identity}`, ...(candidate.repository_candidates ?? []).slice(0, 3).map((repository) => `Mapped: ${repository}`), `Folder: ${candidate.root_variable}/${candidate.relative_path}`, `Mapping: ${candidate.mapping_status ?? candidate.discovery_source}`, `Access: ${candidate.access}`, available ? "Continue and Cancel do not save pending choices." : "Mapped folder is missing or not selectable; approval blocked."]));
    }
    for (const finding of plan.project_discovery_findings ?? []) rows.push(info(`finding.${finding.source_id}.${finding.code}`, `! ${finding.source_id}`, finding.code, [finding.message]));
    rows.push(saveProjects);
  }
  if (state.step === "providers") {
    for (const provider of options.routing?.provider_options ?? []) {
      const allowed = options.routing?.compatible && provider.state === "held" && provider.auth_kind !== "api-key" && options.allowRoutingAuthorization;
      rows.push(action(`provider.${provider.id}`, `${provider.state === "connected" ? "✓ Connected" : "Connect"} · ${provider.display_name}`, `${provider.preference} · ${provider.hold_reason ?? provider.state}`, { kind: "authorize", id: provider.id }, !allowed, [provider.auth_kind, ...provider.guidance]));
    }
    if (!options.routing) rows.push(info("routing.unavailable", "Provider setup unavailable", "Choose a host profile and refresh", ["No bound routing snapshot available."]));
  }
  if (state.step === "combos") {
    rows.push(action("setup-combos", "Set up combos", options.allowRoutingSeating ? "Choose ordered live models for each phase alias" : "Unavailable — connect providers and refresh models", { kind: "seat" }, !options.allowRoutingSeating, ["Opens the dedicated combo seating flow.", "No provider is silently activated."]));
    for (const seat of options.routing?.alias_seats ?? []) rows.push(info(`alias.${seat.alias}`, seat.alias, seat.hold_reason ?? seat.state, [`State: ${seat.state}`, ...seat.selected_model_ids.map((id, index) => `${index + 1}. ${id}`)]));
  }
  if (state.step === "modules" || state.step === "integrations") {
    const modules = plan.modules.filter(({ id }) => id !== "provider.9router" && (state.step === "integrations" ? id.startsWith("integration.") : !id.startsWith("integration.")));
    const blocked = modules.filter(({ requested, status }) => requested && status === "blocked").map(({ id }) => id);
    if (blocked.length) rows.push(action("defer-blocked", "Defer blocked optional modules", `${blocked.length} held selections — re-probe without these requests`, { kind: "defer", ids: blocked }, !options.allowModuleReplan, blocked));
    for (const module of modules) rows.push(action(`module.${module.id}`, `${module.requested ? "✓ Requested" : "○ Choose"} · ${module.title}`,
      module.status === "blocked" ? `Held · ${module.holds.map(({ reason_code }) => reason_code).join(", ")}` : module.requested ? "Enter defers this module" : "Enter requests and re-probes dependencies",
      { kind: "module", id: module.id }, !options.allowModuleReplan || (!module.requested && module.status === "blocked"),
      [`Status: ${module.status}`, ...module.holds.flatMap(({ reason_code, message, remediation }) => [`${reason_code}: ${message}`, ...remediation]), ...module.guided_installs.map((install) => `${install.label}: ${install.kind === "command" ? install.argv.join(" ") : install.url}`)]));
    if (!modules.length) rows.push(info("modules.none", "No additional selections", "Continue when ready"));
  }
  if (state.step === "review") {
    rows.push(info("review.projects", "Project approvals", `${options.existingProjectCapsules?.filter(({ approved }) => approved).length ?? 0} existing · ${state.selectedCandidateIds.length} pending`, [options.allowProjectCapsuleSave ? "Pending approvals are saved only when you confirm." : "No save destination: pending approvals cannot be persisted."]));
    for (const module of plan.modules.filter(({ requested }) => requested)) rows.push(info(`review.${module.id}`, module.title, module.status, module.holds.map(({ reason_code, message }) => `${reason_code}: ${message}`)));
    for (const input of plan.configuration_inputs ?? []) rows.push(info(`configuration.${input.id}`, input.id, input.digest, input.details));
    rows.push(info("review.plan", "Exact plan", `${plan.install_order.length} eligible modules`, [`Digest: ${plan.plan_digest}`, `Order: ${plan.install_order.join(" → ") || "none"}`]));
  }
  const summary = state.step === "projects"
    ? `${options.existingProjectCapsules?.filter(({ approved }) => approved).length ?? plan.project_enrollments?.filter(({ approved }) => approved).length ?? 0} approved · ${plan.project_candidates?.length ?? 0} candidates · ${plan.project_candidates?.filter(({ mapping_status }) => Boolean(mapping_status)).length ?? 0} mapped · ${plan.project_candidates?.filter(({ path_present, selectable }) => !path_present || selectable === false).length ?? 0} unavailable · ${state.selectedCandidateIds.length} pending`
    : `${state.selectedModuleIds.length} modules requested · ${state.selectedCandidateIds.length} project approvals pending`;
  return { step: state.step, stepNumber, ...COPY[state.step], summary, rows };
}

/** Pure action-key controller. The renderer owns only arrow-key focus. */
export function handleOnboardingWizardKey(plan: OnboardingPlanV1, state: OnboardingWizardState, options: OnboardingWizardOptions, key: string, rowId?: string): { state: OnboardingWizardState; effect?: WizardEffect } {
  if (key === "q" || key === "escape") return { state, effect: { kind: "cancel" } };
  const confirmShortcut = key.toLowerCase() === "y" && state.step === "review";
  if (key !== "enter" && key !== "return" && !confirmShortcut) return { state };
  const row = createOnboardingWizardView(plan, state, options).rows.find(({ id }) => id === (confirmShortcut ? "confirm" : rowId));
  if (!row) return { state };
  if (row.disabled) return { state: { ...state, notice: `${row.title}: ${row.description}` } };
  const action = row.action;
  const clear = { ...state, notice: undefined };
  if (action.kind === "next" || action.kind === "back") {
    const index = ONBOARDING_WIZARD_STEPS.indexOf(state.step) + (action.kind === "next" ? 1 : -1);
    return { state: { ...clear, step: ONBOARDING_WIZARD_STEPS[index] ?? state.step } };
  }
  if (action.kind === "project") {
    const ids = new Set(state.selectedCandidateIds);
    if (ids.has(action.id)) ids.delete(action.id); else ids.add(action.id);
    return { state: { ...clear, selectedCandidateIds: [...ids].sort(), notice: "Pending approval updated; nothing saved yet." } };
  }
  if (action.kind === "module" || action.kind === "defer") {
    const selections = new Set(state.selectedModuleIds);
    if (action.kind === "defer") for (const id of action.ids) selections.delete(id);
    else if (selections.has(action.id)) selections.delete(action.id); else selections.add(action.id);
    return { state: clear, effect: { kind: "replan", selectedModuleIds: [...selections].sort() } };
  }
  if (action.kind === "authorize") return { state: clear, effect: { kind: "authorize", providerId: action.id } };
  if (action.kind === "info") return { state: { ...clear, notice: row.description } };
  return { state: clear, effect: { kind: action.kind } };
}

/** Builds a handoff only; persistence, OAuth and seating remain caller-owned. */
export function completeOnboardingWizard(plan: OnboardingPlanV1, state: OnboardingWizardState, options: OnboardingWizardOptions, effect: WizardEffect, confirmedAt?: string): OnboardingWizardResult {
  const confirmed = effect.kind === "confirm";
  if (confirmed && (state.step !== "review" || !canConfirmOnboardingWizard(plan) || !confirmedAt)) throw new Error("ONBOARDING_CONFIRMATION_BLOCKED");
  if (confirmed && state.selectedCandidateIds.length > 0 && !options.allowProjectCapsuleSave) throw new Error("ONBOARDING_PROJECT_SAVE_UNAVAILABLE");
  if (effect.kind === "save" && !options.allowProjectCapsuleSave) throw new Error("ONBOARDING_PROJECT_SAVE_UNAVAILABLE");
  const save = Boolean(options.allowProjectCapsuleSave) && (effect.kind === "save" || (confirmed && state.selectedCandidateIds.length > 0));
  const resume = effect.kind === "authorize" || effect.kind === "seat" || effect.kind === "refresh";
  return {
    confirmed, ...(confirmed ? { confirmed_at: confirmedAt } : {}),
    plan_digest: plan.plan_digest, selected_module_ids: [...state.selectedModuleIds],
    save_project_capsules: save,
    project_capsules: save ? approveProjectCandidates(options.existingProjectCapsules ?? [], plan.project_candidates ?? [], new Set(state.selectedCandidateIds)) : [...(options.existingProjectCapsules ?? [])],
    selected_candidate_ids: [...state.selectedCandidateIds],
    ...(resume ? { resume_step: state.step } : {}),
    ...(effect.kind === "authorize" ? { routing_authorization_provider_id: effect.providerId } : {}),
    ...(effect.kind === "seat" ? { routing_seating_requested: true } : {}),
    ...(effect.kind === "refresh" ? { refresh_requested: true } : {}),
  };
}
