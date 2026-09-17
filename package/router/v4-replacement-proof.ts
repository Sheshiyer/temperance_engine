import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { createV4ReplacementProof, type V4ReplacementProof } from "./v4-cutover-executor.ts";

export interface ReplacementProofCommandResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface ReplacementProofRunner {
  run(file: string, args: readonly string[], cwd: string): ReplacementProofCommandResult;
}

const bunRunner: ReplacementProofRunner = {
  run(file, args, cwd) {
    const result = Bun.spawnSync([file, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  },
};

function text(result: ReplacementProofCommandResult, code: string): string {
  if (result.exitCode !== 0) throw new Error(code);
  const value = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout).trim();
  if (!value) throw new Error(code);
  return value;
}

function outputDigest(result: ReplacementProofCommandResult, code: string): `sha256:${string}` {
  if (result.exitCode !== 0) throw new Error(code);
  return `sha256:${createHash("sha256")
    .update(result.stdout)
    .update(Uint8Array.of(0))
    .update(result.stderr)
    .digest("hex")}`;
}

/**
 * Produces a proof only from a clean full Git checkout and successful local
 * verification commands. Command output is reduced to digests; it is never
 * embedded in the proof or exposed on a verification failure.
 */
export function generateV4ReplacementProof(options: {
  repositoryRoot: string;
  runner?: ReplacementProofRunner;
  now?: () => Date;
}): V4ReplacementProof {
  const root = resolve(options.repositoryRoot);
  if (!isAbsolute(root) || root.length <= 1) throw new Error("REPLACEMENT_PROOF_ROOT_INVALID");
  const runner = options.runner ?? bunRunner;
  const status = runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], root);
  if (status.exitCode !== 0 || status.stdout.byteLength !== 0) throw new Error("REPLACEMENT_PROOF_WORKTREE_NOT_CLEAN");
  const revision = text(runner.run("git", ["rev-parse", "HEAD"], root), "REPLACEMENT_PROOF_REVISION_UNAVAILABLE");
  const tree = text(runner.run("git", ["rev-parse", "HEAD^{tree}"], root), "REPLACEMENT_PROOF_TREE_UNAVAILABLE");
  const archive = runner.run("git", ["archive", "--format=tar", "HEAD"], root);
  const artifactDigest = outputDigest(archive, "REPLACEMENT_PROOF_ARCHIVE_FAILED");
  const installSurface = runner.run("bun", ["run", "verify"], resolve(root, "package", "install-surface"));
  const cutoverContract = runner.run("bun", [
    "test",
    "package/router/v4-cutover-plan.test.ts",
    "package/router/v4-cutover-executor.test.ts",
    "package/router/v4-cutover-journal.test.ts",
    "package/router/v4-macos-host-adapter.test.ts",
    "package/router/v4-replacement-proof.test.ts",
  ], root);
  return createV4ReplacementProof({
    generated_at: (options.now?.() ?? new Date()).toISOString(),
    temperance_revision: revision,
    temperance_tree: tree,
    router: { package: "9router", version: "0.5.75" },
    artifact_digest: artifactDigest,
    verification: {
      install_surface: outputDigest(installSurface, "REPLACEMENT_PROOF_INSTALL_SURFACE_FAILED"),
      cutover_contract: outputDigest(cutoverContract, "REPLACEMENT_PROOF_CUTOVER_CONTRACT_FAILED"),
    },
  });
}
