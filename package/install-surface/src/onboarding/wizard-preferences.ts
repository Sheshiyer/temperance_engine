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

export function readWizardPreferences(path: string, profileId: string, moduleIds: readonly string[]): WizardPreferences | undefined {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("WIZARD_PREFERENCES_UNREADABLE");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536 || (stat.mode & 0o077) !== 0) throw new Error("WIZARD_PREFERENCES_UNSAFE");
  return validateWizardPreferences(JSON.parse(readFileSync(path, "utf8")), profileId, moduleIds);
}

export function writeWizardPreferences(path: string, value: WizardPreferences, moduleIds: readonly string[]): void {
  const preferences = validateWizardPreferences(value, value.profile_id, moduleIds);
  const output = resolve(path);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) !== 0) throw new Error("WIZARD_PREFERENCES_PARENT_UNSAFE");
  // Refuse to replace another kind of file, another profile, or a linked path.
  readWizardPreferences(output, preferences.profile_id, moduleIds);
  const temporary = `${output}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try { writeFileSync(fd, `${JSON.stringify(preferences, null, 2)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, output);
  } catch (error) { unlinkSync(temporary); throw error; }
}
