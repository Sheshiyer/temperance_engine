import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../src/lifecycle/copy-tree.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { assertSurfacePrior, captureSurfaceManifest, loadSurfaceManifest, rollbackSurface, validateSurfaceManifest, verifySurfaceOutput, type PreparedSurface, type SurfaceManifest } from "../src/lifecycle/prepared-surface.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "surface-prepared-")); roots.push(root);
  const home = join(root, "home"), tx = join(root, "transaction");
  await fs.mkdir(home); await fs.mkdir(tx);
  const io: LifecycleIO = {
    mkdir: async (p, o) => { await fs.mkdir(p, o); }, writeFile: (p, d) => fs.writeFile(p, d), readFile: p => fs.readFile(p, "utf8"),
    readdir: p => fs.readdir(p), rm: (p, o) => fs.rm(p, o), lstat: p => fs.lstat(p), chmod: (p, m) => fs.chmod(p, m),
    rename: (a, b) => fs.rename(a, b), realpath: p => fs.realpath(p), now: () => new Date(0),
    writeFileAtomic: async (p, d) => { await fs.mkdir(dirname(p), { recursive: true }); await fs.writeFile(p, d, { flag: "wx" }); },
    execFile: async () => { throw new Error("no processes"); }, fetch: async () => { throw new Error("no network"); },
  };
  await fs.writeFile(join(home, "AGENTS.md"), "outside\nold managed block\n"); await fs.chmod(join(home, "AGENTS.md"), 0o640);
  await fs.writeFile(join(home, "unknown.txt"), "unknown sentinel\n");
  const output = (id: string, file: string, content: string, mode: number | "preserve"): PreparedSurface => ({
    step: { step_id: id, record_id: id, mode: "install", ownership: id === "transform" ? "managed-block" : "exclusive-path",
      destination: { root_token: "HOME", relative_path: file, ownership: { kind: id === "transform" ? "managed-block" : "exclusive-path" } } },
    content, expected_hash: sha256(content), expected_mode: mode,
  });
  const prepared = new Map([
    ["transform", output("transform", "AGENTS.md", "outside\nnew managed block\n", "preserve")],
    ["copy", output("copy", "new.ts", "export const value = 1;\n", 0o755)],
  ]);
  const resolveRoot = () => home;
  const capture = () => captureSurfaceManifest(io, tx, prepared, resolveRoot);
  const install = async (manifest: SurfaceManifest) => {
    for (const leaf of manifest.leaves) {
      await assertSurfacePrior(io, leaf, resolveRoot);
      await fs.writeFile(join(home, leaf.relative_path), prepared.get(leaf.step_id)!.content);
      await fs.chmod(join(home, leaf.relative_path), leaf.expected_mode);
      await verifySurfaceOutput(io, leaf, join(home, leaf.relative_path), home);
    }
  };
  return { root, home, tx, io, prepared, capture, install, resolveRoot };
}

test("mixed prepared COPY/TRANSFORM restores exact bytes/modes, removes created leaf, preserves unknown sentinel", async () => {
  const f = await fixture(), manifest = await f.capture();
  expect(manifest.schema).toBe("temperance.surface-manifest.v1");
  expect(manifest.leaves[0].expected_mode).toBe(0o640);
  expect(manifest.leaves[1].prior_hash).toBeNull();
  expect(await loadSurfaceManifest(f.io, f.tx)).toEqual(manifest);
  await f.install(manifest);
  await rollbackSurface(f.io, f.tx, manifest, f.resolveRoot);
  expect(await fs.readFile(join(f.home, "AGENTS.md"), "utf8")).toBe("outside\nold managed block\n");
  expect((await fs.lstat(join(f.home, "AGENTS.md"))).mode & 0o7777).toBe(0o640);
  expect(await fs.exists(join(f.home, "new.ts"))).toBe(false);
  expect(await fs.readFile(join(f.home, "unknown.txt"), "utf8")).toBe("unknown sentinel\n");
  await rollbackSurface(f.io, f.tx, manifest, f.resolveRoot);
});

test("preserve mode defaults to 0644 only for absent destination", async () => {
  const f = await fixture(); await fs.rm(join(f.home, "AGENTS.md"));
  expect((await f.capture()).leaves[0].expected_mode).toBe(0o644);
});

for (const corruption of ["output", "output-mode", "preimage", "preimage-mode", "destination", "destination-mode"] as const) {
  test(`${corruption} drift refuses entire rollback before any compensation`, async () => {
    const f = await fixture(), manifest = await f.capture(); await f.install(manifest);
    const leaf = manifest.leaves[0];
    const path = corruption.startsWith("output") ? join(f.tx, leaf.output) : corruption.startsWith("preimage") ? join(f.tx, leaf.preimage!) : join(f.home, leaf.relative_path);
    if (corruption.endsWith("mode")) await fs.chmod(path, 0o700); else await fs.writeFile(path, "unrecognized change\n");
    await expect(rollbackSurface(f.io, f.tx, manifest, f.resolveRoot)).rejects.toThrow("DRIFT");
    // Created leaf is processed first in reverse order: it must remain untouched.
    expect(await fs.readFile(join(f.home, "new.ts"), "utf8")).toBe(f.prepared.get("copy")!.content);
    if (!corruption.startsWith("destination")) expect(await fs.readFile(join(f.home, "AGENTS.md"), "utf8")).toBe(f.prepared.get("transform")!.content);
  });
}

for (const link of ["symbolic", "hard"] as const) {
  test(`${link} links rejected for destinations and recovery artifacts`, async () => {
    const f = await fixture();
    const target = join(f.home, "AGENTS.md"), backup = join(f.root, "external");
    await fs.rename(target, backup);
    if (link === "symbolic") await fs.symlink(backup, target); else await fs.link(backup, target);
    await expect(f.capture()).rejects.toThrow("LINK_REJECTED");
    expect(await fs.exists(join(f.tx, "surface-manifest.json"))).toBe(false);
    await fs.rm(target); await fs.rename(backup, target);
    const manifest = await f.capture(); await f.install(manifest);
    const preimage = join(f.tx, manifest.leaves[0].preimage!);
    await fs.rename(preimage, backup);
    if (link === "symbolic") await fs.symlink(backup, preimage); else await fs.link(backup, preimage);
    await expect(rollbackSurface(f.io, f.tx, manifest, f.resolveRoot)).rejects.toThrow("LINK_REJECTED");
    expect(await fs.exists(join(f.home, "new.ts"))).toBe(true);
  });
}

test("malformed, legacy, traversing, collision and unsafe mode manifests fail closed", async () => {
  const f = await fixture(), manifest = await f.capture();
  for (const mutate of [
    (v: any) => { v.schema = "temperance.copy-manifest.v2"; },
    (v: any) => { v.leaves[0].relative_path = "../escape"; },
    (v: any) => { v.leaves[0].output = "../output"; },
    (v: any) => { v.leaves[0].expected_mode = 0o4644; },
    (v: any) => { v.leaves[0].prior_mode = -1; },
    (v: any) => { v.leaves[1].relative_path = "agents.md"; },
    (v: any) => { v.leaves[1].relative_path = "AGENTS.md/child"; },
  ]) {
    const value = structuredClone(manifest); mutate(value);
    expect(() => validateSurfaceManifest(value)).toThrow();
  }
  await fs.writeFile(join(f.tx, "surface-manifest.json"), "{");
  await expect(loadSurfaceManifest(f.io, f.tx)).rejects.toThrow();
  await fs.rm(join(f.tx, "surface-manifest.json"));
  expect(await loadSurfaceManifest(f.io, f.tx)).toBeNull();
});

test("capture rejects changed prepared bytes, special bits, and non-text before publication", async () => {
  for (const mutation of ["hash", "binary", "mode"] as const) {
    const f = await fixture();
    if (mutation === "hash") f.prepared.get("copy")!.content += "tampered";
    if (mutation === "binary") { f.prepared.get("copy")!.content = "\0"; f.prepared.get("copy")!.expected_hash = sha256("\0"); }
    if (mutation === "mode") {
      const lstat = f.io.lstat;
      f.io.lstat = async path => { const stat = await lstat(path); if (path === join(f.home, "AGENTS.md")) stat.mode |= 0o4000; return stat; };
    }
    await expect(f.capture()).rejects.toThrow();
    expect(await fs.exists(join(f.tx, "surface-manifest.json"))).toBe(false);
    expect(await fs.exists(join(f.home, "new.ts"))).toBe(false);
  }
});

test("failed restore staging leaves destination intact and retry ignores old stages", async () => {
  const f = await fixture(), manifest = await f.capture(); await f.install(manifest);
  let fail = true;
  const io = { ...f.io, chmod: async (path: string, mode: number) => {
    if (path.includes(".temperance-surface-restore-") && fail) { fail = false; throw new Error("injected chmod failure"); }
    await f.io.chmod(path, mode);
  } };
  await expect(rollbackSurface(io, f.tx, manifest, f.resolveRoot)).rejects.toThrow("injected chmod failure");
  expect(await fs.readFile(join(f.home, "AGENTS.md"), "utf8")).toBe(f.prepared.get("transform")!.content);
  const stale = (await fs.readdir(f.home)).filter(p => p.startsWith(".temperance-surface-restore-"));
  expect(stale.length).toBe(1);
  await rollbackSurface(io, f.tx, manifest, f.resolveRoot);
  expect(await fs.exists(join(f.home, stale[0]))).toBe(true);
  expect((await fs.lstat(join(f.home, "AGENTS.md"))).mode & 0o777).toBe(0o640);
});

test("capture never overwrites existing transaction artifacts", async () => {
  const f = await fixture(); await f.capture();
  await expect(f.capture()).rejects.toThrow("SURFACE_ARTIFACT_EXISTS");
});

test("resolved root aliases cannot target the same leaf or transaction artifacts", async () => {
  const f = await fixture();
  const copy = f.prepared.get("copy")!;
  copy.step.destination.root_token = "CODEX_HOME";
  copy.step.destination.relative_path = "AGENTS.md";
  await expect(f.capture()).rejects.toThrow("SURFACE_DESTINATION_COLLISION");
  expect(await fs.readdir(f.tx)).toEqual([]);
  copy.step.destination.relative_path = "surface-manifest.json";
  await expect(captureSurfaceManifest(f.io, f.tx, f.prepared, token => token === "CODEX_HOME" ? f.tx : f.home)).rejects.toThrow("SURFACE_DESTINATION_COLLISION");
});

test("stage link replacement is rejected before chmod or destination promotion", async () => {
  const f = await fixture(), manifest = await f.capture(); await f.install(manifest);
  const victim = join(f.root, "external.txt"); await fs.writeFile(victim, "external\n"); await fs.chmod(victim, 0o600);
  const io = { ...f.io, writeFileAtomic: async (path: string, content: string) => {
    if (path.includes(".temperance-surface-restore-")) await fs.symlink(victim, path);
    else await f.io.writeFileAtomic(path, content);
  } };
  await expect(rollbackSurface(io, f.tx, manifest, f.resolveRoot)).rejects.toThrow("LINK_REJECTED");
  expect((await fs.lstat(victim)).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(victim, "utf8")).toBe("external\n");
  expect(await fs.readFile(join(f.home, "AGENTS.md"), "utf8")).toBe(f.prepared.get("transform")!.content);
});
