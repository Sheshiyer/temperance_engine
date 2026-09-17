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
  metadata: Partial<Pick<ProjectCandidateV1, "selectable" | "portfolio_id" | "mapping_status" | "work_ids" | "repository_candidates">> = {},
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
    ...metadata,
  };
}

function boundedJson(path: string): unknown {
  const text = readFileSync(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_MAP_BYTES) throw new Error("map too large");
  return JSON.parse(text) as unknown;
}

function mappedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(value);
}

function mappedSegment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function normalizedRepositoryCandidate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  const direct = normalizeRepositoryIdentity(value);
  if (direct?.startsWith("github.com/")) return direct;
  const nested = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/.*)?$/u);
  return nested ? normalizeRepositoryIdentity(`${nested[1]}/${nested[2]}`) : undefined;
}

function addRepositoryCandidate(index: Map<string, Set<string>>, workId: unknown, repository: unknown): void {
  if (!mappedId(workId)) return;
  const normalized = normalizedRepositoryCandidate(repository);
  if (!normalized) return;
  const repositories = index.get(workId) ?? new Set<string>();
  repositories.add(normalized);
  index.set(workId, repositories);
}

function repositoryRefsByWorkId(value: unknown): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (++visited > 20_000) throw new Error("repository map too complex");
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    const record = current as Record<string, unknown>;
    addRepositoryCandidate(index, record.targetWorkId, record.repository);
    addRepositoryCandidate(index, record.currentWorkId, record.observedRepository);
    addRepositoryCandidate(index, record.currentWorkId, record.candidateRepository);
    if (Array.isArray(record.resolvedAssignments)) {
      for (const assignment of record.resolvedAssignments) {
        if (!assignment || typeof assignment !== "object") continue;
        const mapped = assignment as Record<string, unknown>;
        if (!Array.isArray(mapped.repositoryRefs)) continue;
        for (const repository of mapped.repositoryRefs) addRepositoryCandidate(index, mapped.workId, repository);
      }
    }
    pending.push(...Object.values(record));
  }
  return index;
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
    const parsed = boundedJson(mapPath);
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

function discoverPortfolioRootMap(
  source: Extract<ProjectDiscoverySpecV1, { kind: "portfolio-root-map" }>,
  binding: HostBindingV1,
  findings: ProjectDiscoveryFinding[],
): ProjectCandidateV1[] {
  const sourceRoot = rootFor(binding, source.source_root_variable);
  const projectRoot = rootFor(binding, source.project_root_variable);
  const prefix = prefixFor(binding, source.project_root_prefix_variable);
  const relativePaths = [source.source_relative_path, source.repository_mapping_relative_path].filter((value): value is string => value !== undefined);
  if (relativePaths.some((value) => !safeRelativePath(value)) || (prefix !== undefined && !safeRelativePath(prefix))) {
    findings.push({ source_id: source.id, code: "PREFIX_UNSAFE", message: `Discovery source ${source.id} contains an unsafe relative path.` });
    return [];
  }
  if (!sourceRoot || !projectRoot) {
    findings.push({ source_id: source.id, code: "ROOT_UNAVAILABLE", message: `A root variable required by ${source.id} is unavailable.` });
    return [];
  }
  const mapPath = resolve(sourceRoot, source.source_relative_path);
  if (!inside(sourceRoot, mapPath) || !existsSync(mapPath) || !lstatSync(mapPath).isFile()) {
    findings.push({ source_id: source.id, code: "SOURCE_UNAVAILABLE", message: `Portfolio map ${source.id} is unavailable.` });
    return [];
  }
  try {
    const parsed = boundedJson(mapPath);
    if (!parsed || typeof parsed !== "object") throw new Error("portfolio map missing");
    const map = parsed as Record<string, unknown>;
    if (map.schema !== "thoughtseed.portfolio-root-map.v1" || !Array.isArray(map.portfolios)) throw new Error("portfolio map invalid");
    let repositoryIndex = new Map<string, Set<string>>();
    if (source.repository_mapping_relative_path) {
      const repositoryMapPath = resolve(sourceRoot, source.repository_mapping_relative_path);
      if (!inside(sourceRoot, repositoryMapPath) || !existsSync(repositoryMapPath) || !lstatSync(repositoryMapPath).isFile()) {
        findings.push({ source_id: source.id, code: "SOURCE_UNAVAILABLE", message: `Repository mapping evidence for ${source.id} is unavailable.` });
      } else {
        try {
          repositoryIndex = repositoryRefsByWorkId(boundedJson(repositoryMapPath));
        } catch {
          findings.push({ source_id: source.id, code: "SOURCE_INVALID", message: `Repository mapping evidence for ${source.id} is not a bounded valid map.` });
        }
      }
    }
    const result: ProjectCandidateV1[] = [];
    for (const portfolioValue of map.portfolios) {
      if (!portfolioValue || typeof portfolioValue !== "object") continue;
      const portfolio = portfolioValue as Record<string, unknown>;
      if (!mappedSegment(portfolio.portfolioId) || !Array.isArray(portfolio.folders)) continue;
      for (const folderValue of portfolio.folders) {
        if (!folderValue || typeof folderValue !== "object") continue;
        const folder = folderValue as Record<string, unknown>;
        if (!mappedSegment(folder.folder)) continue;
        const workIds = Array.isArray(folder.workIds) ? [...new Set(folder.workIds.filter(mappedId))].sort() : [];
        const repositories = [...new Set(workIds.flatMap((workId) => [...(repositoryIndex.get(workId) ?? [])]))].sort();
        const relativePath = symbolicRelative(prefix, `${portfolio.portfolioId}/${folder.folder}`);
        if (!safeRelativePath(relativePath)) continue;
        const target = resolve(projectRoot, relativePath);
        if (!inside(projectRoot, target)) continue;
        const pathPresent = existsSync(target) && lstatSync(target).isDirectory();
        const origin = pathPresent ? gitOrigin(target) : undefined;
        if (origin && !repositories.includes(origin)) repositories.unshift(origin);
        const mappingStatus: ProjectCandidateV1["mapping_status"] = !pathPresent
          ? "path-missing"
          : repositories.length > 0
            ? "repository-mapped"
            : workIds.length > 0
              ? "work-mapped"
              : "folder-only";
        const displayName = `${portfolio.portfolioId}/${folder.folder}`;
        result.push(candidate(
          source,
          displayName,
          origin ?? `portfolio:${portfolio.portfolioId}:${folder.folder}`,
          source.project_root_variable,
          relativePath,
          pathPresent,
          {
            selectable: pathPresent,
            portfolio_id: portfolio.portfolioId,
            mapping_status: mappingStatus,
            work_ids: workIds,
            repository_candidates: repositories,
          },
        ));
        if (result.length > MAX_CANDIDATES) throw new Error("too many portfolio folders");
      }
    }
    return result;
  } catch {
    findings.push({ source_id: source.id, code: "SOURCE_INVALID", message: `Portfolio map ${source.id} is not a bounded valid map.` });
    return [];
  }
}

/** Discovery is advisory only. Every emitted candidate is explicitly unapproved. */
export function discoverProjectCandidates(profile: HostProfileV1, binding: HostBindingV1): ProjectDiscoveryResult {
  const findings: ProjectDiscoveryFinding[] = [];
  const discovered = (profile.project_discovery ?? []).flatMap((source) => {
    if (source.kind === "directory-children") return discoverDirectories(source, binding, findings);
    if (source.kind === "json-project-map") return discoverProjectMap(source, binding, findings);
    return discoverPortfolioRootMap(source, binding, findings);
  });
  const byIdentity = new Map<string, ProjectCandidateV1>();
  for (const item of discovered) {
    const key = item.portfolio_id ? `portfolio:${item.id}` : item.repository_identity;
    const prior = byIdentity.get(key);
    if (!prior || (!prior.path_present && item.path_present)) byIdentity.set(key, item);
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
    if (item.selectable === false || !item.path_present) throw new Error(`PROJECT_CANDIDATE_UNAVAILABLE:${id}`);
    if (!byIdentity.has(item.repository_identity)) {
      const {
        discovery_source: _source,
        display_name: _display,
        path_present: _present,
        selectable: _selectable,
        portfolio_id: _portfolio,
        mapping_status: _mapping,
        work_ids: _workIds,
        repository_candidates: _repositories,
        ...capsule
      } = item;
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
