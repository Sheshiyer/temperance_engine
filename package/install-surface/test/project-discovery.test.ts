import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approveProjectCandidates,
  discoverProjectCandidates,
  normalizeRepositoryIdentity,
  projectCapsulesEqual,
  removeProjectCapsule,
} from "../src/onboarding/project-discovery.ts";
import type { HostBindingV1, HostProfileV1, ProjectCapsuleV1 } from "../src/onboarding/public-contracts.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; profile: HostProfileV1; binding: HostBindingV1 } {
  const root = mkdtempSync(join(tmpdir(), "temperance-project-discovery-"));
  roots.push(root);
  const growth = join(root, "growth");
  const portfolio = join(root, "portfolio");
  const volume = join(root, "volume");
  mkdirSync(join(growth, "maps"), { recursive: true });
  mkdirSync(join(portfolio, "local-product"), { recursive: true });
  mkdirSync(join(volume, "projects", "shared", ".git"), { recursive: true });
  mkdirSync(join(volume, "projects", "second", ".git"), { recursive: true });
  writeFileSync(join(growth, "maps", "projects.json"), JSON.stringify({
    authority: "automatic-enrollment-source",
    projects: [{ project_id: "shared", repository: "Example/Shared", auto_configure: true }],
  }));
  writeFileSync(join(volume, "projects", "shared", ".git", "config"), '[remote "origin"]\n  url = git@github.com:Example/Shared.git\n');
  writeFileSync(join(volume, "projects", "second", ".git", "config"), '[remote "origin"]\n  url = https://credential@example.invalid/org/second.git?token=secret\n');

  const profile: HostProfileV1 = {
    schema: "temperance.host-profile.v1",
    version: { major: 1, minor: 0 },
    id: "discovery-test",
    variables: [
      { name: "GROWTH_ROOT", kind: "absolute-path", required: true },
      { name: "PORTFOLIO_ROOT", kind: "absolute-path", required: true },
      { name: "VOLUME_ROOT", kind: "absolute-path", required: true },
      { name: "PROJECT_PREFIX", kind: "string", required: true },
    ],
    secret_references: [],
    preselected_modules: [],
    required_routing_aliases: [],
    project_discovery: [
      {
        id: "growth-map",
        kind: "json-project-map",
        source_root_variable: "GROWTH_ROOT",
        source_relative_path: "maps/projects.json",
        project_root_variable: "VOLUME_ROOT",
        project_root_prefix_variable: "PROJECT_PREFIX",
        access: "read-only",
      },
      { id: "portfolio", kind: "directory-children", root_variable: "PORTFOLIO_ROOT", require_git: false, access: "read-only" },
      { id: "volume", kind: "directory-children", root_variable: "VOLUME_ROOT", root_prefix_variable: "PROJECT_PREFIX", require_git: true, access: "read-only" },
    ],
  };
  const binding: HostBindingV1 = {
    schema: "temperance.host-binding.v1",
    version: { major: 1, minor: 0 },
    profile_id: profile.id,
    variables: { GROWTH_ROOT: growth, PORTFOLIO_ROOT: portfolio, VOLUME_ROOT: volume, PROJECT_PREFIX: "projects" },
    secret_references: {},
    routing_aliases: [],
    volume_bindings: [],
  };
  return { root, profile, binding };
}

describe("advisory project discovery", () => {
  test("merges map and directory candidates by stable remote identity", () => {
    const { profile, binding } = fixture();
    const result = discoverProjectCandidates(profile, binding);
    expect(result.findings).toEqual([]);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((item) => item.approved === false)).toBe(true);
    expect(result.candidates.filter((item) => item.repository_identity === "github.com/example/shared")).toHaveLength(1);
    expect(result.candidates.find((item) => item.display_name === "shared")).toMatchObject({
      root_variable: "VOLUME_ROOT",
      relative_path: "projects/shared",
      path_present: true,
    });
    expect(result.candidates.find((item) => item.display_name === "local-product")?.repository_identity).toBe("local:PORTFOLIO_ROOT:local-product");
    expect(JSON.stringify(result)).not.toContain("credential");
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  test("normalizes supported Git transports without retaining credentials", () => {
    expect(normalizeRepositoryIdentity("git@github.com:Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRepositoryIdentity("https://user:pass@github.com/Owner/Repo.git?x=secret")).toBe("github.com/owner/repo");
    expect(normalizeRepositoryIdentity("Owner/Repo")).toBe("github.com/owner/repo");
  });

  test("explicit approval is idempotent and removal never touches repository bytes", () => {
    const { profile, binding } = fixture();
    const candidate = discoverProjectCandidates(profile, binding).candidates.find((item) => item.display_name === "local-product")!;
    const approved = approveProjectCandidates([], [candidate], new Set([candidate.id]));
    const repeated = approveProjectCandidates(approved, [candidate], new Set([candidate.id]));
    expect(approved).toEqual(repeated);
    expect(approved[0]?.approved).toBe(true);
    const directory = join(binding.variables.PORTFOLIO_ROOT!, "local-product");
    const removed = removeProjectCapsule(approved, approved[0]!.id);
    expect(removed).toEqual([]);
    expect(existsSync(directory)).toBe(true);
    expect(projectCapsulesEqual(approved, repeated)).toBe(true);
  });

  test("rejects unsafe prefix values without traversing outside the bound root", () => {
    const { profile, binding } = fixture();
    const result = discoverProjectCandidates(profile, { ...binding, variables: { ...binding.variables, PROJECT_PREFIX: "../escape" } });
    expect(result.findings.filter((item) => item.code === "PREFIX_UNSAFE")).toHaveLength(2);
    expect(result.candidates.some((item) => item.root_variable === "VOLUME_ROOT")).toBe(false);
  });

  test("preserves existing approved capsules when selecting new candidates", () => {
    const { profile, binding } = fixture();
    const candidate = discoverProjectCandidates(profile, binding).candidates[0]!;
    const existing: ProjectCapsuleV1 = {
      schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: "existing",
      repository_identity: "github.com/example/existing", root_variable: "PORTFOLIO_ROOT", relative_path: ".", access: "read-only", approved: true,
    };
    expect(approveProjectCandidates([existing], [candidate], new Set([candidate.id]))).toHaveLength(2);
  });

  test("presents every mapped portfolio folder and gates absent paths", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-portfolio-map-"));
    roots.push(root);
    const cambium = join(root, "cambium");
    const volume = join(root, "volume");
    mkdirSync(join(cambium, "docs"), { recursive: true });
    mkdirSync(join(volume, "2026", "Projects", "thoughtseed", "cambium"), { recursive: true });
    mkdirSync(join(volume, "2026", "Projects", "tryambakam-noesis", "noesis"), { recursive: true });
    writeFileSync(join(cambium, "docs", "portfolio-roots.v1.json"), JSON.stringify({
      schema: "thoughtseed.portfolio-root-map.v1",
      authority: "proposal-only",
      portfolios: [
        { portfolioId: "thoughtseed", folders: [
          { folder: "cambium", workIds: ["sapling:cambium"], status: "mapping-proposal" },
          { folder: "missing-project", workIds: ["sapling:missing"], status: "mapping-proposal" },
        ] },
        { portfolioId: "tryambakam-noesis", folders: [
          { folder: "noesis", workIds: ["sapling:noesis"], status: "awaiting-ingestion" },
        ] },
      ],
    }));
    writeFileSync(join(cambium, "docs", "github-map.v1.json"), JSON.stringify({
      schema: "thoughtseed.github-repository-mapping-action-queue.v1",
      batches: [{
        rows: [{ targetWorkId: "sapling:cambium", repository: "Sheshiyer/cambium" }],
        clusters: [{ resolvedAssignments: [{ workId: "sapling:noesis", repositoryRefs: ["Sheshiyer/noesis-cambium/apps/docs"] }] }],
      }],
    }));
    const profile: HostProfileV1 = {
      schema: "temperance.host-profile.v1", version: { major: 1, minor: 0 }, id: "portfolio-map-test",
      variables: [
        { name: "CAMBIUM_ROOT", kind: "absolute-path", required: true },
        { name: "VOLUME_ROOT", kind: "absolute-path", required: true },
        { name: "PROJECTS_SUBTREE", kind: "string", required: true },
      ],
      secret_references: [], preselected_modules: [], required_routing_aliases: [],
      project_discovery: [{
        id: "portfolio-map", kind: "portfolio-root-map", source_root_variable: "CAMBIUM_ROOT",
        source_relative_path: "docs/portfolio-roots.v1.json", repository_mapping_relative_path: "docs/github-map.v1.json",
        project_root_variable: "VOLUME_ROOT", project_root_prefix_variable: "PROJECTS_SUBTREE", access: "read-only",
      }],
    };
    const binding: HostBindingV1 = {
      schema: "temperance.host-binding.v1", version: { major: 1, minor: 0 }, profile_id: profile.id,
      variables: { CAMBIUM_ROOT: cambium, VOLUME_ROOT: volume, PROJECTS_SUBTREE: "2026/Projects" },
      secret_references: {}, routing_aliases: [], volume_bindings: [],
    };
    const result = discoverProjectCandidates(profile, binding);
    expect(result.findings).toEqual([]);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map(({ display_name }) => display_name).sort()).toEqual([
      "thoughtseed/cambium", "thoughtseed/missing-project", "tryambakam-noesis/noesis",
    ]);
    expect(result.candidates.find(({ display_name }) => display_name === "thoughtseed/cambium")).toMatchObject({
      selectable: true, mapping_status: "repository-mapped", repository_candidates: ["github.com/sheshiyer/cambium"],
    });
    expect(result.candidates.find(({ display_name }) => display_name === "tryambakam-noesis/noesis")).toMatchObject({
      selectable: true, repository_candidates: ["github.com/sheshiyer/noesis-cambium"],
    });
    const missing = result.candidates.find(({ display_name }) => display_name === "thoughtseed/missing-project")!;
    expect(missing).toMatchObject({ selectable: false, path_present: false, mapping_status: "path-missing" });
    expect(() => approveProjectCandidates([], result.candidates, new Set([missing.id]))).toThrow("PROJECT_CANDIDATE_UNAVAILABLE");
    const selected = result.candidates.find(({ display_name }) => display_name === "thoughtseed/cambium")!;
    expect(approveProjectCandidates([], result.candidates, new Set([selected.id]))).toEqual([{
      schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: selected.id,
      repository_identity: "portfolio:thoughtseed:cambium", root_variable: "VOLUME_ROOT",
      relative_path: "2026/Projects/thoughtseed/cambium", access: "read-only", approved: true,
    }]);

    writeFileSync(join(cambium, "docs", "github-map.v1.json"), "not-json");
    const withoutRepositoryEvidence = discoverProjectCandidates(profile, binding);
    expect(withoutRepositoryEvidence.candidates).toHaveLength(3);
    expect(withoutRepositoryEvidence.findings).toEqual([expect.objectContaining({
      code: "SOURCE_INVALID", message: expect.stringContaining("Repository mapping evidence"),
    })]);
  });
});
