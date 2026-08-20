import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_FRAGMENT_BYTES,
  validateDoctorReport,
  validateFragment,
  validateLock,
  validatePrivateRegistry,
} from "../src/schema.ts";

const fixture = (name: string): unknown => JSON.parse(
  readFileSync(new URL(`fixtures/schema/${name}`, import.meta.url), "utf8"),
);

describe("strict v1 schema validation", () => {
  test("accepts a valid fragment and compiled lock", () => {
    expect(validateFragment(fixture("valid-fragment.v1.json"))).toBe(true);
    expect(validateLock({
      schema: "temperance.install-surface.lock.v1",
      schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
      version: { major: 1, minor: 0 },
      records: [],
    })).toBe(true);
  });

  test("accepts valid private-registry and doctor-report envelopes", () => {
    expect(validatePrivateRegistry({
      schema: "temperance.private-registry.v1",
      version: { major: 1, minor: 0 },
      records: [],
    })).toBe(true);
    expect(validateDoctorReport({
      schema: "temperance.doctor.report.v1",
      version: { major: 1, minor: 0 },
      generated_at: "2026-08-20T00:00:00.000Z",
      scope: { complete: true, requested_sections: ["install", "privacy", "runtime"] },
      trustworthy: true,
      overall_condition: "PASS",
      exit_code: 0,
      manifest_digest: `sha256:${"0".repeat(64)}`,
      sections: [],
    })).toBe(true);
  });

  test("rejects an unknown nested field", () => {
    expect(validateFragment(fixture("unknown-field.json"))).toBe(false);
  });

  test("rejects an unknown nested field in a compiled lock", () => {
    const fragment = fixture("valid-fragment.v1.json") as { records: Array<Record<string, unknown>> };
    const record = structuredClone(fragment.records[0]) as Record<string, unknown>;
    (record.authority as Record<string, unknown>).surprise = true;

    expect(validateLock({
      schema: "temperance.install-surface.lock.v1",
      schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
      version: { major: 1, minor: 0 },
      records: [record],
    })).toBe(false);
  });

  test("rejects a missing required field", () => {
    const value = fixture("valid-fragment.v1.json") as Record<string, unknown>;
    delete value.records;
    expect(validateFragment(value)).toBe(false);
  });

  test("rejects an unsupported major or minor version", () => {
    expect(validateFragment(fixture("unsupported-version.json"))).toBe(false);
    expect(validateFragment({
      schema: "temperance.install-surface.fragment.v1",
      schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",
      version: { major: 1, minor: 1 },
      records: [],
    })).toBe(false);
  });

  test("rejects input above the named fragment byte bound", () => {
    expect(validateFragment({
      schema: "temperance.install-surface.fragment.v1",
      schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",
      version: { major: 1, minor: 0 },
      records: [],
      padding: "x".repeat(MAX_FRAGMENT_BYTES),
    })).toBe(false);
  });
});
