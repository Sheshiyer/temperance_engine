import { describe, expect, test } from "bun:test";

import {
  assertNoIdentityCollision,
  isCanonicalRepositoryBasename,
  normalizeRepositoryBasename,
  projectRepositoryName,
  validateRepositoryBasename,
} from "./project-relocation-grammar";

describe("canonical repository basename grammar", () => {
  test("accepts the ratified singleton and ASCII interior-run forms", () => {
    for (const value of ["-", "a", "0", "a0", "a-b", "a--b", "0--9"]) {
      expect(isCanonicalRepositoryBasename(value)).toBe(true);
    }
  });

  test("rejects leading and trailing hyphens for multi-codepoint names", () => {
    for (const value of ["-a", "a-", "--", "a---"]) {
      expect(isCanonicalRepositoryBasename(value)).toBe(false);
    }
  });

  test("rejects closed-repertoire exclusions and path/control characters", () => {
    for (const value of ["A", "a_b", "a.b", "a b", "a/b", "é", "–", "", ".", "..", "\u0000"]) {
      expect(isCanonicalRepositoryBasename(value)).toBe(false);
    }
  });

  test("validates before identity normalization and performs identity normalization", () => {
    expect(normalizeRepositoryBasename("a--b")).toBe("a--b");
    expect(() => normalizeRepositoryBasename("A--B")).toThrow("repository_basename_invalid");
    expect(projectRepositoryName("a--b")).toEqual({
      rawName: "a--b",
      normalizedName: "a--b",
      identityKey: "a--b",
      presentationName: "a--b",
    });
  });

  test("fails closed on normalized identity collision", () => {
    expect(() => assertNoIdentityCollision("a--b", ["a--b"])).toThrow(
      "repository_identity_collision:a--b",
    );
    expect(assertNoIdentityCollision("a--b", ["a-b"]).identityKey).toBe("a--b");
  });

  test("validation exposes a stable error for invalid input", () => {
    expect(() => validateRepositoryBasename("a-")).toThrow("repository_basename_invalid");
  });
});
