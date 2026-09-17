export interface V4CutoverReviewCliArgs {
  planPath: string;
  proofPath: string;
  json: boolean;
  tui: boolean;
}

export function parseV4CutoverReviewArgs(args: readonly string[]): V4CutoverReviewCliArgs {
  let planPath: string | undefined;
  let proofPath: string | undefined;
  let json = false;
  let tui = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const take = (): string => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("CUTOVER_REVIEW_ARGUMENT_INVALID");
      index += 1;
      return value;
    };
    if (argument === "--plan") planPath = take();
    else if (argument === "--proof") proofPath = take();
    else if (argument === "--json") json = true;
    else if (argument === "--tui") tui = true;
    else throw new Error("CUTOVER_REVIEW_ARGUMENT_INVALID");
  }
  if (!planPath || !proofPath || (json && tui)) throw new Error("CUTOVER_REVIEW_ARGUMENT_INVALID");
  return { planPath, proofPath, json, tui };
}
