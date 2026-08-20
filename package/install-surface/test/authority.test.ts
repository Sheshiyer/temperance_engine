import { describe, expect, test } from "bun:test";

import { assertAuthority } from "../src/authority.ts";
import type { SurfaceRecord } from "../src/types.ts";

const record: SurfaceRecord = {
  id: "surface.authorized",
  owner: "temperance-engine",
  class: "COPY",
  source: "package/authorized",
  destination: { root_token: "HOME", relative_path: "authorized", ownership: { kind: "exclusive-path" } },
  authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
  eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
  verification: { method: "sha256" },
  rollback: { policy: "restore-backup" },
};

describe("canonical authority", () => {
  test("accepts checked ISA and known Phase 1 requirement references", () => {
    expect(() => assertAuthority([record], {
      isaText: "- [x] ISC-769: COPY classification is ratified.\n",
      requirementsText: "- [ ] **PROV-02** — stable records\n",
    })).not.toThrow();
  });

  test("rejects self-declared or unchecked ISA ratification", () => {
    expect(() => assertAuthority([record], {
      isaText: "- [ ] ISC-769: fragment claims this is enough.\n",
      requirementsText: "- [ ] **PROV-02** — stable records\n",
    })).toThrow("AUTHORITY_REFERENCE_INVALID");
  });

  test("rejects unknown and out-of-phase requirement IDs", () => {
    const invalid = {
      ...record,
      authority: { requirement_ids: ["INST-01"], isa: "ISC-769" },
    } as SurfaceRecord;
    expect(() => assertAuthority([invalid], {
      isaText: "- [x] ISC-769: COPY classification is ratified.\n",
      requirementsText: "- [ ] **INST-01** — later lifecycle requirement\n",
    })).toThrow("AUTHORITY_REFERENCE_INVALID");
  });
});
