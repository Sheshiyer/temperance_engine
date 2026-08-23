import type { DoctorCheck, DoctorCondition, DoctorSection } from "../../types.ts";
import type { DoctorContextV2, V2_SectionRunner } from "../model.ts";
import { V2_SECTION_RUNNERS } from "../model.ts";

const MANIFEST_CHECK_IDS = [
  "event-log",
  "activation-policy",
  "active-runs",
  "project-registry",
  "prompt-hooks",
  "bridge-source",
  "bridge-launchd",
  "console-launchd",
  "state-root",
  "bridge-health",
  "omniroute",
  "console-health",
] as const;

type ManifestCheckId = (typeof MANIFEST_CHECK_IDS)[number];

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
  id: ManifestCheckId,
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
    source: "manifest",
    destination: "$STATE_ROOT",
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

async function checkStateRoot(context: DoctorContextV2): Promise<DoctorCheck> {
  try {
    await context.io.lstat(context.stateRoot);
    return makeCheck("state-root", "PASS", "state root readable", "state root readable", "state_root_present", "No action needed.", [context.stateRoot], context);
  } catch {
    return makeCheck("state-root", "FAIL", "state root readable", "state root missing", "state_root_missing", "Create the manifest state root directory.", [context.stateRoot], context);
  }
}

async function checkEventLog(context: DoctorContextV2): Promise<DoctorCheck> {
  const eventFile = join(context.stateRoot, "events.jsonl");
  try {
    const content = await context.io.readFile(eventFile);
    const lines = content.split("\n").filter((l) => l.trim());
    let malformed = 0;
    for (const line of lines) {
      try { JSON.parse(line); } catch { malformed++; }
    }
    if (malformed > 0) {
      return makeCheck("event-log", "FAIL", "event log valid", `${malformed} malformed entries`, "event_log_malformed", "Repair or remove malformed event log entries.", [eventFile], context);
    }
    return makeCheck("event-log", "PASS", "event log valid", `${lines.length} valid entries`, "event_log_ok", "No action needed.", [eventFile], context);
  } catch {
    return makeCheck("event-log", "WARN", "event log exists", "event log missing", "event_log_missing", "Event log will be created on first event.", [eventFile], context);
  }
}

async function checkActivationPolicy(context: DoctorContextV2): Promise<DoctorCheck> {
  const policyFile = join(context.stateRoot, "activation-policy.json");
  try {
    const content = await context.io.readFile(policyFile);
    const policy = JSON.parse(content) as Record<string, unknown>;
    if (typeof policy.enabled !== "boolean") {
      return makeCheck("activation-policy", "FAIL", "activation policy valid", "activation policy malformed", "activation_policy_malformed", "Repair the activation policy file.", [policyFile], context);
    }
    const condition: DoctorCondition = policy.enabled ? "PASS" : "WARN";
    return makeCheck("activation-policy", condition, "activation policy enabled", policy.enabled ? "enabled" : "disabled", policy.enabled ? "activation_policy_enabled" : "activation_policy_disabled", policy.enabled ? "No action needed." : "Enable the activation policy if intended.", [policyFile], context);
  } catch {
    return makeCheck("activation-policy", "WARN", "activation policy exists", "activation policy missing", "activation_policy_missing", "Activation policy will be created on first activation.", [policyFile], context);
  }
}

async function checkActiveRuns(context: DoctorContextV2): Promise<DoctorCheck> {
  const runsDir = join(context.stateRoot, "active-runs");
  try {
    const stat = await context.io.lstat(runsDir);
    if (!stat.isDirectory()) {
      return makeCheck("active-runs", "WARN", "active-runs directory", "not a directory", "active_runs_not_dir", "Remove the file and let the system recreate it as a directory.", [runsDir], context);
    }
    return makeCheck("active-runs", "PASS", "active-runs directory", "directory exists", "active_runs_ok", "No action needed.", [runsDir], context);
  } catch {
    return makeCheck("active-runs", "WARN", "active-runs directory", "directory missing", "active_runs_missing", "Active runs directory will be created when needed.", [runsDir], context);
  }
}

async function checkProjectRegistry(context: DoctorContextV2): Promise<DoctorCheck> {
  const registryFile = join(context.stateRoot, "projects.json");
  try {
    const content = await context.io.readFile(registryFile);
    const records = JSON.parse(content);
    if (!Array.isArray(records)) {
      return makeCheck("project-registry", "FAIL", "project registry valid", "not an array", "project_registry_malformed", "Repair the project registry file.", [registryFile], context);
    }
    return makeCheck("project-registry", "PASS", "project registry valid", `${records.length} projects`, "project_registry_ok", "No action needed.", [registryFile], context);
  } catch {
    return makeCheck("project-registry", "WARN", "project registry exists", "project registry missing", "project_registry_missing", "Project registry will be created on first project.", [registryFile], context);
  }
}

async function checkPromptHooks(context: DoctorContextV2): Promise<DoctorCheck> {
  const home = process.env.HOME || "";
  const hookPaths = [
    join(home, ".claude", "hooks", "PromptProcessing.hook.ts"),
    join(home, ".codex", "hooks", "PromptProcessing.hook.ts"),
  ];
  let found = 0;
  for (const path of hookPaths) {
    try {
      const content = await context.io.readFile(path);
      if (content.includes("manifestRuntimeReceipt")) found++;
    } catch { /* hook not present */ }
  }
  const condition: DoctorCondition = found > 0 ? "PASS" : "WARN";
  return makeCheck("prompt-hooks", condition, "prompt hooks installed", found > 0 ? `${found} hook(s)` : "no hooks", found > 0 ? "prompt_hooks_ok" : "prompt_hooks_missing", found > 0 ? "No action needed." : "Install PromptProcessing hooks for manifest runtime receipts.", hookPaths, context);
}

async function checkBridgeSource(context: DoctorContextV2): Promise<DoctorCheck> {
  const plistPath = join(process.env.HOME || "", "Library", "LaunchAgents", "com.temperance.engine.manifest-bridge.plist");
  try {
    const content = await context.io.readFile(plistPath);
    const hasSource = content.includes("manifest-bridge");
    const condition: DoctorCondition = hasSource ? "PASS" : "FAIL";
    return makeCheck("bridge-source", condition, "bridge plist references source", hasSource ? "references bridge" : "missing reference", hasSource ? "bridge_source_ok" : "bridge_source_mismatch", hasSource ? "No action needed." : "Reinstall the manifest bridge LaunchAgent.", [plistPath], context);
  } catch {
    return makeCheck("bridge-source", "WARN", "bridge plist exists", "plist missing", "bridge_source_missing", "Install the manifest bridge LaunchAgent.", [plistPath], context);
  }
}

async function checkLaunchd(context: DoctorContextV2, id: "bridge-launchd" | "console-launchd", label: string): Promise<DoctorCheck> {
  if (context.platform !== "darwin") {
    return makeCheck(id, "WARN", "launchd available", "not macOS", "launchd_not_macos", "launchd checks are macOS-only.", [], context);
  }
  try {
    await context.io.execFile("launchctl", ["print", `gui/${process.getuid?.() || 0}/${label}`], { signal: AbortSignal.timeout(700) });
    return makeCheck(id, "PASS", "launchd label loaded", "label loaded", "launchd_loaded", "No action needed.", [], context);
  } catch {
    return makeCheck(id, "WARN", "launchd label loaded", "label not loaded", "launchd_not_loaded", `Load the ${label} LaunchAgent.`, [], context);
  }
}

async function checkBridgeHealth(context: DoctorContextV2): Promise<DoctorCheck> {
  const url = context.runtimeUrls.bridge;
  try {
    const response = await context.io.fetch(url, { signal: AbortSignal.timeout(500) });
    const ok = response.ok;
    const condition: DoctorCondition = ok ? "PASS" : "FAIL";
    return makeCheck("bridge-health", condition, "bridge healthy", ok ? "healthy" : `status ${response.status}`, ok ? "bridge_health_ok" : "bridge_health_fail", ok ? "No action needed." : "Restart the manifest bridge.", [url], context);
  } catch {
    return makeCheck("bridge-health", "FAIL", "bridge healthy", "unreachable", "bridge_health_unreachable", "Start the manifest bridge.", [url], context);
  }
}

async function checkOmniroute(context: DoctorContextV2): Promise<DoctorCheck> {
  const url = context.runtimeUrls.omniroute;
  try {
    const response = await context.io.fetch(url, { signal: AbortSignal.timeout(500) });
    const ok = response.ok;
    const condition: DoctorCondition = ok ? "PASS" : "WARN";
    return makeCheck("omniroute", condition, "omniroute healthy", ok ? "healthy" : `status ${response.status}`, ok ? "omniroute_ok" : "omniroute_warn", ok ? "No action needed." : "Check the OmniRoute gateway.", [url], context);
  } catch {
    return makeCheck("omniroute", "WARN", "omniroute healthy", "unreachable", "omniroute_unreachable", "Start the OmniRoute gateway.", [url], context);
  }
}

async function checkConsoleHealth(context: DoctorContextV2): Promise<DoctorCheck> {
  const url = context.runtimeUrls.console || "http://127.0.0.1:5173";
  try {
    const response = await context.io.fetch(url, { signal: AbortSignal.timeout(500) });
    const html = await response.text();
    const ready = response.ok && html.includes("<div id=\"root\">");
    const condition: DoctorCondition = ready ? "PASS" : "FAIL";
    return makeCheck("console-health", condition, "console healthy", ready ? "healthy" : "invalid response", ready ? "console_health_ok" : "console_health_fail", ready ? "No action needed." : "Restart the manifest console.", [url], context);
  } catch {
    return makeCheck("console-health", "FAIL", "console healthy", "unreachable", "console_health_unreachable", "Start the manifest console.", [url], context);
  }
}

function sectionCondition(checks: DoctorCheck[]): DoctorCondition {
  if (checks.some((c) => c.condition === "FAIL")) return "FAIL";
  if (checks.some((c) => c.condition === "WARN")) return "WARN";
  if (checks.some((c) => c.condition === "DRIFT")) return "DRIFT";
  return "PASS";
}

export const runManifestSection: V2_SectionRunner = async (context: DoctorContextV2): Promise<DoctorSection> => {
  const checks: DoctorCheck[] = [];

  checks.push(await checkStateRoot(context));
  checks.push(await checkEventLog(context));
  checks.push(await checkActivationPolicy(context));
  checks.push(await checkActiveRuns(context));
  checks.push(await checkProjectRegistry(context));
  checks.push(await checkPromptHooks(context));
  checks.push(await checkBridgeSource(context));
  checks.push(await checkLaunchd(context, "bridge-launchd", "com.temperance.engine.manifest-bridge"));
  checks.push(await checkLaunchd(context, "console-launchd", "com.temperance.engine.manifest-console"));
  checks.push(await checkBridgeHealth(context));
  checks.push(await checkOmniroute(context));
  checks.push(await checkConsoleHealth(context));

  return {
    id: "manifest",
    condition: sectionCondition(checks),
    checks,
  };
};

V2_SECTION_RUNNERS.manifest = runManifestSection;

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}
