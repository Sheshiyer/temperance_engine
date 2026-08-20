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
