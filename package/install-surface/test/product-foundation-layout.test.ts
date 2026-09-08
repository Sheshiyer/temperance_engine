import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { compileFragments } from "../src/compile.ts";
import { loadLock } from "../src/load.ts";
import { executePlan, rollbackTransaction } from "../src/lifecycle/executor.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { createPlan } from "../src/lifecycle/planner.ts";

const checkout = resolve(import.meta.dir, "../../..");
const fragmentDirectory = join(checkout, "package/install-surface/fragments");
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function compileInstalledFoundation() {
  const complete = compileFragments(
    readdirSync(fragmentDirectory)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => ({ name, contents: readFileSync(join(fragmentDirectory, name), "utf8") })),
    {
      isaText: readFileSync(join(checkout, "ISA.md"), "utf8"),
      requirementsText: readFileSync(join(checkout, ".planning/REQUIREMENTS.md"), "utf8"),
      priorLock: loadLock(join(checkout, "package/install-surface/install-surface-manifest.lock.json")).lockObject,
    },
  );
  const ids = new Set([
    "enrichment.public-pipeline",
    "router.enrichment-runtime-dependency",
    "router.governed-runtime",
    "router.gsd-backup-helper",
  ]);
  return {
    ...complete,
    lockObject: { ...complete.lockObject, records: complete.lockObject.records.filter((record) => ids.has(record.id)) },
    semanticIds: complete.semanticIds.filter((id) => ids.has(id)),
  };
}

function lifecycleIo(): LifecycleIO {
  return {
    mkdir: (path, options) => fs.mkdir(path, options),
    writeFile: (path, data) => fs.writeFile(path, data),
    readFile: (path) => fs.readFile(path, "utf8"),
    readdir: (path) => fs.readdir(path),
    rm: (path, options) => fs.rm(path, options),
    lstat: (path) => fs.lstat(path),
    chmod: (path, mode) => fs.chmod(path, mode),
    rename: (from, to) => fs.rename(from, to),
    realpath: (path) => fs.realpath(path),
    now: () => new Date("2026-09-08T00:00:00.000Z"),
    writeFileAtomic: async (path, data, options) => {
      const staged = `${path}.test-stage`;
      await fs.writeFile(staged, data, { mode: options?.mode });
      if (options?.mode !== undefined) await fs.chmod(staged, options.mode);
      await fs.rename(staged, path);
    },
    execFile: async () => { throw new Error("process execution is not part of the lifecycle fixture"); },
    fetch: async () => { throw new Error("network is not part of the lifecycle fixture"); },
  };
}

test("declared lifecycle copies make the installed routing import and backup helper usable, then restore their prior bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "temperance-product-foundation-"));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  const home = join(root, "home");
  const shimDirectory = join(root, "bin");
  await fs.mkdir(repository, { recursive: true });
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(shimDirectory, { recursive: true });

  // Synthetic source only: lifecycle reads this disposable copy instead of the
  // checkout, and no process uses a host runtime path or service.
  for (const source of ["package/enrich", "package/router", "package/bin/te-backup-if-changed"]) {
    const destination = join(repository, source);
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.cp(join(checkout, source), destination, { recursive: true, dereference: false });
  }

  const priorClassifier = join(stateRoot, "runtime/router/task-classification.ts");
  const priorHelper = join(stateRoot, "bin/te-backup-if-changed");
  await fs.mkdir(dirname(priorClassifier), { recursive: true });
  await fs.mkdir(dirname(priorHelper), { recursive: true });
  await fs.writeFile(priorClassifier, "prior classifier bytes\n");
  await fs.chmod(priorClassifier, 0o640);
  await fs.writeFile(priorHelper, "prior helper bytes\n");
  await fs.chmod(priorHelper, 0o600);

  const compiled = compileInstalledFoundation();
  expect(compiled.lockObject.records.map((record) => record.id).sort()).toEqual([
    "enrichment.public-pipeline",
    "router.enrichment-runtime-dependency",
    "router.governed-runtime",
    "router.gsd-backup-helper",
  ]);
  expect(compiled.lockObject.records.find((record) => record.id === "enrichment.public-pipeline")?.depends_on)
    .toContain("router.enrichment-runtime-dependency");
  expect(compiled.lockObject.records.find((record) => record.id === "router.governed-runtime")?.depends_on)
    .toContain("router.gsd-backup-helper");

  const plan = createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin" });
  const io = lifecycleIo();
  const installed = await executePlan({
    stateRoot,
    repositoryRoot: repository,
    io,
    plan,
    compileResult: compiled,
    verb: "install",
    profile: "default",
    resolveRoot: (token) => {
      if (token !== "TEMPERANCE_STATE") throw new Error(`unexpected root token: ${token}`);
      return stateRoot;
    },
  });
  expect(installed.status).toBe("committed");

  const installedRouting = join(stateRoot, "runtime/enrichment/stages/routing.ts");
  const installedHelper = join(stateRoot, "bin/te-backup-if-changed");
  expect((await fs.lstat(installedHelper)).mode & 0o7777).toBe(0o755);
  writeFileSync(join(shimDirectory, "command-code"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(shimDirectory, "bun"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(join(shimDirectory, "command-code"), 0o755);
  chmodSync(join(shimDirectory, "bun"), 0o755);

  const routingProbe = [
    `import { routing } from ${JSON.stringify(installedRouting)};`,
    "const result = routing({ input: { prompt: 'refactor the installed module' } });",
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");
  const routingResult = JSON.parse(execFileSync(process.execPath, ["--no-env-file", "--config=/dev/null", "-e", routingProbe], {
    cwd: root,
    env: { PATH: `${shimDirectory}:/usr/bin:/bin`, HOME: home },
    encoding: "utf8",
  }));
  expect(routingResult).toMatchObject({
    degraded: false,
    line: expect.stringContaining("task=long-horizon"),
  });
  expect(routingResult.line).toContain("portfolio=noesis-build");

  const generated = join(root, "generated", "wrapper.md");
  await fs.mkdir(dirname(generated), { recursive: true });
  await fs.writeFile(generated, "wrapper bytes\n");
  const backupOutput = execFileSync(installedHelper, [generated, "--tag", "product-foundation", "--apply"], {
    cwd: root,
    env: { PATH: `${shimDirectory}:/usr/bin:/bin`, HOME: home },
    encoding: "utf8",
  });
  expect(backupOutput).toContain("te-backup-if-changed: created:");
  expect((await fs.readdir(dirname(generated))).some((name) => name.startsWith("wrapper.md.bak.product-foundation-"))).toBe(true);

  const rollback = await rollbackTransaction(installed.txid, stateRoot, io, {
    resolveRoot: (token) => {
      if (token !== "TEMPERANCE_STATE") throw new Error(`unexpected root token: ${token}`);
      return stateRoot;
    },
  });
  expect(rollback.status).toBe("committed");
  expect(await fs.readFile(priorClassifier, "utf8")).toBe("prior classifier bytes\n");
  expect((await fs.lstat(priorClassifier)).mode & 0o7777).toBe(0o640);
  expect(await fs.readFile(priorHelper, "utf8")).toBe("prior helper bytes\n");
  expect((await fs.lstat(priorHelper)).mode & 0o7777).toBe(0o600);
});
