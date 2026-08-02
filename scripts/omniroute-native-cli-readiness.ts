#!/usr/bin/env bun

import {
  OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA,
  OmniRouteNativeCliReadinessError,
  runOmniRouteNativeCliReadiness,
} from "../package/router/omniroute-native-cli-readiness";

interface CliOptions {
  receiptRoot?: string;
}

function usage(): string {
  return `Usage:
  bun scripts/omniroute-native-cli-readiness.ts [--receipt-root <private-absolute-directory>]

Offline static inspection only. This command reads the pinned OmniRoute package
sources as inert data, writes one mode-0600 diagnostic receipt, and performs no
network, socket, credential, token-helper, authentication, or mutation action.
`;
}

export function parseOmniRouteNativeCliReadinessArguments(
  argv: readonly string[],
): CliOptions | "help" {
  let receiptRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (argv.length !== 1) throw new OmniRouteNativeCliReadinessError("arguments_invalid");
      return "help";
    }
    if (argument === "--receipt-root") {
      if (receiptRoot !== undefined) {
        throw new OmniRouteNativeCliReadinessError("receipt_root_repeated");
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new OmniRouteNativeCliReadinessError("receipt_root_value_missing");
      }
      receiptRoot = value;
      index += 1;
      continue;
    }
    throw new OmniRouteNativeCliReadinessError("argument_unknown");
  }
  return receiptRoot === undefined ? {} : { receiptRoot };
}

function safeError(code: string): string {
  return JSON.stringify({
    schema: `${OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA}.error`,
    ok: false,
    contractVerified: false,
    authorizationEstablished: false,
    promotionAuthorized: false,
    code,
  });
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseOmniRouteNativeCliReadinessArguments(argv);
    if (options === "help") {
      process.stdout.write(usage());
      return 0;
    }
    const result = runOmniRouteNativeCliReadiness(options);
    process.stdout.write(
      `${JSON.stringify({
        schema: OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA,
        ok: result.receipt.contractVerified,
        observedAt: result.receipt.observedAt,
        validity: result.receipt.validity,
        cacheable: result.receipt.cacheable,
        replayAuthorized: result.receipt.replayAuthorized,
        classification: result.classification,
        contractVerified: result.receipt.contractVerified,
        digestPinSource: result.receipt.digestPinSource,
        integrityScope: result.receipt.nonClaims.integrityScope,
        pinnedFileCount: result.receipt.nonClaims.pinnedFileCount,
        packageIntegrityComplete: result.receipt.nonClaims.packageIntegrityComplete,
        entrypointResolutionPinned: result.receipt.nonClaims.entrypointResolutionPinned,
        loadedModuleGraphVerified: result.receipt.nonClaims.loadedModuleGraphVerified,
        consumerPromotionUseAuthorized:
          result.receipt.nonClaims.consumerPromotionUseAuthorized,
        transportBound: result.receipt.nonClaims.transportBound,
        blockingCondition: result.receipt.nonClaims.blockingCondition,
        authorizationEstablished: false,
        semanticPreviewPerformed: false,
        promotionAuthorized: false,
        receiptPath: result.receiptPath,
      })}\n`,
    );
    return result.receipt.contractVerified ? 0 : 2;
  } catch (error) {
    const code =
      error instanceof OmniRouteNativeCliReadinessError
        ? error.code
        : "native_cli_readiness_failed";
    process.stdout.write(`${safeError(code)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
