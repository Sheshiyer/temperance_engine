import { assessMigrationCompatibility, validateMigrationSnapshot, validateMigrationTarget, type MigrationSnapshotV1, type MigrationTargetV1, type MigrationFindingV1, type MigrationExpectedContext, type CompatibilityAssessment } from './contracts.ts';
const finding=(code:string,subject='migration',severity:MigrationFindingV1['severity']='warning'):MigrationFindingV1=>({code,subject,severity,message:'Independent comparison only; the finding grants no execution authority.'});
export function sortFindings(values:MigrationFindingV1[]):MigrationFindingV1[] {
 const map=new Map(values.map(f=>[JSON.stringify(f),f]));
 return [...map.values()].sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:a.subject<b.subject?-1:a.subject>b.subject?1:0);
}
export function snapshotFindings(s:MigrationSnapshotV1):MigrationFindingV1[] {
 const f:MigrationFindingV1[]=[];
 const expected={discovered:'yes',installed:'yes',configured:'full',auth:'yes',admission:'admitted',runtime:'running',verification:'verified'};
 for(const [key,value] of Object.entries(s.evidence))if(value!==expected[key as keyof typeof expected])f.push(finding(key==='auth'?'AUTHENTICATION_PENDING':`${key.toUpperCase()}_${value==='unknown'?'UNKNOWN':'HELD'}`,'evidence'));
 for(const o of [...s.organs.operating,...s.organs.cognitive]) {
  if(o.freshness!=='fresh')f.push(finding(o.freshness==='unknown'?'FRESHNESS_UNKNOWN':'EVIDENCE_STALE',o.organ_id));
  if(o.independent_verdict!=='passed')f.push(finding('INDEPENDENT_VERDICT_HELD',o.organ_id));
  if(!o.artifact_lineage)f.push(finding('CONSUMPTION_UNKNOWN',o.organ_id));
  if(o.organ_id==='adytum')f.push(finding('ADYTUM_SOURCE_PARITY_HELD','adytum'));
 }
 for(const k of s.knowledge_refs) {
  if(k.freshness!=='fresh')f.push(finding(k.freshness==='unknown'?'KNOWLEDGE_FRESHNESS_UNKNOWN':'KNOWLEDGE_STALE',k.ref_id));
  if(k.kind==='derived'&&!s.knowledge_refs.some(c=>c.kind==='canonical'&&c.ref_id===k.derived_from))f.push(finding('KNOWLEDGE_LINK_UNRESOLVED',k.ref_id));
 }
 if(!s.capability_hit_modes)f.push(finding('CAPABILITY_HIT_UNKNOWN'));
 for(const m of s.capability_hit_modes?.modes??[])f.push(finding('CAPABILITY_HIT_DISABLED',m.mode_id));
 for(const h of s.held_requirements)f.push(finding('REQUIREMENT_HELD',h));
 return sortFindings(f);
}
export interface DiffResult { findings:MigrationFindingV1[]; assessment?:CompatibilityAssessment;execution_authorized:false }
function stable(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable((value as Record<string,unknown>)[k])}`).join(',')}}`;
 return JSON.stringify(value)??'undefined';
}
/** The schema permits repeated knowledge/toolchain IDs. Treat every repeated
 * identity as ambiguous before comparing members, including identical repeats.
 */
function identityAmbiguities(snapshot:MigrationSnapshotV1,side:'source'|'target'):MigrationFindingV1[] {
 const findings:MigrationFindingV1[]=[];
 const sets:[string,string[]][]=[['KNOWLEDGE',snapshot.knowledge_refs.map(k=>k.ref_id)],['TOOLCHAIN',snapshot.toolchain_requirements.map(t=>t.id)]];
 for(const [kind,ids] of sets) {
  const seen=new Set<string>(),duplicates=new Set<string>();
  for(const id of ids){if(seen.has(id))duplicates.add(id);seen.add(id);}
  for(const id of duplicates)findings.push(finding(`${kind}_IDENTITY_AMBIGUOUS`,`${side}:${id}`,'error'));
 }
 return sortFindings(findings);
}
/** Pure observations. Expected owner context must be supplied independently. */
export function diff(sourceValue:unknown,targetValue:unknown,expected?:MigrationExpectedContext):DiffResult {
 if(!validateMigrationSnapshot(sourceValue).ok)return {findings:[finding('INVALID_SOURCE')],execution_authorized:false};
 const source=sourceValue as MigrationSnapshotV1;
 const isSnapshot=validateMigrationSnapshot(targetValue).ok;
 if(!isSnapshot&&!validateMigrationTarget(targetValue))return {findings:[finding('INVALID_TARGET')],execution_authorized:false};
 const ambiguities=identityAmbiguities(source,'source');
 const f=[...snapshotFindings(source),...ambiguities];
 const targetHolds:string[]=[];
 const compare=(a:unknown,b:unknown,code:string,subject='migration')=>{if(stable(a)!==stable(b))f.push(finding(code,subject));};
 if(isSnapshot) {
  const target=targetValue as MigrationSnapshotV1;f.push(...snapshotFindings(target));
  const targetAmbiguities=identityAmbiguities(target,'target');ambiguities.push(...targetAmbiguities);f.push(...targetAmbiguities);
  compare(source.source_release_digest,target.source_release_digest,'SOURCE_RELEASE_CHANGED');compare(source.module_lock_digest,target.module_lock_digest,'MODULE_LOCK_CHANGED');compare(source.version,target.version,'SCHEMA_VERSION_CHANGED');compare(source.profile,target.profile,'PROFILE_CHANGED');
  function members<T>(before:T[],after:T[],id:(v:T)=>string,code:string) {
   // Keep complete per-ID sets; insertion order cannot conceal a substitution.
   function group(values:T[]) {const groups=new Map<string,string[]>();for(const value of values){const key=id(value);const entries=groups.get(key)??[];entries.push(stable(value));groups.set(key,entries);}for(const entries of groups.values())entries.sort();return groups;}
   const a=group(before),b=group(after);
   for(const key of new Set([...a.keys(),...b.keys()]))compare(a.get(key),b.get(key),code,key);
  }
  for(const m of source.logical_module_refs)if(!target.logical_module_refs.includes(m))f.push(finding('MODULE_REMOVED',m));
  for(const m of target.logical_module_refs)if(!source.logical_module_refs.includes(m))f.push(finding('MODULE_ADDED',m));
  members([...source.organs.operating,...source.organs.cognitive],[...target.organs.operating,...target.organs.cognitive],v=>v.organ_id,'ORGAN_CHANGED');
  members(source.work_objects,target.work_objects,v=>v.work_id,'WORK_BINDING_CHANGED');members(source.knowledge_refs,target.knowledge_refs,v=>v.ref_id,'KNOWLEDGE_CHANGED');members(source.toolchain_requirements,target.toolchain_requirements,v=>v.id,'TOOLCHAIN_CHANGED');
  compare(source.evidence,target.evidence,'EVIDENCE_CHANGED');compare(source.capability_hit_modes,target.capability_hit_modes,'CAPABILITY_HIT_CHANGED');compare(source.cell_effects,target.cell_effects,'CELL_EFFECT_CHANGED');compare(source.data_classifications,target.data_classifications,'DATA_CLASSIFICATION_CHANGED');compare(source.external_product_refs,target.external_product_refs,'EXTERNAL_PRODUCT_CHANGED');
 } else {
  const target=targetValue as MigrationTargetV1;f.push(finding('TARGET_CHECK_ONLY','migration','info'));
  targetHolds.push('DESTINATION_OBSERVATION_UNKNOWN');
  compare(source.profile,target.target_profile,'PROFILE_CHANGED');for(const m of target.requested_modules)if(!source.logical_module_refs.includes(m)){f.push(finding('MODULE_REQUIRED',m));targetHolds.push(`MODULE_REQUIRED:${m}`);}for(const h of target.held_requirements)f.push(finding('REQUIREMENT_HELD',h));
 }
 // A target declaration supplies requirements, never observed destination evidence.
 const assessment:CompatibilityAssessment=isSnapshot
  ? assessMigrationCompatibility(targetValue,expected)
  : {status:'nonauthoritative',structurally_valid:true,holds:targetHolds,observations:[],execution_authorized:false};
 if(ambiguities.length){if(assessment.status==='compatible')assessment.status='held';assessment.holds.push(...ambiguities.map(f=>`${f.code}:${f.subject}`));}
 assessment.holds=[...new Set(assessment.holds)].sort();
 for(const code of assessment.holds)f.push(finding(code));
 return {findings:sortFindings(f),assessment,execution_authorized:false};
}
