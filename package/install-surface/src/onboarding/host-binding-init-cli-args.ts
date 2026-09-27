export interface HostBindingInitCliArgs {
  hostProfilePath: string;
  outputPath: string;
  variables: Record<string, string>;
  secretReferences: Record<string, { store: "macos-keychain"; service: string; account: string }>;
  routingAliases: Array<{ alias: string; combo: string }>;
  volumeBindings: Array<{ id: string; mount_path_variable: string; volume_uuid_variable: string; volume_uuid: string }>;
}

function assignUnique(target: Record<string, string>, key: string, value: string): void {
  if (Object.hasOwn(target, key)) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
  target[key] = value;
}

export function parseHostBindingInitArgs(args: readonly string[]): HostBindingInitCliArgs {
  let hostProfilePath: string | undefined;
  let outputPath: string | undefined;
  const variables: Record<string, string> = {};
  const secretReferences: HostBindingInitCliArgs["secretReferences"] = {};
  const routingAliases: HostBindingInitCliArgs["routingAliases"] = [];
  const volumeBindings: HostBindingInitCliArgs["volumeBindings"] = [];
  const take = (index: number): string => {
    const value = args[index];
    if (!value || value.startsWith("--")) throw new Error("HOST_BINDING_INIT_ARGUMENT_INVALID");
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--host-profile") {
      if (hostProfilePath) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
      hostProfilePath = take(++index);
    } else if (argument === "--output") {
      if (outputPath) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
      outputPath = take(++index);
    } else if (argument === "--set") {
      const name = take(++index);
      const value = take(++index);
      assignUnique(variables, name, value);
    } else if (argument === "--secret-reference") {
      const name = take(++index);
      if (Object.hasOwn(secretReferences, name)) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
      secretReferences[name] = { store: "macos-keychain", service: take(++index), account: take(++index) };
    } else if (argument === "--alias") {
      const alias = take(++index);
      if (routingAliases.some((item) => item.alias === alias)) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
      routingAliases.push({ alias, combo: take(++index) });
    } else if (argument === "--volume") {
      const id = take(++index);
      if (volumeBindings.some((item) => item.id === id)) throw new Error("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
      volumeBindings.push({
        id,
        mount_path_variable: take(++index),
        volume_uuid_variable: take(++index),
        volume_uuid: take(++index),
      });
    } else {
      throw new Error("HOST_BINDING_INIT_ARGUMENT_INVALID");
    }
  }
  if (!hostProfilePath || !outputPath) throw new Error("HOST_BINDING_INIT_ARGUMENT_INVALID");
  return { hostProfilePath, outputPath, variables, secretReferences, routingAliases, volumeBindings };
}
