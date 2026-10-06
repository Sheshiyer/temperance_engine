import {canonical} from "../canonical-json.ts";
import {createLocalGitProjectProbe, verifyGitProjectAdmission, validateGitProjectEvidence} from "./git-project-admission.ts";
import type {CompositionCommandResult} from "../composition/cli.ts";

const MAX_BYTES = 65536;
const failure = (error: string): CompositionCommandResult => ({code: 2, stdout: "", stderr: `${JSON.stringify({error})}\n`});

/** Private stdin is inspected locally; no caller probe, volume evidence, or authority is accepted. */
export async function runGitProjectCommand(args: string[], readInput: () => Promise<string> | string): Promise<CompositionCommandResult> {
  if (args.length !== 1 || args[0] !== "inspect") return failure("GIT_PROJECT_CLI_INVALID_ARGUMENTS");
  let raw: string;
  try {raw = await readInput();} catch {return failure("GIT_PROJECT_READ_FAILED");}
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_BYTES) return failure("GIT_PROJECT_SIZE_EXCEEDED");
  let packet: unknown;
  try {packet = JSON.parse(raw);} catch {return failure("GIT_PROJECT_INVALID_JSON");}
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return failure("GIT_PROJECT_INVALID_PACKET");
  const input = packet as Record<string, unknown>;
  if (!Object.hasOwn(input, "capsule") || !Object.hasOwn(input, "binding") || Object.keys(input).some(key => !["capsule", "binding", "worktree_root", "mode"].includes(key)) || (Object.hasOwn(input, "worktree_root") && typeof input.worktree_root !== "string") || (Object.hasOwn(input, "mode") && input.mode !== "read" && input.mode !== "write")) return failure("GIT_PROJECT_INVALID_PACKET");
  try {
    const evidence = await verifyGitProjectAdmission({capsule: input.capsule, binding: input.binding, probe: createLocalGitProjectProbe(), now: Date.now, ...(input.worktree_root === undefined ? {} : {worktree_root: input.worktree_root as string}), mode: input.mode === "write" ? "write" : "read"});
    if (!validateGitProjectEvidence(evidence)) return failure("GIT_PROJECT_INVALID_EVIDENCE");
    return {code: 0, stdout: canonical(evidence), stderr: ""};
  } catch {return failure("GIT_PROJECT_INSPECTION_FAILED");}
}

export async function readGitProjectStdin(): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > MAX_BYTES) return " ".repeat(MAX_BYTES + 1);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
