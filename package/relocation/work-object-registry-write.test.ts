// package/relocation/work-object-registry-write.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeWorkObjectEntry } from "./work-object-registry-write";
import type { CanonicalRegistry } from "./packet-evidence";

let dir: string;
let registryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "work-object-registry-write-fixture-"));
  registryPath = join(dir, "work-object-registry.v1.json");
});

afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe("writeWorkObjectEntry", () => {
  test("creates a new registry file with the WorkObject and a matching sourceInventory entry, when none existed", () => {
    writeWorkObjectEntry(registryPath, {
      workObject: {
        workId: "sapling:client-x",
        name: "Client X",
        kind: "sapling",
        sourceRefs: ["repo:client-x"],
      },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    expect(registry.workObjects).toHaveLength(1);
    expect(registry.workObjects[0].workId).toBe("sapling:client-x");
    expect(registry.sourceInventory).toHaveLength(1);
    expect(registry.sourceInventory[0]).toEqual({
      path: "/vault/thoughtseed/client-x",
      workRefs: ["sapling:client-x"],
    });
  });

  test("appends to an existing registry file without disturbing prior entries", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:existing", name: "Existing", kind: "sapling", sourceRefs: ["repo:existing"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/existing", workRefs: ["sapling:existing"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    writeWorkObjectEntry(registryPath, {
      workObject: { workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });

    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    expect(registry.workObjects.map((w) => w.workId)).toEqual(["sapling:existing", "sapling:client-x"]);
    expect(registry.sourceInventory.map((s) => s.path)).toEqual([
      "/vault/thoughtseed/existing",
      "/vault/thoughtseed/client-x",
    ]);
  });

  test("refuses to overwrite on a workId collision", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:client-x", name: "Client X (old)", kind: "sapling", sourceRefs: ["repo:client-x"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/client-x", workRefs: ["sapling:client-x"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    expect(() =>
      writeWorkObjectEntry(registryPath, {
        workObject: { workId: "sapling:client-x", name: "Client X (new)", kind: "sapling", sourceRefs: ["repo:client-x"] },
        sourceInventoryPath: "/vault/thoughtseed/client-x-2",
      }),
    ).toThrow("work_object_already_exists:sapling:client-x");
  });

  test("refuses to overwrite on a sourceInventory path collision, even with a distinct workId", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/client-x", workRefs: ["sapling:client-x"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    expect(() =>
      writeWorkObjectEntry(registryPath, {
        workObject: { workId: "sapling:client-y", name: "Client Y", kind: "sapling", sourceRefs: ["repo:client-y"] },
        sourceInventoryPath: "/vault/thoughtseed/client-x",
      }),
    ).toThrow("source_inventory_path_already_exists:/vault/thoughtseed/client-x");
  });

  test("writes the registry file and its directory with owner-only permissions", () => {
    writeWorkObjectEntry(registryPath, {
      workObject: { workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });
    expect(statSync(registryPath).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
