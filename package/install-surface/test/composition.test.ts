import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  COMPOSITION_OBSERVATIONS_SCHEMA,
  COMPOSITION_REPORT_SCHEMA,
  COMPOSITION_SCHEMA,
  PRODUCT_ID,
  PRODUCT_REPOSITORY,
  validateComposition,
  validateObservations,
  type CompositionObservationsV1,
  type CompositionV1,
} from "../src/composition/contracts.ts";
import { inspectComposition } from "../src/composition/inspect.ts";

const exampleFixture: CompositionV1 = JSON.parse(
  readFileSync(new URL("../examples/standalone-composition.v1.json", import.meta.url), "utf8"),
);

describe("composition contracts & validation", () => {
  test("validates example standalone composition", () => {
    const validated = validateComposition(exampleFixture);
    expect(validated.schema).toBe(COMPOSITION_SCHEMA);
    expect(validated.product.id).toBe(PRODUCT_ID);
    expect(validated.product.repository).toBe(PRODUCT_REPOSITORY);
    expect(validated.plant.id).toBe("plant-standalone-local");
    expect(validated.plant.kind).toBe("local");
    expect(validated.coordinator.mode).toBe("native");
    expect(validated.modules.length).toBe(3);
  });

  test("mutation-free input (does not mutate caller object)", () => {
    const input = JSON.parse(JSON.stringify(exampleFixture));
    const frozenInput = Object.freeze(input);
    const validated = validateComposition(frozenInput);
    expect(validated).not.toBe(frozenInput);
    expect(validated.modules).not.toBe(frozenInput.modules);
  });

  test("rejects non-native coordinator mode", () => {
    const input = {
      ...exampleFixture,
      coordinator: { surface: "codex-cli", mode: "algorithm" },
    };
    expect(() => validateComposition(input)).toThrow("COMPOSITION_INVALID_COORDINATOR");
  });

  test("rejects invalid coordinator surface", () => {
    const input = {
      ...exampleFixture,
      coordinator: { surface: "unknown-surface", mode: "native" },
    };
    expect(() => validateComposition(input)).toThrow("COMPOSITION_INVALID_COORDINATOR");
  });

  test("rejects unknown fields on root", () => {
    const input = {
      ...exampleFixture,
      extra_field: "malicious",
    };
    expect(() => validateComposition(input)).toThrow("COMPOSITION_UNKNOWN_FIELD");
  });

  test("rejects prototype pollution and accessors", () => {
    const malicious = JSON.parse(JSON.stringify(exampleFixture));
    Object.defineProperty(malicious, "getterField", {
      get() { return "evil"; },
      enumerable: true,
    });
    expect(() => validateComposition(malicious)).toThrow();
  });

  test("rejects product identity tampering", () => {
    const badProduct = {
      ...exampleFixture,
      product: { id: "custom-product", repository: PRODUCT_REPOSITORY },
    };
    expect(() => validateComposition(badProduct)).toThrow("COMPOSITION_INVALID_PRODUCT");
  });

  test("rejects integration taking product identity", () => {
    const badInteg = {
      ...exampleFixture,
      integrations: [
        {
          id: "temperance-engine",
          repository: "github.com/custom/repo",
          plant_id: "plant-standalone-local",
          requires: [],
        },
      ],
    };
    expect(() => validateComposition(badInteg)).toThrow("COMPOSITION_INTEGRATION_PRODUCT_COLLISION");

    const badIntegRepo = {
      ...exampleFixture,
      integrations: [
        {
          id: "custom-integ",
          repository: "github.com/Sheshiyer/temperance_engine",
          plant_id: "plant-standalone-local",
          requires: [],
        },
      ],
    };
    expect(() => validateComposition(badIntegRepo)).toThrow("COMPOSITION_INTEGRATION_PRODUCT_COLLISION");
  });

  test("rejects invalid repository format (.git suffix or URL)", () => {
    const badRepo1 = {
      ...exampleFixture,
      integrations: [
        {
          id: "integ1",
          repository: "https://github.com/owner/repo",
          plant_id: "plant-standalone-local",
          requires: [],
        },
      ],
    };
    expect(() => validateComposition(badRepo1)).toThrow("COMPOSITION_INVALID_INTEGRATION");

    const badRepo2 = {
      ...exampleFixture,
      integrations: [
        {
          id: "integ1",
          repository: "github.com/owner/repo.git",
          plant_id: "plant-standalone-local",
          requires: [],
        },
      ],
    };
    expect(() => validateComposition(badRepo2)).toThrow("COMPOSITION_INVALID_INTEGRATION");
  });

  test("enforces plant_id match across modules and integrations", () => {
    const crossPlant = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "other-plant",
          requires: [],
          configuration_refs: [],
        },
      ],
    };
    expect(() => validateComposition(crossPlant)).toThrow("COMPOSITION_CROSS_PLANT_MISMATCH");
  });

  test("enforces generic minimum dependencies", () => {
    const missingGeneric = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.hands",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [], // hands needs executor.git and skills.binding
          configuration_refs: [],
        },
      ],
    };
    expect(() => validateComposition(missingGeneric)).toThrow("COMPOSITION_MISSING_GENERIC_DEPENDENCY");
  });

  test("detects dangling dependencies", () => {
    const dangling = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.hands",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["executor.git", "skills.binding"],
          configuration_refs: [],
        },
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
        // skills.binding is omitted!
      ],
    };
    expect(() => validateComposition(dangling)).toThrow("COMPOSITION_DANGLING_DEPENDENCY");
  });

  test("detects cycles and self-dependencies", () => {
    const selfDep = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["executor.git"],
          configuration_refs: [],
        },
      ],
    };
    expect(() => validateComposition(selfDep)).toThrow("COMPOSITION_SELF_DEPENDENCY");

    const cycle = {
      ...exampleFixture,
      modules: [
        {
          id: "projection.banner",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["projection.island"],
          configuration_refs: [],
        },
        {
          id: "projection.island",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["projection.banner"],
          configuration_refs: [],
        },
      ],
    };
    expect(() => validateComposition(cycle)).toThrow("COMPOSITION_CYCLE_DETECTED");
  });

  test("rejects malformed and private refs", () => {
    const rawPrivateRef = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: ["/etc/passwd"],
        },
      ],
    };
    expect(() => validateComposition(rawPrivateRef)).toThrow("COMPOSITION_MALFORMED_REF");

    const validRefs = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: ["binding:github-token", "secret-ref:ssh-key"],
        },
      ],
    };
    expect(() => validateComposition(validRefs)).not.toThrow();
  });

  test("rejects duplicate module IDs, integration IDs, requires, and refs", () => {
    const dupMod = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
      ],
    };
    expect(() => validateComposition(dupMod)).toThrow("COMPOSITION_DUPLICATE_MODULE");
  });

  test("deterministic ordering under permutations", () => {
    const perm1 = {
      ...exampleFixture,
      modules: [
        {
          id: "skills.binding",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: ["binding:z", "binding:a"],
        },
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
      ],
    };
    const perm2 = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
        {
          id: "skills.binding",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: ["binding:a", "binding:z"],
        },
      ],
    };

    const val1 = validateComposition(perm1);
    const val2 = validateComposition(perm2);
    expect(JSON.stringify(val1)).toBe(JSON.stringify(val2));
  });
});

describe("composition inspect & observation evaluation", () => {
  const baseNow = 1760000000000;

  test("inspects without observations -> returns unknown states and readiness unknown", () => {
    const report = inspectComposition(exampleFixture, undefined, baseNow);
    expect(report.schema).toBe(COMPOSITION_REPORT_SCHEMA);
    expect(report.mode).toBe("configuration-only");
    expect(report.effect_authorized).toBe(false);
    expect(report.readiness).toBe("unknown");
    expect(report.kernel.requires_integrations).toBe(false);
    expect(report.kernel.requires_superset).toBe(false);
    expect(report.kernel.acceptance_owner).toBe("isa");
    expect(report.kernel.planning_owner).toBe("gsd");
    expect(report.kernel.execution_authorized).toBe(false);
    expect(report.modules.every((m) => m.state === "unknown" && m.readiness === "unknown")).toBe(true);
  });

  test("valid fresh observations evaluate to configuration-observed", () => {
    const observations: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [
        { id: "executor.git", state: "healthy", configuration_refs: [] },
        { id: "projection.banner", state: "configured", configuration_refs: [] },
        { id: "skills.binding", state: "admitted", configuration_refs: [] },
      ],
    };

    const report = inspectComposition(exampleFixture, observations, baseNow);
    expect(report.readiness).toBe("configuration-observed");
    expect(report.effect_authorized).toBe(false);
    expect(report.kernel.execution_authorized).toBe(false);
    for (const mod of report.modules) {
      expect(mod.readiness).toBe("configuration-observed");
      expect(mod.missing_refs).toEqual([]);
      expect(mod.dependency_blockers).toEqual([]);
    }
  });

  test("admitted observation state NEVER promotes effect authorization", () => {
    const observations: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [
        { id: "executor.git", state: "admitted", configuration_refs: [] },
        { id: "projection.banner", state: "admitted", configuration_refs: [] },
        { id: "skills.binding", state: "admitted", configuration_refs: [] },
      ],
    };

    const report = inspectComposition(exampleFixture, observations, baseNow);
    expect(report.effect_authorized).toBe(false);
    expect(report.kernel.execution_authorized).toBe(false);
  });

  test("missing configuration refs cause held readiness", () => {
    const compWithRefs: CompositionV1 = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: ["secret-ref:deploy-key"],
        },
      ],
    };

    const observations: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [
        { id: "executor.git", state: "healthy", configuration_refs: [] },
      ],
    };

    const report = inspectComposition(compWithRefs, observations, baseNow);
    expect(report.readiness).toBe("held");
    const mod = report.modules.find((m) => m.id === "executor.git")!;
    expect(mod.readiness).toBe("held");
    expect(mod.missing_refs).toEqual(["secret-ref:deploy-key"]);
  });

  test("failed dependency propagates to dependents", () => {
    const fullComp: CompositionV1 = {
      ...exampleFixture,
      modules: [
        {
          id: "executor.git",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
        {
          id: "skills.binding",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: [],
          configuration_refs: [],
        },
        {
          id: "executor.hands",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["executor.git", "skills.binding"],
          configuration_refs: [],
        },
        {
          id: "transport.a2a",
          owner: "operator",
          plant_id: "plant-standalone-local",
          requires: ["executor.hands"],
          configuration_refs: [],
        },
      ],
    };

    const observations: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [
        { id: "executor.git", state: "unavailable", configuration_refs: [] }, // Fails here
        { id: "skills.binding", state: "healthy", configuration_refs: [] },
        { id: "executor.hands", state: "healthy", configuration_refs: [] },
        { id: "transport.a2a", state: "healthy", configuration_refs: [] },
      ],
    };

    const report = inspectComposition(fullComp, observations, baseNow);
    expect(report.readiness).toBe("held");
    const gitMod = report.modules.find((m) => m.id === "executor.git")!;
    const handsMod = report.modules.find((m) => m.id === "executor.hands")!;
    const a2aMod = report.modules.find((m) => m.id === "transport.a2a")!;

    expect(gitMod.readiness).toBe("held");
    expect(handsMod.readiness).toBe("held");
    expect(handsMod.dependency_blockers).toEqual(["executor.git"]);
    expect(a2aMod.readiness).toBe("held");
    expect(a2aMod.dependency_blockers).toEqual(["executor.hands"]);
  });

  test("rejects observation future timestamp and invalid expiry", () => {
    const futureObs: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow + 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [],
    };
    expect(() => inspectComposition(exampleFixture, futureObs, baseNow))
      .toThrow("COMPOSITION_OBSERVATION_FUTURE_TIMESTAMP");

    const invertedExpiry: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow - 20000).toISOString(),
      modules: [],
    };
    expect(() => inspectComposition(exampleFixture, invertedExpiry, baseNow))
      .toThrow("COMPOSITION_OBSERVATION_EXPIRY_INVALID");

    const longExpiry: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 400000).toISOString(), // > 5 minutes
      modules: [],
    };
    expect(() => inspectComposition(exampleFixture, longExpiry, baseNow))
      .toThrow("COMPOSITION_OBSERVATION_EXPIRY_INVALID");
  });

  test("rejects cross-plant observations", () => {
    const crossPlantObs: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "different-plant",
      observed_at: new Date(baseNow - 10000).toISOString(),
      expires_at: new Date(baseNow + 50000).toISOString(),
      modules: [],
    };
    expect(() => inspectComposition(exampleFixture, crossPlantObs, baseNow))
      .toThrow("COMPOSITION_CROSS_PLANT_MISMATCH");
  });

  test("stale observations yield stale state and unknown readiness", () => {
    const staleObs: CompositionObservationsV1 = {
      schema: COMPOSITION_OBSERVATIONS_SCHEMA,
      plant_id: "plant-standalone-local",
      observed_at: new Date(baseNow - 60000).toISOString(),
      expires_at: new Date(baseNow - 10000).toISOString(),
      modules: [
        { id: "executor.git", state: "healthy", configuration_refs: [] },
      ],
    };
    const report = inspectComposition(exampleFixture, staleObs, baseNow);
    expect(report.readiness).toBe("unknown");
    expect(report.modules.every((m) => m.state === "stale" && m.readiness === "unknown")).toBe(true);
  });
});

describe("adversarial boundaries", () => {
 const now = 1760000000000;
 const obs = () => ({schema: COMPOSITION_OBSERVATIONS_SCHEMA, plant_id: exampleFixture.plant.id, observed_at: new Date(now-1000).toISOString(), expires_at: new Date(now+1000).toISOString(), modules: exampleFixture.modules.map(m => ({id: m.id, state: "configured", configuration_refs: []}))});
 test("nested getters and toJSON are never invoked", () => {
  let calls = 0; const input = structuredClone(exampleFixture);
  Object.defineProperty(input.plant, "owner", {enumerable: true, get() {calls++; throw new Error("private");}});
  expect(() => validateComposition(input)).toThrow("COMPOSITION_ACCESSOR_NOT_ALLOWED"); expect(calls).toBe(0);
  const hooks = structuredClone(exampleFixture); Object.assign(hooks.plant, {toJSON() {calls++; return {};}});
  expect(() => validateComposition(hooks)).toThrow(); expect(calls).toBe(0);
 });
 test("custom arrays and hidden fields are rejected", () => {
  const input = structuredClone(exampleFixture); Object.setPrototypeOf(input.modules, {}); expect(() => validateComposition(input)).toThrow();
  const hidden = structuredClone(exampleFixture); Object.defineProperty(hidden.plant, "private", {value: "private"}); expect(() => validateComposition(hidden)).toThrow();
 });
 test("canonical dates, exclusive expiry and valid injected clocks", () => {
  const o = obs(); expect(inspectComposition(exampleFixture, o, now+1000).modules.every(m => m.state === "stale")).toBe(true);
  expect(() => inspectComposition(exampleFixture, {...o, observed_at: "2025-02-30T00:00:00.000Z"}, now)).toThrow();
  expect(() => inspectComposition(exampleFixture, {...o, observed_at: o.observed_at.replace(".000Z", "Z")}, now)).toThrow();
  expect(() => inspectComposition(exampleFixture, {...o, expires_at: o.observed_at}, now)).toThrow();
  for (const clock of [NaN, Infinity, now+0.5]) expect(() => inspectComposition(exampleFixture, o, clock)).toThrow("COMPOSITION_INVALID_NOW");
  expect(() => inspectComposition(exampleFixture, null, now)).toThrow();
 });
 test("undeclared and duplicate observation modules rejected", () => {
  const o = obs(); expect(() => inspectComposition(exampleFixture, {...o, modules: [...o.modules, {id: "organ.nutrix", state: "healthy", configuration_refs: []}]}, now)).toThrow();
  expect(() => inspectComposition(exampleFixture, {...o, modules: [o.modules[0], o.modules[0]]}, now)).toThrow("COMPOSITION_DUPLICATE_MODULE");
 });
 test("detached data and permutation-invariant digest", () => {
  const input = structuredClone(exampleFixture); const before = JSON.stringify(input); const normal = validateComposition(input);
  normal.plant.owner = "changed"; normal.modules[0]!.configuration_refs.push("binding:new"); expect(JSON.stringify(input)).toBe(before);
  expect(inspectComposition(input).source_manifest_digest).toBe(inspectComposition({...input, modules: [...input.modules].reverse()}).source_manifest_digest);
 });
 test("case variants cannot take product repository", () => {
  expect(() => validateComposition({...exampleFixture, integrations: [{id: "other", repository: PRODUCT_REPOSITORY.toLowerCase(), plant_id: exampleFixture.plant.id, requires: []}]})).toThrow("COMPOSITION_INTEGRATION_PRODUCT_COLLISION");
 });
});

test("duplicate integrations, requirements, refs and array bounds", () => {
 const integration = {id: "optional", repository: "github.com/example/optional", plant_id: exampleFixture.plant.id, requires: []};
 expect(() => validateComposition({...exampleFixture, integrations: [integration, integration]})).toThrow("COMPOSITION_DUPLICATE_INTEGRATION");
 const module = {...exampleFixture.modules[0]!, configuration_refs: ["binding:a", "binding:a"]};
 expect(() => validateComposition({...exampleFixture, modules: [module]})).toThrow("COMPOSITION_DUPLICATE_REF");
 const withDeps = {...exampleFixture.modules.find(m => m.id === "projection.banner")!, requires: ["executor.git", "executor.git"]};
 expect(() => validateComposition({...exampleFixture, modules: [withDeps, exampleFixture.modules.find(m => m.id === "executor.git")!]})).toThrow("COMPOSITION_DUPLICATE_REQUIREMENT");
 expect(() => validateComposition({...exampleFixture, modules: Array(65).fill(module)})).toThrow("COMPOSITION_SIZE_EXCEEDED");
 expect(() => validateComposition({...exampleFixture, integrations: Array(17).fill(integration)})).toThrow("COMPOSITION_SIZE_EXCEEDED");
});
test("standalone example needs neither Cambium nor Superset and excludes private values", () => {
 const report = inspectComposition(exampleFixture);
 expect(report.integrations).toEqual([]); expect(report.kernel.requires_superset).toBe(false); expect(JSON.stringify(report).toLowerCase()).not.toContain("cambium");
 for (const ref of ["user@example.com", "/Users/private/key", "https://private.example/token", "secret-ref:raw=value"]) {
 expect(() => validateComposition({...exampleFixture, modules: [{...exampleFixture.modules[0]!, configuration_refs: [ref]}]})).toThrow("COMPOSITION_MALFORMED_REF"); }
});
