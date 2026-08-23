import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProjectSummary } from './catalog';

export const CAPABILITIES_SCHEMA = 'temperance.manifest.capabilities.v2' as const;
export const SCOPE_BINDING_SCHEMA = 'temperance.guide.scope-binding.v1' as const;
export const GUIDE_SCOPE_PATHS = [
  '.temperance/guide/capture.config.json',
  '.temperance/guide/capture.scope.json',
  '.temperance/guide/coverage-matrix.json',
  'scripts/product-guides/claim-evidence-map.json',
] as const;
export const VALIDATOR_IDS = {
  capture: 'product-guides.capture-contract@1.0.0',
  coverage: 'temperance.coverage-contract@1.0.0',
  guide: 'product-guides.validate-guide-py@1.0.0',
  film: 'product-guides.film-spec-closed@1.0.0',
} as const;

export type Readiness = 'ready' | 'gated' | 'unavailable';
export type ValidatorOutcome = { ok: boolean; identity: string; code?: string; stdout?: string; stderr?: string };
export type Validator = (input: { path: string; project_root: string }) => ValidatorOutcome | Promise<ValidatorOutcome>;
export type ValidatorRegistry = Record<string, Validator>;
export interface CapabilityOptions {
  validatorRegistry?: ValidatorRegistry;
  validatorDeadlineMs?: number;
  toolAvailability?: Partial<Record<'node' | 'python' | 'playwright' | 'ffmpeg', boolean>>;
}

export interface ScopeBindingV1 {
  schema: typeof SCOPE_BINDING_SCHEMA;
  project_id: string;
  source_version: string;
  artifacts: Record<(typeof GUIDE_SCOPE_PATHS)[number], string>;
}

export interface ArtifactAssessment {
  present: boolean;
  validated: boolean;
  candidate_count: number;
  state: 'absent' | 'ambiguous' | 'unsafe' | 'invalid' | 'validated';
  reason: string;
  validator: string;
  selected_path?: string;
}

export interface CapabilityRequirement { id: string; label: string; state: Readiness; provenance: string; next_action?: string }
export interface CapabilityRecord { id: string; label: string; cluster: string; tier: 'active'; state: Readiness; summary: string; requirements: CapabilityRequirement[]; execution: 'explicit-approval' }
export interface ProviderRecord { id: string; label: string; role: string; state: Readiness; credential: 'none' | 'host-managed' | 'optional-host-managed'; detail: string; provenance: string }

export interface ProjectCapabilities {
  schema: typeof CAPABILITIES_SCHEMA;
  generated_at: string;
  project_id: string;
  project_name: string;
  source: 'canonical-project-cwd';
  authority: 'unchecked_at_request';
  artifacts: { capture: ArtifactAssessment; coverage: ArtifactAssessment; guide_manifest: ArtifactAssessment; film_spec: ArtifactAssessment };
  run_kinds: Record<'guide' | 'video', { requestable: boolean; state: 'ready' | 'gated' | 'out_of_scope'; authority: 'unchecked_at_request'; blockers: string[] }>;
  capabilities: CapabilityRecord[];
  providers: ProviderRecord[];
  execution: { state: 'gated'; detail: string; next_action: string };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const received = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return received.length === wanted.length && received.every((key, index) => key === wanted[index]);
}

function hasRequiredKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every(req => keys.includes(req));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedStrings(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 240);
}

// Coverage validation is deliberately generic: Temperance checks structure,
// ordering, and cross-artifact consistency only. Project-specific requirement
// inventories, claims, routes, and selectors live in each project's own repo
// (e.g. parkarea-aleph keeps its closed contract under scripts/product-guides/).

function sameStrings(value: unknown): value is string[] {
  return boundedStrings(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240;
}

function selectorIsBounded(value: unknown): boolean {
  // Selectors must be specific enough to anchor deterministic evidence:
  // bare tag names and universal wildcards never pin a concrete UI state.
  if (!nonEmptyString(value)) return false;
  const trimmed = value.trim();
  if (trimmed.length < 4) return false;
  if (trimmed === '*' || /^[a-zA-Z]+$/.test(trimmed)) return false;
  return true;
}

function claimMapSchemaIsProjectPinned(schema: string, projectName: string): boolean {
  // Each project owns its claim-evidence-map schema name; the bridge accepts
  // only `<segment>.guide.claim-evidence-map.<version>` where `<segment>` is
  // the project's own slug or a leading token of it (e.g. `parkarea` for
  // `parkarea-aleph`). One project's registry can never satisfy another
  // project's coverage contract.
  const marker = '.guide.claim-evidence-map.';
  if (!schema.includes(marker)) return false;
  const segment = schema.slice(0, schema.indexOf(marker)).toLowerCase();
  if (!segment) return false;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return false;
  return slug === segment || slug.startsWith(`${segment}-`);
}

export function validateCoverageContract(input: unknown, trusted: { capture: unknown; claimMap: unknown; project_name: string }): boolean {
  const value = record(input);
  const capture = record(trusted?.capture);
  const claimMap = record(trusted?.claimMap);
  if (!value || !exactKeys(value, ['schemaVersion', 'edition', 'metadata', 'requirements', 'steps']) || value.schemaVersion !== 1) return false;
  if (!capture || capture.schemaVersion !== 1 || !nonEmptyString(String(capture.project ?? ''))
    || !Array.isArray(capture.shots) || capture.shots.length === 0) return false;
  if (!claimMap || typeof claimMap.schema !== 'string' || !claimMapSchemaIsProjectPinned(claimMap.schema, trusted.project_name)
    || !Array.isArray(claimMap.claims) || claimMap.claims.length === 0) return false;

  const edition = record(value.edition);
  if (!edition || !exactKeys(edition, ['audience', 'primaryPersona', 'primaryLocale', 'secondaryLocale', 'media', 'publication', 'requirementIds'])
    || edition.audience !== 'internal_qa_operators' || !nonEmptyString(edition.primaryPersona)
    || !nonEmptyString(edition.primaryLocale) || !nonEmptyString(edition.secondaryLocale)
    || edition.media !== 'deterministic_stills' || edition.publication !== 'private_only'
    || !sameStrings(edition.requirementIds)) return false;
  const metadata = record(value.metadata);
  if (!metadata || !exactKeys(metadata, ['freshContextPerShot', 'runnerContract'])
    || metadata.freshContextPerShot !== true || !nonEmptyString(metadata.runnerContract)) return false;
  if (!sameStrings(value.requirements) || !Array.isArray(value.steps) || value.steps.length === 0) return false;

  const steps = value.steps as unknown[];
  if ((capture.shots as unknown[]).length !== steps.length || claimMap.claims!.length !== steps.length) return false;

  return steps.every((candidate, index) => {
    const step = record(candidate);
    const shot = record((capture.shots as unknown[])[index]);
    const claimRow = record((claimMap.claims as unknown[])[index]);
    if (!step || !shot || !claimRow) return false;
    if (!exactKeys(step, ['order', 'stepId', 'checkpointKind', 'requirementIds', 'claim', 'route', 'persona', 'locales', 'tenantAuthority', 'scenarioClass', 'evidenceId', 'requiredSelectors', 'minimumBodyTextChars', 'semanticProof', 'sideEffects', 'admission'])) return false;
    if (!exactKeys(claimRow, ['order', 'evidenceId', 'proof', 'correlation', 'sideEffects'])) return false;
    const claim = record(step.claim);
    const proof = record(step.semanticProof);
    const claimProof = record(claimRow.proof);
    const correlation = record(claimRow.correlation);
    const claimSideEffects = record(claimRow.sideEffects);
    const effect = Array.isArray(step.sideEffects) && step.sideEffects.length === 1 ? record(step.sideEffects[0]) : null;
    if (!claim || !proof || !claimProof || !correlation || !claimSideEffects) return false;
    if (!exactKeys(claim, ['de', 'en']) || !nonEmptyString(claim.de) || !nonEmptyString(claim.en)) return false;
    if (!hasRequiredKeys(proof, ['kind', 'status']) || proof.status !== 'verified') return false;
    if (!effect || !exactKeys(effect, ['kind', 'status'])) return false;
    if (!exactKeys(claimProof, ['kind', 'status', 'file', 'testName'])
      || claimProof.status !== 'passed' || !nonEmptyString(claimProof.file) || !nonEmptyString(claimProof.testName)) return false;
    if (!exactKeys(correlation, ['route', 'persona', 'tenantAuthority']) || !nonEmptyString(correlation.route)) return false;
    if (!exactKeys(claimSideEffects, ['classification', 'allowed', 'forbidden'])
      || !nonEmptyString(claimSideEffects.classification)) return false;
    if (!Array.isArray(claimSideEffects.forbidden) || claimSideEffects.forbidden.length === 0) return false;
    return step.order === index + 1 && claimRow.order === index + 1
      && nonEmptyString(step.stepId) && step.stepId === step.evidenceId && shot.id === step.evidenceId && claimRow.evidenceId === step.evidenceId
      && nonEmptyString(step.route) && step.route === shot.route
      && nonEmptyString(step.persona) && step.persona === shot.persona && correlation.persona === step.persona
      && step.tenantAuthority === 'authenticated_session' && correlation.tenantAuthority === 'authenticated_session'
      && step.scenarioClass === 'synthetic_or_approved_demo' && step.admission === 'approved'
      && sameStrings(step.requirementIds)
      && Array.isArray(step.requiredSelectors) && step.requiredSelectors.every(selectorIsBounded)
      && Array.isArray(shot.requiredSelectors) && shot.requiredSelectors.every(selectorIsBounded)
      && Array.isArray(step.locales) && step.locales.length === 2 && step.locales.every((locale) => nonEmptyString(locale))
      && typeof step.minimumBodyTextChars === 'number' && Number.isFinite(step.minimumBodyTextChars) && step.minimumBodyTextChars > 0
      && step.minimumBodyTextChars === shot.minimumBodyTextChars;
  });
}

export function deriveScopeBindingV1(input: { projectId: string; sourceVersion: string; artifactBytes: Record<string, Uint8Array> }): { binding: ScopeBindingV1; scope_hash: string } {
  if (!input.projectId || !input.sourceVersion || Object.keys(input).sort().join(',') !== 'artifactBytes,projectId,sourceVersion') throw new Error('scope_binding_invalid');
  const receivedPaths = Object.keys(input.artifactBytes).sort();
  const expectedPaths = [...GUIDE_SCOPE_PATHS].sort();
  if (receivedPaths.length !== expectedPaths.length || receivedPaths.some((path, index) => path !== expectedPaths[index])) throw new Error('scope_binding_incomplete');
  const artifacts = Object.fromEntries(GUIDE_SCOPE_PATHS.map((path) => {
    const bytes = input.artifactBytes[path];
    if (!bytes) throw new Error(`scope_artifact_missing:${path}`);
    return [path, sha(bytes)];
  })) as ScopeBindingV1['artifacts'];
  const binding: ScopeBindingV1 = { schema: SCOPE_BINDING_SCHEMA, project_id: input.projectId, source_version: input.sourceVersion, artifacts };
  return { binding, scope_hash: sha(Buffer.from(stableJson(binding), 'utf8')) };
}

export function scopeBindingFromProject(project: ProjectSummary): { binding: ScopeBindingV1; scope_hash: string } {
  if (!project.cwd) throw new Error('scope_project_unregistered');
  const confined = Object.fromEntries(GUIDE_SCOPE_PATHS.map((path) => {
    const target = join(project.cwd!, path);
    if (safeCandidate(project.cwd!, target) !== 'safe') throw new Error('scope_artifact_unsafe');
    return [path, target];
  })) as Record<(typeof GUIDE_SCOPE_PATHS)[number], string>;
  const capture = JSON.parse(readFileSync(confined[GUIDE_SCOPE_PATHS[0]], 'utf8')) as Record<string, unknown>;
  const sourceVersion = typeof capture.sourceVersion === 'string' ? capture.sourceVersion : '';
  if (!sourceVersion) throw new Error('scope_source_version_missing');
  const artifactBytes = Object.fromEntries(GUIDE_SCOPE_PATHS.map((path) => [path, readFileSync(confined[path])]));
  return deriveScopeBindingV1({ projectId: project.project_id, sourceVersion, artifactBytes });
}

function commandAvailable(command: string): boolean {
  try { execFileSync('/usr/bin/which', [command], { stdio: 'ignore', timeout: 1500 }); return true; } catch { return false; }
}

function projectPackage(cwd: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function hasDependency(pkg: Record<string, unknown> | null, name: string): boolean {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((section) => {
    const value = pkg?.[section]; return Boolean(value && typeof value === 'object' && name in value);
  });
}

function readConfinedJson(root: string, relativePath: string): unknown {
  const target = join(root, relativePath);
  if (safeCandidate(root, target) !== 'safe' || lstatSync(target).size > 1_000_000) throw new Error('trusted_contract_unavailable');
  return JSON.parse(readFileSync(target, 'utf8')) as unknown;
}

function project_name_for(project_root: string): string {
  const capture = readConfinedJson(project_root, GUIDE_SCOPE_PATHS[0]) as Record<string, unknown> | null;
  return typeof capture?.project === 'string' ? capture.project : '';
}

async function defaultRegistry(): Promise<ValidatorRegistry> {
  const capturePath = join(homedir(), '.agents', 'skill-clusters', 'skills', 'product-guides-core', 'scripts', 'capture-contract.mjs');
  const guidePath = join(homedir(), '.agents', 'skill-clusters', 'skills', 'build-product-user-guides', 'scripts', 'validate_guide.py');
  const coverage: Validator = ({ path, project_root }) => {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const trusted = { capture: readConfinedJson(project_root, GUIDE_SCOPE_PATHS[0]), claimMap: readConfinedJson(project_root, GUIDE_SCOPE_PATHS[3]), project_name: project_name_for(project_root) };
      return { ok: validateCoverageContract(value, trusted), identity: VALIDATOR_IDS.coverage, code: 'invalid_content' };
    } catch { return { ok: false, identity: VALIDATOR_IDS.coverage, code: 'invalid_content' }; }
  };
  const film: Validator = ({ path }) => {
    try { const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; return { ok: typeof value.schema === 'string', identity: VALIDATOR_IDS.film, code: 'invalid_content' }; }
    catch { return { ok: false, identity: VALIDATOR_IDS.film, code: 'invalid_content' }; }
  };
  const capture: Validator = async ({ path }) => {
    try {
      const module = await import(pathToFileURL(capturePath).href);
      const validate = module.validateCaptureConfig || module.default;
      if (typeof validate !== 'function') return { ok: false, identity: VALIDATOR_IDS.capture, code: 'validator_unavailable' };
      const result = await validate(JSON.parse(readFileSync(path, 'utf8')));
      return { ok: Boolean(result), identity: VALIDATOR_IDS.capture, code: 'invalid_content' };
    } catch { return { ok: false, identity: VALIDATOR_IDS.capture, code: 'validator_nonzero' }; }
  };
  const guide: Validator = ({ path, project_root }) => {
    const result = spawnSync('python3', [guidePath, path], { cwd: project_root, encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
    return { ok: result.status === 0, identity: VALIDATOR_IDS.guide, code: result.status === 0 ? undefined : 'validator_nonzero', stdout: result.stdout, stderr: result.stderr };
  };
  return { [VALIDATOR_IDS.capture]: capture, [VALIDATOR_IDS.coverage]: coverage, [VALIDATOR_IDS.guide]: guide, [VALIDATOR_IDS.film]: film };
}

function safeCandidate(root: string, target: string): 'safe' | 'artifact_symlink' | 'artifact_root_escape' {
  try {
    const rootAbsolute = resolve(root);
    const targetAbsolute = resolve(target);
    const lexical = relative(rootAbsolute, targetAbsolute);
    if (lexical.startsWith('..') || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) return 'artifact_root_escape';
    if (lstatSync(rootAbsolute).isSymbolicLink()) return 'artifact_symlink';
    const rootReal = realpathSync(rootAbsolute);
    let cursor = rootAbsolute;
    for (const component of lexical.split(sep).filter(Boolean)) {
      cursor = join(cursor, component);
      if (lstatSync(cursor).isSymbolicLink()) {
        if (cursor === targetAbsolute) return 'artifact_symlink';
        const linked = realpathSync(cursor);
        const linkedRelative = relative(rootReal, linked);
        return linkedRelative.startsWith('..') || linkedRelative.startsWith(`..${sep}`) || isAbsolute(linkedRelative) ? 'artifact_root_escape' : 'artifact_symlink';
      }
    }
    const targetReal = realpathSync(targetAbsolute);
    const rel = relative(rootReal, targetReal);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'artifact_root_escape';
    return 'safe';
  } catch { return 'artifact_root_escape'; }
}

async function withDeadline<T>(operation: () => T | Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('validator_timeout')), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function assessArtifact(root: string, candidates: string[], validatorId: string, registry: ValidatorRegistry, deadlineMs: number): Promise<ArtifactAssessment> {
  const found = candidates.filter((path) => existsSync(join(root, path)));
  const base = { present: found.length > 0, validated: false, candidate_count: found.length, validator: validatorId };
  if (!found.length) return { ...base, state: 'absent', reason: 'artifact_missing' };
  if (found.length > 1) return { ...base, state: 'ambiguous', reason: 'artifact_ambiguous' };
  const selected = found[0];
  const path = join(root, selected);
  const safety = safeCandidate(root, path);
  if (safety !== 'safe') return { ...base, state: 'unsafe', reason: safety };
  if (lstatSync(path).size > 1_000_000) return { ...base, state: 'invalid', reason: 'artifact_too_large', selected_path: selected };
  const validator = registry[validatorId];
  if (!validator) return { ...base, state: 'invalid', reason: 'validator_unavailable', selected_path: selected };
  const before = sha(readFileSync(path));
  let outcome: ValidatorOutcome;
  try { outcome = await withDeadline(() => validator({ path, project_root: root }), deadlineMs); }
  catch (error) { outcome = { ok: false, identity: validatorId, code: error instanceof Error && error.message === 'validator_timeout' ? 'validator_timeout' : 'validator_nonzero' }; }
  if (!outcome || typeof outcome !== 'object') outcome = { ok: false, identity: validatorId, code: 'validator_nonzero' };
  const stdout = typeof outcome.stdout === 'string' ? outcome.stdout : '';
  const stderr = typeof outcome.stderr === 'string' ? outcome.stderr : '';
  const outputBytes = Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8');
  const after = existsSync(path) ? sha(readFileSync(path)) : '';
  if (outputBytes > 8192) return { ...base, state: 'invalid', reason: 'validator_output_overflow', selected_path: selected };
  if (after !== before) return { ...base, state: 'invalid', reason: 'validator_mutated', selected_path: selected };
  if (outcome.identity !== validatorId) return { ...base, state: 'invalid', reason: 'validator_identity_mismatch', selected_path: selected };
  if (!outcome.ok) return { ...base, state: 'invalid', reason: outcome.code || 'validator_nonzero', selected_path: selected };
  return { ...base, validated: true, state: 'validated', reason: 'validated', selected_path: selected };
}

function requirement(id: string, label: string, ready: boolean, provenance: string): CapabilityRequirement {
  return { id, label, state: ready ? 'ready' : 'gated', provenance };
}

export async function projectCapabilities(project: ProjectSummary, route?: Record<string, unknown>, options: CapabilityOptions = {}): Promise<ProjectCapabilities> {
  const cwd = project.cwd || '';
  const registry = options.validatorRegistry || await defaultRegistry();
  const deadlineMs = Math.max(10, Math.min(5000, Math.trunc(options.validatorDeadlineMs ?? 5000)));
  const artifacts = {
    capture: cwd ? await assessArtifact(cwd, ['capture.config.json', '.moosh/capture.config.json', '.temperance/guide/capture.config.json', 'docs/guide/capture.config.json'], VALIDATOR_IDS.capture, registry, deadlineMs) : { present: false, validated: false, candidate_count: 0, state: 'absent', reason: 'project_unregistered', validator: VALIDATOR_IDS.capture } as ArtifactAssessment,
    coverage: cwd ? await assessArtifact(cwd, ['.temperance/guide/coverage-matrix.json'], VALIDATOR_IDS.coverage, registry, deadlineMs) : { present: false, validated: false, candidate_count: 0, state: 'absent', reason: 'project_unregistered', validator: VALIDATOR_IDS.coverage } as ArtifactAssessment,
    guide_manifest: cwd ? await assessArtifact(cwd, ['.temperance/guide/guide.manifest.json', '.moosh/guide.manifest.json', 'docs/guide/guide.manifest.json'], VALIDATOR_IDS.guide, registry, deadlineMs) : { present: false, validated: false, candidate_count: 0, state: 'absent', reason: 'project_unregistered', validator: VALIDATOR_IDS.guide } as ArtifactAssessment,
    film_spec: cwd ? await assessArtifact(cwd, ['film.json', '.moosh/film.json', '.temperance/guide/film.json', 'docs/videos/film.json'], VALIDATOR_IDS.film, registry, deadlineMs) : { present: false, validated: false, candidate_count: 0, state: 'absent', reason: 'project_unregistered', validator: VALIDATOR_IDS.film } as ArtifactAssessment,
  };
  const pkg = cwd ? projectPackage(cwd) : null;
  const tools = {
    node: options.toolAvailability?.node ?? commandAvailable('node'),
    python: options.toolAvailability?.python ?? commandAvailable('python3'),
    playwright: options.toolAvailability?.playwright ?? (hasDependency(pkg, 'playwright') || hasDependency(pkg, '@playwright/test')),
    ffmpeg: options.toolAvailability?.ffmpeg ?? commandAvailable('ffmpeg'),
  };
  const guideBlockers = [!artifacts.capture.validated && 'capture_not_validated', !artifacts.coverage.validated && 'coverage_not_validated', !tools.playwright && 'playwright_unavailable'].filter(Boolean) as string[];
  const videoBlockers = [!artifacts.capture.validated && 'capture_not_validated', !artifacts.guide_manifest.validated && 'guide_manifest_not_validated', !artifacts.film_spec.validated && 'film_spec_not_validated', !tools.ffmpeg && 'ffmpeg_unavailable'].filter(Boolean) as string[];
  const guideReady = guideBlockers.length === 0;
  const videoReady = videoBlockers.length === 0;
  const capabilities: CapabilityRecord[] = [
    { id: 'build-product-user-guides', label: 'BUILD PRODUCT USER GUIDES', cluster: 'product-guides', tier: 'active', state: guideReady ? 'ready' : 'gated', summary: 'Validated guide contract and deterministic still evidence.', requirements: [requirement('capture-config', 'Validated capture configuration', artifacts.capture.validated, VALIDATOR_IDS.capture), requirement('coverage-matrix', 'Validated coverage matrix', artifacts.coverage.validated, VALIDATOR_IDS.coverage), requirement('playwright', 'Playwright project dependency', tools.playwright, 'project package manifest')], execution: 'explicit-approval' },
    { id: 'guide-to-product-video', label: 'GUIDE TO PRODUCT VIDEO', cluster: 'product-guides', tier: 'active', state: videoReady ? 'ready' : 'gated', summary: 'Validated guide inventory and FilmSpec for bounded video.', requirements: [requirement('guide-inventory', 'Validated guide inventory', artifacts.guide_manifest.validated, VALIDATOR_IDS.guide), requirement('film-spec', 'Validated FilmSpec', artifacts.film_spec.validated, VALIDATOR_IDS.film), requirement('ffmpeg', 'FFmpeg', tools.ffmpeg, 'bridge host runtime')], execution: 'explicit-approval' },
  ];
  return {
    schema: CAPABILITIES_SCHEMA, generated_at: new Date().toISOString(), project_id: project.project_id, project_name: project.name, source: 'canonical-project-cwd', authority: 'unchecked_at_request', artifacts,
    run_kinds: {
      guide: { requestable: guideReady, state: guideReady ? 'ready' : 'gated', authority: 'unchecked_at_request', blockers: guideBlockers },
      video: { requestable: videoReady, state: videoReady ? 'ready' : 'gated', authority: 'unchecked_at_request', blockers: videoBlockers },
    },
    capabilities,
    providers: [
      { id: 'manifest-bridge', label: 'Manifest Bridge', role: 'project read model', state: 'ready', credential: 'none', detail: 'Local projection endpoint is serving this response.', provenance: 'bridge request' },
      { id: 'omniroute', label: 'OmniRoute', role: 'host routing and composition', state: route?.state === 'ready' ? 'ready' : 'unavailable', credential: 'host-managed', detail: 'Observed route health only.', provenance: 'observed route health' },
      { id: 'playwright', label: 'Playwright', role: 'deterministic still capture', state: tools.playwright ? 'ready' : 'gated', credential: 'none', detail: tools.playwright ? 'Project dependency is present.' : 'Project dependency is absent.', provenance: 'project package manifest' },
      { id: 'ffmpeg', label: 'FFmpeg', role: 'video conversion', state: tools.ffmpeg ? 'ready' : 'gated', credential: 'none', detail: 'Video-only tool; never a guide gate.', provenance: 'bridge host runtime' },
      { id: 'elevenlabs', label: 'ElevenLabs', role: 'optional voiceover', state: process.env.ELEVENLABS_API_KEY ? 'ready' : 'gated', credential: 'optional-host-managed', detail: 'Optional and never a guide gate.', provenance: 'host environment presence check' },
    ],
    execution: { state: 'gated', detail: 'Content readiness is present-only/validated; canonical authority is checked only on a typed request.', next_action: 'Resolve content gates, then submit a bound request for canonical attestation.' },
  };
}
