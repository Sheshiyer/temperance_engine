#!/usr/bin/env node
/**
 * Install thin /gsd:* wrappers for Codex, OpenCode, and Grok.
 * Does not fork get-shit-done — each wrapper reads the upstream workflow.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSurfaceContract,
  resolveSurfaceCommand,
  resolveSurfaceStage,
  SURFACE_STAGE_IDS,
} from "./surface-convergence-contract.ts";
import {
  coordinatorSurfaceRole,
  SUPPORTED_COORDINATOR_SURFACES,
} from "./phase-capability-contract.ts";

const PHASE19_BACKUP_TAG = "phase19";
const BACKUP_HELPER_STATUS = /^(?:created|skipped unchanged|dry-run would create)$/;

const SPECIAL_COMMANDS = new Set(["goal", "loop", "doctor", "research-phase", "workstreams"]);
const DESTINATION_LABELS = new Set(["codex", "opencode", "grok", "claude", "temperance"]);

const CODEX_INLINE_HITL_ADAPTER = `Multi-select workaround:
- Codex has no \`multiSelect\`. Use sequential single-select cards when \`request_user_input\` exists.
- In Codex App inline HITL, ask one plain conversational question per assistant turn and ask the user to name multiple selections in prose. Do not print a numbered menu unless \`--text\` or \`workflow.text_mode: true\` explicitly enables TEXT_MODE.

Missing picker fallback:
- When \`request_user_input\` is rejected or unavailable in Codex App, enter **Codex App inline HITL**: ask one plain conversational question per assistant turn, stop, and wait for the user's next message.
- Do not fabricate a picker, print numbered options, silently enable TEXT_MODE, or select a default. After each answer, checkpoint the answered gate when the workflow defines a checkpoint; do not create final workflow artifacts until all required decisions are answered.
- You may only proceed without a user answer when one of these is true:
  (a) the invocation included an explicit non-interactive flag (\`--auto\` or \`--all\`),
  (b) the user has explicitly approved a specific default for this question, or
  (c) the workflow's documented contract says defaults are safe (e.g. autonomous lifecycle paths).
- Record the named basis for that decision only. A lock batch or other batch approval covers only explicitly listed, safe discussion defaults and never grants approval, dispatch, provider, spend, or worker authority. Do not treat a bare approval string or a prior user reply as a future default.
- On resume, revalidate the current phase, command, and canonical source against the preserved checkpoint before continuing. A mismatch blocks or restarts the gate; do not replay a stale answer.
- Plain-text numbered lists remain available only when the user passed \`--text\` or \`workflow.text_mode: true\`. This explicit TEXT_MODE path is separate from Codex App inline HITL.
`;

function railLine(resolution) {
  const route = resolution.combos.length ? resolution.combos.join(" → ") : "none";
  return `GSD /${resolution.command} · mode ${resolution.mode} · canonical route ${route} · manifest ${resolution.view} · alchemy ${resolution.alchemy || "—"}`;
}

function resolvedContractBlock(resolution) {
  const route = resolution.combos.length ? resolution.combos.join(" → ") : "none";
  const override = resolution.operatorSelection
    ? `\nOperator override (preserved; canonical route remains authoritative):${
      resolution.operatorSelection.model === undefined
        ? ""
        : `\n- model: \`${singleLine(resolution.operatorSelection.model)}\``
    }${
      resolution.operatorSelection.profile === undefined
        ? ""
        : `\n- profile: \`${singleLine(resolution.operatorSelection.profile)}\``
    }\n`
    : "";
  return `${railLine(resolution)}

Canonical route: **${route}**
Coordinator lane: **${resolution.coordinatorLane}**
Effort: **${resolution.effort}**
Execution plane: **${resolution.executionPlane}**
Approval: **${resolution.approval}**
${resolution.phaseAgent ? `Phase agent: **${resolution.phaseAgent.name}** · kosha **${resolution.phaseAgent.kosha}** · maxTurns **${resolution.phaseAgent.maxTurns}**\n` : ""}${resolution.mcpPolicy ? `Required MCP capabilities: **${resolution.mcpPolicy.required.join(", ") || "none"}**\n` : ""}${override}`;
}

export function renderSurfaceAdapterContract(contract, surface) {
  if (!SUPPORTED_COORDINATOR_SURFACES.includes(surface)) {
    throw new Error(`unsupported surface: ${String(surface)}`);
  }
  const phases = SURFACE_STAGE_IDS.map((stage) => {
    const resolved = resolveSurfaceStage(contract, stage);
    if (!resolved.ok) throw new Error(`${resolved.reasonCode}:${resolved.key}`);
    return {
      phase: resolved.value.id,
      ordinal: resolved.value.ordinal,
      workerLane: resolved.value.combo,
      agent: resolved.value.phaseAgent,
      clusterHubs: resolved.value.hubNames,
      mcpPolicy: resolved.value.mcpPolicy,
    };
  });
  return `${JSON.stringify({
    schema: "temperance.surface-adapter-contract.v1",
    surface,
    surfaceRole: coordinatorSurfaceRole(surface),
    coordinatorLane: contract.phaseComboMap.coordinator.lane,
    supervisor: "http://127.0.0.1:8768",
    admissionRequired: true,
    exactSeatLeaseRequired: true,
    phases,
  }, null, 2)}\n`;
}

function singleLine(value) {
  return String(value).replace(/[\r\n`]/g, " ").trim();
}

function fleetStopSentence() {
  return "STOP. Do not spawn `temperance-batch`, `temperance-hands open`, or a competing Codex fleet.";
}

function cockpitProhibition() {
  return `Execution plane is **codex-cockpit**. Do not start Hands or a competing Codex fleet. ${fleetStopSentence()}`;
}

export function omniCatalogParentRule() {
  return `## OmniRoute Agent Skills (OmniCatalog)

Spawn the OmniCatalog custom agent to understand OmniRoute Agent Skills.
Do not grep the catalog, do not curl \`/api/agent-skills\`, and do not open IAB to read.
Catalog updates are HUMAN-only via \`http://localhost:20128/dashboard/agent-skills\`.
Never \`POST /api/agent-skills/generate\`.

Claude spawn: Task(subagent_type=OmniCatalog, prompt="...")
Codex spawn: custom agent OmniCatalog at ~/.codex/agents/OmniCatalog.toml
Grok spawn: user agent ~/.grok/agents/OmniCatalog.md (mkdir if absent)
`;
}

function handsVersusCockpitBlock(resolution) {
  const combo = resolution.combos.at(-1);
  return `
## Execution plane (Hands versus cockpit)

Execution plane is **claude-superset-hands**. Heavy multi-file work stays Superset plus Claude Code.

If the current surface is Claude Code or a Superset Claude terminal, for [P] / parallel waves:
1. If \`~/.temperance_engine/state/fleet-locks/<cwd-hash>.json\` is active (<2h), do **not** spawn a second gsd-executor swarm on those \`[P]\` ids.
2. Run \`temperance-next-wave --cwd . --write-tasks\` to emit the approved task file, frozen \`.planning/swarm-claim.json\`, and fleet lock for combo \`${combo}\`.
3. Run \`temperance-swarm-dispatch --request .planning/swarm-claim.json --dry-run\`; only a separately authorized non-dry invocation may claim and start the \`${combo}\` fleet.
4. Keep GSD \`gsd-executor\` for sequential non-[P] plans only

If the current surface is Codex, Grok, or OpenCode: ${fleetStopSentence()} Heavy work stays Superset plus Claude Code.
`;
}

export function renderGsdWrapper(resolution, options = {}) {
  const name = resolution.command;
  const contractBlock = resolvedContractBlock(resolution);
  if (name === "goal") {
    return `---
description: GSD /goal — session completion loop · mode ALGORITHM · manifest PLANNING
argument-hint: "[completion condition]"
---

# /gsd:goal

${contractBlock}

This is a **Temperance loop**, not a GSD fork and not a second planner.

0. First visible card after NOESIS: run and print \`~/.temperance_engine/router/rail-format.sh gsd-init goal\`. Mapping: \`~/.temperance_engine/docs/GSD-LOOP-MAPPING.md\`. Design flow: \`~/.temperance_engine/docs/GSD-PAI-DESIGN-FLOW.md\`.
1. Mode is already **ALGORITHM** for this command. Do not present a picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply.
   On Grok, do not call \`ask_user_question\` for mode. Print Manifest URL (Grok has no ChatGPT IAB):
   \`https://speculum.localhost:1355/?mode=ALGORITHM&view=PLANNING&gsd=goal\`
   Codex/Claude IAB fallback: \`http://127.0.0.1:5173/?mode=ALGORITHM&view=PLANNING&gsd=goal\`
   On Codex/Claude, open ChatGPT IAB only to that URL.
2. Run: \`node ~/.temperance_engine/router/temperance-goal.mjs --cwd . --ensure\` (or \`--set "$ARGUMENTS"\`).
3. Done-text comes from ISA \`## Goal\` when \`active_planner=isa\`, else GSD STATE. Do not invent a third goal.
4. On Claude Code, also set native \`/goal\` to that same text so the overlay/evaluator run.
5. Next command is printed (\`/gsd:plan-phase\`, \`/gsd:execute-phase\`, or \`/gsd:complete-milestone\`).
6. Execute still needs next-wave **approval** and the canonical Execute route. Do not spawn a second GSD fleet.
7. Loop: \`temperance-goal --cwd . --eval\`. Fail → continue the same \`/gsd:*\`. Pass → stop.
8. For interval re-eval on Claude Code, use native \`/loop\` with a prompt that re-runs \`/gsd:goal --eval\` (or \`/gsd:loop\`). Never nest discuss under plan.

${cockpitProhibition()}

${omniCatalogParentRule()}
Load using-superpowers. Swarm-scale plans use writing-plans or /gsd:plan-phase (swarm-architect if installed — plan only).
`;
  }
  if (name === "loop") {
    return `---
description: GSD /loop — top-level discuss→plan→eval chain · mode ALGORITHM · manifest PLANNING
argument-hint: "[phase N] [ultracode]"
---

# /gsd:loop

${contractBlock}

Temperance **session chain**, not a GSD workflow fork. Mapping: \`~/.temperance_engine/docs/GSD-LOOP-MAPPING.md\`.

0. Print \`~/.temperance_engine/router/rail-format.sh gsd-init loop\`.
1. Mode is already **ALGORITHM**. No mode picker.
2. Parse \`$ARGUMENTS\` for a phase number \`N\` and optional keyword \`ultracode\`.
3. **Nesting law (#1009):** never run \`/gsd:discuss-phase\` as a nested Skill/Task under plan-phase. AskUserQuestion breaks in nested subcontexts.
4. If \`.planning/phases/*N*/CONTEXT.md\` (or phase CONTEXT) is missing:
   - Without \`ultracode\`: print \`/gsd:discuss-phase N\` and **stop** (top-level handoff).
   - With \`ultracode\`: run \`~/.temperance_engine/bin/temperance-ultracode-spawn.sh discuss-phase N --cwd .\`, wait for CONTEXT.md, then continue.
5. When CONTEXT exists: print next as \`/gsd:plan-phase N\` (or run it only as a **top-level** continuation — never nest HITL).
6. After plans land: \`temperance-goal --cwd . --eval\`. On Claude Code, native \`/loop\` may interval-reinvoke this wrapper.
7. Execute still needs explicit approval plus the canonical Execute route. Discuss/loop does not grant capture/runtime authority.

${cockpitProhibition()}

${omniCatalogParentRule()}
Load using-superpowers. Do not fork upstream GSD workflows.
`;
  }
  if (name === "doctor") {
    return `---
description: GSD /doctor — host + project truth probe · mode NATIVE · manifest OVERVIEW
argument-hint: "[--json]"
---

# /gsd:doctor

${contractBlock}

This is a **Temperance probe**, not a GSD workflow fork. Do not invent a second GSD.

1. Mode is already **NATIVE** for this command. Do not present a picker. Do not write the three modes as a chat reply.
2. Grok: print \`https://speculum.localhost:1355/?mode=NATIVE&view=OVERVIEW&gsd=doctor\`. Codex/Claude IAB: \`http://127.0.0.1:5173/?mode=NATIVE&view=OVERVIEW&gsd=doctor\`.
3. Run: \`node ~/.temperance_engine/router/temperance-surface-doctor.mjs $ARGUMENTS\` (JSON with \`--json\`). Also \`temperance-project-init --cwd . --check\` for the repo rail.
4. Report Athanor (athanor.localhost / :31337), Mercurius (:20128), Speculum (speculum.localhost), Vas (:8766), OpenCode plugin-eval, Codex PromptProcessing, Grok ask_user_question, skill-index. Do not apply reconcile. Do not rotate secrets.

${cockpitProhibition()}

${omniCatalogParentRule()}
Load using-superpowers, then print the doctor output and the next \`/gsd:*\` from STATE (if Complete: \`/gsd:complete-milestone\`).
`;
  }
  if (name === "research-phase") {
    let body = `---
description: GSD /research-phase — ${railLine(resolution)}
argument-hint: "[phase N]"
---

# /gsd:research-phase

${contractBlock}

This is a **wrapper**. Do not invent a second GSD.

GSD 1.42.3 deleted the standalone \`/gsd-research-phase\` workflow. Upstream \`workflows/research-phase.md\` does not exist and must not be vendored.

Run \`/gsd:plan-phase --research-phase\` and follow:

\`~/.claude/get-shit-done/workflows/plan-phase.md\`

0. Print \`~/.temperance_engine/router/rail-format.sh gsd-init research-phase\`.
1. Mode is already **${resolution.mode}**. Do not present a picker.
2. Do not read a fake \`research-phase.md\`. Research is a plan-phase flag, not a second GSD.

${cockpitProhibition()}

${omniCatalogParentRule()}
Load using-superpowers, then continue as \`/gsd:plan-phase --research-phase\`.
`;
    if (resolution.approval !== "none") body += `\n${hitlSection()}\n`;
    return body;
  }
  if (name === "workstreams") {
    let body = `---
description: GSD /workstreams — ${railLine(resolution)}
argument-hint: "[--ws <name>]"
---

# /gsd:workstreams

${contractBlock}

This is a **wrapper**. Do not invent a second GSD.

Upstream \`workflows/workstreams.md\` is absent from GSD 1.42.3. Do not vendor a fake workstreams workflow.

Workstream scoping lives at:

\`~/.claude/get-shit-done/references/workstream-flag.md\`

Related settings workflows:

\`~/.claude/get-shit-done/workflows/settings.md\`
\`~/.claude/get-shit-done/workflows/settings-advanced.md\`

0. Print \`~/.temperance_engine/router/rail-format.sh gsd-init workstreams\`.
1. Mode is already **${resolution.mode}**. Do not present a picker.
2. Use \`--ws <name>\` / \`GSD_WORKSTREAM\` as documented in \`workstream-flag.md\`.

${cockpitProhibition()}

${omniCatalogParentRule()}
Load using-superpowers.
`;
    if (resolution.approval !== "none") body += `\n${hitlSection()}\n`;
    return body;
  }
  const workflow = options.workflowPath ?? `~/.claude/get-shit-done/workflows/${name}.md`;
  const execute = resolution.executionPlane === "claude-superset-hands"
    ? handsVersusCockpitBlock(resolution)
    : `
${cockpitProhibition()}
`;
  const nesting =
    name === "plan-phase"
      ? `
## CONTEXT preflight (nesting law #1009 — required)

Before research/planner agents:

1. Resolve phase \`N\` from \`$ARGUMENTS\`.
2. If the phase \`CONTEXT.md\` is missing or empty:
   - If \`$ARGUMENTS\` contains \`ultracode\` (case-insensitive): run \`~/.temperance_engine/bin/temperance-ultracode-spawn.sh discuss-phase N --cwd .\`, wait for CONTEXT.md, then continue this plan-phase **only after** CONTEXT exists.
   - Else: print exactly \`/gsd:discuss-phase N\` and **exit**. Do **not** invoke discuss-phase as a nested Skill/Task/Agent — AskUserQuestion breaks in nested subcontexts.
3. Mapping: \`~/.temperance_engine/docs/GSD-LOOP-MAPPING.md\`. HITL: \`GSD-HITL-PICKER.md\`.
4. Discuss/plan never authorizes execute/capture runtime — that needs a later explicit grant.
`
      : "";
  let body = `---
description: GSD /${name} — ${railLine(resolution)}
argument-hint: "[args]"
---

# /gsd:${name}

${contractBlock}

This is a **wrapper**. Do not invent a second GSD. Read and follow:

\`${workflow}\`

Override file (voids vendor "AskUserQuestion is not available"): \`~/.temperance_engine/docs/GSD-TEXT-MODE-OVERRIDE.md\`

Arguments: \`$ARGUMENTS\`

## Temperance rail (required)

1. Mode is already **${resolution.mode}** from the validated surface contract. Do not present a picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply.
2. After that, open ChatGPT **in-app** browser (Codex/Claude) or print the URL (Grok) to:
   \`https://speculum.localhost:1355/?mode=${resolution.mode}&view=${encodeURIComponent(resolution.view)}&gsd=${name}\`
   Codex/Claude IAB: \`http://127.0.0.1:5173/?mode=${resolution.mode}&view=${encodeURIComponent(resolution.view)}&gsd=${name}\`
   Never use Chrome/Safari/external-browser for this.
3. First visible card after NOESIS: run and print \`~/.temperance_engine/router/rail-format.sh gsd-init ${name}\` (ui-brand, no emoji). That is the live combo/model map. Wave and stage banners use \`rail-format.sh gsd-wave ${name} …\` (same live seats — do not hand-draw models).
4. Use the canonical route **${resolution.combos.length ? resolution.combos.join(" → ") : "none"}**${resolution.combos.length > 1 ? " as an ordered sequence (each name is a different provider-homed head — do not collapse onto one failover stack)" : ""}. Execution plane is **${resolution.executionPlane}**. Spawn only registered \`gsd-*\` agents from the workflow.
5. GitHub is the human board (Liber). Speculum is glass: \`https://speculum.localhost:1355/?view=PLANNING\` (IAB: \`:5173\`). It does not edit Liber. After ROADMAP commit on \`new-project\` / \`plan-phase\`, if enrolled run \`temperance-gh-plan --cwd . --sync\`. After \`complete-milestone\`, run \`temperance-gh-plan --cwd . --status\`.
6. End by reading \`.planning/STATE.md\` and stating the next \`/gsd:*\` command.
${nesting}${execute}
${omniCatalogParentRule()}
Load using-superpowers, then execute the upstream GSD workflow exactly.
Do not treat "execute exactly" as permission to use TEXT_MODE numbered lists.
`;
  if (resolution.approval !== "none") {
    body += `\n${hitlSection()}\n`;
  }
  return body;
}

function hitlSection() {
  return `## HITL picker (required — last block wins)

This section is last on purpose. Gray-area and gate questions use native cards when available, or Codex App inline HITL when a card is unavailable.
HITL seat ≠ execute seat. Discuss/plan gates stay on the current top-level surface. Codex App handles them inline before CONTEXT.md exists. Speculum (\`speculum.localhost\`) is glass only.

Grok: \`ask_user_question\`. Claude Code: \`AskUserQuestion\`. OpenCode: \`question\`.
Codex CLI: \`AskUserQuestion\` **only if that tool is on this turn's tool list**.
Codex App (ChatGPT desktop): often has **no** \`AskUserQuestion\` — do not invent it.

Finish NOESIS/rail first with no option list in the bubble, then call the picker tool if it exists.
Never print \`Reply 1, 2, or 3\` unless \`--text\` / \`workflow.text_mode\`.
If the upstream workflow or any lazy-loaded mode file (including \`modes/text.md\`) says AskUserQuestion is unavailable, that sentence is **void** for numbered lists — it does not mint a Codex App card. Follow \`~/.temperance_engine/docs/GSD-TEXT-MODE-OVERRIDE.md\` and \`GSD-HITL-PICKER.md\`.
Do not Read \`modes/text.md\` unless \`--text\` or \`workflow.text_mode: true\`.

### Missing picker on this turn

If this turn's tool list has none of \`AskUserQuestion\`, \`ask_user_question\`, \`question\`:
- Do not invent the tool. Do not print \`Reply 1, 2, or 3\`. Do not silently enable TEXT_MODE.
- In Codex App, enter **Codex App inline HITL**: ask one plain conversational question per assistant turn, then stop and wait for the user's next message.
- Preserve any existing checkpoint. After the user answers, checkpoint after each answered gate when the workflow defines one; do not choose a default or write final CONTEXT/PLAN artifacts early.
- You may only proceed without a user answer when one of these is true:
  (a) the invocation included an explicit non-interactive flag (\`--auto\` or \`--all\`),
  (b) the user has explicitly approved a specific default for this question, or
  (c) the workflow's documented contract says defaults are safe (e.g. autonomous lifecycle paths).
- Record the named basis for that decision only. A lock batch or other batch approval covers only explicitly listed, safe discussion defaults and never grants approval, dispatch, provider, spend, or worker authority. Do not treat a bare approval string or a prior user reply as a future default.
- On resume, revalidate the current phase, command, and canonical source against the preserved checkpoint before continuing. A mismatch blocks or restarts the gate; do not replay a stale answer.
- Continue the same top-level \`/gsd:*\` flow in Codex App until its required decisions are complete. Native picker tools remain preferred when present.
- Print Speculum as glass: \`https://speculum.localhost:1355/?mode=ALGORITHM&view=PLANNING&gsd=discuss-phase\`
- Codex IAB fallback: \`http://127.0.0.1:5173/?mode=ALGORITHM&view=PLANNING&gsd=discuss-phase\``;
}

function patchCodexSkillAdapters(codexSkillsRoot) {
  if (!codexSkillsRoot || !existsSync(codexSkillsRoot)) return 0;
  let patched = 0;
  for (const entry of readdirSync(codexSkillsRoot)) {
    if (!entry.startsWith("gsd-")) continue;
    const skill = join(codexSkillsRoot, entry, "SKILL.md");
    if (!existsSync(skill)) continue;
    const body = readFileSync(skill, "utf8");
    if (!body.includes("<codex_skill_adapter>")) continue;
    const start = body.indexOf("Multi-select workaround:");
    const end = body.indexOf("\n## C. Task()", start);
    if (start < 0 || end < 0) continue;
    const next = body.slice(0, start) + CODEX_INLINE_HITL_ADAPTER + body.slice(end);
    if (next === body) continue;
    writeFileSync(skill, next);
    patched++;
  }
  return patched;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function sourceResolution(resolution) {
  const { operatorSelection: _operatorSelection, ...canonical } = resolution;
  return canonical;
}

function failBackup(command) {
  return { ok: false, reasonCode: "surface_backup_failed", command };
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function defaultBackupHelper() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "te-backup-if-changed");
}

function preflightDestinationRoot(dest) {
  let cursor = dest;
  while (true) {
    const st = lstatOrNull(cursor);
    if (st) return !st.isSymbolicLink() && st.isDirectory();
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function parseBackupHelperPath(stdout) {
  const line = String(stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";
  const match = /^te-backup-if-changed: ([^:]+): (.+)$/.exec(line);
  if (!match || !BACKUP_HELPER_STATUS.test(match[1])) return null;
  return match[2];
}

function backupRegularFile(source, backupHelper) {
  const result = spawnSync(backupHelper, [source, "--tag", PHASE19_BACKUP_TAG, "--apply"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const backupPath = parseBackupHelperPath(result.stdout);
  if (!backupPath) return null;
  const st = lstatOrNull(backupPath);
  if (!st || st.isSymbolicLink() || !st.isFile()) return null;
  return backupPath;
}

function restoreTouched(touched) {
  for (const item of touched) {
    try {
      if (item.existedBefore) {
        if (item.backupPath) copyFileSync(item.backupPath, item.path);
      } else if (lstatOrNull(item.path)) {
        rmSync(item.path);
      }
    } catch {
      // Continue remaining targets so a single restore error cannot leave a mixed family.
    }
  }
}

export function installGsdWrappers(options) {
  const loaded = loadSurfaceContract(options.contractPaths);
  if (!loaded.ok) {
    return { ok: false, reasonCode: loaded.reasonCode, command: loaded.key };
  }

  const destinationEntries = Object.entries(options.destinations ?? {})
    .filter(([label, path]) => DESTINATION_LABELS.has(label) && typeof path === "string" && path.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (destinationEntries.length === 0) {
    return { ok: false, reasonCode: "surface_contract_invalid", command: "destinations" };
  }

  const names = Object.keys(loaded.contract.railMap.commands);
  const resolved = [];
  const rendered = [];

  // Complete the entire fallible source/workflow/render pass before mkdir or write.
  for (const name of names) {
    const command = resolveSurfaceCommand(
      loaded.contract,
      name,
      options.operatorSelections?.[name],
    );
    if (!command.ok) {
      return { ok: false, reasonCode: command.reasonCode, command: command.key };
    }
    const workflowPath = join(options.workflowRoot, `${name}.md`);
    if (!SPECIAL_COMMANDS.has(name) && !existsSync(workflowPath)) {
      return { ok: false, reasonCode: "surface_workflow_missing", command: name };
    }
    resolved.push(command.value);
    rendered.push({
      command: name,
      body: renderGsdWrapper(command.value, { workflowPath }),
    });
  }

  const receipt = Object.freeze({
    schema: "temperance.gsd-command-install.v2",
    sourceFingerprint: fingerprint({
      schema: loaded.contract.railMap.schema,
      commands: resolved.map(sourceResolution),
    }),
    generatedFingerprint: fingerprint(rendered),
    commandCount: rendered.length,
    destinationLabels: destinationEntries.map(([label]) => label),
    surfaceContractLabels: [...SUPPORTED_COORDINATOR_SURFACES],
    surfaceContractFingerprint: fingerprint(
      SUPPORTED_COORDINATOR_SURFACES.map((surface) => renderSurfaceAdapterContract(loaded.contract, surface)),
    ),
    patchedAdapterCount: 0,
  });

  if (options.apply !== true) {
    return { ok: true, receipt };
  }

  for (const [label, destination] of destinationEntries) {
    if (!preflightDestinationRoot(destination)) return failBackup(label);
  }
  const surfaceContractRoot = options.surfaceContractRoot;
  if (typeof surfaceContractRoot === "string" && surfaceContractRoot.length > 0 &&
    !preflightDestinationRoot(surfaceContractRoot)) return failBackup("surface-contracts");

  const planned = [];
  for (const { command, body } of rendered) {
    for (const [label, destination] of destinationEntries) {
      planned.push({ path: join(destination, `gsd-${command}.md`), command, label, body });
      if (label === "claude" && command === "goal") {
        planned.push({ path: join(destination, "goal.md"), command, label, body });
      }
    }
  }
  if (typeof surfaceContractRoot === "string" && surfaceContractRoot.length > 0) {
    for (const surface of SUPPORTED_COORDINATOR_SURFACES) {
      planned.push({
        path: join(surfaceContractRoot, `${surface}.json`),
        command: `surface:${surface}`,
        label: surface,
        body: renderSurfaceAdapterContract(loaded.contract, surface),
      });
    }
  }

  const touched = [];
  for (const item of planned) {
    const st = lstatOrNull(item.path);
    if (!st) {
      touched.push({ ...item, existedBefore: false, backupPath: null });
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) return failBackup(item.command);
    touched.push({ ...item, existedBefore: true, backupPath: null });
  }

  const backupHelper = options.backupHelper ?? defaultBackupHelper();
  for (const item of touched) {
    if (!item.existedBefore) continue;
    const backupPath = backupRegularFile(item.path, backupHelper);
    if (!backupPath) return failBackup(item.command);
    item.backupPath = backupPath;
  }

  const write = typeof options.writeFile === "function"
    ? options.writeFile
    : (path, body) => writeFileSync(path, body);
  let activeCommand = touched[0]?.command ?? "destinations";
  try {
    for (const [, destination] of destinationEntries) mkdirSync(destination, { recursive: true });
    if (typeof surfaceContractRoot === "string" && surfaceContractRoot.length > 0) {
      mkdirSync(surfaceContractRoot, { recursive: true });
    }
    for (const item of touched) {
      activeCommand = item.command;
      write(item.path, item.body);
      if (readFileSync(item.path, "utf8") !== item.body) {
        throw new Error("read-back mismatch");
      }
    }
    if (typeof options.receiptPath === "string" && options.receiptPath.length > 0) {
      mkdirSync(dirname(options.receiptPath), { recursive: true });
      writeFileSync(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
  } catch {
    restoreTouched(touched);
    if (typeof options.receiptPath === "string" && lstatOrNull(options.receiptPath)) {
      try { rmSync(options.receiptPath); } catch { /* ignore leftover receipt cleanup */ }
    }
    return failBackup(activeCommand);
  }

  return { ok: true, receipt };
}

function uninstall(destinations) {
  let n = 0;
  for (const dest of Object.values(destinations)) {
    if (!existsSync(dest)) continue;
    for (const file of readdirSync(dest)) {
      if (!file.startsWith("gsd-") || !file.endsWith(".md")) continue;
      rmSync(join(dest, file));
      n++;
    }
  }
  console.log("removed", n, "wrappers");
}

function cliDefaults() {
  const here = dirname(fileURLToPath(import.meta.url));
  const home = process.env.HOME || homedir();
  const map = JSON.parse(readFileSync(join(here, "gsd-rail-map.json"), "utf8"));
  const gsdHome = String(map.gsd_home || "~/.claude/get-shit-done").replace(/^~/, home);
  return {
    options: {
      workflowRoot: join(gsdHome, map.workflow_dir || "workflows"),
      destinations: {
        codex: join(home, ".codex", "prompts"),
        opencode: join(home, ".config", "opencode", "command"),
        grok: join(home, ".grok", "commands"),
        claude: join(home, ".claude", "commands"),
        temperance: join(home, ".temperance_engine", "commands", "gsd"),
      },
      surfaceContractRoot: join(home, ".temperance_engine", "generated", "surface-contracts"),
    },
    receiptPath: join(home, ".temperance_engine", "state", "gsd-command-install.json"),
    backupHelper: join(here, "..", "bin", "te-backup-if-changed"),
  };
}

if (import.meta.main) {
  const defaults = cliDefaults();
  if (process.argv[2] === "--uninstall") {
    uninstall(defaults.options.destinations);
  } else {
    const apply = process.argv.includes("--apply");
    const result = installGsdWrappers({
      ...defaults.options,
      apply,
      backupHelper: defaults.backupHelper,
      receiptPath: apply ? defaults.receiptPath : undefined,
    });
    if (!result.ok) {
      console.error(`${result.reasonCode}: ${result.command}`);
      process.exitCode = 1;
    } else if (!apply) {
      console.log(JSON.stringify({ ok: true, receipt: result.receipt }));
    } else {
      console.log(`installed ${result.receipt.commandCount} /gsd:* wrappers → ${result.receipt.destinationLabels.join(", ")}`);
    }
  }
}
