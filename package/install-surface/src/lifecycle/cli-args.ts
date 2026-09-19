export interface LifecycleArgs {
  profile?: string;
  dryRun: boolean;
  force: boolean;
  select?: string;
  onlyIds?: Set<string>;
  json: boolean;
}

/** --only is deliberately distinct from the historical --select admission hint. */
export function parseLifecycleArgs(args: readonly string[], command: string): LifecycleArgs {
  const parsed: LifecycleArgs = { dryRun: false, force: false, json: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (seen.has(argument)) throw new Error("LIFECYCLE_ARGUMENT_DUPLICATE");
    seen.add(argument);
    if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--force") parsed.force = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--profile" || argument === "--select" || argument === "--only") {
      const value = args[index += 1];
      if (!value || value.startsWith("--")) throw new Error("LIFECYCLE_ARGUMENT_INVALID");
      if (argument === "--profile") parsed.profile = value;
      else if (argument === "--select") parsed.select = value;
      else {
        if (command !== "install" && command !== "update") throw new Error("PLAN_SCOPE_VERB_UNSUPPORTED");
        const ids = value.split(",");
        if (!ids.every((id) => /^[a-z0-9][a-z0-9._-]*$/.test(id))) throw new Error("LIFECYCLE_SCOPE_INVALID");
        parsed.onlyIds = new Set(ids);
      }
    } else throw new Error("LIFECYCLE_ARGUMENT_INVALID");
  }
  return parsed;
}
