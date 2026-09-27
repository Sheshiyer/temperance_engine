import {
  BoxRenderable,
  CliRenderEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type SelectOption,
  type TabSelectOption,
} from "@opentui/core";

import type { V4CutoverConfirmation } from "../../../router/v4-cutover-executor.ts";
import {
  advanceV4CutoverConfirmationFromKey,
  type V4CutoverConfirmationState,
  type V4CutoverViewModel,
  type V4CutoverViewPage,
  type V4CutoverViewRow,
} from "./v4-cutover-review.ts";

function rowDetails(row: V4CutoverViewRow): string {
  return [row.title, `status: ${row.status}`, "", ...row.details.map((detail) => `• ${detail}`)].join("\n");
}

export async function runV4CutoverTui(
  view: V4CutoverViewModel,
  options: { now?: () => Date } = {},
): Promise<V4CutoverConfirmation | undefined> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const ready = view.readiness === "ready";
  const root = new BoxRenderable(renderer, {
    id: "v4-cutover-root", width: "100%", height: "100%", flexDirection: "column",
    backgroundColor: "#0b1020", padding: 1, gap: 1,
  });
  const header = new BoxRenderable(renderer, {
    width: "100%", height: 6, border: true, borderStyle: "rounded",
    borderColor: ready ? "#f4bf75" : "#ef6b73", title: view.title, paddingX: 1,
  });
  header.add(new TextRenderable(renderer, {
    content: `${ready ? "READY FOR EXPLICIT CONFIRMATION" : "BLOCKED — READ ONLY"}\nPlan: ${view.plan_digest}\nProof: ${view.proof_digest}`,
    fg: "#d8dee9",
  }));
  const tabs = new TabSelectRenderable(renderer, {
    width: "100%", height: 3,
    options: view.pages.map((page): TabSelectOption => ({ name: page.title, description: page.id, value: page.id })),
    wrapSelection: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff",
  });
  const content = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  const selector = new SelectRenderable(renderer, {
    width: "42%", height: "100%", options: [], wrapSelection: true, showDescription: true,
    selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff",
  });
  const detailBox = new BoxRenderable(renderer, {
    width: "58%", height: "100%", border: true, borderStyle: "single",
    borderColor: "#4c566a", title: "Reviewed detail", padding: 1,
  });
  const detail = new TextRenderable(renderer, { content: "", fg: "#d8dee9" });
  detailBox.add(detail);
  let page: V4CutoverViewPage = view.pages[0]!;
  const showPage = (next: V4CutoverViewPage): void => {
    page = next;
    selector.options = page.rows.map((row): SelectOption => ({
      name: `${row.status === "ready" || row.status === "not-needed" ? "✓" : row.status === "blocked" || row.status === "manual" ? "!" : "−"} ${row.title}`,
      description: row.status,
      value: row.id,
    }));
    selector.setSelectedIndex(0);
    detail.content = page.rows[0] ? rowDetails(page.rows[0]) : `No ${page.title.toLowerCase()} entries.`;
  };
  showPage(page);
  selector.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    const row = page.rows.find((candidate) => candidate.id === option?.value);
    if (row) detail.content = rowDetails(row);
  });
  tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: TabSelectOption) => {
    const selected = view.pages.find((candidate) => candidate.id === option?.value);
    if (selected) showPage(selected);
  });
  content.add(selector);
  content.add(detailBox);
  const footer = new TextRenderable(renderer, {
    height: 1,
    content: `←/→ pages · ↑/↓ inspect · ${ready ? "Confirm page: Enter/y once" : "resolve holds and regenerate plan"} · q/esc close`,
    fg: "#88c0d0",
  });
  root.add(header);
  root.add(tabs);
  root.add(content);
  root.add(footer);
  renderer.root.add(root);
  tabs.focus();
  renderer.start();
  let state: V4CutoverConfirmationState = { status: "unconfirmed" };
  let confirmation: V4CutoverConfirmation | undefined;
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => { if (finished) return; finished = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (finished) return; finished = true; resolve(); });
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q" || key.name === "escape") {
        finish();
        return;
      }
      try {
        state = advanceV4CutoverConfirmationFromKey(view, page.id, key.name, state, options.now);
        if (state.status === "confirmed") {
          confirmation = state.confirmation;
          finish();
        }
      } catch (error) {
        detail.content = error instanceof Error ? error.message : "CUTOVER_CONFIRMATION_FAILED";
      }
    });
  });
  return confirmation;
}
