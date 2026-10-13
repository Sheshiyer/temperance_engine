import {createHash} from "node:crypto";
import {types} from "node:util";
import {isAbsolute,normalize,relative} from "node:path";
import {canonical} from "../canonical-json.ts";
import {validateGitProjectEvidence,type GitProjectEvidence,type GitWorktreeEntry} from "../onboarding/git-project-admission.ts";
import {validateGitPhaseLane,type GitPhase} from "./git-authority-contracts.ts";
export interface GitHandsTask {id:string;phase:GitPhase;lane:string;effort_tier:number;source_fingerprint:string;isa_criteria_hash:string}
export interface GitHandsPrivateContext {
 context:{context_id:string;run_id:string;project_id:string;observed_at:string};
 workspace:{primary_root:string;execution_root:string;common_dir:string;branch:string|null;observed_at:string;inventory:GitWorktreeEntry[]};
 source:{commit:string;dirty_fingerprint:string;reviewed_fingerprint:string};
 isa:{path:string;criteria_hash:string;observed_criteria_hash:string};
 tasks:GitHandsTask[];
 lease:{lease_id:string;run_id:string;task_ids:string[];issued_at:string;expires_at:string;seat_fingerprint:string};
}
export interface GitHandsEnvelopeV1 extends GitHandsPrivateContext {
 schema:"temperance.hands-git-envelope.v1";mode:"private-context-only";
 execution_authorized:false;capacity_authorization:false;lease_authorized:false;
 evidence:GitProjectEvidence;primary_evidence:GitProjectEvidence;evidence_fingerprint:string;primary_evidence_fingerprint:string;envelope_fingerprint:string;
}
function invalid():never{throw new Error("GIT_HANDS_ENVELOPE_INVALID_INPUT");}
function mismatch():never{throw new Error("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");}
const digest=(value:unknown)=>`sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
function safe(v:unknown,depth=0,count={n:0}):void{
 if(++count.n>8192||depth>16)invalid();if(v===null||typeof v==="boolean"||typeof v==="number"&&Number.isSafeInteger(v))return;
 if(typeof v==="string"){if(v.length>4096)invalid();return;}if(typeof v!=="object"||types.isProxy(v))invalid();
 const a=Array.isArray(v);if(Object.getPrototypeOf(v)!==(a?Array.prototype:Object.prototype))invalid();const keys=Reflect.ownKeys(v);if(keys.length>(a?513:32)||keys.some(k=>typeof k!=="string"))invalid();
 if(a&& (v.length>512||keys.length!==v.length+1))invalid();
 for(const key of keys){if(a&&key==="length")continue;if(typeof key!=="string"||["__proto__","constructor","prototype"].includes(key))invalid();const d=Object.getOwnPropertyDescriptor(v,key)!;if(!d.enumerable||d.get||d.set)invalid();safe(d.value,depth+1,count);}
}
function exact(v:unknown,keys:string[]):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))invalid();if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))invalid();return v as Record<string,unknown>;}
function id(v:unknown):void{if(typeof v!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v))invalid();}
function hash(v:unknown):void{if(typeof v!=="string"||!/^sha256:[a-f0-9]{64}$/.test(v))invalid();}
function path(v:unknown):asserts v is string{if(typeof v!=="string"||v.length<2||!isAbsolute(v)||normalize(v)!==v||/[\x00-\x1f]/.test(v))invalid();}
function date(v:unknown):number{if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))invalid();const t=Date.parse(v);if(!Number.isFinite(t)||new Date(t).toISOString()!==v)invalid();return t;}
function fresh(t:number,now:number):void{if(t>now||now-t>300000)throw new Error("GIT_HANDS_ENVELOPE_STALE_CONTEXT");}
function freeze<T>(v:T):Readonly<T>{if(v&&typeof v==="object"){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
/** Pure private context binding. Caller-reviewed dirty/ISA fingerprints and trusted observations
 * are not authenticated. Serialized shape cannot grant a lease, claim, capacity or execution.
 * Canonical paths must be freshly resolved by the caller's trusted private probe.
 */
export function buildGitHandsEnvelope(input:unknown,now:number):Readonly<GitHandsEnvelopeV1>{
 safe(input);if(Buffer.byteLength(JSON.stringify(input))>65536||!Number.isSafeInteger(now)||now<0||now>8640000000000000)invalid();
 const value=structuredClone(exact(input,["evidence","primary_evidence","context","workspace","source","isa","tasks","lease"]));
 if(!validateGitProjectEvidence(value.evidence)||value.evidence.state!=="verified"||value.evidence.mode!=="write"||value.evidence.capsule_access!=="read-write")invalid();
 const evidence=value.evidence;fresh(evidence.observed_at,now);const fp=evidence.fingerprints!;
 if(!validateGitProjectEvidence(value.primary_evidence)||value.primary_evidence.state!=="verified"||value.primary_evidence.mode!=="write"||value.primary_evidence.capsule_access!=="read-write"||value.primary_evidence.linked_worktree!==false)invalid();
 const primaryEvidence=value.primary_evidence;fresh(primaryEvidence.observed_at,now);const primaryFp=primaryEvidence.fingerprints!;
 if(primaryEvidence.project_id!==evidence.project_id||primaryEvidence.repository_identity!==evidence.repository_identity||primaryFp.capsule!==fp.capsule||primaryFp.host_binding!==fp.host_binding||primaryFp.common_dir!==fp.common_dir||primaryFp.inventory!==fp.inventory)mismatch();
 const context=exact(value.context,["context_id","run_id","project_id","observed_at"]);for(const k of ["context_id","run_id","project_id"])id(context[k]);fresh(date(context.observed_at),now);if(context.project_id!==evidence.project_id)mismatch();
 const workspace=exact(value.workspace,["primary_root","execution_root","common_dir","branch","observed_at","inventory"]);for(const k of ["primary_root","execution_root","common_dir"])path(workspace[k]);fresh(date(workspace.observed_at),now);if(date(workspace.observed_at)<Math.max(evidence.observed_at,primaryEvidence.observed_at))mismatch();
 if(workspace.branch!==null&&(typeof workspace.branch!=="string"||!workspace.branch||workspace.branch.length>512||/[\x00-\x1f]/.test(workspace.branch)))invalid();
 if(!Array.isArray(workspace.inventory)||workspace.inventory.length===0||workspace.inventory.length>512)invalid();
 for(const raw of workspace.inventory){const entry=exact(raw,["path","head","branch","prunable","locked","valid"]);path(entry.path);if(typeof entry.head!=="string"||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.head)||entry.branch!==null&&(typeof entry.branch!=="string"||!entry.branch||entry.branch.length>512||/[\x00-\x1f]/.test(entry.branch))||typeof entry.prunable!=="boolean"||typeof entry.locked!=="boolean"||typeof entry.valid!=="boolean")invalid();}
 const inventory=workspace.inventory as GitWorktreeEntry[];inventory.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);if(new Set(inventory.map(e=>e.path)).size!==inventory.length)invalid();
 const selected=inventory.find(e=>e.path===workspace.execution_root),primary=inventory.find(e=>e.path===workspace.primary_root);
 if(!selected||!primary||[selected,primary].some(e=>!e.valid||e.prunable||e.locked)||primary.head!==primaryEvidence.head||digest(workspace.primary_root)!==primaryFp.root||digest(primary.branch)!==primaryFp.branch||selected.head!==evidence.head||selected.branch!==workspace.branch||digest(workspace.execution_root)!==fp.root||digest(workspace.common_dir)!==fp.common_dir||digest(workspace.branch)!==fp.branch||digest(inventory)!==fp.inventory||evidence.linked_worktree!==(workspace.primary_root!==workspace.execution_root))mismatch();
 const source=exact(value.source,["commit","dirty_fingerprint","reviewed_fingerprint"]);hash(source.dirty_fingerprint);hash(source.reviewed_fingerprint);if(source.commit!==evidence.head||source.dirty_fingerprint!==source.reviewed_fingerprint)mismatch();
 const isa=exact(value.isa,["path","criteria_hash","observed_criteria_hash"]);path(isa.path);hash(isa.criteria_hash);hash(isa.observed_criteria_hash);const child=relative(workspace.execution_root as string,isa.path);if(!child||child.startsWith("..")||isAbsolute(child)||isa.criteria_hash!==isa.observed_criteria_hash)mismatch();
 if(!Array.isArray(value.tasks)||!value.tasks.length||value.tasks.length>32)invalid();
 for(const raw of value.tasks){const task=exact(raw,["id","phase","lane","effort_tier","source_fingerprint","isa_criteria_hash"]);id(task.id);hash(task.source_fingerprint);hash(task.isa_criteria_hash);if(!Number.isSafeInteger(task.effort_tier)||!validateGitPhaseLane(task.phase,task.lane,`E${task.effort_tier}`))invalid();if(task.source_fingerprint!==source.reviewed_fingerprint||task.isa_criteria_hash!==isa.criteria_hash)mismatch();
 }
 const tasks=value.tasks as GitHandsTask[];tasks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(new Set(tasks.map(t=>t.id)).size!==tasks.length)invalid();
 const lease=exact(value.lease,["lease_id","run_id","task_ids","issued_at","expires_at","seat_fingerprint"]);id(lease.lease_id);id(lease.run_id);hash(lease.seat_fingerprint);const issued=date(lease.issued_at),expires=date(lease.expires_at);if(issued>now||expires<=now||expires<=issued||expires-issued>300000)throw new Error("GIT_HANDS_ENVELOPE_LEASE_INVALID");
 if(!Array.isArray(lease.task_ids)||lease.task_ids.length>32)invalid();for(const task of lease.task_ids)id(task);lease.task_ids.sort((a,b)=>a<b?-1:a>b?1:0);if(new Set(lease.task_ids).size!==lease.task_ids.length||canonical(lease.task_ids)!==canonical(tasks.map(t=>t.id))||lease.run_id!==context.run_id)mismatch();
 const payload={schema:"temperance.hands-git-envelope.v1" as const,mode:"private-context-only" as const,execution_authorized:false as const,capacity_authorization:false as const,lease_authorized:false as const,...value,evidence_fingerprint:digest(evidence),primary_evidence_fingerprint:digest(primaryEvidence)};
 return freeze({...payload,envelope_fingerprint:digest(payload)} as unknown as GitHandsEnvelopeV1);
}
