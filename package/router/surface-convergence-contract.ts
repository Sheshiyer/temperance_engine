import { readFileSync } from "node:fs";
import { EFFORT_TIERS, type EffortTier } from "./effort-contract.ts";

export const SURFACE_STAGE_IDS = [
  "observe",
  "think",
  "plan",
  "build",
  "execute",
  "verify",
  "learn",
] as const;

export type SurfaceStageId = (typeof SURFACE_STAGE_IDS)[number];
export type SurfaceApproval = "none" | "workflow-defined" | "execution-grant" | "external-authority";
export type SurfaceExecutionPlane = "codex-cockpit" | "claude-superset-hands";
export type SurfaceHoldReason =
  | "surface_contract_invalid"
  | "surface_command_unknown"
  | "surface_mapping_missing"
  | "surface_mapping_divergent";
export type SurfaceSource = "gsd-rail-map" | "phase-combo-map" | "alchemy-stage-hub-map";

export interface OperatorSelection {
  model?: string;
  profile?: string;
}

export interface SurfaceHold {
  ok: false;
  reasonCode: SurfaceHoldReason;
  source: SurfaceSource;
  key: string;
}

interface RailCommand {
  mode: string;
  view: string;
  group: string;
  stage: SurfaceStageId | null;
  route?: string | null;
  route_sequence?: string[];
  approval: SurfaceApproval;
  execution_plane: SurfaceExecutionPlane;
  [key: string]: unknown;
}

interface RailMap {
  schema: string;
  groups: Record<string, string[]>;
  commands: Record<string, RailCommand>;
  effort_contract: {
    mode_defaults: Record<string, EffortTier>;
    command_overrides: Record<string, EffortTier>;
  };
}

interface PhaseComboMap {
  schema: string;
  task_type_to_combo: Record<string, string>;
  algorithm_phases: Record<string, string>;
  coordinator: {
    lane: string;
    provider: string;
    supported_surfaces: string[];
  };
}

interface StageHub {
  name: string;
}

interface StageDetail {
  sigil: string;
  alchemy: string;
  combo: string;
  mode: string;
  primary_hubs: StageHub[];
  mcp_policy: {
    required: string[];
    allowed: string[];
  };
  agent: {
    name: string;
    kosha: string;
    maxTurns: number;
  };
}

interface AlchemyMap {
  schema: string;
  stages: string[];
  stages_detail: Record<string, StageDetail>;
}

export interface SurfaceContractSources {
  railMap: unknown;
  phaseComboMap: unknown;
  alchemyMap: unknown;
}

export interface SurfaceContract {
  readonly railMap: Readonly<RailMap>;
  readonly phaseComboMap: Readonly<PhaseComboMap>;
  readonly alchemyMap: Readonly<AlchemyMap>;
}

export interface SurfaceStageResolution {
  id: SurfaceStageId;
  ordinal: number;
  next: SurfaceStageId | null;
  combo: string;
  sigil: string;
  alchemy: string;
  mode: string;
  hubNames: readonly string[];
  mcpPolicy: Readonly<{ required: readonly string[]; allowed: readonly string[] }>;
  phaseAgent: Readonly<{
    name: string;
    kosha: string;
    maxTurns: number;
  }>;
}

export interface SurfaceCommandResolution {
  command: string;
  mode: string;
  view: string;
  stage: SurfaceStageId | null;
  combos: readonly string[];
  approval: SurfaceApproval;
  executionPlane: SurfaceExecutionPlane;
  phaseAgent: SurfaceStageResolution["phaseAgent"] | null;
  sigil: string | null;
  alchemy: string | null;
  hubNames: readonly string[];
  effort: EffortTier;
  coordinatorLane: string;
  mcpPolicy: SurfaceStageResolution["mcpPolicy"] | null;
  operatorSelection?: Readonly<OperatorSelection>;
}

export type SurfaceValidationResult =
  | { ok: true; contract: SurfaceContract }
  | SurfaceHold;
export type SurfaceStageResult =
  | { ok: true; value: Readonly<SurfaceStageResolution> }
  | SurfaceHold;
export type SurfaceCommandResult =
  | { ok: true; value: Readonly<SurfaceCommandResolution> }
  | SurfaceHold;

export interface SurfaceContractPaths {
  railMap?: string | URL;
  phaseComboMap?: string | URL;
  alchemyMap?: string | URL;
}

const APPROVALS = new Set<SurfaceApproval>([
  "none",
  "workflow-defined",
  "execution-grant",
  "external-authority",
]);
const EXECUTION_PLANES = new Set<SurfaceExecutionPlane>([
  "codex-cockpit",
  "claude-superset-hands",
]);
const HEAVY_COMMANDS = new Set(["execute-phase", "execute-plan", "autonomous"]);
const NO_HITL_COMMANDS = new Set(["help", "stats", "note", "progress", "list-workspaces"]);
const EXTERNAL_AUTHORITY_COMMANDS = new Set(["ship", "pr-branch"]);
const ROUTE_PATTERN = /^(phase:([A-Z][A-Za-z]+)|task:([a-z0-9]+(?:-[a-z0-9]+)*))$/;
const KOSHAS = new Set(["ANNAMAYA", "PRANAMAYA", "MANOMAYA", "VIJNANAMAYA", "ANANDAMAYA"]);
const PHASE_NAME_BY_STAGE: Record<SurfaceStageId, string> = {
  observe: "Observe",
  think: "Think",
  plan: "Plan",
  build: "Build",
  execute: "Execute",
  verify: "Verify",
  learn: "Learn",
};

function hold(reasonCode: SurfaceHoldReason, source: SurfaceSource, key: string): SurfaceHold {
  return Object.freeze({ ok: false, reasonCode, source, key });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function routeRefs(command: RailCommand): string[] {
  if (Array.isArray(command.route_sequence)) return command.route_sequence;
  return command.route === null ? [] : [command.route as string];
}

function validateRailMap(value: unknown): SurfaceHold | RailMap {
  if (!isRecord(value) || value.schema !== "temperance.gsd-rail-map.v3") {
    return hold("surface_contract_invalid", "gsd-rail-map", "schema");
  }
  if (!isRecord(value.commands) || !isRecord(value.groups)) {
    return hold("surface_contract_invalid", "gsd-rail-map", "commands");
  }
  if (!isRecord(value.effort_contract) || !isStringRecord(value.effort_contract.mode_defaults) ||
    !isStringRecord(value.effort_contract.command_overrides)) {
    return hold("surface_contract_invalid", "gsd-rail-map", "effort_contract");
  }
  const modeDefaults = value.effort_contract.mode_defaults as Record<string, string>;
  const effortOverrides = value.effort_contract.command_overrides as Record<string, string>;
  if (Object.values(modeDefaults).some((tier) => !EFFORT_TIERS.includes(tier as EffortTier)) ||
    Object.values(effortOverrides).some((tier) => !EFFORT_TIERS.includes(tier as EffortTier))) {
    return hold("surface_contract_invalid", "gsd-rail-map", "effort_contract");
  }

  const commands = value.commands as Record<string, RailCommand>;
  const grouped = new Map<string, number>();
  for (const [group, entries] of Object.entries(value.groups)) {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      return hold("surface_contract_invalid", "gsd-rail-map", `group:${group}`);
    }
    for (const commandName of entries) grouped.set(commandName, (grouped.get(commandName) ?? 0) + 1);
  }

  for (const [commandName, command] of Object.entries(commands)) {
    if (!isRecord(command)) return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    if (typeof command.mode !== "string" || typeof command.view !== "string" || typeof command.group !== "string") {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    if (!(command.stage === null || SURFACE_STAGE_IDS.includes(command.stage))) {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    if (!APPROVALS.has(command.approval) || !EXECUTION_PLANES.has(command.execution_plane)) {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    const hasRoute = Object.hasOwn(command, "route");
    const hasSequence = Object.hasOwn(command, "route_sequence");
    if (hasRoute === hasSequence) return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    if (hasRoute && !(command.route === null || typeof command.route === "string")) {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    if (hasSequence && (!Array.isArray(command.route_sequence) || command.route_sequence.length === 0 ||
      command.route_sequence.some((entry) => typeof entry !== "string"))) {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    if (routeRefs(command).some((entry) => !ROUTE_PATTERN.test(entry))) {
      return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    }
    if (grouped.get(commandName) !== 1 || !(value.groups[command.group] as unknown[]).includes(commandName)) {
      return hold("surface_mapping_divergent", "gsd-rail-map", commandName);
    }
    const expectedPlane = HEAVY_COMMANDS.has(commandName) ? "claude-superset-hands" : "codex-cockpit";
    if (command.execution_plane !== expectedPlane) {
      return hold("surface_mapping_divergent", "gsd-rail-map", commandName);
    }
    const expectedApproval = NO_HITL_COMMANDS.has(commandName)
      ? "none"
      : EXTERNAL_AUTHORITY_COMMANDS.has(commandName)
        ? "external-authority"
        : HEAVY_COMMANDS.has(commandName)
          ? "execution-grant"
          : "workflow-defined";
    if (command.approval !== expectedApproval) {
      return hold("surface_mapping_divergent", "gsd-rail-map", commandName);
    }
    const tier = effortOverrides[commandName] ?? modeDefaults[command.mode];
    if (!tier || !EFFORT_TIERS.includes(tier as EffortTier)) {
      return hold("surface_mapping_missing", "gsd-rail-map", `effort:${commandName}`);
    }
  }
  if (grouped.size !== Object.keys(commands).length ||
    [...grouped].some(([name, count]) => !(name in commands) || count !== 1)) {
    return hold("surface_mapping_divergent", "gsd-rail-map", "groups");
  }
  return value as unknown as RailMap;
}

function validatePhaseMap(value: unknown): SurfaceHold | PhaseComboMap {
  if (!isRecord(value) || value.schema !== "temperance.phase-combo-map.v2") {
    return hold("surface_contract_invalid", "phase-combo-map", "schema");
  }
  if (!isStringRecord(value.task_type_to_combo) || !isStringRecord(value.algorithm_phases)) {
    return hold("surface_contract_invalid", "phase-combo-map", "mappings");
  }
  if (!isRecord(value.coordinator) || value.coordinator.lane !== "noesis-orchestrator" ||
    value.coordinator.provider !== "omniroute" || !Array.isArray(value.coordinator.supported_surfaces) ||
    value.coordinator.supported_surfaces.some((surface) => typeof surface !== "string")) {
    return hold("surface_contract_invalid", "phase-combo-map", "coordinator");
  }
  for (const [key, combo] of [
    ...Object.entries(value.task_type_to_combo),
    ...Object.entries(value.algorithm_phases),
  ]) {
    if (!/^noesis-[a-z0-9-]+$/.test(combo)) {
      return hold("surface_contract_invalid", "phase-combo-map", key);
    }
  }
  return value as unknown as PhaseComboMap;
}

function validateAlchemyMap(value: unknown): SurfaceHold | AlchemyMap {
  if (!isRecord(value) || value.schema !== "temperance.alchemy-stage-hub-map.v3") {
    return hold("surface_contract_invalid", "alchemy-stage-hub-map", "schema");
  }
  if (!Array.isArray(value.stages) || !isRecord(value.stages_detail)) {
    return hold("surface_contract_invalid", "alchemy-stage-hub-map", "stages");
  }
  const stageLabels = value.stages;
  if (stageLabels.length !== SURFACE_STAGE_IDS.length) {
    return hold("surface_mapping_missing", "alchemy-stage-hub-map", "stages");
  }
  for (const [index, stage] of SURFACE_STAGE_IDS.entries()) {
    const label = stageLabels[index];
    if (typeof label !== "string" || !label.endsWith(` ${stage.toUpperCase()}`)) {
      return hold("surface_mapping_divergent", "alchemy-stage-hub-map", stage);
    }
    const detail = value.stages_detail[stage];
    if (!isRecord(detail)) return hold("surface_mapping_missing", "alchemy-stage-hub-map", stage);
    if (typeof detail.sigil !== "string" || typeof detail.alchemy !== "string" ||
      typeof detail.combo !== "string" || typeof detail.mode !== "string") {
      return hold("surface_contract_invalid", "alchemy-stage-hub-map", stage);
    }
    if (!Array.isArray(detail.primary_hubs) ||
      detail.primary_hubs.some((hub) => !isRecord(hub) || typeof hub.name !== "string")) {
      return hold("surface_contract_invalid", "alchemy-stage-hub-map", stage);
    }
    if (!isRecord(detail.mcp_policy) || !Array.isArray(detail.mcp_policy.required) ||
      !Array.isArray(detail.mcp_policy.allowed) ||
      detail.mcp_policy.required.some((entry) => typeof entry !== "string") ||
      detail.mcp_policy.allowed.some((entry) => typeof entry !== "string") ||
      detail.mcp_policy.required.some((entry) => !detail.mcp_policy.allowed.includes(entry))) {
      return hold("surface_contract_invalid", "alchemy-stage-hub-map", `mcp:${stage}`);
    }
    if (!isRecord(detail.agent) || typeof detail.agent.name !== "string" ||
      typeof detail.agent.kosha !== "string" || !KOSHAS.has(detail.agent.kosha) ||
      !Number.isInteger(detail.agent.maxTurns) || (detail.agent.maxTurns as number) <= 0 ||
      (detail.agent.maxTurns as number) > 100) {
      return hold("surface_contract_invalid", "alchemy-stage-hub-map", stage);
    }
  }
  return value as unknown as AlchemyMap;
}

export function validateSurfaceContract(sources: SurfaceContractSources): SurfaceValidationResult {
  const railMap = validateRailMap(sources.railMap);
  if ("ok" in railMap) return railMap;
  const phaseComboMap = validatePhaseMap(sources.phaseComboMap);
  if ("ok" in phaseComboMap) return phaseComboMap;
  const alchemyMap = validateAlchemyMap(sources.alchemyMap);
  if ("ok" in alchemyMap) return alchemyMap;

  for (const [commandName, command] of Object.entries(railMap.commands)) {
    for (const route of routeRefs(command)) {
      const match = ROUTE_PATTERN.exec(route);
      const phase = match?.[2];
      const task = match?.[3];
      if (phase && !phaseComboMap.algorithm_phases[phase]) {
        return hold("surface_mapping_missing", "phase-combo-map", `phase:${phase}`);
      }
      if (task && !phaseComboMap.task_type_to_combo[task]) {
        return hold("surface_mapping_missing", "phase-combo-map", `task:${task}`);
      }
    }
    if (!(commandName in railMap.commands)) {
      return hold("surface_mapping_missing", "gsd-rail-map", commandName);
    }
  }

  for (const stage of SURFACE_STAGE_IDS) {
    const phaseName = PHASE_NAME_BY_STAGE[stage];
    const phaseCombo = phaseComboMap.algorithm_phases[phaseName];
    if (!phaseCombo) return hold("surface_mapping_missing", "phase-combo-map", `phase:${phaseName}`);
    if (alchemyMap.stages_detail[stage].combo !== phaseCombo) {
      return hold("surface_mapping_divergent", "alchemy-stage-hub-map", stage);
    }
  }

  return {
    ok: true,
    contract: deepFreeze({
      railMap: structuredClone(railMap),
      phaseComboMap: structuredClone(phaseComboMap),
      alchemyMap: structuredClone(alchemyMap),
    }),
  };
}

function parseJson(path: string | URL, source: SurfaceSource): unknown | SurfaceHold {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return hold("surface_contract_invalid", source, "read");
  }
}

export function loadSurfaceContract(paths: SurfaceContractPaths = {}): SurfaceValidationResult {
  const railMap = parseJson(paths.railMap ?? new URL("./gsd-rail-map.json", import.meta.url), "gsd-rail-map");
  if (isRecord(railMap) && railMap.ok === false) return railMap as unknown as SurfaceHold;
  const phaseComboMap = parseJson(
    paths.phaseComboMap ?? new URL("./phase-combo-map.json", import.meta.url),
    "phase-combo-map",
  );
  if (isRecord(phaseComboMap) && phaseComboMap.ok === false) return phaseComboMap as unknown as SurfaceHold;
  const alchemyMap = parseJson(
    paths.alchemyMap ?? new URL("./alchemy-stage-hub-map.json", import.meta.url),
    "alchemy-stage-hub-map",
  );
  if (isRecord(alchemyMap) && alchemyMap.ok === false) return alchemyMap as unknown as SurfaceHold;
  return validateSurfaceContract({ railMap, phaseComboMap, alchemyMap });
}

export function resolveSurfaceStage(
  contract: SurfaceContract,
  stage: SurfaceStageId,
): SurfaceStageResult {
  if (!SURFACE_STAGE_IDS.includes(stage)) {
    return hold("surface_mapping_missing", "alchemy-stage-hub-map", String(stage));
  }
  const detail = contract.alchemyMap.stages_detail[stage];
  const combo = contract.phaseComboMap.algorithm_phases[PHASE_NAME_BY_STAGE[stage]];
  if (!detail || !combo) return hold("surface_mapping_missing", "alchemy-stage-hub-map", stage);
  if (detail.combo !== combo) return hold("surface_mapping_divergent", "alchemy-stage-hub-map", stage);
  const ordinal = SURFACE_STAGE_IDS.indexOf(stage) + 1;
  const next = SURFACE_STAGE_IDS[ordinal] ?? null;
  return {
    ok: true,
    value: deepFreeze({
      id: stage,
      ordinal,
      next,
      combo,
      sigil: detail.sigil,
      alchemy: detail.alchemy,
      mode: detail.mode,
      hubNames: detail.primary_hubs.map(({ name }) => name),
      mcpPolicy: {
        required: [...detail.mcp_policy.required],
        allowed: [...detail.mcp_policy.allowed],
      },
      phaseAgent: {
        name: detail.agent.name,
        kosha: detail.agent.kosha,
        maxTurns: detail.agent.maxTurns,
      },
    }),
  };
}

export function resolveSurfaceCommand(
  contract: SurfaceContract,
  commandName: string,
  operatorSelection?: OperatorSelection,
): SurfaceCommandResult {
  const command = contract.railMap.commands[commandName];
  if (!command) return hold("surface_command_unknown", "gsd-rail-map", commandName);
  const combos: string[] = [];
  for (const route of routeRefs(command)) {
    const match = ROUTE_PATTERN.exec(route);
    if (!match) return hold("surface_contract_invalid", "gsd-rail-map", commandName);
    const combo = match[2]
      ? contract.phaseComboMap.algorithm_phases[match[2]]
      : contract.phaseComboMap.task_type_to_combo[match[3]];
    if (!combo) return hold("surface_mapping_missing", "phase-combo-map", route);
    combos.push(combo);
  }
  const stage = command.stage;
  const stageResult = stage === null ? null : resolveSurfaceStage(contract, stage);
  if (stageResult && !stageResult.ok) return stageResult;
  const stageValue = stageResult?.value ?? null;
  const selection = operatorSelection && (operatorSelection.model !== undefined || operatorSelection.profile !== undefined)
    ? deepFreeze({ ...operatorSelection })
    : undefined;
  return {
    ok: true,
    value: deepFreeze({
      command: commandName,
      mode: command.mode,
      view: command.view,
      stage,
      combos,
      approval: command.approval,
      executionPlane: command.execution_plane,
      phaseAgent: stageValue?.phaseAgent ?? null,
      sigil: stageValue?.sigil ?? null,
      alchemy: stageValue?.alchemy ?? null,
      hubNames: stageValue?.hubNames ?? [],
      effort: (contract.railMap.effort_contract.command_overrides[commandName] ??
        contract.railMap.effort_contract.mode_defaults[command.mode]) as EffortTier,
      coordinatorLane: contract.phaseComboMap.coordinator.lane,
      mcpPolicy: stageValue?.mcpPolicy ?? null,
      ...(selection ? { operatorSelection: selection } : {}),
    }),
  };
}
