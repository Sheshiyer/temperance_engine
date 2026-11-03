import { digest, digestValue, frozen, id, list, record, type Digest } from "../composition/boundary.ts";
import { validateDescriptor, type ModuleDescriptorV1 } from "../composition/v2.ts";
import type { ModuleContextV2, ModuleHandler } from "../composition/runtime-v2.ts";

export const ORGAN_ROLES = ["vestibule", "adytum", "nutrix", "auspex", "circulator", "praeceptor"] as const;
export type OrganRole = typeof ORGAN_ROLES[number];
const definitions = {
  vestibule: { label: "Session orientation", operations: [{ id: "orient", capability: "context.orient", mode: "read" }, { id: "refresh", capability: "context.refresh", mode: "write" }] },
  adytum: { label: "Context interpretation", operations: [{ id: "interpret", capability: "context.interpret", mode: "read" }, { id: "propose", capability: "proposal.prepare", mode: "write" }] },
  nutrix: { label: "Outcome learning", operations: [{ id: "inspect", capability: "outcome.inspect", mode: "read" }, { id: "harvest", capability: "outcome.harvest", mode: "write" }] },
  auspex: { label: "Health and recovery", operations: [{ id: "diagnose", capability: "health.diagnose", mode: "read" }, { id: "recover", capability: "health.recover", mode: "write" }] },
  circulator: { label: "Outcome and proposal review", operations: [{ id: "review", capability: "learning.review", mode: "read" }, { id: "digest", capability: "digest.record", mode: "write" }] },
  praeceptor: { label: "Workflow improvement", operations: [{ id: "draft", capability: "improvement.propose", mode: "write" }, { id: "promote", capability: "proposal.promote", mode: "write" }, { id: "reject", capability: "proposal.reject", mode: "write" }] },
} as const;
const dependencies: Partial<Record<OrganRole, readonly string[]>> = { adytum: ["organ.vestibule"], circulator: ["organ.nutrix"], praeceptor: ["organ.nutrix"] };

/** Roles are optional package metadata. Core composition never imports this pack. */
export function createOrganPack(source_digest: Digest): {
  descriptors: readonly Readonly<ModuleDescriptorV1>[];
  handlers: Readonly<Record<string, ModuleHandler>>;
} {
  digest(source_digest);
  const descriptors = ORGAN_ROLES.map(role => validateDescriptor({ schema: "temperance.module-descriptor.v1", id: "organ." + role, implementation_ref: "package.temperance-organs", source_digest, requires: [...(dependencies[role] ?? [])], operations: definitions[role].operations.map(operation => ({ ...operation })) }));
  const handlers: Record<string, ModuleHandler> = {};
  for (const role of ORGAN_ROLES) handlers["organ." + role] = { source_digest, invoke: context => invokeRole(role, context) };
  return { descriptors: Object.freeze(descriptors), handlers: Object.freeze(handlers) };
}

/** An owner supplies algorithms and private IO. This layer enforces role output provenance. */
async function invokeRole(role: OrganRole, context: ModuleContextV2) {
  const input = record(context.request.input, ["subject_ref", "evidence_refs", "proposal_ref", "action_ref"]);
  id(input.subject_ref); list(input.evidence_refs, id, 32);
  if (input.proposal_ref !== null) id(input.proposal_ref);
  if (input.action_ref !== null) id(input.action_ref);
  if (role === "auspex" && context.request.operation_id === "recover" && input.action_ref === null) return { status: "held" as const, artifact_refs: [], reason_code: "NAMED_RECOVERY_REQUIRED" };
  if (["promote", "reject"].includes(context.request.operation_id) && input.proposal_ref === null) return { status: "held" as const, artifact_refs: [], reason_code: "EXACT_PROPOSAL_REQUIRED" };
  if (role === "nutrix" && context.request.operation_id === "harvest" && input.evidence_refs.length === 0) return { status: "held" as const, artifact_refs: [], reason_code: "VERIFIED_OUTCOME_REQUIRED" };
  const result = await context.perform(input);
  if (result.status !== "completed") return { status: "held" as const, artifact_refs: [...result.artifact_refs], reason_code: "OWNER_RESULT_HELD" };
  const output = record(result.value, ["kind", "subject_ref", "evidence_refs", "planes", "proposal_ref", "action_ref", "disposition"]);
  if (output.kind !== role || output.subject_ref !== input.subject_ref) throw new Error("ORGAN_RESULT_IDENTITY_MISMATCH");
  if (output.proposal_ref !== input.proposal_ref || output.action_ref !== input.action_ref) throw new Error("ORGAN_ACTION_IDENTITY_MISMATCH");
  const evidence = list(output.evidence_refs, id, 32);
  if (input.evidence_refs.some((ref: string) => !evidence.includes(ref))) throw new Error("ORGAN_EVIDENCE_LOST");
  const planes = list(output.planes, raw => {
    const plane = record(raw, ["plane_ref", "evidence_refs"]); id(plane.plane_ref); list(plane.evidence_refs, id, 32); return plane.plane_ref;
  }, 16);
  if (new Set(planes).size !== planes.length) throw new Error("ORGAN_MEMORY_PLANES_AMBIGUOUS");
  const disposition = id(output.disposition);
  if (role === "nutrix" && context.request.operation_id === "harvest" && disposition !== "verified-recorded") throw new Error("ORGAN_VERIFIED_DELIVERY_UNPROVED");
  if (["adytum", "praeceptor"].includes(role) && ["propose", "draft"].includes(context.request.operation_id) && disposition !== "proposed") throw new Error("ORGAN_PROPOSAL_NOT_PROVISIONAL");
  if (context.request.operation_id === "promote" && disposition !== "reviewed-promoted") throw new Error("ORGAN_PROMOTION_UNPROVED");
  if (context.request.operation_id === "recover" && !["recovered", "unresolved"].includes(disposition)) throw new Error("ORGAN_RECOVERY_READBACK_REQUIRED");
  if (disposition === "unresolved") return { status: "held" as const, artifact_refs: [...result.artifact_refs], reason_code: "RECOVERY_UNRESOLVED" };
  return { status: "completed" as const, artifact_refs: [...result.artifact_refs], reason_code: "ROLE_RESULT_OBSERVED" };
}

export function describeOrganPack() {
  return frozen(ORGAN_ROLES.map(role => ({ id: "organ." + role, name: role, label: definitions[role].label, operations: definitions[role].operations, activation: "explicit-profile-selection", acceptance: "owner-defined" })));
}

export function pinOrganDescriptors(descriptors: readonly Readonly<ModuleDescriptorV1>[]) {
  return descriptors.map(descriptor => ({ id: descriptor.id, descriptor_digest: digestValue(descriptor) }));
}
