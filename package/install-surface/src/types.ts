export const FRAGMENT_SCHEMA = "temperance.install-surface.fragment.v1" as const;
export const LOCK_SCHEMA = "temperance.install-surface.lock.v1" as const;
export const PRIVATE_REGISTRY_SCHEMA = "temperance.private-registry.v1" as const;
export const DOCTOR_REPORT_SCHEMA = "temperance.doctor.report.v1" as const;

export interface SchemaVersionV1 {
  major: 1;
  minor: 0;
}

export type SurfaceClass = "COPY" | "TRANSFORM" | "REGENERATE" | "NEVER-SHIP";
export type OwnershipKind = "exclusive-path" | "managed-block";

export interface DestinationOwnership {
  kind: OwnershipKind;
  marker_id?: string;
}

export interface InstallDestination {
  root_token: string;
  relative_path: string;
  ownership: DestinationOwnership;
}

export interface AuthorityReference {
  requirement_ids: string[];
  isa: string;
}

export interface SurfaceEligibility {
  platforms: Array<"darwin" | "linux" | "win32">;
  profiles: string[];
  required: boolean;
}

export interface IdentityMigration {
  from_id: string;
  to_id: string;
}

interface SurfaceRecordBase {
  id: string;
  owner: string;
  destination: InstallDestination;
  authority: AuthorityReference;
  eligibility: SurfaceEligibility;
  depends_on?: string[];
  identity_migration?: IdentityMigration;
}

export interface CopySurfaceRecord extends SurfaceRecordBase {
  class: "COPY";
  source: string;
  verification: { method: "sha256" };
  rollback: { policy: "restore-backup" | "remove-installed" };
}

export interface TransformSurfaceRecord extends SurfaceRecordBase {
  class: "TRANSFORM";
  source: string;
  verification: { method: "adapter"; adapter_id: string };
  rollback: { policy: "restore-backup" | "remove-installed" };
}

export interface RegenerateSurfaceRecord extends SurfaceRecordBase {
  class: "REGENERATE";
  verification: { method: "semantic-probe"; generator_id: string };
  rollback: { policy: "regenerate" | "remove-installed" };
}

export interface NeverShipSurfaceRecord extends SurfaceRecordBase {
  class: "NEVER-SHIP";
  verification: { method: "symbolic-exclusion" | "presence-only" };
  rollback: { policy: "none-private" };
}

export type SurfaceRecord =
  | CopySurfaceRecord
  | TransformSurfaceRecord
  | RegenerateSurfaceRecord
  | NeverShipSurfaceRecord;

export interface InstallSurfaceFragmentV1 {
  schema: typeof FRAGMENT_SCHEMA;
  schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1";
  version: SchemaVersionV1;
  records: SurfaceRecord[];
}

export interface InstallSurfaceLockV1 {
  schema: typeof LOCK_SCHEMA;
  schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1";
  version: SchemaVersionV1;
  records: SurfaceRecord[];
}

export type DoctorCondition =
  | "PASS"
  | "DRIFT"
  | "WARN"
  | "FAIL"
  | "SKIPPED"
  | "UNSUPPORTED"
  | "PRIVATE"
  | "UNAVAILABLE";

export type DoctorExitCode = 0 | 1 | 2;

export interface DoctorCheck {
  id: string;
  source: string;
  destination: string;
  class: SurfaceClass | "RUNTIME";
  expected_state: string;
  actual_state: string;
  condition: DoctorCondition;
  reason_code: string;
  severity: "info" | "warning" | "error";
  actionable: boolean;
  remediation: string;
  evidence: string[];
}

export interface DoctorSection {
  id: "install" | "privacy" | "runtime";
  condition: DoctorCondition;
  checks: DoctorCheck[];
}

export interface DoctorReportV1 {
  schema: typeof DOCTOR_REPORT_SCHEMA;
  version: SchemaVersionV1;
  generated_at: string;
  scope: "complete" | "partial";
  requested_sections: DoctorSection["id"][];
  overall_condition: DoctorCondition;
  exit_code: DoctorExitCode;
  manifest_digest: `sha256:${string}`;
  sections: DoctorSection[];
}
