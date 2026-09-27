export const FRAGMENT_SCHEMA = "temperance.install-surface.fragment.v1" as const;
export const LOCK_SCHEMA = "temperance.install-surface.lock.v1" as const;
export const PRIVATE_REGISTRY_SCHEMA = "temperance.private-registry.v1" as const;
export const DOCTOR_REPORT_SCHEMA = "temperance.doctor.report.v1" as const;
export const DOCTOR_REPORT_SCHEMA_V2 = "temperance.doctor.report.v2" as const;

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

/** Modes supported by the text-only public COPY lifecycle. */
export type CopyFileMode = "0644" | "0755";

/** A reviewed source-content declaration for a public COPY record. */
export type CopyExpectation =
  | {
      kind: "file";
      /** Lowercase SHA-256 with the explicit algorithm prefix. */
      sha256: `sha256:${string}`;
      /** Optional for v1 read compatibility; lifecycle install/update requires it. */
      mode?: CopyFileMode;
    }
  | {
      kind: "tree";
      /** Complete source-root-relative regular-file leaf inventory. */
      files: Record<string, `sha256:${string}`>;
      /** Complete source-root-relative regular-file mode inventory. */
      modes?: Record<string, CopyFileMode>;
    };

export interface CopyVerification {
  method: "sha256";
  /** Optional for v1 read compatibility; install/update requires it. */
  expected?: CopyExpectation;
}

export interface IdentityMigration {
  from_id: string;
  to_id: string;
}

/**
 * Runtime dependency declarations for preflight checking.
 * - http-health: probes a URL token (resolved via rootBindings) with HEAD request
 * - binary: checks a command exists on PATH via `which`
 *
 * Doctor v2 host section (Plan 03-01) derives its probes FROM these declarations
 * rather than duplicating them — see spec §3.2 derivation table.
 */
export type RuntimeDependency =
  | { kind: "http-health"; url_token: string }
  | { kind: "binary"; name: string };

interface SurfaceRecordBase {
  id: string;
  owner: string;
  destination: InstallDestination;
  authority: AuthorityReference;
  eligibility: SurfaceEligibility;
  depends_on?: string[];
  identity_migration?: IdentityMigration;
  /** Optional runtime dependency declarations; absent = no requirement. All 18 current records unaffected. */
  requires?: RuntimeDependency[];
}

export interface CopySurfaceRecord extends SurfaceRecordBase {
  class: "COPY";
  source: string;
  verification: CopyVerification;
  rollback: { policy: "restore-backup" | "remove-installed" };
}

export interface TransformSurfaceRecord extends SurfaceRecordBase {
  class: "TRANSFORM";
  source: string;
  /**
   * `expected` binds the reviewed source template. Transform output is often
   * destination-contextual (for example a managed block), so its exact output
   * digest/mode is captured in the transaction manifest before promotion.
   */
  verification: {
    method: "adapter";
    adapter_id: string;
    expected?: Extract<CopyExpectation, { kind: "file" }>;
  };
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
  id: "install" | "privacy" | "runtime" | "manifest" | "host";
  condition: DoctorCondition;
  checks: DoctorCheck[];
}

export interface DoctorReportV1 {
  schema: typeof DOCTOR_REPORT_SCHEMA;
  version: SchemaVersionV1;
  generated_at: string;
  scope: {
    complete: boolean;
    requested_sections: DoctorSection["id"][];
  };
  trustworthy: boolean;
  overall_condition: DoctorCondition;
  exit_code: DoctorExitCode;
  manifest_digest: `sha256:${string}`;
  sections: DoctorSection[];
}

export interface DoctorReportV2 {
  schema: typeof DOCTOR_REPORT_SCHEMA_V2;
  version: { major: 2; minor: 0 };
  generated_at: string;
  scope: {
    complete: boolean;
    requested_sections: DoctorSection["id"][];
  };
  trustworthy: boolean;
  overall_condition: DoctorCondition;
  exit_code: DoctorExitCode;
  inventory_digest: `sha256:${string}`;
  sections: DoctorSection[];
}
