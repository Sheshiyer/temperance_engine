import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readWizardPreferences, validateWizardPreferences, writeWizardPreferences } from "../src/onboarding/wizard-preferences.ts";
import { parseOnboardingArgs } from "../src/onboarding/cli-args.ts";
const roots: string[] = [];
const profile = "fixture";
const modules = ["local-core", "optional-tool"];
const preferences = { schema: "temperance.onboarding-preferences.v1" as const, profile_id: profile, selected_module_ids: ["local-core"] };
function path(): string { const root = mkdtempSync(join(tmpdir(), "wizard-preferences-")); roots.push(root); return join(root, "preferences.json"); }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
test("preferences persist only module requests with owner-only permissions", () => {
  const file = path();
  expect(readWizardPreferences(file, profile, modules)).toBeUndefined();
  writeWizardPreferences(file, preferences, modules);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readWizardPreferences(file, profile, modules)).toEqual(preferences);
  writeWizardPreferences(file, { ...preferences, selected_module_ids: [] }, modules);
  expect(readWizardPreferences(file, profile, modules)?.selected_module_ids).toEqual([]);
});
test("foreign profiles, unknown modules, and authority fields are rejected", () => {
  expect(() => validateWizardPreferences(preferences, "other", modules)).toThrow();
  expect(() => validateWizardPreferences({ ...preferences, selected_module_ids: ["unknown"] }, profile, modules)).toThrow();
  expect(() => validateWizardPreferences({ ...preferences, admitted: true }, profile, modules)).toThrow();
});
test("preferences are an explicit interactive option, never a JSON or repair side effect", () => {
  expect(parseOnboardingArgs(["--tui", "--wizard-state", "/private/preferences.json"]).wizardStatePath).toBe("/private/preferences.json");
  expect(() => parseOnboardingArgs(["--json", "--wizard-state", "/private/preferences.json"])).toThrow("ONBOARDING_ARGUMENT_INVALID");
  expect(() => parseOnboardingArgs(["--tui", "--repair", "--wizard-state", "/private/preferences.json"])).toThrow("ONBOARDING_ARGUMENT_INVALID");
});
test("unsafe or symlinked preferences are never overwritten", () => {
  const file = path(); writeWizardPreferences(file, preferences, modules);
  chmodSync(file, 0o644);
  expect(() => readWizardPreferences(file, profile, modules)).toThrow("WIZARD_PREFERENCES_UNSAFE");
  const link = path(); symlinkSync(file, link);
  expect(() => writeWizardPreferences(link, preferences, modules)).toThrow("WIZARD_PREFERENCES_UNSAFE");
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(preferences);
});
