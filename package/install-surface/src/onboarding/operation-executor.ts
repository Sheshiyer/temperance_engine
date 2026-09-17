import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

import { canonical } from "../canonical-json.ts";
import type { OnboardingPlanV1, OnboardingProfileV1 } from "./contracts.ts";
import { validateOperationReceiptV1 } from "./contract-schema.ts";
import { OPERATION_RECEIPT_SCHEMA, type OperationReceiptV1 } from "./public-contracts.ts";
import { verifyOnboardingPlanDigest } from "./planner.ts";

export interface OperationConfirmationV1 {
  confirmed: true;
  plan_digest: OnboardingPlanV1["plan_digest"];
  confirmed_at: string;
}

export interface ResolvedExecutable {
  id: string;
  path: string;
  version: string;
}

export interface OnboardingEffectorResult {
  resolved_executables?: readonly ResolvedExecutable[];
}

export interface OnboardingEffector {
  module_id: string;
  apply(signal: AbortSignal): Promise<OnboardingEffectorResult | void>;
  rollback(signal: AbortSignal): Promise<void>;
}

export interface OperationReceiptSink {
  write(receipt: OperationReceiptV1): Promise<void>;
}

export interface ExecuteOnboardingOperationOptions {
  plan: OnboardingPlanV1;
  profile: OnboardingProfileV1;
  confirmation: OperationConfirmationV1;
  effectors: readonly OnboardingEffector[];
  receiptSink: OperationReceiptSink;
  signal?: AbortSignal;
  now?: () => Date;
  operationId?: string;
}

export class OnboardingOperationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OnboardingOperationError";
  }
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function validateExecutable(value: ResolvedExecutable): ResolvedExecutable {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.id)) throw new OnboardingOperationError("EXECUTABLE_ID_INVALID");
  if (!canonicalAbsolute(value.path)) throw new OnboardingOperationError("EXECUTABLE_PATH_INVALID");
  if (!value.version || value.version.length > 128 || value.version.trim() !== value.version || value.version.includes("\0")) {
    throw new OnboardingOperationError("EXECUTABLE_VERSION_INVALID");
  }
  return { ...value };
}

function errorCode(error: unknown): string {
  if (error instanceof OnboardingOperationError && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)) return error.code;
  const candidate = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "APPLY_FAILED";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate) ? candidate : "APPLY_FAILED";
}

function assertConfirmation(plan: OnboardingPlanV1, confirmation: OperationConfirmationV1): void {
  if (!verifyOnboardingPlanDigest(plan)) throw new OnboardingOperationError("OPERATION_PLAN_DIGEST_INVALID");
  if (confirmation.confirmed !== true || confirmation.plan_digest !== plan.plan_digest) {
    throw new OnboardingOperationError("OPERATION_CONFIRMATION_MISMATCH");
  }
  if (!Number.isFinite(Date.parse(confirmation.confirmed_at))) throw new OnboardingOperationError("OPERATION_CONFIRMATION_INVALID");
  if (plan.operating_mode === "blocked") throw new OnboardingOperationError("OPERATION_PLAN_BLOCKED");
  if (plan.install_order.length === 0) throw new OnboardingOperationError("OPERATION_PLAN_EMPTY");
}

function assertEffectors(plan: OnboardingPlanV1, effectors: readonly OnboardingEffector[]): Map<string, OnboardingEffector> {
  const byId = new Map<string, OnboardingEffector>();
  for (const effector of effectors) {
    if (byId.has(effector.module_id)) throw new OnboardingOperationError("OPERATION_EFFECTOR_DUPLICATE");
    byId.set(effector.module_id, effector);
  }
  for (const moduleId of plan.install_order) {
    if (!byId.has(moduleId)) throw new OnboardingOperationError("OPERATION_EFFECTOR_MISSING");
  }
  return byId;
}

function makeReceipt(input: Omit<OperationReceiptV1, "schema" | "version">): OperationReceiptV1 {
  const receipt: OperationReceiptV1 = {
    schema: OPERATION_RECEIPT_SCHEMA,
    version: { major: 1, minor: 0 },
    ...input,
  };
  if (!validateOperationReceiptV1(receipt)) throw new OnboardingOperationError("OPERATION_RECEIPT_INVALID");
  return receipt;
}

/**
 * Executes only the exact confirmed plan digest. Every effector whose apply
 * phase started is compensated in reverse order when any later step fails.
 */
export async function executeOnboardingOperation(options: ExecuteOnboardingOperationOptions): Promise<OperationReceiptV1> {
  assertConfirmation(options.plan, options.confirmation);
  const effectors = assertEffectors(options.plan, options.effectors);
  const operationId = options.operationId ?? `operation-${randomUUID()}`;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(operationId)) throw new OnboardingOperationError("OPERATION_ID_INVALID");
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const signal = options.signal ?? new AbortController().signal;
  const applied: OnboardingEffector[] = [];
  const executables: ResolvedExecutable[] = [];

  try {
    for (const moduleId of options.plan.install_order) {
      if (signal.aborted) throw new OnboardingOperationError("OPERATION_ABORTED");
      const effector = effectors.get(moduleId)!;
      applied.push(effector);
      const result = await effector.apply(signal);
      for (const executable of result?.resolved_executables ?? []) executables.push(validateExecutable(executable));
    }
    const receipt = makeReceipt({
      operation_id: operationId,
      plan_digest: options.plan.plan_digest,
      status: "committed",
      module_ids: [...options.plan.install_order],
      secret_reference_ids: Object.keys(options.profile.secret_references).sort(),
      redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"],
      resolved_executables: executables.sort((left, right) => left.id.localeCompare(right.id)),
      rollback_status: "not-required",
      started_at: startedAt,
      finished_at: now().toISOString(),
    });
    await options.receiptSink.write(receipt);
    return receipt;
  } catch (error) {
    let rollbackStatus: OperationReceiptV1["rollback_status"] = applied.length === 0 ? "not-required" : "completed";
    for (const effector of [...applied].reverse()) {
      try { await effector.rollback(new AbortController().signal); }
      catch { rollbackStatus = "failed"; }
    }
    const receipt = makeReceipt({
      operation_id: operationId,
      plan_digest: options.plan.plan_digest,
      status: "failed",
      module_ids: [...options.plan.install_order],
      secret_reference_ids: Object.keys(options.profile.secret_references).sort(),
      redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"],
      resolved_executables: executables.sort((left, right) => left.id.localeCompare(right.id)),
      rollback_status: rollbackStatus,
      failure_code: errorCode(error),
      started_at: startedAt,
      finished_at: now().toISOString(),
    });
    await options.receiptSink.write(receipt);
    return receipt;
  }
}

export function createFileOperationReceiptSink(receiptDirectory: string): OperationReceiptSink {
  if (!canonicalAbsolute(receiptDirectory)) throw new OnboardingOperationError("OPERATION_RECEIPT_DIRECTORY_INVALID");
  return {
    async write(receipt): Promise<void> {
      if (!validateOperationReceiptV1(receipt)) throw new OnboardingOperationError("OPERATION_RECEIPT_INVALID");
      await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
      const directoryStat = await lstat(receiptDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new OnboardingOperationError("OPERATION_RECEIPT_DIRECTORY_UNSAFE");
      const path = resolve(receiptDirectory, `${receipt.operation_id}.json`);
      if (dirname(path) !== receiptDirectory) throw new OnboardingOperationError("OPERATION_RECEIPT_PATH_INVALID");
      const temporary = resolve(receiptDirectory, `.${receipt.operation_id}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${canonical(receipt)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, path);
        await unlink(temporary);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
  };
}
