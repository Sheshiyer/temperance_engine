import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_FRAGMENT_BYTES,
  validateFragment,
  validateLock,
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

  test("rejects an unknown nested field", () => {
    expect(validateFragment(fixture("unknown-field.json"))).toBe(false);
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
