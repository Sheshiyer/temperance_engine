import { expect, test } from "bun:test";

import { compileFragments } from "../src/compile.ts";

const authority = {
  isaText: "- [x] ISC-769: COPY classification is ratified.\n",
  requirementsText: "- [ ] **PROV-02** — stable records\n",
};

function record(id: string, dependencies: string[] = []) {
  return {
    id,
    owner: "temperance-engine",
    class: "COPY",
    source: `package/${id}`,
    destination: { root_token: "HOME", relative_path: `surfaces/${id}`, ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["linux", "darwin"], profiles: ["secondary", "default"], required: true },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
    ...(dependencies.length ? { depends_on: dependencies } : {}),
  };
}

function fragment(records: unknown[]): string {
  return JSON.stringify({
    records,
    version: { minor: 0, major: 1 },
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",
    schema: "temperance.install-surface.fragment.v1",
  });
}

test("shuffled fragments, records, dependencies, and object keys produce byte-identical canonical bytes", () => {
  const alpha = record("surface.alpha");
  const beta = record("surface.beta", ["surface.alpha", "surface.gamma"]);
  const gamma = record("surface.gamma");
  const first = compileFragments([
    { name: "a.json", contents: fragment([beta, alpha]) },
    { name: "b.json", contents: fragment([gamma]) },
  ], authority);
  const shuffledBeta = { ...beta, depends_on: ["surface.gamma", "surface.alpha"] };
  const second = compileFragments([
    { name: "b.json", contents: fragment([gamma]) },
    { name: "a.json", contents: fragment([alpha, shuffledBeta]) },
  ], authority);
  expect(second.canonicalBytes).toBe(first.canonicalBytes);
  expect(second.digest).toBe(first.digest);
});

test("COPY tree expectation maps have deterministic lock bytes", () => {
  const alpha = {
    ...record("surface.alpha"),
    verification: {
      method: "sha256",
      expected: {
        kind: "tree",
        files: {
          "nested/b.ts": `sha256:${"b".repeat(64)}`,
          "a.ts": `sha256:${"a".repeat(64)}`,
        },
        modes: {
          "nested/b.ts": "0755",
          "a.ts": "0644",
        },
      },
    },
  };
  const beta = {
    ...alpha,
    verification: {
      method: "sha256",
      expected: {
        kind: "tree",
        files: {
          "a.ts": `sha256:${"a".repeat(64)}`,
          "nested/b.ts": `sha256:${"b".repeat(64)}`,
        },
        modes: {
          "a.ts": "0644",
          "nested/b.ts": "0755",
        },
      },
    },
  };

  const first = compileFragments([{ name: "expectation.json", contents: fragment([alpha]) }], authority);
  const second = compileFragments([{ name: "expectation.json", contents: fragment([beta]) }], authority);
  expect(second.canonicalBytes).toBe(first.canonicalBytes);
  expect(second.digest).toBe(first.digest);
});

test("COPY mode changes alter the compiled inventory digest", () => {
  const base = {
    ...record("surface.mode"),
    verification: {
      method: "sha256",
      expected: { kind: "file", sha256: `sha256:${"a".repeat(64)}`, mode: "0644" },
    },
  };
  const executable = {
    ...base,
    verification: {
      method: "sha256",
      expected: { kind: "file", sha256: `sha256:${"a".repeat(64)}`, mode: "0755" },
    },
  };
  const first = compileFragments([{ name: "mode.json", contents: fragment([base]) }], authority);
  const second = compileFragments([{ name: "mode.json", contents: fragment([executable]) }], authority);
  expect(second.digest).not.toBe(first.digest);
});
