// package/relocation/work-object-registry-write.ts
/**
 * Writes a new WorkObject entry into work-object-registry.v1.json — the
 * first write path onto this registry (every existing reader,
 * gatherPacketEvidence included in packet-evidence.ts, only ever matches
 * candidates against entries that already exist).
 *
 * Writes two things atomically, not one: the WorkObject itself, and a
 * matching sourceInventory entry mapping the new project's real vault path
 * to its workId. Both are required — a WorkObject with no sourceInventory
 * entry would be unreachable, since matchCandidateToWorkObject (in
 * packet-evidence.ts) looks a folder up by its sourceInventory entry
 * first, never by scanning workObjects directly.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CanonicalRegistry, RegistryWorkObject } from "./packet-evidence";

export interface NewWorkObjectRegistration {
  workObject: RegistryWorkObject;
  sourceInventoryPath: string;
}

export function writeWorkObjectEntry(registryPath: string, registration: NewWorkObjectRegistration): void {
  let registry: CanonicalRegistry = { workObjects: [], sourceInventory: [] };
  if (existsSync(registryPath)) {
    registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    if (registry.workObjects.some((existing) => existing.workId === registration.workObject.workId)) {
      throw new Error(`work_object_already_exists:${registration.workObject.workId}`);
    }
    if (registry.sourceInventory.some((existing) => existing.path === registration.sourceInventoryPath)) {
      throw new Error(`source_inventory_path_already_exists:${registration.sourceInventoryPath}`);
    }
  }
  registry.workObjects.push(registration.workObject);
  registry.sourceInventory.push({
    path: registration.sourceInventoryPath,
    workRefs: [registration.workObject.workId],
  });
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(registryPath), 0o700);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  chmodSync(registryPath, 0o600);
}
