import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBareComposition, inspectCompositionV2 } from "../src/engine.ts";
import { PRIMARY_CLIENTS, guideClientInstallation } from "../src/modules/clients.ts";

// Qualification is explicit and disposable. No authentication, model call,
// callback subscription, personal installation or background service is used.
const pins = [
  { client: "codex-cli" as const, version: "0.166.0", integrity: "sha512-2Szlp1l1cz5TX1ccpX4Zok3DZrot9xeZe0km+6/1v8JmqxADwyJxKBJah4dBymkwtS25j/u6dipJusTOI97Z8Q==" },
  { client: "claude-code" as const, version: "2.1.316", integrity: "sha512-i3BpzyDkcCPnsa0CSkWgxGPs7WMsyqDkxkqT0SDxyEC5XMIxEmcUmluWRHG9VSeBY8Vyv+l9X34JvJ/Bj54nBQ==" },
];
const args = process.argv.slice(2);
if (args.some((arg, index) => arg !== "--clients" && arg !== "--output" && args[index - 1] !== "--output")) throw new Error("QUALIFICATION_ARGUMENT_INVALID");
const outputIndex = args.indexOf("--output");
const output = outputIndex < 0 ? undefined : args[outputIndex + 1];
if (outputIndex >= 0 && (!output || output.startsWith("--"))) throw new Error("QUALIFICATION_OUTPUT_REQUIRED");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
async function command(argv: string[], cwd = root) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, DISABLE_UPDATES: "1", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
  const timer = setTimeout(() => child.kill(), 240_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    // Raw command logs are not receipt fields.
    if (code !== 0) throw new Error("QUALIFICATION_COMMAND_FAILED: " + argv[0] + " (exit " + code + ")");
    if (stdout.length > 1_000_000 || stderr.length > 1_000_000) throw new Error("QUALIFICATION_OUTPUT_EXCEEDED");
    return stdout.trim();
  } finally { clearTimeout(timer); }
}
const composition = createBareComposition("qualification-plant");
const inspection = inspectCompositionV2(composition, []);
if (inspection.readiness !== "core-available") throw new Error("BARE_STARTUP_FAILED");
const clients: Array<Record<string, unknown>> = [];
let failed = false;
for (const pin of pins) {
  if (!args.includes("--clients")) { clients.push({ client: pin.client, status: "not-requested", native_callback: "unobserved" }); continue; }
  // npm's prefix/lock identity must use the physical path (macOS /var is an alias).
  const target = await realpath(await mkdtemp(join(tmpdir(), "temperance-client-qualification-")));
  try {
    await writeFile(join(target, "package.json"), JSON.stringify({ name: "temperance-disposable-client-target", version: "0.0.0", private: true }));
    const guide = guideClientInstallation(pin.client, pin.version, pin.integrity, "install");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const observedIntegrity = await command([npm, "view", guide.distribution + "@" + pin.version, "dist.integrity", "--registry=https://registry.npmjs.org"]);
    if (observedIntegrity !== pin.integrity) throw new Error("CLIENT_PACKAGE_INTEGRITY_CHANGED");
    await command([npm, "install", "--global=false", "--save-exact", "--prefix", target, "--registry=https://registry.npmjs.org", "--no-audit", "--no-fund", guide.distribution + "@" + pin.version], target);
    const lock = JSON.parse(await readFile(join(target, "package-lock.json"), "utf8"));
    const pkg = lock.packages["node_modules/" + guide.distribution];
    if (pkg?.version !== pin.version || pkg?.integrity !== pin.integrity) throw new Error("CLIENT_LOCK_PIN_MISMATCH");
    const executable = join(target, "node_modules", ".bin", PRIMARY_CLIENTS[pin.client].executable + (process.platform === "win32" ? ".cmd" : ""));
    const observed = await command([executable, "--version"], target);
    if (observed.length > 160 || !observed.includes(pin.version) || !/^[\w .()\-+]+$/.test(observed)) throw new Error("CLIENT_VERSION_UNEXPECTED");
    clients.push({ client: pin.client, distribution: guide.distribution, version: pin.version, integrity: pin.integrity, observed_version: observed, fresh_disposable_install: "passed", native_callback: "unobserved", guidance_digest: guide.guidance_digest });
  } catch (error) {
    failed = true;
    clients.push({ client: pin.client, version: pin.version, fresh_disposable_install: "failed", reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CLIENT_QUALIFICATION_FAILED", native_callback: "unobserved" });
  } finally { await rm(target, { recursive: true, force: true }); }
}
const receipt = {
  schema: "temperance.source-qualification.v1", recorded_at: new Date().toISOString(),
  source_commit: await command(["git", "rev-parse", "HEAD"]),
  source_dirty: (await command(["git", "status", "--porcelain"])) !== "",
  platform: { os: platform(), release: release(), arch: arch(), bun: Bun.version, node: process.version },
  bare_startup: "passed", clients,
  evidence_scope: "bare source startup and optional disposable official-package installation/version probes",
  semantic_acceptance: false, sandbox_isolation: "not-established", installed_profile: "unchanged", public_release: "held",
};
const text = JSON.stringify(receipt, null, 2) + "\n";
if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, text, { flag: "wx" }); }
process.stdout.write(text);
if (failed) process.exitCode = 1;
