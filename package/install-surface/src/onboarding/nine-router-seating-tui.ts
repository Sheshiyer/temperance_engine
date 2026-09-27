import {
  BoxRenderable,
  CliRenderEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type SelectOption,
  type CliRenderer,
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
  /** In-memory renderer injection for terminal verification only. */
  renderer?: CliRenderer;
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

export interface NineRouterSeatingFlowState {
  draft: NineRouterSeatingDraft;
  alias_index: number;
  current_model?: string;
  status: "editing" | "confirmed" | "cancelled";
  notice?: string;
}

export type NineRouterSeatingAction =
  | { kind: "model"; id: string }
  | { kind: "move"; direction: -1 | 1 }
  | { kind: "continue" | "back" | "cancel" };

export function advanceNineRouterSeatingFlow(state: NineRouterSeatingFlowState, action: NineRouterSeatingAction): NineRouterSeatingFlowState {
  if (state.status !== "editing") return state;
  const seat = state.draft.seats[state.alias_index];
  if (action.kind === "cancel" || (action.kind === "back" && state.alias_index === 0)) return { ...state, status: "cancelled" };
  if (action.kind === "back") return { ...state, alias_index: state.alias_index - 1, current_model: undefined, notice: undefined };
  if (!seat) return { ...state, notice: "No semantic alias is available." };
  if (action.kind === "model") return { ...state, draft: toggleNineRouterSeatModel(state.draft, seat.alias, action.id), current_model: action.id, notice: undefined };
  if (action.kind === "move") {
    if (!state.current_model || !seat.selected_model_ids.includes(state.current_model)) return { ...state, notice: "Select a model first, then choose Move earlier or Move later." };
    return { ...state, draft: moveNineRouterSeatModel(state.draft, seat.alias, state.current_model, action.direction), notice: undefined };
  }
  if (seat.state !== "ready") return { ...state, notice: "Choose at least one live provider model before continuing." };
  if (state.alias_index < state.draft.seats.length - 1) return { ...state, alias_index: state.alias_index + 1, current_model: undefined, notice: undefined };
  return canConfirmNineRouterSeating(state.draft)
    ? { ...state, status: "confirmed", notice: undefined }
    : { ...state, notice: "Every alias needs a live provider model; use Back to complete it." };
}

export function nineRouterSeatingFlowOptions(state: NineRouterSeatingFlowState): SelectOption[] {
  const seat = state.draft.seats[state.alias_index];
  const view = createNineRouterSeatingTuiView(state.draft, seat?.alias);
  return [
    { name: state.alias_index === state.draft.seats.length - 1 ? "Continue to final 9Router review" : "Continue to next alias", description: "Requires at least one selected live model", value: { kind: "continue" } },
    { name: state.alias_index === 0 ? "Back to provider setup" : "Back to previous alias", description: "Keep current choices while moving back", value: { kind: "back" } },
    { name: "Move highlighted model earlier", description: "Earlier means higher fallback priority", value: { kind: "move", direction: -1 } },
    { name: "Move highlighted model later", description: "Later means lower fallback priority", value: { kind: "move", direction: 1 } },
    { name: "Cancel seating", description: "No changes will be applied", value: { kind: "cancel" } },
    ...view.model_options.map(option => ({ ...option, value: { kind: "model", id: option.value } })),
  ];
}

/**
 * Collects ordered combo membership from live 9Router choices. It has no file,
 * Keychain, API-write, or host-mutation capability; the caller must bind the
 * returned combos into a newly reviewed onboarding plan.
 */
export async function runNineRouterSeatingTui(options: NineRouterSeatingTuiOptions): Promise<NineRouterSeatingTuiResult> {
  let state: NineRouterSeatingFlowState = { draft: createNineRouterSeatingDraft(options.requiredAliases, options.availableModels, options.initialSelections), alias_index: 0, status: "editing" };
  const renderer = options.renderer ?? await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, { id: "9router-seating-root", width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0b1020", padding: 1 });
  const header = new TextRenderable(renderer, { height: 3, flexShrink: 0, content: "", fg: "#d8dee9" });
  const detail = new TextRenderable(renderer, { height: 3, flexShrink: 0, content: "", fg: "#88c0d0" });
  const selector = new SelectRenderable(renderer, { id: "sequential-alias-models", width: "100%", flexGrow: 1, minHeight: 3, options: [], wrapSelection: true, showDescription: false, showScrollIndicator: true, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const footer = new TextRenderable(renderer, { height: 2, flexShrink: 0, content: "↑/↓ choose · Enter toggles model or activates action\nHome: actions · [ / ] reorder selected model · Esc: cancel", fg: "#88c0d0" });
  root.add(header); root.add(detail); root.add(selector); root.add(footer); renderer.root.add(root);
  let closed = false;
  let refreshing = false;
  const refresh = (index = selector.getSelectedIndex()): void => {
    refreshing = true;
    const seat = state.draft.seats[state.alias_index]!;
    header.content = `9Router seating · Alias ${state.alias_index + 1}/${state.draft.seats.length}\n${seat.alias}\nChoose live models in fallback order. Nothing is applied yet.`;
    detail.content = `${state.notice ?? (seat.state === "held" ? "Held: connect a provider, then refresh the live catalog." : "Enter on a model selects/removes it; first selected is the head.")}\nOrdered seats: ${seat.selected_model_ids.length}; highlighted: ${state.current_model ?? "none"}`;
    selector.options = nineRouterSeatingFlowOptions(state);
    selector.setSelectedIndex(Math.max(0, Math.min(index, selector.options.length - 1)));
    refreshing = false;
  };
  selector.on(SelectRenderableEvents.SELECTION_CHANGED, (_index: number, option: SelectOption) => {
    if (refreshing || option?.value?.kind !== "model") return;
    state = { ...state, current_model: option.value.id };
    const seat = state.draft.seats[state.alias_index]!;
    detail.content = `Live provider model: ${option.value.id}\nSelected order: ${seat.selected_model_ids.indexOf(option.value.id) + 1 || "not selected"}\nUse Move earlier/later actions or [ / ] to reorder.`;
  });
  refresh(state.draft.choices.length ? 5 : 0);
  selector.focus(); renderer.start();

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = (): void => { if (finished) return; finished = true; closed = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (finished) return; finished = true; closed = true; resolve(); });
    const activate = (action: NineRouterSeatingAction): void => {
      if (closed) return;
      const previousAlias = state.alias_index;
      state = advanceNineRouterSeatingFlow(state, action);
      if (state.status !== "editing") { finish(); return; }
      refresh(previousAlias === state.alias_index ? selector.getSelectedIndex() : state.draft.choices.length ? 5 : 0);
    };
    selector.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => { if (option?.value) activate(option.value); });
    renderer.keyInput.on("keypress", (key) => {
      if (closed) return;
      if (key.name === "q" || key.name === "escape") { activate({ kind: "cancel" }); return; }
      if (key.name === "home") selector.setSelectedIndex(0);
      if (key.name === "end") selector.setSelectedIndex(selector.options.length - 1);
      if (key.name === "[" || key.name === "]") activate({ kind: "move", direction: key.name === "[" ? -1 : 1 });
      if (key.name === "space" && selector.getSelectedOption()?.value?.kind === "model") activate(selector.getSelectedOption()!.value);
    });
  });
  const confirmed = state.status === "confirmed";
  return {
    confirmed,
    confirmed_at: confirmed ? (options.now?.() ?? new Date()).toISOString() : undefined,
    combos: confirmed ? compileNineRouterSeatCombos(state.draft) : [],
  };
}
