import { ONBOARDING_WIZARD_STEPS, type WizardStepId } from "./wizard.ts";

export interface OnboardingCliArgs {
  catalogPath?: string;
  profilePath?: string;
  hostProfilePath?: string;
  hostBindingPath?: string;
  projectCapsulesPath?: string;
  projectCapsulesOutPath?: string;
  wizardStatePath?: string;
  routerSetupPath?: string;
  receiptDirectory?: string;
  selections?: Set<string>;
  json: boolean;
  tui: boolean;
  doctor: boolean;
  apply: boolean;
  agent: boolean;
  health: boolean;
  logs: boolean;
  telemetry: boolean;
  step?: WizardStepId;
  actionId?: string;
  selectedCandidateIds?: string[];
  logLimit?: number;
  runId?: string;
}

export function parseOnboardingArgs(args: string[]): OnboardingCliArgs {
  let catalogPath: string | undefined;
  let profilePath: string | undefined;
  let hostProfilePath: string | undefined;
  let hostBindingPath: string | undefined;
  let projectCapsulesPath: string | undefined;
  let projectCapsulesOutPath: string | undefined;
  let wizardStatePath: string | undefined;
  let routerSetupPath: string | undefined;
  let receiptDirectory: string | undefined;
  let selections: Set<string> | undefined;
  let json = false;
  let tui = false;
  let doctor = false;
  let apply = false;
  let agent = false, health = false, logs = false, telemetry = false;
  let step: WizardStepId | undefined, actionId: string | undefined, selectedCandidateIds: string[] | undefined;
  let logLimit: number | undefined, runId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const takeValue = (): string => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("ONBOARDING_ARGUMENT_INVALID");
      index += 1;
      return value;
    };
    if (argument === "--catalog") catalogPath = takeValue();
    else if (argument === "--profile-file" || argument === "--profile") profilePath = takeValue();
    else if (argument === "--host-profile-file" || argument === "--host-profile") hostProfilePath = takeValue();
    else if (argument === "--host-binding-file" || argument === "--host-binding") hostBindingPath = takeValue();
    else if (argument === "--project-capsules") projectCapsulesPath = takeValue();
    else if (argument === "--project-capsules-out") projectCapsulesOutPath = takeValue();
    else if (argument === "--wizard-state") wizardStatePath = takeValue();
    else if (argument === "--router-setup") routerSetupPath = takeValue();
    else if (argument === "--receipt-dir") receiptDirectory = takeValue();
    else if (argument === "--select") selections = new Set(takeValue().split(",").filter(Boolean));
    else if (argument === "--json") json = true;
    else if (argument === "--tui") tui = true;
    else if (argument === "--doctor") doctor = true;
    else if (argument === "--agent") agent = true;
    else if (argument === "--health") health = true;
    else if (argument === "--logs") logs = true;
    else if (argument === "--telemetry") telemetry = true;
    else if (argument === "--step") {
      const value = takeValue();
      if (!ONBOARDING_WIZARD_STEPS.includes(value as WizardStepId)) throw new Error("ONBOARDING_ARGUMENT_INVALID");
      step = value as WizardStepId;
    }
    else if (argument === "--action") actionId = takeValue();
    else if (argument === "--project-select") selectedCandidateIds = takeValue().split(",").filter(Boolean);
    else if (argument === "--limit") {
      const value = takeValue();
      if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 200) throw new Error("ONBOARDING_ARGUMENT_INVALID");
      logLimit = Number(value);
    }
    else if (argument === "--run") runId = takeValue();
    else if (argument === "--repair" || argument === "--apply") apply = true;
    else throw new Error("ONBOARDING_ARGUMENT_INVALID");
  }
  const usesComposedProfile = Boolean(hostProfilePath || hostBindingPath);
  const routerOnly = selections?.size === 1 && selections.has("provider.9router");
  if (
    (json && tui)
    || (Boolean(profilePath) && usesComposedProfile)
    || (usesComposedProfile && (!hostProfilePath || !hostBindingPath))
    || (Boolean(projectCapsulesPath) && !usesComposedProfile)
    || ([agent, health, logs, tui, doctor].filter(Boolean).length > 1)
    || (Boolean(projectCapsulesOutPath) && (!usesComposedProfile || (!tui && !agent) || doctor || health || logs || (json && !agent)))
    || (Boolean(wizardStatePath) && ((!tui && !agent && !health) || doctor || apply || logs))
    || (Boolean(step || selectedCandidateIds) && !tui && !agent)
    || (Boolean(actionId) && !agent)
    || ((logLimit !== undefined || Boolean(runId)) && !logs)
    || (telemetry && !tui && !agent && !health)
    || (logs && Boolean(catalogPath || profilePath || hostProfilePath || hostBindingPath || projectCapsulesPath || selections || telemetry))
    || (apply && (agent || health || logs || telemetry))
    || (apply && (!tui || json || doctor || !usesComposedProfile || !routerSetupPath || !receiptDirectory || !routerOnly || Boolean(projectCapsulesOutPath)))
    || (!apply && Boolean(routerSetupPath || receiptDirectory))
  ) {
    throw new Error("ONBOARDING_ARGUMENT_INVALID");
  }
  return {
    catalogPath, profilePath, hostProfilePath, hostBindingPath, projectCapsulesPath, projectCapsulesOutPath, wizardStatePath,
    routerSetupPath, receiptDirectory, selections, json, tui, doctor, apply,
    agent, health, logs, telemetry, step, actionId, selectedCandidateIds, logLimit, runId,
  };
}
