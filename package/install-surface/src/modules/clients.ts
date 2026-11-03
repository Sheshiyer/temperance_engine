import { digest, digestValue, frozen, id, record, type Digest } from "../composition/boundary.ts";

export const PRIMARY_CLIENTS = {
  "codex-cli": { package: "@openai/codex", executable: "codex", documentation: "https://learn.chatgpt.com/docs/codex/cli" },
  "claude-code": { package: "@anthropic-ai/claude-code", executable: "claude", documentation: "https://code.claude.com/docs/en/setup" },
} as const;
export type PrimaryClient = keyof typeof PRIMARY_CLIENTS;

/** Optional vendor guidance. The selected installation owner verifies integrity,
 * preimages and platform behaviour before applying its own confirmed plan.
 */
export function guideClientInstallation(client: PrimaryClient, version: string, integrity: string, verb: "install" | "update") {
  if (!Object.hasOwn(PRIMARY_CLIENTS, client) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) || !["install", "update"].includes(verb)) throw new Error("CLIENT_INSTALL_PIN_REQUIRED");
  const vendor = PRIMARY_CLIENTS[client];
  const plan = { schema: "temperance.client-install-guidance.v1", adapter_ref: "client." + client, verb, version, distribution: vendor.package, integrity, argv: ["npm", "install", "--global", vendor.package + "@" + version], version_probe: [vendor.executable, "--version"], documentation: vendor.documentation, activation: "selected-owner-plan", effect_authorized: false };
  return frozen({ ...plan, guidance_digest: digestValue(plan) });
}

/** Client envelopes are translated by their owner. This adapter accepts only
 * symbolic, already-redacted occurrence references, never transcripts or native IDs.
 * The flow owner supplies event mapping; no lifecycle subscriptions are installed.
 */
export function normalizeClientSignal(client: PrimaryClient, input: unknown, mapping: Readonly<Record<string, string>>, source_digest: Digest) {
  if (!Object.hasOwn(PRIMARY_CLIENTS, client)) throw new Error("CLIENT_ADAPTER_UNAVAILABLE");
  digest(source_digest);
  const value = record(input, ["event_name", "run_ref", "occurrence_ref"]);
  id(value.event_name); id(value.run_ref); id(value.occurrence_ref);
  const mappings = frozen(mapping);
  const signal_ref = Object.hasOwn(mappings, value.event_name) ? mappings[value.event_name] : undefined;
  if (signal_ref !== undefined) id(signal_ref);
  return frozen({ schema: "temperance.client-signal.v1", adapter_ref: "client." + client, source_digest, run_ref: value.run_ref, occurrence_ref: value.occurrence_ref, signal_ref: signal_ref ?? null, status: signal_ref === undefined ? "unmapped" : "mapped", effect_authorized: false });
}
