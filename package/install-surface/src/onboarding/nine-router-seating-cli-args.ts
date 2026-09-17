export interface NineRouterSeatingCliArgs {
  hostProfilePath: string;
  hostBindingPath: string;
  intentPath?: string;
  outputPath?: string;
  json: boolean;
  tui: boolean;
}

export function parseNineRouterSeatingArgs(args: readonly string[]): NineRouterSeatingCliArgs {
  let hostProfilePath: string | undefined;
  let hostBindingPath: string | undefined;
  let intentPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;
  let tui = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const takeValue = (): string => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
      index += 1;
      return value;
    };
    if (argument === "--host-profile") hostProfilePath = takeValue();
    else if (argument === "--host-binding") hostBindingPath = takeValue();
    else if (argument === "--intent") intentPath = takeValue();
    else if (argument === "--output") outputPath = takeValue();
    else if (argument === "--json") json = true;
    else if (argument === "--tui") tui = true;
    else throw new Error("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
  }
  if (!hostProfilePath || !hostBindingPath || (json && tui)
    || (json && Boolean(intentPath || outputPath))
    || (!json && (!intentPath || !outputPath))) {
    throw new Error("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
  }
  return { hostProfilePath, hostBindingPath, intentPath, outputPath, json, tui };
}
