#!/usr/bin/env bun
/** Materialize or check reviewed COPY expectations from a full Git commit. */
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import {
  assertWorkingCopyMatches,
  buildCopyInventory,
  CopyInventoryError,
} from "../src/copy-inventory.ts";
import type { SurfaceRecord } from "../src/types.ts";

interface FragmentDocument {
  path: string;
  contents: string;
  value: { records: SurfaceRecord[] };
}

interface Arguments {
  repositoryRoot: string;
  revision: string;
  action: "check" | "write";
}

function inventoryPathError(): never {
  throw new CopyInventoryError("COPY_INVENTORY_WRITE_TARGET_INVALID");
}

/**
 * The inventory script is allowed to rewrite only known package files. Inspect
 * every ancestor with lstat so a checked-in symlink cannot redirect a --write
 * into a private or unrelated path.
 */
function assertSafePackagePath(
  repositoryRoot: string,
  candidate: string,
  options: { allowMissingFinal: boolean; rejectHardlinks: boolean; finalKind: "file" | "directory" },
): void {
  const root = resolve(repositoryRoot);
  const candidatePath = resolve(candidate);
  const rel = relative(root, candidatePath);
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) inventoryPathError();
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    inventoryPathError();
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) inventoryPathError();

  const segments = rel.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment === "." || segment === "..") inventoryPathError();
    current = resolve(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && index === segments.length - 1 && options.allowMissingFinal) return;
      inventoryPathError();
    }
    if (stat.isSymbolicLink()) inventoryPathError();
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) inventoryPathError();
      continue;
    }
    if (
      (options.finalKind === "file" && !stat.isFile())
      || (options.finalKind === "directory" && !stat.isDirectory())
      || (options.rejectHardlinks && stat.nlink > 1)
    ) inventoryPathError();
  }
}

export function assertSafeInventoryWriteTarget(repositoryRoot: string, path: string): void {
  assertSafePackagePath(repositoryRoot, path, { allowMissingFinal: true, rejectHardlinks: true, finalKind: "file" });
}

function usage(): never {
  throw new Error("usage: sync-copy-expectations --revision <full-commit-oid> (--check | --write) [--repository-root <path>]");
}

function parseArgs(args: readonly string[]): Arguments {
  let repositoryRoot = resolve(import.meta.dir, "../../..");
  let revision: string | undefined;
  let action: Arguments["action"] | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repository-root") {
      const value = args[index += 1];
      if (!value) usage();
      repositoryRoot = resolve(value);
    } else if (argument === "--revision") {
      const value = args[index += 1];
      if (!value) usage();
      revision = value;
    } else if (argument === "--check" || argument === "--write") {
      if (action) usage();
      action = argument.slice(2) as Arguments["action"];
    } else {
      usage();
    }
  }
  if (!revision || !action) usage();
  return { repositoryRoot, revision, action };
}

function loadFragments(repositoryRoot: string): FragmentDocument[] {
  const directory = resolve(repositoryRoot, "package/install-surface/fragments");
  assertSafePackagePath(repositoryRoot, directory, { allowMissingFinal: false, rejectHardlinks: false, finalKind: "directory" });
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = resolve(directory, name);
      assertSafePackagePath(repositoryRoot, path, { allowMissingFinal: false, rejectHardlinks: false, finalKind: "file" });
      const contents = readFileSync(path, "utf8");
      let value: unknown;
      try {
        value = JSON.parse(contents);
      } catch {
        throw new CopyInventoryError("COPY_INVENTORY_FRAGMENT_INVALID", { path: name });
      }
      if (!value || typeof value !== "object" || !Array.isArray((value as { records?: unknown }).records)) {
        throw new CopyInventoryError("COPY_INVENTORY_FRAGMENT_INVALID", { path: name });
      }
      return { path, contents, value: value as { records: SurfaceRecord[] } };
    });
}

function recordsFrom(documents: readonly FragmentDocument[]): SurfaceRecord[] {
  const seen = new Set<string>();
  const records: SurfaceRecord[] = [];
  for (const document of documents) {
    for (const record of document.value.records) {
      if (record.class !== "COPY") continue;
      if (seen.has(record.id)) throw new CopyInventoryError("COPY_INVENTORY_RECORD_DUPLICATE", { id: record.id });
      seen.add(record.id);
      records.push(record);
    }
  }
  return records;
}

function nextContents(document: FragmentDocument, expectations: ReadonlyMap<string, unknown>): string {
  if (!document.value.records.some((record) => record.class === "COPY")) return document.contents;
  const value = structuredClone(document.value) as { records: SurfaceRecord[] };
  for (const record of value.records) {
    if (record.class !== "COPY") continue;
    const expected = expectations.get(record.id);
    if (!expected) throw new CopyInventoryError("COPY_INVENTORY_EXPECTATION_MISSING", { id: record.id });
    record.verification = { ...record.verification, expected };
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function expectationMatches(document: FragmentDocument, expectations: ReadonlyMap<string, unknown>): boolean {
  for (const record of document.value.records) {
    if (record.class !== "COPY") continue;
    const expected = expectations.get(record.id);
    if (!expected || canonical(record.verification.expected ?? null) !== canonical(expected)) return false;
  }
  return true;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const documents = loadFragments(args.repositoryRoot);
  const records = recordsFrom(documents);
  const built = buildCopyInventory({
    repositoryRoot: args.repositoryRoot,
    revision: args.revision,
    records,
  });
  const provenancePath = resolve(args.repositoryRoot, "package/install-surface/copy-expectations.provenance.json");
  assertSafeInventoryWriteTarget(args.repositoryRoot, provenancePath);
  const expectedProvenance = canonical(built.provenance);

  if (args.action === "check") {
    if (!documents.every((document) => expectationMatches(document, built.expectations))) {
      throw new CopyInventoryError("COPY_INVENTORY_EXPECTATION_DRIFT");
    }
    if (!existsSync(provenancePath) || readFileSync(provenancePath, "utf8") !== expectedProvenance) {
      throw new CopyInventoryError("COPY_INVENTORY_PROVENANCE_DRIFT");
    }
    assertWorkingCopyMatches({
      repositoryRoot: args.repositoryRoot,
      records,
      expectations: built.expectations,
    });
  } else {
    const changedDocuments = documents.filter((document) => nextContents(document, built.expectations) !== document.contents);
    const provenanceChanged = !existsSync(provenancePath) || readFileSync(provenancePath, "utf8") !== expectedProvenance;
    // Validate every target before the first write, then revalidate immediately
    // at each write boundary below. This prevents partial publication through a
    // static symlink or hardlink discovered after another document changed.
    for (const document of changedDocuments) assertSafeInventoryWriteTarget(args.repositoryRoot, document.path);
    if (provenanceChanged) assertSafeInventoryWriteTarget(args.repositoryRoot, provenancePath);
    for (const document of documents) {
      const next = nextContents(document, built.expectations);
      if (next !== document.contents) {
        assertSafeInventoryWriteTarget(args.repositoryRoot, document.path);
        writeFileSync(document.path, next, "utf8");
      }
    }
    if (provenanceChanged) {
      assertSafeInventoryWriteTarget(args.repositoryRoot, provenancePath);
      writeFileSync(provenancePath, expectedProvenance, "utf8");
    }
  }

  process.stdout.write(canonical({
    action: args.action,
    revision: built.provenance.revision,
    tree: built.provenance.tree,
    copy_records: built.provenance.records.length,
  }));
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const code = error instanceof Error ? error.message : "COPY_INVENTORY_UNKNOWN";
    process.stderr.write(`sync-copy-expectations: ${code}\n`);
    process.exitCode = 1;
  }
}
