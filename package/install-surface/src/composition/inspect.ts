import { createHash } from "node:crypto";

import { canonical } from "../canonical-json.ts";
import {
  COMPOSITION_REPORT_SCHEMA,
  validateComposition,
  validateObservations,
  type CompositionReadiness,
  type CompositionReportV1,
  type ModuleId,
  type ObservedModuleV1,
  type ReportModuleRowV1,
  type ReportModuleState,
} from "./contracts.ts";

function keyOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function inspectComposition(
  input: unknown,
  observations?: unknown,
  now?: number,
): CompositionReportV1 {
  const composition = validateComposition(input);
  const canonicalBytes = canonical(composition);
  const source_manifest_digest = `sha256:${createHash("sha256").update(canonicalBytes, "utf8").digest("hex")}` as const;

  if (now !== undefined && (!Number.isSafeInteger(now) || Math.abs(now) > 8640000000000000)) {
    throw new Error("COMPOSITION_INVALID_NOW");
  }
  const nowTime = now ?? Date.now();

  let isStale = false;
  let obsMap: Map<ModuleId, ObservedModuleV1> | null = null;

  if (observations !== undefined) {
    const validatedObs = validateObservations(observations);
    if (validatedObs.plant_id !== composition.plant.id) {
      throw new Error("COMPOSITION_CROSS_PLANT_MISMATCH");
    }

    const declaredIds = new Set(composition.modules.map((module) => module.id));
    if (validatedObs.modules.some((module) => !declaredIds.has(module.id))) {
      throw new Error("COMPOSITION_OBSERVATION_INVALID");
    }

    const obsTime = Date.parse(validatedObs.observed_at);
    const expTime = Date.parse(validatedObs.expires_at);

    if (obsTime > nowTime) {
      throw new Error("COMPOSITION_OBSERVATION_FUTURE_TIMESTAMP");
    }
    if (expTime <= obsTime || expTime - obsTime > 300000) { // max 5 minutes (300,000 ms)
      throw new Error("COMPOSITION_OBSERVATION_EXPIRY_INVALID");
    }

    if (nowTime >= expTime) {
      isStale = true;
    } else {
      obsMap = new Map();
      for (const mod of validatedObs.modules) {
        obsMap.set(mod.id, mod);
      }
    }
  }

  // Pre-calculate module initial state and missing refs
  interface IntermediateModule {
    id: ModuleId;
    owner: string;
    requires: ModuleId[];
    state: ReportModuleState;
    missing_refs: string[];
  }

  const intermediate: IntermediateModule[] = [];
  for (const mod of composition.modules) {
    if (obsMap === null) {
      intermediate.push({
        id: mod.id,
        owner: mod.owner,
        requires: mod.requires,
        state: isStale ? "stale" : "unknown",
        missing_refs: [...mod.configuration_refs],
      });
    } else {
      const obsMod = obsMap.get(mod.id);
      if (!obsMod) {
        intermediate.push({
          id: mod.id,
          owner: mod.owner,
          requires: mod.requires,
          state: "unknown",
          missing_refs: [...mod.configuration_refs],
        });
      } else {
        const missingRefs = mod.configuration_refs
          .filter((ref) => !obsMod.configuration_refs.includes(ref))
          .sort(keyOrder);
        intermediate.push({
          id: mod.id,
          owner: mod.owner,
          requires: mod.requires,
          state: obsMod.state,
          missing_refs: missingRefs,
        });
      }
    }
  }

  // Evaluate readiness and dependency blockers in DAG order
  const readinessMap = new Map<ModuleId, CompositionReadiness>();
  const dependencyBlockersMap = new Map<ModuleId, ModuleId[]>();

  function evaluateModule(modId: ModuleId): CompositionReadiness {
    if (readinessMap.has(modId)) {
      return readinessMap.get(modId)!;
    }

    const mod = intermediate.find((m) => m.id === modId);
    if (!mod) {
      return "unknown";
    }

    const blockers: ModuleId[] = [];
    for (const req of mod.requires) {
      const reqReadiness = evaluateModule(req);
      if (reqReadiness !== "configuration-observed") {
        blockers.push(req);
      }
    }
    blockers.sort(keyOrder);
    dependencyBlockersMap.set(modId, blockers);

    let readiness: CompositionReadiness;
    if (obsMap === null) {
      readiness = "unknown";
    } else {
      const isConfiguredOrBetter = (
        mod.state === "configured"
        || mod.state === "healthy"
        || mod.state === "admitted"
      );

      if (isConfiguredOrBetter && mod.missing_refs.length === 0 && blockers.length === 0) {
        readiness = "configuration-observed";
      } else if (mod.state === "unknown") {
        readiness = "unknown";
      } else {
        readiness = "held";
      }
    }

    readinessMap.set(modId, readiness);
    return readiness;
  }

  for (const mod of intermediate) {
    evaluateModule(mod.id);
  }

  const moduleRows: ReportModuleRowV1[] = intermediate.map((mod) => ({
    id: mod.id,
    owner: mod.owner,
    state: mod.state,
    missing_refs: mod.missing_refs,
    dependency_blockers: dependencyBlockersMap.get(mod.id) || [],
    readiness: readinessMap.get(mod.id) || "unknown",
  }));

  moduleRows.sort((left, right) => keyOrder(left.id, right.id));

  let overallReadiness: CompositionReadiness = "unknown";
  if (obsMap !== null && moduleRows.length > 0) {
    if (moduleRows.every((m) => m.readiness === "configuration-observed")) {
      overallReadiness = "configuration-observed";
    } else if (moduleRows.some((m) => m.readiness === "held")) {
      overallReadiness = "held";
    } else {
      overallReadiness = "unknown";
    }
  }

  const integrations = composition.integrations.map((i) => ({
    id: i.id,
    repository: i.repository,
  }));
  integrations.sort((left, right) => keyOrder(left.id, right.id));

  return {
    schema: COMPOSITION_REPORT_SCHEMA,
    mode: "configuration-only",
    effect_authorized: false,
    source_manifest_digest,
    plant: {
      id: composition.plant.id,
      owner: composition.plant.owner,
      kind: composition.plant.kind,
    },
    coordinator: {
      surface: composition.coordinator.surface,
      mode: "native",
    },
    integrations,
    modules: moduleRows,
    readiness: overallReadiness,
    kernel: {
      requires_integrations: false,
      requires_superset: false,
      acceptance_owner: "isa",
      planning_owner: "gsd",
      execution_authorized: false,
    },
  };
}
