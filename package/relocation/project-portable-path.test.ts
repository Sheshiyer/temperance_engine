import { describe, expect, test } from "bun:test";

import { fromPortablePath, toPortablePath, type PortablePathRoots } from "./project-portable-path";

const ROOTS: PortablePathRoots = {
  vault: "/Volumes/madara/2026/twc-vault",
  projects: "/Volumes/madara/2026/Projects",
};

describe("portable path aliasing", () => {
  test("aliases the projects root", () => {
    expect(toPortablePath("/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas", ROOTS)).toBe(
      "$PROJECTS/thoughtseed/thoughtseed-brand-atlas",
    );
  });

  test("aliases the vault root", () => {
    expect(
      toPortablePath("/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium", ROOTS),
    ).toBe("$VAULT/01-Projects/thoughtseed/cambium");
  });

  test("aliases a bare root with no trailing path", () => {
    expect(toPortablePath("/Volumes/madara/2026/Projects", ROOTS)).toBe("$PROJECTS");
    expect(toPortablePath("/Volumes/madara/2026/twc-vault", ROOTS)).toBe("$VAULT");
  });

  test("round-trips every aliased path back to the identical absolute path", () => {
    for (const absolute of [
      "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
      "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/klear-karma/snowglobe",
      "/Volumes/madara/2026/twc-vault",
    ]) {
      expect(fromPortablePath(toPortablePath(absolute, ROOTS), ROOTS)).toBe(absolute);
    }
  });

  test("FAILS CLOSED on a path under no known root", () => {
    // The whole point: an unaliased absolute path must never slip into a
    // record that gets committed to a public repository.
    expect(() => toPortablePath("/Users/someone/elsewhere/repo", ROOTS)).toThrow(
      "path_not_under_any_portable_root",
    );
    expect(() => toPortablePath("/Volumes/other-drive/x", ROOTS)).toThrow(
      "path_not_under_any_portable_root",
    );
  });

  test("does not mistake a prefix-sharing sibling root for containment", () => {
    // '/…/twc-vault-archive' shares a string prefix with '/…/twc-vault'.
    expect(() => toPortablePath("/Volumes/madara/2026/twc-vault-archive/x", ROOTS)).toThrow(
      "path_not_under_any_portable_root",
    );
  });

  test("prefers the longest matching root when one root nests inside another", () => {
    const nested: PortablePathRoots = {
      vault: "/Volumes/madara/2026",
      projects: "/Volumes/madara/2026/Projects",
    };
    expect(toPortablePath("/Volumes/madara/2026/Projects/thoughtseed/x", nested)).toBe(
      "$PROJECTS/thoughtseed/x",
    );
    expect(toPortablePath("/Volumes/madara/2026/twc-vault/x", nested)).toBe("$VAULT/twc-vault/x");
  });

  test("rejects a relative input rather than silently aliasing nothing", () => {
    expect(() => toPortablePath("relative/path", ROOTS)).toThrow("path_not_absolute");
  });

  test("resolves both alias forms back to absolute", () => {
    expect(fromPortablePath("$PROJECTS/thoughtseed/x", ROOTS)).toBe(
      "/Volumes/madara/2026/Projects/thoughtseed/x",
    );
    expect(fromPortablePath("$VAULT/01-Projects/x", ROOTS)).toBe(
      "/Volumes/madara/2026/twc-vault/01-Projects/x",
    );
  });

  test("fails closed when resolving an unknown alias", () => {
    expect(() => fromPortablePath("$NOPE/x", ROOTS)).toThrow("unknown_portable_alias:$NOPE");
  });

  test("refuses to resolve a string that carries no alias at all", () => {
    expect(() => fromPortablePath("/Volumes/madara/2026/Projects/x", ROOTS)).toThrow(
      "portable_path_missing_alias",
    );
  });
});
