#!/usr/bin/env node
/**
 * temperance-project-init — stamp (or audit) a **project rail** so Temperance
 * Engine infra applies inside a repo, not only inside home-level agent chats.
 *
 * Host TE (`./install.sh` → ~/.temperance_engine, ~/.config/opencode, LaunchAgents)
 * is the operator runtime. This CLI is the missing **repo packet**:
 *
 *   .temperance/project.json     rail manifest (source of truth for project TE)
 *   .temperance/README.md        human map of host vs project ownership
 *   AGENTS.md                    optional TE block (append, never overwrite)
 *   .planning/                   ensure spine if missing
 *   ISA.md                       pointer note if missing (does not invent ISA)
 *   next-wave + codegraph checks
 *
 * Does NOT write OmniRoute credentials, provider secrets, or home configs into
 * the repo (cambium / vault policy).
 *
 * Usage:
 *   temperance-project-init --cwd <repo>              # apply safe rail
 *   temperance-project-init --cwd <repo> --check      # doctor only
 *   temperance-project-init --cwd <repo> --dry-run
 *   temperance-project-init --cwd <repo> --force      # refresh managed blocks
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HOME = process.env.HOME || homedir();
const TE_HOME = join(HOME, ".temperance_engine");
const MARK_START = "<!-- temperance:project-rail:start -->";
const MARK_END = "<!-- temperance:project-rail:end -->";

function parseArgs(argv) {
  const opts = {
    cwd: process.cwd(),
    check: false,
    dryRun: false,
    force: false,
    json: false,
    withAgents: true,
    withPlanning: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd") opts.cwd = resolve(argv[++i] || ".");
    else if (a === "--check" || a === "--doctor") opts.check = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--no-agents") opts.withAgents = false;
    else if (a === "--no-planning") opts.withPlanning = false;
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
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
function read(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function gitRemote(cwd) {
  try {
    const r = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (r.status !== 0) return null;
    const url = (r.stdout || "").trim();
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m ? m[1].replace(/\.git$/, "") : url;
  } catch {
    return null;
  }
}

function curlJson(url, timeoutMs = 800) {
  try {
    const r = spawnSync("curl", ["-sS", "-m", String(Math.max(1, timeoutMs / 1000)), url], {
      encoding: "utf8",
      timeout: timeoutMs + 200,
    });
    if (r.status !== 0) return { ok: false, status: r.status, body: (r.stderr || "").slice(0, 160) };
    const text = (r.stdout || "").trim();
    try {
      return { ok: true, json: JSON.parse(text), text };
    } catch {
      return { ok: true, text: text.slice(0, 200) };
    }
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 160) };
  }
}

function parseStateMd(cwd) {
  const text = read(join(cwd, ".planning", "STATE.md")) || "";
  const status = (text.match(/^\s*(?:\*\*)?Status(?:\*\*)?\s*:\s*(.+)$/im) || [])[1]?.trim() || null;
  const complete = /status[:\s*]*complete/i.test(text);
  return { present: Boolean(text), status, complete, next: complete ? "/gsd:complete-milestone" : "/gsd:progress" };
}

function liveProbes(cwd) {
  const pulse = curlJson("http://127.0.0.1:31337/health");
  const voice = curlJson("http://127.0.0.1:8888/health");
  const bridge = curlJson("http://127.0.0.1:8766/health");
  const omni = curlJson("http://127.0.0.1:20128/api/status");
  const iab = (() => {
    const toml = read(join(HOME, ".codex", "config.toml")) || "";
    return (toml.match(/open-local-url-in-target-preference\s*=\s*"([^"]+)"/) || [])[1] || "unset";
  })();
  const bind = (() => {
    try {
      const r = spawnSync("lsof", ["-nP", "-iTCP:20128", "-sTCP:LISTEN"], { encoding: "utf8", timeout: 1500 });
      const line = (r.stdout || "").split("\n").find((l) => l.includes("20128")) || "";
      return /TCP \*:20128/.test(line) ? "*:20128" : /127\.0\.0\.1:20128/.test(line) ? "127.0.0.1:20128" : (line.trim() || "not-listening");
    } catch {
      return "unread";
    }
  })();
  const product = (() => {
    try {
      return spawnSync("readlink", [join(TE_HOME, "product")], { encoding: "utf8", timeout: 800 }).stdout.trim();
    } catch {
      return null;
    }
  })();
  const ranking = (() => {
    try {
      const raw = JSON.parse(read(join(TE_HOME, "state", "paid-fleet-ranking.json")) || "{}");
      const ageH = raw.generated_at ? (Date.now() - Date.parse(raw.generated_at)) / 36e5 : null;
      return { generated_at: raw.generated_at || null, age_h: ageH, stale: ageH !== null && ageH > 6 };
    } catch {
      return { generated_at: null, age_h: null, stale: true };
    }
  })();
  const projectJson = (() => {
    try {
      return JSON.parse(read(join(cwd, ".temperance", "project.json")) || "null");
    } catch {
      return null;
    }
  })();
  const state = parseStateMd(cwd);
  const tomlHasMeshy = /MESHY_API_KEY\s*=\s*"[^"]+"/i.test(read(join(HOME, ".codex", "config.toml")) || "");
  const adminPresent = existsSync("/etc/codex");
  return {
    pulse: { url: "http://127.0.0.1:31337", ok: Boolean(pulse.ok && (pulse.json?.ok || pulse.json?.service)), detail: pulse.json?.service || pulse.text || pulse.error },
    voice: { url: "http://127.0.0.1:8888", ok: Boolean(voice.json?.status === "healthy"), tts_proven: false, detail: "TTS 502 is ElevenLabs auth — doctor does not claim speech" },
    bridge: { url: "http://127.0.0.1:8766", ok: Boolean(bridge.json?.service), freshness: bridge.json?.status || bridge.json?.freshness || null },
    omniroute: {
      url: "http://127.0.0.1:20128",
      bind,
      edge: "local",
      reachable: Boolean(omni.ok || omni.json || (omni.text || "").includes("401")),
    },
    iab,
    product_symlink: product,
    product_is_live: Boolean(product && (existsSync(join(product, "package/manifest-zone/src/GsdDeck.tsx")) || existsSync(join(product, "package/router/gsd-rail-map.json")))),
    ranking,
    active_planner: projectJson?.active_planner || null,
    gsd_state: state,
    config_layer: {
      user: join(HOME, ".codex", "config.toml"),
      project: existsSync(join(cwd, ".codex", "config.toml")) ? join(cwd, ".codex", "config.toml") : null,
      admin_present: adminPresent,
    },
    secrets_in_user_toml: { meshy_plaintext: tomlHasMeshy },
    mcp_note: "Grok MCP seats are not Codex MCP seats — skill-cluster names may not be connected here",
    picker_before_iab: true,
  };
}

function hostChecks() {
  const paths = {
    te_home: TE_HOME,
    route: join(HOME, ".local/bin/temperance-route"),
    batch: join(HOME, ".local/bin/temperance-batch"),
    next_wave: join(HOME, ".local/bin/temperance-next-wave"),
    dispatch: join(HOME, ".local/bin/temperance-dispatch"),
    opencode: join(HOME, ".config/opencode/opencode.json"),
    omniroute_db: join(HOME, ".omniroute/storage.sqlite"),
    phase_map: join(TE_HOME, "router/phase-combo-map.json"),
    paid_fleet: join(TE_HOME, "state/paid-fleet-ranking.json"),
  };
  const out = {};
  for (const [k, p] of Object.entries(paths)) {
    out[k] = { path: p, present: existsSync(p) };
  }
  return out;
}

function projectChecks(cwd) {
  const rel = {
    agents: "AGENTS.md",
    claude: "CLAUDE.md",
    isa: "ISA.md",
    planning: ".planning",
    planning_state: ".planning/STATE.md",
    planning_config: ".planning/config.json",
    temperance_dir: ".temperance",
    temperance_project: ".temperance/project.json",
    next_wave: ".planning/NEXT-WAVE.json",
    codegraph: ".codegraph",
    codex: ".codex",
    opencode_dir: ".opencode",
    project_packet: ".project",
    handoff: ".project/HANDOFF.md",
  };
  const out = {};
  for (const [k, r] of Object.entries(rel)) {
    const p = join(cwd, r);
    out[k] = {
      path: r,
      present: existsSync(p),
      kind: isDir(p) ? "dir" : isFile(p) ? "file" : "missing",
    };
  }
  const agents = read(join(cwd, "AGENTS.md")) || "";
  out.agents_has_te_block = {
    present: agents.includes(MARK_START),
    path: "AGENTS.md#temperance:project-rail",
  };
  return out;
}

function classifyGaps(host, project) {
  const gaps = [];
  const notes = [];

  // Host TE required for chat rails
  for (const k of ["te_home", "route", "batch", "next_wave", "opencode", "omniroute_db"]) {
    if (!host[k]?.present) {
      gaps.push({
        id: `host:${k}`,
        severity: "high",
        message: `Host Temperance surface missing: ${host[k]?.path}`,
        fix: "Run temperance_engine ./install.sh (and verify OmniRoute LaunchAgent).",
      });
    }
  }

  // Project rail
  if (!project.temperance_project.present) {
    gaps.push({
      id: "project:rail",
      severity: "high",
      message: "No .temperance/project.json — repo is not TE-initialized as a project.",
      fix: "temperance-project-init --cwd <repo>",
    });
  }

  if (!project.agents.present) {
    gaps.push({
      id: "project:agents",
      severity: "medium",
      message: "No AGENTS.md — chat clients have no repo contract.",
      fix: "temperance-project-init creates a minimal AGENTS.md or append TE block.",
    });
  } else if (!project.agents_has_te_block.present) {
    gaps.push({
      id: "project:agents-te-block",
      severity: "medium",
      message: "AGENTS.md exists but has no Temperance project-rail block.",
      fix: "temperance-project-init --cwd <repo> (appends managed block).",
    });
  }

  if (!project.planning.present) {
    gaps.push({
      id: "project:planning",
      severity: "medium",
      message: "No .planning/ — GSD/next-wave spine absent.",
      fix: "temperance-project-init scaffolds .planning/{STATE,PROJECT,config}.json",
    });
  } else if (!project.planning_state.present) {
    gaps.push({
      id: "project:state",
      severity: "low",
      message: ".planning/ present but STATE.md missing.",
      fix: "Add STATE.md or re-run init with --force for scaffold only if empty.",
    });
  }

  if (!project.isa.present) {
    gaps.push({
      id: "project:isa",
      severity: "low",
      message: "No ISA.md — Algorithm/enrich has no project acceptance ledger.",
      fix: "Author ISA.md (init will not invent a full ISA).",
    });
  }

  if (!project.codegraph.present) {
    gaps.push({
      id: "project:codegraph",
      severity: "low",
      message: "No .codegraph/ index — structural search falls back to grep.",
      fix: "codegraph init -i (in repo)",
    });
  }

  if (!project.opencode_dir.present) {
    notes.push({
      id: "note:opencode-project",
      message:
        "No .opencode/ — OpenCode uses home ~/.config/opencode only. Project rail still works via cwd + AGENTS.md + enrich.",
    });
  }

  if (project.project_packet.present) {
    notes.push({
      id: "note:packet",
      message:
        "`.project/` packet present (cambium-style). TE project rail coexists; does not replace HANDOFF/CONTEXT authority.",
    });
  }

  notes.push({
    id: "note:boundary",
    message:
      "Host TE owns models/OmniRoute/credentials. Project rail owns planning/ISA/AGENTS/next-wave. Never put provider secrets in the repo.",
  });
  notes.push({
    id: "note:admin",
    message: "/etc/codex is absent on this Mini. ChatGPT still shows an empty Admin dropdown — that is not a defect.",
  });
  notes.push({
    id: "note:mcp",
    message: "Grok MCP and Codex MCP are different seats. A skill-cluster tool name is not proof the current surface is connected.",
  });

  return { gaps, notes };
}

function agentsBlock(manifest) {
  return `${MARK_START}
## Temperance project rail

This repository is registered with **Temperance Engine** as a project rail.
Host runtime (models, OmniRoute, OpenCode plugins) lives under \`~/.temperance_engine\`
and \`~/.config/opencode\`; this repo owns planning and acceptance.

| Concern | Authority |
|---|---|
| Models / failover / budgets | Host OmniRoute + temperance combos |
| Planning spine | \`.planning/\` (GSD) + \`temperance-next-wave\` |
| Acceptance | \`ISA.md\` when present |
| Session loop | \`/gsd:goal\` → \`.temperance/goal.json\` (not a second planner) |
| Handoff (if present) | \`.project/HANDOFF.md\` |
| Parallel execute | \`te-dispatch-paid\` / \`temperance-batch\` |

\`/gsd:*\` binds the mode. A card only on a bare first prompt with no saved session/cwd mode.

### Auto next-wave

When an agent session starts in this cwd, enrich injects \`dispatch: NEXT-WAVE …\`.
The injected next-wave is a proposal only. Do not dispatch until a matching
approval receipt has been atomically claimed by the swarm control ledger.

\`\`\`bash
temperance-next-wave --cwd .
temperance-project-init --cwd . --check
manifest-bridge init --cwd .
manifest-bridge sync --cwd .
temperance-swarm-dispatch --request .planning/swarm-claim.json --dry-run
\`\`\`

Manifest: \`.temperance/project.json\` (schema ${manifest.schema})
${MARK_END}
`;
}

function defaultStateMd(name) {
  return `# Project State

## Project Reference

Repository: \`${name}\`

## Current Position

Phase: bootstrap
Status: Active
Last activity: temperance-project-init

Progress: [░░░░░░░░░░] 0%

## Session Continuity

Resume: run \`temperance-next-wave --cwd .\` and continue open tasks.
`;
}

function defaultPlanningConfig() {
  return {
    mode: "interactive",
    granularity: "coarse",
    workflow: {
      research: false,
      plan_check: true,
      verifier: true,
      auto_advance: false,
    },
    parallelization: {
      enabled: true,
      plan_level: false,
      task_level: true,
      skip_checkpoints: false,
      max_concurrent_agents: 4,
      min_plans_for_parallel: 2,
    },
    temperance: {
      next_wave: true,
      fleet_combo: "te-dispatch-paid",
      host_runtime: "~/.temperance_engine",
    },
  };
}

function ensureAgentsBlock(cwd, manifest, { dryRun, force }) {
  const path = join(cwd, "AGENTS.md");
  const block = agentsBlock(manifest);
  if (!existsSync(path)) {
    if (dryRun) return { path: "AGENTS.md", action: "dry-run-create" };
    writeFileSync(
      path,
      `# Agent operating contract\n\nRepository: \`${manifest.name}\`\n\n${block}\n`,
    );
    return { path: "AGENTS.md", action: "create" };
  }
  const cur = read(path) || "";
  if (cur.includes(MARK_START)) {
    if (!force) return { path: "AGENTS.md", action: "skip-block-present" };
    const next = cur.replace(
      new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`),
      block.trim(),
    );
    if (dryRun) return { path: "AGENTS.md", action: "dry-run-refresh-block" };
    writeFileSync(path, next.endsWith("\n") ? next : next + "\n");
    return { path: "AGENTS.md", action: "refresh-block" };
  }
  if (dryRun) return { path: "AGENTS.md", action: "dry-run-append-block" };
  appendFileSync(path, (cur.endsWith("\n") ? "\n" : "\n\n") + block + "\n");
  return { path: "AGENTS.md", action: "append-block" };
}

function buildManifest(cwd, host, project) {
  const name = basename(cwd);
  return {
    schema: "temperance.project.v1",
    name,
    cwd,
    github: gitRemote(cwd),
    generated_at: new Date().toISOString(),
    host_runtime: {
      temperance_home: TE_HOME,
      opencode: join(HOME, ".config/opencode"),
      omniroute: "http://127.0.0.1:20128",
      proxy: "http://127.0.0.1:20129",
    },
    ownership: {
      models_routing: "host",
      credentials: "host",
      planning: "project",
      acceptance_isa: "project",
      handoff: project.project_packet.present ? "project:.project" : "optional",
    },
    surfaces: {
      planning: ".planning",
      isa: "ISA.md",
      agents: "AGENTS.md",
      next_wave_cli: "temperance-next-wave",
      fleet_combo: "te-dispatch-paid",
      batch: "temperance-batch",
    },
    checks: {
      host_ready: Object.values(host).every((v) => v.present),
      has_planning: project.planning.present,
      has_isa: project.isa.present,
      has_codegraph: project.codegraph.present,
    },
  };
}

function apply(cwd, opts, host, project) {
  const actions = [];
  const teDir = join(cwd, ".temperance");
  const manifest = buildManifest(cwd, host, project);

  if (!opts.dryRun) mkdirSync(teDir, { recursive: true });
  else actions.push({ path: ".temperance/", action: "dry-run-mkdir" });

  // project.json always refresh (manifest is managed)
  const mj = join(teDir, "project.json");
  if (opts.dryRun) actions.push({ path: ".temperance/project.json", action: "dry-run-write" });
  else {
    writeFileSync(mj, JSON.stringify(manifest, null, 2) + "\n");
    actions.push({ path: ".temperance/project.json", action: "write" });
  }

  const readme = `# Temperance project rail

This directory is the **project-side** Temperance packet. It does not replace
the host operator runtime.

## Two layers

| Layer | Location | Owns |
|---|---|---|
| **Host TE** | \`~/.temperance_engine\`, \`~/.config/opencode\`, LaunchAgents | Models, OmniRoute, enrich plugins, budgets, combos |
| **Project rail** | \`.temperance/\`, \`.planning/\`, \`ISA.md\`, \`AGENTS.md\` | What work is next, acceptance, agent contract |

Chat sessions only *feel* like full TE when **both** layers are present for the cwd.

## Commands

\`\`\`bash
temperance-project-init --cwd . --check
temperance-next-wave --cwd .
temperance-next-wave --write-tasks --approval <approval-id>
temperance-swarm-dispatch --request .planning/swarm-claim.json --dry-run
\`\`\`

Never commit OmniRoute API keys, provider tokens, or home absolute secrets here.
`;
  const rr = join(teDir, "README.md");
  if (!existsSync(rr) || opts.force) {
    if (opts.dryRun) actions.push({ path: ".temperance/README.md", action: "dry-run-write" });
    else {
      writeFileSync(rr, readme);
      actions.push({ path: ".temperance/README.md", action: existsSync(rr) ? "write" : "write" });
    }
  } else actions.push({ path: ".temperance/README.md", action: "skip-exists" });

  if (opts.withPlanning && !project.planning.present) {
    const pdir = join(cwd, ".planning");
    if (opts.dryRun) {
      actions.push({ path: ".planning/", action: "dry-run-mkdir" });
    } else {
      mkdirSync(pdir, { recursive: true });
      writeFileSync(join(pdir, "STATE.md"), defaultStateMd(manifest.name));
      writeFileSync(join(pdir, "PROJECT.md"), `# ${manifest.name}\n\nBootstrapped by temperance-project-init.\n`);
      writeFileSync(
        join(pdir, "config.json"),
        JSON.stringify(defaultPlanningConfig(), null, 2) + "\n",
      );
      actions.push({ path: ".planning/{STATE,PROJECT,config}", action: "scaffold" });
    }
  } else if (opts.withPlanning && project.planning.present && !project.planning_config.present) {
    const cfg = join(cwd, ".planning/config.json");
    if (opts.dryRun) actions.push({ path: ".planning/config.json", action: "dry-run-write" });
    else {
      writeFileSync(cfg, JSON.stringify(defaultPlanningConfig(), null, 2) + "\n");
      actions.push({ path: ".planning/config.json", action: "write" });
    }
  }

  if (opts.withAgents) {
    actions.push(ensureAgentsBlock(cwd, manifest, opts));
  }

  // Refresh next-wave state for this cwd
  const nw = spawnSync(
    "node",
    [join(TE_HOME, "router/temperance-next-wave.mjs"), "--cwd", cwd, "--json"],
    { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (nw.status === 0) {
    actions.push({ path: "next-wave", action: "refreshed" });
  } else {
    actions.push({ path: "next-wave", action: "skip-failed", detail: (nw.stderr || "").slice(0, 200) });
  }

  // Register this project with the host-local manifest event plane. The bridge
  // owns host state; this only writes the project-scoped identity packet.
  const manifestBridge = join(TE_HOME, "manifest-bridge/src/cli.ts");
  const mi = spawnSync("bun", [manifestBridge, "init", "--cwd", cwd, "--json"], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (mi.status === 0) {
    actions.push({ path: ".temperance/manifest.json", action: "registered-manifest-project" });
  } else {
    actions.push({ path: ".temperance/manifest.json", action: "skip-manifest-registration", detail: (mi.stderr || "").slice(0, 200) });
  }

  return { manifest, actions };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: temperance-project-init [--cwd DIR] [--check] [--dry-run] [--force] [--json]
  --check       doctor only (no writes)
  --dry-run     show actions without writing
  --force       refresh managed TE blocks / README
  --no-agents   do not touch AGENTS.md
  --no-planning do not scaffold .planning
`);
    process.exit(0);
  }

  const cwd = resolve(opts.cwd);
  if (!isDir(cwd)) {
    console.error(`not a directory: ${cwd}`);
    process.exit(2);
  }

  const host = hostChecks();
  const project = projectChecks(cwd);
  const live = liveProbes(cwd);
  const { gaps, notes } = classifyGaps(host, project);
  if (live.gsd_state.complete) {
    notes.push({
      id: "note:gsd-complete",
      message: `GSD STATE is Complete. Next command is /gsd:complete-milestone — do not /gsd:execute-phase.`,
    });
  }
  if (live.ranking.stale) {
    gaps.push({
      id: "host:ranker-stale",
      severity: "medium",
      message: "Paid-fleet ranking is older than 6h or missing.",
      fix: "python3 ~/.agents/skills/temperance-parallel-dispatch/scripts/rank-paid-fleet.py --refresh-codexbar --apply-combo",
    });
  }
  if (!live.product_is_live) {
    gaps.push({
      id: "host:product-archive",
      severity: "high",
      message: `product symlink is not the live repo (${live.product_symlink})`,
      fix: "ln -sfn <this-clone> ~/.temperance_engine/product  (or ./install.sh --with-spine)",
    });
  }
  if (!live.active_planner) {
    notes.push({
      id: "note:active-planner",
      message: "No active_planner in .temperance/project.json — set isa or gsd so Manifest/GSD do not fight.",
    });
  }

  let applyResult = null;
  if (!opts.check) {
    applyResult = apply(cwd, opts, host, project);
    // re-check after apply
  }
  const projectAfter = projectChecks(cwd);
  const gapsAfter = opts.check ? gaps : classifyGaps(host, projectAfter).gaps;

  const report = {
    schema: "temperance.project-doctor.v1",
    cwd,
    mode: opts.check ? "check" : opts.dryRun ? "dry-run" : "apply",
    host,
    project: opts.check ? project : projectAfter,
    gaps: gapsAfter,
    notes,
    actions: applyResult?.actions || [],
    manifest: applyResult?.manifest || null,
    live,
    summary: {
      host_ready: Object.values(host).every((v) => v.present),
      project_rail: (opts.check ? project : projectAfter).temperance_project.present,
      high_gaps: gapsAfter.filter((g) => g.severity === "high").length,
      medium_gaps: gapsAfter.filter((g) => g.severity === "medium").length,
      omniroute_bind: live.omniroute.bind,
      iab: live.iab,
      active_planner: live.active_planner,
      gsd_next: live.gsd_state.next,
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Temperance project ${report.mode}: ${cwd}`);
    console.log("");
    console.log("HOST");
    for (const [k, v] of Object.entries(host)) {
      console.log(`  ${v.present ? "OK " : "MISS"} ${k}`);
    }
    console.log("");
    console.log("PROJECT");
    for (const [k, v] of Object.entries(report.project)) {
      if (typeof v.present === "boolean") {
        console.log(`  ${v.present ? "OK " : "MISS"} ${k}${v.path ? ` (${v.path})` : ""}`);
      }
    }
    if (report.actions.length) {
      console.log("");
      console.log("ACTIONS");
      for (const a of report.actions) {
        console.log(`  ${a.action.padEnd(22)} ${a.path}`);
      }
    }
    if (gapsAfter.length) {
      console.log("");
      console.log("GAPS");
      for (const g of gapsAfter) {
        console.log(`  [${g.severity}] ${g.id}: ${g.message}`);
        console.log(`           fix: ${g.fix}`);
      }
    } else {
      console.log("");
      console.log("GAPS: none (project rail healthy for TE workflows)");
    }
    if (notes.length) {
      console.log("");
      console.log("NOTES");
      for (const n of notes) console.log(`  - ${n.message}`);
    }
    console.log("");
    console.log("LIVE");
    console.log(`  Pulse     ${live.pulse.ok ? "OK" : "DOWN"} ${live.pulse.url}`);
    console.log(`  Voice     ${live.voice.ok ? "UP" : "DOWN"} ${live.voice.url} (TTS not proven)`);
    console.log(`  Bridge    ${live.bridge.ok ? "OK" : "DOWN"} ${live.bridge.url}`);
    console.log(`  OmniRoute bind ${live.omniroute.bind} edge=${live.omniroute.edge}`);
    console.log(`  IAB       ${live.iab}`);
    console.log(`  Planner   ${live.active_planner || "unset"}`);
    console.log(`  GSD       ${live.gsd_state.status || "unknown"} next=${live.gsd_state.next}`);
    console.log(`  Ranker    ${live.ranking.stale ? "STALE" : "FRESH"} ${live.ranking.generated_at || "missing"}`);
  }

  const high = gapsAfter.filter((g) => g.severity === "high").length;
  process.exit(high > 0 && opts.check ? 1 : 0);
}

main();
