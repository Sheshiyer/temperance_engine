import {
  BoxRenderable, CliRenderEvents, SelectRenderable, SelectRenderableEvents, TabSelectRenderable, TabSelectRenderableEvents,
  TextRenderable, createCliRenderer, type SelectOption, type TabSelectOption,
} from "@opentui/core";
import type { OnboardingPlanV1 } from "./contracts.ts";
import { createOnboardingViewModel, type OnboardingViewPage, type OnboardingViewRow } from "./presentation.ts";
import { approveProjectCandidates } from "./project-discovery.ts";
import { verifyOnboardingPlanDigest } from "./planner.ts";
import type { ProjectCapsuleV1 } from "./public-contracts.ts";
export { createOnboardingViewModel, renderOnboardingText } from "./presentation.ts";

export interface OnboardingTuiOptions {
  existingProjectCapsules?: readonly ProjectCapsuleV1[];
  allowProjectCapsuleSave?: boolean;
  replanModuleSelections?: (selections: ReadonlySet<string>) => Promise<OnboardingPlanV1>;
  now?: () => Date;
}

export interface OnboardingTuiResult {
  confirmed: boolean;
  confirmed_at?: string;
  plan_digest: OnboardingPlanV1["plan_digest"];
  selected_module_ids: string[];
  save_project_capsules: boolean;
  project_capsules: ProjectCapsuleV1[];
}

export function canConfirmOnboardingPlan(plan: OnboardingPlanV1): boolean {
  return plan.operating_mode !== "blocked" && plan.install_order.length > 0;
}

export function selectedOnboardingModuleIds(plan: OnboardingPlanV1): Set<string> {
  return new Set(plan.modules.filter(({ requested }) => requested).map(({ id }) => id));
}

export function toggleOnboardingModuleSelection(
  plan: OnboardingPlanV1,
  selections: ReadonlySet<string>,
  moduleId: string,
): Set<string> {
  if (!plan.modules.some(({ id }) => id === moduleId)) throw new Error(`ONBOARDING_MODULE_UNKNOWN:${moduleId}`);
  const next = new Set(selections);
  if (next.has(moduleId)) next.delete(moduleId);
  else next.add(moduleId);
  return next;
}

function detailsFor(row: OnboardingViewRow): string {
  const lines = [row.title, `id: ${row.id}`, `status: ${row.status}`];
  if (row.blocked_reasons.length > 0) lines.push("", "Blocked by:", ...row.blocked_reasons.map((reason) => `• ${reason}`));
  if (row.guidance.length > 0) lines.push("", "Guided actions:", ...row.guidance.map((item) => `• ${item}`));
  if (row.blocked_reasons.length === 0 && row.guidance.length === 0) lines.push("", "Ready with no additional action.");
  return lines.join("\n");
}

export async function runOnboardingTui(plan: OnboardingPlanV1, options: OnboardingTuiOptions = {}): Promise<OnboardingTuiResult> {
  let currentPlan = plan;
  let view = createOnboardingViewModel(currentPlan);
  const renderer = await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, { id: "onboarding-root", width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0b1020", padding: 1, gap: 1 });
  const header = new BoxRenderable(renderer, { width: "100%", height: 5, border: true, borderStyle: "rounded", borderColor: view.mode === "ready" ? "#59d499" : view.mode === "read-only-degraded" ? "#f4bf75" : "#ef6b73", title: view.title, paddingX: 1 });
  const headerText = new TextRenderable(renderer, { content: `${view.dry_run ? "READ-ONLY PLAN" : "COMMIT PLAN"} · ${view.summary}\nProfile: ${view.profile_id} · Mode: ${view.mode} · ${currentPlan.plan_digest.slice(0, 24)}…`, fg: "#d8dee9" });
  header.add(headerText);
  const tabOptions: TabSelectOption[] = view.pages.map((page) => ({ name: page.title, description: page.id, value: page.id }));
  const tabs = new TabSelectRenderable(renderer, { width: "100%", height: 3, options: tabOptions, wrapSelection: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const content = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  const selector = new SelectRenderable(renderer, { id: "page-list", width: "42%", height: "100%", options: [], wrapSelection: true, showDescription: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const detailBox = new BoxRenderable(renderer, { width: "58%", height: "100%", border: true, borderStyle: "single", borderColor: "#4c566a", title: "Eligibility & guided setup", padding: 1 });
  const detail = new TextRenderable(renderer, { content: "", fg: "#d8dee9" });
  detailBox.add(detail);
  let currentPage: OnboardingViewPage = view.pages[0]!;
  let currentRowId: string | undefined;
  const candidateIds = new Set((currentPlan.project_candidates ?? []).filter((candidate) => candidate.selectable !== false && candidate.path_present).map((candidate) => candidate.id));
  const selectedCandidateIds = new Set<string>();
  let selectedModuleIds = selectedOnboardingModuleIds(currentPlan);
  const showPage = (page: OnboardingViewPage, preferredRowId?: string): void => {
    currentPage = page;
    selector.options = page.rows.map((row): SelectOption => ({ name: `${row.status === "eligible" ? "✓" : row.status === "blocked" ? "!" : "○"} ${row.title}`, description: row.blocked_reasons.join(", ") || row.status, value: row.id }));
    const selectedIndex = Math.max(0, page.rows.findIndex(({ id }) => id === preferredRowId));
    selector.setSelectedIndex(selectedIndex);
    currentRowId = page.rows[selectedIndex]?.id;
    detail.content = page.rows[selectedIndex] ? detailsFor(page.rows[selectedIndex]!) : `No ${page.title.toLowerCase()} entries.`;
    detailBox.title = page.id === "review" ? "Exact operation plan & confirmation" : `${page.title} details`;
  };
  showPage(currentPage);
  selector.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    currentRowId = typeof option?.value === "string" ? option.value : undefined;
    const row = currentPage.rows.find((candidate) => candidate.id === option?.value);
    if (row) detail.content = detailsFor(row);
  });
  tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: TabSelectOption) => { const page = view.pages.find((candidate) => candidate.id === option?.value); if (page) showPage(page); });
  content.add(selector); content.add(detailBox);
  let confirmable = canConfirmOnboardingPlan(currentPlan);
  let confirmed = false;
  let confirmedAt: string | undefined;
  const footer = new TextRenderable(renderer, { height: 1, content: `←/→ pages · ↑/↓ inspect · space request/unrequest module · a select project · s save capsules · ${confirmable ? "c confirm review" : "resolve holds before confirmation"} · q/esc close`, fg: "#88c0d0" });
  root.add(header); root.add(tabs); root.add(content); root.add(footer); renderer.root.add(root); tabs.focus(); renderer.start();
  let saveProjectCapsules = false;
  let closed = false;
  let replanning = false;
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => { if (finished) return; finished = true; closed = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (finished) return; finished = true; closed = true; resolve(); });
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q" || key.name === "escape") finish();
      if (key.name === "space" && currentPage.id === "modules" && currentRowId && !replanning) {
        if (!options.replanModuleSelections) {
          detail.content = "Module selection is read-only in this operation.\n\nRepair mode keeps the reviewed module scope immutable.";
          return;
        }
        const requestedModuleId = currentRowId;
        const nextSelections = toggleOnboardingModuleSelection(currentPlan, selectedModuleIds, requestedModuleId);
        replanning = true;
        confirmed = false;
        confirmedAt = undefined;
        detail.content = `${requestedModuleId}\n\nRe-probing the dependency graph for this selection…`;
        footer.content = "Re-probing capabilities · q/esc close";
        void options.replanModuleSelections(nextSelections).then((nextPlan) => {
          if (closed) return;
          const returnedSelections = selectedOnboardingModuleIds(nextPlan);
          if (!verifyOnboardingPlanDigest(nextPlan)
            || nextPlan.profile_id !== currentPlan.profile_id
            || [...returnedSelections].sort().join("\n") !== [...nextSelections].sort().join("\n")) {
            throw new Error("ONBOARDING_REPLAN_INVALID");
          }
          currentPlan = nextPlan;
          selectedModuleIds = returnedSelections;
          view = createOnboardingViewModel(currentPlan);
          confirmable = canConfirmOnboardingPlan(currentPlan);
          headerText.content = `${view.dry_run ? "READ-ONLY PLAN" : "COMMIT PLAN"} · ${view.summary}\nProfile: ${view.profile_id} · Mode: ${view.mode} · ${currentPlan.plan_digest.slice(0, 24)}…`;
          const page = view.pages.find(({ id }) => id === currentPage.id) ?? view.pages[0]!;
          showPage(page, requestedModuleId);
          footer.content = `Module plan updated · ${selectedModuleIds.size} requested · ${confirmable ? "review and confirm" : "held selections cannot be enabled"} · q/esc close`;
        }).catch((error) => {
          if (closed) return;
          detail.content = `${requestedModuleId}\n\nRe-plan failed safely: ${error instanceof Error ? error.message : "ONBOARDING_REPLAN_FAILED"}.\nNo selection or host state changed.`;
          footer.content = "Module selection unchanged · q/esc close";
        }).finally(() => { replanning = false; });
      }
      if (key.name === "a" && currentPage.id === "projects" && currentRowId && candidateIds.has(currentRowId)) {
        if (selectedCandidateIds.has(currentRowId)) selectedCandidateIds.delete(currentRowId);
        else selectedCandidateIds.add(currentRowId);
        const candidate = currentPlan.project_candidates?.find((item) => item.id === currentRowId);
        detail.content = `${candidate?.display_name ?? currentRowId}\n\n${selectedCandidateIds.has(currentRowId) ? "SELECTED for explicit capsule approval" : "PENDING approval"}.\nDiscovery alone grants no project authority.`;
        footer.content = `${selectedCandidateIds.size} project candidate(s) selected · s save capsules · q/esc cancel`;
      }
      if (key.name === "s" && currentPage.id === "projects") {
        if (!options.allowProjectCapsuleSave) {
          detail.content = "Project capsule save is unavailable.\n\nRerun with an explicit --project-capsules-out path; no host state changed.";
          return;
        }
        saveProjectCapsules = true;
        finish();
      }
      if (key.name === "c" && currentPage.id === "review") {
        if (!confirmable) {
          detail.content = `Confirmation refused for ${currentPlan.plan_digest}.\n\nResolve every blocking hold, then re-probe and review the new digest.`;
          footer.content = "Blocked plans cannot be confirmed · q/esc close";
          return;
        }
        confirmed = true;
        confirmedAt = (options.now?.() ?? new Date()).toISOString();
        detail.content = `Confirmation recorded for ${currentPlan.plan_digest}.\n\nNo host state changed; a cutover executor must consume this exact digest.`;
        footer.content = "Confirmation recorded · q/esc close";
      }
    });
  });
  return {
    confirmed,
    confirmed_at: confirmedAt,
    plan_digest: currentPlan.plan_digest,
    selected_module_ids: [...selectedModuleIds].sort(),
    save_project_capsules: saveProjectCapsules,
    project_capsules: saveProjectCapsules
      ? approveProjectCandidates(options.existingProjectCapsules ?? [], currentPlan.project_candidates ?? [], selectedCandidateIds)
      : [...(options.existingProjectCapsules ?? [])],
  };
}
