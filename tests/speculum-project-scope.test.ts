import { describe, expect, test } from "bun:test";
import { defaultBoundId } from "../package/manifest-zone/src/boundProjects";
import { isRealProjectId, scopeQuery, scopeSnapshot } from "../package/manifest-zone/src/scopeSnapshot";
import type { ManifestSnapshot, ProjectSummary } from "../package/manifest-zone/src/manifest";

// Synthetic project identities and roots keep scope selection clone-independent.
function project(partial: Partial<ProjectSummary> & Pick<ProjectSummary, "project_id" | "cwd">): ProjectSummary {
  return {
    name: partial.name || partial.project_id,
    initialized: partial.initialized ?? true,
    event_count: partial.event_count ?? 0,
    last_event_at: partial.last_event_at ?? null,
    freshness: partial.freshness || { status: "empty", age_ms: null, stale_after_ms: 0 },
    ...partial,
  };
}

describe("isRealProjectId / scopeQuery", () => {
  test("empty and all are not real ids", () => {
    expect(isRealProjectId("")).toBe(false);
    expect(isRealProjectId("all")).toBe(false);
    expect(isRealProjectId(null)).toBe(false);
    expect(isRealProjectId("temperance-engine-2222222222")).toBe(true);
  });

  test("scopeQuery omits empty and all", () => {
    expect(scopeQuery("")).toBe(null);
    expect(scopeQuery("all")).toBe(null);
    expect(scopeQuery("temperance-engine-2222222222")).toBe("?project_id=temperance-engine-2222222222");
  });
});

describe("defaultBoundId", () => {
  const exampleApp = project({
    project_id: "example-app-1111111111",
    name: "example-app",
    cwd: "/fixture/projects/example-app",
  });
  const glove = project({
    project_id: "temperance-engine-2222222222",
    name: "temperance_engine",
    cwd: "/fixture/projects/temperance_engine",
  });

  test("glove hashed cwd wins over hottest-event bound[0]", () => {
    expect(defaultBoundId([exampleApp, glove], null)).toBe("temperance-engine-2222222222");
  });

  test("glove hashed id matches without relying on missing temperance_engine slug", () => {
    const hashedOnly = project({
      project_id: "temperance-engine-2222222222",
      cwd: "/fixture/projects/alternate-checkout",
    });
    expect(defaultBoundId([exampleApp, hashedOnly], null)).toBe("temperance-engine-2222222222");
  });

  test("honors a bound query id", () => {
    expect(defaultBoundId([exampleApp, glove], "example-app-1111111111")).toBe("example-app-1111111111");
  });

  test("ignores query all", () => {
    expect(defaultBoundId([exampleApp, glove], "all")).toBe("temperance-engine-2222222222");
  });
});

describe("scopeSnapshot", () => {
  const selected = "temperance-engine-2222222222";
  const snapshot = {
    event_count: 99,
    recent_events: [
      { id: "a", project_id: "example-app-1111111111" },
      { id: "b", project_id: selected },
      { id: "c" },
    ],
    agents: {
      x: { project_id: "example-app-1111111111" },
      y: { project_id: selected },
      z: { name: "unlabeled" },
    },
    plans: {},
    waves: {},
    sessions: {},
    approvals: {},
    projects: { [selected]: { name: "glove" }, "example-app-1111111111": { name: "example-app" } },
  } as unknown as ManifestSnapshot;

  test("keeps selected events and drops missing project_id", () => {
    const next = scopeSnapshot(snapshot, selected);
    expect(next.recent_events.map((event) => event.id)).toEqual(["b"]);
  });

  test("drops foreign agents and keeps unlabeled records", () => {
    const next = scopeSnapshot(snapshot, selected);
    expect(Object.keys(next.agents).sort()).toEqual(["y", "z"]);
  });

  test("projects dict is only the selected id", () => {
    const next = scopeSnapshot(snapshot, selected);
    expect(Object.keys(next.projects)).toEqual([selected]);
  });

  test("recomputes event_count when the window leaked foreign pids", () => {
    const next = scopeSnapshot(snapshot, selected);
    expect(next.event_count).toBe(1);
  });
});
