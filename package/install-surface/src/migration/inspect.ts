import { assessMigrationCompatibility, validateMigrationSnapshot, type MigrationSnapshotV1, type MigrationExpectedContext, type MigrationFindingV1, type CompatibilityAssessment, type OrganEvidenceRef } from './contracts.ts';
import { DEFAULT_PROBE_LIMITS, ProbeFailure, type MigrationProbeAdapter, type ProbeBudget, type ProbeLimits, type ServiceMetadata } from './adapter.ts';
import { snapshotFindings, sortFindings } from './diff.ts';
export interface InspectRequest { expected_context?: MigrationExpectedContext; signal?: AbortSignal; limits?: Partial<ProbeLimits> }
export interface InspectionResult { snapshot?:MigrationSnapshotV1; findings:MigrationFindingV1[]; assessment?:CompatibilityAssessment; execution_authorized:false }
const unknownEvidence={discovered:'unknown',installed:'unknown',configured:'unknown',auth:'unknown',admission:'unknown',runtime:'unknown',verification:'unknown'} as const;
function unknownOrgan(o:OrganEvidenceRef):OrganEvidenceRef {
 const {verdict_attestation: _a, artifact_lineage:_b, ...rest}=o;
 return {...rest,independent_verdict:'unknown',freshness:'unknown',admission:'unknown',runtime:'unknown',verification:'unknown'};
}
const finding=(code:string,subject='migration'):MigrationFindingV1=>({code,subject,severity:'warning',message:'Observation held; independent evidence is required.'});
function validMetadata(value:unknown,base:MigrationSnapshotV1): value is ServiceMetadata {
 if (!value || typeof value!=='object' || Array.isArray(value)) return false;
 const m=value as ServiceMetadata;
 if(Object.keys(m).some(k=>!['evidence','versions'].includes(k)))return false;
 if(m.evidence!==undefined && (!m.evidence || typeof m.evidence!=='object' || Array.isArray(m.evidence)))return false;
 if(!validateMigrationSnapshot({...base,evidence:{...unknownEvidence,...m.evidence}}).ok)return false;
 return m.versions===undefined || (Array.isArray(m.versions)&&m.versions.length<=32&&m.versions.every(v=>v&&typeof v==='object'&&Object.keys(v).every(k=>['id','present','version','supported'].includes(k))&&typeof v.id==='string'&&/^[a-z][a-z0-9.-]{0,63}$/.test(v.id)&&['yes','no','unknown'].includes(v.present)&&['yes','no','unknown'].includes(v.supported)&&(v.version===undefined || (typeof v.version==='string'&&/^[0-9][a-zA-Z0-9.+-]{0,63}$/.test(v.version)))&&(v.present==='yes'||v.supported!=='yes')));
}
/** Bounded wall-clock wrapper also applies to adapters that ignore AbortSignal.
 * Abandoned injected promises cannot be forcibly terminated; adapters must be read-only.
 */
export async function inspect(adapter:MigrationProbeAdapter,request:InspectRequest={}):Promise<InspectionResult> {
 const findings:MigrationFindingV1[]=[]; const result:InspectionResult={findings,execution_authorized:false};
 if(!validateMigrationSnapshot(adapter.declaration).ok) { findings.push(finding('INVALID_DECLARATION')); return result; }
 const snapshot=structuredClone(adapter.declaration); snapshot.evidence={...unknownEvidence};
 snapshot.organs.operating=snapshot.organs.operating.map(unknownOrgan); snapshot.organs.cognitive=snapshot.organs.cognitive.map(unknownOrgan);
 const limits={...DEFAULT_PROBE_LIMITS,...request.limits};
 if(Object.keys(request.limits??{}).some(k=>!Object.hasOwn(DEFAULT_PROBE_LIMITS,k)) || Object.entries(limits).some(([k,v])=>!Number.isSafeInteger(v)||v<1||v>DEFAULT_PROBE_LIMITS[k as keyof ProbeLimits])) { findings.push(finding('INVALID_LIMITS'));return result; }
 const start=performance.now(); let reads=0,bytes=0;
 const budget:ProbeBudget={limits,signal:request.signal,check(){if(request.signal?.aborted)throw new ProbeFailure('CANCELLED');if(performance.now()-start>=limits.max_elapsed_ms)throw new ProbeFailure('TIME_LIMIT');},consumeRead(){this.check();if(++reads>limits.max_reads)throw new ProbeFailure('READ_LIMIT');},consumeBytes(n){this.check();if(!Number.isSafeInteger(n)||n<0||n>limits.max_total_bytes-bytes)throw new ProbeFailure('BYTE_LIMIT');bytes+=n;}};
 async function bounded<T>(fn:()=>Promise<T>):Promise<T> {
  budget.check(); let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:(()=>void)|undefined;
  try { return await Promise.race([Promise.resolve().then(()=>{budget.check();return fn();}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ProbeFailure('TIME_LIMIT')),Math.max(1,limits.max_elapsed_ms-(performance.now()-start)));abort=()=>reject(new ProbeFailure('CANCELLED'));request.signal?.addEventListener('abort',abort,{once:true});})]); }
  finally {clearTimeout(timer);if(abort)request.signal?.removeEventListener('abort',abort);}
 }
 const organs=[...snapshot.organs.operating,...snapshot.organs.cognitive];
 const knowledgePins=adapter.knowledge_sources??[];
 if(!Array.isArray(knowledgePins)||knowledgePins.length>128||knowledgePins.some(p=>!p||typeof p!=='object'||Object.keys(p).some(k=>!['ref_id','canonical_ref','source_digest'].includes(k))||typeof p.ref_id!=='string'||p.ref_id.length>256||typeof p.canonical_ref!=='string'||p.canonical_ref.length>256||typeof p.source_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(p.source_digest))) {findings.push(finding('INVALID_KNOWLEDGE_PINS'));return result;}
 let observationCalls=0, observationBytes=0;
 if(!Array.isArray(adapter.artifacts)||adapter.artifacts.length>32 || new Set(adapter.artifacts.map(a=>a.organ_id)).size!==adapter.artifacts.length || new Set(adapter.artifacts.map(a=>a.artifact_id)).size!==adapter.artifacts.length || adapter.artifacts.some(a=>!organs.some(o=>o.organ_id===a.organ_id)||typeof a.artifact_id!=='string'||!/^[a-z][a-z0-9:.-]{0,127}$/.test(a.artifact_id))) { findings.push(finding('INVALID_ARTIFACT_ALLOWLIST'));return result; }
 for(const d of adapter.artifacts) {
  const organ=organs.find(o=>o.organ_id===d.organ_id)!;
  try {
   if(++observationCalls>limits.max_reads)throw new ProbeFailure('READ_LIMIT');
   const observation=await bounded(()=>adapter.readArtifact(d.artifact_id,budget)); budget.check();
   const observedBytes=Buffer.byteLength(JSON.stringify(observation.value)??'');
   observationBytes+=observedBytes;
   if(observedBytes>limits.max_file_bytes||observationBytes>limits.max_total_bytes)throw new ProbeFailure('BYTE_LIMIT');
   const candidate=structuredClone(snapshot); const list=candidate.organs.operating.some(o=>o.organ_id===d.organ_id)?candidate.organs.operating:candidate.organs.cognitive;
   list[list.findIndex(o=>o.organ_id===d.organ_id)]=observation.value as OrganEvidenceRef;
   if(!observation.value || (observation.value as OrganEvidenceRef).organ_id!==d.organ_id || !validateMigrationSnapshot(candidate).ok) {findings.push(finding('INVALID_ORGAN_OBSERVATION',d.organ_id));continue;}
   for(const key of Object.keys(organ))delete (organ as unknown as Record<string,unknown>)[key];
   Object.assign(organ,structuredClone(observation.value));
  } catch(e) {findings.push(finding(e instanceof ProbeFailure?e.code:'ARTIFACT_UNREADABLE',d.organ_id));}
 }
 for(const o of organs)if(!adapter.artifacts.some(a=>a.organ_id===o.organ_id))findings.push(finding('OWNER_OBSERVATION_UNKNOWN',o.organ_id));
 if(adapter.metadata)try {const m=await bounded(()=>adapter.metadata!(request.signal));budget.check();if(!validMetadata(m,snapshot))findings.push(finding('INVALID_SERVICE_METADATA'));else {snapshot.evidence={...unknownEvidence,...m.evidence};for(const v of m.versions??[])if(v.present!=='yes'||v.supported!=='yes')findings.push(finding(v.present==='no'?'NATIVE_BINARY_MISSING':v.present==='yes'&&v.supported==='no'?'UNSUPPORTED_NATIVE_VERSION':'NATIVE_VERSION_UNKNOWN',v.id));}}catch(e){findings.push(finding(e instanceof ProbeFailure?e.code:'SERVICE_METADATA_UNKNOWN'));}
 for(const pin of knowledgePins) {
  const derived=snapshot.knowledge_refs.find(k=>k.ref_id===pin.ref_id&&k.kind==='derived');
  const canonical=snapshot.knowledge_refs.find(k=>k.ref_id===pin.canonical_ref&&k.kind==='canonical');
  if(!derived||!canonical||(derived.kind==='derived'&&derived.derived_from!==canonical.ref_id))findings.push(finding('KNOWLEDGE_LINK_UNRESOLVED'));
  else if(pin.source_digest!==canonical.source_digest)findings.push(finding('KNOWLEDGE_SOURCE_DRIFT',derived.ref_id));
 }
 if(!validateMigrationSnapshot(snapshot).ok){findings.push(finding('INVALID_SNAPSHOT'));return result;}
 result.snapshot=snapshot; result.assessment=assessMigrationCompatibility(snapshot,request.expected_context);
 findings.push(...snapshotFindings(snapshot));
 for(const code of result.assessment.holds)findings.push(finding(code));
 result.findings=sortFindings(findings);return result;
}
