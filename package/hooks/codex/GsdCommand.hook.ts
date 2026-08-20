#!/usr/bin/env bun
/**
 * UserPromptSubmit: when the prompt is /gsd:<command>, inject <gsd-rail>,
 * emit gsd.command.started, and (if mode already chosen) point Manifest IAB
 * at the mapped GSD view. Does not replace GSD workflows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readSessionMode } from "./ManifestModeCommit.hook.ts";

const HOME = homedir();
const MAP_PATH = join(HOME, ".temperance_engine", "router", "gsd-rail-map.json");

export function loadGsdMap(): any {
  try {
    return JSON.parse(readFileSync(MAP_PATH, "utf8"));
  } catch {
    return { commands: {}, defaults: {} };
  }
}

export function parseCommand(prompt: string): { name: string; args: string } | null {
  const raw = String(prompt || "").trim();
  const native = raw.match(/^\/goal(?:\s+(.*))?$/i);
  if (native) return { name: "goal", args: (native[1] || "").trim() };
  const m = raw.match(/^\/gsd:([a-z0-9-]+)(?:\s+(.*))?$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] || "").trim() };
}

export function formatRail(name: string, spec: any, chosen: string | null): string {
  const combo = spec.combo_sequence ? spec.combo_sequence.join(" → ") : spec.combo || "none";
  const view = spec.view || "PLANNING";
  const consoleUrl = (process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || "https://speculum.localhost:1355").replace(/\/$/, "");
  const url = `${consoleUrl}/?mode=${encodeURIComponent(spec.mode || "ALGORITHM")}&view=${encodeURIComponent(view)}&gsd=${encodeURIComponent(name)}`;
  const lines = [
    "<gsd-rail>",
    `☿ GSD · /${name} · ${spec.group || "ops"}`,
    `  ·  mode      ${spec.mode || "ALGORITHM"}`,
    `  ·  combo     ${combo}`,
    `  ·  view      ${view}`,
    `  ·  alchemy   ${spec.alchemy || "—"}`,
    `  ·  workflow  ~/.claude/get-shit-done/workflows/${name}.md`,
    (chosen || spec.mode)
      ? `  ·  console   mode ${chosen || spec.mode} already bound — print Manifest URL (ChatGPT iab if available) → ${url}`
      : "  ·  console   no session mode: call ask_user_question / AskUserQuestion — never a chat-reply quiz",
    spec.next_wave ? "  ·  fleet     temperance-next-wave + te-dispatch-paid (no double spawn)" : "",
    "  ·  design    ~/.temperance_engine/docs/GSD-PAI-DESIGN-FLOW.md",
    "  ·  init      rail-format.sh gsd-init " + name,
    "</gsd-rail>",
  ].filter(Boolean);
  return lines.join("\n");
}

const TE_ONLY = new Set(["workstreams", "doctor", "goal"]);

export function gsdAdditionalContext(prompt: string, sessionId?: string, cwd?: string): string | null {
  const parsed = parseCommand(prompt);
  if (!parsed) return null;
  const map = loadGsdMap();
  const spec = map.commands?.[parsed.name] || { ...map.defaults, group: "ops" };
  const wf = join(HOME, ".claude", "get-shit-done", "workflows", `${parsed.name}.md`);
  if (!existsSync(wf) && !TE_ONLY.has(parsed.name)) {
    return `<gsd-rail>\nUnknown /gsd:${parsed.name}. Run /gsd:help.\n</gsd-rail>`;
  }
  const rail = formatRail(parsed.name, spec, readSessionMode(sessionId, cwd));
  if (parsed.name !== "goal") return rail;
  const goalPath = join(cwd || process.cwd(), ".temperance", "goal.json");
  let goalLine = "  ·  goal      none yet — run temperance-goal --ensure (text from ISA Goal or STATE)";
  try {
    const g = JSON.parse(readFileSync(goalPath, "utf8"));
    goalLine = `  ·  goal      ${g.status || "active"} · ${String(g.text || "").slice(0, 160)}\n  ·  next       /gsd:${g.gsd_command || "progress"}\n  ·  claude     native /goal with the same text`;
  } catch { /* none */ }
  return rail.replace("</gsd-rail>", `${goalLine}\n</gsd-rail>`);
}

function fleetLockPath(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return join(HOME, ".temperance_engine", "state", "fleet-locks", `${hash}.json`);
}

export function fleetLockActive(cwd: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(fleetLockPath(cwd), "utf8")) as { locked_at?: string; status?: string };
    if (lock.status !== "active") return false;
    const age = Date.now() - Date.parse(String(lock.locked_at || 0));
    return Number.isFinite(age) && age < 2 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function writeFleetLock(cwd: string, payload: Record<string, unknown>): string {
  const path = fleetLockPath(cwd);
  mkdirSync(join(HOME, ".temperance_engine", "state", "fleet-locks"), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ status: "active", cwd, locked_at: new Date().toISOString(), ...payload }, null, 2)}\n`);
  return path;
}

async function emit(name: string, spec: any, sessionId?: string) {
  const event = {
    id: `evt_gsd_${Date.now().toString(36)}`,
    source: "pai-hook",
    kind: "gsd.command.started",
    status: "observed",
    actor: "gsd-command-hook",
    session_id: sessionId,
    payload: {
      command: name,
      mode: spec.mode,
      combo: spec.combo,
      view: spec.view,
      alchemy: spec.alchemy,
      group: spec.group,
    },
    evidence: [{ label: "gsd-workflow", path: `${HOME}/.claude/get-shit-done/workflows/${name}.md` }],
  };
  try {
    await fetch("http://127.0.0.1:8766/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(400),
    });
  } catch {
    /* bridge optional */
  }
}

async function main() {
  let input: any = {};
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }
  const prompt = String(input.prompt || input.user_prompt || "").trim();
  const parsed = parseCommand(prompt);
  if (!parsed) process.exit(0);

  const map = loadGsdMap();
  const spec = map.commands?.[parsed.name] || { ...map.defaults, group: "ops" };
  const wf = join(HOME, ".claude", "get-shit-done", "workflows", `${parsed.name}.md`);
  if (!existsSync(wf) && !TE_ONLY.has(parsed.name)) process.exit(0);

  await emit(parsed.name, spec, input.session_id);
  if (spec.next_wave && !fleetLockActive(process.cwd())) {
    try {
      const { spawn } = await import("node:child_process");
      spawn(join(HOME, ".temperance_engine", "router", "temperance-next-wave.mjs"), ["--cwd", process.cwd()], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } catch {
      /* optional */
    }
  }
  // UPS last-wins: PromptProcessing emits <gsd-rail>. This hook only events + lock.
}

if (import.meta.main) {
  main().catch(() => process.exit(0));
}
