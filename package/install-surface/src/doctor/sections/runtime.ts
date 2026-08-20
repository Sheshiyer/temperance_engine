import type { DoctorCheck, DoctorContext, DoctorSection } from "../model.ts";

async function endpointCheck(
  context: DoctorContext,
  id: string,
  url: string,
  accepts: (response: Response) => boolean,
): Promise<DoctorCheck> {
  try {
    const response = await context.io.fetch(url, { signal: context.signal });
    const ready = accepts(response);
    return {
      id,
      source: `runtime:${id}`,
      destination: url.replace(/:\/\/[^/]+/u, "://loopback"),
      class: "RUNTIME",
      expected_state: "reachable typed endpoint",
      actual_state: ready ? `reachable:${response.status}` : `unexpected:${response.status}`,
      condition: ready ? "PASS" : "WARN",
      reason_code: ready ? "RUNTIME_ENDPOINT_READY" : "RUNTIME_ENDPOINT_UNEXPECTED",
      severity: ready ? "info" : "warning",
      actionable: !ready,
      remediation: ready ? "None." : "Inspect the component-specific runtime doctor.",
      evidence: [`status:${response.status}`],
    };
  } catch {
    return {
      id,
      source: `runtime:${id}`,
      destination: "runtime:loopback",
      class: "RUNTIME",
      expected_state: "reachable typed endpoint",
      actual_state: "offline",
      condition: "WARN",
      reason_code: "RUNTIME_ENDPOINT_OFFLINE",
      severity: "warning",
      actionable: true,
      remediation: "Start or diagnose the optional runtime component.",
      evidence: [],
    };
  }
}

export async function runRuntimeSection(context: DoctorContext): Promise<DoctorSection> {
  const checks = await Promise.all([
    endpointCheck(context, "manifest-bridge", `${context.runtimeUrls.bridge.replace(/\/$/u, "")}/health`, (response) => response.ok),
    endpointCheck(context, "omniroute", `${context.runtimeUrls.omniroute.replace(/\/$/u, "")}/api/status`, (response) => response.ok || response.status === 401),
  ]);
  if (context.platform !== "darwin") {
    checks.push({
      id: "manifest-launchd",
      source: "runtime:service-manager",
      destination: "runtime:manifest-bridge",
      class: "RUNTIME",
      expected_state: "platform service capability",
      actual_state: `unsupported:${context.platform}`,
      condition: "UNSUPPORTED",
      reason_code: "LAUNCHD_UNSUPPORTED",
      severity: "info",
      actionable: false,
      remediation: "Use the supported service manager for this platform.",
      evidence: [],
    });
  } else {
    try {
      await context.io.execFile("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/com.temperance.engine.manifest-bridge`], { signal: context.signal });
      checks.push({ id: "manifest-launchd", source: "runtime:service-manager", destination: "runtime:manifest-bridge", class: "RUNTIME", expected_state: "loaded", actual_state: "loaded", condition: "PASS", reason_code: "LAUNCHD_READY", severity: "info", actionable: false, remediation: "None.", evidence: [] });
    } catch {
      checks.push({ id: "manifest-launchd", source: "runtime:service-manager", destination: "runtime:manifest-bridge", class: "RUNTIME", expected_state: "loaded", actual_state: "unavailable", condition: "WARN", reason_code: "LAUNCHD_UNAVAILABLE", severity: "warning", actionable: true, remediation: "Inspect the component-specific runtime doctor.", evidence: [] });
    }
  }
  checks.sort((left, right) => left.id.localeCompare(right.id));
  const condition = checks.some((check) => check.condition === "WARN") ? "WARN" : "PASS";
  return { id: "runtime", condition, checks };
}
