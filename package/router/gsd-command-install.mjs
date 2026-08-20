#!/usr/bin/env node
/**
 * Install thin /gsd:* wrappers for Codex, OpenCode, and Grok.
 * Does not fork get-shit-done — each wrapper reads the upstream workflow.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || homedir();
const MAP = JSON.parse(readFileSync(join(HERE, "gsd-rail-map.json"), "utf8"));
const GSD_HOME = (MAP.gsd_home || "~/.claude/get-shit-done").replace(/^~/, HOME);
const WORKFLOWS = join(GSD_HOME, MAP.workflow_dir || "workflows");

const DEST = {
  codex: join(HOME, ".codex", "prompts"),
  opencode: join(HOME, ".config", "opencode", "command"),
  grok: join(HOME, ".grok", "commands"),
  claude: join(HOME, ".claude", "commands"),
};

function railLine(name, spec) {
  const combo = spec.combo || "none";
  const seq = Array.isArray(spec.combo_sequence) ? spec.combo_sequence.join(" → ") : combo;
  return `GSD /${name} · mode ${spec.mode} · combo ${seq} · manifest ${spec.view} · alchemy ${spec.alchemy || "—"}`;
}

function wrapperBody(name, spec) {
  if (name === "goal") {
    return `---
description: GSD /goal — session completion loop · mode ALGORITHM · manifest PLANNING
argument-hint: "[completion condition]"
---

# /gsd:goal

This is a **Temperance loop**, not a GSD fork and not a second planner.

1. Mode is already **ALGORITHM** for this command. Do not present a picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply.
   On Grok, do not call \`ask_user_question\` for mode. Print Manifest URL (Grok has no ChatGPT IAB):
   \`http://127.0.0.1:5173/?mode=ALGORITHM&view=PLANNING&gsd=goal\`
   On Codex/Claude, open ChatGPT IAB only to that URL.
2. Run: \`node ~/.temperance_engine/router/temperance-goal.mjs --cwd . --ensure\` (or \`--set "$ARGUMENTS"\`).
3. Done-text comes from ISA \`## Goal\` when \`active_planner=isa\`, else GSD STATE. Do not invent a third goal.
4. On Claude Code, also set native \`/goal\` to that same text so the overlay/evaluator run.
5. Next command is printed (\`/gsd:plan-phase\`, \`/gsd:execute-phase\`, or \`/gsd:complete-milestone\`).
6. Execute still needs next-wave **approval** and \`te-dispatch-paid\`. Do not spawn a second GSD fleet.
7. Loop: \`temperance-goal --cwd . --eval\`. Fail → continue the same \`/gsd:*\`. Pass → stop.

Load using-superpowers. Swarm-scale plans use writing-plans or /gsd:plan-phase (swarm-architect if installed — plan only).
`;
  }
  if (name === "doctor") {
    return `---
description: GSD /doctor — host + project truth probe · mode NATIVE · manifest OVERVIEW
argument-hint: "[--json]"
---

# /gsd:doctor

This is a **Temperance probe**, not a GSD workflow fork. Do not invent a second GSD.

1. Mode is already **NATIVE** for this command. Do not present a picker. Do not write the three modes as a chat reply.
2. Print or (Codex/Claude only) open ChatGPT IAB to \`http://127.0.0.1:5173/?mode=NATIVE&view=OVERVIEW&gsd=doctor\`. Grok: print the URL only.
3. Run: \`temperance-project-init --cwd . --check $ARGUMENTS\`
4. Report Pulse :31337, Voice :8888, bridge freshness, OmniRoute bind, combo vs policy, GSD STATE, ISA, IAB pref, edge (local vs clio), active_planner, ranker age. Do not apply reconcile. Do not rotate secrets.

Load using-superpowers, then print the doctor output and the next \`/gsd:*\` from STATE (if Complete: \`/gsd:complete-milestone\`).
`;
  }
  const workflow = `~/.claude/get-shit-done/workflows/${name}.md`;
  const execute = spec.next_wave
    ? `
After reading the workflow, for [P] / parallel waves:
1. If \`~/.temperance_engine/state/fleet-locks/<cwd-hash>.json\` is active (<2h), do **not** spawn a second gsd-executor swarm on those \`[P]\` ids.
2. Run \`temperance-next-wave --cwd . --write-tasks\` (writes the lock when tasks are emitted)
3. Dispatch paid fleet with combo \`te-dispatch-paid\` via \`temperance-batch\` (do not also spawn a second GSD fleet for the same wave)
4. Keep GSD \`gsd-executor\` for sequential non-[P] plans only
`
    : "";
  return `---
description: GSD /${name} — ${railLine(name, spec)}
argument-hint: "[args]"
---

# /gsd:${name}

${railLine(name, spec)}

## Blocking runtime preflight

Before any workflow Read, planning artifact Read, or agent dispatch, run exactly one readiness probe:

\`\`\`sh
if ! command -v gsd-sdk >/dev/null 2>&1; then
  echo "FATAL: gsd-sdk is missing; GSD workflows are present but not executable." >&2
  echo "Install the matching external CLI: npm install -g get-shit-done-cc@1.42.3" >&2
  exit 1
fi
if ! gsd-sdk query current-timestamp full --raw >/dev/null 2>&1; then
  echo "FATAL: gsd-sdk query probe failed; repair the external GSD install before continuing." >&2
  exit 1
fi
\`\`\`

If either probe fails, stop. Do not compensate with repeated file reads, do not spawn \`gsd-planner\` or \`gsd-plan-checker\`, and do not write planning artifacts.

This is a **wrapper**. Do not invent a second GSD. Read and follow:

\`${workflow}\`

Arguments: \`$ARGUMENTS\`

## Temperance rail (required)

1. Mode is already **${spec.mode}** from the GSD rail map. Do not present a picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply.
2. After that, open ChatGPT **in-app** browser (Codex/Claude) or print the URL (Grok) to:
   \`http://127.0.0.1:5173/?mode=${spec.mode}&view=${encodeURIComponent(spec.view)}&gsd=${name}\`
   Never use Chrome/Safari/external-browser for this.
3. Use OmniRoute combo **${spec.combo || "none"}**. Spawn only registered \`gsd-*\` agents from the workflow.
4. End by reading \`.planning/STATE.md\` and stating the next \`/gsd:*\` command.
${execute}
Load using-superpowers, then execute the upstream GSD workflow exactly.
`;
}

function install() {
  if (!existsSync(WORKFLOWS)) {
    console.error("GSD workflows missing:", WORKFLOWS);
    process.exit(1);
  }
  const names = Object.keys(MAP.commands);
  for (const dest of Object.values(DEST)) mkdirSync(dest, { recursive: true });

  let written = 0;
  for (const name of names) {
    const spec = MAP.commands[name];
    const wf = join(WORKFLOWS, `${name}.md`);
    if (!existsSync(wf) && name !== "workstreams" && name !== "doctor" && name !== "goal") {
      console.warn("skip (no workflow):", name);
      continue;
    }
    const body = wrapperBody(name, spec);
    writeFileSync(join(DEST.codex, `gsd-${name}.md`), body);
    writeFileSync(join(DEST.opencode, `gsd-${name}.md`), body);
    writeFileSync(join(DEST.grok, `gsd-${name}.md`), body);
    writeFileSync(join(DEST.claude, `gsd-${name}.md`), body);
    if (name === "goal") writeFileSync(join(DEST.claude, "goal.md"), body);
    written++;
  }
  writeFileSync(
    join(HOME, ".temperance_engine", "state", "gsd-command-install.json"),
    JSON.stringify({ installed_at: new Date().toISOString(), written, dest: DEST, version: MAP.gsd_version, requires: ["gsd-sdk query"] }, null, 2) + "\n",
  );
  console.log(`installed ${written} /gsd:* wrappers → Codex, OpenCode, Grok, Claude Code`);
}

function uninstall() {
  let n = 0;
  for (const dest of Object.values(DEST)) {
    if (!existsSync(dest)) continue;
    for (const file of readdirSync(dest)) {
      if (!file.startsWith("gsd-") || !file.endsWith(".md")) continue;
      rmSync(join(dest, file));
      n++;
    }
  }
  console.log("removed", n, "wrappers");
}

const arg = process.argv[2];
if (arg === "--uninstall") uninstall();
else install();
