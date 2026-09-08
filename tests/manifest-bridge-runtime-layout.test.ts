import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const launcher = resolve(import.meta.dir, "../scripts/temperance-manifest-bridge-launchd.sh");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "manifest-source-layout-")); roots.push(root);
  const repository = join(root, "repository with spaces");
  const installed = join(root, "state/runtime/manifest-bridge");
  for (const packageRoot of [join(repository, "package/manifest-bridge"), installed]) {
    mkdirSync(join(packageRoot, "src"), { recursive: true });
    writeFileSync(join(packageRoot, "src/cli.ts"), "// synthetic source-path fixture; never executed\n");
  }
  return { root, repository, installed };
}

function source(root: string, repository: string, runtime?: string) {
  const result = Bun.spawnSync(["/bin/bash", launcher, "source"], {
    cwd: root,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TEMPERANCE_ENGINE_ROOT: repository,
      ...(runtime === undefined ? {} : { TEMPERANCE_MANIFEST_RUNTIME_ROOT: runtime }) },
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test("read-only launcher selection supports repository and explicit installed package roots", () => {
  const f = fixture(), before = readdirSync(f.root, { recursive: true }).sort();
  const repositoryPackage = join(f.repository, "package/manifest-bridge");
  expect(source(f.root, f.repository)).toEqual({ code: 0, stdout: `${repositoryPackage}/src/cli.ts\n${repositoryPackage}\n`, stderr: "" });
  // The default repository can be absent when an explicit installed root is set.
  expect(source(f.root, join(f.root, "absent-repository"), f.installed)).toEqual({ code: 0, stdout: `${f.installed}/src/cli.ts\n${f.installed}\n`, stderr: "" });
  expect(readdirSync(f.root, { recursive: true }).sort()).toEqual(before);
  const text = readFileSync(launcher, "utf8");
  expect(text).toContain('<string>${CLI_SOURCE}</string>');
  expect(text).toContain('<key>WorkingDirectory</key><string>${RUNTIME_ROOT}</string>');
});

test("missing or relative explicit source fails without choosing another layout", () => {
  const f = fixture();
  for (const runtime of [join(f.root, "missing-package"), "state/runtime/manifest-bridge"]) {
    const result = source(f.root, f.repository, runtime);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no service was changed");
  }
});
