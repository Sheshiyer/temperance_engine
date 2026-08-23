import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

import doctorReportSchema from "../schemas/doctor-report.v1.schema.json" with { type: "json" };
import doctorReportV2Schema from "../schemas/doctor-report.v2.schema.json" with { type: "json" };
import fragmentSchema from "../schemas/fragment.v1.schema.json" with { type: "json" };
import lockSchema from "../schemas/lock.v1.schema.json" with { type: "json" };
import privateRegistrySchema from "../schemas/private-registry.v1.schema.json" with { type: "json" };
import type {
  DoctorReportV1,
  DoctorReportV2,
  InstallSurfaceFragmentV1,
  InstallSurfaceLockV1,
} from "./types.ts";

export type { DoctorReportV2 };

export const MAX_FRAGMENT_BYTES = 1_048_576;
export const MAX_LOCK_BYTES = 8_388_608;
export const MAX_PRIVATE_REGISTRY_BYTES = 1_048_576;
export const MAX_DOCTOR_REPORT_BYTES = 8_388_608;

export const schemaCompiler = new Ajv2020({
  strict: true,
  allErrors: true,
});

const fragmentValidator = schemaCompiler.compile(fragmentSchema);
const lockValidator = schemaCompiler.compile(lockSchema);
const privateRegistryValidator = schemaCompiler.compile(privateRegistrySchema);
const doctorReportValidator = schemaCompiler.compile(doctorReportSchema);
const doctorReportV2Validator = schemaCompiler.compile(doctorReportV2Schema);

function withinBound(value: unknown, maxBytes: number): boolean {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function validateBounded<T>(
  value: unknown,
  maxBytes: number,
  validator: ValidateFunction<T>,
): value is T {
  return withinBound(value, maxBytes) && validator(value);
}

export function validateFragment(value: unknown): value is InstallSurfaceFragmentV1 {
  return validateBounded(value, MAX_FRAGMENT_BYTES, fragmentValidator);
}

export function validateLock(value: unknown): value is InstallSurfaceLockV1 {
  return validateBounded(value, MAX_LOCK_BYTES, lockValidator);
}

export function validatePrivateRegistry(value: unknown): boolean {
  return validateBounded(value, MAX_PRIVATE_REGISTRY_BYTES, privateRegistryValidator);
}

export function validateDoctorReport(value: unknown): value is DoctorReportV1 {
  return validateBounded(value, MAX_DOCTOR_REPORT_BYTES, doctorReportValidator);
}

export function validateDoctorReportV2(value: unknown): value is DoctorReportV2 {
  return validateBounded(value, MAX_DOCTOR_REPORT_BYTES, doctorReportV2Validator);
}
