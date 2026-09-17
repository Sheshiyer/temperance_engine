import {
  BoxRenderable, CliRenderEvents, SelectRenderable, SelectRenderableEvents, TabSelectRenderable, TabSelectRenderableEvents,
  TextRenderable, createCliRenderer, type SelectOption, type TabSelectOption,
} from "@opentui/core";
import type { OnboardingPlanV1 } from "./contracts.ts";
import { createOnboardingViewModel, type OnboardingViewPage, type OnboardingViewRow } from "./presentation.ts";
export { createOnboardingViewModel, renderOnboardingText } from "./presentation.ts";

export interface OnboardingTuiResult { confirmed: boolean; plan_digest: OnboardingPlanV1["plan_digest"]; }

export function canConfirmOnboardingPlan(plan: OnboardingPlanV1): boolean {
  return plan.operating_mode !== "blocked" && plan.install_order.length > 0;
}

function detailsFor(row: OnboardingViewRow): string {
  const lines = [row.title, `id: ${row.id}`, `status: ${row.status}`];
  if (row.blocked_reasons.length > 0) lines.push("", "Blocked by:", ...row.blocked_reasons.map((reason) => `• ${reason}`));
  if (row.guidance.length > 0) lines.push("", "Guided actions:", ...row.guidance.map((item) => `• ${item}`));
  if (row.blocked_reasons.length === 0 && row.guidance.length === 0) lines.push("", "Ready with no additional action.");
  return lines.join("\n");
}

export async function runOnboardingTui(plan: OnboardingPlanV1): Promise<OnboardingTuiResult> {
  const view = createOnboardingViewModel(plan);
  const renderer = await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, { id: "onboarding-root", width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0b1020", padding: 1, gap: 1 });
  const header = new BoxRenderable(renderer, { width: "100%", height: 5, border: true, borderStyle: "rounded", borderColor: view.mode === "ready" ? "#59d499" : view.mode === "read-only-degraded" ? "#f4bf75" : "#ef6b73", title: view.title, paddingX: 1 });
  header.add(new TextRenderable(renderer, { content: `${view.dry_run ? "READ-ONLY PLAN" : "COMMIT PLAN"} · ${view.summary}\nProfile: ${view.profile_id} · Mode: ${view.mode} · ${plan.plan_digest.slice(0, 24)}…`, fg: "#d8dee9" }));
  const tabOptions: TabSelectOption[] = view.pages.map((page) => ({ name: page.title, description: page.id, value: page.id }));
  const tabs = new TabSelectRenderable(renderer, { width: "100%", height: 3, options: tabOptions, wrapSelection: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const content = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  const selector = new SelectRenderable(renderer, { id: "page-list", width: "42%", height: "100%", options: [], wrapSelection: true, showDescription: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const detailBox = new BoxRenderable(renderer, { width: "58%", height: "100%", border: true, borderStyle: "single", borderColor: "#4c566a", title: "Eligibility & guided setup", padding: 1 });
  const detail = new TextRenderable(renderer, { content: "", fg: "#d8dee9" });
  detailBox.add(detail);
  let currentPage: OnboardingViewPage = view.pages[0]!;
  const showPage = (page: OnboardingViewPage): void => {
    currentPage = page;
    selector.options = page.rows.map((row): SelectOption => ({ name: `${row.status === "eligible" ? "✓" : row.status === "blocked" ? "!" : "○"} ${row.title}`, description: row.blocked_reasons.join(", ") || row.status, value: row.id }));
    selector.setSelectedIndex(0);
    detail.content = page.rows[0] ? detailsFor(page.rows[0]) : `No ${page.title.toLowerCase()} entries.`;
    detailBox.title = page.id === "review" ? "Exact operation plan & confirmation" : `${page.title} details`;
  };
  showPage(currentPage);
  selector.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => { const row = currentPage.rows.find((candidate) => candidate.id === option?.value); if (row) detail.content = detailsFor(row); });
  tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: TabSelectOption) => { const page = view.pages.find((candidate) => candidate.id === option?.value); if (page) showPage(page); });
  content.add(selector); content.add(detailBox);
  const confirmable = canConfirmOnboardingPlan(plan);
  let confirmed = false;
  const footer = new TextRenderable(renderer, { height: 1, content: `←/→ pages · ↑/↓ inspect · ${confirmable ? "c confirm review" : "resolve holds before confirmation"} · q/esc close`, fg: "#88c0d0" });
  root.add(header); root.add(tabs); root.add(content); root.add(footer); renderer.root.add(root); tabs.focus(); renderer.start();
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => { if (finished) return; finished = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (finished) return; finished = true; resolve(); });
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q" || key.name === "escape") finish();
      if (key.name === "c" && currentPage.id === "review") {
        if (!confirmable) {
          detail.content = `Confirmation refused for ${plan.plan_digest}.\n\nResolve every blocking hold, then re-probe and review the new digest.`;
          footer.content = "Blocked plans cannot be confirmed · q/esc close";
          return;
        }
        confirmed = true;
        detail.content = `Confirmation recorded for ${plan.plan_digest}.\n\nNo host state changed; a cutover executor must consume this exact digest.`;
        footer.content = "Confirmation recorded · q/esc close";
      }
    });
  });
  return { confirmed, plan_digest: plan.plan_digest };
}
