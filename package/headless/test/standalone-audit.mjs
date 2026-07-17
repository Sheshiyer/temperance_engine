import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../lib/runtime.mjs", import.meta.url), "utf8");
const wrapper = await readFile(new URL("../bin/temperance-shadow", import.meta.url), "utf8");
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
  assert.doesNotMatch(wrapper, pattern, `wrapper contains forbidden capability ${pattern}`);
}

assert.deepEqual(packageJson.dependencies, undefined);
assert.deepEqual(packageJson.optionalDependencies, undefined);
for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  assert.equal(packageJson.scripts[hook], undefined, `${hook} must not exist`);
}
assert.equal(packageJson.engines.node, ">=22 <23");
assert.equal(packageLock.lockfileVersion, 3);
assert.equal(packageLock.packages[""].engines.node, ">=22 <23");
console.log(JSON.stringify({ ok: true, gate: "standalone:audit", networkImports: 0, childProcessImports: 0 }));
