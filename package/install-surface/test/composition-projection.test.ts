import {expect,test} from "bun:test";
import {inspectComposition} from "../src/composition/inspect.ts";
import {runOrganLifecycle,type OrganLifecycleReceiptV1} from "../src/composition/lifecycle.ts";
import {projectComposition} from "../src/composition/projection.ts";
const now=1760000000000;
async function fixture(){
 const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"test",owner:"operator",kind:"local"},coordinator:{surface:"codex-app",mode:"native"},integrations:[],modules:["projection.banner","projection.island","organ.nutrix"].map(id=>({id,owner:"operator",plant_id:"test",requires:[],configuration_refs:[]}))};
 const observations={schema:"temperance.composition-observations.v1",plant_id:"test",observed_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString(),modules:manifest.modules.map(m=>({id:m.id,state:"configured",configuration_refs:[]}))};
 const event={schema:"temperance.organ-lifecycle-event.v1",occurrence_id:"occurrence",plant_id:"test",source_manifest_digest:inspectComposition(manifest).source_manifest_digest,occurred_at:new Date(now).toISOString(),kind:"session-end"};
 const receipt=await runOrganLifecycle({manifest,observations,event,subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.nutrix",event_kinds:["session-end"]}]},handlers:{"organ.nutrix":()=>{}},ledger:{async claim(){return "claimed";},async commit(){}},now,elapsed_ms:()=>0});
 return {manifest,observations,event,receipt};
}
test("immutable shared projection enables declared configured targets without granting authority",async()=>{
 const f=await fixture();const p=projectComposition(f.manifest,f.observations,f.event,f.receipt,now);
 expect(p.targets.map(t=>t.id)).toEqual(["projection.banner","projection.island"]);expect(p.targets.every(t=>t.enabled)).toBe(true);expect(p.effect_authorized).toBe(false);expect(p.execution_authorized).toBe(false);expect(Object.isFrozen(p.targets[1]?.island_model)).toBe(true);expect(JSON.stringify(p)).not.toMatch(/cambium|superset|provider|127\.0\.0\.1/i);expect(p.receipt_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
});
test("historical event remains visible as stale and disabled",async()=>{
 const f=await fixture();const p=projectComposition(f.manifest,f.observations,f.event,f.receipt,now+300001);expect(p.freshness).toBe("stale");expect(p.targets.length).toBe(2);expect(p.targets.every(t=>!t.enabled&&t.state==="unknown")).toBe(true);expect(p.targets[0]?.banner_text).toContain("stale");
});
test("unknown and held projections remain visible",async()=>{
 const f=await fixture();expect(projectComposition(f.manifest,undefined,f.event,f.receipt,now).targets.every(t=>!t.enabled&&t.state==="unknown")).toBe(true);
 f.observations.modules.find(m=>m.id==="projection.banner")!.state="unavailable";const p=projectComposition(f.manifest,f.observations,f.event,f.receipt,now);expect(p.targets[0]?.state).toBe("held");expect(p.targets[0]?.enabled).toBe(false);
});
test("undeclared targets omitted and module permutations deterministic",async()=>{
 const f=await fixture();const first=projectComposition(f.manifest,f.observations,f.event,f.receipt,now);f.manifest.modules.reverse();f.observations.modules.reverse();expect(projectComposition(f.manifest,f.observations,f.event,f.receipt,now)).toEqual(first);
 f.manifest.modules=f.manifest.modules.filter(m=>m.id==="organ.nutrix");f.observations.modules=f.observations.modules.filter(m=>m.id==="organ.nutrix");f.event.source_manifest_digest=inspectComposition(f.manifest).source_manifest_digest;f.receipt=await runOrganLifecycle({manifest:f.manifest,observations:f.observations,event:f.event,subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[]},handlers:{},ledger:{async claim(){return "claimed";},async commit(){}},now});expect(projectComposition(f.manifest,f.observations,f.event,f.receipt,now).targets).toEqual([]);
});
test("lineage and altered receipt identities rejected",async()=>{
 const f=await fixture();for(const patch of [{plant_id:"other"},{occurrence_id:"other"},{source_manifest_digest:`sha256:${"0".repeat(64)}`},{event_digest:`sha256:${"0".repeat(64)}`},{event_identity_digest:`sha256:${"0".repeat(64)}`}])expect(()=>projectComposition(f.manifest,f.observations,f.event,{...f.receipt,...patch},now)).toThrow("COMPOSITION_PROJECTION_LINEAGE_MISMATCH");
 expect(()=>projectComposition(f.manifest,f.observations,{...f.event,occurred_at:new Date(now-1).toISOString()},f.receipt,now)).toThrow();
});
test("strict private fields, authority and inconsistent outcomes rejected",async()=>{
 const f=await fixture();for(const receipt of [{...f.receipt,prompt:"private-secret"},{...f.receipt,effect_authorized:true},{...f.receipt,organs:[{...f.receipt.organs[0],reason_code:"private-secret"}]},{...f.receipt,status:"persistence-failed",persisted:true}]){expect(()=>projectComposition(f.manifest,f.observations,f.event,receipt,now)).toThrow("COMPOSITION_PROJECTION_INVALID_INPUT");}
 expect(()=>projectComposition(f.manifest,f.observations,{...f.event,occurred_at:new Date(now+1).toISOString()},f.receipt,now)).toThrow();expect(()=>projectComposition(f.manifest,f.observations,{...f.event,occurred_at:"2025-02-30T00:00:00.000Z"},f.receipt,now)).toThrow();
});
test("proxies/getters execute zero caller traps",async()=>{
 const f=await fixture();let traps=0;const receipt=new Proxy(f.receipt,{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");}});expect(()=>projectComposition(f.manifest,f.observations,f.event,receipt,now)).toThrow();expect(traps).toBe(0);
 const event={...f.event};Object.defineProperty(event,"kind",{enumerable:true,get(){traps++;throw new Error("private");}});expect(()=>projectComposition(f.manifest,f.observations,event,f.receipt,now)).toThrow();expect(traps).toBe(0);
});
test("fixed summary covers timeout unsettled persistence failure replay and in progress",async()=>{
 const f=await fixture();const timeout:OrganLifecycleReceiptV1={...f.receipt,status:"held",organs:[{organ_id:"organ.nutrix",outcome:"timeout",reason_code:"CALLBACK_TIMEOUT",cancellation_requested:true,callback_settled:false}]};expect(projectComposition(f.manifest,f.observations,f.event,timeout,now).lifecycle.summary).toContain("callback remains unsettled");
 for(const status of ["replay","in-progress","persistence-failed"] as const){const r={...f.receipt,status,persisted:false,organs:[]};expect(projectComposition(f.manifest,f.observations,f.event,r,now).lifecycle.status).toBe(status);}
 const modified={...f.receipt,status:"persistence-failed" as const,persisted:false};expect(projectComposition(f.manifest,f.observations,f.event,modified,now).receipt_digest).not.toBe(projectComposition(f.manifest,f.observations,f.event,f.receipt,now).receipt_digest);
});
test("bounded input and nested private/accessor rows rejected without disclosure",async()=>{
 const f=await fixture();expect(()=>projectComposition(f.manifest,f.observations,{...f.event,occurrence_id:"x".repeat(65537)},f.receipt,now)).toThrow("COMPOSITION_PROJECTION_INVALID_INPUT");
 const r=structuredClone(f.receipt);let traps=0;Object.defineProperty(r.organs[0],"reason_code",{enumerable:true,get(){traps++;throw new Error("private-secret");}});expect(()=>projectComposition(f.manifest,f.observations,f.event,r,now)).toThrow("COMPOSITION_PROJECTION_INVALID_INPUT");expect(traps).toBe(0);
 const hidden={...f.receipt};Object.defineProperty(hidden,"private_path",{value:"/private/path"});expect(()=>projectComposition(f.manifest,f.observations,f.event,hidden,now)).toThrow("COMPOSITION_PROJECTION_INVALID_INPUT");
});

test("valid missing-organ held receipt remains displayable without accepting undeclared execution", async () => {
 const f = await fixture();
 f.manifest.modules = f.manifest.modules.filter(m => m.id !== "organ.nutrix");
 f.observations.modules = f.observations.modules.filter(m => m.id !== "organ.nutrix");
 f.event.source_manifest_digest = inspectComposition(f.manifest).source_manifest_digest;
 const receipt = await runOrganLifecycle({manifest:f.manifest,observations:f.observations,event:f.event,subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.nutrix",event_kinds:["session-end"]}]},handlers:{},ledger:{claim:async()=>"claimed",commit:async()=>{}},now,elapsed_ms:()=>0});
 expect(receipt.status).toBe("held");
 const p = projectComposition(f.manifest,f.observations,f.event,receipt,now);
 expect(p.targets.length).toBe(2);expect(p.lifecycle.summary).toContain("held");
 expect(()=>projectComposition(f.manifest,f.observations,f.event,{...receipt,status:"completed",organs:[{organ_id:"organ.nutrix",outcome:"advisory-completed",reason_code:"ADVISORY_COMPLETED",cancellation_requested:false,callback_settled:true}]},now)).toThrow("COMPOSITION_PROJECTION_LINEAGE_MISMATCH");
});
