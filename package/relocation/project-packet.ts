/**
 * Read-only inspection of an on-disk portable project packet: presence
 * checks and a content digest. This module never creates or edits a file
 * inside a repository checkout — the relocation transaction treats a
 * committed packet as read-only input (ISC-716).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_PACKET_FILES,
  validateProjectYaml,
  type ProjectYamlValidationResult,
  type ValidateProjectYamlOptions,
} from "./project-packet-schema";

export interface PacketFilePresence {
  present: string[];
  missing: string[];
}

export function checkPacketFilesPresent(repositoryRoot: string): PacketFilePresence {
  const present = REQUIRED_PACKET_FILES.filter((file) => existsSync(join(repositoryRoot, file)));
  const missing = REQUIRED_PACKET_FILES.filter((file) => !present.includes(file));
  return { present, missing };
}

export function computePacketDigest(repositoryRoot: string, present: string[]): string | null {
  if (present.length !== REQUIRED_PACKET_FILES.length) return null;
  const content = present
    .map((file) => `${file}\0${readFileSync(join(repositoryRoot, file), "utf8")}`)
    .join("\0");
  return createHash("sha256").update(content).digest("hex");
}

function coerceScalar(raw: string): unknown {
  const trimmed = raw.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function indentOf(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

/**
 * A minimal parser for this project's own closed, self-authored
 * `.project/project.yaml` subset only (top-level scalars, one level of
 * nested `key: value` objects, and `- item` list blocks) — not a general
 * YAML parser. The repository has no package.json/node_modules for this
 * module family, and the format is fully self-controlled, so a hand-rolled
 * parser avoids adding an external dependency for a shape this constrained.
 */
export function parseFlatProjectYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const result: Record<string, unknown> = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const topMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!topMatch) {
      index += 1;
      continue;
    }
    const [, key, inlineValue] = topMatch;
    if (inlineValue.trim().length > 0) {
      result[key] = coerceScalar(inlineValue);
      index += 1;
      continue;
    }
    const blockLines: string[] = [];
    let next = index + 1;
    while (next < lines.length && indentOf(lines[next]) > 0) {
      blockLines.push(lines[next]);
      next += 1;
    }
    if (blockLines.length > 0 && blockLines[0].trim().startsWith("- ")) {
      result[key] = blockLines.map((entry) => entry.trim().replace(/^-\s*/, ""));
    } else {
      const nested: Record<string, unknown> = {};
      for (const nestedLine of blockLines) {
        const nestedMatch = nestedLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (nestedMatch) nested[nestedMatch[1]] = coerceScalar(nestedMatch[2]);
      }
      result[key] = nested;
    }
    index = next;
  }
  return result;
}

export interface PacketReadReport {
  present: string[];
  missing: string[];
  digest: string | null;
  parsed: Record<string, unknown> | null;
  validation: ProjectYamlValidationResult | null;
}

export function readAndValidatePacket(
  repositoryRoot: string,
  options: ValidateProjectYamlOptions,
): PacketReadReport {
  const { present, missing } = checkPacketFilesPresent(repositoryRoot);
  const digest = computePacketDigest(repositoryRoot, present);
  if (!present.includes(".project/project.yaml")) {
    return { present, missing, digest, parsed: null, validation: null };
  }
  const raw = readFileSync(join(repositoryRoot, ".project/project.yaml"), "utf8");
  const parsed = parseFlatProjectYaml(raw);
  const validation = validateProjectYaml(parsed, options);
  return { present, missing, digest, parsed, validation };
}
