import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import { runDoctor } from "../src/doctor/orchestrator.ts";
import { renderDoctorHuman } from "../src/doctor/render-human.ts";
import { renderDoctorJson } from "../src/doctor/render-json.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function invoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const packageRoot = resolve(import.meta.dir, "..");
  const process = Bun.spawn(["bun", "run", "src/cli.ts", ...args], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("CLI matrix supports filtered human, verbose, JSON, and exact invalid-argument exit", async () => {
  const state = mkdtempSync(join(tmpdir(), "doctor-cli-state-"));
  roots.push(state);
  const human = await invoke(["doctor", "--section", "privacy", "--state-root", state]);
  const verbose = await invoke(["doctor", "--section", "privacy", "--state-root", state, "--verbose"]);
  const json = await invoke(["doctor", "--section", "privacy", "--state-root", state, "--json"]);
  const invalid = await invoke(["doctor", "--section", "invalid"]);
  expect(human.code).toBe(0);
  expect(human.stdout.indexOf("SECTIONS")).toBeLessThan(human.stdout.indexOf("FINDINGS"));
  expect(human.stdout.includes("remediation") || human.stdout.includes("No actionable findings")).toBe(true);
  expect(verbose.code).toBe(0);
  expect(verbose.stdout).toContain("VERBOSE PUBLIC-SAFE RECORDS");
  expect(json.code).toBe(0);
  expect(JSON.parse(json.stdout).sections[0].id).toBe("privacy");
  expect(invalid.code).toBe(2);
});

test("DRIFT produces exit 1 and human/JSON renderers share the same observations", async () => {
  const repository = mkdtempSync(join(tmpdir(), "doctor-cli-drift-"));
  roots.push(repository);
  const home = join(repository, "home");
  mkdirSync(join(repository, "package/install-surface"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(repository, "source.txt"), "expected\n");
  writeFileSync(join(home, "target.txt"), "drifted\n");
  const record: SurfaceRecord = {
    id: "surface.drift", owner: "temperance-engine", class: "COPY", source: "source.txt",
    destination: { root_token: "HOME", relative_path: "target.txt", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "sha256" }, rollback: { policy: "restore-backup" },
  };
  const lock: InstallSurfaceLockV1 = { schema: "temperance.install-surface.lock.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1", version: { major: 1, minor: 0 }, records: [record] };
  writeFileSync(join(repository, "package/install-surface/install-surface-manifest.lock.json"), canonical(lock));
  const report = await runDoctor({ repositoryRoot: repository, sections: ["install"], platform: "darwin", rootBindings: { HOME: home } });
  expect(report.overall_condition).toBe("DRIFT");
  expect(report.exit_code).toBe(1);
  const human = renderDoctorHuman(report);
  const json = JSON.parse(renderDoctorJson(report));
  expect(human).toContain("DRIFT");
  expect(human).toContain("remediation:");
  expect(json.sections[0].checks[0].id).toBe(report.sections[0].checks[0].id);
  expect(json.sections[0].checks[0].actual_state).toBe(report.sections[0].checks[0].actual_state);
});
