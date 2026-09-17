import { afterEach, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writePrivateNineRouterSetup } from "../src/onboarding/nine-router-setup-writer.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const setup = {
  schema: "temperance.9router-guided-setup.v1" as const,
  version: { major: 1 as const, minor: 0 as const },
  providers: [{ selection_id: "codex", provider: "cx", connection_name: "Codex", credential_reference_id: "PROVIDER_CODEX" }],
  combos: [{ alias: "noesis-build", models: ["cx/gpt-codex"] }],
  required_aliases: ["noesis-build"],
  gateway_key: { name: "Temperance", secret_reference_id: "NINE_ROUTER_GATEWAY_KEY" },
};

test("writes one owner-only router setup and refuses overwrite", () => {
  const root = mkdtempSync(join(tmpdir(), "temperance-router-setup-"));
  roots.push(root);
  chmodSync(root, 0o700);
  const output = join(root, "setup.json");
  expect(writePrivateNineRouterSetup(output, setup)).toBe(output);
  expect(lstatSync(output).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(setup);
  expect(() => writePrivateNineRouterSetup(output, setup)).toThrow("NINE_ROUTER_SETUP_OUTPUT_EXISTS");
});
