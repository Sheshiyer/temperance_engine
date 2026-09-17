import {
  BoxRenderable,
  CliRenderEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type SelectOption,
} from "@opentui/core";

import type { NineRouterAvailableModel } from "./nine-router-api.ts";
import {
  compileNineRouterSeatCombos,
  createNineRouterSeatingDraft,
  moveNineRouterSeatModel,
  toggleNineRouterSeatModel,
  type NineRouterSeatingDraft,
} from "./nine-router-seating.ts";

export interface NineRouterSeatingTuiOptions {
  requiredAliases: readonly string[];
  availableModels: readonly NineRouterAvailableModel[];
  initialSelections?: Readonly<Record<string, readonly string[]>>;
  now?: () => Date;
}

export interface NineRouterSeatingTuiResult {
  confirmed: boolean;
  confirmed_at?: string;
  combos: Array<{ alias: string; models: string[] }>;
}

export interface NineRouterSeatingTuiView {
  alias_options: SelectOption[];
  model_options: SelectOption[];
  detail: string;
  confirmable: boolean;
}

export function canConfirmNineRouterSeating(draft: NineRouterSeatingDraft): boolean {
  return draft.seats.length > 0 && draft.seats.every(({ state }) => state === "ready");
}

export function createNineRouterSeatingTuiView(
  draft: NineRouterSeatingDraft,
  currentAlias = draft.seats[0]?.alias,
): NineRouterSeatingTuiView {
  const seat = draft.seats.find(({ alias }) => alias === currentAlias) ?? draft.seats[0];
  const aliasOptions = draft.seats.map((item): SelectOption => ({
    name: `${item.state === "ready" ? "✓" : item.state === "held" ? "!" : "○"} ${item.alias}`,
    description: item.state === "ready"
      ? `${item.selected_model_ids.length} ordered model${item.selected_model_ids.length === 1 ? "" : "s"}`
      : item.hold_reason ?? "select at least one model",
    value: item.alias,
  }));
  if (!seat) return { alias_options: aliasOptions, model_options: [], detail: "No semantic aliases declared.", confirmable: false };
  const order = new Map(seat.selected_model_ids.map((id, index) => [id, index + 1]));
  const modelOptions = draft.choices.map((choice): SelectOption => ({
    name: order.has(choice.id) ? `✓ ${order.get(choice.id)}. ${choice.id}` : `○ ${choice.id}`,
    description: choice.owner,
    value: choice.id,
  }));
  const detail = seat.state === "held"
    ? `${seat.alias}\n\nHeld: ${seat.hold_reason}.\nAdmit at least one provider, then refresh 9Router's live model catalog.`
    : `${seat.alias}\n\nOrdered seats:\n${seat.selected_model_ids.map((id, index) => `${index + 1}. ${id}`).join("\n") || "none"}\n\nOnly live provider models are selectable; combo nesting is refused.`;
  return { alias_options: aliasOptions, model_options: modelOptions, detail, confirmable: canConfirmNineRouterSeating(draft) };
}

/**
 * Collects ordered combo membership from live 9Router choices. It has no file,
 * Keychain, API-write, or host-mutation capability; the caller must bind the
 * returned combos into a newly reviewed onboarding plan.
 */
export async function runNineRouterSeatingTui(options: NineRouterSeatingTuiOptions): Promise<NineRouterSeatingTuiResult> {
  let draft = createNineRouterSeatingDraft(options.requiredAliases, options.availableModels, options.initialSelections);
  let currentAlias = draft.seats[0]?.alias;
  let currentModel = draft.choices[0]?.id;
  let view = createNineRouterSeatingTuiView(draft, currentAlias);
  const renderer = await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, { id: "9router-seating-root", width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0b1020", padding: 1, gap: 1 });
  const header = new BoxRenderable(renderer, { width: "100%", height: 5, border: true, borderStyle: "rounded", borderColor: "#88c0d0", title: "9Router semantic seating", paddingX: 1 });
  const headerText = new TextRenderable(renderer, { content: "LIVE CATALOG · provider models only\nSelections remain uncommitted until the onboarding plan is reviewed.", fg: "#d8dee9" });
  header.add(headerText);
  const content = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row", gap: 1 });
  const aliases = new SelectRenderable(renderer, { id: "semantic-aliases", width: "34%", height: "100%", options: view.alias_options, wrapSelection: true, showDescription: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const modelsBox = new BoxRenderable(renderer, { width: "40%", height: "100%", border: true, borderStyle: "single", borderColor: "#4c566a", title: "Live model dropdown", padding: 1 });
  const models = new SelectRenderable(renderer, { id: "provider-models", width: "100%", height: "100%", options: view.model_options, wrapSelection: true, showDescription: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  modelsBox.add(models);
  const detailBox = new BoxRenderable(renderer, { width: "26%", height: "100%", border: true, borderStyle: "single", borderColor: "#4c566a", title: "Ordered seat", padding: 1 });
  const detail = new TextRenderable(renderer, { content: view.detail, fg: "#d8dee9" });
  detailBox.add(detail);
  content.add(aliases); content.add(modelsBox); content.add(detailBox);
  const footer = new TextRenderable(renderer, { height: 1, content: "←/→ switch pane · ↑/↓ choose · space toggle · [/] reorder · c continue · q cancel", fg: "#88c0d0" });
  root.add(header); root.add(content); root.add(footer); renderer.root.add(root); aliases.focus(); renderer.start();

  let focused: "aliases" | "models" = "aliases";
  let confirmed = false;
  let confirmedAt: string | undefined;
  let closed = false;
  const refresh = (): void => {
    view = createNineRouterSeatingTuiView(draft, currentAlias);
    aliases.options = view.alias_options;
    models.options = view.model_options;
    detail.content = view.detail;
    if (!currentModel || !draft.choices.some(({ id }) => id === currentModel)) currentModel = draft.choices[0]?.id;
    const modelIndex = Math.max(0, draft.choices.findIndex(({ id }) => id === currentModel));
    if (models.options.length > 0) models.setSelectedIndex(modelIndex);
    footer.content = `←/→ switch pane · ↑/↓ choose · space toggle · [/] reorder · ${view.confirmable ? "c continue" : "seat every alias"} · q cancel`;
  };
  aliases.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    if (typeof option?.value !== "string") return;
    currentAlias = option.value;
    refresh();
  });
  models.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    if (typeof option?.value === "string") currentModel = option.value;
  });

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => { if (finished) return; finished = true; closed = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (finished) return; finished = true; closed = true; resolve(); });
    renderer.keyInput.on("keypress", (key) => {
      if (closed) return;
      if (key.name === "q" || key.name === "escape") finish();
      if (key.name === "left" || key.name === "right" || key.name === "tab") {
        focused = focused === "aliases" ? "models" : "aliases";
        if (focused === "aliases") aliases.focus(); else models.focus();
      }
      if (key.name === "space" && focused === "models" && currentAlias && currentModel) {
        draft = toggleNineRouterSeatModel(draft, currentAlias, currentModel);
        refresh();
      }
      if ((key.name === "[" || key.name === "]") && focused === "models" && currentAlias && currentModel) {
        const seat = draft.seats.find(({ alias }) => alias === currentAlias);
        if (seat?.selected_model_ids.includes(currentModel)) {
          draft = moveNineRouterSeatModel(draft, currentAlias, currentModel, key.name === "[" ? -1 : 1);
          refresh();
        }
      }
      if (key.name === "c") {
        if (!canConfirmNineRouterSeating(draft)) {
          detail.content = `${view.detail}\n\nEvery semantic alias needs at least one live provider model.`;
          return;
        }
        confirmed = true;
        confirmedAt = (options.now?.() ?? new Date()).toISOString();
        finish();
      }
    });
  });
  return {
    confirmed,
    confirmed_at: confirmedAt,
    combos: confirmed ? compileNineRouterSeatCombos(draft) : [],
  };
}
