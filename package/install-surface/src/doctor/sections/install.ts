import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { loadLock } from "../../load.ts";
import type { SurfaceRecord } from "../../types.ts";
import type { DoctorCheck, DoctorContext, DoctorSection } from "../model.ts";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function publicDestination(record: SurfaceRecord): string {
  return `${record.destination.root_token}:${record.destination.relative_path}`;
}

function destinationPath(record: SurfaceRecord, context: DoctorContext): string {
  const root = context.rootBindings[record.destination.root_token];
  if (!root || !isAbsolute(root)) throw new Error("DOCTOR_ROOT_BINDING_INVALID");
  const candidate = resolve(root, record.destination.relative_path);
  const rel = relative(resolve(root), candidate);
  if (rel === "" || rel === ".." || rel.split(sep).some((segment) => segment === "..") || isAbsolute(rel)) {
    throw new Error("DOCTOR_DESTINATION_ESCAPE");
  }
  return candidate;
}

function checkBase(record: SurfaceRecord): Omit<DoctorCheck, "expected_state" | "actual_state" | "condition" | "reason_code" | "severity" | "actionable" | "remediation" | "evidence"> {
  return {
    id: record.id,
    source: "source" in record ? record.source : `symbolic:${record.id}`,
    destination: record.class === "NEVER-SHIP" ? `symbolic:${record.id}` : publicDestination(record),
    class: record.class,
  };
}

function result(
  record: SurfaceRecord,
  values: Pick<DoctorCheck, "expected_state" | "actual_state" | "condition" | "reason_code" | "severity" | "actionable" | "remediation" | "evidence">,
): DoctorCheck {
  return { ...checkBase(record), ...values };
}

async function observeRecord(record: SurfaceRecord, context: DoctorContext): Promise<DoctorCheck> {
  if (!record.eligibility.platforms.some((platform) => platform === context.platform)) {
    return result(record, {
      expected_state: "eligible platform",
      actual_state: `unsupported:${context.platform}`,
      condition: "UNSUPPORTED",
      reason_code: "PLATFORM_UNSUPPORTED",
      severity: "info",
      actionable: false,
      remediation: "Run this check on a declared supported platform.",
      evidence: [],
    });
  }

  if (record.class === "NEVER-SHIP") {
    return result(record, {
      expected_state: "symbolically excluded",
      actual_state: "symbolically excluded",
      condition: "PASS",
      reason_code: "NEVER_SHIP_SYMBOLIC",
      severity: "info",
      actionable: false,
      remediation: "None; preserve the private boundary.",
      evidence: [record.verification.method],
    });
  }

  if (record.class === "REGENERATE") {
    if (!record.eligibility.required) {
      return result(record, {
        expected_state: "regenerable on demand",
        actual_state: "optional semantic probe skipped",
        condition: "SKIPPED",
        reason_code: "OPTIONAL_REGENERATE_SKIPPED",
        severity: "info",
        actionable: false,
        remediation: "Run the governed generator when this optional surface is enabled.",
        evidence: [record.verification.generator_id],
      });
    }
    try {
      await context.io.lstat(destinationPath(record, context));
      return result(record, {
        expected_state: "generated surface present",
        actual_state: "present",
        condition: "PASS",
        reason_code: "SEMANTIC_PROBE_PRESENT",
        severity: "info",
        actionable: false,
        remediation: "None.",
        evidence: [record.verification.generator_id],
      });
    } catch {
      return result(record, {
        expected_state: "generated surface present",
        actual_state: "missing",
        condition: "FAIL",
        reason_code: "SEMANTIC_PROBE_MISSING",
        severity: "error",
        actionable: true,
        remediation: "Run the governed generator command.",
        evidence: [record.verification.generator_id],
      });
    }
  }

  try {
    const source = await context.io.readFile(resolve(context.repositoryRoot, record.source));
    const observed = await context.io.readFile(destinationPath(record, context));
    const expectedDigest = digest(source);
    const actualDigest = digest(observed);
    const matches = expectedDigest === actualDigest;
    return result(record, {
      expected_state: expectedDigest,
      actual_state: actualDigest,
      condition: matches ? "PASS" : "DRIFT",
      reason_code: record.class === "COPY"
        ? (matches ? "COPY_DIGEST_MATCH" : "COPY_DIGEST_DRIFT")
        : (matches ? "TRANSFORM_ADAPTER_MATCH" : "TRANSFORM_ADAPTER_DRIFT"),
      severity: matches ? "info" : "warning",
      actionable: !matches,
      remediation: matches ? "None." : "Run the governed lifecycle update after reviewing the source change.",
      evidence: [record.verification.method],
    });
  } catch {
    return result(record, {
      expected_state: record.class === "COPY" ? "matching source bytes" : "matching in-memory adapter output",
      actual_state: "unavailable",
      condition: record.eligibility.required ? "FAIL" : "SKIPPED",
      reason_code: record.eligibility.required ? "REQUIRED_SURFACE_UNAVAILABLE" : "OPTIONAL_SURFACE_SKIPPED",
      severity: record.eligibility.required ? "error" : "info",
      actionable: record.eligibility.required,
      remediation: record.eligibility.required ? "Run the governed installer or restore the reviewed surface." : "Enable the optional surface before checking it.",
      evidence: [record.verification.method],
    });
  }
}

function sectionCondition(checks: readonly DoctorCheck[]): DoctorSection["condition"] {
  for (const condition of ["FAIL", "DRIFT", "WARN", "UNAVAILABLE"] as const) {
    if (checks.some((check) => check.condition === condition)) return condition;
  }
  return "PASS";
}

export async function runInstallSection(context: DoctorContext): Promise<DoctorSection> {
  const lockPath = resolve(context.repositoryRoot, "package/install-surface/install-surface-manifest.lock.json");
  const lock = loadLock(lockPath);
  const checks = await Promise.all(lock.lockObject.records.map((record) => observeRecord(record, context)));
  checks.sort((left, right) => left.id.localeCompare(right.id));
  return { id: "install", condition: sectionCondition(checks), checks };
}
