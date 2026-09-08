import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import type { CompileResult } from "../src/compile.ts";
import type { ObservationIO } from "../src/doctor/model.ts";
import { nodeObservationIO, runDoctor } from "../src/doctor/orchestrator.ts";
import { runInstallSection } from "../src/doctor/sections/install.ts";
import { executePlan, rollbackTransaction } from "../src/lifecycle/executor.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { createPlan } from "../src/lifecycle/planner.ts";
import { renderDoctorHuman } from "../src/doctor/render-human.ts";
import { renderDoctorJson } from "../src/doctor/render-json.ts";
import { observePrivateRegistry } from "../src/private-registry.ts";
import { validateDoctorReport, validateDoctorReportV2 } from "../src/schema.ts";
import type { DoctorReportV2, InstallSurfaceLockV1, SurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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
    verification: { method: "sha256", expected: { kind: "file", sha256: hash("same\n"), mode: "0644" } },
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

function lifecycleIo(): LifecycleIO {
  return {
    mkdir: async (path, options) => mkdirSync(path, options),
    writeFile: async (path, data) => writeFileSync(path, data, "utf8"),
    readFile: async (path) => readFileSync(path, "utf8"),
    readdir: async (path) => readdirSync(path),
    rm: async (path, options) => rmSync(path, options),
    lstat: async (path) => lstatSync(path),
    chmod: async (path, mode) => chmodSync(path, mode),
    rename: async (from, to) => renameSync(from, to),
    realpath: async (path) => realpathSync(path),
    now: () => new Date("2026-09-07T00:00:00.000Z"),
    writeFileAtomic: async (path, data, options) => {
      writeFileSync(path, data, { encoding: "utf8", mode: options?.mode });
      if (options?.mode !== undefined) chmodSync(path, options.mode);
    },
    fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); },
    execFile: async () => { throw new Error("PROCESS_FORBIDDEN"); },
  };
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
    ["COPY", "PASS"], ["NEVER-SHIP", "PASS"], ["REGENERATE", "UNAVAILABLE"], ["TRANSFORM", "UNAVAILABLE"],
  ]);
});

async function installedTransformFixture() {
  const repository = tempRoot("doctor-transform-binding-");
  const codex = join(repository, "codex");
  const state = join(repository, "state");
  const template = "NOESIS\ncurrent managed guidance\n";
  const original = "user prefix\n<!-- temperance:managed:start temperance-engine -->\nold guidance\n<!-- temperance:managed:end temperance-engine -->\nuser suffix\n";
  mkdirSync(join(repository, "templates"), { recursive: true });
  mkdirSync(codex, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(repository, "templates/codex.AGENTS.md"), template, { mode: 0o644 });
  writeFileSync(join(codex, "AGENTS.md"), original, { mode: 0o600 });
  chmodSync(join(codex, "AGENTS.md"), 0o600);

  const transform: SurfaceRecord = {
    id: "configuration.codex-managed-block", owner: "temperance-engine", class: "TRANSFORM", source: "templates/codex.AGENTS.md",
    destination: { root_token: "CODEX_HOME", relative_path: "AGENTS.md", ownership: { kind: "managed-block", marker_id: "temperance-engine" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-770" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "adapter", adapter_id: "managed-template-v1", expected: { kind: "file", sha256: hash(template), mode: "0644" } },
    rollback: { policy: "restore-backup" },
  };
  const generator: SurfaceRecord = {
    id: "manifest.zone-project-state", owner: "temperance-engine", class: "REGENERATE",
    destination: { root_token: "TEMPERANCE_STATE", relative_path: "state/manifest-zone.json", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-771" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: false },
    verification: { method: "semantic-probe", generator_id: "manifest-zone-v1" }, rollback: { policy: "regenerate" },
  };
  const lock: InstallSurfaceLockV1 = {
    schema: "temperance.install-surface.lock.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 }, records: [transform, generator],
  };
  const canonicalLock = canonical(lock);
  mkdirSync(join(repository, "package/install-surface"), { recursive: true });
  writeFileSync(join(repository, "package/install-surface/install-surface-manifest.lock.json"), canonicalLock);
  const compiled: CompileResult = {
    lockObject: lock,
    canonicalBytes: canonicalLock,
    digest: hash(canonicalLock),
    semanticIds: lock.records.map((record) => record.id),
  };
  const roots = (token: string): string => ({ CODEX_HOME: codex, TEMPERANCE_STATE: state }[token] ?? (() => { throw new Error(`unexpected root ${token}`); })());
  const plan = createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin" });
  const installed = await executePlan({ stateRoot: state, repositoryRoot: repository, io: lifecycleIo(), plan, compileResult: compiled, verb: "install", profile: "default", resolveRoot: roots });
  expect(installed.status).toBe("committed");

  const context = {
    repositoryRoot: repository, stateRoot: state, platform: "darwin" as const,
    rootBindings: { CODEX_HOME: codex, TEMPERANCE_STATE: state },
    runtimeUrls: { bridge: "http://127.0.0.1:1", omniroute: "http://127.0.0.1:1", console: "http://127.0.0.1:1", auto_proxy: "http://127.0.0.1:1", pulse: "http://127.0.0.1:1" },
    io: nodeObservationIO, signal: AbortSignal.timeout(1000),
  };
  const txDir = join(state, "transactions", installed.txid);
  const manifestPath = join(txDir, "surface-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const transformLeaf = manifest.leaves.find((leaf: { record_id: string }) => leaf.record_id === transform.id);
  const artifactPath = join(txDir, transformLeaf.output);
  expect(typeof transformLeaf.preimage).toBe("string");
  const preimagePath = join(txDir, transformLeaf.preimage);
  const observe = async () => (await runInstallSection({ ...context, signal: AbortSignal.timeout(1000) })).checks.find((check) => check.id === transform.id);
  expect(await observe()).toMatchObject({ condition: "PASS", reason_code: "TRANSFORM_MANAGED_BLOCK_MATCH" });
  return { repository, codex, state, transform, generator, installed, roots, context, txDir, manifestPath, artifactPath, preimagePath, observe };
}

test("managed transform doctor consumes a complete current-lock binding without treating user-owned context as product drift", async () => {
  const { codex, state, transform, generator, installed, roots, context } = await installedTransformFixture();
  let section = await runInstallSection(context);
  expect(section.checks.find((check) => check.id === transform.id)).toMatchObject({ condition: "PASS", reason_code: "TRANSFORM_MANAGED_BLOCK_MATCH" });
  expect(section.checks.find((check) => check.id === generator.id)).toMatchObject({ condition: "UNAVAILABLE", reason_code: "GENERATOR_UNAVAILABLE" });

  const boundOutput = readFileSync(join(codex, "AGENTS.md"), "utf8");
  const changedContext = boundOutput.replace("user prefix", "user adjusted prefix");
  writeFileSync(join(codex, "AGENTS.md"), changedContext, { mode: 0o600 });
  chmodSync(join(codex, "AGENTS.md"), 0o600);
  section = await runInstallSection(context);
  expect(section.checks.find((check) => check.id === transform.id)).toMatchObject({ condition: "PASS", reason_code: "TRANSFORM_MANAGED_BLOCK_MATCH_USER_CONTEXT_CHANGED" });

  writeFileSync(join(codex, "AGENTS.md"), boundOutput, { mode: 0o600 });
  chmodSync(join(codex, "AGENTS.md"), 0o600);
  const rolledBack = await rollbackTransaction(installed.txid, state, lifecycleIo(), { resolveRoot: roots });
  expect(rolledBack.status).toBe("committed");
  section = await runInstallSection(context);
  expect(section.checks.find((check) => check.id === transform.id)).toMatchObject({ condition: "UNAVAILABLE", reason_code: "TRANSFORM_BINDING_UNAVAILABLE" });
});

describe("managed transform doctor rejects unavailable proof and reports bound integrity drift", () => {
  type Fixture = Awaited<ReturnType<typeof installedTransformFixture>>;
  const editJson = (path: string, edit: (value: any) => void): void => {
    const value = JSON.parse(readFileSync(path, "utf8"));
    edit(value);
    writeFileSync(path, JSON.stringify(value));
  };

  test("a different current lock cannot reuse a committed transform binding", async () => {
    const fixture = await installedTransformFixture();
    editJson(join(fixture.repository, "package/install-surface/install-surface-manifest.lock.json"), (lock) => {
      lock.records.find((record: SurfaceRecord) => record.id === fixture.transform.id).authority.isa = "ISC-999";
    });
    expect(await fixture.observe()).toMatchObject({ condition: "UNAVAILABLE", reason_code: "TRANSFORM_BINDING_UNAVAILABLE" });
  });

  const unavailableBindings: Array<[string, (fixture: Fixture) => void]> = [
    ["missing surface manifest", ({ manifestPath }) => rmSync(manifestPath)],
    ["corrupt surface manifest", ({ manifestPath }) => writeFileSync(manifestPath, "{broken")],
    ["surface manifest digest mismatch", ({ manifestPath }) => writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n`)],
    ["missing receipt", ({ txDir }) => rmSync(join(txDir, "receipt.json"))],
    ["corrupt receipt", ({ txDir }) => writeFileSync(join(txDir, "receipt.json"), "{broken")],
    ["receipt inventory mismatch", ({ txDir }) => editJson(join(txDir, "receipt.json"), (receipt) => { receipt.inventory_digest = hash("other lock"); })],
    ["uncommitted receipt", ({ txDir }) => editJson(join(txDir, "receipt.json"), (receipt) => { receipt.status = "aborted"; })],
    ["missing installed step in receipt", ({ txDir }) => editJson(join(txDir, "receipt.json"), (receipt) => { receipt.steps = []; })],
    ["missing COMPLETE journal entry", ({ txDir }) => editJson(join(txDir, "journal.json"), (entries) => {
      entries.splice(entries.findIndex((entry: { kind: string }) => entry.kind === "COMPLETE"), 1);
    })],
    ["missing COMMIT_STEP journal entry", ({ txDir }) => editJson(join(txDir, "journal.json"), (entries) => {
      entries.splice(entries.findIndex((entry: { kind: string }) => entry.kind === "COMMIT_STEP"), 1);
    })],
    ["symlinked surface manifest", ({ manifestPath }) => {
      renameSync(manifestPath, `${manifestPath}.target`);
      symlinkSync(`${manifestPath}.target`, manifestPath);
    }],
    ["hard-linked receipt", ({ txDir }) => linkSync(join(txDir, "receipt.json"), join(txDir, "receipt-link.json"))],
  ];
  for (const [name, mutate] of unavailableBindings) {
    test(`${name} makes transform binding UNAVAILABLE`, async () => {
      const fixture = await installedTransformFixture();
      mutate(fixture);
      expect(await fixture.observe()).toMatchObject({ condition: "UNAVAILABLE", reason_code: "TRANSFORM_BINDING_UNAVAILABLE" });
    });
  }

  const unavailableInputs: Array<[string, (fixture: Fixture) => void]> = [
    ["missing bound artifact", ({ artifactPath }) => rmSync(artifactPath)],
    ["symlinked bound artifact", ({ artifactPath }) => {
      renameSync(artifactPath, `${artifactPath}.target`);
      symlinkSync(`${artifactPath}.target`, artifactPath);
    }],
    ["hard-linked bound artifact", ({ artifactPath }) => linkSync(artifactPath, `${artifactPath}.link`)],
    ["missing bound preimage", ({ preimagePath }) => rmSync(preimagePath)],
    ["symlinked bound preimage", ({ preimagePath }) => {
      renameSync(preimagePath, `${preimagePath}.target`);
      symlinkSync(`${preimagePath}.target`, preimagePath);
    }],
    ["hard-linked bound preimage", ({ preimagePath }) => linkSync(preimagePath, `${preimagePath}.link`)],
    ["unsafe source template", ({ repository }) => {
      const templatePath = join(repository, "templates/codex.AGENTS.md");
      renameSync(templatePath, `${templatePath}.target`);
      symlinkSync(`${templatePath}.target`, templatePath);
    }],
    ["unsafe destination", ({ codex }) => {
      const destination = join(codex, "AGENTS.md");
      renameSync(destination, `${destination}.target`);
      symlinkSync(`${destination}.target`, destination);
    }],
  ];
  for (const [name, mutate] of unavailableInputs) {
    test(`${name} is UNAVAILABLE even with a completed receipt`, async () => {
      const fixture = await installedTransformFixture();
      mutate(fixture);
      expect(await fixture.observe()).toMatchObject({ condition: "UNAVAILABLE", actionable: true });
    });
  }

  const integrityDrift: Array<[string, string, (fixture: Fixture) => void]> = [
    ["bound artifact content corruption", "TRANSFORM_BINDING_ARTIFACT_DRIFT", ({ artifactPath }) => writeFileSync(artifactPath, "corrupt bound output\n")],
    ["bound artifact mode drift", "TRANSFORM_BINDING_ARTIFACT_DRIFT", ({ artifactPath }) => chmodSync(artifactPath, 0o644)],
    ["bound preimage content corruption", "TRANSFORM_BINDING_PREIMAGE_DRIFT", ({ preimagePath }) => writeFileSync(preimagePath, "corrupt prior content\n")],
    ["bound preimage mode drift", "TRANSFORM_BINDING_PREIMAGE_DRIFT", ({ preimagePath }) => chmodSync(preimagePath, 0o644)],
    ["destination mode drift", "TRANSFORM_MODE_DRIFT", ({ codex }) => chmodSync(join(codex, "AGENTS.md"), 0o644)],
  ];
  for (const [name, reasonCode, mutate] of integrityDrift) {
    test(`${name} is DRIFT after trustworthy binding`, async () => {
      const fixture = await installedTransformFixture();
      mutate(fixture);
      expect(await fixture.observe()).toMatchObject({ condition: "DRIFT", reason_code: reasonCode, actionable: true });
    });
  }
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

describe("doctor report schema compilation and validation", () => {
  test("v1 schema compiles and validates a captured report instance", async () => {
    const repository = tempRoot("schema-v1-repo-");
    writeFixtureLock(repository, []);
    const report = await runDoctor({ repositoryRoot: repository, stateRoot: tempRoot("schema-v1-state-") });
    expect(validateDoctorReport(report)).toBe(true);
  });

  test("v2 schema compiles and validates a captured report instance", () => {
    const v2Report: DoctorReportV2 = {
      schema: "temperance.doctor.report.v2",
      version: { major: 2, minor: 0 },
      generated_at: new Date().toISOString(),
      scope: { complete: true, requested_sections: ["install", "privacy", "manifest", "runtime", "host"] },
      trustworthy: true,
      overall_condition: "PASS",
      exit_code: 0,
      inventory_digest: "sha256:" + "a".repeat(64),
      sections: [],
    };
    expect(validateDoctorReportV2(v2Report)).toBe(true);
  });

  test("v2 schema rejects report with missing inventory_digest", () => {
    const badReport = {
      schema: "temperance.doctor.report.v2",
      version: { major: 2, minor: 0 },
      generated_at: new Date().toISOString(),
      scope: { complete: true, requested_sections: [] },
      trustworthy: true,
      overall_condition: "PASS",
      exit_code: 0,
      sections: [],
    };
    expect(validateDoctorReportV2(badReport)).toBe(false);
  });

  test("v2 schema rejects report with wrong schema constant", () => {
    const badReport = {
      schema: "temperance.doctor.report.v1",
      version: { major: 2, minor: 0 },
      generated_at: new Date().toISOString(),
      scope: { complete: true, requested_sections: [] },
      trustworthy: true,
      overall_condition: "PASS",
      exit_code: 0,
      inventory_digest: "sha256:" + "a".repeat(64),
      sections: [],
    };
    expect(validateDoctorReportV2(badReport)).toBe(false);
  });
});


describe("reviewed COPY observations", () => {
  async function observe(record: SurfaceRecord, setup: (home: string, repository: string) => void, io?: Partial<ObservationIO>) {
    const repository = tempRoot("doctor-copy-contract-");
    const home = join(repository, "home");
    mkdirSync(home);
    setup(home, repository);
    writeFixtureLock(repository, [record]);
    const before = snapshot(repository);
    const report = await runDoctor({ repositoryRoot: repository, sections: ["install"], platform: "darwin", rootBindings: { HOME: home }, io: { ...nodeObservationIO, ...io } });
    expect(snapshot(repository)).toBe(before);
    return report.sections[0].checks[0];
  }

  test("file observes declared bytes rather than equally drifted mutable sources", async () => {
    const check = await observe(copyRecord("surface.copy", "source.txt", "target.txt"), (home, repo) => {
      writeFileSync(join(repo, "source.txt"), "drifted\n");
      writeFileSync(join(home, "target.txt"), "drifted\n");
    });
    expect(check.condition).toBe("DRIFT");
    expect(check.reason_code).toBe("COPY_DIGEST_DRIFT");
  });

  test("matching destination passes without reading an absent source", async () => {
    const check = await observe(copyRecord("surface.copy", "absent.txt", "target.txt"), (home) => {
      writeFileSync(join(home, "target.txt"), "same\n");
      chmodSync(join(home, "target.txt"), 0o644);
    });
    expect(check.condition).toBe("PASS");
    expect(check.reason_code).toBe("COPY_DECLARATION_MATCH");
  });

  test("mode-only drift is visible", async () => {
    const check = await observe(copyRecord("surface.copy", "source.txt", "target.txt"), (home) => {
      writeFileSync(join(home, "target.txt"), "same\n");
      chmodSync(join(home, "target.txt"), 0o755);
    });
    expect(check.condition).toBe("DRIFT");
    expect(check.reason_code).toBe("COPY_MODE_DRIFT");
  });

  test("legacy declarations cannot claim reviewed content", async () => {
    const record = copyRecord("surface.copy", "source.txt", "target.txt");
    if (record.class !== "COPY") throw new Error("fixture");
    delete record.verification.expected;
    const check = await observe(record, (home, repo) => {
      writeFileSync(join(repo, "source.txt"), "same\n");
      writeFileSync(join(home, "target.txt"), "same\n");
    });
    expect(check.condition).toBe("WARN");
    expect(check.reason_code).toBe("COPY_EXPECTATION_UNDECLARED");
  });

  function treeRecord(): SurfaceRecord {
    const record = copyRecord("surface.tree", "source-tree", "target");
    if (record.class !== "COPY") throw new Error("fixture");
    record.verification.expected = {
      kind: "tree", files: { "a.txt": hash("a"), "bin/run": hash("run") },
      modes: { "a.txt": "0644", "bin/run": "0755" },
    };
    return record;
  }
  function tree(home: string) {
    mkdirSync(join(home, "target/bin"), { recursive: true });
    writeFileSync(join(home, "target/a.txt"), "a");
    chmodSync(join(home, "target/a.txt"), 0o644);
    writeFileSync(join(home, "target/bin/run"), "run");
    chmodSync(join(home, "target/bin/run"), 0o755);
  }

  test("complete tree verifies declared digests and executable modes", async () => {
    expect((await observe(treeRecord(), tree)).condition).toBe("PASS");
  });

  test("extra or missing leaves invalidate the exact inventory", async () => {
    for (const extra of [true, false]) {
      const check = await observe(treeRecord(), (home) => {
        tree(home);
        if (extra) writeFileSync(join(home, "target/unknown.txt"), "unknown");
        else rmSync(join(home, "target/a.txt"));
      });
      expect(check.condition).toBe("DRIFT");
      expect(check.reason_code).toBe("COPY_LEAF_SET_DRIFT");
    }
  });

  test("extra leaves are rejected before reading any tree content", async () => {
    let reads = 0;
    const check = await observe(treeRecord(), (home) => {
      tree(home);
      writeFileSync(join(home, "target/unknown.txt"), "unknown");
    }, { readBytes: async () => { reads++; throw new Error("unexpected content read"); } });
    expect(check.reason_code).toBe("COPY_LEAF_SET_DRIFT");
    expect(reads).toBe(0);
  });

  test("a legacy declaration without modes cannot pass", async () => {
    const record = treeRecord();
    if (record.class !== "COPY" || record.verification.expected?.kind !== "tree") throw new Error("fixture");
    delete record.verification.expected.modes;
    expect((await observe(record, tree)).reason_code).toBe("COPY_EXPECTATION_UNDECLARED");
  });

  test("tree content drift is checked after complete inventory", async () => {
    const check = await observe(treeRecord(), (home) => {
      tree(home);
      writeFileSync(join(home, "target/bin/run"), "changed");
    });
    expect(check.reason_code).toBe("COPY_DIGEST_DRIFT");
  });

  test("invalid UTF-8 bytes do not match replacement-character text", async () => {
    const record = copyRecord("surface.copy", "source.txt", "target.txt");
    if (record.class !== "COPY") throw new Error("fixture");
    record.verification.expected = { kind: "file", sha256: hash("\uFFFD"), mode: "0644" };
    const check = await observe(record, (home) => {
      writeFileSync(join(home, "target.txt"), new Uint8Array([255]));
      chmodSync(join(home, "target.txt"), 0o644);
    });
    expect(check.reason_code).toBe("COPY_DIGEST_DRIFT");
  });

  test("symlink leaves and symlink destination ancestors fail without following links", async () => {
    for (const ancestor of [true, false]) {
      const check = await observe(treeRecord(), (home) => {
        tree(home);
        if (ancestor) {
          mkdirSync(join(home, "elsewhere"));
          rmSync(join(home, "target"), { recursive: true });
          symlinkSync(join(home, "elsewhere"), join(home, "target"));
        } else {
          rmSync(join(home, "target/a.txt"));
          symlinkSync(join(home, "target/bin/run"), join(home, "target/a.txt"));
        }
      });
      expect(check.condition).toBe("FAIL");
      expect(check.reason_code).toBe("COPY_DESTINATION_UNSAFE");
    }
  });
});
