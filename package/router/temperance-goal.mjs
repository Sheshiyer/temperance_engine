#!/usr/bin/env node
/**
 * temperance-goal — portable /goal contract for Codex, OpenCode, Grok.
 * Claude may also set native /goal to the same text.
 * Does not dispatch fleets. Does not fork GSD.
 *
 *   temperance-goal --cwd DIR              # print active goal
 *   temperance-goal --cwd DIR --ensure     # write from ISA Goal or GSD STATE
 *   temperance-goal --cwd DIR --set TEXT   # set completion condition
 *   temperance-goal --cwd DIR --eval       # run listed probes
 *   temperance-goal --cwd DIR --json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const SCHEMA = "temperance.goal.v1";

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), ensure: false, eval: false, json: false, set: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd") opts.cwd = resolve(argv[++i] || ".");
    else if (a === "--ensure") opts.ensure = true;
    else if (a === "--eval") opts.eval = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--set") opts.set = argv[++i] || "";
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readPlanner(cwd) {
  const project = readJson(join(cwd, ".temperance", "project.json")) || {};
  return project.active_planner === "isa" || project.active_planner === "gsd"
    ? project.active_planner
    : existsSync(join(cwd, "ISA.md"))
      ? "isa"
      : existsSync(join(cwd, ".planning", "STATE.md"))
        ? "gsd"
        : "isa";
}

function extractIsaGoal(cwd) {
  const text = readFileSync(join(cwd, "ISA.md"), "utf8");
  const m = text.match(/^## Goal\s*\n+([\s\S]*?)(?=\n## |\n#[^#]|$)/m);
  return m ? m[1].trim().split("\n").filter((l) => l.trim() && !l.startsWith("---")).join(" ").slice(0, 400) : null;
}

function extractStateGoal(cwd) {
  const text = readFileSync(join(cwd, ".planning", "STATE.md"), "utf8");
  const status = (text.match(/Status\s*:\s*(.+)/i) || [])[1]?.trim();
  const next = /status[:\s*]*complete/i.test(text) ? "/gsd:complete-milestone" : "/gsd:progress";
  return status ? `GSD STATE ${status}. Next ${next}.` : null;
}

function defaultEvaluators(cwd, planner) {
  const ev = [
    {
      id: "doctor",
      probe: "temperance-project-init --cwd . --check --json",
      pass: "high_gaps==0",
    },
  ];
  if (planner === "gsd" && existsSync(join(cwd, ".planning", "STATE.md"))) {
    ev.push({ id: "state", probe: "rg -n Status .planning/STATE.md", pass: "file readable" });
  }
  if (planner === "isa" && existsSync(join(cwd, "ISA.md"))) {
    ev.push({ id: "isa-goal", probe: "rg -n '^## Goal' ISA.md", pass: "section present" });
  }
  return ev;
}

function nextCommand(cwd, planner) {
  if (planner === "gsd") {
    try {
      const state = readFileSync(join(cwd, ".planning", "STATE.md"), "utf8");
      if (/status[:\s*]*complete/i.test(state)) return "/gsd:complete-milestone";
      if (existsSync(join(cwd, ".planning", "NEXT-WAVE.json"))) return "/gsd:execute-phase";
      return "/gsd:progress";
    } catch {
      return "/gsd:progress";
    }
  }
  return "/gsd:plan-phase";
}

export function loadGoal(cwd) {
  return readJson(join(cwd, ".temperance", "goal.json"));
}

export function writeGoal(cwd, goal) {
  mkdirSync(join(cwd, ".temperance"), { recursive: true });
  const path = join(cwd, ".temperance", "goal.json");
  writeFileSync(path, JSON.stringify(goal, null, 2) + "\n");
  return path;
}

export function ensureGoal(cwd, text) {
  const planner = readPlanner(cwd);
  const existing = loadGoal(cwd);
  const body =
    (text && text.trim()) ||
    existing?.text ||
    (planner === "isa" && existsSync(join(cwd, "ISA.md")) ? extractIsaGoal(cwd) : null) ||
    (existsSync(join(cwd, ".planning", "STATE.md")) ? extractStateGoal(cwd) : null) ||
    "State a one-sentence completion condition. Do not invent work.";
  const goal = {
    schema: SCHEMA,
    text: body,
    planner,
    gsd_command: (nextCommand(cwd, planner) || "").replace(/^\/gsd:/, ""),
    evaluator: existing?.evaluator || defaultEvaluators(cwd, planner),
    status: existing?.status === "met" && !text ? "met" : "active",
    native: {
      claude: `/goal ${body}`,
      codex: "wrapper",
    },
    updated_at: new Date().toISOString(),
  };
  const path = writeGoal(cwd, goal);
  return { path, goal };
}

function runProbe(cwd, probe) {
  const r = spawnSync("sh", ["-lc", probe], { cwd, encoding: "utf8", timeout: 20000 });
  return {
    exit: r.status,
    ok: r.status === 0,
    stdout: (r.stdout || "").slice(0, 400),
    stderr: (r.stderr || "").slice(0, 200),
  };
}

export function evalGoal(cwd) {
  const goal = loadGoal(cwd) || ensureGoal(cwd).goal;
  const results = [];
  for (const ev of goal.evaluator || []) {
    const run = runProbe(cwd, ev.probe);
    results.push({ id: ev.id, pass: run.ok, ...run, want: ev.pass });
  }
  const met = results.length > 0 && results.every((r) => r.pass);
  goal.status = met ? "met" : "active";
  goal.last_eval_at = new Date().toISOString();
  writeGoal(cwd, goal);
  return { goal, results, met };
}

async function emit(kind, goal, cwd) {
  try {
    await fetch("http://127.0.0.1:8766/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `evt_goal_${Date.now().toString(36)}`,
        source: "temperance-goal",
        kind,
        status: "observed",
        actor: "temperance-goal",
        payload: { text: goal.text, status: goal.status, planner: goal.planner, gsd_command: goal.gsd_command, cwd },
        evidence: [{ label: "goal", path: join(cwd, ".temperance", "goal.json") }],
      }),
      signal: AbortSignal.timeout(400),
    });
  } catch {
    /* optional */
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: temperance-goal [--cwd DIR] [--ensure|--set TEXT|--eval] [--json]");
    process.exit(0);
  }
  let out;
  if (opts.set !== null) out = ensureGoal(opts.cwd, opts.set);
  else if (opts.ensure) out = ensureGoal(opts.cwd);
  else if (opts.eval) out = evalGoal(opts.cwd);
  else {
    const goal = loadGoal(opts.cwd);
    out = goal ? { goal, path: join(opts.cwd, ".temperance", "goal.json") } : ensureGoal(opts.cwd);
  }
  if (out.goal) await emit(opts.eval ? "goal.tick" : "goal.set", out.goal, opts.cwd);
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else {
    const g = out.goal;
    console.log(`goal: ${g.status}`);
    console.log(`text: ${g.text}`);
    console.log(`planner: ${g.planner}  next: /gsd:${g.gsd_command}`);
    if (out.results) {
      for (const r of out.results) console.log(`  ${r.pass ? "PASS" : "FAIL"} ${r.id} (exit ${r.exit})`);
      console.log(out.met ? "evaluator: MET" : "evaluator: continue");
    }
    if (g.native?.claude) console.log(`claude: set native ${g.native.claude}`);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("temperance-goal.mjs");
if (isMain) main();
