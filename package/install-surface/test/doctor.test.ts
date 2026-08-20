import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import { nodeObservationIO, runDoctor } from "../src/doctor/orchestrator.ts";
import { runInstallSection } from "../src/doctor/sections/install.ts";
import { renderDoctorHuman } from "../src/doctor/render-human.ts";
import { renderDoctorJson } from "../src/doctor/render-json.ts";
import { observePrivateRegistry } from "../src/private-registry.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function copyRecord(id: string, source: string, destination: string, required = true): SurfaceRecord {
  return {
    id,
    owner: "temperance-engine",
    class: "COPY",
    source,
    destination: { root_token: "HOME", relative_path: destination, ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
  };
}

function writeFixtureLock(repositoryRoot: string, records: SurfaceRecord[]): void {
  const directory = join(repositoryRoot, "package/install-surface");
  mkdirSync(directory, { recursive: true });
  const lock: InstallSurfaceLockV1 = {
    schema: "temperance.install-surface.lock.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 },
    records,
  };
  writeFileSync(join(directory, "install-surface-manifest.lock.json"), canonical(lock));
}

function snapshot(root: string): string {
  const rows: string[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    const rel = relative(root, path) || ".";
    rows.push([rel, stat.mode & 0o777, stat.nlink, stat.mtimeMs, stat.isFile() ? readFileSync(path).toString("hex") : ""].join("|"));
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root);
  return rows.join("\n");
}

describe("doctor record-contract and read-only behavior", () => {
  test("every check has the complete common record-contract", async () => {
    const repository = tempRoot("doctor-repo-");
    const home = join(repository, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(repository, "source.txt"), "same\n");
    writeFileSync(join(home, "target.txt"), "same\n");
    writeFixtureLock(repository, [copyRecord("surface.copy", "source.txt", "target.txt")]);
    const report = await runDoctor({ repositoryRoot: repository, stateRoot: join(repository, "state"), sections: ["install"], platform: "darwin", rootBindings: { HOME: home } });
    const required = ["id", "source", "destination", "class", "expected_state", "actual_state", "condition", "reason_code", "severity", "actionable", "remediation", "evidence"];
    for (const check of report.sections.flatMap((section) => section.checks)) {
      expect(Object.keys(check).sort()).toEqual(required.sort());
    }
  });

  test("read-only invariant preserves entries, bytes, modes, links, and mtime", async () => {
    const repository = tempRoot("doctor-readonly-");
    const home = join(repository, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(repository, "source.txt"), "same\n");
    writeFileSync(join(home, "target.txt"), "same\n");
    writeFixtureLock(repository, [copyRecord("surface.copy", "source.txt", "target.txt")]);
    const before = snapshot(repository);
    await runDoctor({ repositoryRoot: repository, stateRoot: join(repository, "absent-state"), sections: ["install"], platform: "darwin", rootBindings: { HOME: home } });
    expect(snapshot(repository)).toBe(before);
    expect(Object.keys(nodeObservationIO)).not.toContain("writeFile");
  });
});

test("eligibility keeps required FAIL, optional SKIPPED, and platform UNSUPPORTED distinct", async () => {
  const repository = tempRoot("doctor-eligibility-");
  const home = join(repository, "home");
  mkdirSync(home, { recursive: true });
  const required = copyRecord("surface.required", "missing-required.txt", "required.txt", true);
  const optional = copyRecord("surface.optional", "missing-optional.txt", "optional.txt", false);
  const unsupported = { ...copyRecord("surface.unsupported", "missing.txt", "unsupported.txt"), eligibility: { platforms: ["linux"], profiles: ["default"], required: true } } as SurfaceRecord;
  writeFixtureLock(repository, [required, optional, unsupported]);
  const section = await runInstallSection({ repositoryRoot: repository, stateRoot: join(repository, "state"), platform: "darwin", rootBindings: { HOME: home }, runtimeUrls: { bridge: "http://127.0.0.1:1", omniroute: "http://127.0.0.1:1" }, io: nodeObservationIO, signal: AbortSignal.timeout(1000) });
  expect(section.checks.find((check) => check.id === "surface.required")?.condition).toBe("FAIL");
  expect(section.checks.find((check) => check.id === "surface.optional")?.condition).toBe("SKIPPED");
  expect(section.checks.find((check) => check.id === "surface.unsupported")?.condition).toBe("UNSUPPORTED");
});

test("class-aware verification distinguishes COPY, TRANSFORM, REGENERATE, and NEVER-SHIP", async () => {
  const repository = tempRoot("doctor-classes-");
  const home = join(repository, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(repository, "copy.txt"), "same\n");
  writeFileSync(join(home, "copy.txt"), "same\n");
  writeFileSync(join(repository, "template.txt"), "rendered\n");
  writeFileSync(join(home, "config.txt"), "rendered\n");
  const transform = {
    ...copyRecord("surface.transform", "template.txt", "config.txt"),
    class: "TRANSFORM",
    verification: { method: "adapter", adapter_id: "managed-template-v1" },
  } as SurfaceRecord;
  const regenerate = {
    id: "surface.regenerate", owner: "temperance-engine", class: "REGENERATE",
    destination: { root_token: "HOME", relative_path: "generated.json", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-771" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: false },
    verification: { method: "semantic-probe", generator_id: "manifest-zone-v1" }, rollback: { policy: "regenerate" },
  } as SurfaceRecord;
  const neverShip = {
    id: "surface.private", owner: "private-boundary", class: "NEVER-SHIP",
    destination: { root_token: "HOME", relative_path: "symbolic/private", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-772" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: false },
    verification: { method: "symbolic-exclusion" }, rollback: { policy: "none-private" },
  } as SurfaceRecord;
  writeFixtureLock(repository, [copyRecord("surface.copy", "copy.txt", "copy.txt"), transform, regenerate, neverShip]);
  const section = await runInstallSection({ repositoryRoot: repository, stateRoot: join(repository, "state"), platform: "darwin", rootBindings: { HOME: home }, runtimeUrls: { bridge: "http://127.0.0.1:1", omniroute: "http://127.0.0.1:1" }, io: nodeObservationIO, signal: AbortSignal.timeout(1000) });
  expect(section.checks.map((check) => [check.class, check.condition])).toEqual([
    ["COPY", "PASS"], ["NEVER-SHIP", "PASS"], ["REGENERATE", "SKIPPED"], ["TRANSFORM", "PASS"],
  ]);
});

test("timeout isolation yields UNAVAILABLE and exit 1 while preserving a trustworthy report", async () => {
  const repository = tempRoot("doctor-timeout-");
  writeFixtureLock(repository, []);
  const report = await runDoctor({
    repositoryRoot: repository,
    sections: ["runtime"],
    timeouts: { runtime: 5 },
    runners: { runtime: async () => new Promise(() => {}) },
  });
  expect(report.overall_condition).toBe("UNAVAILABLE");
  expect(report.exit_code).toBe(1);
  expect(report.trustworthy).toBe(true);
});

describe("private registry privacy and file controls", () => {
  function registryFixture(mode: number): { state: string; registry: string; honeytoken: string } {
    const state = tempRoot("doctor-private-");
    const parent = join(state, "private-overlays");
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
    const honeytoken = "PRIVATE-HONEYTOKEN-BINDING-LABEL-PROVIDER-NOTES";
    const registry = join(parent, "registry.v1.json");
    writeFileSync(registry, JSON.stringify({
      schema: "temperance.private-registry.v1", version: { major: 1, minor: 0 },
      records: [{ id: "overlay.symbolic", class: "NEVER-SHIP", enabled: false, binding: `bindings/${honeytoken}`, label: honeytoken, provider: honeytoken, notes: honeytoken, policy_rule: "private-root" }],
    }), { mode });
    chmodSync(registry, mode);
    return { state, registry, honeytoken };
  }

  test("mode 0644, symlink, and nlink greater than one fail closed", () => {
    const broad = registryFixture(0o644);
    expect(observePrivateRegistry(broad.state).condition).toBe("FAIL");
    const linked = registryFixture(0o600);
    linkSync(linked.registry, join(dirname(linked.registry), "registry-copy.json"));
    expect(observePrivateRegistry(linked.state).condition).toBe("FAIL");
    const symbolic = registryFixture(0o600);
    const target = `${symbolic.registry}.target`;
    writeFileSync(target, readFileSync(symbolic.registry));
    rmSync(symbolic.registry);
    symlinkSync(target, symbolic.registry);
    expect(observePrivateRegistry(symbolic.state).condition).toBe("FAIL");
  });

  test("honeytokens stay absent from human, JSON, verbose, and error-safe projections", async () => {
    const fixture = registryFixture(0o600);
    const repository = tempRoot("doctor-private-repo-");
    writeFixtureLock(repository, []);
    const report = await runDoctor({ repositoryRoot: repository, stateRoot: fixture.state, sections: ["privacy"] });
    const outputs = [renderDoctorHuman(report), renderDoctorHuman(report, true), renderDoctorJson(report), JSON.stringify(observePrivateRegistry(fixture.state))];
    for (const output of outputs) expect(output).not.toContain(fixture.honeytoken);
    expect(report.sections[0].checks[0].condition).toBe("SKIPPED");
  });
});
