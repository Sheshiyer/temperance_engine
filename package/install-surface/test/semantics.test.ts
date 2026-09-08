import { describe, expect, test } from "bun:test";

import {
  assertDestination,
  assertRepositoryRelativeSource,
} from "../src/path-policy.ts";
import { assertSemanticValidity } from "../src/semantic-validation.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "../src/types.ts";

function copyRecord(id = "surface.alpha", path = "targets/alpha"): SurfaceRecord {
  return {
    id,
    owner: "temperance-engine",
    class: "COPY",
    source: `package/${id}`,
    destination: {
      root_token: "TEMPERANCE_STATE",
      relative_path: path,
      ownership: { kind: "exclusive-path" },
    },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
  };
}

describe("stable semantic records", () => {
  test("stable IDs with owners and classes pass", () => {
    expect(() => assertSemanticValidity([copyRecord()])).not.toThrow();
  });

  test("duplicate stable IDs fail closed", () => {
    expect(() => assertSemanticValidity([
      copyRecord("surface.alpha", "targets/alpha"),
      copyRecord("surface.alpha", "targets/beta"),
    ])).toThrow("SEMANTIC_ID_DUPLICATE");
  });
});

describe("ownership", () => {
  test("exact ownership conflicts", () => {
    expect(() => assertSemanticValidity([
      copyRecord("surface.alpha", "targets/alpha"),
      copyRecord("surface.beta", "targets/alpha"),
    ])).toThrow("OWNERSHIP_OVERLAP");
  });

  test("ancestor and descendant ownership conflicts", () => {
    expect(() => assertSemanticValidity([
      copyRecord("surface.alpha", "targets"),
      copyRecord("surface.beta", "targets/beta"),
    ])).toThrow("OWNERSHIP_OVERLAP");
  });

  test("distinct managed-block markers sharing one file are rejected until multi-block transactions exist", () => {
    const left = {
      ...copyRecord("surface.alpha", "config.txt"),
      class: "TRANSFORM",
      destination: { root_token: "TEMPERANCE_STATE", relative_path: "config.txt", ownership: { kind: "managed-block", marker_id: "alpha" } },
      verification: { method: "adapter", adapter_id: "managed-template-v1" },
    } as SurfaceRecord;
    const right = {
      ...left,
      id: "surface.beta",
      destination: { ...left.destination, ownership: { kind: "managed-block", marker_id: "beta" } },
    } as SurfaceRecord;
    expect(() => assertSemanticValidity([left, right])).toThrow("OWNERSHIP_OVERLAP");
  });
});

describe("path and unsafe-paths", () => {
  test.each(["/absolute", "../escape", "a/../escape", "a\\b", "a//b", "a/./b"])(
    "rejects unsafe repository source %s",
    (path) => expect(() => assertRepositoryRelativeSource(path)).toThrow("SOURCE_PATH_INVALID"),
  );

  test("rejects unknown destination roots", () => {
    expect(() => assertDestination({
      root_token: "UNRATIFIED_ROOT",
      relative_path: "safe/path",
      ownership: { kind: "exclusive-path" },
    })).toThrow("DESTINATION_ROOT_UNKNOWN");
  });
});

describe("semantic", () => {
  test("dependency cycles fail closed", () => {
    const left = { ...copyRecord("surface.alpha", "a"), depends_on: ["surface.beta"] };
    const right = { ...copyRecord("surface.beta", "b"), depends_on: ["surface.alpha"] };
    expect(() => assertSemanticValidity([left, right])).toThrow("DEPENDENCY_CYCLE");
  });

  test("unsafe transform adapter combinations fail closed", () => {
    const unsafe = {
      ...copyRecord(),
      class: "TRANSFORM",
      verification: { method: "adapter", adapter_id: "sh -c arbitrary" },
    } as unknown as SurfaceRecord;
    expect(() => assertSemanticValidity([unsafe])).toThrow("ADAPTER_COMBINATION_UNSAFE");
  });

  test("destination identity reuse requires an explicit migration", () => {
    const priorRecord = copyRecord("surface.previous", "shared/path");
    const priorLock: InstallSurfaceLockV1 = {
      schema: "temperance.install-surface.lock.v1",
      schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
      version: { major: 1, minor: 0 },
      records: [priorRecord],
    };
    const replacement = copyRecord("surface.replacement", "shared/path");
    expect(() => assertSemanticValidity([replacement], priorLock)).toThrow("IDENTITY_MIGRATION_REQUIRED");
    replacement.identity_migration = { from_id: "surface.previous", to_id: "surface.replacement" };
    expect(() => assertSemanticValidity([replacement], priorLock)).not.toThrow();
  });

  test("rejects unsafe and colliding tree expectation keys", () => {
    const unsafe = copyRecord() as SurfaceRecord & {
      verification: {
        method: "sha256";
        expected: { kind: "tree"; files: Record<string, string> };
      };
    };
    unsafe.verification = {
      method: "sha256",
      expected: {
        kind: "tree",
        files: {
          "nested/../escape.ts": `sha256:${"a".repeat(64)}`,
          "Readme.md": `sha256:${"b".repeat(64)}`,
          "README.md": `sha256:${"c".repeat(64)}`,
        },
      },
    };

    expect(() => assertSemanticValidity([unsafe])).toThrow("COPY_EXPECTATION_INVALID");
  });

  test("rejects case-folded file ancestors and directory aliases in tree expectations", () => {
    for (const files of [
      {
        "A": `sha256:${"a".repeat(64)}`,
        "a/b.txt": `sha256:${"b".repeat(64)}`,
      },
      {
        "Dir/a.txt": `sha256:${"a".repeat(64)}`,
        "dir/b.txt": `sha256:${"b".repeat(64)}`,
      },
    ]) {
      const unsafe = copyRecord() as SurfaceRecord & {
        verification: {
          method: "sha256";
          expected: { kind: "tree"; files: Record<string, string> };
        };
      };
      unsafe.verification = {
        method: "sha256",
        expected: { kind: "tree", files },
      };

      expect(() => assertSemanticValidity([unsafe])).toThrow("COPY_EXPECTATION_INVALID");
    }
  });

  test("requires a declared tree mode for every declared leaf when modes are present", () => {
    const unsafe = copyRecord() as SurfaceRecord & {
      verification: {
        method: "sha256";
        expected: { kind: "tree"; files: Record<string, string>; modes: Record<string, string> };
      };
    };
    unsafe.verification = {
      method: "sha256",
      expected: {
        kind: "tree",
        files: { "index.ts": `sha256:${"a".repeat(64)}` },
        modes: { "other.ts": "0644" },
      },
    };

    expect(() => assertSemanticValidity([unsafe])).toThrow("COPY_EXPECTATION_INVALID");
  });

  test("rejects a tree COPY expectation on a transform record", () => {
    const unsafe = {
      ...copyRecord(),
      class: "TRANSFORM",
      verification: {
        method: "adapter",
        adapter_id: "managed-template-v1",
        expected: { kind: "tree", files: { "source.txt": `sha256:${"a".repeat(64)}` } },
      },
    } as unknown as SurfaceRecord;

    expect(() => assertSemanticValidity([unsafe])).toThrow("TRANSFORM_SOURCE_EXPECTATION_INVALID");
  });
});
