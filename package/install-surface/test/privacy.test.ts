import { expect, test } from "bun:test";

import { compileFragments } from "../src/compile.ts";
import { assertDenyPolicy, type DenyPolicy } from "../src/deny-policy.ts";
import type { SurfaceRecord } from "../src/types.ts";

const HONEYTOKEN = "PRIVATE-HONEYTOKEN-NEVER-DISCLOSE";

function record(source: string): SurfaceRecord {
  return {
    id: "surface.private-candidate",
    owner: "temperance-engine",
    class: "COPY",
    source,
    destination: { root_token: "HOME", relative_path: "candidate", ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
    verification: { method: "sha256" },
    rollback: { policy: "restore-backup" },
  };
}

test("rule-only deny errors omit honeytoken paths and preserve candidate bytes", () => {
  const candidate = record(`private/${HONEYTOKEN}`);
  const before = JSON.stringify(candidate);
  const policy: DenyPolicy = {
    schema: "temperance.install-surface.deny-policy.v1",
    version: { major: 1, minor: 0 },
    rules: [{ id: "private-root", pattern: "(^|/)private(/|$)", disclosure: "rule-only" }],
  };
  let message = "";
  try {
    assertDenyPolicy([candidate], policy);
  } catch (error) {
    message = String(error);
  }
  expect(message).toContain("DENY_POLICY_MATCH:private-root");
  expect(message).not.toContain(HONEYTOKEN);
  expect(JSON.stringify(candidate)).toBe(before);
});

test("safe-relative-path rules disclose only the repository-relative candidate", () => {
  const candidate = record("data/example.db");
  const policy: DenyPolicy = {
    schema: "temperance.install-surface.deny-policy.v1",
    version: { major: 1, minor: 0 },
    rules: [{ id: "database-state", pattern: "\\.db$", disclosure: "safe-relative-path" }],
  };
  expect(() => assertDenyPolicy([candidate], policy)).toThrow("DENY_POLICY_MATCH:database-state:data/example.db");
});

test("schema failures never echo private binding, label, provider, notes, or parser values", () => {
  const contents = JSON.stringify({
    schema: "temperance.install-surface.fragment.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1",
    version: { major: 1, minor: 0 },
    records: [{ ...record("package/safe"), binding: HONEYTOKEN, label: HONEYTOKEN, provider: HONEYTOKEN, notes: HONEYTOKEN }],
  });
  let message = "";
  try {
    compileFragments([{ name: "bounded.json", contents }], {
      isaText: "- [x] ISC-769: COPY classification is ratified.\n",
      requirementsText: "- [ ] **PROV-02** — stable records\n",
    });
  } catch (error) {
    message = String(error);
  }
  expect(message).toContain("MANIFEST_SCHEMA_INVALID:bounded.json");
  expect(message).not.toContain(HONEYTOKEN);
});
