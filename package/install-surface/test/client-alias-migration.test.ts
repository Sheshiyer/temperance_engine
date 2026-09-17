import { describe, expect, test } from "bun:test";

import {
  ClientAliasMigrationError,
  createNineRouterClientAliasAdapter,
  migrateClientAliases,
  type ManagedClientAliasAdapter,
} from "../src/onboarding/client-alias-migration.ts";

function adapter(
  id: string,
  state: Record<string, unknown>,
  calls: string[],
  failOnApply?: (settings: Record<string, unknown>) => boolean,
): ManagedClientAliasAdapter {
  let current = structuredClone(state);
  return {
    client_id: id,
    async read() { calls.push(`read:${id}`); return structuredClone(current); },
    async apply(settings) {
      calls.push(`apply:${id}:${String(settings.model)}`);
      if (failOnApply?.(settings)) throw new ClientAliasMigrationError("SYNTHETIC_CLIENT_FAILURE");
      current = { ...current, ...structuredClone(settings) };
      return structuredClone(current);
    },
  };
}

describe("transactional client alias migration", () => {
  test("pre-reads and verifies every managed client", async () => {
    const calls: string[] = [];
    const result = await migrateClientAliases([
      { client_id: "codex", settings: { base_url: "http://127.0.0.1:20128/v1", model: "noesis-build" } },
      { client_id: "claude", settings: { base_url: "http://127.0.0.1:20128/v1", model: "noesis-orchestrator" } },
    ], [adapter("codex", { model: "old" }, calls), adapter("claude", { model: "old" }, calls)]);
    expect(result).toEqual({
      status: "committed",
      clients: [{ client_id: "codex", status: "updated" }, { client_id: "claude", status: "updated" }],
      rollback_status: "not-required",
    });
    expect(calls.slice(0, 2)).toEqual(["read:codex", "read:claude"]);
  });

  test("rolls every touched client back when a later client fails", async () => {
    const calls: string[] = [];
    const result = await migrateClientAliases([
      { client_id: "codex", settings: { model: "noesis-build" } },
      { client_id: "claude", settings: { model: "noesis-orchestrator" } },
    ], [
      adapter("codex", { model: "old-codex" }, calls),
      adapter("claude", { model: "old-claude" }, calls, (settings) => settings.model === "noesis-orchestrator"),
    ]);
    expect(result).toMatchObject({ status: "failed", rollback_status: "completed", failure_code: "SYNTHETIC_CLIENT_FAILURE" });
    expect(result.clients).toEqual([
      { client_id: "codex", status: "rolled-back" },
      { client_id: "claude", status: "rolled-back" },
    ]);
    expect(calls).toContain("apply:codex:old-codex");
    expect(calls).toContain("apply:claude:old-claude");
  });

  test("rejects credential-shaped settings before reading or writing clients", async () => {
    const calls: string[] = [];
    await expect(migrateClientAliases([
      { client_id: "codex", settings: { nested: { apiKey: "must-not-persist" } } },
    ], [adapter("codex", {}, calls)])).rejects.toThrow("CLIENT_SETTINGS_SECRET_FIELD_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  test("adapts 9router CLI settings without exposing concrete API methods", async () => {
    const calls: string[] = [];
    const nineRouter = {
      async readCliToolSettings(tool: string) { calls.push(`read:${tool}`); return { model: "old" }; },
      async applyCliToolSettings(tool: string, settings: Record<string, unknown>) { calls.push(`apply:${tool}`); return settings; },
    };
    const adapted = createNineRouterClientAliasAdapter("codex", nineRouter);
    expect(await adapted.read()).toEqual({ model: "old" });
    expect(await adapted.apply({ model: "noesis-build" })).toEqual({ model: "noesis-build" });
    expect(calls).toEqual(["read:codex", "apply:codex"]);
  });
});
