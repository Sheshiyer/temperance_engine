#!/usr/bin/env bun

import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  parseStrictJsonDocument,
  PromotionFailure,
  previewCloudflarePromotion,
} from "../package/router/omniroute-cloudflare-promotion";

const MUTATING_COMMANDS = new Set(["prepare", "promote", "recover", "rollback"]);
const MAX_MANIFEST_BYTES = 65_536;

function usage(): never {
  process.stderr.write("usage: bun scripts/omniroute-cloudflare-promotion.ts preview --manifest /absolute/path/to/manifest.json\n");
  process.stderr.write("       prepare|promote|recover|rollback are fail-closed until a reviewed production adapter and exact external authority are supplied\n");
  process.exit(2);
}

function manifestPath(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--manifest" || !isAbsolute(args[1])) usage();
  const path = resolve(args[1]);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) {
    throw new PromotionFailure("manifest_file_metadata_invalid");
  }
  return path;
}

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();
  const path = manifestPath(args);
  const value = parseStrictJsonDocument(readFileSync(path, "utf8"));
  const repositoryRoot = resolve(import.meta.dir, "..");

  if (command === "preview") {
    emit(previewCloudflarePromotion(value, repositoryRoot));
    return;
  }

  if (MUTATING_COMMANDS.has(command)) {
    // Mutation is intentionally unavailable from this generic wrapper. The core
    // API requires a reviewed adapter whose credential reader, private journal,
    // secret sinks, Cloudflare/OmniRoute calls, launchd lifecycle, and canaries
    // satisfy the injected contract. Dashboard login or environment variables
    // can never silently supply that authority.
    emit({
      schemaVersion: 1,
      kind: "temperance.omniroute-cloudflare-promotion-gate",
      command,
      ready: false,
      mutations: 0,
      code: "production_adapter_and_exact_authority_required",
      doesNotEstablish: ["cloudflare_authority", "hostname_ownership", "operator_approval"],
    });
    process.exit(3);
  }

  usage();
}

main().catch((error: unknown) => {
  const code = error instanceof PromotionFailure ? error.code : "promotion_cli_error";
  emit({ schemaVersion: 1, kind: "temperance.omniroute-cloudflare-promotion-error", code, ready: false, mutations: 0 });
  process.exit(2);
});
