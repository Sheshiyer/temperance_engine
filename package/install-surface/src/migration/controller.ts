/** Shared agent/CLI/TUI controller. Ports are explicitly injected trusted code,
 * never file-loaded factories. The existing planner and recovery owner remain
 * the only proposal/execution engines. A view is never an approval or readiness.
 */
import { constants, type Stats } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { safeAncestors, unchangedAncestors, sameFile, nodeMigrationReadIO, type MigrationReadIO, type MigrationProbeAdapter } from './adapter.ts';
import { MAX_MIGRATION_SNAPSHOT_BYTES, MAX_OBJECT_DEPTH, validateMigrationSnapshot, validateMigrationTarget, type MigrationSnapshotV1, type MigrationExpectedContext, type EvidenceDimensions } from './contracts.ts';
import { inspect } from './inspect.ts';
import { diff } from './diff.ts';
import { exportManifest, type MigrationExportIO } from './export.ts';
import { createMigrationPlan, validateMigrationPlan, assertMigrationPlanContext, calculateMigrationDigest, type MigrationInputDigests, type MigrationProfile, type MigrationPlannerInputs, type MigrationSourceContext, type MigrationPlanReviewContext, type MigrationPlanV1 } from './planner.ts';
import { recoverMigration, migrationReviewDigest, type MigrationRecoveryOptions, type MigrationRecoveryAuthority, type MigrationRecoveryAction, type MigrationRecoveryView } from './recovery.ts';

export const MIGRATION_ACTION_IDS = ['select-profile','inspect','export','diff','plan','apply','resume','status','rollback','release','cancel','request-sign-in'] as const;
export type MigrationActionId = typeof MIGRATION_ACTION_IDS[number];
export type MigrationEffectClass = 'none'|'read-only'|'local-manifest-write'|'reviewed-local-transaction'|'human-handoff';
export type MigrationRequest =
  | {action:'select-profile'; profile:MigrationProfile}
  | {action:'inspect'} | {action:'cancel'} | {action:'request-sign-in'}
  | {action:'export'; manifest_only:true; output:string}
  | {action:'diff'; bundle:string; host_binding:string}
  | {action:'plan'; profile:MigrationProfile}
  | {action:'apply'; plan:string; reviewed_digest:string}
  | {action:'resume'|'rollback'|'release'; operation:string; reviewed_digest:string}
  | {action:'status'; operation:string};
export type MigrationRecoveryRequest = Extract<MigrationRequest,{action:MigrationRecoveryAction}>;
export const MIGRATION_CODES = ['INPUT_REQUIRED','OWNER_ADAPTER_UNAVAILABLE','ARGUMENT_INVALID','ACTION_INVALID','ACTION_DISABLED','BUSY','CANCELLED','SNAPSHOT_INVALID','SNAPSHOT_DENIED','SNAPSHOT_CHANGED','SNAPSHOT_UNREADABLE','BYTE_LIMIT','READ_LIMIT','TIME_LIMIT','OWNER_RESULT_INVALID','OWNER_FAILED','OBSERVATIONS_HELD','PLAN_PROPOSED','PLAN_HELD','REVIEW_REQUIRED','EXACT_PLAN_REQUIRED','SIGN_IN_REQUIRED','OWNER_RECONCILIATION_REQUIRED','EXPORT_FAILED','EXPORTED','VERIFIED','INTERRUPTED','RECOVERY_REQUIRED','ATOMIC_CUSTODY_UNSUPPORTED','FOREIGN_CUSTODY_HELD'] as const;
export type MigrationCode = typeof MIGRATION_CODES[number];
const effects: Record<MigrationActionId,MigrationEffectClass> = {
  'select-profile':'none', inspect:'read-only', export:'local-manifest-write', diff:'read-only', plan:'read-only',
  apply:'reviewed-local-transaction', resume:'reviewed-local-transaction', status:'read-only', rollback:'reviewed-local-transaction', release:'reviewed-local-transaction', cancel:'none','request-sign-in':'human-handoff',
};
const profiles = ['workstation','always-on-node','recovery'] as const;
const outcomes = ['completed','held','planned','awaiting-human','in-progress','cancelled','committed','incomplete','rolled-back','manual-recovery','unknown-effect','released','invalid'] as const;
export type MigrationOutcome = typeof outcomes[number];
const unknownEvidence: EvidenceDimensions = {discovered:'unknown',installed:'unknown',configured:'unknown',auth:'unknown',admission:'unknown',runtime:'unknown',verification:'unknown'};
const digest = (v:unknown):v is string => typeof v==='string' && /^sha256:[a-f0-9]{64}$/.test(v);
const operationId = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{12}-[a-f0-9]{8}$/.test(v);
const reference = (v:unknown):v is string => typeof v==='string' && v.length>0 && v.length<=4096 && !/[\x00-\x1f\x7f]/.test(v) && !v.startsWith('--');
const member = <T extends string>(values:readonly T[],v:unknown):v is T => typeof v==='string' && values.includes(v as T);
function closed(v:unknown,required:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown> {
  return !!v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v))
    && Reflect.ownKeys(v).length===Object.keys(v).length
    && Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>'value' in d&&d.enumerable)
    && required.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
}
/** Bounded data-only boundary in addition to the accepted full closed schema.
 * Reject accessor/prototype surprises before the schema's size serialization.
 */
function publicSnapshot(value:unknown):value is MigrationSnapshotV1 {
  let nodes=0;
  const visit=(v:unknown,depth:number):boolean=>{
    if(++nodes>30_000||depth>MAX_OBJECT_DEPTH)return false;
    if(v===null||typeof v!=='object')return ['string','number','boolean'].includes(typeof v)||v===null;
    if(Array.isArray(v)) {
      if(Object.getPrototypeOf(v)!==Array.prototype||v.length>30_000||Reflect.ownKeys(v).length!==v.length+1)return false;
      const descriptors=Object.getOwnPropertyDescriptors(v);
      for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!('value' in d)||!d.enumerable||!visit(d.value,depth+1))return false;}
      return true;
    }
    if(![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==Object.keys(v).length)return false;
    return Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>'value' in d&&d.enumerable&&visit(d.value,depth+1));
  };
  try{return visit(value,0)&&validateMigrationSnapshot(value).ok;}catch{return false;}
}
export function validateMigrationRequest(v:unknown):v is MigrationRequest {
  try {
  if(!closed(v,['action'],['profile','manifest_only','output','bundle','host_binding','plan','reviewed_digest','operation']) || !member(MIGRATION_ACTION_IDS,v.action))return false;
  switch(v.action) {
    case 'select-profile': case 'plan': return closed(v,['action','profile']) && member(profiles,v.profile);
    case 'inspect': case 'cancel': case 'request-sign-in': return closed(v,['action']);
    case 'export': return closed(v,['action','manifest_only','output']) && v.manifest_only===true && reference(v.output);
    case 'diff': return closed(v,['action','bundle','host_binding']) && reference(v.bundle) && reference(v.host_binding);
    case 'apply': return closed(v,['action','plan','reviewed_digest']) && reference(v.plan) && digest(v.reviewed_digest);
    case 'status': return closed(v,['action','operation']) && operationId(v.operation);
    default: return closed(v,['action','operation','reviewed_digest']) && operationId(v.operation) && digest(v.reviewed_digest);
  }
  }catch{return false;}
}

/** Only explicit trusted embedding code may implement these ports. No production
 * adapter is installed here. Input references remain transient and private.
 * Source pins exist BEFORE planning; final review exists AFTER a final proposal.
 * Recovery authority independently authenticates that review at the effect clock.
 */
export interface MigrationOwnerPorts {
  inspection?: { adapter:MigrationProbeAdapter; expected_context?:MigrationExpectedContext };
  manifestExport?: { io:MigrationExportIO };
  comparison?: { readInputs(request:Extract<MigrationRequest,{action:'diff'}>,signal:AbortSignal):Promise<{source:unknown;target:unknown;expected_context?:MigrationExpectedContext}> };
  planning?: { readInputs(request:Extract<MigrationRequest,{action:'plan'}>,signal:AbortSignal):Promise<MigrationPlannerInputs> };
  sourceContext?: { readPinnedContext(request:Extract<MigrationRequest,{action:'plan'}>,signal:AbortSignal):Promise<MigrationSourceContext> };
  finalReview?: { readFinalReview(request:MigrationRecoveryRequest,plan:MigrationPlanV1,signal:AbortSignal):Promise<MigrationPlanReviewContext> };
  recovery?: {
    resolveOperation(request:MigrationRecoveryRequest,signal:AbortSignal):Promise<Omit<MigrationRecoveryOptions,'action'|'signal'|'authority'|'review'>>;
    authority:MigrationRecoveryAuthority;
  };
}
export type MigrationFinalReviewProjection =
  | {state:'not-acquired'|'invalid';execution_authorized:false}
  | {state:'acquired';review_digest:string;plan_digest:string;reviewed_at:string;expires_at:string;validation:'historical-context-only';execution_authorized:false};
export type MigrationReleaseReviewProjection =
  | {state:'not-acquired'|'invalid';execution_authorized:false}
  | {state:'acquired';context_digest:string;plan_digest:string;original_review_digest:string;evidence_digest:string;issued_at:string;expires_at:string;scope:'release-only';validation:'structure-only';evidence_observation:'not-exposed-by-owner-api';freshness:'not-assessed';execution_authorized:false};
export interface MigrationPlanReviewProjection extends MigrationInputDigests {
  plan_digest:string;profile:MigrationProfile;status:'PROPOSED';
  generated_at:string;source_pinned_at:string;source_expires_at:string;
  selected_modules:string[];step_count:number;hold_count:number;
  steps:Array<{
    id:string;module_id:string;source_digest:string;depends_on:string[];
    effect:'local-file'|'configuration-create';prepared_digest:string;preimage_digest:string;
    preconditions:MigrationPlanV1['steps'][number]['preconditions'];
    verifier_probes:MigrationPlanV1['steps'][number]['verifier_probes'];
    rollback:{requirements:MigrationPlanV1['steps'][number]['rollback_requirements'];preimage_availability:'unknown';backup_availability:'unknown';restoration_verification:'unknown'};
  }>;
  final_review:MigrationFinalReviewProjection;
  terminal_release:MigrationReleaseReviewProjection;
  limits:Array<typeof REVIEW_LIMITS[number]>;
  execution_authorized:false;
}
const REVIEW_DIGEST_KEYS = ['snapshot_digest','source_release_digest','module_lock_digest','selection_digest','destination_identity_digest','destination_observation_digest','binding_digest','configuration_generation_digest','prepared_intent_digest','preimage_digest'] as const;
const REVIEW_LIMITS = ['backup-availability-unobserved','restoration-unverified','fresh-owner-preflight-required','review-digest-not-authority','external-signins-not-reversed'] as const;
const REVIEW_PRECONDITIONS = ['fresh-exact-review','exclusive-owned-claim','fresh-destination-preflight','exact-preimage'] as const;
const REVIEW_PROBES = ['prepared-bytes-and-mode','destination-bytes-and-mode'] as const;
const REVIEW_ROLLBACK = ['owned-preimage','compatible-configuration-generation','exclusive-owned-claim'] as const;
// A public logical identifier is neither prose nor a private path/account/session.
const reviewRef=(v:unknown):v is string=>typeof v==='string'&&v.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(v)
  &&!v.includes('..')&&!/localhost|127\.0\.0\.1|https?:|^(?:device|session|account|claim|nonce|authorization):|(?:^|[.:_-])(?:secret|password|api[-_]?key|access[-_]?token)(?:$|[.:_-])|^sk-|^gh[pousr]_|^xox[baprs]-/i.test(v);
function dataList<T>(v:unknown,predicate:(item:unknown,index:number)=>item is T,maximum=4096):v is T[] {
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>maximum||Reflect.ownKeys(v).length!==v.length+1)return false;
  const descriptors=Object.getOwnPropertyDescriptors(v);
  for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!('value' in d)||!d.enumerable||!predicate(d.value,i))return false;}
  return true;
}
const exactList=(v:unknown,expected:readonly string[])=>dataList(v,(x):x is string=>typeof x==='string',expected.length)&&v.length===expected.length&&v.every((x,i)=>x===expected[i]);
function timestamp(v:unknown):v is string {
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v))return false;
  const time=Date.parse(v);return Number.isFinite(time)&&new Date(time).toISOString().replace('.000Z','Z')===v.replace('.000Z','Z');
}
function validPlanProjection(v:unknown):v is MigrationPlanReviewProjection {
  if(!closed(v,['plan_digest','profile','status','generated_at','source_pinned_at','source_expires_at','selected_modules','step_count','hold_count','steps','final_review','terminal_release','limits','execution_authorized',...REVIEW_DIGEST_KEYS])
    ||!digest(v.plan_digest)||!REVIEW_DIGEST_KEYS.every(k=>digest(v[k]))||!member(profiles,v.profile)||v.status!=='PROPOSED'||v.execution_authorized!==false
    ||!timestamp(v.generated_at)||!timestamp(v.source_pinned_at)||!timestamp(v.source_expires_at)||Date.parse(v.source_pinned_at)>=Date.parse(v.source_expires_at)
    ||!count(v.step_count)||!count(v.hold_count)||!dataList(v.selected_modules,reviewRef)||new Set(v.selected_modules).size!==v.selected_modules.length
    ||!exactList(v.limits,REVIEW_LIMITS))return false;
  if(!dataList(v.steps,(step):step is MigrationPlanReviewProjection['steps'][number]=>closed(step,['id','module_id','source_digest','depends_on','effect','prepared_digest','preimage_digest','preconditions','verifier_probes','rollback'])
    &&reviewRef(step.id)&&reviewRef(step.module_id)&&digest(step.source_digest)&&dataList(step.depends_on,reviewRef)&&new Set(step.depends_on).size===step.depends_on.length
    &&member(['local-file','configuration-create'],step.effect)&&digest(step.prepared_digest)&&digest(step.preimage_digest)&&exactList(step.preconditions,REVIEW_PRECONDITIONS)&&exactList(step.verifier_probes,REVIEW_PROBES)
    &&closed(step.rollback,['requirements','preimage_availability','backup_availability','restoration_verification'])&&exactList(step.rollback.requirements,REVIEW_ROLLBACK)
    &&step.rollback.preimage_availability==='unknown'&&step.rollback.backup_availability==='unknown'&&step.rollback.restoration_verification==='unknown'))return false;
  if(v.step_count!==v.steps.length||(v.hold_count>0&&v.steps.length>0))return false;
  const seen=new Set<string>();let references=0;
  for(const step of v.steps){references+=step.depends_on.length;if(references>8192||seen.has(step.id)||!v.selected_modules.includes(step.module_id)||step.depends_on.some(id=>!seen.has(id)))return false;seen.add(step.id);}
  if(v.hold_count===0&&(Date.parse(v.generated_at)<Date.parse(v.source_pinned_at)||Date.parse(v.generated_at)>=Date.parse(v.source_expires_at)))return false;
  const review=v.final_review;
  const reviewValid=closed(review,['state','execution_authorized'])&&member(['not-acquired','invalid'],review.state)&&review.execution_authorized===false
    ||closed(review,['state','review_digest','plan_digest','reviewed_at','expires_at','validation','execution_authorized'])&&review.state==='acquired'&&review.execution_authorized===false
    &&digest(review.review_digest)&&review.plan_digest===v.plan_digest&&review.validation==='historical-context-only'&&timestamp(review.reviewed_at)&&timestamp(review.expires_at)
    &&v.hold_count===0&&Date.parse(v.generated_at)<=Date.parse(review.reviewed_at)&&Date.parse(review.reviewed_at)<Date.parse(review.expires_at)&&Date.parse(review.reviewed_at)<Date.parse(v.source_expires_at);
  if(!reviewValid)return false;
  const release=v.terminal_release;
  const releaseValid=closed(release,['state','execution_authorized'])&&member(['not-acquired','invalid'],release.state)&&release.execution_authorized===false
    ||closed(release,['state','context_digest','plan_digest','original_review_digest','evidence_digest','issued_at','expires_at','scope','validation','evidence_observation','freshness','execution_authorized'])
    &&release.state==='acquired'&&release.execution_authorized===false&&digest(release.context_digest)&&digest(release.evidence_digest)&&release.plan_digest===v.plan_digest
    &&closed(review,['state','review_digest','plan_digest','reviewed_at','expires_at','validation','execution_authorized'])&&review.state==='acquired'&&release.original_review_digest===review.review_digest
    &&timestamp(release.issued_at)&&timestamp(release.expires_at)&&Date.parse(release.issued_at)<Date.parse(release.expires_at)
    &&release.scope==='release-only'&&release.validation==='structure-only'&&release.evidence_observation==='not-exposed-by-owner-api'&&release.freshness==='not-assessed';
  return releaseValid&&Buffer.byteLength(JSON.stringify(v),'utf8')<=MAX_MIGRATION_SNAPSHOT_BYTES;
}
/** Copies only explicitly public review fields. Storage/backup state is unknown:
 * neither the pure proposal nor a terminal result observes those capabilities.
 * A matching acquired review digest never authenticates the owner or an action.
 */
function projectPlanReview(plan:MigrationPlanV1,acquired?:{value:unknown},releaseInput?:{action:MigrationRecoveryAction;context:unknown;operation:{txid:string;claim_nonce:string};stateRoot:string}):MigrationPlanReviewProjection {
  // The accepted planner permits 4096 entries per list. Complete representation
  // is mandatory; a separate total-reference/byte budget holds oversized graphs.
  if(plan.steps.length>4096||plan.selected_modules.length>4096||plan.steps.reduce((n,s)=>n+s.depends_on.length,0)>8192)throw new ControllerFailure('OWNER_RESULT_INVALID');
  let finalReview:MigrationFinalReviewProjection={state:'not-acquired',execution_authorized:false};
  if(acquired) {
    finalReview={state:'invalid',execution_authorized:false};
    try {
      const review=acquired.value;
      if(closed(review,[...REVIEW_DIGEST_KEYS,'destination_id','issued_device_ref','profile','backend','selected_modules','plan_digest','reviewed_at','expires_at'])&&dataList(review.selected_modules,reviewRef)) {
        // Historical integrity only. Task 4 still owns CURRENT purpose-specific
        // authentication/freshness; this must not block expired-review release.
        assertMigrationPlanContext(plan,review as unknown as MigrationPlanReviewContext,review.reviewed_at as string);
        const context=review as unknown as MigrationPlanReviewContext;
        finalReview={state:'acquired',review_digest:migrationReviewDigest(context),plan_digest:context.plan_digest,reviewed_at:context.reviewed_at,expires_at:context.expires_at,validation:'historical-context-only',execution_authorized:false};
      }
    }catch{/* Invalid owner context is never copied into public diagnostics. */}
  }
  let terminalRelease:MigrationReleaseReviewProjection={state:'not-acquired',execution_authorized:false};
  if(releaseInput) {
    terminalRelease={state:'invalid',execution_authorized:false};
    const context=releaseInput.context;
    // Only project actual independently resolved context. No clock or owner
    // authentication is inferred here, and private binding identifiers stay out.
    if(releaseInput.action==='release'&&finalReview.state==='acquired'
      &&closed(context,['schema','authorization_id','plan_digest','review_digest','txid','claim_nonce','lifecycle_state_root','evidence_digest','issued_at','expires_at'])
      &&context.schema==='temperance.migration.terminal-release.v1'&&typeof context.authorization_id==='string'&&context.authorization_id.length>0&&context.authorization_id.length<=128
      &&context.plan_digest===plan.plan_digest&&context.review_digest===finalReview.review_digest&&context.txid===releaseInput.operation.txid&&context.claim_nonce===releaseInput.operation.claim_nonce&&context.lifecycle_state_root===releaseInput.stateRoot
      &&digest(context.evidence_digest)&&timestamp(context.issued_at)&&timestamp(context.expires_at)&&Date.parse(context.issued_at)<Date.parse(context.expires_at)) {
      terminalRelease={state:'acquired',context_digest:calculateMigrationDigest(context),plan_digest:plan.plan_digest,original_review_digest:finalReview.review_digest,evidence_digest:context.evidence_digest,issued_at:context.issued_at,expires_at:context.expires_at,scope:'release-only',validation:'structure-only',evidence_observation:'not-exposed-by-owner-api',freshness:'not-assessed',execution_authorized:false};
    }
  }
  const projection:MigrationPlanReviewProjection={
    ...Object.fromEntries(REVIEW_DIGEST_KEYS.map(key=>[key,plan[key]])) as unknown as MigrationInputDigests,
    plan_digest:plan.plan_digest,profile:plan.profile,status:'PROPOSED',generated_at:plan.generated_at,source_pinned_at:plan.source_context_pinned_at,source_expires_at:plan.source_context_expires_at,
    selected_modules:[...plan.selected_modules],step_count:plan.steps.length,hold_count:plan.holds.length,
    steps:plan.steps.map(step=>({id:step.id,module_id:step.module_id,source_digest:step.source_digest,depends_on:[...step.depends_on],effect:step.effect,prepared_digest:step.prepared_digest,preimage_digest:step.preimage_digest,
      preconditions:[...step.preconditions],verifier_probes:[...step.verifier_probes],rollback:{requirements:[...step.rollback_requirements],preimage_availability:'unknown',backup_availability:'unknown',restoration_verification:'unknown'}})),
    final_review:finalReview,terminal_release:terminalRelease,limits:[...REVIEW_LIMITS],execution_authorized:false,
  };
  if(!validPlanProjection(projection))throw new ControllerFailure('OWNER_RESULT_INVALID');
  return projection;
}
export interface MigrationViewV1 {
  schema:'temperance.migration.view.v1'; version:{major:1;minor:0};
  step:'scenario'|'inspect'|'review'|'recovery'|'access'; profile:MigrationProfile|null;
  command:MigrationActionId|null; outcome:MigrationOutcome; effect_class:MigrationEffectClass;
  evidence:EvidenceDimensions;
  findings:Array<{code:MigrationCode}>;
  actions:Array<{id:MigrationActionId;effect_class:MigrationEffectClass;enabled:boolean;reason:MigrationCode|null}>;
  handoffs:Array<{kind:'select-inputs'|'final-review'|'sign-in'|'owner-reconciliation';execution:'not-performed'}>;
  snapshot?:MigrationSnapshotV1;
  plan?:MigrationPlanReviewProjection;
  comparison?:{status:'compatible'|'held'|'nonauthoritative'|'upgrade-required';hold_count:number;finding_count:number;execution_authorized:false};
  export?:{digest:string;bytes:number;execution_authorized:false};
  operation?:{txid:string;plan_digest:string;status:MigrationRecoveryView['status'];reason:MigrationRecoveryView['reason'];external_signins_preserved:true;prior_status?:MigrationRecoveryView['status']};
  execution_authorized:false;
}
export interface MigrationCommandResult { view:MigrationViewV1; exitCode:0|1|2|64 }
const recoveryStatuses = ['committed','incomplete','rolled-back','manual-recovery','unknown-effect','released'] as const;
const recoveryReasons = ['VERIFIED','INTERRUPTED','RECOVERY_REQUIRED','OWNER_RECONCILIATION_REQUIRED','ATOMIC_CUSTODY_UNSUPPORTED','FOREIGN_CUSTODY_HELD'] as const;
const count = (v:unknown):v is number => Number.isSafeInteger(v) && (v as number)>=0 && (v as number)<=MAX_MIGRATION_SNAPSHOT_BYTES;
function validEvidence(v:unknown):v is EvidenceDimensions {
  const axes = {discovered:['yes','no','unknown'],installed:['yes','no','unknown'],configured:['full','partial','none','unknown'],auth:['yes','no','unknown'],admission:['admitted','pending','not-admitted','unknown'],runtime:['stopped','running','unreachable','unknown'],verification:['verified','unverified','failed','unknown']};
  return closed(v,Object.keys(axes)) && Object.entries(axes).every(([k,values])=>member(values,v[k]));
}
/** Full closed public data contract, including dense ordinary arrays. Own
 * accessors/methods are rejected without evaluation. JavaScript Proxy reflection
 * traps can execute before rejection; this is not a sandbox for hostile code and
 * cannot universally distinguish a transparent Proxy from ordinary data.
 */
export function validateMigrationView(value:unknown):value is MigrationViewV1 {
  try {
    if(!closed(value,['schema','version','step','profile','command','outcome','effect_class','evidence','findings','actions','handoffs','execution_authorized'],['snapshot','plan','comparison','export','operation'])
      || value.schema!=='temperance.migration.view.v1' || !closed(value.version,['major','minor']) || value.version.major!==1 || value.version.minor!==0
      || !member(['scenario','inspect','review','recovery','access'],value.step) || (value.profile!==null&&!member(profiles,value.profile))
      || (value.command!==null&&!member(MIGRATION_ACTION_IDS,value.command)) || !member(outcomes,value.outcome) || !member(Object.values(effects),value.effect_class)
      || value.execution_authorized!==false || !validEvidence(value.evidence))return false;
    if(!dataList(value.findings,(f):f is MigrationViewV1['findings'][number]=>closed(f,['code'])&&member(MIGRATION_CODES,f.code),32))return false;
    if(!dataList(value.actions,(a,i):a is MigrationViewV1['actions'][number]=>closed(a,['id','effect_class','enabled','reason'])&&a.id===MIGRATION_ACTION_IDS[i]&&a.effect_class===effects[a.id as MigrationActionId]&&typeof a.enabled==='boolean'&&(a.enabled?a.reason===null:member(MIGRATION_CODES,a.reason)),MIGRATION_ACTION_IDS.length)||value.actions.length!==MIGRATION_ACTION_IDS.length)return false;
    if(!dataList(value.handoffs,(h):h is MigrationViewV1['handoffs'][number]=>closed(h,['kind','execution'])&&member(['select-inputs','final-review','sign-in','owner-reconciliation'],h.kind)&&h.execution==='not-performed',4))return false;
    if(value.snapshot!==undefined&&!publicSnapshot(value.snapshot))return false;
    if(value.plan!==undefined&&!validPlanProjection(value.plan))return false;
    if(value.comparison!==undefined&&(!closed(value.comparison,['status','hold_count','finding_count','execution_authorized'])||!member(['compatible','held','nonauthoritative','upgrade-required'],value.comparison.status)||!count(value.comparison.hold_count)||!count(value.comparison.finding_count)||value.comparison.execution_authorized!==false))return false;
    if(value.export!==undefined&&(!closed(value.export,['digest','bytes','execution_authorized'])||!digest(value.export.digest)||!count(value.export.bytes)||value.export.execution_authorized!==false))return false;
    if(value.operation!==undefined&&(!closed(value.operation,['txid','plan_digest','status','reason','external_signins_preserved'],['prior_status'])||!operationId(value.operation.txid)||!digest(value.operation.plan_digest)||!member(recoveryStatuses,value.operation.status)||!member(recoveryReasons,value.operation.reason)||value.operation.external_signins_preserved!==true||(value.operation.prior_status!==undefined&&!member(recoveryStatuses,value.operation.prior_status))))return false;
    return validViewRelations(value as unknown as MigrationViewV1);
  }catch{return false;}
}
/** Exit codes describe the requested command, never a ready profile. */
export function migrationExitCode(view:MigrationViewV1):MigrationCommandResult['exitCode'] {
  if(!validateMigrationView(view)||view.outcome==='invalid')return 64;
  if(view.outcome==='unknown-effect'||view.outcome==='manual-recovery')return 2;
  if(view.outcome==='completed')return 0;
  if(view.command==='release')return view.outcome==='released'&&view.operation?.reason==='VERIFIED'?0:1;
  if(['committed','rolled-back','released'].includes(view.outcome))return view.operation?.reason==='VERIFIED'?0:2;
  return 1;
}
class ControllerFailure extends Error { constructor(readonly code:MigrationCode){super(code);} }
function validRecovery(v:unknown):v is MigrationRecoveryView {
  return closed(v,['schema','txid','plan_digest','status','reason','external_signins_preserved']) && v.schema==='temperance.migration.recovery.v1' && operationId(v.txid) && digest(v.plan_digest) && member(recoveryStatuses,v.status) && member(recoveryReasons,v.reason) && v.external_signins_preserved===true
    && recoveryPair(v.status,v.reason);
}

const recoveryCommands = ['apply','resume','status','rollback','release'] as const;
function recoveryPair(status:unknown,reason:unknown):boolean {
  if(member(['committed','rolled-back','released'],status))return reason==='VERIFIED';
  if(status==='incomplete')return reason==='INTERRUPTED';
  if(status==='unknown-effect')return reason==='OWNER_RECONCILIATION_REQUIRED';
  return status==='manual-recovery'&&member(['RECOVERY_REQUIRED','ATOMIC_CUSTODY_UNSUPPORTED','FOREIGN_CUSTODY_HELD'],reason);
}
/** Current command facts are joined here. Historical operations may remain in
 * later inspect/plan/export views; they cannot certify that later command.
 * Evidence axes, including observed authentication, stay independent of success.
 */
function validViewRelations(view:MigrationViewV1):boolean {
  const {command,outcome,effect_class,operation}=view;
  if(operation&&(!recoveryPair(operation.status,operation.reason)||(operation.prior_status!==undefined&&(!member(['committed','rolled-back'],operation.prior_status)||member(['committed','rolled-back'],operation.status)))))return false;
  const has=(code:MigrationCode)=>view.findings.some(f=>f.code===code);
  if(outcome==='cancelled')return command!==null&&effect_class==='none'&&has('CANCELLED');
  if(effect_class!==(command===null?'none':effects[command]))return false;
  if(command===null)return member(['completed','held','invalid'],outcome);
  if(outcome==='held'||outcome==='invalid'||outcome==='in-progress')return command!=='cancel';
  if(outcome==='awaiting-human')return command==='request-sign-in'&&has('SIGN_IN_REQUIRED')&&view.handoffs.some(h=>h.kind==='sign-in');
  if(outcome==='planned')return command==='plan'&&!!view.plan&&view.profile===view.plan.profile&&view.plan.hold_count===0&&view.plan.final_review.state==='not-acquired'&&view.plan.terminal_release.state==='not-acquired';
  if(outcome==='completed')return command==='select-profile'?view.profile!==null:command==='inspect'?!!view.snapshot:command==='diff'?!!view.comparison:command==='export'?!!view.export:false;
  if(command==='export'&&outcome==='unknown-effect')return (has('EXPORT_FAILED')||has('OWNER_RECONCILIATION_REQUIRED'))&&view.handoffs.some(h=>h.kind==='owner-reconciliation');
  if(!member(recoveryCommands,command)||!operation||operation.status!==outcome||!has(operation.reason))return false;
  // These are the observable outcomes of the accepted owner API for each action.
  if(outcome==='released'&&command!=='release')return false;
  if(command==='release'&&member(['committed','rolled-back'],outcome))return false;
  if(outcome==='committed'&&command==='rollback')return false;
  if(outcome==='rolled-back'&&command==='apply')return false;
  if(member(['unknown-effect','manual-recovery'],outcome)&&!view.handoffs.some(h=>h.kind==='owner-reconciliation'))return false;
  return !view.plan||view.plan.plan_digest===operation.plan_digest;
}

export function createMigrationController(options:{snapshot?:unknown;ports?:MigrationOwnerPorts}={}) {
  const ports=options.ports??{};
  let inputInvalid=false;
  let current:MigrationViewV1={schema:'temperance.migration.view.v1',version:{major:1,minor:0},step:'scenario',profile:null,command:null,outcome:'completed',effect_class:'none',evidence:{...unknownEvidence},findings:[],actions:[],handoffs:[{kind:'select-inputs',execution:'not-performed'}],execution_authorized:false};
  if(options.snapshot!==undefined) {
    try { if(!publicSnapshot(options.snapshot))throw 0; current.snapshot=structuredClone(options.snapshot) as MigrationSnapshotV1; }
    catch {inputInvalid=true;current.outcome='invalid';current.findings=[{code:'SNAPSHOT_INVALID'}];}
  }
  // Supplied source metadata is not observed destination evidence.
  let active:{abort:AbortController;promise:Promise<MigrationCommandResult>}|undefined;
  let possibleEffects=false,reviewProjectionHeld=false;
  function reviewPlan(...args:Parameters<typeof projectPlanReview>):MigrationPlanReviewProjection {
    try {const result=projectPlanReview(...args);reviewProjectionHeld=false;return result;}
    catch(error){delete current.plan;reviewProjectionHeld=true;throw error;}
  }
  const hasRecovery=()=>typeof ports.recovery?.resolveOperation==='function'&&typeof ports.recovery.authority?.authorize==='function'&&typeof ports.recovery.authority?.readFreshInputs==='function'&&typeof ports.finalReview?.readFinalReview==='function';
  function unavailable(id:MigrationActionId):MigrationCode|null {
    if(inputInvalid&&id!=='cancel')return 'SNAPSHOT_INVALID';
    if(id==='select-profile'||id==='cancel'||id==='request-sign-in')return null;
    if(reviewProjectionHeld&&member(['apply','resume','rollback','release'],id))return 'ACTION_DISABLED';
    if(id==='apply'&&(current.profile==='recovery'||(current.plan?.hold_count??0)>0))return 'ACTION_DISABLED';
    if(id==='inspect')return ports.inspection?.adapter ? null:'OWNER_ADAPTER_UNAVAILABLE';
    if(id==='export')return !ports.manifestExport?.io?'OWNER_ADAPTER_UNAVAILABLE':!current.snapshot?'INPUT_REQUIRED':null;
    if(id==='diff')return typeof ports.comparison?.readInputs==='function'?null:'OWNER_ADAPTER_UNAVAILABLE';
    if(id==='plan')return typeof ports.planning?.readInputs==='function'&&typeof ports.sourceContext?.readPinnedContext==='function'?null:'OWNER_ADAPTER_UNAVAILABLE';
    return hasRecovery()?null:'OWNER_ADAPTER_UNAVAILABLE';
  }
  function view():MigrationViewV1 {
    const result={...current,actions:MIGRATION_ACTION_IDS.map(id=>{const reason=active&&id!=='cancel'?'BUSY':unavailable(id);return {id,effect_class:effects[id],enabled:reason===null,reason};})};
    return structuredClone(result);
  }
  function finish():MigrationCommandResult { const output=view();return {view:output,exitCode:migrationExitCode(output)}; }
  function isolatedFailure(code:MigrationCode,outcome:MigrationOutcome='invalid'):MigrationCommandResult {const output=view();output.command=null;output.effect_class='none';output.outcome=outcome;output.findings=[{code}];return {view:output,exitCode:migrationExitCode(output)};}
  async function execute(request:MigrationRequest,signal:AbortSignal):Promise<MigrationCommandResult> {
    current={...current,command:request.action,effect_class:effects[request.action],outcome:'in-progress',findings:[],handoffs:[]};
    const check=()=>{if(signal.aborted)throw new ControllerFailure('CANCELLED');};
    let dispatchedEffect=false;
    let pendingOperation:{txid:string;plan_digest:string}|undefined;
    try {
      check();
      const reason=unavailable(request.action);
      if(reason){current.outcome=reason==='ACTION_DISABLED'?'invalid':'held';current.findings=[{code:reason}];return finish();}
      if(request.action==='select-profile') {current.profile=request.profile;current.step=request.profile==='recovery'?'recovery':'scenario';current.outcome='completed';current.handoffs=[{kind:'select-inputs',execution:'not-performed'}];}
      else if(request.action==='request-sign-in') {current.step='access';current.outcome='awaiting-human';current.findings=[{code:'SIGN_IN_REQUIRED'}];current.handoffs=[{kind:'sign-in',execution:'not-performed'}];}
      else if(request.action==='inspect') {
        const result=await inspect(ports.inspection!.adapter,{expected_context:ports.inspection!.expected_context,signal});check();
        if(!result.snapshot || !publicSnapshot(result.snapshot))throw new ControllerFailure('OWNER_RESULT_INVALID');
        current.snapshot=structuredClone(result.snapshot);current.evidence=structuredClone(result.snapshot.evidence);current.step='inspect';current.outcome='completed';
        if(result.findings.length)current.findings=[{code:'OBSERVATIONS_HELD'}];
      }else if(request.action==='diff') {
        const input=await ports.comparison!.readInputs(structuredClone(request),signal);check();
        if(!closed(input,['source','target'],['expected_context'])||!publicSnapshot(input.source)||(!publicSnapshot(input.target)&&!validateMigrationTarget(input.target)))throw new ControllerFailure('OWNER_RESULT_INVALID');
        const result=diff(input.source,input.target,input.expected_context);
        const assessment=result.assessment!;
        current.comparison={status:assessment.status,hold_count:assessment.holds.length,finding_count:result.findings.length,execution_authorized:false};
        current.outcome='completed';if(result.findings.length)current.findings=[{code:'OBSERVATIONS_HELD'}];
      }else if(request.action==='export') {
        check();dispatchedEffect=true;possibleEffects=true;
        const result=await exportManifest(current.snapshot,request.output,ports.manifestExport!.io);
        if(!result.ok) {current.outcome='unknown-effect';current.findings=[{code:'EXPORT_FAILED'}];current.handoffs=[{kind:'owner-reconciliation',execution:'not-performed'}];}
        else {current.export={digest:result.digest!,bytes:result.bytes!,execution_authorized:false};current.outcome='completed';current.findings=[{code:'EXPORTED'}];}
      }else if(request.action==='plan') {
        const sourceContext=structuredClone(await ports.sourceContext!.readPinnedContext(structuredClone(request),signal));check();
        const inputs=await ports.planning!.readInputs(structuredClone(request),signal);check();
        if(inputs.profile!==request.profile)throw new ControllerFailure('OWNER_RESULT_INVALID');
        const proposal=await createMigrationPlan({...inputs,source_context:sourceContext});check();
        if(!validateMigrationPlan(proposal))throw new ControllerFailure('OWNER_RESULT_INVALID');
        current.profile=request.profile;current.step='review';current.plan=reviewPlan(proposal);
        current.outcome=proposal.holds.length?'held':'planned';current.findings=[{code:proposal.holds.length?'PLAN_HELD':'PLAN_PROPOSED'}];current.handoffs=[{kind:'final-review',execution:'not-performed'}];
      }else if(request.action!=='cancel') {
        const owner=ports.recovery!;
        const supplied=await owner.resolveOperation(structuredClone(request),signal);check();
        if(!closed(supplied,['operation','plan','stateRoot','io','root_tokens'],['prepared','release_context']))throw new ControllerFailure('OWNER_RESULT_INVALID');
        // Detach all data before calling the independent asynchronous reviewer.
        // IO and authority remain the explicitly injected executable owner ports.
        const resolved={...supplied,operation:structuredClone(supplied.operation),plan:structuredClone(supplied.plan),root_tokens:structuredClone(supplied.root_tokens),
          ...(supplied.prepared?{prepared:new Map(supplied.prepared)}:{}),...(supplied.release_context?{release_context:structuredClone(supplied.release_context)}:{})};
        if(!closed(resolved,['operation','plan','stateRoot','io','root_tokens'],['prepared','release_context'])||!validateMigrationPlan(resolved.plan)||!closed(resolved.operation,['txid','claim_nonce'])||!operationId(resolved.operation.txid)||typeof resolved.operation.claim_nonce!=='string'||!/^[a-f0-9]{32}$/.test(resolved.operation.claim_nonce))throw new ControllerFailure('OWNER_RESULT_INVALID');
        if(('operation' in request&&request.operation!==resolved.operation.txid)||('reviewed_digest' in request&&request.reviewed_digest!==resolved.plan.plan_digest))throw new ControllerFailure('EXACT_PLAN_REQUIRED');
        if(current.profile!==null&&current.profile!=='recovery'&&current.profile!==resolved.plan.profile)throw new ControllerFailure('EXACT_PLAN_REQUIRED');
        current.plan=reviewPlan(resolved.plan);
        const review=await ports.finalReview!.readFinalReview(structuredClone(request),structuredClone(resolved.plan),signal);check();
        // No source pin, JSON grant, or controller-computed digest can supply review.
        if(current.profile===null)current.profile=resolved.plan.profile;
        current.plan=reviewPlan(resolved.plan,{value:review},resolved.release_context?{action:request.action,context:resolved.release_context,operation:resolved.operation,stateRoot:resolved.stateRoot}:undefined);
        pendingOperation={txid:resolved.operation.txid,plan_digest:resolved.plan.plan_digest};
        current.step='recovery';dispatchedEffect=request.action!=='status';if(dispatchedEffect)possibleEffects=true;
        const result=await recoverMigration({...resolved,review,authority:owner.authority,action:request.action,signal});
        if(!validRecovery(result)||result.txid!==resolved.operation.txid||result.plan_digest!==resolved.plan.plan_digest)throw new ControllerFailure('OWNER_RESULT_INVALID');
        const prior=current.operation?.txid===result.txid?current.operation:undefined;
        // A refused retry does not erase an earlier observed terminal outcome.
        // This is a display fact only; current owner disposition still controls exits.
        const lastTerminal=prior&&['committed','rolled-back'].includes(prior.status)?prior.status:prior?.prior_status;
        current.operation={txid:result.txid,plan_digest:result.plan_digest,status:result.status,reason:result.reason,external_signins_preserved:true,
          ...(lastTerminal&&!['committed','rolled-back'].includes(result.status)?{prior_status:lastTerminal}:{})};
        current.outcome=result.status;current.findings=[{code:result.reason}];
        if(result.status==='unknown-effect'||result.status==='manual-recovery')current.handoffs=[{kind:'owner-reconciliation',execution:'not-performed'}];
      }
    }catch(error) {
      const code=error instanceof ControllerFailure?error.code:'OWNER_FAILED';
      if(dispatchedEffect){
        if(pendingOperation){const prior=current.operation?.txid===pendingOperation.txid?current.operation:undefined;const terminal=prior&&member(['committed','rolled-back'],prior.status)?prior.status:prior?.prior_status;current.operation={...pendingOperation,status:'unknown-effect',reason:'OWNER_RECONCILIATION_REQUIRED',external_signins_preserved:true,...(terminal?{prior_status:terminal}:{})};}
        current.outcome='unknown-effect';current.findings=[{code:'OWNER_RECONCILIATION_REQUIRED'}];current.handoffs=[{kind:'owner-reconciliation',execution:'not-performed'}];}
      else {current.outcome=code==='CANCELLED'?'cancelled':code==='OWNER_FAILED'?'held':'invalid';current.findings=[{code}];if(code==='CANCELLED')current.effect_class='none';}
    }
    return finish();
  }
  async function dispatch(input:unknown,options:{signal?:AbortSignal}={}):Promise<MigrationCommandResult> {
    if(!validateMigrationRequest(input))return isolatedFailure('ACTION_INVALID');
    const request=structuredClone(input);
    if(inputInvalid&&request.action!=='cancel')return isolatedFailure('SNAPSHOT_INVALID');
    if(request.action==='cancel') {
      if(active){const pending=active;pending.abort.abort();return structuredClone(await pending.promise);}
      if(possibleEffects)return finish(); // Preserve completed/uncertain effects and sign-in observations.
      current={...current,command:'cancel',effect_class:'none',outcome:'cancelled',findings:[{code:'CANCELLED'}]};return finish();
    }
    if(active)return isolatedFailure('BUSY','held');
    const abort=new AbortController(),forward=()=>abort.abort();
    if(options.signal?.aborted)abort.abort();else options.signal?.addEventListener('abort',forward,{once:true});
    // Every waiter observes the same fully settled state, after cleanup.
    const promise=Promise.resolve().then(async()=>{
      try {await execute(request,abort.signal);}
      finally {active=undefined;options.signal?.removeEventListener('abort',forward);}
      return finish();
    });
    active={abort,promise};
    return structuredClone(await promise);
  }
  return {view,dispatch};
}

/** Purpose-specific public snapshot reader. Requires stable controlled ancestors;
 * pathname checks cannot eliminate ancestor rename/ABA races (not openat).
 * One bounded descriptor, at most 64 content reads and 128 ancestor components.
 * No content read happens until ancestors, leaf, descriptor, size and identity
 * have passed. Slow underlying IO cannot be forcibly stopped; checked afterward.
 */
export async function readSuppliedMigrationSnapshot(path:string,options:{signal?:AbortSignal;io?:MigrationReadIO}={}):Promise<{ok:true;snapshot:MigrationSnapshotV1}|{ok:false;code:MigrationCode}> {
  const io=options.io??nodeMigrationReadIO,start=performance.now();
  let handle:Awaited<ReturnType<MigrationReadIO['open']>>|undefined;
  const check=()=>{if(options.signal?.aborted)throw new ControllerFailure('CANCELLED');if(performance.now()-start>=5000)throw new ControllerFailure('TIME_LIMIT');};
  const stat=async(p:string):Promise<Stats>=>{check();const s=await io.lstat(p);check();return s;};
  try {
    check();if(!reference(path)||path.split('/').length>128||path.includes('\\')||path.split('/').includes('..'))throw new ControllerFailure('SNAPSHOT_DENIED');
    const full=isAbsolute(path)?path:resolve(path);
    if(resolve(full)!==full||full.length>4096||full.split('/').length>128)throw new ControllerFailure('SNAPSHOT_DENIED');
    const ancestors=await safeAncestors(dirname(full),stat),before=await stat(full);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw new ControllerFailure('SNAPSHOT_DENIED');
    if(!Number.isSafeInteger(before.size)||before.size<1||before.size>MAX_MIGRATION_SNAPSHOT_BYTES)throw new ControllerFailure('BYTE_LIMIT');
    handle=await io.open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);check();
    const opened=await handle.stat();if(!opened.isFile()||opened.nlink!==1||!sameFile(before,opened))throw new ControllerFailure('SNAPSHOT_CHANGED');
    await unchangedAncestors(ancestors,stat);check();
    const data=Buffer.alloc(before.size);let offset=0,reads=0;
    while(offset<data.length) {check();if(++reads>64)throw new ControllerFailure('READ_LIMIT');const r=await handle.read(data,offset,data.length-offset,offset);check();if(!Number.isInteger(r.bytesRead)||r.bytesRead<1||r.bytesRead>data.length-offset)throw new ControllerFailure('SNAPSHOT_CHANGED');offset+=r.bytesRead;}
    if(!sameFile(before,await handle.stat())||!sameFile(before,await stat(full)))throw new ControllerFailure('SNAPSHOT_CHANGED');
    await unchangedAncestors(ancestors,stat);check();
    let value:unknown;try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch {throw new ControllerFailure('SNAPSHOT_INVALID');}
    if(!publicSnapshot(value))throw new ControllerFailure('SNAPSHOT_INVALID');check();
    return {ok:true,snapshot:value as MigrationSnapshotV1};
  }catch(error) {
    const code=error instanceof ControllerFailure?error.code:(error as {code?:string})?.code;
    return {ok:false,code:member(MIGRATION_CODES,code)?code:code==='ROOT_DENIED'?'SNAPSHOT_DENIED':code==='ARTIFACT_CHANGED'?'SNAPSHOT_CHANGED':'SNAPSHOT_UNREADABLE'};
  }finally {await handle?.close().catch(()=>{});}
}
