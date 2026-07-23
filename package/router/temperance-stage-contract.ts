// package/router/temperance-stage-contract.ts
//
// The PAI/Temperance seven-stage contract. This is deliberately a client-side
// seam: it describes which skills, MCP lanes, and knowledge pointers a stage
// may use, but it never executes an MCP tool or routes a model request.

import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const STAGE_IDS = [
  "observe",
  "think",
  "plan",
  "build",
  "execute",
  "verify",
  "learn",
] as const;

export type StageId = (typeof STAGE_IDS)[number];
export type StageStatus = "completed" | "blocked" | "needs-review";
export type CapabilityKind = "skill" | "mcp" | "knowledge";

export interface StageCapabilityProfile {
  id: StageId;
  ordinal: number;
  alchemical: string;
  purpose: string;
  portfolio: string;
  portfolioStatus: "existing" | "proposed";
  skillRefs: readonly string[];
  mcpRefs: readonly string[];
  knowledgeSources: readonly string[];
  next: StageId | null;
}

export interface CapabilityCatalog {
  skills?: readonly string[];
  mcp?: readonly string[];
  knowledge?: readonly string[];
}

export interface CapabilityPacket {
  stage: StageId;
  portfolio: string;
  selected: Record<CapabilityKind, string[]>;
  missing: Record<CapabilityKind, string[]>;
  clientOwnedExecution: true;
  gatewayBoundary: "OmniRoute routes the selected portfolio; it does not execute capabilities";
}

export interface KnowledgePointer {
  id: string;
  kind: "file" | "directory";
  path: string;
  present: boolean;
}

export interface HandoffRouteEvidence {
  portfolio: string;
  provider?: string;
  model?: string;
  planId?: string;
  correlationId?: string;
}

export interface TemperanceHandoff {
  schemaVersion: 1;
  runId: string;
  stage: StageId;
  stageNumber: number;
  status: StageStatus;
  goal: string;
  capabilityPacket: CapabilityPacket;
  isaRef: string;
  memoryRefs: KnowledgePointer[];
  decisions: string[];
  assumptions: string[];
  artifacts: string[];
  verification: string[];
  openQuestions: string[];
  nextStage: StageId | null;
  routeEvidence: HandoffRouteEvidence;
}

export interface HandoffInput {
  runId: string;
  stage: StageId;
  status: StageStatus;
  goal: string;
  capabilityPacket: CapabilityPacket;
  isaRef: string;
  memoryRefs?: KnowledgePointer[];
  decisions?: string[];
  assumptions?: string[];
  artifacts?: string[];
  verification?: string[];
  openQuestions?: string[];
  nextStage?: StageId | null;
  routeEvidence: HandoffRouteEvidence;
}

const KNOWLEDGE_ROOTS = [
  { id: "project-isa", kind: "file" as const, relative: "ISA.md" },
  { id: "project-planning", kind: "directory" as const, relative: ".planning" },
  { id: "pai-knowledge", kind: "directory" as const, relative: ".Codex/PAI/MEMORY/KNOWLEDGE" },
  { id: "pai-work", kind: "directory" as const, relative: ".Codex/PAI/MEMORY/WORK" },
  { id: "pai-learning", kind: "directory" as const, relative: ".claude/MEMORY/LEARNING" },
  { id: "skill-index", kind: "file" as const, relative: ".agents/skill-clusters/skill-index.json" },
] as const;

export const STAGE_CAPABILITIES: readonly StageCapabilityProfile[] = [
  {
    id: "observe",
    ordinal: 1,
    alchemical: "NIGREDO",
    purpose: "Expose current state, intent, constraints, and unknowns.",
    portfolio: "te-reason",
    portfolioStatus: "existing",
    skillRefs: ["ContextSearch", "ISA", "FirstPrinciples"],
    mcpRefs: ["codegraph", "exa-search"],
    knowledgeSources: ["project-isa", "project-planning", "pai-knowledge", "pai-work", "pai-learning", "skill-index"],
    next: "think",
  },
  {
    id: "think",
    ordinal: 2,
    alchemical: "ALBEDO",
    purpose: "Challenge assumptions and generate defensible alternatives.",
    portfolio: "te-reason",
    portfolioStatus: "existing",
    skillRefs: ["SystemsThinking", "Council", "RedTeam", "research-knowledge-core"],
    mcpRefs: ["codegraph", "exa-search", "exa-deep", "posthog"],
    knowledgeSources: ["project-isa", "pai-knowledge", "pai-work", "pai-learning"],
    next: "plan",
  },
  {
    id: "plan",
    ordinal: 3,
    alchemical: "CITRINITAS",
    purpose: "Freeze deliverables, dependencies, acceptance, and route intent.",
    portfolio: "te-plan",
    portfolioStatus: "existing",
    skillRefs: ["writing-plans", "ISA", "ContextSearch"],
    mcpRefs: ["codegraph", "Google Drive"],
    knowledgeSources: ["project-isa", "project-planning", "pai-work", "skill-index"],
    next: "build",
  },
  {
    id: "build",
    ordinal: 4,
    alchemical: "CALCINATIO",
    purpose: "Prepare reversible implementation and verification surfaces.",
    portfolio: "te-build",
    portfolioStatus: "existing",
    skillRefs: ["subagent-driven-development", "test-driven-development", "ISA"],
    mcpRefs: ["codegraph", "GitHub"],
    knowledgeSources: ["project-isa", "project-planning", "pai-work", "skill-index"],
    next: "execute",
  },
  {
    id: "execute",
    ordinal: 5,
    alchemical: "SOLUTIO",
    purpose: "Execute the frozen plan with parallel work and bounded fallbacks.",
    portfolio: "te-dispatch",
    portfolioStatus: "existing",
    skillRefs: ["dispatching-parallel-agents", "temperance-parallel-dispatch", "subagent-driven-development"],
    mcpRefs: ["codegraph", "chrome_devtools", "Vercel", "Supabase"],
    knowledgeSources: ["project-isa", "project-planning", "pai-work", "pai-learning"],
    next: "verify",
  },
  {
    id: "verify",
    ordinal: 6,
    alchemical: "COAGULATIO",
    purpose: "Produce fresh evidence and reject unverified completion claims.",
    portfolio: "te-validate",
    portfolioStatus: "existing",
    skillRefs: ["verification-before-completion", "requesting-code-review", "browser-automation-core", "ISA"],
    mcpRefs: ["codegraph", "chrome_devtools", "Mermaid Chart", "PostHog", "Supabase", "Vercel"],
    knowledgeSources: ["project-isa", "project-planning", "pai-work", "pai-learning"],
    next: "learn",
  },
  {
    id: "learn",
    ordinal: 7,
    alchemical: "RUBEDO",
    purpose: "Persist decisions, verification, and reusable learning for the next run.",
    portfolio: "te-reason",
    portfolioStatus: "existing",
    skillRefs: ["ISA", "finishing-a-development-branch", "receiving-code-review"],
    mcpRefs: [],
    knowledgeSources: ["project-isa", "pai-knowledge", "pai-work", "pai-learning"],
    next: null,
  },
] as const;

function asSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).filter((value) => typeof value === "string"));
}

function findStage(stage: StageId): StageCapabilityProfile {
  const profile = STAGE_CAPABILITIES.find((candidate) => candidate.id === stage);
  if (!profile) throw new Error(`Unknown Temperance stage: ${stage}`);
  return profile;
}

function split(values: readonly string[], available: Set<string>): { selected: string[]; missing: string[] } {
  return values.reduce(
    (result, value) => {
      (available.has(value) ? result.selected : result.missing).push(value);
      return result;
    },
    { selected: [] as string[], missing: [] as string[] },
  );
}

const POINTER_KEYS = new Set(["id", "kind", "path", "present"]);
const PACKET_KEYS = new Set(["stage", "portfolio", "selected", "missing", "clientOwnedExecution", "gatewayBoundary"]);
const LANE_KEYS = new Set(["skill", "mcp", "knowledge"]);
const ROUTE_EVIDENCE_KEYS = new Set(["portfolio", "provider", "model", "planId", "correlationId"]);
const MAX_ARRAY_ITEMS = 128;
const MAX_TEXT_LENGTH = 16_384;
const MAX_REF_LENGTH = 512;
const HANDOFF_KEYS = new Set([
  "schemaVersion",
  "runId",
  "stage",
  "stageNumber",
  "status",
  "goal",
  "capabilityPacket",
  "isaRef",
  "memoryRefs",
  "decisions",
  "assumptions",
  "artifacts",
  "verification",
  "openQuestions",
  "nextStage",
  "routeEvidence",
]);
const FORBIDDEN_BODY_KEYS = /(?:body|content|excerpt|transcript|prompt|tool[_-]?call|credential|secret|authorization|api[_-]?key|password)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWithin(base: string, target: string): boolean {
  const child = relative(base, target);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

/** Lexically and, when present, physically keep a pointer under its trusted base. */
function isSafeLogicalPath(base: string, path: string): boolean {
  if (/\0|\r|\n/.test(path)) return false;
  const resolvedBase = resolve(base);
  const resolvedPath = resolve(path);
  if (!isWithin(resolvedBase, resolvedPath)) return false;
  if (!existsSync(path)) return true;
  try {
    return isWithin(realpathSync(resolvedBase), realpathSync(path));
  } catch {
    return false;
  }
}

function validateStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return [`${label} must be an array`];
  const errors: string[] = [];
  if (value.length > MAX_ARRAY_ITEMS) errors.push(`${label} exceeds the item limit`);
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") errors.push(`${label}[${index}] must be a string`);
    else if (entry.length > MAX_TEXT_LENGTH) errors.push(`${label}[${index}] exceeds the text limit`);
  }
  return errors;
}

function validateLaneMap(value: unknown, label: "selected" | "missing", profile: StageCapabilityProfile): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`capabilityPacket ${label} must be an object`];
  for (const key of Object.keys(value)) {
    if (!LANE_KEYS.has(key)) errors.push(`capabilityPacket ${label} contains unsupported lane: ${key}`);
  }
  const allowed: Record<CapabilityKind, readonly string[]> = {
    skill: profile.skillRefs,
    mcp: profile.mcpRefs,
    knowledge: profile.knowledgeSources,
  };
  for (const kind of ["skill", "mcp", "knowledge"] as const) {
    const entries = value[kind];
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      errors.push(`capabilityPacket ${label}.${kind} must be string[]`);
      continue;
    }
    if (entries.length > MAX_ARRAY_ITEMS) errors.push(`capabilityPacket ${label}.${kind} exceeds the item limit`);
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.length > MAX_REF_LENGTH) errors.push(`capabilityPacket ${label}.${kind} ref exceeds the length limit`);
      if (!allowed[kind].includes(entry)) errors.push(`capabilityPacket ${label}.${kind} contains unsupported ref: ${entry}`);
      if (seen.has(entry)) errors.push(`capabilityPacket ${label}.${kind} contains duplicate ref: ${entry}`);
      seen.add(entry);
    }
  }
  return errors;
}

function validateCapabilityPacket(packet: unknown, stage: StageId): string[] {
  const errors: string[] = [];
  if (!packet || typeof packet !== "object") return ["capabilityPacket is required"];
  const value = packet as Partial<CapabilityPacket> & Record<string, unknown>;
  const profile = STAGE_IDS.includes(stage) ? findStage(stage) : null;
  if (!profile) return ["capabilityPacket cannot be validated for an invalid stage"];
  if (!STAGE_IDS.includes(value.stage as StageId) || value.stage !== stage) errors.push("capabilityPacket stage does not match handoff stage");
  if (typeof value.portfolio !== "string" || value.portfolio.trim() === "") errors.push("capabilityPacket portfolio is required");
  else if (value.portfolio !== profile.portfolio) errors.push("capabilityPacket portfolio does not match stage contract");
  if (value.clientOwnedExecution !== true) errors.push("capabilityPacket must remain client-owned");
  if (value.gatewayBoundary !== "OmniRoute routes the selected portfolio; it does not execute capabilities") {
    errors.push("capabilityPacket gateway boundary is invalid");
  }
  errors.push(...validateLaneMap(value.selected, "selected", profile));
  errors.push(...validateLaneMap(value.missing, "missing", profile));
  if (isRecord(value.selected) && isRecord(value.missing)) {
    for (const kind of ["skill", "mcp", "knowledge"] as const) {
      const selected = Array.isArray(value.selected[kind]) ? value.selected[kind] as string[] : [];
      const missing = Array.isArray(value.missing[kind]) ? value.missing[kind] as string[] : [];
      const selectedSet = new Set(selected);
      if (missing.some((entry) => selectedSet.has(entry))) errors.push(`capabilityPacket selected.${kind} overlaps missing.${kind}`);
      const profileRefs = kind === "skill" ? profile.skillRefs : kind === "mcp" ? profile.mcpRefs : profile.knowledgeSources;
      if (new Set([...selected, ...missing]).size !== profileRefs.length) {
        errors.push(`capabilityPacket ${kind} refs do not cover the stage contract`);
      }
    }
  }
  for (const key of Object.keys(value)) {
    if (!PACKET_KEYS.has(key)) errors.push(`capabilityPacket contains unsupported field: ${key}`);
  }
  if (FORBIDDEN_BODY_KEYS.test(JSON.stringify(packet))) errors.push("capabilityPacket contains forbidden body or tool fields");
  return errors;
}

function validatePointer(pointer: unknown, index: number): string[] {
  if (!pointer || typeof pointer !== "object") return [`memoryRefs[${index}] must be an object`];
  const value = pointer as Partial<KnowledgePointer> & Record<string, unknown>;
  const errors: string[] = [];
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push(`memoryRefs[${index}].id is required`);
  if (value.kind !== "file" && value.kind !== "directory") errors.push(`memoryRefs[${index}].kind is invalid`);
  if (typeof value.path !== "string" || value.path.trim() === "") errors.push(`memoryRefs[${index}].path is required`);
  if (typeof value.present !== "boolean") errors.push(`memoryRefs[${index}].present must be boolean`);
  const root = KNOWLEDGE_ROOTS.find((candidate) => candidate.id === value.id);
  if (!root) errors.push(`memoryRefs[${index}].id is not a known logical root`);
  else if (typeof value.path === "string") {
    const normalizedPath = value.path.replaceAll("\\", "/");
    const suffix = `/${root.relative}`;
    if (!normalizedPath.endsWith(suffix) && normalizedPath !== root.relative) errors.push(`memoryRefs[${index}].path does not match its logical root`);
    if (/\0|\r|\n/.test(value.path)) errors.push(`memoryRefs[${index}].path contains control characters`);
    if (normalizedPath.split("/").includes("..")) errors.push(`memoryRefs[${index}].path contains traversal`);
    if (!isAbsolute(value.path)) errors.push(`memoryRefs[${index}].path must be absolute`);
    if (value.path.length > MAX_TEXT_LENGTH) errors.push(`memoryRefs[${index}].path exceeds the length limit`);
  }
  for (const key of Object.keys(value)) {
    if (!POINTER_KEYS.has(key)) errors.push(`memoryRefs[${index}] contains unsupported field: ${key}`);
  }
  if (FORBIDDEN_BODY_KEYS.test(JSON.stringify(pointer))) errors.push(`memoryRefs[${index}] contains forbidden body or tool fields`);
  return errors;
}

function validateRouteEvidence(evidence: unknown, portfolio: string): string[] {
  if (!isRecord(evidence)) return ["routeEvidence is required"];
  const errors: string[] = [];
  for (const key of Object.keys(evidence)) {
    if (!ROUTE_EVIDENCE_KEYS.has(key)) errors.push(`routeEvidence contains unsupported field: ${key}`);
  }
  if (typeof evidence.portfolio !== "string" || evidence.portfolio.trim() === "") errors.push("routeEvidence portfolio is required");
  else if (evidence.portfolio !== portfolio) errors.push("routeEvidence portfolio does not match capability packet");
  for (const key of ["provider", "model", "planId", "correlationId"]) {
    if (evidence[key] !== undefined && typeof evidence[key] !== "string") errors.push(`routeEvidence ${key} must be a string`);
    if (typeof evidence[key] === "string" && evidence[key].length > MAX_REF_LENGTH) errors.push(`routeEvidence ${key} exceeds the length limit`);
  }
  if (FORBIDDEN_BODY_KEYS.test(JSON.stringify(evidence))) errors.push("routeEvidence contains forbidden body or tool fields");
  return errors;
}

export function resolveStageCapabilities(stage: StageId, catalog: CapabilityCatalog = {}): CapabilityPacket {
  const profile = findStage(stage);
  const skills = split(profile.skillRefs, asSet(catalog.skills));
  const mcp = split(profile.mcpRefs, asSet(catalog.mcp));
  const knowledge = split(profile.knowledgeSources, asSet(catalog.knowledge));
  return {
    stage,
    portfolio: profile.portfolio,
    selected: { skill: skills.selected, mcp: mcp.selected, knowledge: knowledge.selected },
    missing: { skill: skills.missing, mcp: mcp.missing, knowledge: knowledge.missing },
    clientOwnedExecution: true,
    gatewayBoundary: "OmniRoute routes the selected portfolio; it does not execute capabilities",
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Return pointers only. This function never reads a knowledge file body. */
export function resolveKnowledgePointers(cwd: string, home: string = process.env.HOME ?? ""): KnowledgePointer[] {
  const roots = KNOWLEDGE_ROOTS.map((root) => {
    const base = root.id.startsWith("project-") ? cwd : home;
    const path = join(base, root.relative);
    const safe = isSafeLogicalPath(base, path);
    const present = safe && (root.kind === "file" ? isFile(path) : isDirectory(path));
    return { id: root.id, kind: root.kind, path, present, safe };
  });
  return roots.filter((root) => root.safe && (root.present || existsSync(root.path))).map(({ safe: _safe, ...root }) => root);
}

export function createHandoff(input: HandoffInput): TemperanceHandoff {
  const profile = findStage(input.stage);
  const nextStage = input.nextStage === undefined ? profile.next : input.nextStage;
  const handoff: TemperanceHandoff = {
    schemaVersion: 1,
    runId: input.runId,
    stage: input.stage,
    stageNumber: profile.ordinal,
    status: input.status,
    goal: input.goal,
    capabilityPacket: input.capabilityPacket,
    isaRef: input.isaRef,
    memoryRefs: input.memoryRefs ?? [],
    decisions: input.decisions ?? [],
    assumptions: input.assumptions ?? [],
    artifacts: input.artifacts ?? [],
    verification: input.verification ?? [],
    openQuestions: input.openQuestions ?? [],
    nextStage,
    routeEvidence: input.routeEvidence,
  };
  const result = validateHandoff(handoff);
  if (!result.valid) throw new Error(`Invalid Temperance handoff: ${result.errors.join("; ")}`);
  return handoff;
}

export function validateHandoff(handoff: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!handoff || typeof handoff !== "object") return { valid: false, errors: ["handoff must be an object"] };
  const value = handoff as Partial<TemperanceHandoff> & Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!HANDOFF_KEYS.has(key)) errors.push(`handoff contains unsupported field: ${key}`);
  }
  const profile = STAGE_IDS.includes(value.stage as StageId) ? findStage(value.stage as StageId) : null;
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof value.runId !== "string" || value.runId.trim() === "") errors.push("runId is required");
  else if (value.runId.length > MAX_REF_LENGTH) errors.push("runId exceeds the length limit");
  if (!profile) errors.push("stage is invalid");
  if (profile && value.stageNumber !== profile.ordinal) errors.push("stageNumber does not match stage");
  if (!(["completed", "blocked", "needs-review"] as string[]).includes(value.status ?? "")) errors.push("status is invalid");
  if (typeof value.goal !== "string" || value.goal.trim() === "") errors.push("goal is required");
  else if (value.goal.length > MAX_TEXT_LENGTH) errors.push("goal exceeds the text limit");
  if (typeof value.isaRef !== "string" || value.isaRef.trim() === "") errors.push("isaRef is required");
  else if (value.isaRef.length > MAX_TEXT_LENGTH) errors.push("isaRef exceeds the text limit");
  if (!Array.isArray(value.memoryRefs)) errors.push("memoryRefs must be an array");
  else {
    if (value.memoryRefs.length > MAX_ARRAY_ITEMS) errors.push("memoryRefs exceeds the item limit");
    value.memoryRefs.forEach((pointer, index) => errors.push(...validatePointer(pointer, index)));
  }
  for (const field of ["decisions", "assumptions", "artifacts", "verification", "openQuestions"]) {
    errors.push(...validateStringArray(value[field], field));
  }
  errors.push(...validateCapabilityPacket(value.capabilityPacket, value.stage as StageId));
  const packetPortfolio = isRecord(value.capabilityPacket) && typeof value.capabilityPacket.portfolio === "string"
    ? value.capabilityPacket.portfolio
    : "";
  errors.push(...validateRouteEvidence(value.routeEvidence, packetPortfolio));
  if (profile && value.nextStage !== profile.next) errors.push("nextStage does not match the stage contract");
  const serialized = JSON.stringify(handoff).toLowerCase();
  if (/(api[_-]?key|authorization|secret|password|raw[_-]?transcript|raw[_-]?prompt)/.test(serialized)) {
    errors.push("handoff contains forbidden secret or raw-transcript fields");
  }
  return { valid: errors.length === 0, errors };
}

function printUsage(): never {
  console.error("usage: temperance-stage-contract.ts resolve STAGE [catalog-json] | pointers CWD HOME");
  process.exit(2);
}

if (import.meta.main) {
  const [command, argument, catalogJson] = Bun.argv.slice(2);
  if (command === "resolve" && STAGE_IDS.includes(argument as StageId)) {
    const catalog = catalogJson ? (JSON.parse(catalogJson) as CapabilityCatalog) : {};
    process.stdout.write(`${JSON.stringify(resolveStageCapabilities(argument as StageId, catalog))}\n`);
  } else if (command === "pointers" && argument) {
    process.stdout.write(`${JSON.stringify(resolveKnowledgePointers(argument, catalogJson))}\n`);
  } else {
    printUsage();
  }
}
