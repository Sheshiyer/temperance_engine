import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";

import { canonical } from "../canonical-json.ts";
import type {
  HostBindingV1,
  HostProfileV1,
  ProjectCandidateV1,
  ProjectCapsuleV1,
  ProjectDiscoverySpecV1,
} from "./public-contracts.ts";

const MAX_MAP_BYTES = 1_048_576;
const MAX_CANDIDATES = 512;

export interface ProjectDiscoveryFinding {
  source_id: string;
  code: "ROOT_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "SOURCE_INVALID" | "PREFIX_UNSAFE" | "CANDIDATE_LIMIT";
  message: string;
}

export interface ProjectDiscoveryResult {
  candidates: ProjectCandidateV1[];
  findings: ProjectDiscoveryFinding[];
}

function safeRelativePath(value: string): boolean {
  return value === "." || (
    value.length > 0
    && value.length <= 2048
    && !isAbsolute(value)
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.split("/").includes("..")
    && posix.normalize(value) === value
  );
}

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function symbolicRelative(prefix: string | undefined, name: string): string {
  const joined = prefix ? posix.join(prefix, name) : name;
  return joined || ".";
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "");
  if (normalized && normalized.length <= 96) return normalized;
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
  return `${normalized.slice(0, 72) || "project"}-${digest}`;
}

/** Normalize a remote without preserving credentials, query strings, or transport syntax. */
export function normalizeRepositoryIdentity(remote: string): string | undefined {
  const trimmed = remote.trim();
  if (!trimmed) return undefined;
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (shorthand) return `github.com/${shorthand[1]!.toLowerCase()}/${shorthand[2]!.toLowerCase()}`;
  const scp = trimmed.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/u);
  if (scp && !trimmed.includes("://")) {
    const path = scp[2]!.replace(/^\/+|\.git$/gu, "");
    return `${scp[1]!.toLowerCase()}/${path.toLowerCase()}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) return undefined;
    const path = parsed.pathname.replace(/^\/+|\.git$/gu, "");
    if (!parsed.hostname || !path) return undefined;
    return `${parsed.hostname.toLowerCase()}/${path.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

function gitOrigin(directory: string): string | undefined {
  const config = resolve(directory, ".git", "config");
  if (!existsSync(config) || !lstatSync(config).isFile()) return undefined;
  const bytes = readFileSync(config, "utf8");
  if (Buffer.byteLength(bytes, "utf8") > MAX_MAP_BYTES) return undefined;
  let inOrigin = false;
  for (const line of bytes.split(/\r?\n/u)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u);
    if (section) {
      inOrigin = section[1]!.trim().toLowerCase() === 'remote "origin"';
      continue;
    }
    if (!inOrigin) continue;
    const url = line.match(/^\s*url\s*=\s*(.+?)\s*$/u)?.[1];
    if (url) return normalizeRepositoryIdentity(url);
  }
  return undefined;
}

function projectId(sourceId: string, name: string, identity: string): string {
  const base = `${slug(sourceId)}.${slug(name)}`;
  if (base.length <= 128) return base;
  return `${base.slice(0, 107)}-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 16)}`;
}

function candidate(
  source: ProjectDiscoverySpecV1,
  name: string,
  identity: string,
  rootVariable: string,
  relativePath: string,
  pathPresent: boolean,
): ProjectCandidateV1 {
  return {
    schema: "temperance.project-capsule.v1",
    version: { major: 1, minor: 0 },
    id: projectId(source.id, name, identity),
    repository_identity: identity,
    root_variable: rootVariable,
    relative_path: relativePath,
    access: source.access,
    approved: false,
    discovery_source: source.id,
    display_name: name,
    path_present: pathPresent,
  };
}

function rootFor(binding: HostBindingV1, variable: string): string | undefined {
  const root = binding.variables[variable];
  return root && isAbsolute(root) ? root : undefined;
}

function prefixFor(binding: HostBindingV1, variable: string | undefined): string | undefined {
  return variable ? binding.variables[variable] : undefined;
}

function discoverDirectories(
  source: Extract<ProjectDiscoverySpecV1, { kind: "directory-children" }>,
  binding: HostBindingV1,
  findings: ProjectDiscoveryFinding[],
): ProjectCandidateV1[] {
  const root = rootFor(binding, source.root_variable);
  const prefix = prefixFor(binding, source.root_prefix_variable);
  if (prefix !== undefined && !safeRelativePath(prefix)) {
    findings.push({ source_id: source.id, code: "PREFIX_UNSAFE", message: `Variable ${source.root_prefix_variable} is not a safe relative path.` });
    return [];
  }
  if (!root) {
    findings.push({ source_id: source.id, code: "ROOT_UNAVAILABLE", message: `Root variable ${source.root_variable} is unavailable.` });
    return [];
  }
  const scanRoot = resolve(root, prefix ?? ".");
  if (!inside(root, scanRoot) || !existsSync(scanRoot) || !lstatSync(scanRoot).isDirectory()) {
    findings.push({ source_id: source.id, code: "ROOT_UNAVAILABLE", message: `Discovery root ${source.id} is unavailable.` });
    return [];
  }
  const result: ProjectCandidateV1[] = [];
  for (const entry of readdirSync(scanRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const directory = resolve(scanRoot, entry.name);
    if (!inside(scanRoot, directory)) continue;
    const remote = gitOrigin(directory);
    if (source.require_git && !remote) continue;
    const relativePath = symbolicRelative(prefix, entry.name);
    const identity = remote ?? `local:${source.root_variable}:${relativePath}`;
    result.push(candidate(source, entry.name, identity, source.root_variable, relativePath, true));
    if (result.length >= MAX_CANDIDATES) break;
  }
  return result;
}

function discoverProjectMap(
  source: Extract<ProjectDiscoverySpecV1, { kind: "json-project-map" }>,
  binding: HostBindingV1,
  findings: ProjectDiscoveryFinding[],
): ProjectCandidateV1[] {
  const sourceRoot = rootFor(binding, source.source_root_variable);
  const projectRoot = rootFor(binding, source.project_root_variable);
  const prefix = prefixFor(binding, source.project_root_prefix_variable);
  if (!safeRelativePath(source.source_relative_path) || (prefix !== undefined && !safeRelativePath(prefix))) {
    findings.push({ source_id: source.id, code: "PREFIX_UNSAFE", message: `Discovery source ${source.id} contains an unsafe relative path.` });
    return [];
  }
  if (!sourceRoot || !projectRoot) {
    findings.push({ source_id: source.id, code: "ROOT_UNAVAILABLE", message: `A root variable required by ${source.id} is unavailable.` });
    return [];
  }
  const mapPath = resolve(sourceRoot, source.source_relative_path);
  if (!inside(sourceRoot, mapPath) || !existsSync(mapPath) || !lstatSync(mapPath).isFile()) {
    findings.push({ source_id: source.id, code: "SOURCE_UNAVAILABLE", message: `Project map ${source.id} is unavailable.` });
    return [];
  }
  try {
    const text = readFileSync(mapPath, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_MAP_BYTES) throw new Error("map too large");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { projects?: unknown }).projects)) throw new Error("projects missing");
    const projects = (parsed as { projects: unknown[] }).projects;
    if (projects.length > MAX_CANDIDATES) throw new Error("too many projects");
    const result: ProjectCandidateV1[] = [];
    for (const value of projects) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (typeof record.project_id !== "string" || typeof record.repository !== "string") continue;
      const name = slug(record.project_id);
      if (!name) continue;
      const relativePath = symbolicRelative(prefix, name);
      const target = resolve(projectRoot, relativePath);
      if (!inside(projectRoot, target)) continue;
      const identity = normalizeRepositoryIdentity(record.repository) ?? `map:${source.id}:${name}`;
      result.push(candidate(source, name, identity, source.project_root_variable, relativePath, existsSync(target) && lstatSync(target).isDirectory()));
    }
    return result;
  } catch {
    findings.push({ source_id: source.id, code: "SOURCE_INVALID", message: `Project map ${source.id} is not a bounded valid map.` });
    return [];
  }
}

/** Discovery is advisory only. Every emitted candidate is explicitly unapproved. */
export function discoverProjectCandidates(profile: HostProfileV1, binding: HostBindingV1): ProjectDiscoveryResult {
  const findings: ProjectDiscoveryFinding[] = [];
  const discovered = (profile.project_discovery ?? []).flatMap((source) => source.kind === "directory-children"
    ? discoverDirectories(source, binding, findings)
    : discoverProjectMap(source, binding, findings));
  const byIdentity = new Map<string, ProjectCandidateV1>();
  for (const item of discovered) {
    const prior = byIdentity.get(item.repository_identity);
    if (!prior || (!prior.path_present && item.path_present)) byIdentity.set(item.repository_identity, item);
  }
  const candidates = [...byIdentity.values()].sort((left, right) => left.repository_identity.localeCompare(right.repository_identity));
  if (candidates.length > MAX_CANDIDATES) {
    findings.push({ source_id: "all", code: "CANDIDATE_LIMIT", message: `Discovery was limited to ${MAX_CANDIDATES} candidates.` });
  }
  return { candidates: candidates.slice(0, MAX_CANDIDATES), findings };
}

/** Compile an explicit selection into capsules without touching repositories. */
export function approveProjectCandidates(
  existing: readonly ProjectCapsuleV1[],
  candidates: readonly ProjectCandidateV1[],
  selectedCandidateIds: ReadonlySet<string>,
): ProjectCapsuleV1[] {
  const byIdentity = new Map(existing.filter((item) => item.approved).map((item) => [item.repository_identity, { ...item }]));
  const known = new Map(candidates.map((item) => [item.id, item]));
  for (const id of [...selectedCandidateIds].sort()) {
    const item = known.get(id);
    if (!item) throw new Error(`PROJECT_CANDIDATE_UNKNOWN:${id}`);
    if (!byIdentity.has(item.repository_identity)) {
      const { discovery_source: _source, display_name: _display, path_present: _present, ...capsule } = item;
      byIdentity.set(item.repository_identity, { ...capsule, approved: true });
    }
  }
  return [...byIdentity.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Removal changes only the capsule set; project bytes are outside this function's authority. */
export function removeProjectCapsule(capsules: readonly ProjectCapsuleV1[], capsuleId: string): ProjectCapsuleV1[] {
  return capsules.filter((item) => item.id !== capsuleId).map((item) => ({ ...item }));
}

export function projectCapsulesEqual(left: readonly ProjectCapsuleV1[], right: readonly ProjectCapsuleV1[]): boolean {
  return canonical([...left].sort((a, b) => a.id.localeCompare(b.id))) === canonical([...right].sort((a, b) => a.id.localeCompare(b.id)));
}
