import {expect,test} from "bun:test";
import {normalizeTrivectorEvidencePacket as normalize,fingerprintTrivectorEvidencePacket as fingerprint,trivectorEvidenceFreshness as freshness,TRIVECTOR_POLICY_DIGEST} from "../src/routing/trivector-contracts.ts";
const now=1791200000000,sha=`sha256:${"a".repeat(64)}`,iso=(n:number)=>new Date(n).toISOString();
const stamp=()=>({observed_at:iso(now-1000),expires_at:iso(now+1000),source_kind:"reviewed-observation",receipt_digest:sha,subject_fingerprint:sha});
function candidate(id="seat") {return {id,provider:"provider",model:"vendor/model",scope:"configured-combo-member",subject_fingerprint:sha,static_rank:1,gates:{...stamp(),activation:"observed-enabled",operator_authorization:"observed-allowed",entitlement:"observed-available",catalog:"resolved",capability:"structured-output-null",circuit:"closed"},fit:{...stamp(),score:0.9},quota:[{...stamp(),id:"hour",unit:"requests",state:"known",remaining:10,inflight:0,margin:1,estimated_units:1,blocking:true,resets_at:iso(now+60000)}],operational_outcomes:{...stamp(),scope:"configured-combo-member",outcome_kind:"transport",successes:10,failures:2,consecutive_failures:1,rate_limit_events:[iso(now-2000)],latency_ms:100},failure_domain:{...stamp(),id:null,provenance:"unknown"},limitations:[]};}
function fixture(){return {schema:"temperance.trivector-evidence-packet.v1",observed_at:iso(now),policy:{version:"trivector-v4.1.0",digest:TRIVECTOR_POLICY_DIGEST,min_providers:3,min_failure_domains:3,observation_max_age_ms:300000},request:{id:"request",task_class:"coding",arbitration:"v4.1",pinned_candidate_id:null},candidates:[candidate()]};}
test("closed packet detaches freezes and retains uncertainty without authority",()=>{
 const p=fixture(),n=normalize(p,now);expect(Object.isFrozen(n.candidates[0]!.gates)).toBe(true);expect(n.candidates[0]!.gates.capability).toBe("structured-output-null");p.candidates[0]!.fit.score=0;expect(n.candidates[0]!.fit.score).toBe(.9);expect(JSON.stringify(n)).not.toContain("execution_authorized");expect(JSON.stringify(n)).not.toContain("semantic_acceptance");
});
test("stale future and reset-expired observations remain visible",()=>{
 const p=fixture();p.candidates[0]!.quota[0]!.expires_at=iso(now-500);p.candidates[0]!.quota[0]!.resets_at=iso(now-500);
 const n=normalize(p,now);const q=n.candidates[0]!.quota[0]!;const {observed_at,expires_at,source_kind,receipt_digest,subject_fingerprint}=q;expect(freshness({observed_at,expires_at,source_kind,receipt_digest,subject_fingerprint},now,300000)).toBe("stale");
 p.candidates[0]!.gates.observed_at=iso(now+1);p.candidates[0]!.gates.expires_at=iso(now+1001);expect(normalize(p,now).candidates[0]!.gates.observed_at).toBe(iso(now+1));expect(freshness({...stamp(),observed_at:iso(now+1),expires_at:iso(now+1001)} as any,now,300000)).toBe("future");
});
test("candidate quota and limitation permutations fingerprint canonically",()=>{
 const p=fixture();p.candidates.push(candidate("A"));p.candidates[0]!.quota.push({...p.candidates[0]!.quota[0]!,id:"day"});const q=structuredClone(p);q.candidates.reverse();for(const c of q.candidates)c.quota.reverse();expect(fingerprint(p,now)).toBe(fingerprint(q,now));expect(normalize(p,now).candidates.map(c=>c.id)).toEqual(["A","seat"]);q.candidates[0]!.fit.score=.8;expect(fingerprint(q,now)).not.toBe(fingerprint(p,now));
});
test("policy subject scope pin and canonical dates bind exactly",()=>{
 for(const mutate of [(p:any)=>p.policy.digest=sha,(p:any)=>p.policy.version="other",(p:any)=>p.candidates[0].quota[0].subject_fingerprint=`sha256:${"b".repeat(64)}`,(p:any)=>p.candidates[0].operational_outcomes.scope="exact-seat",(p:any)=>p.request.pinned_candidate_id="missing",(p:any)=>p.observed_at="2026-10-05",(p:any)=>p.observed_at=iso(now+1)]){const p=fixture();mutate(p);expect(()=>normalize(p,now)).toThrow(/TRIVECTOR_PACKET_/);}
});
test("unknown private authority semantic and malformed outcome fields reject safely",()=>{
 for(const mutate of [(p:any)=>p.execution_authorized=true,(p:any)=>p.path="/private/secret",(p:any)=>p.candidates[0].connection_id="private",(p:any)=>p.candidates[0].operational_outcomes.semantic_successes=10,(p:any)=>p.candidates[0].operational_outcomes.outcome_kind="accepted",(p:any)=>p.candidates[0].operational_outcomes.consecutive_failures=3,(p:any)=>p.candidates[0].gates.capability=false,(p:any)=>p.policy.min_providers=Infinity,(p:any)=>p.candidates[0].model="../../secret",(p:any)=>p.candidates[0].quota[0].remaining=null,(p:any)=>p.candidates[0].failure_domain.id="unproved"]){const p=fixture();mutate(p);try{normalize(p,now);throw new Error("accepted");}catch(e){expect((e as Error).message).toMatch(/^TRIVECTOR_PACKET_/);expect((e as Error).message).not.toContain("secret");}}
});
test("proxies and getters invoke zero traps including nested arrays",()=>{
 let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error("private");},ownKeys(){traps++;throw Error("private");},getPrototypeOf(){traps++;throw Error("private");}});expect(()=>normalize(proxy,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");const p=fixture();(p as any).candidates=new Proxy([], {ownKeys(){traps++;throw Error("private");}});expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");const q=fixture();Object.defineProperty(q.candidates[0]!,"model",{enumerable:true,get(){traps++;throw Error("private");}});expect(()=>normalize(q,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");expect(traps).toBe(0);
});
test("bounds duplicates sparse arrays cycles and non-JSON classes reject",()=>{
 const p=fixture();p.candidates=Array.from({length:33},(_,i)=>candidate(`c${i}`));expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");p.candidates=[candidate(),candidate()];expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_INVALID");for(const bad of [new Date(),Object.create({private:true}),(()=>{const a:any={};a.self=a;return a;})()])expect(()=>normalize(bad,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");const q=fixture();q.candidates.length=2;expect(()=>normalize(q,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");const r=fixture();(r as any).private="a".repeat(65537);expect(()=>normalize(r,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");
});

test("freshness accepts normalized evidence payloads and canonical provider punctuation",()=>{
 const p=fixture();p.candidates[0]!.provider="provider.family_id";const n=normalize(p,now),c=n.candidates[0]!;for(const item of [c.gates,c.fit,c.quota[0]!,c.operational_outcomes,c.failure_domain])expect(freshness(item,now,300000)).toBe("fresh");
});

test("empty diagnostic candidates and multi-segment canonical models",()=>{
 const p=fixture();p.candidates=[];expect(Object.isFrozen(normalize(p,now).candidates)).toBe(true);(p.request as any).pinned_candidate_id="missing";expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_BINDING_MISMATCH");const q=fixture();q.candidates[0]!.model="nvidia/moonshotai/kimi-k2.6";expect(normalize(q,now).candidates[0]!.model).toBe(q.candidates[0]!.model);
});
test("serialized numeric syntax counts toward wire budget",()=>{
 const large={data:Array.from({length:6},()=>Array.from({length:32},()=>Array.from({length:32},()=>123456789012345.67)))};expect(()=>normalize(large,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");
});
test("optional legacy quota exact stamped fraction is bounded and subject-bound",()=>{
 const p=fixture();(p.candidates[0] as any).legacy_quota={...stamp(),remaining_fraction:.25};const n=normalize(p,now);expect(n.candidates[0]!.legacy_quota!.remaining_fraction).toBe(.25);expect(Object.isFrozen(n.candidates[0]!.legacy_quota)).toBe(true);
 for(const patch of [{remaining_fraction:1.1},{remaining_fraction:-.1},{subject_fingerprint:`sha256:${"b".repeat(64)}`},{private_path:"/private/context"}]){const q=structuredClone(p);Object.assign((q.candidates[0] as any).legacy_quota,patch);expect(()=>normalize(q,now)).toThrow(/TRIVECTOR_PACKET_/);}
 (p.candidates[0] as any).legacy_quota.remaining_fraction=null;expect(normalize(p,now).candidates[0]!.legacy_quota!.remaining_fraction).toBeNull();
 let calls=0;Object.defineProperty((p.candidates[0] as any).legacy_quota,"remaining_fraction",{enumerable:true,get(){calls++;return .5;}});expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_UNSAFE");expect(calls).toBe(0);
});

test("malformed optional-shape candidates use fixed safe errors",()=>{for(const value of [null,0,"seat",true,[]]){const p=fixture();(p as any).candidates=[value];expect(()=>normalize(p,now)).toThrow("TRIVECTOR_PACKET_INVALID");}});
