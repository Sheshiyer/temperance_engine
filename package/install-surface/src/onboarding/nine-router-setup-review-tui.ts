import { BoxRenderable, CliRenderEvents, SelectRenderable, SelectRenderableEvents, TextRenderable, createCliRenderer, type CliRenderer, type SelectOption } from "@opentui/core";
import type { OnboardingPlanV1 } from "./contracts.ts";
import { verifyOnboardingPlanDigest } from "./planner.ts";

export interface NineRouterSetupReviewResult {
  confirmed: boolean;
  plan_digest: OnboardingPlanV1["plan_digest"];
  confirmed_at?: string;
}

export type NineRouterSetupReviewAction = "detail" | "apply" | "cancel";
export interface NineRouterSetupReviewState extends NineRouterSetupReviewResult {
  status: "reviewing" | "confirmed" | "cancelled";
}

/** Same narrow scope as the governed repair; reviewing never invokes an effector. */
export function nineRouterSetupReviewHolds(plan: OnboardingPlanV1): string[] {
  const holds: string[] = [];
  if (!verifyOnboardingPlanDigest(plan)) holds.push("Plan digest is invalid; regenerate the review.");
  if (plan.dry_run) holds.push("This is a dry-run plan; Apply 9Router is disabled.");
  if (plan.operating_mode !== "ready") holds.push(`Plan mode is ${plan.operating_mode}; resolve holds first.`);
  if (plan.install_order.length !== 1 || plan.install_order[0] !== "provider.9router") holds.push("Only provider.9router may be in this operation.");
  const requested = plan.modules.filter(module => module.requested);
  if (requested.length !== 1 || requested[0]?.id !== "provider.9router" || requested[0]?.status !== "eligible" || requested[0]?.holds.length) holds.push("Exactly one eligible, unblocked 9Router module must be selected.");
  if (plan.configuration_inputs?.length !== 1 || plan.configuration_inputs[0]?.id !== "9router-guided-setup" || plan.configuration_inputs[0]?.details.length === 0) holds.push("The exact guided 9Router configuration must be bound to this plan.");
  return holds;
}

export function advanceNineRouterSetupReview(plan: OnboardingPlanV1, state: NineRouterSetupReviewState, action: NineRouterSetupReviewAction, now: () => Date = () => new Date()): NineRouterSetupReviewState {
  if (state.status !== "reviewing") return state;
  if (action === "cancel") return { confirmed: false, plan_digest: plan.plan_digest, status: "cancelled" };
  if (action !== "apply" || state.plan_digest !== plan.plan_digest || nineRouterSetupReviewHolds(plan).length) return state;
  return { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: now().toISOString(), status: "confirmed" };
}

function wrappedLines(text: string, width: number): string[] {
  // Terminal control bytes cannot escape the review surface; no values are truncated.
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "�").split("\n").flatMap(line => {
    const chars = Array.from(line);
    if (!chars.length) return [""];
    const result: string[] = [];
    for (let offset = 0; offset < chars.length; offset += width) result.push(chars.slice(offset, offset + width).join(""));
    return result;
  });
}

export function createNineRouterSetupReviewOptions(plan: OnboardingPlanV1, width = 72): SelectOption[] {
  const holds = nineRouterSetupReviewHolds(plan);
  const details = [
    "OPERATION: Apply the reviewed 9Router configuration only.",
    "The executor may create the listed providers, ordered combos and gateway key.",
    "Gateway credential is stored through the referenced Keychain entry, never here.",
    "This review writes nothing. Only the caller's governed repair can apply it.",
    `Profile: ${plan.profile_id}`,
    `Plan digest: ${plan.plan_digest}`,
    `Operation order: ${plan.install_order.join(" → ") || "none"}`,
    ...holds.map(hold => `BLOCKED: ${hold}`),
    ...plan.modules.filter(module => module.requested).flatMap(module => [
      `Module: ${module.id} (${module.status})`,
      ...module.holds.map(hold => `Hold: ${hold.reason_code} · ${hold.message}`),
    ]),
    ...plan.configuration_inputs?.flatMap(input => [
      `Configuration: ${input.id}`,
      `Configuration digest: ${input.digest}`,
      ...input.details,
    ]) ?? [],
    "END OF EXACT CONFIGURATION — choose an action below.",
  ];
  const rows: SelectOption[] = details.flatMap(detail => wrappedLines(detail, Math.max(16, Math.floor(width))).map(name => ({ name: name || " ", description: "Review detail", value: "detail" })));
  rows.push({ name: holds.length ? "Apply 9Router — BLOCKED" : "Apply 9Router", description: "Confirm this exact digest once", value: "apply" });
  rows.push({ name: "Cancel — return without applying", description: "No API, Keychain, or file changes", value: "cancel" });
  return rows;
}

/** Captures one explicit confirmation; has no API, Keychain, or filesystem writer. */
export async function runNineRouterSetupReviewTui(plan: OnboardingPlanV1, options: { now?: () => Date; renderer?: CliRenderer } = {}): Promise<NineRouterSetupReviewResult> {
  const reviewed = structuredClone(plan);
  let state: NineRouterSetupReviewState = { confirmed: false, plan_digest: reviewed.plan_digest, status: "reviewing" };
  const renderer = options.renderer ?? await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const holds = nineRouterSetupReviewHolds(reviewed);
  const root = new BoxRenderable(renderer, { width: "100%", height: "100%", padding: 1, flexDirection: "column", backgroundColor: "#0b1020" });
  const header = new TextRenderable(renderer, { height: 3, flexShrink: 0, content: `9Router · Final configuration review\n${holds.length ? "BLOCKED — cancellation only" : "Review every operation, then Apply 9Router or Cancel."}\nNo changes occur until the governed executor consumes confirmation.`, fg: holds.length ? "#ef6b73" : "#d8dee9" });
  const rows = new SelectRenderable(renderer, { id: "9router-exact-review", width: "100%", flexGrow: 1, minHeight: 3, options: createNineRouterSetupReviewOptions(reviewed, Math.max(16, renderer.width - 6)), showDescription: false, showScrollIndicator: true, wrapSelection: false, selectedBackgroundColor: "#2c5282", selectedTextColor: "#ffffff" });
  const footer = new TextRenderable(renderer, { height: 2, flexShrink: 0, content: "↑/↓ scroll · PgUp/PgDn page · Home/End: first detail/actions\nEnter/y on Apply 9Router confirms once · Esc cancels", fg: "#88c0d0" });
  root.add(header); root.add(rows); root.add(footer); renderer.root.add(root); rows.focus(); renderer.start();
  await new Promise<void>((resolve) => {
    let closed = false;
    const finish = (): void => { if (closed) return; closed = true; renderer.destroy(); resolve(); };
    renderer.once(CliRenderEvents.DESTROY, () => { if (closed) return; closed = true; resolve(); });
    const activate = (action: NineRouterSetupReviewAction): void => {
      if (closed) return;
      state = advanceNineRouterSetupReview(reviewed, state, action, options.now);
      if (state.status !== "reviewing") finish();
    };
    rows.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => activate(option.value));
    renderer.keyInput.on("keypress", key => {
      if (closed) return;
      if (key.name === "escape" || key.name === "q") { activate("cancel"); return; }
      if (key.name.toLowerCase() === "y") activate(rows.getSelectedOption()?.value ?? "detail");
      if (key.name === "home") rows.setSelectedIndex(0);
      if (key.name === "end") rows.setSelectedIndex(rows.options.length - 2);
      if (key.name === "pageup") rows.moveUp(Math.max(1, renderer.height - 8));
      if (key.name === "pagedown") rows.moveDown(Math.max(1, renderer.height - 8));
    });
  });
  return { confirmed: state.confirmed, plan_digest: state.plan_digest, ...(state.confirmed_at ? { confirmed_at: state.confirmed_at } : {}) };
}
