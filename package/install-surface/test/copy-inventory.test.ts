import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  lstatSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertWorkingCopyMatches,
  buildCopyInventory,
  copyFileMode,
} from "../src/copy-inventory.ts";
import { canonical } from "../src/canonical-json.ts";
import { reconstructPinnedInventory, assertSafeInventoryWriteTarget } from "../scripts/sync-copy-expectations.ts";
import type { SurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function copyRecord(source = "payload"): SurfaceRecord {
  return {
    id: "surface.payload",
    owner: "temperance-engine",
    class: "COPY",
    source,
    destination: {
      root_token: "HOME",
      relative_path: "installed",
      ownership: { kind: "exclusive-path" },
    },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["test"], required: true },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
  };
}

function fixture(): { repositoryRoot: string; revision: string; records: SurfaceRecord[] } {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "copy-inventory-"));
  roots.push(repositoryRoot);
  git(repositoryRoot, ["init"]);
  git(repositoryRoot, ["config", "user.email", "temperance-test@example.invalid"]);
  git(repositoryRoot, ["config", "user.name", "Temperance Test"]);
  mkdirSync(join(repositoryRoot, "payload/nested"), { recursive: true });
  writeFileSync(join(repositoryRoot, "payload/a.txt"), "alpha\n");
  writeFileSync(join(repositoryRoot, "payload/nested/run"), "#!/usr/bin/env bun\n");
  chmodSync(join(repositoryRoot, "payload/nested/run"), 0o755);
  git(repositoryRoot, ["add", "payload"]);
  git(repositoryRoot, ["commit", "-m", "fixture"]);
  return {
    repositoryRoot,
    revision: git(repositoryRoot, ["rev-parse", "HEAD"]),
    records: [copyRecord()],
  };
}

test("builds modes and byte digests from a supplied full Git commit", () => {
  const f = fixture();
  const result = buildCopyInventory({
    repositoryRoot: f.repositoryRoot,
    revision: f.revision,
    records: f.records,
  });

  expect(result.provenance.revision).toBe(f.revision);
  expect(result.expectations.get("surface.payload")).toEqual({
    kind: "tree",
    files: {
      "a.txt": "sha256:b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
      "nested/run": "sha256:1af9f724d86a6268aa72c8a187248c1d06937501784da400b5a3199270bc3c41",
    },
    modes: {
      "a.txt": "0644",
      "nested/run": "0755",
    },
  });
  expect(result.provenance.records[0].source_object).toMatch(/^[a-f0-9]{40}$/);
});

test("refuses abbreviated revisions and untracked source leaves during check", () => {
  const f = fixture();
  expect(() => buildCopyInventory({
    repositoryRoot: f.repositoryRoot,
    revision: f.revision.slice(0, 12),
    records: f.records,
  })).toThrow("COPY_INVENTORY_REVISION_REQUIRED");

  const built = buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision: f.revision, records: f.records });
  writeFileSync(join(f.repositoryRoot, "payload/untracked.txt"), "do not admit\n");
  expect(() => assertWorkingCopyMatches({
    repositoryRoot: f.repositoryRoot,
    records: f.records,
    expectations: built.expectations,
  })).toThrow("COPY_INVENTORY_WORKTREE_MISMATCH");
});

test("preserves a literal __proto__ leaf through inventory, canonicalization, and checkout checking", () => {
  const f = fixture();
  writeFileSync(join(f.repositoryRoot, "payload/__proto__"), "ordinary reviewed leaf\n");
  git(f.repositoryRoot, ["add", "payload/__proto__"]);
  git(f.repositoryRoot, ["commit", "-m", "prototype leaf"]);
  const revision = git(f.repositoryRoot, ["rev-parse", "HEAD"]);

  const built = buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision, records: f.records });
  const expected = built.expectations.get("surface.payload");
  expect(expected?.kind).toBe("tree");
  if (expected?.kind !== "tree") throw new Error("tree expectation required");
  expect(Object.hasOwn(expected.files, "__proto__")).toBe(true);
  expect(Object.keys(expected.files)).toContain("__proto__");
  expect(canonical(expected)).toContain('"__proto__"');
  expect(() => assertWorkingCopyMatches({
    repositoryRoot: f.repositoryRoot,
    records: f.records,
    expectations: built.expectations,
  })).not.toThrow();
});

test("denies a protected descendant before it can become a tree expectation", () => {
  const f = fixture();
  mkdirSync(join(f.repositoryRoot, "payload/secrets"));
  writeFileSync(join(f.repositoryRoot, "payload/secrets/ULTRA_PRIVATE"), "must never enter a public inventory\n");
  git(f.repositoryRoot, ["add", "payload/secrets"]);
  git(f.repositoryRoot, ["commit", "-m", "protected descendant"]);
  const revision = git(f.repositoryRoot, ["rev-parse", "HEAD"]);

  let message = "";
  try {
    buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision, records: f.records });
  } catch (error) {
    message = String(error);
  }
  expect(message).toContain("DENY_POLICY_MATCH:secret-material");
  expect(message).not.toContain("ULTRA_PRIVATE");
});

test("working-copy checking rejects a symlinked source ancestor", () => {
  const f = fixture();
  const built = buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision: f.revision, records: f.records });
  const outside = mkdtempSync(join(tmpdir(), "copy-inventory-outside-"));
  roots.push(outside);
  const moved = join(outside, "payload");
  renameSync(join(f.repositoryRoot, "payload"), moved);
  symlinkSync(moved, join(f.repositoryRoot, "payload"));

  expect(() => assertWorkingCopyMatches({
    repositoryRoot: f.repositoryRoot,
    records: f.records,
    expectations: built.expectations,
  })).toThrow("COPY_INVENTORY_LINK_REJECTED");
});

test("working-copy checking rejects special permission bits instead of masking them", () => {
  expect(() => copyFileMode(0o104755)).toThrow("COPY_INVENTORY_MODE_UNSUPPORTED");
  expect(copyFileMode(0o100755)).toBe("0755");
});

test("inventory ignores inherited Git repository locator variables", () => {
  const f = fixture();
  const attacker = fixture();
  writeFileSync(join(attacker.repositoryRoot, "payload/a.txt"), "attacker bytes\n");
  git(attacker.repositoryRoot, ["add", "payload/a.txt"]);
  git(attacker.repositoryRoot, ["commit", "-m", "attacker tree"]);
  const priorDir = process.env.GIT_DIR;
  const priorWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = join(attacker.repositoryRoot, ".git");
  process.env.GIT_WORK_TREE = attacker.repositoryRoot;
  try {
    const built = buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision: f.revision, records: f.records });
    const expected = built.expectations.get("surface.payload");
    expect(expected?.kind).toBe("tree");
    if (expected?.kind !== "tree") throw new Error("tree expectation required");
    expect(expected.files["a.txt"]).toBe("sha256:b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060");
  } finally {
    if (priorDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorDir;
    if (priorWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorWorkTree;
  }
});

test("safe inventory writers reject symlink and hardlink publication targets", () => {
  const root = mkdtempSync(join(tmpdir(), "copy-inventory-output-"));
  roots.push(root);
  const targetDirectory = join(root, "package/install-surface");
  mkdirSync(targetDirectory, { recursive: true });
  const outside = join(root, "outside.json");
  writeFileSync(outside, "outside\n");
  const linked = join(targetDirectory, "copy-expectations.provenance.json");
  symlinkSync(outside, linked);
  expect(() => assertSafeInventoryWriteTarget(root, linked)).toThrow("COPY_INVENTORY_WRITE_TARGET_INVALID");

  rmSync(linked);
  const hardlinked = join(targetDirectory, "copy-expectations.provenance.json");
  linkSync(outside, hardlinked);
  expect(lstatSync(hardlinked).nlink).toBeGreaterThan(1);
  expect(() => assertSafeInventoryWriteTarget(root, hardlinked)).toThrow("COPY_INVENTORY_WRITE_TARGET_INVALID");
});

test("per-record provenance retains old revisions and reconstructs before trust", () => {
  const f = fixture();
  const first = buildCopyInventory({ repositoryRoot: f.repositoryRoot, revision: f.revision, records: f.records });
  const record = f.records[0]!;
  if (record.class !== "COPY") throw new Error("fixture");
  record.verification.expected = first.expectations.get(record.id)!;
  const pinned = reconstructPinnedInventory(f.repositoryRoot, f.records, first.provenance);
  expect(pinned.provenance.schema).toBe("temperance.install-surface.copy-expectations-provenance.v2");
  expect(pinned.provenance.records[0]!.revision).toBe(f.revision);
  expect(canonical(pinned.expectations.get(record.id))).toBe(canonical(record.verification.expected));
  writeFileSync(join(f.repositoryRoot, "payload/a.txt"), "later bytes\n");
  git(f.repositoryRoot, ["add", "payload"]); git(f.repositoryRoot, ["commit", "-m", "later"]);
  expect(reconstructPinnedInventory(f.repositoryRoot, f.records, pinned.provenance).provenance).toEqual(pinned.provenance);
  for (const mutation of [
    (p: any) => p.records.push(p.records[0]),
    (p: any) => p.records.splice(0, 1),
    (p: any) => p.records[0].id = "unknown",
    (p: any) => p.records[0].revision = "HEAD",
    (p: any) => p.records[0].tree = "a".repeat(40),
    (p: any) => p.records[0].expectation_digest = `sha256:${"a".repeat(64)}`,
    (p: any) => p.records[0].extra = true,
    (p: any) => p.schema = "unknown",
  ]) {
    const changed = structuredClone(pinned.provenance); mutation(changed);
    expect(() => reconstructPinnedInventory(f.repositoryRoot, f.records, changed)).toThrow("COPY_INVENTORY_PROVENANCE_INVALID");
  }
});


test("scoped generator merges new committed source without changing retained fragment bytes", () => {
  const f = fixture();
  const directory = join(f.repositoryRoot,"package/install-surface/fragments"); mkdirSync(directory,{recursive:true});
  const document=(records: SurfaceRecord[])=>({schema:"temperance.install-surface.fragment.v1",schema_uri:"https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",version:{major:1,minor:0},records});
  writeFileSync(join(directory,"old.json"),JSON.stringify(document(f.records),null,2)+"\n");
  const script=resolve(import.meta.dir,"../scripts/sync-copy-expectations.ts");
  const run=(revision:string,extra:string[])=>execFileSync(process.execPath,[script,"--repository-root",f.repositoryRoot,"--revision",revision,...extra],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const legacyResult=JSON.parse(run(f.revision,["--write"]));
  expect(legacyResult.schema).toBe("temperance.install-surface.copy-inventory-result.v1");
  expect(legacyResult.revision).toBe(f.revision);
  expect(legacyResult.tree).toBe(git(f.repositoryRoot,["rev-parse",`${f.revision}^{tree}`]));
  expect(legacyResult.requested_revision).toBe(f.revision);
  writeFileSync(join(directory,"old.json"),JSON.stringify(JSON.parse(readFileSync(join(directory,"old.json"),"utf8")))+"  \n");
  const before=readFileSync(join(directory,"old.json"),"utf8");
  mkdirSync(join(f.repositoryRoot,"extra"));writeFileSync(join(f.repositoryRoot,"extra/file"),"optional source\n");git(f.repositoryRoot,["add","extra"]);git(f.repositoryRoot,["commit","-m","new optional source"]);const next=git(f.repositoryRoot,["rev-parse","HEAD"]);
  const extra=copyRecord("extra");extra.id="surface.extra";
  writeFileSync(join(directory,"extra.json"),JSON.stringify(document([extra]),null,2)+"\n");
  const scopedResult=JSON.parse(run(next,["--only","surface.extra","--write"]));
  expect(scopedResult.schema).toBe("temperance.install-surface.copy-inventory-result.v1");
  expect(scopedResult.provenance_schema).toBe("temperance.install-surface.copy-expectations-provenance.v2");
  expect(scopedResult.requested_revision).toBe(next);
  expect(Object.hasOwn(scopedResult,"revision")).toBe(false);
  expect(Object.hasOwn(scopedResult,"tree")).toBe(false);
  expect(readFileSync(join(directory,"old.json"),"utf8")).toBe(before);
  const provenance=JSON.parse(readFileSync(join(f.repositoryRoot,"package/install-surface/copy-expectations.provenance.json"),"utf8"));
  expect(provenance.records.find((r:any)=>r.id==="surface.payload").revision).toBe(f.revision);
  expect(provenance.records.find((r:any)=>r.id==="surface.extra").revision).toBe(next);
  expect(()=>run(next,["--check"])).not.toThrow();
  const unchanged=readFileSync(join(directory,"extra.json"),"utf8");
  expect(()=>run(next,["--only","unknown","--write"])).toThrow();
  expect(readFileSync(join(directory,"extra.json"),"utf8")).toBe(unchanged);
  writeFileSync(join(f.repositoryRoot,"payload/a.txt"),"drift\n");
  expect(()=>run(next,["--check"])).toThrow();
  expect(()=>run(next,["--only","surface.extra","--check"])).not.toThrow();
});
