import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { canonical } from "./canonical-json.ts";
import { compileFragments, writeLock, type CompileResult } from "./compile.ts";
import { loadLock } from "./load.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fragmentRoot = resolve(packageRoot, "fragments");
const lockPath = resolve(packageRoot, "install-surface-manifest.lock.json");

function compileRepositoryFragments(): CompileResult {
  const inputs = readdirSync(fragmentRoot)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      contents: readFileSync(resolve(fragmentRoot, name), "utf8"),
    }));
  return compileFragments(inputs, {
    isaText: readFileSync(resolve(repositoryRoot, "ISA.md"), "utf8"),
    requirementsText: readFileSync(resolve(repositoryRoot, ".planning/REQUIREMENTS.md"), "utf8"),
    priorLock: existsSync(lockPath) ? loadLock(lockPath).lockObject : undefined,
  });
}

function printReceipt(result: CompileResult): void {
  process.stdout.write(canonical({
    digest: result.digest,
    semantic_ids: result.semanticIds,
  }));
}

const command = process.argv[2];
if (command === "compile") {
  printReceipt(compileRepositoryFragments());
} else if (command === "write-lock") {
  const result = compileRepositoryFragments();
  writeLock(lockPath, result.canonicalBytes);
  printReceipt(result);
} else {
  process.stderr.write("usage: bun run src/cli.ts <compile|write-lock|doctor>\n");
  process.exitCode = 64;
}
