import { canonical } from "../canonical-json.ts";
import type { NineRouterApiClient, NineRouterCliTool } from "./nine-router-api.ts";

const SECRET_KEY = /(?:api.?key|authorization|credential|password|secret|token)/iu;
const MAX_SETTINGS_BYTES = 1_048_576;

export interface ManagedClientAliasAdapter {
  client_id: string;
  read(): Promise<Record<string, unknown>>;
  apply(settings: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ClientAliasDesiredState {
  client_id: string;
  settings: Record<string, unknown>;
}

export interface ClientAliasMigrationResult {
  status: "committed" | "failed";
  clients: Array<{ client_id: string; status: "updated" | "rolled-back" | "unchanged" }>;
  rollback_status: "not-required" | "completed" | "failed";
  failure_code?: string;
}

export class ClientAliasMigrationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ClientAliasMigrationError";
  }
}

function secretFree(value: unknown, depth = 0): void {
  if (depth > 16) throw new ClientAliasMigrationError("CLIENT_SETTINGS_TOO_DEEP");
  if (Array.isArray(value)) {
    for (const item of value) secretFree(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new ClientAliasMigrationError("CLIENT_SETTINGS_SECRET_FIELD_FORBIDDEN");
    secretFree(item, depth + 1);
  }
}

function validateSettings(value: Record<string, unknown>): Record<string, unknown> {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_SETTINGS_BYTES) throw new ClientAliasMigrationError("CLIENT_SETTINGS_TOO_LARGE");
  secretFree(value);
  return structuredClone(value);
}

function containsDesired(actual: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) return Array.isArray(actual) && canonical(actual) === canonical(desired);
  if (!desired || typeof desired !== "object") return Object.is(actual, desired);
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(desired as Record<string, unknown>)
    .every(([key, value]) => containsDesired((actual as Record<string, unknown>)[key], value));
}

function codeFor(error: unknown): string {
  if (error instanceof ClientAliasMigrationError) return error.code;
  const candidate = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "CLIENT_ALIAS_APPLY_FAILED";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate) ? candidate : "CLIENT_ALIAS_APPLY_FAILED";
}

/**
 * Pre-reads every managed client, applies in declared order, verifies by
 * readback, and restores all touched clients when any write or readback fails.
 */
export async function migrateClientAliases(
  desired: readonly ClientAliasDesiredState[],
  adapters: readonly ManagedClientAliasAdapter[],
): Promise<ClientAliasMigrationResult> {
  const byId = new Map<string, ManagedClientAliasAdapter>();
  for (const adapter of adapters) {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(adapter.client_id)) throw new ClientAliasMigrationError("CLIENT_ID_INVALID");
    if (byId.has(adapter.client_id)) throw new ClientAliasMigrationError("CLIENT_ADAPTER_DUPLICATE");
    byId.set(adapter.client_id, adapter);
  }
  const ids = new Set<string>();
  const validated = desired.map((item) => {
    if (!byId.has(item.client_id)) throw new ClientAliasMigrationError("CLIENT_ADAPTER_MISSING");
    if (ids.has(item.client_id)) throw new ClientAliasMigrationError("CLIENT_DESIRED_DUPLICATE");
    ids.add(item.client_id);
    return { client_id: item.client_id, settings: validateSettings(item.settings) };
  });
  const before = new Map<string, Record<string, unknown>>();
  for (const item of validated) before.set(item.client_id, validateSettings(await byId.get(item.client_id)!.read()));

  const touched: string[] = [];
  const statuses = new Map<string, "updated" | "rolled-back" | "unchanged">(
    validated.map((item) => [item.client_id, "unchanged"]),
  );
  try {
    for (const item of validated) {
      if (containsDesired(before.get(item.client_id), item.settings)) continue;
      touched.push(item.client_id);
      await byId.get(item.client_id)!.apply(item.settings);
      const readback = validateSettings(await byId.get(item.client_id)!.read());
      if (!containsDesired(readback, item.settings)) throw new ClientAliasMigrationError("CLIENT_ALIAS_READBACK_MISMATCH");
      statuses.set(item.client_id, "updated");
    }
    return {
      status: "committed",
      clients: validated.map((item) => ({ client_id: item.client_id, status: statuses.get(item.client_id)! })),
      rollback_status: "not-required",
    };
  } catch (error) {
    let rollbackStatus: ClientAliasMigrationResult["rollback_status"] = touched.length ? "completed" : "not-required";
    for (const clientId of [...touched].reverse()) {
      try {
        await byId.get(clientId)!.apply(before.get(clientId)!);
        const readback = validateSettings(await byId.get(clientId)!.read());
        if (canonical(readback) !== canonical(before.get(clientId)!)) throw new Error("rollback mismatch");
        statuses.set(clientId, "rolled-back");
      } catch {
        rollbackStatus = "failed";
      }
    }
    return {
      status: "failed",
      clients: validated.map((item) => ({ client_id: item.client_id, status: statuses.get(item.client_id)! })),
      rollback_status: rollbackStatus,
      failure_code: codeFor(error),
    };
  }
}

export function createNineRouterClientAliasAdapter(
  tool: NineRouterCliTool,
  client: Pick<NineRouterApiClient, "readCliToolSettings" | "applyCliToolSettings">,
): ManagedClientAliasAdapter {
  return {
    client_id: tool,
    read: () => client.readCliToolSettings(tool),
    apply: (settings) => client.applyCliToolSettings(tool, settings),
  };
}
