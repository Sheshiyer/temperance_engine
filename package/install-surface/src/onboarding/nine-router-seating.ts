import type { NineRouterAvailableModel } from "./nine-router-api.ts";
import {
  NINE_ROUTER_GUIDED_SETUP_SCHEMA,
  type NineRouterGuidedSetupV1,
  type NineRouterSetupIntentV1,
} from "./public-contracts.ts";

export type NineRouterSeatState = "held" | "unseated" | "ready";

export interface NineRouterSeatingChoice {
  id: string;
  owner: string;
}

export interface NineRouterAliasSeat {
  alias: string;
  selected_model_ids: string[];
  state: NineRouterSeatState;
  hold_reason?: "LIVE_PROVIDER_MODELS_UNAVAILABLE";
}

export interface NineRouterSeatingDraft {
  choices: NineRouterSeatingChoice[];
  seats: NineRouterAliasSeat[];
}

export class NineRouterSeatingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "NineRouterSeatingError";
  }
}

const SAFE_ALIAS = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

function modelId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.trim() !== value || CONTROL_CHARACTER.test(value)) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_INVALID");
  }
  return value;
}

function ownerId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.trim() !== value || CONTROL_CHARACTER.test(value)) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_OWNER_INVALID");
  }
  return value;
}

function aliasId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ALIAS.test(value)) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_ALIAS_INVALID");
  }
  return value;
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) throw new NineRouterSeatingError(code);
}

function stateFor(selected: readonly string[], choiceCount: number): Pick<NineRouterAliasSeat, "state" | "hold_reason"> {
  if (choiceCount === 0) return { state: "held", hold_reason: "LIVE_PROVIDER_MODELS_UNAVAILABLE" };
  return selected.length === 0 ? { state: "unseated", hold_reason: undefined } : { state: "ready", hold_reason: undefined };
}

/**
 * Builds the provider-agnostic selection state used by the router seating TUI.
 * Combo-kind catalog rows are intentionally excluded to prevent nested combos.
 */
export function createNineRouterSeatingDraft(
  requiredAliases: readonly string[],
  availableModels: readonly NineRouterAvailableModel[],
  initialSelections: Readonly<Record<string, readonly string[]>> = {},
): NineRouterSeatingDraft {
  if (requiredAliases.length < 1 || requiredAliases.length > 128) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_ALIASES_INVALID");
  }
  const aliases = requiredAliases.map(aliasId);
  assertUnique(aliases, "NINE_ROUTER_SEATING_ALIAS_DUPLICATE");

  const catalog = availableModels.map((model) => ({
    id: modelId(model.id),
    owner: ownerId(model.owner),
    kind: model.kind,
  }));
  if (catalog.some(({ kind }) => kind !== "provider" && kind !== "combo")) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_KIND_INVALID");
  }
  assertUnique(catalog.map(({ id }) => id), "NINE_ROUTER_SEATING_MODEL_DUPLICATE");
  const choices = catalog
    .filter(({ kind }) => kind === "provider")
    .map(({ id, owner }) => ({ id, owner }))
    .sort((left, right) => left.owner.localeCompare(right.owner) || left.id.localeCompare(right.id));
  const choiceIds = new Set(choices.map(({ id }) => id));

  for (const alias of Object.keys(initialSelections)) {
    if (!aliases.includes(alias)) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_ALIAS_UNKNOWN");
  }
  const seats = aliases.map((alias): NineRouterAliasSeat => {
    const selected = [...(initialSelections[alias] ?? [])].map(modelId);
    if (selected.length > 256) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODELS_INVALID");
    assertUnique(selected, "NINE_ROUTER_SEATING_MODEL_DUPLICATE");
    if (selected.some((id) => !choiceIds.has(id))) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_UNAVAILABLE");
    return { alias, selected_model_ids: selected, ...stateFor(selected, choices.length) };
  });
  return { choices, seats };
}

function updateSeat(
  draft: NineRouterSeatingDraft,
  alias: string,
  update: (selected: string[]) => string[],
): NineRouterSeatingDraft {
  const seatIndex = draft.seats.findIndex((seat) => seat.alias === alias);
  if (seatIndex < 0) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_ALIAS_UNKNOWN");
  const next = structuredClone(draft);
  const seat = next.seats[seatIndex]!;
  const selected = update([...seat.selected_model_ids]);
  Object.assign(seat, { selected_model_ids: selected, ...stateFor(selected, next.choices.length) });
  return next;
}

export function toggleNineRouterSeatModel(
  draft: NineRouterSeatingDraft,
  alias: string,
  model: string,
): NineRouterSeatingDraft {
  const id = modelId(model);
  if (!draft.choices.some((choice) => choice.id === id)) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_UNAVAILABLE");
  }
  return updateSeat(draft, aliasId(alias), (selected) => {
    const index = selected.indexOf(id);
    if (index >= 0) selected.splice(index, 1);
    else {
      if (selected.length >= 256) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODELS_INVALID");
      selected.push(id);
    }
    return selected;
  });
}

export function moveNineRouterSeatModel(
  draft: NineRouterSeatingDraft,
  alias: string,
  model: string,
  direction: -1 | 1,
): NineRouterSeatingDraft {
  if (direction !== -1 && direction !== 1) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MOVE_INVALID");
  const id = modelId(model);
  return updateSeat(draft, aliasId(alias), (selected) => {
    const index = selected.indexOf(id);
    if (index < 0) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_NOT_SELECTED");
    const target = index + direction;
    if (target < 0 || target >= selected.length) return selected;
    [selected[index], selected[target]] = [selected[target]!, selected[index]!];
    return selected;
  });
}

export function compileNineRouterSeatCombos(draft: NineRouterSeatingDraft): Array<{ alias: string; models: string[] }> {
  if (draft.seats.some(({ state, selected_model_ids }) => state !== "ready" || selected_model_ids.length === 0)) {
    throw new NineRouterSeatingError("NINE_ROUTER_SEATING_INCOMPLETE");
  }
  return draft.seats.map(({ alias, selected_model_ids }) => ({ alias, models: [...selected_model_ids] }));
}

export function compileNineRouterGuidedSetup(
  intent: NineRouterSetupIntentV1,
  draft: NineRouterSeatingDraft,
): NineRouterGuidedSetupV1 {
  const combos = compileNineRouterSeatCombos(draft);
  return {
    schema: NINE_ROUTER_GUIDED_SETUP_SCHEMA,
    version: { major: 1, minor: 0 },
    providers: structuredClone(intent.providers),
    combos,
    required_aliases: combos.map(({ alias }) => alias),
    gateway_key: structuredClone(intent.gateway_key),
  };
}
