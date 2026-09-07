import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import { compileFragments } from "../src/compile.ts";
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

function sha256(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

async function invokeTemporaryCli(
  repositoryRoot: string,
  cwd: string,
  environment: Record<string, string>,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([
    process.execPath,
    "run",
    join(repositoryRoot, "package/install-surface/src/cli.ts"),
    ...args,
  ], {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("CLI resolves a declared tree COPY from its product root outside the caller working directory", async () => {
  const repository = mkdtempSync(join(tmpdir(), "declared-copy-cli-repo-"));
  const home = join(repository, "home");
  const state = join(repository, "state");
  const codexHome = join(repository, "codex");
  const claudeConfig = join(repository, "claude");
  const unrelatedCwd = join(repository, "unrelated");
  roots.push(repository);
  mkdirSync(home, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(claudeConfig, { recursive: true });
  mkdirSync(unrelatedCwd, { recursive: true });
  mkdirSync(join(repository, ".planning"), { recursive: true });
  mkdirSync(join(repository, "payload/nested"), { recursive: true });
  mkdirSync(join(home, "installed"), { recursive: true });
  writeFileSync(join(repository, "payload/a.txt"), "new a\n");
  writeFileSync(join(repository, "payload/nested/b.txt"), "new b\n");
  chmodSync(join(repository, "payload/nested/b.txt"), 0o755);
  writeFileSync(join(home, "installed/a.txt"), "old a\n");
  writeFileSync(join(home, "installed/sentinel"), "user-owned\n");
  writeFileSync(join(repository, "ISA.md"), "- [x] ISC-769: COPY classification is ratified.\n");
  writeFileSync(join(repository, ".planning/REQUIREMENTS.md"), "- [ ] **PROV-02** — stable records\n");

  const packageSource = resolve(import.meta.dir, "..");
  const packageTarget = join(repository, "package/install-surface");
  cpSync(packageSource, packageTarget, { recursive: true });
  rmSync(join(packageTarget, "fragments"), { recursive: true, force: true });
  mkdirSync(join(packageTarget, "fragments"), { recursive: true });
  rmSync(join(packageTarget, "install-surface-manifest.lock.json"), { force: true });

  const fragment = {
    schema: "temperance.install-surface.fragment.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",
    version: { major: 1, minor: 0 },
    records: [{
      id: "surface.cli-tree",
      owner: "temperance-engine",
      class: "COPY",
      source: "payload",
      destination: { root_token: "HOME", relative_path: "installed", ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
      eligibility: { platforms: [process.platform], profiles: ["ro00-cli"], required: true },
      verification: {
        method: "sha256",
        expected: {
          kind: "tree",
          files: {
            "a.txt": sha256("new a\n"),
            "nested/b.txt": sha256("new b\n"),
          },
          modes: {
            "a.txt": "0644",
            "nested/b.txt": "0755",
          },
        },
      },
      rollback: { policy: "restore-backup" },
    }],
  };
  writeFileSync(join(packageTarget, "fragments/copy.json"), JSON.stringify(fragment, null, 2));
  const expectedDigest = compileFragments([{ name: "copy.json", contents: JSON.stringify(fragment) }], {
    isaText: readFileSync(join(repository, "ISA.md"), "utf8"),
    requirementsText: readFileSync(join(repository, ".planning/REQUIREMENTS.md"), "utf8"),
  }).digest;
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TEMPERANCE_STATE: state,
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    TMPDIR: join(repository, "tmp"),
  };

  const install = await invokeTemporaryCli(repository, unrelatedCwd, environment, ["install", "--profile", "ro00-cli", "--json"]);
  expect(install.code).toBe(0);
  const installed = JSON.parse(install.stdout);
  expect(installed.status).toBe("committed");
  expect(installed.receipt.inventory_digest).toBe(expectedDigest);
  expect(readFileSync(join(home, "installed/a.txt"), "utf8")).toBe("new a\n");
  expect(readFileSync(join(home, "installed/nested/b.txt"), "utf8")).toBe("new b\n");
  expect(readFileSync(join(home, "installed/sentinel"), "utf8")).toBe("user-owned\n");
  expect(existsSync(join(state, "transactions", installed.txid, "copy-manifest.json"))).toBe(true);

  const rollback = await invokeTemporaryCli(repository, unrelatedCwd, environment, ["rollback", "--select", installed.txid, "--json"]);
  expect(rollback.code).toBe(0);
  expect(JSON.parse(rollback.stdout).status).toBe("committed");
  expect(readFileSync(join(home, "installed/a.txt"), "utf8")).toBe("old a\n");
  expect(existsSync(join(home, "installed/nested/b.txt"))).toBe(false);
  expect(readFileSync(join(home, "installed/sentinel"), "utf8")).toBe("user-owned\n");
});

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
  chmodSync(join(home, "target.txt"), 0o644);
  const record: SurfaceRecord = {
    id: "surface.drift", owner: "temperance-engine", class: "COPY", source: "source.txt",
    destination: { root_token: "HOME", relative_path: "target.txt", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "sha256", expected: { kind: "file", sha256: sha256("expected\n"), mode: "0644" } }, rollback: { policy: "restore-backup" },
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
