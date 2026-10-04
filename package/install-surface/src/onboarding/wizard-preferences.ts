import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

export interface WizardPreferences {
  schema: "temperance.onboarding-preferences.v1";
  profile_id: string;
  selected_module_ids: string[];
}

/** Requests only: never an activation, auth, readiness, or execution receipt. */
export function validateWizardPreferences(value: unknown, profileId: string, moduleIds: readonly string[]): WizardPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WIZARD_PREFERENCES_INVALID");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "profile_id,schema,selected_module_ids" || v.schema !== "temperance.onboarding-preferences.v1"
    || v.profile_id !== profileId || !Array.isArray(v.selected_module_ids) || v.selected_module_ids.length > 256
    || v.selected_module_ids.some((id) => typeof id !== "string" || !moduleIds.includes(id))
    || new Set(v.selected_module_ids).size !== v.selected_module_ids.length) throw new Error("WIZARD_PREFERENCES_INVALID");
  return { schema: "temperance.onboarding-preferences.v1", profile_id: profileId, selected_module_ids: [...v.selected_module_ids as string[]].sort() };
}

export interface WizardPreferencesReadOptions {
  /** Treat a file saved for another profile as absent. Only for the automatic default path, never an explicit one. */
  ignoreOtherProfile?: boolean;
}

function savedForOtherProfile(value: unknown, profileId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const saved = (value as Record<string, unknown>).profile_id;
  return typeof saved === "string" && saved !== profileId;
}

export function readWizardPreferences(path: string, profileId: string, moduleIds: readonly string[], options: WizardPreferencesReadOptions = {}): WizardPreferences | undefined {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("WIZARD_PREFERENCES_UNREADABLE");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536 || (stat.mode & 0o077) !== 0) throw new Error("WIZARD_PREFERENCES_UNSAFE");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (options.ignoreOtherProfile && savedForOtherProfile(value, profileId)) return undefined;
  return validateWizardPreferences(value, profileId, moduleIds);
}

export interface WizardPreferencesWriteOptions {
  /** Widens the check on the file being replaced, so ids retired since it was written do not block a save. */
  previousModuleIds?: readonly string[];
  /** Allow replacing a file saved for another profile (automatic default path only). */
  replaceOtherProfile?: boolean;
}

export function writeWizardPreferences(path: string, value: WizardPreferences, moduleIds: readonly string[], options: WizardPreferencesWriteOptions = {}): void {
  const preferences = validateWizardPreferences(value, value.profile_id, moduleIds);
  const output = resolve(path);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) !== 0) throw new Error("WIZARD_PREFERENCES_PARENT_UNSAFE");
  // Refuse to replace another kind of file or a linked path, and another profile unless explicitly allowed.
  readWizardPreferences(output, preferences.profile_id, options.previousModuleIds ?? moduleIds, { ignoreOtherProfile: options.replaceOtherProfile });
  const temporary = `${output}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try { writeFileSync(fd, `${JSON.stringify(preferences, null, 2)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, output);
  } catch (error) { unlinkSync(temporary); throw error; }
}
