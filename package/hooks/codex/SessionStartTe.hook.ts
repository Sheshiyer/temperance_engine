#!/usr/bin/env bun
/**
 * SessionStart: GSD default hint, ranker freshness, config-layer doctor line.
 * Fail-open. Does not mutate fleets or open browsers.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function rankerAgeHours(): number | null {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".temperance_engine", "state", "paid-fleet-ranking.json"), "utf8"));
    const t = Date.parse(String(raw.generated_at || ""));
    if (!Number.isFinite(t)) return null;
    return (Date.now() - t) / 36e5;
  } catch {
    return null;
  }
}

function iabPref(): string {
  try {
    const toml = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    const m = toml.match(/open-local-url-in-target-preference\s*=\s*"([^"]+)"/);
    return m?.[1] || "unset";
  } catch {
    return "unread";
  }
}

function main() {
  const cwd = process.cwd();
  const planning = existsSync(join(cwd, ".planning"));
  const isa = existsSync(join(cwd, "ISA.md"));
  const projectToml = existsSync(join(cwd, ".codex", "config.toml"));
  const projectName = cwd.split("/").filter(Boolean).pop() || "cwd";
  const hours = rankerAgeHours();
  const lines = [
    "<te-session-start>",
    `☿ HOST · User config ~/.codex/config.toml · project layer ${projectToml ? `present (${projectName})` : "absent"}`,
    `  ·  iab        ${iabPref()} (/gsd:* already bound — card only on a bare first prompt; then ChatGPT IAB only)`,
    `  ·  admin      /etc/codex absent — do not use Admin`,
    planning
      ? "  ·  gsd        .planning/ present — prefer /gsd:progress then the next /gsd:* on STATE"
      : "  ·  gsd        no .planning/ — GSD wrappers idle; Algorithm is freeform",
    isa ? "  ·  isa        ISA.md present (acceptance SoR when active_planner=isa)" : "  ·  isa        no ISA.md",
    hours === null
      ? "  ·  fleet      paid-fleet ranking missing — run rank-paid-fleet.py before Execute"
      : hours > 6
        ? `  ·  fleet      ranking ${hours.toFixed(1)}h stale — refresh before te-dispatch-paid`
        : `  ·  fleet      ranking ${hours.toFixed(1)}h old`,
    "  ·  doctor     /gsd:doctor or temperance-project-init --check",
  ];
  try {
    const g = JSON.parse(readFileSync(join(cwd, ".temperance", "goal.json"), "utf8"));
    if (g.status === "active" && g.text) {
      lines.splice(-1, 0, `  ·  goal      ACTIVE — finish: ${String(g.text).slice(0, 140)}`);
      lines.splice(-1, 0, `  ·  goal-next /gsd:${g.gsd_command || "progress"} then temperance-goal --eval`);
    }
  } catch { /* no goal */ }
  lines.push("</te-session-start>");
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  }));
}

main();
