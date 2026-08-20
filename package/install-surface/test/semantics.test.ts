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

  test("distinct managed-block markers may share one file", () => {
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
    expect(() => assertSemanticValidity([left, right])).not.toThrow();
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
});
