import {expect,test} from "bun:test";
import {inspectComposition} from "../src/composition/inspect.ts";
import {runOrganLifecycle,type OrganLifecycleOptions,type OrganLifecycleReceiptV1} from "../src/composition/lifecycle.ts";
import {createVestibuleHandler,type OrientationCard} from "../src/composition/vestibule.ts";
const now=1793592000000;
function fixture(){
 const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"fixture",owner:"operator",kind:"local"},coordinator:{surface:"codex-cli",mode:"native"},integrations:[],modules:[{id:"organ.vestibule",owner:"operator",plant_id:"fixture",requires:[],configuration_refs:[]}]};
 const event={schema:"temperance.organ-lifecycle-event.v1",occurrence_id:"fixture-event",plant_id:"fixture",source_manifest_digest:inspectComposition(manifest).source_manifest_digest,occurred_at:new Date(now).toISOString(),kind:"session-start"};
 const context={schema:"temperance.vestibule-context.v1",plant_id:event.plant_id,occurrence_id:event.occurrence_id,source_manifest_digest:event.source_manifest_digest,observed_at:new Date(now-1).toISOString(),expires_at:new Date(now+1000).toISOString(),items:[{id:"task",visibility:"synthetic",source_ref:`fixture:sha256:${"a".repeat(64)}`,summary:"Review the illustrative project criteria"}]};
 const claims=new Map<string,string>();const receipts:OrganLifecycleReceiptV1[]=[];
 const options:OrganLifecycleOptions={manifest,event,observations:{schema:"temperance.composition-observations.v1",plant_id:"fixture",observed_at:new Date(now-1).toISOString(),expires_at:new Date(now+1000).toISOString(),modules:[{id:"organ.vestibule",state:"configured",configuration_refs:[]}]},subscriptions:{schema:"temperance.organ-subscriptions.v1",subscriptions:[{organ_id:"organ.vestibule",event_kinds:["session-start"]}]},handlers:{},ledger:{async claim(key){if(claims.has(key))return claims.get(key) as "in-progress"|"replay";claims.set(key,"in-progress");return "claimed";},async commit(key,receipt){receipts.push(receipt);claims.set(key,"replay");}},now};
 return {options,context,receipts};
}
test("injected lifecycle orientation consumer reads immutable synthetic provenance",async()=>{
 const f=fixture();let card:Readonly<OrientationCard>|undefined;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>f.context,consume:c=>{card=c;expect(Object.isFrozen(c.items[0])).toBe(true);},now:()=>now});
 const receipt=await runOrganLifecycle(f.options);
 expect(receipt.status).toBe("completed");expect(receipt.organs[0]?.outcome).toBe("advisory-completed");expect(f.receipts).toHaveLength(1);
 expect(card?.items[0]?.summary).toBe(f.context.items[0]!.summary);expect(card?.source_manifest_digest).toBe(receipt.source_manifest_digest);expect(card?.acceptance_asserted).toBe(false);expect(card?.execution_authorized).toBe(false);
 f.context.items[0]!.summary="Mutated source";expect(card?.items[0]?.summary).not.toBe("Mutated source");
});
test("replay and concurrent occurrence invoke selected provider only once",async()=>{
 const f=fixture();let calls=0;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:async()=>{calls++;await Promise.resolve();return f.context;},consume:()=>{},now:()=>now});
 const results=await Promise.all([runOrganLifecycle(f.options),runOrganLifecycle(f.options)]);
 expect(results.map(r=>r.status).sort()).toEqual(["completed","in-progress"]);expect((await runOrganLifecycle(f.options)).status).toBe("replay");expect(calls).toBe(1);
});
test("stale, private, wrong provenance and cross-plant context never delivered",async()=>{
 for(const patch of [{plant_id:"foreign"},{occurrence_id:"different"},{source_manifest_digest:`sha256:${"0".repeat(64)}`},{observed_at:new Date(now+1).toISOString()},{expires_at:new Date(now).toISOString()},{payload:"private"},{items:[{id:"private",visibility:"private",source_ref:"file:secret",summary:"private"}]},{items:[{id:"path",visibility:"public",source_ref:`public:sha256:${"a".repeat(64)}`,summary:"Read ~ hidden root"}]},{items:[{id:"url",visibility:"public",source_ref:"https://example.test?token=secret",summary:"public"}]}]) {
  const f=fixture();let delivered=0;f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>({...f.context,...patch}),consume:()=>{delivered++;},now:()=>now});const r=await runOrganLifecycle(f.options);expect(delivered).toBe(0);expect(r.status).toBe("held");expect(r.organs[0]?.outcome).toBe("failed");expect(JSON.stringify(r)).not.toContain("secret");
 }
});
test("provider and consumer failures remain truthful and sanitized",async()=>{
 for(const point of ["provide","consume"]) {
  const f=fixture();f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>{if(point==="provide")throw new Error("private-secret");return f.context;},consume:()=>{throw new Error("private-secret");},now:()=>now});
  const r=await runOrganLifecycle(f.options);expect(r.status).toBe("held");expect(r.organs[0]?.outcome).toBe("failed");expect(JSON.stringify(r)).not.toContain("private-secret");
 }
});
test("abort while provider awaits prevents late consumer delivery",async()=>{
 const f=fixture();let release:(value:unknown)=>void=()=>{};let delivered=0;f.options.timeout_ms=2;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>new Promise(resolve=>{release=resolve;}),consume:()=>{delivered++;},now:()=>now});
 const receipt=await runOrganLifecycle(f.options);expect(receipt.organs[0]?.outcome).toBe("timeout");expect(receipt.organs[0]?.callback_settled).toBe(false);
 release(f.context);await new Promise(resolve=>setTimeout(resolve,0));expect(delivered).toBe(0);
});
test("context expiration after provider is rejected before consumer",async()=>{
 const f=fixture();let clock=now;let delivered=0;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>{clock=now+1001;return f.context;},consume:()=>{delivered++;},now:()=>clock});
 expect((await runOrganLifecycle(f.options)).status).toBe("held");expect(delivered).toBe(0);
});
test("ledger failure after readback does not assert persistence or permit replay",async()=>{
 const f=fixture();let delivered=0;f.options.ledger.commit=async()=>{throw new Error("secret");};
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>f.context,consume:()=>{delivered++;},now:()=>now});
 const r=await runOrganLifecycle(f.options);expect(r.status).toBe("persistence-failed");expect(r.persisted).toBe(false);expect((await runOrganLifecycle(f.options)).status).toBe("in-progress");expect(delivered).toBe(1);
});
test("context getters and proxy rejected without invocation",async()=>{
 const f=fixture();let calls=0;Object.defineProperty(f.context,"items",{get(){calls++;throw new Error("private");},enumerable:true});
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>f.context,consume:()=>{calls++;},now:()=>now});expect((await runOrganLifecycle(f.options)).status).toBe("held");expect(calls).toBe(0);
});
test("expiry between validation and delivery never reaches consumer",async()=>{
 const f=fixture();f.context.expires_at=new Date(now+1).toISOString();const times=[now,now,now+2];let delivered=0;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>f.context,consume:()=>{delivered++;},now:()=>times.shift()??now+2});
 expect((await runOrganLifecycle(f.options)).status).toBe("held");expect(delivered).toBe(0);
});
test("actual context proxy and item proxy execute zero traps",async()=>{
 for(const item of [false,true]) {
  const f=fixture();let traps=0;const proxy=new Proxy(item?f.context.items[0]!:f.context,{get(){traps++;throw new Error("private");},ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");}});
  const input=item?{...f.context,items:[proxy]}:proxy;
  f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>input,consume:()=>{traps++;},now:()=>now});
  expect((await runOrganLifecycle(f.options)).status).toBe("held");expect(traps).toBe(0);
 }
});
test("consumer ignoring cancellation stays unsettled with no accepted result",async()=>{
 const f=fixture();f.options.timeout_ms=2;
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>f.context,consume:()=>new Promise(()=>{}),now:()=>now});
 const receipt=await runOrganLifecycle(f.options);expect(receipt.organs[0]).toMatchObject({outcome:"timeout",callback_settled:false,cancellation_requested:true});expect(receipt.execution_authorized).toBe(false);
});
test("direct then-getter payload is rejected without assimilation",async()=>{
 const f=fixture();let calls=0;const input={...f.context};Object.defineProperty(input,"then",{get(){calls++;throw new Error("private");},enumerable:true});
 f.options.handlers["organ.vestibule"]=createVestibuleHandler({provide:()=>input,consume:()=>{calls++;},now:()=>now});expect((await runOrganLifecycle(f.options)).status).toBe("held");expect(calls).toBe(0);
});
