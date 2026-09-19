#!/usr/bin/env bun
import { lstatSync, readFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { gatewaySessionAdmission, parseSessionRailPolicy } from "./session-rail.ts";

export function checkSessionAdmission(args: readonly string[], env: NodeJS.ProcessEnv = process.env): { ok: boolean; reasonCode: string } {
  const [phase, alias] = args;
  if (!phase || !alias || args.length !== 2) throw new Error("SESSION_ADMISSION_ARGUMENT_INVALID");
  const aliasOnly = phase === "--alias";
  const explicit = env.TEMPERANCE_SESSION_POLICY;
  if (explicit !== undefined && explicit.trim().length === 0) throw new Error("SESSION_POLICY_INVALID");
  const policyPath = explicit ?? resolve(env.TEMPERANCE_STATE || resolve(env.HOME || homedir(), ".temperance"), "session-policy.json");
  let metadata: Stats;
  try { metadata = lstatSync(policyPath); } catch (error) {
    // lstat sees dangling policy symlinks; only a genuinely absent optional
    // policy is portable core mode. Permission and other I/O errors hold.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("SESSION_POLICY_INVALID");
    if (explicit !== undefined) throw new Error("SESSION_POLICY_MISSING");
    return { ok: true, reasonCode: "OPTIONAL_SESSION_POLICY_NOT_SELECTED" };
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) throw new Error("SESSION_POLICY_INVALID");
  const policy = parseSessionRailPolicy(JSON.parse(readFileSync(policyPath, "utf8")));
  if (!aliasOnly && policy.aliases[phase.toLowerCase()] !== alias) return { ok: false, reasonCode: "SESSION_ALIAS_MISMATCH" };
  return gatewaySessionAdmission("9router", policy, alias);
}

if (import.meta.main) {
  try {
    const result = checkSessionAdmission(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 3;
  } catch (error) {
    const safe = error instanceof Error && /^SESSION_[A-Z_]+$/.test(error.message) ? error.message : "SESSION_POLICY_INVALID";
    process.stderr.write(`${safe}\n`);
    process.exitCode = 3;
  }
}
