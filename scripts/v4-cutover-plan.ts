#!/usr/bin/env bun

import { resolve } from "node:path";

import { createV4CutoverPlan } from "../package/router/v4-cutover-plan.ts";

interface Arguments {
  homeDirectory?: string;
  launchAgentsDirectory?: string;
}

export function parseV4CutoverPlanArguments(argv: readonly string[]): Arguments | "help" {
  const parsed: Arguments = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (argv.length !== 1) throw new Error("CUTOVER_ARGUMENT_INVALID");
      return "help";
    }
    if (argument !== "--home" && argument !== "--launch-agents") throw new Error("CUTOVER_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("CUTOVER_ARGUMENT_INVALID");
    if (argument === "--home") parsed.homeDirectory = resolve(value);
    else parsed.launchAgentsDirectory = resolve(value);
    index += 1;
  }
  return parsed;
}

function usage(): string {
  return `Usage: bun scripts/v4-cutover-plan.ts [--home <absolute-path>] [--launch-agents <absolute-path>]\n\nEmits a read-only, secret-free JSON plan. It never stops services, deletes state, installs packages, or activates the replacement.\n`;
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const args = parseV4CutoverPlanArguments(argv);
    if (args === "help") {
      process.stdout.write(usage());
      return 0;
    }
    process.stdout.write(`${JSON.stringify(createV4CutoverPlan(args), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CUTOVER_PLAN_FAILED"}\n`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = main();
