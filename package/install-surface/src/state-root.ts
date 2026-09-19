import { join } from "node:path";

export interface RuntimeStateRootOptions {
  stateRoot?: string;
  environment: Readonly<Record<string, string | undefined>>;
  homeDirectory: string;
}

/** Resolve lifecycle state without consulting ambient process or filesystem state. */
export function resolveRuntimeStateRoot(options: RuntimeStateRootOptions): string {
  return options.stateRoot || options.environment.TEMPERANCE_STATE || join(options.homeDirectory, ".temperance");
}
