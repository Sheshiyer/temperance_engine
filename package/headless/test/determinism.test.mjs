import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runtime = new URL("../lib/runtime.mjs", import.meta.url).pathname;
const envelope = new URL("../fixtures/hermes-shadow-attempt.v1.json", import.meta.url).pathname;
const policy = new URL("../share/policy.v1.json", import.meta.url).pathname;
const manifest = new URL("../fixtures/runtime-manifest.test.json", import.meta.url).pathname;

async function invoke() {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    runtime,
    "--envelope", envelope,
    "--policy", policy,
    "--manifest", manifest,
  ], {
    env: { PATH: "", LANG: "C", LC_ALL: "C" },
    encoding: "utf8",
  });
  assert.equal(stderr, "");
  return stdout;
}

test("two isolated processes emit byte-identical decisions with no backend PATH", async () => {
  const first = await invoke();
  const second = await invoke();
  assert.equal(first, second);
  const result = JSON.parse(first);
  assert.equal(result.route.logicalBackend, "kimi");
  assert.equal(result.route.backendAvailability, "not_probed");
});
