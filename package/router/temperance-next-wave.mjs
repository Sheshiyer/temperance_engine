#!/usr/bin/env node
/**
 * temperance-next-wave — resolve the next parallelizable planning wave from local
 * repo artifacts (GSD .planning, spec-kit tasks.md, docs/plans) and optionally
 * hand off to plan-issue-sync / temperance-batch tasklist shape.
 *
 * This is the missing glue between:
 *   local planning (source of truth)
 *   → OpenCode/PAI enrich injection (agent sees what to do next)
 *   → plan-issue-sync (GitHub addressable pointer)
 *   → temperance-batch / te-dispatch-paid (execution)
 *
 * Usage:
 *   temperance-next-wave                 # cwd, human summary + write state
 *   temperance-next-wave --json          # machine
 *   temperance-next-wave --cwd <path>
 *   temperance-next-wave --sync          # also run plan-issue-sync --apply (GH)
 *   temperance-next-wave --write-tasks   # emit temperance-batch tasks.json
 *
 * Fail-open: never throws; empty wave when nothing found.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOME = process.env.HOME || homedir();
const STATE_DIR = join(HOME, ".temperance_engine", "state");
const STATE_PATH = join(STATE_DIR, "next-wave.json");
const PLAN_ISSUE_SYNC = join(HOME, ".temperance_engine", "scripts", "plan-issue-sync.ts");

const OPEN_TASK =
  /^\s*-\s*\[([ xX])\]\s*(T\d+)?\s*(\[P\])?\s*(\[[A-Z]+\d*\])?\s*(.+)$/;
const HEADING = /^(#{1,4})\s+(.+)$/;
const STATE_PHASE = /Phase:\s*(.+)/i;
const STATE_STATUS = /Status:\s*(.+)/i;
const STATE_RESUME = /Resume file:\s*(.+)/i;
const STATE_FOCUS = /Current focus:\s*(.+)/i;

function parseArgs(argv) {
  const opts = {
    cwd: process.cwd(),
    json: false,
    sync: false,
    writeTasks: false,
    approval: null,
    maxWave: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--sync") opts.sync = true;
    else if (a === "--write-tasks") opts.writeTasks = true;
    else if (a === "--approval") opts.approval = argv[++i] || null;
    else if (a === "--cwd") opts.cwd = resolve(argv[++i] || ".");
    else if (a === "--max") opts.maxWave = Number(argv[++i] || 4);
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readPlanOptions(cwd) {
  const candidate = join(cwd, ".planning", "PLAN-OPTIONS.json");
  const value = readText(candidate);
  if (!value) return { options: [], evidence: [], source: null };
  try {
    const parsed = JSON.parse(value);
    return {
      options: Array.isArray(parsed.options) ? parsed.options.slice(0, 4) : [],
      evidence: Array.isArray(parsed.research) ? parsed.research.slice(0, 20) : [],
      source: candidate,
    };
  } catch {
    return { options: [], evidence: [], source: null };
  }
}

function readApproval(cwd, approvalId) {
  if (!approvalId) return null;
  const text = readText(join(cwd, ".planning", "APPROVALS.json"));
  if (!text) return null;
  try {
    const values = JSON.parse(text);
    const approvals = Array.isArray(values) ? values : Array.isArray(values.approvals) ? values.approvals : [];
    return approvals.find((approval) => approval && approval.approval_id === approvalId) || null;
  } catch { return null; }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
function readText(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function walkFiles(root, pred, acc = [], depth = 0) {
  if (depth > 6 || !isDir(root)) return acc;
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (
      name === "node_modules" ||
      name === ".git" ||
      name === "dist" ||
      name === "archive" ||
      name === "node_modules.nosync"
    )
      continue;
    if (name.startsWith(".bak") || name.includes(".pre-restore-")) continue;
    if (root.includes("/docs/archive/") || root.includes("/.archive/")) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, pred, acc, depth + 1);
    else if (st.isFile() && pred(full, name)) acc.push(full);
  }
  return acc;
}

function discoverSources(cwd) {
  const sources = [];
  const planning = join(cwd, ".planning");
  if (isDir(planning)) {
    for (const name of ["STATE.md", "ROADMAP.md", "PROJECT.md", "REQUIREMENTS.md"]) {
      const p = join(planning, name);
      if (isFile(p)) sources.push({ kind: "gsd", path: p, weight: name === "STATE.md" ? 100 : 40 });
    }
    // phase plans with open boxes
    const phaseFiles = [];
    walkFiles(
      join(planning, "phases"),
      (full, name) => name.endsWith(".md") && !name.includes("SUMMARY"),
      phaseFiles,
    );
    for (const p of phaseFiles) sources.push({ kind: "gsd-phase", path: p, weight: 70 });
  }
  for (const rel of ["tasks.md", "spec/tasks.md", "docs/tasks.md"]) {
    const p = join(cwd, rel);
    if (isFile(p)) sources.push({ kind: "spec-kit", path: p, weight: 90 });
  }
  const specs = join(cwd, "specs");
  if (isDir(specs)) {
    const taskFiles = [];
    walkFiles(specs, (full, name) => name === "tasks.md", taskFiles);
    for (const p of taskFiles) sources.push({ kind: "spec-kit", path: p, weight: 85 });
  }
  // Prefer live GSD/spec-kit over historical plan dumps (docs/archive skipped in walk).
  // When STATE.md says complete, de-prioritize loose plan-docs so we don't revive finished work.
  const plansDirs = [
    join(cwd, "docs", "superpowers", "plans"),
    join(cwd, "docs", "plans"),
    join(cwd, "tasks"),
  ];
  for (const dir of plansDirs) {
    if (!isDir(dir)) continue;
    if (dir.includes("/docs/archive")) continue;
    const files = [];
    walkFiles(dir, (full, name) => name.endsWith(".md") && !full.includes("/archive/"), files, 0);
    files.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });
    for (const p of files.slice(0, 6)) sources.push({ kind: "plan-doc", path: p, weight: 45 });
  }
  // de-dupe by path
  const seen = new Set();
  return sources
    .filter((s) => {
      if (seen.has(s.path)) return false;
      seen.add(s.path);
      return true;
    })
    .sort((a, b) => b.weight - a.weight);
}

function parseStateMd(text) {
  const out = { phase: null, status: null, resume: null, focus: null, complete: false };
  if (!text) return out;
  const phase = text.match(STATE_PHASE);
  const status = text.match(STATE_STATUS);
  const resume = text.match(STATE_RESUME);
  const focus = text.match(STATE_FOCUS);
  if (phase) out.phase = phase[1].trim();
  if (status) out.status = status[1].trim();
  if (resume) out.resume = resume[1].trim();
  if (focus) out.focus = focus[1].trim();
  out.complete = /complete|done|100%|historical/i.test(out.status || "") || /100%/.test(text.slice(0, 800));
  return out;
}

function parseTasks(text, sourcePath) {
  const tasks = [];
  let phase = "default";
  let phaseIdx = 0;
  if (!text) return tasks;
  for (const raw of text.split("\n")) {
    const h = raw.match(HEADING);
    if (h) {
      phase = h[2].trim();
      phaseIdx += 1;
      continue;
    }
    const m = raw.match(OPEN_TASK);
    if (!m) continue;
    const done = m[1].toLowerCase() === "x";
    const id = (m[2] || `L${tasks.length + 1}`).trim();
    const parallel = Boolean(m[3]);
    const us = m[4] || null;
    const desc = m[5].trim();
    tasks.push({
      id,
      done,
      parallel,
      us,
      desc,
      phase,
      phaseIdx,
      source: sourcePath,
    });
  }
  return tasks;
}

function pickWave(tasks, maxWave) {
  const open = tasks.filter((t) => !t.done);
  if (open.length === 0) return { tasks: [], mode: "none", phase: null };

  // Prefer the earliest phase that still has open work
  const minPhase = Math.min(...open.map((t) => t.phaseIdx));
  const phaseOpen = open.filter((t) => t.phaseIdx === minPhase);
  const phaseName = phaseOpen[0]?.phase || null;

  // Contiguous [P] group at start of phase open list
  const parallelLead = [];
  for (const t of phaseOpen) {
    if (t.parallel) parallelLead.push(t);
    else break;
  }
  if (parallelLead.length >= 2) {
    return {
      tasks: parallelLead.slice(0, maxWave),
      mode: "parallel",
      phase: phaseName,
    };
  }

  // All open in phase marked parallel (not necessarily contiguous at head)
  const allP = phaseOpen.filter((t) => t.parallel);
  if (allP.length >= 2) {
    return { tasks: allP.slice(0, maxWave), mode: "parallel", phase: phaseName };
  }

  // Sequential: first N open in phase (default 1 unless many short independent)
  return {
    tasks: phaseOpen.slice(0, Math.min(maxWave, phaseOpen.length > 3 ? 2 : 1)),
    mode: phaseOpen.length > 1 ? "sequential-batch" : "single",
    phase: phaseName,
  };
}

function gitRemote(cwd) {
  try {
    const out = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (out.status !== 0) return null;
    const url = (out.stdout || "").trim();
    const m =
      url.match(/github\.com[:/](.+?)(?:\.git)?$/) ||
      url.match(/github\.com\/(.+?)(?:\.git)?$/);
    return m ? m[1].replace(/\.git$/, "") : url;
  } catch {
    return null;
  }
}

export function resolveNextWave(cwd, { maxWave = 4, approvalId = null } = {}) {
  const abs = resolve(cwd || process.cwd());
  const sources = discoverSources(abs);
  const stateSrc = sources.find((s) => basename(s.path) === "STATE.md");
  const gsdState = stateSrc ? parseStateMd(readText(stateSrc.path)) : null;

  let allTasks = [];
  // When GSD STATE is Complete/historical, ignore loose plan-docs and only
  // honor active spines: gsd-phase under .planning/phases, or root tasks.md /
  // specs/**/tasks.md that are clearly still live. Orphan open checkboxes in
  // docs/plans must not reopen a finished planning slice.
  const taskSources = sources.filter((s) => {
    if (basename(s.path) === "STATE.md") return false;
    if (gsdState?.complete && s.kind === "plan-doc") return false;
    if (gsdState?.complete && s.kind === "gsd" && basename(s.path) !== "STATE.md") {
      // ROADMAP/PROJECT under .planning still ok for context, not task queues
      return false;
    }
    return true;
  });
  for (const s of taskSources) {
    const text = readText(s.path);
    if (!text) continue;
    // skip historical complete plan docs with zero open boxes quickly
    const openCount = (text.match(/^\s*-\s*\[ \]/gm) || []).length;
    if (openCount === 0 && s.kind === "plan-doc") continue;
    // If STATE complete: only keep phase files that look active (not SUMMARY-complete)
    if (gsdState?.complete && s.kind === "gsd-phase") {
      const st = parseStateMd(text);
      if (st.complete) continue;
      // phase markdown without its own Status still treated as historical when root STATE complete
      if (!/Status:\s*/i.test(text.slice(0, 400))) continue;
    }
    allTasks = allTasks.concat(parseTasks(text, s.path));
  }

  // Prefer tasks from highest-weight sources that have open work
  const bySource = new Map();
  for (const t of allTasks) {
    if (t.done) continue;
    if (!bySource.has(t.source)) bySource.set(t.source, []);
    bySource.get(t.source).push(t);
  }
  let chosenSource = null;
  let chosenTasks = [];
  for (const s of sources) {
    const open = bySource.get(s.path);
    if (open && open.length) {
      chosenSource = s;
      chosenTasks = allTasks.filter((t) => t.source === s.path);
      break;
    }
  }
  if (!chosenTasks.length && allTasks.length) {
    chosenTasks = allTasks;
    chosenSource = { path: allTasks[0].source, kind: "mixed", weight: 0 };
  }

  let wave = pickWave(chosenTasks, maxWave);
  let openTotal = chosenTasks.filter((t) => !t.done).length;
  let doneTotal = chosenTasks.filter((t) => t.done).length;

  // Hard rule: GSD STATE Status Complete wins over orphan open checkboxes.
  // Spec-kit tasks.md under specs/ is allowed only if STATE is NOT complete,
  // or if STATE is absent. When STATE is complete, wave is empty + action complete.
  let action = "idle";
  let reason = "no open planning tasks found in cwd";
  let orphanIgnored = 0;
  if (gsdState?.complete) {
    // Count orphans that would have been proposed without this gate
    const orphanSources = sources.filter(
      (s) => s.kind === "plan-doc" || (s.kind === "gsd" && basename(s.path) !== "STATE.md"),
    );
    for (const s of orphanSources) {
      const text = readText(s.path);
      if (!text) continue;
      orphanIgnored += (text.match(/^\s*-\s*\[ \]/gm) || []).length;
    }
    wave = { tasks: [], mode: "none", phase: gsdState.phase || null };
    openTotal = 0;
    doneTotal = chosenTasks.filter((t) => t.done).length;
    action = "complete";
    reason =
      `GSD STATE is complete (${gsdState.status || "done"})` +
      (orphanIgnored
        ? ` — ignored ${orphanIgnored} orphan open checkbox(es) in historical plans`
        : "");
  } else if (wave.tasks.length && wave.mode === "parallel") {
    action = "dispatch_parallel";
    reason = `phase "${wave.phase}" has ${wave.tasks.length} parallel [P] tasks`;
  } else if (wave.tasks.length && wave.mode === "sequential-batch") {
    action = "execute_next";
    reason = `phase "${wave.phase}" has ${openTotal} open tasks; take next batch`;
  } else if (wave.tasks.length) {
    action = "execute_next";
    reason = `next open task in "${wave.phase}"`;
  } else if (gsdState && !gsdState.complete) {
    action = "resume_state";
    reason = gsdState.resume
      ? `resume ${gsdState.resume}`
      : `STATE focus: ${gsdState.focus || gsdState.phase || "unknown"}`;
  } else if (sources.length && openTotal === 0) {
    action = "complete";
    reason = "planning sources present but no open checkboxes";
  }

  const remote = gitRemote(abs);
  const policyHash = fingerprint({ version: "temperance.approval-policy.v1", approval: "human_required", max_concurrency: 4 });
  const sourceFingerprints = sources.map((source) => ({ path: relative(abs, source.path) || source.path, fingerprint: fingerprint(readText(source.path) || "") }));
  const taskSpec = (wave.tasks || []).map((task) => ({ id: task.id, parallel: task.parallel, desc: task.desc, phase: task.phase, source: relative(abs, task.source) }));
  const planId = `plan_${fingerprint({ cwd: abs, sourceFingerprints, taskSpec, policyHash }).slice(0, 20)}`;
  const externalOptions = readPlanOptions(abs);
  const defaultOption = {
    option_id: `opt_${fingerprint({ planId, taskSpec, combo: action === "dispatch_parallel" ? "te-dispatch-paid" : "te-build" }).slice(0, 20)}`,
    label: action === "dispatch_parallel" ? "Execute the proposed parallel wave" : "Execute the proposed next task",
    recommendation: true,
    rationale: reason,
    tasks: taskSpec,
    combo: action === "dispatch_parallel" ? "te-dispatch-paid" : "te-build",
    concurrency: Math.min(4, Math.max(1, taskSpec.length)),
    worktree_required: action === "dispatch_parallel",
  };
  const options = externalOptions.options.length ? externalOptions.options : taskSpec.length ? [defaultOption] : [];
  const requiredApprovalId = `apr_${fingerprint({ planId, optionIds: options.map((option) => option.option_id), policyHash }).slice(0, 20)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const approvalReceipt = readApproval(abs, approvalId || requiredApprovalId);
  const approved = Boolean(approvalReceipt && approvalReceipt.plan_id === planId && approvalReceipt.policy_hash === policyHash && Date.parse(approvalReceipt.expires_at || '') > Date.now() && options.some((option) => option.option_id === approvalReceipt.option_id));
  const result = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    cwd: abs,
    github: remote,
    gsd: gsdState,
    sources: sources.map((s) => ({
      kind: s.kind,
      path: relative(abs, s.path) || s.path,
      weight: s.weight,
    })),
    progress: {
      open: openTotal,
      done: doneTotal,
      source: chosenSource?.path || null,
      orphan_open_ignored: orphanIgnored || 0,
    },
    wave: {
      action,
      reason,
      mode: wave.mode,
      phase: wave.phase,
      combo:
        action === "dispatch_parallel"
          ? "te-dispatch-paid"
          : action === "execute_next"
            ? "te-build"
            : "te-reason",
      tasks: (wave.tasks || []).map((t) => ({
        id: t.id,
        parallel: t.parallel,
        desc: t.desc,
        phase: t.phase,
        source: relative(abs, t.source),
      })),
    },
    orchestration: {
      schema: "temperance.orchestration.v1",
      plan_id: planId,
      state: options.length ? "awaiting_approval" : "draft",
      mapping: { policy_hash: policyHash, phase_combo_map: "temperance.phase-combo-map.v2", planner: "temperance-next-wave" },
      source_fingerprints: sourceFingerprints,
      research: externalOptions.evidence,
      options,
      approval: options.length ? { approval_id: requiredApprovalId, status: approved ? "granted" : "required", expires_at: approved ? approvalReceipt.expires_at : expiresAt, selected_option_id: approved ? approvalReceipt.option_id : null } : null,
      readiness: { status: approved ? "ready_to_queue" : "blocked", checks: ["human_approval", "source_freshness", "quota_snapshot", "dispatch_receipt"] },
      execution: { status: approved ? "approved_to_queue" : "blocked", reason: approved ? "valid approval receipt exists; dispatcher must still revalidate before claiming work" : options.length ? "human approval is required before any swarm dispatch" : "no executable proposal" },
      reporting: { status: "pending", required_receipts: ["dispatch", "task", "verification"] },
    },
    agent_instruction: buildAgentInstruction({
      action,
      reason,
      wave,
      gsdState,
      remote,
      openTotal,
    }),
  };
  return result;
}

function buildAgentInstruction({ action, reason, wave, gsdState, remote, openTotal }) {
  const lines = [];
  lines.push("NEXT-WAVE (proposal only — human approval required before dispatch):");
  lines.push(`  action=${action} · ${reason}`);
  if (gsdState?.phase) lines.push(`  gsd_phase=${gsdState.phase} status=${gsdState.status || "?"}`);
  if (remote) lines.push(`  github=${remote}`);
  if (wave.tasks?.length) {
    lines.push(`  wave_mode=${wave.mode} phase="${wave.phase}" open_total=${openTotal}`);
    for (const t of wave.tasks) {
      lines.push(`  - [${t.parallel ? "P" : " "}] ${t.id}: ${t.desc}`);
    }
    if (action === "dispatch_parallel") {
      lines.push(
        "  DO: present the proposed option, research and readiness checks; after an unexpired approval receipt, dispatch via temperance-batch / te-dispatch-paid and integrate receipts.",
      );
    } else if (action === "execute_next") {
      lines.push("  DO: present the proposed option and wait for an explicit approval receipt before executing it.");
    }
  } else if (action === "resume_state" && gsdState?.resume) {
    lines.push(`  DO: open ${gsdState.resume} and continue from last stop.`);
  } else if (action === "complete") {
    lines.push("  DO: report completion; offer Learn/ship — do not invent new work.");
  } else {
    lines.push("  DO: if user intent is greenfield, scaffold .planning or specs/*/tasks.md; else ask once for target repo.");
  }
  lines.push(
    "  SYNC: plan-issue-sync LaunchAgent promotes open plan docs → Sheshiyer/thoughtseed-vault issues hourly; run temperance-next-wave --sync to force.",
  );
  return lines.join("\n");
}

function writeState(result) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(result, null, 2) + "\n");
  } catch {
    /* ignore */
  }
  // local project copy for humans / GSD
  try {
    const localDir = join(result.cwd, ".planning");
    if (isDir(localDir)) {
      writeFileSync(join(localDir, "NEXT-WAVE.json"), JSON.stringify(result, null, 2) + "\n");
      writeFileSync(join(localDir, "ORCHESTRATION.json"), JSON.stringify(result.orchestration, null, 2) + "\n");
    }
  } catch {
    /* ignore */
  }
  return STATE_PATH;
}

function writeBatchTasks(result) {
  const tasks = (result.wave?.tasks || []).map((t) => ({
    id: t.id,
    task: `${t.desc}\n\nSource: ${t.source}\nPhase: ${t.phase}\nRepo: ${result.cwd}`,
    backend: "omniroute",
    model: result.wave.combo || "te-dispatch-paid",
  }));
  const out = join(result.cwd, ".planning", "next-wave-tasks.json");
  try {
    mkdirSync(join(result.cwd, ".planning"), { recursive: true });
    writeFileSync(out, JSON.stringify(tasks, null, 2) + "\n");
    return out;
  } catch {
    const fallback = join(STATE_DIR, "next-wave-tasks.json");
    writeFileSync(fallback, JSON.stringify(tasks, null, 2) + "\n");
    return fallback;
  }
}

function runSync() {
  if (!existsSync(PLAN_ISSUE_SYNC)) {
    return { ok: false, error: "plan-issue-sync.ts missing" };
  }
  const r = spawnSync("bun", [PLAN_ISSUE_SYNC, "--apply"], {
    encoding: "utf8",
    timeout: 120000,
    cwd: join(HOME, ".temperance_engine"),
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || "").slice(-2000),
    stderr: (r.stderr || "").slice(-1000),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: temperance-next-wave [--cwd DIR] [--json] [--sync] [--write-tasks] [--max N]`);
    process.exit(0);
  }
  const result = resolveNextWave(opts.cwd, { maxWave: opts.maxWave, approvalId: opts.approval });
  const statePath = writeState(result);
  result.state_path = statePath;

  if (opts.writeTasks && result.wave?.tasks?.length) {
    if (result.orchestration?.approval?.status === "granted") {
      result.batch_tasks_path = writeBatchTasks(result);
      try {
        const lockDir = join(HOME, ".temperance_engine", "state", "fleet-locks");
        mkdirSync(lockDir, { recursive: true });
        const hash = createHash("sha256").update(result.cwd).digest("hex").slice(0, 16);
        const ids = (result.wave.tasks || []).map((t) => t.id || t.task_id).filter(Boolean);
        writeFileSync(
          join(lockDir, `${hash}.json`),
          JSON.stringify({
            status: "active",
            cwd: result.cwd,
            locked_at: new Date().toISOString(),
            combo: "te-dispatch-paid",
            task_ids: ids,
            batch_tasks_path: result.batch_tasks_path,
          }, null, 2) + "\n",
        );
        result.fleet_lock = join(lockDir, `${hash}.json`);
      } catch {
        /* lock is advisory */
      }
    } else result.task_write_blocked = "approval receipt required; task file was not written";
  }
  if (opts.sync) {
    result.sync = runSync();
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.agent_instruction);
    console.log("");
    console.log(`state: ${statePath}`);
    if (result.batch_tasks_path) console.log(`batch: ${result.batch_tasks_path}`);
    if (result.sync) console.log(`sync: ${result.sync.ok ? "ok" : "fail"} status=${result.sync.status}`);
    if (result.wave?.tasks?.length && result.orchestration?.approval?.status === "granted") {
      console.log("");
      console.log("Suggested execute:");
      if (result.wave.mode === "parallel") {
        console.log(
          `  temperance-batch --foreground --tasks ${result.batch_tasks_path || ".planning/next-wave-tasks.json"} --concurrency ${Math.min(4, result.wave.tasks.length)} --worktree`,
        );
      } else {
        console.log(
          `  ~/.temperance_engine/router/temperance-phase-dispatch.sh Build "${result.wave.tasks[0]?.desc || ""}"`,
        );
      }
    } else if (result.wave?.tasks?.length) {
      console.log("\nDispatch remains blocked until the approval receipt is recorded and revalidated.");
    }
  }
}

// export for import; run main when executed
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("temperance-next-wave.mjs") ||
    process.argv[1].endsWith("temperance-next-wave"));
if (isMain) main();
