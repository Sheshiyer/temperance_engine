import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { loadLock } from "../../load.ts";
import type { SurfaceRecord } from "../../types.ts";
import type { DoctorCheck, DoctorContext, DoctorSection } from "../model.ts";

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

type CopyRecord = Extract<SurfaceRecord, { class: "COPY" }>;

/** Walk below the bound root with lstat; never follow a destination symlink. */
async function safeDestination(record: CopyRecord, context: DoctorContext): Promise<string> {
  const destination = destinationPath(record, context);
  const root = resolve(context.rootBindings[record.destination.root_token]);
  const rootStat = await context.io.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("COPY_DESTINATION_UNSAFE");
  let cursor = root;
  const segments = relative(root, destination).split(sep);
  for (const [index, segment] of segments.entries()) {
    context.signal.throwIfAborted();
    cursor = resolve(cursor, segment);
    const stat = await context.io.lstat(cursor);
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      throw new Error("COPY_DESTINATION_UNSAFE");
    }
  }
  return destination;
}

async function observeCopy(record: CopyRecord, context: DoctorContext): Promise<DoctorCheck> {
  const expected = record.verification.expected;
  if (!expected || (expected.kind === "file" ? !expected.mode : !expected.modes
    || Object.keys(expected.files).some((leaf) => !expected.modes?.[leaf])
    || Object.keys(expected.modes).length !== Object.keys(expected.files).length)) {
    return result(record, {
      expected_state: "reviewed content and mode declaration", actual_state: "undeclared",
      condition: "WARN", reason_code: "COPY_EXPECTATION_UNDECLARED", severity: "warning", actionable: true,
      remediation: "Generate and review the committed-source COPY declaration before installation.", evidence: ["sha256"],
    });
  }
  const expectedState = expected.kind === "file" ? `${expected.sha256};mode:${expected.mode}` : `reviewed tree:${Object.keys(expected.files).length} leaves`;
  const observedResult = (code: string, state: string): DoctorCheck => result(record, {
    expected_state: expectedState, actual_state: state, condition: code === "COPY_DECLARATION_MATCH" ? "PASS" : "DRIFT",
    reason_code: code, severity: code === "COPY_DECLARATION_MATCH" ? "info" : "warning", actionable: code !== "COPY_DECLARATION_MATCH",
    remediation: code === "COPY_DECLARATION_MATCH" ? "None." : "Review destination drift before running the governed lifecycle update.", evidence: ["sha256", "regular-file-mode"],
  });
  try {
    const destination = await safeDestination(record, context);
    const files: Record<string, string> = expected.kind === "file" ? { "": expected.sha256 } : expected.files;
    const modes = expected.kind === "file" ? { "": expected.mode! } : expected.modes!;
    const actualLeaves: string[] = [];
    const visit = async (path: string, rel: string): Promise<void> => {
      context.signal.throwIfAborted();
      const stat = await context.io.lstat(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) {
        throw new Error("COPY_DESTINATION_UNSAFE");
      }
      if (stat.isFile()) { actualLeaves.push(rel); return; }
      for (const name of (await context.io.readdir(path)).sort()) {
        if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new Error("COPY_DESTINATION_UNSAFE");
        await visit(resolve(path, name), rel ? `${rel}/${name}` : name);
      }
    };
    const destinationStat = await context.io.lstat(destination);
    if ((expected.kind === "file" && !destinationStat.isFile()) || (expected.kind === "tree" && !destinationStat.isDirectory())) {
      return observedResult("COPY_TYPE_DRIFT", "destination type mismatch");
    }
    await visit(destination, "");
    const keys = Object.keys(files).sort();
    if (JSON.stringify(actualLeaves.sort()) !== JSON.stringify(keys)) return observedResult("COPY_LEAF_SET_DRIFT", "destination leaf inventory differs");
    // Only declared leaves are read, and bytes are hashed without UTF-8 replacement.
    for (const leaf of keys) {
      context.signal.throwIfAborted();
      const path = leaf ? resolve(destination, leaf) : destination;
      const stat = await context.io.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("COPY_DESTINATION_UNSAFE");
      if ((stat.mode & 0o7777) !== Number.parseInt(modes[leaf], 8)) return observedResult("COPY_MODE_DRIFT", "destination regular-file mode differs");
      if (digest(await context.io.readBytes(path)) !== files[leaf]) return observedResult("COPY_DIGEST_DRIFT", "destination content digest differs");
    }
    return observedResult("COPY_DECLARATION_MATCH", expectedState);
  } catch (error) {
    const unsafe = error instanceof Error && error.message === "COPY_DESTINATION_UNSAFE";
    return result(record, {
      expected_state: expectedState, actual_state: unsafe ? "unsafe destination structure" : "unavailable",
      condition: unsafe || record.eligibility.required ? "FAIL" : "SKIPPED",
      reason_code: unsafe ? "COPY_DESTINATION_UNSAFE" : record.eligibility.required ? "REQUIRED_SURFACE_UNAVAILABLE" : "OPTIONAL_SURFACE_SKIPPED",
      severity: unsafe || record.eligibility.required ? "error" : "info", actionable: unsafe || record.eligibility.required,
      remediation: "Inspect the declared destination before restoring the reviewed surface.", evidence: ["sha256"],
    });
  }
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

  if (record.class === "COPY") return observeCopy(record, context);

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
      reason_code: matches ? "TRANSFORM_ADAPTER_MATCH" : "TRANSFORM_ADAPTER_DRIFT",
      severity: matches ? "info" : "warning",
      actionable: !matches,
      remediation: matches ? "None." : "Run the governed lifecycle update after reviewing the source change.",
      evidence: [record.verification.method],
    });
  } catch {
    return result(record, {
      expected_state: "matching in-memory adapter output",
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
