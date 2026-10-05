import {createHash} from "node:crypto";
import {types} from "node:util";
import {canonical} from "../canonical-json.ts";
import {TRIVECTOR_V41_POLICY} from "./trivector-math.ts";

/** Portable observations only. Owner gate statements are context, not grants.
 * Digests bind content, not authenticated origins. No selection or effects here.
 * Task class is contextual; this minimum packet has no phase/lane/effort binding. */
export const TRIVECTOR_POLICY_DIGEST = digest(TRIVECTOR_V41_POLICY);
export type CapabilityState = "compatible" | "resolved-incompatible" | "context-conflict" | "tool-conflict" | "modality-conflict" | "structured-output-null" | "unknown";
export interface EvidenceStamp {
  observed_at: string; expires_at: string;
  source_kind: "owner-observation" | "catalog-observation" | "quota-observation" | "operational-observation" | "reviewed-observation";
  receipt_digest: string; subject_fingerprint: string;
}
export interface TrivectorCandidate {
  id: string; provider: string; model: string;
  scope: "configured-combo-member" | "exact-seat";
  subject_fingerprint: string; static_rank: number;
  gates: EvidenceStamp & {
    activation: "observed-enabled" | "observed-disabled" | "unknown";
    operator_authorization: "observed-allowed" | "observed-denied" | "unknown";
    entitlement: "observed-available" | "observed-unavailable" | "unknown";
    catalog: "resolved" | "unresolved" | "unknown";
    capability: CapabilityState;
    circuit: "closed" | "open" | "unknown";
  };
  fit: EvidenceStamp & {score: number | null};
  quota: Array<EvidenceStamp & {
    id: string; unit: "requests" | "tokens" | "credits";
    state: "known" | "unknown"; remaining: number | null;
    inflight: number | null; margin: number | null; estimated_units: number | null;
    blocking: boolean; resets_at: string | null;
  }>;
  operational_outcomes: EvidenceStamp & {
    scope: "configured-combo-member" | "exact-seat";
    outcome_kind: "transport" | "process";
    successes: number; failures: number; consecutive_failures: number;
    rate_limit_events: string[]; latency_ms: number | null;
  };
  failure_domain: EvidenceStamp & {
    id: string | null; provenance: "reviewed" | "observed" | "unknown";
  };
  limitations: Array<EvidenceStamp & {
    id: string; task_class: string; position: "head" | "seat";
    reason: "rate-limit" | "capacity" | "capability" | "operational-failure";
  }>;
}
export interface TrivectorEvidencePacket {
  schema: "temperance.trivector-evidence-packet.v1";
  observed_at: string;
  policy: {version: "trivector-v4.1.0"; digest: string; min_providers: number; min_failure_domains: number; observation_max_age_ms: number};
  request: {id: string; task_class: string; arbitration: "legacy" | "v4.1"; pinned_candidate_id: string | null};
  candidates: TrivectorCandidate[];
}
export type TrivectorContractError = "TRIVECTOR_PACKET_UNSAFE" | "TRIVECTOR_PACKET_INVALID" | "TRIVECTOR_PACKET_BINDING_MISMATCH" | "TRIVECTOR_PACKET_POLICY_MISMATCH";
function fail(code: TrivectorContractError): never {throw new TypeError(code);}
function digest(value: unknown): string {return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;}
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const PROVIDER=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SHA=/^sha256:[a-f0-9]{64}$/;
const STAMP=["observed_at","expires_at","source_kind","receipt_digest","subject_fingerprint"];
const sources=["owner-observation","catalog-observation","quota-observation","operational-observation","reviewed-observation"];

// Copy descriptor values only after a zero-trap Proxy check. Reject symbols,
// accessors, inherited classes, sparse/custom arrays and resource-heavy inputs.
function snapshot(value: unknown): unknown {
  let nodes=0,bytes=0;const active=new Set<object>();
  function visit(v:unknown,depth:number):unknown {
    if(++nodes>10000||depth>12) fail("TRIVECTOR_PACKET_UNSAFE");
    if(typeof v==="string"){bytes+=Buffer.byteLength(v);if(bytes>65536)fail("TRIVECTOR_PACKET_UNSAFE");return v;}
    if(v===null||typeof v==="boolean"||typeof v==="number"&&Number.isFinite(v))return v;
    if(!v||typeof v!=="object"||types.isProxy(v))fail("TRIVECTOR_PACKET_UNSAFE");
    if(active.has(v))fail("TRIVECTOR_PACKET_UNSAFE");active.add(v);
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
    if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)fail("TRIVECTOR_PACKET_UNSAFE");
    const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
    if(keys.some(k=>typeof k!=="string"))fail("TRIVECTOR_PACKET_UNSAFE");
    for(const key of keys as string[]){const d=ds[key]!;if(!("value"in d)||(!d.enumerable&&!(array&&key==="length")))fail("TRIVECTOR_PACKET_UNSAFE");bytes+=Buffer.byteLength(key);}
    if(bytes>65536)fail("TRIVECTOR_PACKET_UNSAFE");
    let out:unknown;
    if(array){const n=ds.length?.value;if(!Number.isInteger(n)||n>32||n<0||keys.length!==n+1)fail("TRIVECTOR_PACKET_UNSAFE");const items=[];for(let i=0;i<n;i++){if(!Object.hasOwn(ds,String(i)))fail("TRIVECTOR_PACKET_UNSAFE");items.push(visit(ds[String(i)]!.value,depth+1));}out=items;}
    else {const obj:Record<string,unknown>=Object.create(null);for(const k of keys as string[])obj[k]=visit(ds[k]!.value,depth+1);out=obj;}
    active.delete(v);return out;
  }
  const detached=visit(value,0);if(Buffer.byteLength(JSON.stringify(detached))>65536)fail("TRIVECTOR_PACKET_UNSAFE");return detached;
}
type Obj=Record<string,any>;
function shape(v:unknown,keys:string[]):Obj {if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail("TRIVECTOR_PACKET_INVALID");return v as Obj;}
function member(v:unknown,values:readonly unknown[]):void {if(!values.includes(v))fail("TRIVECTOR_PACKET_INVALID");}
function str(v:unknown,re:RegExp,max=256):void {if(typeof v!=="string"||v.length>max||!re.test(v))fail("TRIVECTOR_PACKET_INVALID");}
function num(v:unknown,min:number,max:number,integer=false):void {if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max||integer&&!Number.isSafeInteger(v))fail("TRIVECTOR_PACKET_INVALID");}
function time(v:unknown):number {if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail("TRIVECTOR_PACKET_INVALID");return Date.parse(v);}
function stamp(o:Obj,subject:string):void {const observed=time(o.observed_at);if(time(o.expires_at)<=observed)fail("TRIVECTOR_PACKET_INVALID");member(o.source_kind,sources);str(o.receipt_digest,SHA);str(o.subject_fingerprint,SHA);if(o.subject_fingerprint!==subject)fail("TRIVECTOR_PACKET_BINDING_MISMATCH");}
function freeze<T>(v:T):T {if(v&&typeof v==="object"){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;}
function order(a:{id:string},b:{id:string}):number{return a.id<b.id?-1:a.id>b.id?1:0;}
function unique(items:{id:string}[]):void {if(new Set(items.map(i=>i.id)).size!==items.length)fail("TRIVECTOR_PACKET_INVALID");items.sort(order);}

/** Stale/future observations remain explicit data, never silently admissible. */
export function trivectorEvidenceFreshness(stampValue: EvidenceStamp, now: number, maxAgeMs: number): "fresh" | "stale" | "future" {
  num(now,0,8.64e15);num(maxAgeMs,1,86400000,true);
  const detached=snapshot(stampValue);if(!detached||typeof detached!=="object"||Array.isArray(detached))fail("TRIVECTOR_PACKET_INVALID");
  const input=detached as Obj;const s:Obj=Object.create(null);for(const key of STAMP){if(!Object.hasOwn(input,key))fail("TRIVECTOR_PACKET_INVALID");s[key]=input[key];}stamp(s,s.subject_fingerprint);
  const observed=time(s.observed_at);return observed>now?"future":now>=time(s.expires_at)||now-observed>maxAgeMs?"stale":"fresh";
}

export function normalizeTrivectorEvidencePacket(value: unknown, now: number): Readonly<TrivectorEvidencePacket> {
  num(now,0,8.64e15);
  const p=shape(snapshot(value),["schema","observed_at","policy","request","candidates"]);
  member(p.schema,["temperance.trivector-evidence-packet.v1"]);if(time(p.observed_at)>now)fail("TRIVECTOR_PACKET_INVALID");
  const policy=shape(p.policy,["version","digest","min_providers","min_failure_domains","observation_max_age_ms"]);
  if(policy.version!==TRIVECTOR_V41_POLICY.version||policy.digest!==TRIVECTOR_POLICY_DIGEST)fail("TRIVECTOR_PACKET_POLICY_MISMATCH");
  num(policy.min_providers,1,32,true);num(policy.min_failure_domains,1,32,true);num(policy.observation_max_age_ms,1,86400000,true);
  const r=shape(p.request,["id","task_class","arbitration","pinned_candidate_id"]);str(r.id,ID);str(r.task_class,ID);member(r.arbitration,["legacy","v4.1"]);if(r.pinned_candidate_id!==null)str(r.pinned_candidate_id,ID);
  if(!Array.isArray(p.candidates))fail("TRIVECTOR_PACKET_INVALID");
  for(const v of p.candidates){
    const c=shape(v,["id","provider","model","scope","subject_fingerprint","static_rank","gates","fit","quota","operational_outcomes","failure_domain","limitations"]);
    str(c.id,ID);str(c.provider,PROVIDER);str(c.model,MODEL);member(c.scope,["configured-combo-member","exact-seat"]);str(c.subject_fingerprint,SHA);num(c.static_rank,0,1000000,true);
    const g=shape(c.gates,[...STAMP,"activation","operator_authorization","entitlement","catalog","capability","circuit"]);stamp(g,c.subject_fingerprint);
    member(g.activation,["observed-enabled","observed-disabled","unknown"]);member(g.operator_authorization,["observed-allowed","observed-denied","unknown"]);member(g.entitlement,["observed-available","observed-unavailable","unknown"]);member(g.catalog,["resolved","unresolved","unknown"]);member(g.capability,["compatible","resolved-incompatible","context-conflict","tool-conflict","modality-conflict","structured-output-null","unknown"]);member(g.circuit,["closed","open","unknown"]);
    const f=shape(c.fit,[...STAMP,"score"]);stamp(f,c.subject_fingerprint);if(f.score!==null)num(f.score,0,1);
    if(!Array.isArray(c.quota)||!Array.isArray(c.limitations))fail("TRIVECTOR_PACKET_INVALID");
    for(const v of c.quota){const q=shape(v,[...STAMP,"id","unit","state","remaining","inflight","margin","estimated_units","blocking","resets_at"]);stamp(q,c.subject_fingerprint);str(q.id,ID);member(q.unit,["requests","tokens","credits"]);member(q.state,["known","unknown"]);if(typeof q.blocking!=="boolean")fail("TRIVECTOR_PACKET_INVALID");for(const k of ["remaining","inflight","margin","estimated_units"]){if(q[k]!==null)num(q[k],k==="remaining"?-1e12:0,1e12);}
      if(q.state==="known"&&(q.remaining===null||q.inflight===null||q.margin===null||q.estimated_units===null||q.estimated_units<=0)||q.state==="unknown"&&[q.remaining,q.inflight,q.margin,q.estimated_units].some(v=>v!==null))fail("TRIVECTOR_PACKET_INVALID");if(q.resets_at!==null&&time(q.resets_at)<=time(q.observed_at))fail("TRIVECTOR_PACKET_INVALID");}
    unique(c.quota);
    const o=shape(c.operational_outcomes,[...STAMP,"scope","outcome_kind","successes","failures","consecutive_failures","rate_limit_events","latency_ms"]);stamp(o,c.subject_fingerprint);member(o.scope,["configured-combo-member","exact-seat"]);if(o.scope!==c.scope)fail("TRIVECTOR_PACKET_BINDING_MISMATCH");member(o.outcome_kind,["transport","process"]);for(const k of ["successes","failures","consecutive_failures"])num(o[k],0,1e9,true);if(o.consecutive_failures>o.failures)fail("TRIVECTOR_PACKET_INVALID");if(o.latency_ms!==null)num(o.latency_ms,0,86400000);if(!Array.isArray(o.rate_limit_events))fail("TRIVECTOR_PACKET_INVALID");for(const t of o.rate_limit_events)if(time(t)>time(o.observed_at))fail("TRIVECTOR_PACKET_INVALID");o.rate_limit_events.sort();if(new Set(o.rate_limit_events).size!==o.rate_limit_events.length)fail("TRIVECTOR_PACKET_INVALID");
    const d=shape(c.failure_domain,[...STAMP,"id","provenance"]);stamp(d,c.subject_fingerprint);member(d.provenance,["reviewed","observed","unknown"]);if(d.id!==null)str(d.id,ID);if((d.provenance==="unknown")!==(d.id===null))fail("TRIVECTOR_PACKET_INVALID");
    for(const v of c.limitations){const l=shape(v,[...STAMP,"id","task_class","position","reason"]);stamp(l,c.subject_fingerprint);str(l.id,ID);str(l.task_class,ID);member(l.position,["head","seat"]);member(l.reason,["rate-limit","capacity","capability","operational-failure"]);}
    unique(c.limitations);
  }
  unique(p.candidates);if(r.pinned_candidate_id!==null&&!p.candidates.some((c:Obj)=>c.id===r.pinned_candidate_id))fail("TRIVECTOR_PACKET_BINDING_MISMATCH");
  return freeze(p) as Readonly<TrivectorEvidencePacket>;
}
/** Fingerprint exactly the normalized evidence, including uncertainty and stale facts. */
export function fingerprintTrivectorEvidencePacket(value: unknown, now: number): string {return digest(normalizeTrivectorEvidencePacket(value,now));}
