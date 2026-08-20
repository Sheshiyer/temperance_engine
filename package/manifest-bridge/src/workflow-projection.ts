import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProjectSummary } from './catalog';
import type { ProjectCapabilities, Readiness } from './capabilities';
import type { ManifestState } from './types';

export const WORKFLOW_PROJECTION_SCHEMA = 'temperance.manifest.skill-workflow.v2' as const;
export const PRODUCT_GUIDE_WORKFLOW_ID = 'product-guide-production' as const;

export interface SkillRecord { id: string; label: string; role: 'hub' | 'spoke' | 'unknown'; status: string; origin: string; originSource: string | null }
export interface SkillClusterRecord { id: string; title: string; tier: string; origin: string; originSource: string | null; usage: 'resolved' | 'available' | 'observed'; skills: SkillRecord[] }
export interface WorkflowStage { id: string; label: string; state: Readiness; mode: 'read-only' | 'explicit-approval'; gate: string; next_action?: string }
type IndexSkill = { cluster?: string; tier?: string; role?: string; status?: string; origin?: string; originSource?: string | null };
type IndexCluster = { title?: string; tier?: string; origin?: string; originSource?: string | null };
type SkillIndex = { counts?: Record<string, number>; clusters?: Record<string, IndexCluster>; skills?: Record<string, IndexSkill> };

function readIndex(): SkillIndex {
  const path = join(homedir(), '.agents', 'skill-clusters', 'skill-index.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')) as SkillIndex; } catch { return {}; }
}

function capabilityState(capabilities: ProjectCapabilities, id: string): Readiness {
  return capabilities.capabilities.find((candidate) => candidate.id === id)?.state || 'unavailable';
}

function requirementState(capabilities: ProjectCapabilities, capabilityId: string, requirementId: string): Readiness {
  return capabilities.capabilities.find((candidate) => candidate.id === capabilityId)?.requirements.find((candidate) => candidate.id === requirementId)?.state || 'unavailable';
}

export function projectSkillWorkflow(project: ProjectSummary, snapshot: ManifestState, capabilities: ProjectCapabilities) {
  const index = readIndex();
  const productGuideSkills = Object.entries(index.skills || {}).filter(([, skill]) => skill.cluster === 'product-guides').map(([id, skill]): SkillRecord => ({ id, label: id.replace(/-/g, ' ').toUpperCase(), role: skill.role === 'hub' || skill.role === 'spoke' ? skill.role : 'unknown', status: skill.status || 'unknown', origin: skill.origin || 'unknown', originSource: skill.originSource || null }));
  const clusters: SkillClusterRecord[] = Object.entries(index.clusters || {}).map(([id, cluster]) => ({ id, title: cluster.title || id, tier: cluster.tier || 'unknown', origin: cluster.origin || 'unknown', originSource: cluster.originSource || null, usage: id === 'product-guides' ? 'resolved' : 'available', skills: id === 'product-guides' ? productGuideSkills : [] }));
  if (!clusters.length && productGuideSkills.length) clusters.push({ id: 'product-guides', title: 'Product Guides', tier: 'active', origin: 'unknown', originSource: null, usage: 'resolved', skills: productGuideSkills });
  const observedRegistry = Object.values(snapshot.skills).find((record) => record.project_id === project.project_id && record.skill_id?.toString().endsWith(':skill-cluster-registry')) || {};
  const observedWorkflow = snapshot.workflows[project.project_id] || {};
  const guide = capabilities.run_kinds.guide;
  const video = capabilities.run_kinds.video;
  const stages: WorkflowStage[] = [
    { id: 'observe-project', label: 'OBSERVE PROJECT', state: project.cwd ? 'ready' : 'unavailable', mode: 'read-only', gate: 'Canonical project checkout is registered.' },
    { id: 'resolve-cluster', label: 'RESOLVE SKILL CLUSTER', state: productGuideSkills.length ? 'ready' : 'unavailable', mode: 'read-only', gate: 'Product Guides cluster is active in the canonical index.' },
    { id: 'prepare-guide', label: 'PREPARE GUIDE CONTRACT', state: requirementState(capabilities, 'build-product-user-guides', 'capture-config'), mode: 'read-only', gate: 'Capture and coverage artifacts are independently validated.' },
    { id: 'capture-evidence', label: 'CAPTURE EVIDENCE', state: capabilityState(capabilities, 'build-product-user-guides'), mode: 'explicit-approval', gate: 'Content is requestable; authority remains unchecked until the typed request.' },
    { id: 'compose-video', label: 'COMPOSE PRODUCT VIDEO', state: capabilityState(capabilities, 'guide-to-product-video'), mode: 'explicit-approval', gate: 'Guide inventory and FilmSpec are distinct validated contracts.' },
    { id: 'validate-report', label: 'VALIDATE AND REPORT', state: requirementState(capabilities, 'build-product-user-guides', 'coverage-matrix'), mode: 'read-only', gate: 'Coverage validation is independent of execution authority.' },
  ];
  const blockers = [...guide.blockers, 'Canonical approval authority is unchecked until a typed request is submitted.'];
  return {
    schema: WORKFLOW_PROJECTION_SCHEMA,
    generated_at: new Date().toISOString(),
    project_id: project.project_id,
    project_name: project.name,
    source: 'canonical-skill-index-and-project-artifacts' as const,
    authority: 'unchecked_at_request' as const,
    observed: { registry_total: Number(observedRegistry.total || 0), registry_clusters: Number(observedRegistry.clusters || 0), active: Number(observedRegistry.active || 0), deferred: Number(observedRegistry.deferred || 0), archived: Number(observedRegistry.archived || 0), workflow: typeof observedWorkflow.workflow === 'string' ? observedWorkflow.workflow : 'none observed', workflow_status: typeof observedWorkflow.status === 'string' ? observedWorkflow.status : 'none observed', ...(typeof observedWorkflow.plan_id === 'string' ? { plan_id: observedWorkflow.plan_id } : {}), ...(typeof observedWorkflow.last_event_at === 'string' ? { last_event_at: observedWorkflow.last_event_at } : {}) },
    clusters,
    resolved_cluster_ids: productGuideSkills.length ? ['product-guides'] : [],
    workflow: { id: PRODUCT_GUIDE_WORKFLOW_ID, label: 'PRODUCT GUIDE → EVIDENCE → VIDEO', stages },
    run_kinds: { guide, video },
    trigger: { id: 'request-bounded-run' as const, state: guide.requestable ? 'gated' : project.cwd ? 'gated' : 'unavailable', eligible: false, requestable: guide.requestable, authority: 'unchecked_at_request' as const, blockers, endpoint: `/projects/${project.project_id}/workflows/${PRODUCT_GUIDE_WORKFLOW_ID}/requests`, requires: ['schema', 'request_id', 'approval_id', 'run_kind', 'plan_id', 'option_id', 'policy_hash', 'git_head', 'source_fingerprint', 'task_fingerprint', 'scope_hash'] },
  };
}
