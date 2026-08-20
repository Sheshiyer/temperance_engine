import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { MAX_PRIVATE_REGISTRY_BYTES, validatePrivateRegistry } from "./schema.ts";
import type { DoctorCondition } from "./types.ts";

interface PrivateRegistryRecord {
  id: string;
  class: "NEVER-SHIP";
  enabled: boolean;
  binding: string;
  label: string;
  provider: string;
  notes: string;
  policy_rule: string;
}

interface PrivateRegistryDocument {
  schema: "temperance.private-registry.v1";
  version: { major: 1; minor: 0 };
  records: PrivateRegistryRecord[];
}

export interface PrivateOverlayProjection {
  schema_version: 1;
  id: string;
  class: "NEVER-SHIP";
  enabled: boolean;
  presence: "disabled" | "present" | "missing";
  policy_rule: string;
  condition: "SKIPPED" | "PRIVATE" | "WARN";
}

export interface PrivateRegistryObservation {
  condition: DoctorCondition;
  reason_code: string;
  records: PrivateOverlayProjection[];
}

function currentUid(): number {
  if (typeof process.getuid !== "function") throw new Error("PRIVATE_REGISTRY_UID_UNAVAILABLE");
  return process.getuid();
}

function containedBinding(stateRoot: string, binding: string): string {
  const candidate = isAbsolute(binding) ? binding : resolve(stateRoot, binding);
  if (candidate !== candidate.normalize("NFC") || candidate.includes("\0") || candidate !== resolve(candidate)) {
    throw new Error("PRIVATE_REGISTRY_BINDING_INVALID");
  }
  const rel = relative(resolve(stateRoot), candidate);
  if (rel === "" || rel === ".." || rel.split(sep).some((segment) => segment === "..") || isAbsolute(rel)) {
    throw new Error("PRIVATE_REGISTRY_BINDING_ESCAPE");
  }
  return candidate;
}

function bindingPresence(stateRoot: string, binding: string): "present" | "missing" {
  const candidate = containedBinding(stateRoot, binding);
  try {
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink()) throw new Error("PRIVATE_REGISTRY_BINDING_SYMLINK");
    realpathSync(candidate);
    return "present";
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PRIVATE_REGISTRY_")) throw error;
    return "missing";
  }
}

export function observePrivateRegistry(stateRoot: string): PrivateRegistryObservation {
  const registryPath = join(stateRoot, "private-overlays", "registry.v1.json");
  if (!existsSync(registryPath)) {
    return { condition: "SKIPPED", reason_code: "PRIVATE_REGISTRY_ABSENT", records: [] };
  }

  let descriptor: number | undefined;
  try {
    const uid = currentUid();
    const parent = dirname(registryPath);
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || parentStat.uid !== uid || (parentStat.mode & 0o777) !== 0o700 || realpathSync(parent) !== resolve(parent)) {
      throw new Error("PRIVATE_REGISTRY_PARENT_INSECURE");
    }
    const before = lstatSync(registryPath);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || (before.mode & 0o777) !== 0o600 || before.nlink !== 1 || realpathSync(registryPath) !== resolve(registryPath)) {
      throw new Error("PRIVATE_REGISTRY_FILE_INSECURE");
    }
    descriptor = openSync(registryPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const after = fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size > MAX_PRIVATE_REGISTRY_BYTES) {
      throw new Error("PRIVATE_REGISTRY_FILE_RACED");
    }
    const value: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    if (!validatePrivateRegistry(value)) throw new Error("PRIVATE_REGISTRY_SCHEMA_INVALID");
    const document = value as PrivateRegistryDocument;
    const records = document.records.map((record): PrivateOverlayProjection => {
      if (!record.enabled) {
        return { schema_version: 1, id: record.id, class: record.class, enabled: false, presence: "disabled", policy_rule: record.policy_rule, condition: "SKIPPED" };
      }
      const presence = bindingPresence(stateRoot, record.binding);
      return {
        schema_version: 1,
        id: record.id,
        class: record.class,
        enabled: true,
        presence,
        policy_rule: record.policy_rule,
        condition: presence === "present" ? "PRIVATE" : "WARN",
      };
    }).sort((left, right) => left.id.localeCompare(right.id));
    const condition = records.some((record) => record.condition === "WARN")
      ? "WARN"
      : records.some((record) => record.condition === "PRIVATE") ? "PRIVATE" : "SKIPPED";
    return { condition, reason_code: "PRIVATE_REGISTRY_VALID", records };
  } catch {
    return { condition: "FAIL", reason_code: "PRIVATE_REGISTRY_INVALID", records: [] };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
