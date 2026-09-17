export interface V4CutoverApplyCliArgs {
  planPath: string;
  proofPath: string;
  confirmationPath: string;
  hostBindingPath: string;
  legacyCredentialReferenceId: string;
  sourceRepository: string;
}

const FLAGS: ReadonlyMap<string, keyof V4CutoverApplyCliArgs> = new Map([
  ["--plan", "planPath"],
  ["--proof", "proofPath"],
  ["--confirmation", "confirmationPath"],
  ["--host-binding", "hostBindingPath"],
  ["--legacy-credential-reference", "legacyCredentialReferenceId"],
  ["--source-repository", "sourceRepository"],
] as const);

export function parseV4CutoverApplyArgs(args: readonly string[]): V4CutoverApplyCliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key = FLAGS.get(argument);
    const value = args[index + 1];
    if (!key || values.has(key) || !value || value.startsWith("--")) {
      throw new Error("CUTOVER_APPLY_ARGUMENT_INVALID");
    }
    values.set(key, value);
    index += 1;
  }
  const required = [...FLAGS.values()];
  if (values.size !== required.length || required.some((key) => !values.has(key))) {
    throw new Error("CUTOVER_APPLY_ARGUMENT_INVALID");
  }
  return Object.fromEntries(values) as unknown as V4CutoverApplyCliArgs;
}
