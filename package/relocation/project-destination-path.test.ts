import { describe, expect, test } from "bun:test";

import { projectDestinationPath } from "./project-destination-path";

const DESTINATION_ROOT = "/Volumes/madara/2026/Projects";
const SOURCE_ROOT = "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed";

function project(sourcePath: string, reserved: string[] = []) {
  return projectDestinationPath({
    destinationRoot: DESTINATION_ROOT,
    portfolio: "thoughtseed",
    sourceRoot: SOURCE_ROOT,
    sourcePath,
    reservedIdentityKeys: reserved,
  });
}

describe("destination path projection", () => {
  test("REGRESSION: the already-moved canary projects to exactly where it already lives", () => {
    // thoughtseed-brand-atlas was relocated for real on 2026-08-06 under the
    // old flat rule. Introducing the tenant level must NOT strand it — a
    // depth-0 repo has no container segment, so its destination is unchanged
    // and it needs no second move.
    const projection = project(`${SOURCE_ROOT}/thoughtseed-brand-atlas`);
    expect(projection.destination).toBe(
      "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(projection.tenant).toBeNull();
    expect(projection.rewritten).toEqual([]);
  });

  test("preserves the container as a tenant segment instead of discarding it", () => {
    // The pre-change CLI used basename() here, which flattened all 12
    // klear-karma repos into siblings of everything else.
    const projection = project(`${SOURCE_ROOT}/klear-karma/snowglobe`);
    expect(projection.destination).toBe(
      "/Volumes/madara/2026/Projects/thoughtseed/klear-karma/snowglobe",
    );
    expect(projection.tenant).toBe("klear-karma");
    expect(projection.relativeSegments).toEqual(["klear-karma", "snowglobe"]);
  });

  test("case-folds a non-canonical container and reports the rewrite", () => {
    const projection = project(`${SOURCE_ROOT}/Tirak/opsflow`);
    expect(projection.destination).toBe("/Volumes/madara/2026/Projects/thoughtseed/tirak/opsflow");
    expect(projection.tenant).toBe("tirak");
    expect(projection.rewritten).toEqual([{ from: "Tirak", to: "tirak", index: 0 }]);
  });

  test("keeps tenant nesting for arbitrarily deep candidates", () => {
    const projection = project(`${SOURCE_ROOT}/klear-karma/kkv2-wiki-v2/wiki-site`);
    expect(projection.destination).toBe(
      "/Volumes/madara/2026/Projects/thoughtseed/klear-karma/kkv2-wiki-v2/wiki-site",
    );
    expect(projection.tenant).toBe("klear-karma/kkv2-wiki-v2");
  });

  test("tolerates trailing separators on either root or candidate", () => {
    expect(
      projectDestinationPath({
        destinationRoot: `${DESTINATION_ROOT}/`,
        portfolio: "thoughtseed",
        sourceRoot: `${SOURCE_ROOT}/`,
        sourcePath: `${SOURCE_ROOT}/klear-karma/snowglobe/`,
      }).destination,
    ).toBe("/Volumes/madara/2026/Projects/thoughtseed/klear-karma/snowglobe");
  });

  test("fails closed when the candidate is not under the source root", () => {
    expect(() => project("/Volumes/madara/2026/twc-vault/01-Projects/instagram/foo")).toThrow(
      "source_not_under_source_root",
    );
    expect(() => project("/etc/passwd")).toThrow("source_not_under_source_root");
  });

  test("fails closed when the candidate IS the source root", () => {
    expect(() => project(SOURCE_ROOT)).toThrow("source_not_under_source_root");
  });

  test("fails closed on a segment outside the canonicalizable repertoire", () => {
    // Worktree directories must never project to a destination.
    expect(() => project(`${SOURCE_ROOT}/Skill-clusters.worktrees/wt-a`)).toThrow(
      "repository_segment_not_canonicalizable",
    );
  });

  test("fails closed when case-folding would collide with a reserved sibling", () => {
    expect(() => project(`${SOURCE_ROOT}/Tirak/opsflow`, ["tirak"])).toThrow(
      "repository_identity_collision:tirak",
    );
  });

  test("requires absolute roots rather than silently resolving against cwd", () => {
    expect(() =>
      projectDestinationPath({
        destinationRoot: "Projects",
        portfolio: "thoughtseed",
        sourceRoot: SOURCE_ROOT,
        sourcePath: `${SOURCE_ROOT}/cambium`,
      }),
    ).toThrow("destination_root_not_absolute");
    expect(() =>
      projectDestinationPath({
        destinationRoot: DESTINATION_ROOT,
        portfolio: "thoughtseed",
        sourceRoot: "thoughtseed",
        sourcePath: `${SOURCE_ROOT}/cambium`,
      }),
    ).toThrow("source_root_not_absolute");
  });

  test("rejects an empty or non-canonical portfolio rather than building a bad path", () => {
    for (const portfolio of ["", "Thoughtseed", "a b"]) {
      expect(() =>
        projectDestinationPath({
          destinationRoot: DESTINATION_ROOT,
          portfolio,
          sourceRoot: SOURCE_ROOT,
          sourcePath: `${SOURCE_ROOT}/cambium`,
        }),
      ).toThrow("portfolio_not_canonical");
    }
  });

  test("a prefix-sharing sibling root is not mistaken for containment", () => {
    // '/…/thoughtseed-labs/x' shares a string prefix with '/…/thoughtseed'
    // but is not inside it. A naive startsWith() check would accept it.
    expect(() => project(`${SOURCE_ROOT}-labs/x`)).toThrow("source_not_under_source_root");
  });
});
