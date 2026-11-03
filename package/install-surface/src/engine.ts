/** Neutral public entry point. Optional packs and v1 compatibility are separate imports. */
export { createBareComposition, validateCompositionV2, validateDescriptor, inspectCompositionV2 } from "./composition/v2.ts";
export type { CompositionV2, ModuleDescriptorV1, ObservationsV2 } from "./composition/v2.ts";
export { invokeModuleV2, readOwnerActionStatus } from "./composition/runtime-v2.ts";
export type { WorkRequestV2, WorkReceiptV2, ModuleContextV2, ModuleHandler, OwnerAdapter, AuthorizationOwner, OwnerResultV1, ActionPlanV1, WorkLedgerV2 } from "./composition/runtime-v2.ts";
export { digestValue } from "./composition/boundary.ts";
