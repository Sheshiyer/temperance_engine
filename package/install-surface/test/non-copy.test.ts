import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { MANAGED_TEMPLATE_DEFAULT_MODE, prepareNonCopy, spliceManagedBlock } from "../src/lifecycle/non-copy.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import type { RegenerateSurfaceRecord, TransformSurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function io(): LifecycleIO {
  return {
    mkdir: async (path, options) => mkdirSync(path, options),
    writeFile: async (path, data) => writeFileSync(path, data, "utf8"),
    readFile: async (path) => readFileSync(path, "utf8"),
    readdir: async (path) => readdirSync(path),
    rm: async (path, options) => rmSync(path, options),
    lstat: async (path) => lstatSync(path),
    chmod: async (path, mode) => chmodSync(path, mode),
    rename: async (from, to) => renameSync(from, to),
    realpath: async (path) => (await import("node:fs")).realpathSync(path),
    now: () => new Date("2026-09-07T00:00:00.000Z"),
    writeFileAtomic: async (path, data) => writeFileSync(path, data, "utf8"),
    fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); },
    execFile: async () => { throw new Error("PROCESS_FORBIDDEN"); },
  };
}

function sha(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function transformRecord(template: string): TransformSurfaceRecord {
  return {
    id: "configuration.codex-managed-block",
    owner: "temperance-engine",
    class: "TRANSFORM",
    source: "templates/codex.AGENTS.md",
    destination: {
      root_token: "CODEX_HOME",
      relative_path: "AGENTS.md",
      ownership: { kind: "managed-block", marker_id: "temperance-engine" },
    },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-770" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "adapter", adapter_id: "managed-template-v1", expected: { kind: "file", sha256: sha(template), mode: "0644" } },
    rollback: { policy: "restore-backup" },
  };
}

describe("managed-template-v1", () => {
  test("renders one current block while preserving the exact outside bytes and existing mode", async () => {
    const root = tempRoot("non-copy-render-");
    const repository = join(root, "repository");
    const codex = join(root, "codex");
    mkdirSync(join(repository, "templates"), { recursive: true });
    mkdirSync(codex, { recursive: true });
    const template = "NOESIS\nmanaged source\n";
    writeFileSync(join(repository, "templates/codex.AGENTS.md"), template, { mode: 0o644 });
    const existing = "prefix\r\n<!-- temperance:managed:start temperance-engine -->\nold\n<!-- temperance:managed:end temperance-engine -->\r\nsuffix\r\n";
    writeFileSync(join(codex, "AGENTS.md"), existing, { mode: 0o600 });
    chmodSync(join(codex, "AGENTS.md"), 0o600);

    const prepared = await prepareNonCopy(transformRecord(template), { io: io(), repositoryRoot: repository, resolveRoot: (token) => {
      if (token !== "CODEX_HOME") throw new Error("unexpected root");
      return codex;
    } });

    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(prepared.content).toBe("prefix\r\n<!-- temperance:managed:start temperance-engine -->\nNOESIS\nmanaged source\n<!-- temperance:managed:end temperance-engine -->\r\nsuffix\r\n");
    expect(prepared.destination_before).toEqual({ hash: createHash("sha256").update(existing, "utf8").digest("hex"), mode: 0o600 });
    expect(prepared.mode).toEqual({ kind: "preserve-existing", absent_mode: MANAGED_TEMPLATE_DEFAULT_MODE });
    expect(readFileSync(join(codex, "AGENTS.md"), "utf8")).toBe(existing);
    expect(lstatSync(join(codex, "AGENTS.md")).mode & 0o777).toBe(0o600);
  });

  test("appends a single bounded block for an absent destination", async () => {
    const root = tempRoot("non-copy-absent-");
    const repository = join(root, "repository");
    const codex = join(root, "codex");
    mkdirSync(join(repository, "templates"), { recursive: true });
    mkdirSync(codex, { recursive: true });
    const template = "managed\n";
    writeFileSync(join(repository, "templates/codex.AGENTS.md"), template, { mode: 0o644 });

    const prepared = await prepareNonCopy(transformRecord(template), { io: io(), repositoryRoot: repository, resolveRoot: () => codex });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(prepared.content).toBe("<!-- temperance:managed:start temperance-engine -->\nmanaged\n<!-- temperance:managed:end temperance-engine -->\n");
    expect(prepared.mode.absent_mode).toBe(0o644);
  });

  test("rejects malformed or duplicate target markers before a destination write", () => {
    expect(() => spliceManagedBlock("<!-- temperance:managed:start temperance-engine -->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:end temperance-engine -->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:start temperance-engine-->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:end temperance-engine-->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:start temperance-engine -->\nold\n<!-- temperance:managed:end temperance-engine -- >\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:start temperance-engine -->\na\n<!-- temperance:managed:end temperance-engine -->\n<!-- temperance:managed:start temperance-engine -->\nb\n<!-- temperance:managed:end temperance-engine -->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:start temperance-engine -->\n<!-- temperance:managed:start another-owner -->\nprivate\n<!-- temperance:managed:end another-owner -->\n<!-- temperance:managed:end temperance-engine -->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
    expect(() => spliceManagedBlock("<!-- temperance:managed:start another-owner -->\n<!-- temperance:managed:start temperance-engine -->\nold\n<!-- temperance:managed:end another-owner -->\n<!-- temperance:managed:end temperance-engine -->\n", "temperance-engine", "new")).toThrow("MANAGED_BLOCK_MARKERS_INVALID");
  });

  test("rejects template digest drift and never reads from the caller cwd", async () => {
    const root = tempRoot("non-copy-source-");
    const repository = join(root, "repository");
    const codex = join(root, "codex");
    mkdirSync(join(repository, "templates"), { recursive: true });
    mkdirSync(codex, { recursive: true });
    writeFileSync(join(repository, "templates/codex.AGENTS.md"), "changed\n", { mode: 0o644 });
    await expect(prepareNonCopy(transformRecord("reviewed\n"), { io: io(), repositoryRoot: repository, resolveRoot: () => codex })).rejects.toThrow("TRANSFORM_SOURCE_HASH_DRIFT");
  });

  test("rejects a source whose mode or inode changes while its bytes are read", async () => {
    const root = tempRoot("non-copy-source-race-");
    const repository = join(root, "repository");
    const codex = join(root, "codex");
    mkdirSync(join(repository, "templates"), { recursive: true });
    mkdirSync(codex, { recursive: true });
    const template = "reviewed\n";
    const source = join(repository, "templates/codex.AGENTS.md");
    writeFileSync(source, template, { mode: 0o644 });
    const base = io();
    const racing = {
      ...base,
      readFile: async (path: string) => {
        const content = await base.readFile(path);
        if (path === source) chmodSync(source, 0o600);
        return content;
      },
    };
    await expect(prepareNonCopy(transformRecord(template), { io: racing, repositoryRoot: repository, resolveRoot: () => codex })).rejects.toThrow("TRANSFORM_SOURCE_READ_DRIFT");
  });
});

test("manifest-zone-v1 remains explicitly unavailable and produces no synthetic bytes", async () => {
  const record: RegenerateSurfaceRecord = {
    id: "manifest.zone-project-state", owner: "temperance-engine", class: "REGENERATE",
    destination: { root_token: "TEMPERANCE_STATE", relative_path: "state/manifest-zone.json", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-771" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: false },
    verification: { method: "semantic-probe", generator_id: "manifest-zone-v1" }, rollback: { policy: "regenerate" },
  };
  const result = await prepareNonCopy(record, { io: io(), repositoryRoot: undefined, resolveRoot: () => tempRoot("non-copy-regenerate-") });
  expect(result).toEqual({ status: "unavailable", code: "GENERATOR_UNAVAILABLE", producer_id: "manifest-zone-v1", reason: "GENERATOR_UNAVAILABLE: manifest-zone-v1 has no source-owned producer" });
});
