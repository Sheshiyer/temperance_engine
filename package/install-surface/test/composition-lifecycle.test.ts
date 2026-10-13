import {expect,test} from "bun:test";
import {inspectComposition} from "../src/composition/inspect.ts";
import {runOrganLifecycle,type OrganLifecycleOptions,type OrganReplayLedger,type OrganLifecycleReceiptV1} from "../src/composition/lifecycle.ts";
const now=1760000000000;
function fixture(): OrganLifecycleOptions {
 const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"test",owner:"operator",kind:"local"},coordinator:{surface:"codex-app",mode:"native"},integrations:[],modules:[{id:"organ.vestibule",owner:"operator",plant_id:"test",requires:[],configuration_refs:[]},{id:"organ.adytum",owner:"operator",plant_id:"test",requires:["organ.vestibule"],configuration_refs:[]}]};
 const observations={schema:"temperance.composition-observations.v1",plant_id:"test",observed_at:new Date(now-1000).toISOString(),expires_at:new Date(now+1000).toISOString(),modules:manifest.modules.map(m=>({id:m.id,state:"configured",configuration_refs:[]}))};
 const claims=new Map<string,"in-progress"|"replay">();
 const ledger: OrganReplayLedger={async claim(d){if(claims.has(d))return claims.get(d)!;claims.set(d,"in-progress");return "claimed";},async commit(d){claims.set(d,"replay");}};
 return {manifest,observations,event:{schema:"temperance.organ-lifecycle-event.v1",occurrence_id:"event-1",plant_id:"test",source_manifest_digest:inspectComposition(manifest).source_manifest_digest,occurred_at:new Date(now).toISOString(),kind:"prompt-submit"},subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.adytum",event_kinds:["prompt-submit"]},{organ_id:"organ.vestibule",event_kinds:["prompt-submit"]}]},handlers:{"organ.vestibule":()=>{},"organ.adytum":()=>{}},ledger,now};
}
test("causal order, durable receipt, exactly once replay",async()=>{
 const f=fixture(); const calls:string[]=[]; f.handlers={"organ.vestibule":()=>{calls.push("vestibule");},"organ.adytum":()=>{calls.push("adytum");}};
 const r=await runOrganLifecycle(f); expect(calls).toEqual(["vestibule","adytum"]);expect(r.persisted).toBe(true);expect(r.status).toBe("completed");expect(r.effect_authorized).toBe(false);expect(r.execution_authorized).toBe(false);
 expect((await runOrganLifecycle(f)).status).toBe("replay");expect(calls.length).toBe(2);
});
test("simultaneous events permit only one callback wave",async()=>{
 const f=fixture();let calls=0; f.handlers={"organ.vestibule":async()=>{calls++;await new Promise(r=>setTimeout(r,10));},"organ.adytum":()=>{calls++;}};
 const receipts=await Promise.all([runOrganLifecycle(f),runOrganLifecycle(f)]);expect(receipts.map(r=>r.status).sort()).toEqual(["completed","in-progress"]);expect(calls).toBe(2);
});
test("missing handler and prerequisite failure hold dependents",async()=>{
 for(const handlers of [{},{"organ.vestibule":()=>{throw new Error("private-secret");}}]) {const f=fixture();f.handlers=handlers; const r=await runOrganLifecycle(f);expect(r.status).toBe("held");expect(r.organs.find(r=>r.organ_id==="organ.adytum")?.reason_code).toBe("DEPENDENCY_HELD");expect(JSON.stringify(r)).not.toContain("private-secret");}
});
test("dependencies not subscribed are checked without invoking",async()=>{
 const f=fixture(); f.subscriptions={schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.adytum",event_kinds:["prompt-submit"]}]};let called=0;f.handlers["organ.vestibule"]=()=>{called++;};expect((await runOrganLifecycle(f)).status).toBe("completed");expect(called).toBe(0);
});
test("no default triggers or declared organs",async()=>{
 const f=fixture(); f.subscriptions={schema:"temperance.organ-subscriptions.v1",subscriptions:[]};let called=0;f.handlers["organ.vestibule"]=()=>{called++;};expect((await runOrganLifecycle(f)).organs).toEqual([]);expect(called).toBe(0);
 const absent=fixture();absent.subscriptions={schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.nutrix",event_kinds:["prompt-submit"]}]};expect((await runOrganLifecycle(absent)).organs[0]?.reason_code).toBe("CONFIGURATION_HELD");
});
test("stale configuration cannot invoke organs",async()=>{
 const f=fixture();f.now=now+2000;let called=0;f.handlers["organ.vestibule"]=()=>{called++;};expect((await runOrganLifecycle(f)).status).toBe("held");expect(called).toBe(0);
});
test("cross plant, digest mismatch, expired/future and private event fields rejected before claim",async()=>{
 for(const patch of [{plant_id:"another"},{source_manifest_digest:`sha256:${"0".repeat(64)}`},{occurred_at:new Date(now+1).toISOString()},{occurred_at:new Date(now-300001).toISOString()},{payload:"private-secret"},{occurrence_id:"/private/path"}]){
 const f=fixture(); f.event={...(f.event as object),...patch};let claimed=0;f.ledger.claim=async()=>{claimed++;return "claimed";};await expect(runOrganLifecycle(f)).rejects.toThrow();expect(claimed).toBe(0);
 }
});
test("strict subscriptions reject duplicates, unknown organs and accessors without running",async()=>{
 for(const list of [[{organ_id:"organ.unknown",event_kinds:[]}],[{organ_id:"organ.nutrix",event_kinds:["session-end","session-end"]}],[{organ_id:"organ.nutrix",event_kinds:[],payload:"private"}]]){const f=fixture();f.subscriptions={schema:"temperance.organ-subscriptions.v1",subscriptions:list};await expect(runOrganLifecycle(f)).rejects.toThrow("ORGAN_LIFECYCLE_INVALID_INPUT");}
 const f=fixture();let called=0;Object.defineProperty(f.event,"kind",{get(){called++;return "prompt-submit";},enumerable:true});await expect(runOrganLifecycle(f)).rejects.toThrow();expect(called).toBe(0);
});
test("sink failure leaves claimed event held and never asserts persistence",async()=>{
 const f=fixture();f.ledger.commit=async()=>{throw new Error("private-secret");};const r=await runOrganLifecycle(f);expect(r.persisted).toBe(false);expect(r.status).toBe("persistence-failed");expect((await runOrganLifecycle(f)).status).toBe("in-progress");expect(JSON.stringify(r)).not.toContain("private-secret");
});
test("ignored abort produces honest timeout and holds dependent",async()=>{
 const f=fixture();f.timeout_ms=5;let aborted=false;f.handlers["organ.vestibule"]=async({signal})=>{signal.addEventListener("abort",()=>{aborted=true;});await new Promise(()=>{});};const r=await runOrganLifecycle(f);const row=r.organs.find(r=>r.organ_id==="organ.vestibule")!;expect(row.outcome).toBe("timeout");expect(row.cancellation_requested).toBe(true);expect(row.callback_settled).toBe(false);expect(aborted).toBe(true);expect(r.organs.find(r=>r.organ_id==="organ.adytum")?.outcome).toBe("held");
});
test("selected prerequisite failures propagate through unsubscribed intermediate modules",async()=>{
 const f=fixture(); const manifest=f.manifest as {modules:Array<{id:string;owner:string;plant_id:string;requires:string[];configuration_refs:string[]}>};
 manifest.modules.find(m=>m.id==="organ.adytum")!.requires.push("projection.banner");
 manifest.modules.push({id:"projection.banner",owner:"operator",plant_id:"test",requires:["organ.auspex"],configuration_refs:[]},{id:"organ.auspex",owner:"operator",plant_id:"test",requires:[],configuration_refs:[]});
 (f.observations as {modules:unknown[]}).modules.push({id:"projection.banner",state:"configured",configuration_refs:[]},{id:"organ.auspex",state:"configured",configuration_refs:[]});
 (f.event as {source_manifest_digest:string}).source_manifest_digest=inspectComposition(manifest).source_manifest_digest;
 f.subscriptions={schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.adytum",event_kinds:["prompt-submit"]},{organ_id:"organ.auspex",event_kinds:["prompt-submit"]}]};
 const r=await runOrganLifecycle(f); expect(r.organs[0]?.organ_id).toBe("organ.auspex");expect(r.organs[0]?.outcome).toBe("unavailable");expect(r.organs[1]?.reason_code).toBe("DEPENDENCY_HELD");
});
test("proxy validation never invokes reflection traps",async()=>{
 for(const target of ["event","subscriptions","handlers"] as const) {
 const f=fixture();let traps=0;f[target]=new Proxy(f[target] as object,{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");},get(){traps++;throw new Error("private");}}) as never;
 await expect(runOrganLifecycle(f)).rejects.toThrow("ORGAN_LIFECYCLE_INVALID_INPUT");expect(traps).toBe(0);
 }
});
test("handler accessor rejected before claim and registry snapshotted",async()=>{
 const f=fixture();let getters=0;let claims=0;Object.defineProperty(f.handlers,"organ.vestibule",{enumerable:true,get(){getters++;throw new Error("private");}});f.ledger.claim=async()=>{claims++;return "claimed";};await expect(runOrganLifecycle(f)).rejects.toThrow();expect(getters).toBe(0);expect(claims).toBe(0);
 const snapshot=fixture();let called=0;snapshot.handlers["organ.adytum"]=()=>{called++;};const original=snapshot.ledger.claim;snapshot.ledger.claim=async key=>{snapshot.handlers["organ.adytum"]=()=>{throw new Error("changed");};return original(key);};expect((await runOrganLifecycle(snapshot)).status).toBe("completed");expect(called).toBe(1);
});
test("same occurrence with altered timestamp cannot rerun",async()=>{
 const f=fixture();let called=0;f.handlers["organ.vestibule"]=()=>{called++;};const first=await runOrganLifecycle(f);
 f.event={...(f.event as object),occurred_at:new Date(now-1).toISOString()};const second=await runOrganLifecycle(f);expect(second.status).toBe("replay");expect(second.event_identity_digest).toBe(first.event_identity_digest);expect(second.event_digest).not.toBe(first.event_digest);expect(called).toBe(1);
});
test("simultaneous varied payloads of same occurrence share claim",async()=>{
 const first=fixture();let called=0;first.handlers["organ.vestibule"]=async()=>{called++;await new Promise(r=>setTimeout(r,10));};const second={...first,event:{...(first.event as object),occurred_at:new Date(now-1).toISOString()}};
 const results=await Promise.all([runOrganLifecycle(first),runOrganLifecycle(second)]);expect(results.map(r=>r.status).sort()).toEqual(["completed","in-progress"]);expect(called).toBe(1);
});
test("delayed claim expiry holds without callbacks",async()=>{
 const f=fixture();let elapsed=0;f.elapsed_ms=()=>elapsed;let calls=0;f.handlers["organ.vestibule"]=()=>{calls++;};const claim=f.ledger.claim;f.ledger.claim=async key=>{elapsed=1000;return claim(key);};
 const r=await runOrganLifecycle(f);expect(calls).toBe(0);expect(r.status).toBe("held");expect(r.organs[0]?.reason_code).toBe("CONFIGURATION_EXPIRED");expect(r.persisted).toBe(true);
});
test("earlier callback expiry holds dependent without invoking",async()=>{
 const f=fixture();let elapsed=0;f.elapsed_ms=()=>elapsed;let dependent=0;f.handlers["organ.vestibule"]=()=>{elapsed=1000;};f.handlers["organ.adytum"]=()=>{dependent++;};
 const r=await runOrganLifecycle(f);expect(r.organs[0]?.outcome).toBe("advisory-completed");expect(r.organs[1]?.reason_code).toBe("CONFIGURATION_EXPIRED");expect(dependent).toBe(0);
});
test("observation mutation during claim cannot extend readiness",async()=>{
 const f=fixture();let elapsed=0;f.elapsed_ms=()=>elapsed;const claim=f.ledger.claim;f.ledger.claim=async key=>{elapsed=1000;(f.observations as {expires_at:string}).expires_at=new Date(now+100000).toISOString();return claim(key);};
 expect((await runOrganLifecycle(f)).organs[0]?.reason_code).toBe("CONFIGURATION_EXPIRED");
});
test("event TTL is rechecked after delayed claim",async()=>{
 const f=fixture();f.event={...(f.event as object),occurred_at:new Date(now-300000).toISOString()};let elapsed=0;f.elapsed_ms=()=>elapsed;const claim=f.ledger.claim;f.ledger.claim=async key=>{elapsed=1;return claim(key);};expect((await runOrganLifecycle(f)).organs[0]?.reason_code).toBe("CONFIGURATION_EXPIRED");
});
