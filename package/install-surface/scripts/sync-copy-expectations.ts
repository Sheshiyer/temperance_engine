#!/usr/bin/env bun
/** Materialize or check reviewed COPY expectations from a full Git commit. */
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { readBoundedOwnerFile } from "../src/transport/bounded-owner-file.ts";
import { canonical } from "../src/canonical-json.ts";
import {
  assertWorkingCopyMatches,
  buildCopyInventory,
  CopyInventoryError,
} from "../src/copy-inventory.ts";
import type { CopyExpectation, SurfaceRecord } from "../src/types.ts";

interface FragmentDocument {
  path: string;
  contents: string;
  value: { records: SurfaceRecord[] };
}

interface Arguments {
  repositoryRoot: string;
  revision: string;
  action: "check" | "write";
  only?: Set<string>;
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
  throw new Error("usage: sync-copy-expectations --revision <full-commit-oid> (--check | --write) [--repository-root <path>] [--only <COPY-ids>]");
}

function parseArgs(args: readonly string[]): Arguments {
  let repositoryRoot = resolve(import.meta.dir, "../../..");
  let revision: string | undefined;
  let action: Arguments["action"] | undefined;
  let only: Set<string> | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repository-root") {
      const value = args[index += 1];
      if (!value) usage();
      repositoryRoot = resolve(value);
    } else if (argument === "--only") {
      const value = args[index += 1];
      if (!value || only) usage();
      const ids = value.split(",");
      if (ids.length > 64 || ids.some((id) => !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) || new Set(ids).size !== ids.length) usage();
      only = new Set(ids);
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
  if (!revision || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision) || !action) usage();
  return { repositoryRoot, revision, action, only };
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

interface RevisionRecord { id: string; source: string; source_object: string; expectation_digest: string; revision: string; tree: string }
interface ProvenanceV2 { schema: "temperance.install-surface.copy-expectations-provenance.v2"; records: RevisionRecord[] }
function provenanceError(): never { throw new CopyInventoryError("COPY_INVENTORY_PROVENANCE_INVALID"); }
function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.sort().join(",")) provenanceError();
}
/** Source-owned metadata only: reconstruct every retained declaration from Git. */
export function reconstructPinnedInventory(repositoryRoot: string, records: readonly SurfaceRecord[], value: unknown, omittedIds: ReadonlySet<string> = new Set()): { expectations: Map<string, CopyExpectation>; provenance: ProvenanceV2 } {
  const provenance = value as Record<string, unknown>;
  if (!provenance || typeof provenance !== "object") provenanceError();
  const v1 = provenance.schema === "temperance.install-surface.copy-expectations-provenance.v1";
  exactKeys(provenance, v1 ? ["schema", "revision", "tree", "records"] : ["schema", "records"]);
  if (!v1 && provenance.schema !== "temperance.install-surface.copy-expectations-provenance.v2") provenanceError();
  if (v1 && (typeof provenance.revision !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(provenance.revision) || typeof provenance.tree !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(provenance.tree))) provenanceError();
  if (!Array.isArray(provenance.records) || provenance.records.length > 4096) provenanceError();
  const expected = new Map(records.filter((r) => r.class === "COPY").map((r) => [r.id, r]));
  const seen = new Set<string>(); const expectations = new Map<string, CopyExpectation>(); const rebuilt: RevisionRecord[] = [];
  for (const raw of provenance.records) {
    exactKeys(raw, v1 ? ["id", "source", "source_object", "expectation_digest"] : ["id", "source", "source_object", "expectation_digest", "revision", "tree"]);
    if (typeof raw.id !== "string" || seen.has(raw.id) || !expected.has(raw.id)) provenanceError();
    seen.add(raw.id);
    const revision = v1 ? provenance.revision : raw.revision; const tree = v1 ? provenance.tree : raw.tree;
    if (typeof revision !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision) || typeof tree !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(tree)) provenanceError();
    if (typeof raw.source !== "string" || raw.source !== expected.get(raw.id)!.source || typeof raw.source_object !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(raw.source_object) || typeof raw.expectation_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.expectation_digest)) provenanceError();
    const record = expected.get(raw.id)!;
    const built = buildCopyInventory({ repositoryRoot, revision, records: [record] });
    const entry = built.provenance.records[0]!;
    const original = { id: raw.id, source: raw.source, source_object: raw.source_object, expectation_digest: raw.expectation_digest };
    if (canonical(entry) !== canonical(original) || built.provenance.tree !== tree || (!omittedIds.has(raw.id) && canonical(record.class === "COPY" ? record.verification.expected ?? null : null) !== canonical(built.expectations.get(record.id)))) provenanceError();
    if (omittedIds.has(raw.id)) continue;
    expectations.set(record.id, built.expectations.get(record.id)!);
    rebuilt.push({ ...entry, revision: built.provenance.revision, tree: built.provenance.tree });
  }
  for (const id of expected.keys()) if (!seen.has(id) && !omittedIds.has(id)) provenanceError();
  return { expectations, provenance: { schema: "temperance.install-surface.copy-expectations-provenance.v2", records: rebuilt.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) } };
}
function readPinnedProvenance(path: string): unknown {
  try { return JSON.parse(readBoundedOwnerFile(path, 1024 * 1024).toString("utf8")); } catch { return provenanceError(); }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const documents = loadFragments(args.repositoryRoot);
  const records = recordsFrom(documents);
  const selected = args.only;
  if (selected && [...selected].some((id) => !records.some((record) => record.id === id))) throw new CopyInventoryError("COPY_INVENTORY_SCOPE_INVALID");
  const provenanceTarget = resolve(args.repositoryRoot, "package/install-surface/copy-expectations.provenance.json");
  assertSafeInventoryWriteTarget(args.repositoryRoot, provenanceTarget);
  const prior = existsSync(provenanceTarget) ? readPinnedProvenance(provenanceTarget) : undefined;
  const pinnedCheck = args.action === "check" && !selected && (prior as {schema?: string})?.schema === "temperance.install-surface.copy-expectations-provenance.v2";
  if (pinnedCheck) buildCopyInventory({repositoryRoot:args.repositoryRoot,revision:args.revision,records:[]});
  const built: { expectations: Map<string, CopyExpectation>; provenance: import("../src/copy-inventory.ts").CopyInventoryProvenance | ProvenanceV2 } = pinnedCheck
    ? reconstructPinnedInventory(args.repositoryRoot, records, prior)
    : buildCopyInventory({ repositoryRoot: args.repositoryRoot, revision: args.revision, records: selected ? records.filter((record) => selected.has(record.id)) : records });
  if (selected) {
    if (!prior) provenanceError();
    const retained = reconstructPinnedInventory(args.repositoryRoot, records, prior, selected);
    for (const [id, expected] of built.expectations) retained.expectations.set(id, expected);
    const selectedProvenance = built.provenance as import("../src/copy-inventory.ts").CopyInventoryProvenance;
    const merged = [...retained.provenance.records, ...selectedProvenance.records.map((entry) => ({ ...entry, revision: selectedProvenance.revision, tree: selectedProvenance.tree }))].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    built.expectations = retained.expectations;
    built.provenance = { schema: "temperance.install-surface.copy-expectations-provenance.v2", records: merged };
  }
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
      records: selected ? records.filter((record) => selected.has(record.id)) : records,
      expectations: built.expectations,
    });
  } else {
    const writeDocuments = selected ? documents.filter((document) => document.value.records.some((record) => selected.has(record.id))) : documents;
    const changedDocuments = writeDocuments.filter((document) => nextContents(document, built.expectations) !== document.contents);
    const provenanceChanged = !existsSync(provenancePath) || readFileSync(provenancePath, "utf8") !== expectedProvenance;
    // Validate every target before the first write, then revalidate immediately
    // at each write boundary below. This prevents partial publication through a
    // static symlink or hardlink discovered after another document changed.
    for (const document of changedDocuments) assertSafeInventoryWriteTarget(args.repositoryRoot, document.path);
    if (provenanceChanged) assertSafeInventoryWriteTarget(args.repositoryRoot, provenancePath);
    for (const document of writeDocuments) {
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
    schema: "temperance.install-surface.copy-inventory-result.v1",
    action: args.action,
    ...(built.provenance.schema === "temperance.install-surface.copy-expectations-provenance.v1" ? { revision: built.provenance.revision, tree: built.provenance.tree } : {}),
    requested_revision: args.revision,
    provenance_schema: built.provenance.schema,
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
