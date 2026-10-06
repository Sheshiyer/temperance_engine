import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCompositionCommand } from "../src/composition/cli.ts";
const manifest = JSON.parse(readFileSync(new URL("../examples/standalone-composition.v1.json", import.meta.url), "utf8"));
test("canonical configuration-only result has newline and no admission", async () => {
 const r = await runCompositionCommand(["inspect"], () => JSON.stringify({manifest}), 1760000000000);
 expect(r.code).toBe(0); expect(r.stderr).toBe(""); expect(r.stdout.endsWith("\n")).toBe(true);
 const report = JSON.parse(r.stdout); expect(report.effect_authorized).toBe(false); expect(report.kernel.execution_authorized).toBe(false); expect(report.integrations).toEqual([]);
});
test("invalid arguments do not read input", async () => {
 for (const args of [[], ["inspect", "--path"], ["apply"]]) {
 const r = await runCompositionCommand(args, () => {throw new Error("private");});
 expect(r.code).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error).toBe("COMPOSITION_CLI_INVALID_ARGUMENTS"); }
});
test("oversized packets, malformed JSON and private values produce safe errors", async () => {
 for (const value of ["x".repeat(65537), "private-secret", JSON.stringify({manifest, private: "private-secret"}), JSON.stringify({manifest: {...manifest, plant: {...manifest.plant, owner: "private@example.com"}}})]) {
 const r = await runCompositionCommand(["inspect"], () => value); expect(r.code).toBe(2); expect(r.stdout).toBe(""); expect(r.stderr).not.toContain("private-secret"); expect(r.stderr).not.toContain("private@example.com"); expect(JSON.parse(r.stderr).error).toMatch(/^COMPOSITION_[A-Z_]+$/); }
});
test("read failures redact exception text", async () => {
 const r = await runCompositionCommand(["inspect"], () => {throw new Error("private-secret");}); expect(r.stderr).toBe('{"error":"COMPOSITION_READ_FAILED"}\n');
});
test("executable rejects oversized stdin without accepting its valid prefix", async () => {
 const { spawnSync } = await import("node:child_process");
 const result = spawnSync(process.execPath, [new URL("../src/composition/cli.ts", import.meta.url).pathname, "inspect"], {
  input: JSON.stringify({manifest}) + " ".repeat(65537), encoding: "utf8",
 });
 expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).error).toBe("COMPOSITION_SIZE_EXCEEDED");
});
test("main product CLI exposes the same standalone configuration inspector", async () => {
 const { spawnSync } = await import("node:child_process");
 const result = spawnSync(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "composition", "inspect"], {
  input: JSON.stringify({manifest}), encoding: "utf8", timeout: 5000,
 });
 expect(result.status).toBe(0); expect(result.stderr).toBe("");
 const report = JSON.parse(result.stdout);
 expect(report.integrations).toEqual([]); expect(report.kernel.requires_superset).toBe(false);
 expect(report.kernel.requires_integrations).toBe(false); expect(report.effect_authorized).toBe(false);
});

test("main product CLI projects one lifecycle lineage for banner and island consumers", async () => {
 const { inspectComposition } = await import("../src/composition/inspect.ts");
 const { runOrganLifecycle } = await import("../src/composition/lifecycle.ts");
 const { spawnSync } = await import("node:child_process");
 const now = Date.now();
 const event = {schema:"temperance.organ-lifecycle-event.v1", occurrence_id:"projection-cli-fixture", plant_id:manifest.plant.id, source_manifest_digest:inspectComposition(manifest, undefined, now).source_manifest_digest, occurred_at:new Date(now).toISOString(), kind:"session-start"};
 const receipt = await runOrganLifecycle({manifest,event,subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[]},handlers:{},now,ledger:{claim:async()=>"claimed",commit:async()=>{}}});
 const result = spawnSync(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "composition", "project"], {input:JSON.stringify({manifest,event,receipt}),encoding:"utf8",timeout:5000});
 expect(result.status).toBe(0);expect(result.stderr).toBe("");
 const projected = JSON.parse(result.stdout);expect(projected.schema).toBe("temperance.composition-projection.v1");expect(projected.effect_authorized).toBe(false);expect(projected.targets[0].banner_text).toContain("No advisory callbacks selected");expect(projected.targets[0].enabled).toBe(false);
 const invalid = await runCompositionCommand(["project"],()=>JSON.stringify({manifest,event,receipt,private:"secret"}),now);expect(invalid.code).toBe(2);expect(invalid.stderr).not.toContain("secret");
});
