import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import contractSchema from "../../schemas/v4-contracts.schema.json" with { type: "json" };
import type { HostBindingV1, HostProfileV1, ModuleDescriptorV2, NineRouterGuidedSetupV1, NineRouterSetupIntentV1, OperationReceiptV1, ProjectCapsuleV1 } from "./public-contracts.ts";

const compiler = new Ajv2020({ strict: true, allErrors: true });
compiler.addSchema(contractSchema);
const schema = <T>(name: string) => compiler.getSchema(`${contractSchema.$id}#/$defs/${name}`) as ValidateFunction<T>;
const validators = {
  hostProfile: schema<HostProfileV1>("hostProfile"), hostBinding: schema<HostBindingV1>("hostBinding"),
  moduleDescriptor: schema<ModuleDescriptorV2>("moduleDescriptor"), projectCapsule: schema<ProjectCapsuleV1>("projectCapsule"), operationReceipt: schema<OperationReceiptV1>("operationReceipt"),
  nineRouterGuidedSetup: schema<NineRouterGuidedSetupV1>("nineRouterGuidedSetup"),
  nineRouterSetupIntent: schema<NineRouterSetupIntentV1>("nineRouterSetupIntent"),
};
function bounded<T>(value: unknown, validator: ValidateFunction<T>): value is T {
  try { const encoded = JSON.stringify(value); return typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= 4_194_304 && validator(value); } catch { return false; }
}
export const validateHostProfileV1 = (value: unknown): value is HostProfileV1 => {
  if (!bounded(value, validators.hostProfile)) return false;
  const preferences = value.routing_provider_preferences ?? [];
  return new Set(preferences.map(({ provider }) => provider)).size === preferences.length;
};
export const validateHostBindingV1 = (value: unknown): value is HostBindingV1 => bounded(value, validators.hostBinding);
export const validateModuleDescriptorV2 = (value: unknown): value is ModuleDescriptorV2 => bounded(value, validators.moduleDescriptor);
export const validateProjectCapsuleV1 = (value: unknown): value is ProjectCapsuleV1 => bounded(value, validators.projectCapsule);
export const validateOperationReceiptV1 = (value: unknown): value is OperationReceiptV1 => bounded(value, validators.operationReceipt);
export const validateNineRouterGuidedSetupV1 = (value: unknown): value is NineRouterGuidedSetupV1 => bounded(value, validators.nineRouterGuidedSetup);
export const validateNineRouterSetupIntentV1 = (value: unknown): value is NineRouterSetupIntentV1 => bounded(value, validators.nineRouterSetupIntent);
