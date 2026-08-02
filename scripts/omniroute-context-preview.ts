#!/usr/bin/env bun

import {
  ContextPreviewError,
  OMNIROUTE_CONTEXT_PREVIEW_SCHEMA,
  runContextPreviewQualification,
} from "../package/router/omniroute-context-preview";

function usage(): string {
  return "usage: bun scripts/omniroute-context-preview.ts";
}

export function parseContextPreviewArguments(argv: readonly string[]): Record<string, never> | "help" {
  if (argv.length === 0) return {};
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
  throw new ContextPreviewError("arguments_invalid");
}

function safeError(code: string): string {
  return JSON.stringify({
    schema: `${OMNIROUTE_CONTEXT_PREVIEW_SCHEMA}.error`,
    ok: false,
    promotionAuthorized: false,
    code,
  });
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseContextPreviewArguments(argv);
    if (options === "help") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const result = await runContextPreviewQualification();
    process.stdout.write(
      `${JSON.stringify({
        schema: OMNIROUTE_CONTEXT_PREVIEW_SCHEMA,
        ok: true,
        result: result.result,
        promotionAuthorized: false,
        tokenSupplied: false,
        receiptPath: result.receiptPath,
      })}\n`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof ContextPreviewError ? error.code : "context_preview_failed";
    process.stdout.write(`${safeError(code)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
