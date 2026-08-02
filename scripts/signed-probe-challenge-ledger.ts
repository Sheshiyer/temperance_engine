#!/usr/bin/env bun

import { canonicalProbeJson } from "../package/router/signed-probe-receipt";
import {
  consumeProbeChallenge,
  issueProbeChallenge,
  readChallengeLedgerStatus,
  recoverChallengeOperation,
  rollbackIssuedChallenge,
} from "../package/router/signed-probe-challenge-ledger";

type Command = "issue" | "consume" | "status" | "rollback" | "recover";

function usage(): never {
  throw new Error(
    "usage: signed-probe-challenge-ledger.ts " +
    "{issue --ledger FILE --receipt-dir DIR --key-id ID [--lifetime-ms N] [--retention-ms N] | " +
    "consume --ledger FILE --receipt-dir DIR --key-id ID --challenge HEX | " +
    "status --ledger FILE | rollback --receipt FILE --receipt-dir DIR | recover --receipt FILE}",
  );
}

function parseArguments(args: string[]): { command: Command; values: Map<string, string> } {
  const command = args.shift() as Command | undefined;
  if (!command || !["issue", "consume", "status", "rollback", "recover"].includes(command)) usage();
  const values = new Map<string, string>();
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || values.has(flag)) usage();
    values.set(flag, value);
  }
  return { command, values };
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`missing-required-flag:${flag}`);
  return value;
}

function optionalInteger(values: Map<string, string>, flag: string): number | undefined {
  const raw = values.get(flag);
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`invalid-integer-flag:${flag}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`invalid-integer-flag:${flag}`);
  return value;
}

function exactFlags(values: Map<string, string>, allowed: readonly string[]): void {
  for (const flag of values.keys()) {
    if (!allowed.includes(flag)) throw new Error(`unsupported-flag:${flag}`);
  }
}

async function main(): Promise<void> {
  const { command, values } = parseArguments(process.argv.slice(2));
  let result: unknown;
  if (command === "issue") {
    exactFlags(values, ["--ledger", "--receipt-dir", "--key-id", "--lifetime-ms", "--retention-ms"]);
    result = await issueProbeChallenge({
      ledgerPath: required(values, "--ledger"),
      receiptDirectory: required(values, "--receipt-dir"),
      keyId: required(values, "--key-id"),
      lifetimeMs: optionalInteger(values, "--lifetime-ms"),
      retentionAfterExpiryMs: optionalInteger(values, "--retention-ms"),
    });
  } else if (command === "consume") {
    exactFlags(values, ["--ledger", "--receipt-dir", "--key-id", "--challenge"]);
    result = await consumeProbeChallenge({
      ledgerPath: required(values, "--ledger"),
      receiptDirectory: required(values, "--receipt-dir"),
      keyId: required(values, "--key-id"),
      challenge: required(values, "--challenge"),
    });
  } else if (command === "status") {
    exactFlags(values, ["--ledger"]);
    result = readChallengeLedgerStatus(required(values, "--ledger"));
  } else if (command === "rollback") {
    exactFlags(values, ["--receipt", "--receipt-dir"]);
    result = await rollbackIssuedChallenge({
      operationReceiptPath: required(values, "--receipt"),
      receiptDirectory: required(values, "--receipt-dir"),
    });
  } else {
    exactFlags(values, ["--receipt"]);
    result = await recoverChallengeOperation({
      operationReceiptPath: required(values, "--receipt"),
    });
  }
  process.stdout.write(`${canonicalProbeJson(result)}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${canonicalProbeJson({
      schemaVersion: 1,
      kind: "temperance.signed-probe-challenge-error",
      error: reason,
      authorizing: false,
    })}\n`);
    process.exitCode = 2;
  });
}
