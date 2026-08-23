/**
 * Host section — portable probes only.
 *
 * EXCLUDED (private — stay host-side per spec §3.4):
 * - sqlite combo lookups
 * - personal session stores
 * - speculum/statusline personal-state checks
 *
 * These exclusions are intentional: private probes expose operator-specific
 * state that must not enter public doctor reports. The host-side surface-doctor
 * (~/.temperance_engine/router/temperance-surface-doctor.mjs) retains the
 * private half and will be slimmed in a follow-up wave (checker M7).
 */

import type { DoctorCheck, DoctorCondition, DoctorSection } from "../../types.ts";
import type { DoctorContextV2, V2_SectionRunner } from "../model.ts";
import { V2_SECTION_RUNNERS } from "../model.ts";

const HOST_CHECK_IDS = [
  "console-health",
  "auto-proxy-health",
  "pulse-health",
  "bridge-launchd",
  "console-launchd",
  "opencode-config",
  "skill-index",
] as const;

type HostCheckId = (typeof HOST_CHECK_IDS)[number];

function symbolizeEvidence(evidence: string[], context: DoctorContextV2): string[] {
  return evidence.map((e) => {
    let s = e;
    if (context.repositoryRoot && s.startsWith(context.repositoryRoot)) {
      s = "$REPO_ROOT" + s.slice(context.repositoryRoot.length);
    }
    if (context.stateRoot && s.startsWith(context.stateRoot)) {
      s = "$STATE_ROOT" + s.slice(context.stateRoot.length);
    }
    const home = process.env.HOME || "";
    if (home && s.startsWith(home)) {
      s = "$HOME" + s.slice(home.length);
    }
    return s;
  });
}

function makeCheck(
  id: HostCheckId,
  condition: DoctorCondition,
  expected: string,
  actual: string,
  reasonCode: string,
  remediation: string,
  evidence: string[],
  context: DoctorContextV2,
): DoctorCheck {
  return {
    id,
    source: "host",
    destination: "$RUNTIME_URL",
    class: "RUNTIME",
    expected_state: expected,
    actual_state: actual,
    condition,
    reason_code: reasonCode,
    severity: condition === "FAIL" ? "error" : condition === "WARN" ? "warning" : "info",
    actionable: condition !== "PASS",
    remediation,
    evidence: symbolizeEvidence(evidence, context),
  };
}

async function checkHttpHealth(context: DoctorContextV2, id: HostCheckId, url: string, label: string): Promise<DoctorCheck> {
  try {
    const response = await context.io.fetch(url, { signal: AbortSignal.timeout(500) });
    const ok = response.ok;
    const condition: DoctorCondition = ok ? "PASS" : "FAIL";
    return makeCheck(id, condition, `${label} healthy`, ok ? "healthy" : `status ${response.status}`, ok ? `${id}_ok` : `${id}_fail`, ok ? "No action needed." : `Restart the ${label} service.`, [url], context);
  } catch {
    return makeCheck(id, "FAIL", `${label} healthy`, "unreachable", `${id}_unreachable`, `Start the ${label} service.`, [url], context);
  }
}

async function checkLaunchd(context: DoctorContextV2, id: "bridge-launchd" | "console-launchd", label: string): Promise<DoctorCheck> {
  if (context.platform !== "darwin") {
    return makeCheck(id, "UNSUPPORTED", "launchd available", "not macOS", "launchd_not_macos", "launchd checks are macOS-only.", [], context);
  }
  try {
    await context.io.execFile("launchctl", ["print", `gui/${process.getuid?.() || 0}/${label}`], { signal: AbortSignal.timeout(700) });
    return makeCheck(id, "PASS", "launchd label loaded", "label loaded", "launchd_loaded", "No action needed.", [], context);
  } catch {
    return makeCheck(id, "WARN", "launchd label loaded", "label not loaded", "launchd_not_loaded", `Load the ${label} LaunchAgent.`, [], context);
  }
}

async function checkOpencodeConfig(context: DoctorContextV2): Promise<DoctorCheck> {
  const home = process.env.HOME || "";
  const configPath = `${home}/.config/opencode/config.json`;
  try {
    const content = await context.io.readFile(configPath);
    JSON.parse(content);
    return makeCheck("opencode-config", "PASS", "opencode config parseable", "parseable", "opencode_config_ok", "No action needed.", [configPath], context);
  } catch {
    return makeCheck("opencode-config", "SKIPPED", "opencode config exists", "not found or unparseable", "opencode_config_missing", "Create opencode config if using opencode.", [configPath], context);
  }
}

async function checkSkillIndex(context: DoctorContextV2): Promise<DoctorCheck> {
  const home = process.env.HOME || "";
  const indexPath = `${home}/.agents/skill-index.json`;
  try {
    const content = await context.io.readFile(indexPath);
    JSON.parse(content);
    return makeCheck("skill-index", "PASS", "skill-index parseable", "parseable", "skill_index_ok", "No action needed.", [indexPath], context);
  } catch {
    return makeCheck("skill-index", "WARN", "skill-index exists", "not found or unparseable", "skill_index_missing", "Initialize the skill-index.", [indexPath], context);
  }
}

function sectionCondition(checks: DoctorCheck[]): DoctorCondition {
  if (checks.some((c) => c.condition === "FAIL")) return "FAIL";
  if (checks.some((c) => c.condition === "WARN")) return "WARN";
  if (checks.some((c) => c.condition === "DRIFT")) return "DRIFT";
  return "PASS";
}

export const runHostSection: V2_SectionRunner = async (context: DoctorContextV2): Promise<DoctorSection> => {
  const checks: DoctorCheck[] = [];

  checks.push(await checkHttpHealth(context, "console-health", context.runtimeUrls.console, "console"));
  checks.push(await checkHttpHealth(context, "auto-proxy-health", context.runtimeUrls.auto_proxy, "auto-proxy"));
  checks.push(await checkHttpHealth(context, "pulse-health", context.runtimeUrls.pulse, "pulse"));
  checks.push(await checkLaunchd(context, "bridge-launchd", "com.temperance.engine.manifest-bridge"));
  checks.push(await checkLaunchd(context, "console-launchd", "com.temperance.engine.manifest-console"));
  checks.push(await checkOpencodeConfig(context));
  checks.push(await checkSkillIndex(context));

  return {
    id: "host",
    condition: sectionCondition(checks),
    checks,
  };
};

V2_SECTION_RUNNERS.host = runHostSection;
