import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../lib/runtime.mjs", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../bin/temperance-shadow", import.meta.url), "utf8");
const businessRuntime = await readFile(new URL("../lib/business-runtime.mjs", import.meta.url), "utf8");
const businessWrapper = await readFile(new URL("../bin/temperance-business", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

const forbiddenRuntimePatterns = [
  /node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /\b(?:writeFile|appendFile|mkdir|rename|unlink|rm)\b/,
  /process\.env\.HERMES/,
  /HERMES_RUNNER_EXECUTE_DIRECTIVES/,
];

for (const pattern of forbiddenRuntimePatterns) {
  assert.doesNotMatch(runtime, pattern, `runtime contains forbidden capability ${pattern}`);
}

for (const pattern of [/\bcurl\b/, /\bssh\b/, /\bsystemctl\b/, /\bln\s+-s\b/, /command-code/, /\bkimi\b/]) {
  assert.doesNotMatch(`${wrapper}\n${businessWrapper}`, pattern, `wrapper contains forbidden capability ${pattern}`);
}

for (const pattern of [/node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)/, /\bfetch\s*\(/, /\bWebSocket\b/, /process\.env\.HERMES/]) {
  assert.doesNotMatch(businessRuntime, pattern, `business runtime contains forbidden capability ${pattern}`);
}

assert.deepEqual(packageJson.dependencies, { docx: "9.5.1", jszip: "3.10.1" });
assert.deepEqual(packageJson.optionalDependencies, undefined);
for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  assert.equal(packageJson.scripts[hook], undefined, `${hook} must not exist`);
}
assert.equal(packageJson.engines.node, ">=22 <23");
assert.equal(packageLock.lockfileVersion, 3);
assert.equal(packageLock.packages[""].engines.node, ">=22 <23");
assert.equal(packageLock.packages[""].dependencies.docx, "9.5.1");
assert.equal(packageLock.packages[""].dependencies.jszip, "3.10.1");
console.log(JSON.stringify({ ok: true, gate: "standalone:audit", networkImports: 0, childProcessImports: 0, businessRenderer: "docx-js@9.5.1", archiveEngine: "jszip@3.10.1" }));
