#!/usr/bin/env bun

import { resolve } from "node:path";

import { generateV4ReplacementProof } from "../package/router/v4-replacement-proof.ts";

function usage(): string {
  return "Usage: bun scripts/v4-replacement-proof.ts\n\nVerifies the clean current checkout and emits a secret-free replacement proof.\n";
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write(usage());
    return 0;
  }
  if (argv.length !== 0) {
    process.stderr.write("REPLACEMENT_PROOF_ARGUMENT_INVALID\n");
    return 2;
  }
  try {
    const repositoryRoot = resolve(import.meta.dir, "..");
    const proof = generateV4ReplacementProof({ repositoryRoot });
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "REPLACEMENT_PROOF_FAILED"}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
