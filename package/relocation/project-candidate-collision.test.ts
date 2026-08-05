// package/relocation/project-candidate-collision.test.ts
import { describe, expect, test } from "bun:test";

import { findCandidateCollisions } from "./project-candidate-collision";

describe("findCandidateCollisions", () => {
  test("two candidates sharing a basename both get held, third distinct one is untouched", () => {
    const result = findCandidateCollisions([
      { path: "/a/team-forge-ts", repositoryName: "team-forge-ts", remotes: [] },
      { path: "/a/Archive/team-forge-ts", repositoryName: "team-forge-ts", remotes: [] },
      { path: "/a/some-other-repo", repositoryName: "some-other-repo", remotes: [] },
    ]);

    expect(result.get("/a/team-forge-ts")).toEqual(["competing_candidate_claim:basename:team-forge-ts"]);
    expect(result.get("/a/Archive/team-forge-ts")).toEqual(["competing_candidate_claim:basename:team-forge-ts"]);
    expect(result.has("/a/some-other-repo")).toBe(false);
  });

  test("two candidates sharing a GitHub remote identity (https form) both get held", () => {
    const result = findCandidateCollisions([
      { path: "/a/team-forge-ts", repositoryName: "team-forge-ts", remotes: ["https://github.com/Sheshiyer/team-forge-ts.git"] },
      { path: "/a/Archive/team-forge-ts", repositoryName: "team-forge-ts", remotes: ["https://github.com/Sheshiyer/team-forge-ts.git"] },
    ]);

    expect(result.get("/a/team-forge-ts")).toContain("competing_candidate_claim:github_identity:sheshiyer/team-forge-ts");
    expect(result.get("/a/Archive/team-forge-ts")).toContain("competing_candidate_claim:github_identity:sheshiyer/team-forge-ts");
  });

  test("ssh-form and https-form remotes for the same repo still normalize to the same identity", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "one", remotes: ["git@github.com:Sheshiyer/some-repo.git"] },
      { path: "/a/two", repositoryName: "two", remotes: ["https://github.com/Sheshiyer/some-repo.git"] },
    ]);

    expect(result.get("/a/one")).toContain("competing_candidate_claim:github_identity:sheshiyer/some-repo");
    expect(result.get("/a/two")).toContain("competing_candidate_claim:github_identity:sheshiyer/some-repo");
  });

  test("no collisions at all returns an empty map", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "one", remotes: ["https://github.com/Sheshiyer/one.git"] },
      { path: "/a/two", repositoryName: "two", remotes: ["https://github.com/Sheshiyer/two.git"] },
    ]);

    expect(result.size).toBe(0);
  });

  test("a candidate with no remotes at all is only checked for basename collisions", () => {
    const result = findCandidateCollisions([
      { path: "/a/one", repositoryName: "shared-name", remotes: [] },
      { path: "/a/two", repositoryName: "shared-name", remotes: [] },
    ]);

    expect(result.get("/a/one")).toEqual(["competing_candidate_claim:basename:shared-name"]);
    expect(result.get("/a/two")).toEqual(["competing_candidate_claim:basename:shared-name"]);
  });
});
