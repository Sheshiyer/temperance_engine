import {createHash} from "node:crypto";
import {canonical} from "../canonical-json.ts";
import {normalizeTrivectorEvidencePacket, trivectorEvidenceFreshness, type EvidenceStamp, type TrivectorCandidate} from "./trivector-contracts.ts";
import {TRIVECTOR_V41_POLICY,FIT_EQUIVALENCE_TOLERANCE,fitBucket,effectiveHeadroom,decayedHazard,hazardAdjustedHeadroom,g9GateV41,arbitrateFitBucket} from "./trivector-math.ts";

// Extracted unchanged from router/seat-weights.json + isCatastrophicReliability.
// Packet operational failures include timeouts; both modes exclude 429 events.
export const TRIVECTOR_LEGACY_G9_POLICY=Object.freeze({version:"trivector-legacy-g9.v1",sample_min:5,consecutive_failures_min:5});
export const TRIVECTOR_SELECTION_POLICY=Object.freeze({schema:"temperance.trivector-selection-policy.v1",legacy_g9:TRIVECTOR_LEGACY_G9_POLICY,v41:TRIVECTOR_V41_POLICY,legacy_quota_signal:"fresh-remaining-fraction",v41_quota_signal:"fresh-window-request-headroom",v41_only_window_exhaustion_gate:true,half_open_circuit:"context-proposal-requires-owner-probe",fit_equivalence_tolerance:FIT_EQUIVALENCE_TOLERANCE});
const digest=(v:unknown)=>`sha256:${createHash("sha256").update(canonical(v)).digest("hex")}`;
export const TRIVECTOR_SELECTION_POLICY_DIGEST=digest(TRIVECTOR_SELECTION_POLICY);
export type TrivectorSelectionReason="GATES_STALE"|"GATES_FUTURE"|"ACTIVATION_UNAVAILABLE"|"OPERATOR_AUTHORIZATION_UNAVAILABLE"|"ENTITLEMENT_UNAVAILABLE"|"CATALOG_UNAVAILABLE"|"CIRCUIT_UNAVAILABLE"|"CAPABILITY_INCOMPATIBLE"|"FIT_UNAVAILABLE"|"QUOTA_EXHAUSTED"|"OPERATIONAL_G9"|"PROVIDER_FLOOR_UNMET"|"FAILURE_DOMAIN_FLOOR_UNMET"|"NO_SURVIVORS"|"LIMITATION_ACTIVE";
export type TrivectorSelectionFlag="CAPABILITY_UNCERTAIN"|"QUOTA_STALE"|"QUOTA_FUTURE"|"QUOTA_UNKNOWN"|"QUOTA_RESET_EXPIRED"|"OUTCOMES_STALE"|"OUTCOMES_FUTURE"|"DOMAIN_UNPROVEN"|"COARSE_SCOPE"|"LIMITATION_STALE"|"LIMITATION_FUTURE"|"CIRCUIT_PROBE_REQUIRED";
export interface TrivectorCandidateDiagnostic {id:string;scope:TrivectorCandidate["scope"];state:"context-survivor"|"held";reasons:TrivectorSelectionReason[];flags:TrivectorSelectionFlag[];fit:number|null;quota_headroom:number|null;quota_signal_kind:"legacy-fraction"|"v41-window-headroom";operational_g9:boolean;hazard:number|null;}
export interface TrivectorSelectionDecision {
 schema:"temperance.trivector-selection-decision.v1";state:"proposed"|"held";observed_at:string;
 request_id:string;proposed_head:string|null;head_scope:TrivectorCandidate["scope"]|null;
 arbiter:"pin"|"quota_headroom"|"latency"|"static_rank"|null;
 reasons:TrivectorSelectionReason[];candidates:TrivectorCandidateDiagnostic[];
 diversity:{providers:number;proven_failure_domains:number;required_providers:number;required_failure_domains:number};
 policy_digest:string;packet_digest:string;consumed_evidence_digest:string;
 execution_authorized:false;capacity_authorization:false;lease_authorized:false;effect_authorized:false;semantic_acceptance:null;
}
function freeze<T>(v:T):T{if(v&&typeof v==="object"){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
const sorted=<T extends string>(v:T[]):T[]=>[...new Set(v)].sort();
/** Pure proposal only. Observation labels and digests do not authenticate owners. */
export function selectTrivectorCandidate(input:unknown,now:number):Readonly<TrivectorSelectionDecision>{
 const packet=normalizeTrivectorEvidencePacket(input,now),maxAge=packet.policy.observation_max_age_ms;
 const fresh=(s:EvidenceStamp)=>trivectorEvidenceFreshness(s,now,maxAge);
 const diagnostics:TrivectorCandidateDiagnostic[]=[],survivors:TrivectorCandidate[]=[];
 const signals=new Map<string,{quota:number|null;latency:number|null}>();
 for(const c of packet.candidates){
  const reasons:TrivectorSelectionReason[]=[],flags:TrivectorSelectionFlag[]=[];
  const gs=fresh(c.gates);if(gs!=="fresh")reasons.push(gs==="future"?"GATES_FUTURE":"GATES_STALE");
  if(c.gates.activation!=="observed-enabled")reasons.push("ACTIVATION_UNAVAILABLE");
  if(c.gates.operator_authorization!=="observed-allowed")reasons.push("OPERATOR_AUTHORIZATION_UNAVAILABLE");
  if(c.gates.entitlement!=="observed-available")reasons.push("ENTITLEMENT_UNAVAILABLE");
  if(c.gates.catalog!=="resolved")reasons.push("CATALOG_UNAVAILABLE");
  if(c.gates.circuit!=="closed"&&c.gates.circuit!=="half-open")reasons.push("CIRCUIT_UNAVAILABLE");
  // A proposal cannot reserve the owning circuit probe or grant probe eligibility.
  if(c.gates.circuit==="half-open")flags.push("CIRCUIT_PROBE_REQUIRED");
  if(c.gates.capability==="resolved-incompatible")reasons.push("CAPABILITY_INCOMPATIBLE");else if(c.gates.capability!=="compatible")flags.push("CAPABILITY_UNCERTAIN");
  // This is a head-only proposal, not fallback-seat admission. Both head and
  // seat limitations remove the candidate from this proposed head set.
  for(const limitation of c.limitations){
   if(limitation.task_class!==packet.request.task_class)continue;
   const ls=fresh(limitation);if(ls==="fresh")reasons.push("LIMITATION_ACTIVE");else flags.push(ls==="future"?"LIMITATION_FUTURE":"LIMITATION_STALE");
  }
  const fit=fresh(c.fit)==="fresh"?c.fit.score:null;if(fit===null)reasons.push("FIT_UNAVAILABLE");
  const quotaWindows=[];if(packet.request.arbitration==="v4.1"&&c.quota.length===0)flags.push("QUOTA_UNKNOWN");
  for(const q of packet.request.arbitration==="v4.1"?c.quota:[]){
   const qs=fresh(q),reset=q.resets_at!==null&&Date.parse(q.resets_at)<=now;
   if(qs!=="fresh")flags.push(qs==="future"?"QUOTA_FUTURE":"QUOTA_STALE");
   if(q.state==="unknown")flags.push("QUOTA_UNKNOWN");if(reset)flags.push("QUOTA_RESET_EXPIRED");
   if(qs!=="fresh"||q.state!=="known"||reset){continue;}
   // Normalize each unit/window by its own estimated request cost; units never mix.
   const free=(q.remaining!-q.inflight!-q.margin!)/q.estimated_units!;
   quotaWindows.push({window:q.id,remaining:free,inflight:0,margin:0,blocking:q.blocking});
   if(packet.request.arbitration==="v4.1"&&q.blocking&&q.remaining!<=0)reasons.push("QUOTA_EXHAUSTED");
  }
  // Legacy obs.quota_remaining is already a fraction, not window arithmetic.
  // Missing fractions stay unknown; a zero fraction narrows rather than gates.
  let legacyFraction:number|null=null;
  if(packet.request.arbitration==="legacy"){
   if(!c.legacy_quota||c.legacy_quota.remaining_fraction===null)flags.push("QUOTA_UNKNOWN");
   if(c.legacy_quota){const ls=fresh(c.legacy_quota);if(ls==="fresh")legacyFraction=c.legacy_quota.remaining_fraction;else flags.push(ls==="future"?"QUOTA_FUTURE":"QUOTA_STALE");}
  }
  const qs=packet.request.arbitration==="legacy"?legacyFraction:quotaWindows.length?effectiveHeadroom(quotaWindows,now).normalized:null;
  const os=fresh(c.operational_outcomes);if(os!=="fresh")flags.push(os==="future"?"OUTCOMES_FUTURE":"OUTCOMES_STALE");
  const o=c.operational_outcomes;
  const g9=os==="fresh"&&(packet.request.arbitration==="v4.1"?g9GateV41({successes:o.successes,failures:o.failures,consecutiveFailures:o.consecutive_failures}).acts:o.successes+o.failures>=TRIVECTOR_LEGACY_G9_POLICY.sample_min&&o.consecutive_failures>=TRIVECTOR_LEGACY_G9_POLICY.consecutive_failures_min);
  if(g9)reasons.push("OPERATIONAL_G9");
  const hazard=os==="fresh"?decayedHazard(o.rate_limit_events.map(Date.parse),now):null;
  const adjusted=qs!==null&&hazard!==null&&packet.request.arbitration==="v4.1"?hazardAdjustedHeadroom(qs,hazard):qs;
  if(c.failure_domain.provenance==="unknown"||fresh(c.failure_domain)!=="fresh")flags.push("DOMAIN_UNPROVEN");
  if(c.scope!=="exact-seat")flags.push("COARSE_SCOPE");
  diagnostics.push({id:c.id,scope:c.scope,state:reasons.length?"held":"context-survivor",reasons:sorted(reasons),flags:sorted(flags),fit,quota_headroom:adjusted,quota_signal_kind:packet.request.arbitration==="legacy"?"legacy-fraction":"v41-window-headroom",operational_g9:g9,hazard});
  if(!reasons.length){survivors.push(c);signals.set(c.id,{quota:adjusted,latency:os==="fresh"?o.latency_ms:null});}
 }
 const providers=new Set(survivors.map(c=>c.provider)).size;
 const domains=new Set(survivors.filter(c=>c.failure_domain.provenance!=="unknown"&&fresh(c.failure_domain)==="fresh").map(c=>c.failure_domain.id)).size;
 const reasons:TrivectorSelectionReason[]=[];if(providers<packet.policy.min_providers)reasons.push("PROVIDER_FLOOR_UNMET");if(domains<packet.policy.min_failure_domains)reasons.push("FAILURE_DOMAIN_FLOOR_UNMET");if(!survivors.length)reasons.push("NO_SURVIVORS");
 const bucket=fitBucket(survivors,c=>c.fit.score!).bucket;
 const compare=(a:TrivectorCandidate,b:TrivectorCandidate)=>a.static_rank-b.static_rank||(a.id<b.id?-1:a.id>b.id?1:0);
 const arbitration=arbitrateFitBucket(bucket,{quotaHeadroom:c=>signals.get(c.id)!.quota,latencyMs:c=>signals.get(c.id)!.latency,compareStatic:compare});
 const pin=bucket.find(c=>c.id===packet.request.pinned_candidate_id);
 const head=reasons.length?null:pin??arbitration.head;
 const packetDigest=digest(packet);
 return freeze({schema:"temperance.trivector-selection-decision.v1",state:head?"proposed":"held",observed_at:new Date(now).toISOString(),request_id:packet.request.id,proposed_head:head?.id??null,head_scope:head?.scope??null,arbiter:head?(pin?"pin":arbitration.arbiter):null,reasons:sorted(reasons),candidates:diagnostics,diversity:{providers,proven_failure_domains:domains,required_providers:packet.policy.min_providers,required_failure_domains:packet.policy.min_failure_domains},policy_digest:TRIVECTOR_SELECTION_POLICY_DIGEST,packet_digest:packetDigest,consumed_evidence_digest:digest({packet,now,policy:TRIVECTOR_SELECTION_POLICY}),execution_authorized:false,capacity_authorization:false,lease_authorized:false,effect_authorized:false,semantic_acceptance:null}) as Readonly<TrivectorSelectionDecision>;
}
