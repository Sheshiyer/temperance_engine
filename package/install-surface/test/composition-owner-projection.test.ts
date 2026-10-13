import {runCompositionCommand} from "../src/composition/cli.ts";
import {expect,test} from "bun:test";
import {inspectComposition} from "../src/composition/inspect.ts";
import {ownerCanonicalDigest,validateOwnerObservation,type OwnerObservationV1,OWNER_OUTCOMES} from "../src/composition/owner-observation.ts";
import {projectOwnerObservation} from "../src/composition/owner-projection.ts";
const now=1760000000000;
function fixture(){
 const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"test",owner:"operator",kind:"local"},coordinator:{surface:"codex-app",mode:"native"},integrations:[],modules:["projection.island","organ.nutrix","projection.banner"].map(id=>({id,owner:"operator",plant_id:"test",requires:[],configuration_refs:[]}))};
 const observations={schema:"temperance.composition-observations.v1",plant_id:"test",observed_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString(),modules:manifest.modules.map(m=>({id:m.id,state:"configured",configuration_refs:[]}))};
 const event={schema:"temperance.organ-lifecycle-event.v1",occurrence_id:"owner-occurrence",plant_id:"test",source_manifest_digest:inspectComposition(manifest).source_manifest_digest,occurred_at:new Date(now-100).toISOString(),kind:"session-end"};
 const owner:OwnerObservationV1={schema:"temperance.lifecycle-owner-observation.v1",source_kind:"contained-owner-process",plant_id:"test",occurrence_id:event.occurrence_id,source_manifest_digest:event.source_manifest_digest,event_digest:ownerCanonicalDigest(event),event_identity_digest:ownerCanonicalDigest({plant_id:event.plant_id,occurrence_id:event.occurrence_id}),organ_id:"organ.nutrix",observed_at:new Date(now).toISOString(),status:"process-completed",owner_outcome:"process_completed",owner_receipt_digest:`sha256:${"a".repeat(64)}`,semantic_acceptance:false,capacity_authorization:false,effect_authorized:false,execution_authorized:false};
 return {manifest,observations,event,owner};
}
test("owner projection proves presentation only and shares immutable targets",()=>{
 const f=fixture();const p=projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now);expect(p.schema).toBe("temperance.composition-owner-projection.v1");expect(p.source_kind).toBe("contained-owner-process");expect(p.owner.summary).toBe("Owner process completed; acceptance unproved");expect(p.targets.map(t=>t.id)).toEqual(["projection.banner","projection.island"]);expect(p.targets.every(t=>t.enabled)).toBe(true);expect(Object.isFrozen(p.targets[1]?.island_model)).toBe(true);for(const key of ["semantic_acceptance","capacity_authorization","effect_authorized","execution_authorized"] as const)expect(p[key]).toBe(false);expect(JSON.stringify(p)).not.toMatch(/Cambium|Superset|provider|advisory-completed|127\.0\.0\.1/i);expect(f.manifest.integrations).toEqual([]);
});
test("all outcomes require exact status and display fixed process labels",()=>{
 const f=fixture();for(const outcome of OWNER_OUTCOMES){const status=outcome==="process_completed"?"process-completed":outcome==="duplicate_process_completed"?"replay":outcome==="duplicate_pending"?"in-progress":"held";const owner={...f.owner,owner_outcome:outcome,status};expect(validateOwnerObservation(owner).status).toBe(status);expect(projectOwnerObservation(f.manifest,f.observations,f.event,owner,now).owner.summary).toContain("acceptance unproved");expect(()=>validateOwnerObservation({...owner,status:status==="held"?"process-completed":"held"})).toThrow("OWNER_OBSERVATION_INVALID_INPUT");}
});
test("lineage mismatches and undeclared organs rejected",()=>{
 const f=fixture();for(const patch of [{plant_id:"other"},{occurrence_id:"other"},{event_digest:`sha256:${"0".repeat(64)}`},{event_identity_digest:`sha256:${"0".repeat(64)}`},{source_manifest_digest:`sha256:${"0".repeat(64)}`},{organ_id:"organ.auspex"}])expect(()=>projectOwnerObservation(f.manifest,f.observations,f.event,{...f.owner,...patch},now)).toThrow("OWNER_OBSERVATION_LINEAGE_MISMATCH");expect(()=>projectOwnerObservation(f.manifest,f.observations,{...f.event,occurred_at:new Date(now-200).toISOString()},f.owner,now)).toThrow("OWNER_OBSERVATION_LINEAGE_MISMATCH");
});
test("timestamps reject future, pre-event and noncanonical dates",()=>{
 const f=fixture();for(const observed_at of [new Date(now+1).toISOString(),new Date(now-101).toISOString(),"2025-02-30T00:00:00.000Z",new Date(now).toISOString().replace(".000Z","Z")])expect(()=>projectOwnerObservation(f.manifest,f.observations,f.event,{...f.owner,observed_at},now)).toThrow("OWNER_OBSERVATION_INVALID_INPUT");expect(()=>projectOwnerObservation(f.manifest,f.observations,{...f.event,occurred_at:new Date(now+1).toISOString()},f.owner,now)).toThrow();
});
test("historical process observations remain visible stale without enabling",()=>{
 const f=fixture();const p=projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now+300001);expect(p.freshness).toBe("stale");expect(p.targets.length).toBe(2);expect(p.targets.every(t=>!t.enabled&&t.state==="unknown")).toBe(true);expect(p.targets[0]?.banner_text).toContain("acceptance unproved");
});
test("unknown held target states remain visible and undeclared target omitted",()=>{
 const f=fixture();expect(projectOwnerObservation(f.manifest,undefined,f.event,f.owner,now).targets.every(t=>t.state==="unknown"&&!t.enabled)).toBe(true);f.observations.modules.find(m=>m.id==="projection.banner")!.state="unavailable";expect(projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now).targets[0]?.state).toBe("held");
 f.manifest.modules=f.manifest.modules.filter(m=>m.id!=="projection.banner");f.observations.modules=f.observations.modules.filter(m=>m.id!=="projection.banner");f.event.source_manifest_digest=inspectComposition(f.manifest).source_manifest_digest;f.owner.source_manifest_digest=f.event.source_manifest_digest;f.owner.event_digest=ownerCanonicalDigest(f.event);expect(projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now).targets.map(t=>t.id)).toEqual(["projection.island"]);
});
test("permuted declarations yield deterministic digests and detached model",()=>{
 const f=fixture();const before=JSON.stringify(f);const a=projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now);expect(JSON.stringify(f)).toBe(before);f.manifest.modules.reverse();f.observations.modules.reverse();expect(projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now)).toEqual(a);expect(a.owner_observation_digest).toBe(ownerCanonicalDigest(f.owner));
});
test("private fields, authority changes, bounds and malformed shapes rejected",()=>{
 const f=fixture();for(const patch of [{path:"/private/owner"},{output:"private-secret"},{account:"user@example.com"},{semantic_acceptance:true},{capacity_authorization:true},{effect_authorized:true},{execution_authorized:true},{owner_receipt_digest:"private-value"},{occurrence_id:"x".repeat(65537)}])expect(()=>validateOwnerObservation({...f.owner,...patch})).toThrow("OWNER_OBSERVATION_INVALID_INPUT");const hidden={...f.owner};Object.defineProperty(hidden,"path",{value:"/private/path"});expect(()=>validateOwnerObservation(hidden)).toThrow();const inherited=Object.create(f.owner);expect(()=>validateOwnerObservation(inherited)).toThrow();expect(()=>validateOwnerObservation(Array(65).fill(f.owner))).toThrow();
});
test("proxy/getter validation invokes zero traps",()=>{
 const f=fixture();let traps=0;const proxied=new Proxy(f.owner,{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");},get(){traps++;throw new Error("private");}});expect(()=>validateOwnerObservation(proxied)).toThrow("OWNER_OBSERVATION_INVALID_INPUT");expect(traps).toBe(0);const getter={...f.owner};Object.defineProperty(getter,"owner_outcome",{enumerable:true,get(){traps++;throw new Error("private");}});expect(()=>validateOwnerObservation(getter)).toThrow("OWNER_OBSERVATION_INVALID_INPUT");expect(traps).toBe(0);const event=new Proxy(f.event,{getPrototypeOf(){traps++;throw new Error("private");}});expect(()=>projectOwnerObservation(f.manifest,f.observations,event,f.owner,now)).toThrow();expect(traps).toBe(0);
});

test("owner-project CLI preserves process semantics and rejects crossed packets",async()=>{
 const f=fixture();const packet={manifest:f.manifest,observations:f.observations,event:f.event,owner_observation:f.owner};
 const result=await runCompositionCommand(["owner-project"],()=>JSON.stringify(packet),now);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toEqual(projectOwnerObservation(f.manifest,f.observations,f.event,f.owner,now));
 for(const invalid of [{...packet,receipt:{}},{manifest:f.manifest,event:f.event},{...packet,owner_observation:{...f.owner,execution_authorized:true}}])expect((await runCompositionCommand(["owner-project"],()=>JSON.stringify(invalid),now)).code).toBe(2);
 const live=fixture();const instant=Date.now();live.event.occurred_at=new Date(instant-100).toISOString();live.owner.observed_at=new Date(instant).toISOString();live.owner.event_digest=ownerCanonicalDigest(live.event);
 const child=Bun.spawn([process.execPath,"src/cli.ts","composition","owner-project"],{cwd:process.cwd(),stdin:"pipe",stdout:"pipe",stderr:"pipe"});child.stdin.write(JSON.stringify({manifest:live.manifest,event:live.event,owner_observation:live.owner}));child.stdin.end();const output=await new Response(child.stdout).text();expect(await child.exited).toBe(0);expect(JSON.parse(output).owner.summary).toBe("Owner process completed; acceptance unproved");expect(JSON.parse(output).execution_authorized).toBe(false);
});
