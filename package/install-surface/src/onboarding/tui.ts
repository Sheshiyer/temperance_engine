import {
  BoxRenderable, CliRenderEvents, SelectRenderable, SelectRenderableEvents,
  TextRenderable, createCliRenderer, type SelectOption,
} from "@opentui/core";
import type { OnboardingPlanV1 } from "./contracts.ts";
import type { NineRouterRoutingSurface } from "./nine-router-provider-capabilities.ts";
import { verifyOnboardingPlanDigest } from "./planner.ts";
import { completeOnboardingWizard, createOnboardingWizardState, createOnboardingWizardView, handleOnboardingWizardKey, type OnboardingWizardOptions, type OnboardingWizardResult, type WizardEffect, type WizardRow } from "./wizard.ts";
export { createOnboardingViewModel, renderOnboardingText } from "./presentation.ts";
export type { WizardStepId } from "./wizard.ts";

export interface OnboardingTuiOptions extends OnboardingWizardOptions {
  replanModuleSelections?: (selections: ReadonlySet<string>) => Promise<OnboardingPlanV1>;
  now?: () => Date;
  /** Renderer injection supports deterministic keyboard and size regressions. */
  createRenderer?: typeof createCliRenderer;
}
export interface OnboardingTuiResult extends OnboardingWizardResult {}

// Preserve the original exported helpers. The wizard has a stricter final hold guard.
export function canConfirmOnboardingPlan(plan: OnboardingPlanV1): boolean {
  return plan.operating_mode !== "blocked" && plan.install_order.length > 0;
}
export function selectedOnboardingModuleIds(plan: OnboardingPlanV1): Set<string> {
  return new Set(plan.modules.filter(({ requested }) => requested).map(({ id }) => id));
}
export function toggleOnboardingModuleSelection(plan: OnboardingPlanV1, selections: ReadonlySet<string>, moduleId: string): Set<string> {
  if (!plan.modules.some(({ id }) => id === moduleId)) throw new Error(`ONBOARDING_MODULE_UNKNOWN:${moduleId}`);
  const next = new Set(selections);
  if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
  return next;
}
export function actionableRoutingProvider(surface: NineRouterRoutingSurface | undefined, rowId: string | undefined): string | undefined {
  if (!surface?.compatible || !rowId?.startsWith("provider.")) return undefined;
  const provider = surface.provider_options.find(({ id }) => id === rowId.slice("provider.".length));
  return provider && provider.state === "held" && provider.auth_kind !== "api-key" ? provider.id : undefined;
}
function rowDetails(row: WizardRow | undefined): string {
  return row ? [row.title, row.description, "", ...row.details.slice(0, 8)].join("\n") : "Choose an action with ↑/↓, then press Enter.";
}

export async function runOnboardingTui(plan: OnboardingPlanV1, options: OnboardingTuiOptions = {}): Promise<OnboardingTuiResult> {
  let currentPlan = plan;
  const wizardOptions = { ...options, allowModuleReplan: Boolean(options.replanModuleSelections) };
  let state = createOnboardingWizardState(plan, wizardOptions);
  let view = createOnboardingWizardView(currentPlan, state, wizardOptions);
  let currentRowId: string | undefined = view.rows[0]?.id;
  let exitEffect: WizardEffect = { kind: "cancel" };
  let confirmedAt: string | undefined;
  let closed = false;
  let replanning = false;
  const renderer = await (options.createRenderer ?? createCliRenderer)({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, { id: "onboarding-wizard", width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0b1020", padding: 1, gap: 1 });
  const heading = new TextRenderable(renderer, { height: 4, content: "", fg: "#d8dee9" });
  const body = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  const selector = new SelectRenderable(renderer, { id: "wizard-actions", width: "60%", height: "100%", options: [], wrapSelection: false, showDescription: false, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const details = new BoxRenderable(renderer, { flexGrow: 1, height: "100%", border: true, borderColor: "#4c566a", title: "Selected action", paddingX: 1 });
  const detail = new TextRenderable(renderer, { content: "", fg: "#d8dee9" });
  const footer = new TextRenderable(renderer, { height: 1, content: "↑/↓ choose · Enter activate · q/esc cancel", fg: "#88c0d0" });
  details.add(detail); body.add(selector); body.add(details);
  root.add(heading); root.add(body); root.add(footer); renderer.root.add(root);
  const show = (preferredRowId?: string): void => {
    view = createOnboardingWizardView(currentPlan, state, wizardOptions);
    heading.content = `Temperance Setup · Step ${view.stepNumber}/7: ${view.title}\n${view.why}\n${view.next}\n${view.summary}`;
    selector.options = view.rows.map((row): SelectOption => ({ name: row.title, description: row.description, value: row.id }));
    const index = Math.max(0, view.rows.findIndex(({ id }) => id === preferredRowId));
    currentRowId = view.rows[index]?.id;
    selector.setSelectedIndex(index);
    detail.content = state.notice ? `${state.notice}\n\n${rowDetails(view.rows[index])}` : rowDetails(view.rows[index]);
  };
  selector.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    currentRowId = typeof option?.value === "string" ? option.value : undefined;
    detail.content = rowDetails(view.rows.find(({ id }) => id === currentRowId));
  });
  show(); selector.focus(); renderer.start();
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (effect: WizardEffect): void => {
      if (finished) return;
      exitEffect = effect;
      if (effect.kind === "confirm") confirmedAt = (options.now?.() ?? new Date()).toISOString();
      finished = true; closed = true; renderer.destroy(); resolve();
    };
    renderer.once(CliRenderEvents.DESTROY, () => { if (!finished) { finished = true; closed = true; resolve(); } });
    renderer.keyInput.on("keypress", (key) => {
      if (closed) return;
      if (key.name === "q" || key.name === "escape") { finish({ kind: "cancel" }); return; }
      if (replanning) return;
      const previousStep = state.step;
      const transition = handleOnboardingWizardKey(currentPlan, state, wizardOptions, key.name, currentRowId);
      if (transition.state === state && !transition.effect) return;
      state = transition.state;
      const effect = transition.effect;
      if (effect?.kind === "replan") {
        if (!options.replanModuleSelections) return;
        const requested = new Set(effect.selectedModuleIds);
        const preferred = currentRowId;
        replanning = true;
        detail.content = "Re-probing selections and dependencies…\nNothing is enabled while checks are running.";
        footer.content = "Checking dependencies · q/esc cancel";
        void options.replanModuleSelections(requested).then((nextPlan) => {
          if (closed) return;
          const returned = [...selectedOnboardingModuleIds(nextPlan)].sort();
          if (!verifyOnboardingPlanDigest(nextPlan) || nextPlan.profile_id !== currentPlan.profile_id || returned.join("\n") !== [...requested].sort().join("\n")) throw new Error("ONBOARDING_REPLAN_INVALID");
          currentPlan = nextPlan;
          state = createOnboardingWizardState(nextPlan, { ...wizardOptions, initialStep: state.step, selectedCandidateIds: state.selectedCandidateIds, notice: "Dependencies re-probed; held selections are not enabled." });
          show(preferred);
        }).catch((error) => {
          if (closed) return;
          state = { ...state, notice: `Selection unchanged: ${error instanceof Error ? error.message : "ONBOARDING_REPLAN_FAILED"}` };
          show(preferred);
        }).finally(() => { replanning = false; if (!closed) footer.content = "↑/↓ choose · Enter activate · q/esc cancel"; });
        return;
      }
      if (effect) { finish(effect); return; }
      show(state.step === previousStep ? currentRowId : undefined);
    });
  });
  return completeOnboardingWizard(currentPlan, state, wizardOptions, exitEffect, confirmedAt);
}
