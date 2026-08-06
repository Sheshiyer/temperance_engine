import { describe, expect, test } from "bun:test";

import {
  assertNoIdentityCollision,
  canonicalizeRepositorySegment,
  isCanonicalRepositoryBasename,
  isCanonicalizableRepositorySegment,
  normalizeRepositoryBasename,
  projectCanonicalizedSegments,
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

describe("segment canonicalization for destination projection", () => {
  test("is identity for names already in the canonical repertoire", () => {
    for (const value of ["-", "a", "klear-karma", "snow-gloves-os", "10869"]) {
      expect(canonicalizeRepositorySegment(value)).toBe(value);
    }
  });

  test("case-folds the exact real vault container and repo names that need it", () => {
    expect(canonicalizeRepositorySegment("Tirak")).toBe("tirak");
    expect(canonicalizeRepositorySegment("HeyZack")).toBe("heyzack");
    expect(canonicalizeRepositorySegment("Archive")).toBe("archive");
    expect(canonicalizeRepositorySegment("Coproperty")).toBe("coproperty");
    expect(canonicalizeRepositorySegment("Airdronauts")).toBe("airdronauts");
    expect(canonicalizeRepositorySegment("Kacima")).toBe("kacima");
    expect(canonicalizeRepositorySegment("Insightreality")).toBe("insightreality");
    expect(canonicalizeRepositorySegment("Panaroma-Webapp")).toBe("panaroma-webapp");
    expect(canonicalizeRepositorySegment("ThoughtseedOS-Site")).toBe("thoughtseedos-site");
    expect(canonicalizeRepositorySegment("HDILINT-backend-aleph")).toBe("hdilint-backend-aleph");
    expect(canonicalizeRepositorySegment("Skill-clusters")).toBe("skill-clusters");
  });

  test("maps the underscore exclusion onto the canonical hyphen", () => {
    expect(canonicalizeRepositorySegment("temperance_engine")).toBe("temperance-engine");
    expect(canonicalizeRepositorySegment("A_B")).toBe("a-b");
  });

  test("fails closed on anything outside case-folding and underscore mapping", () => {
    // Deliberately NOT rescued: a lossy repair would silently invent a
    // destination name the owner never ratified. Worktree directories land
    // here, which is correct — they must not relocate as projects.
    for (const value of ["Skill-clusters.worktrees", "a b", "a/b", "é", "", ".", "..", "-a", "a-", "a."]) {
      expect(isCanonicalizableRepositorySegment(value)).toBe(false);
      expect(() => canonicalizeRepositorySegment(value)).toThrow(
        "repository_segment_not_canonicalizable",
      );
    }
  });

  test("canonicalization never yields a name the basename grammar would reject", () => {
    for (const value of ["Tirak", "temperance_engine", "HDILINT-backend-aleph", "a"]) {
      expect(isCanonicalRepositoryBasename(canonicalizeRepositorySegment(value))).toBe(true);
    }
  });

  test("projects a whole path's segments and reports the ones that changed", () => {
    expect(projectCanonicalizedSegments(["Tirak", "opsflow"])).toEqual({
      segments: ["tirak", "opsflow"],
      rewritten: [{ from: "Tirak", to: "tirak", index: 0 }],
    });
    expect(projectCanonicalizedSegments(["klear-karma", "snowglobe"])).toEqual({
      segments: ["klear-karma", "snowglobe"],
      rewritten: [],
    });
  });

  test("fails closed when case-folding would collide two distinct siblings", () => {
    // 'Foo' and 'foo' are distinct on a case-sensitive source but would both
    // canonicalize to 'foo' at the destination and silently overwrite.
    expect(() => projectCanonicalizedSegments(["Foo"], ["foo"])).toThrow(
      "repository_identity_collision:foo",
    );
    expect(projectCanonicalizedSegments(["Foo"], ["bar"]).segments).toEqual(["foo"]);
  });

  test("rejects an empty segment list rather than projecting a rootless path", () => {
    expect(() => projectCanonicalizedSegments([])).toThrow("repository_segments_empty");
  });
});
