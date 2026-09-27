// Disposable offline CLI guard. This is not an operating-system sandbox.
import * as fs from "node:fs";
import * as path from "node:path";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { plugin } from "bun";
import { mock } from "bun:test";

const root = process.cwd();
const readFile = fs.readFileSync;
const manifest = JSON.parse(readFile(path.join(root, "runtime-files.json"), "utf8"));
const allowed = new Map<string, string>(manifest.map((entry: any) => [path.join(root, entry.path), entry.sha256]));
const builtins = new Set(builtinModules.flatMap(name => [name.replace(/^node:/, ""), `node:${name.replace(/^node:/, "")}`]));
// Bun.resolveSync must not run inside onResolve: that re-enters the runtime
// resolver on Bun 1.3.13. Precompute literal edges before registering the hook.
const resolutions = new Map<string, string>();
for (const file of allowed.keys()) {
  if (!/\.(?:[cm]?js|ts)$/u.test(file) || file.endsWith(".d.ts")) continue;
  let edges;
  try { edges = new Bun.Transpiler({ loader: file.endsWith(".ts") ? "ts" : "js" }).scan(readFile(file, "utf8")).imports; }
  catch { continue; } // Unused package test sources are not startup entrypoints.
  for (const edge of edges) {
    if (builtins.has(edge.path)) continue;
    try { resolutions.set(`${file}\0${edge.path}`, Bun.resolveSync(edge.path, path.dirname(file))); }
    catch { /* A missing literal edge is rejected if runtime requests it. */ }
  }
}
function confined(candidate: unknown): void {
  if (typeof candidate !== "string") throw new Error("CLI_FS_PATH_TYPE");
  const rel = path.relative(root, path.resolve(candidate));
  if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) throw new Error("CLI_FS_OUTSIDE_FIXTURE");
}
const guarded: any = { ...fs };
for (const name of ["readFileSync", "writeFileSync", "appendFileSync", "mkdirSync", "rmdirSync", "rmSync", "unlinkSync", "readdirSync", "statSync", "lstatSync", "existsSync", "openSync", "chmodSync", "realpathSync"] as const) {
  const original: any = fs[name];
  guarded[name] = (...args: any[]) => { confined(args[0]); return original(...args); };
  if (name === "realpathSync") guarded[name].native = (...args: any[]) => { confined(args[0]); return original.native(...args); };
}
const rename = fs.renameSync;
guarded.renameSync = (from: string, to: string) => { confined(from); confined(to); rename(from, to); };
const readSync = fs.readSync;
guarded.readSync = (...args: any[]) => { if (args[0] !== 0) throw new Error("CLI_FD_READ_FORBIDDEN"); return (readSync as any)(...args); };
mock.module("node:fs", () => guarded);
const forbidden = () => { throw new Error("CLI_EXTERNAL_EFFECT_FORBIDDEN"); };
mock.module("node:child_process", () => ({ execFileSync: forbidden, spawnSync: forbidden, exec: forbidden, spawn: forbidden }));
mock.module("node:http", () => ({ createServer: forbidden, request: forbidden, get: forbidden }));
mock.module("node:https", () => ({ createServer: forbidden, request: forbidden, get: forbidden }));
mock.module("node:net", () => ({ Socket: class { constructor() { forbidden(); } }, createServer: forbidden, connect: forbidden, createConnection: forbidden, isIP: () => 0 }));
mock.module("node:tls", () => ({ connect: forbidden, createServer: forbidden }));
mock.module("node:dns", () => ({ lookup: forbidden, resolve: forbidden }));
globalThis.fetch = forbidden;
Bun.serve = forbidden as any;
Bun.connect = forbidden as any;
Bun.listen = forbidden as any;
await plugin({ name: "offline-cli-installed-files-only", setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
    if (builtins.has(args.path)) return;
    const target = allowed.has(args.path) ? args.path : resolutions.get(`${args.importer}\0${args.path}`);
    if (!target) throw new Error("CLI_DEPENDENCY_MISSING");
    if (!allowed.has(target)) throw new Error("CLI_UNDECLARED_IMPORT");
    if (createHash("sha256").update(readFile(target)).digest("hex") !== allowed.get(target)) throw new Error("CLI_IMPORT_HASH_DRIFT");
    return;
  });
} });
