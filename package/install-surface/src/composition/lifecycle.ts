import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonical } from "../canonical-json.ts";
import { inspectComposition } from "./inspect.ts";
import { validateComposition, validateObservations, type ModuleId } from "./contracts.ts";

export const ORGAN_IDS = ["organ.vestibule", "organ.adytum", "organ.nutrix", "organ.auspex", "organ.circulator", "organ.praeceptor"] as const;
export type OrganId = typeof ORGAN_IDS[number];
export const EVENT_KINDS = ["session-start", "prompt-submit", "session-end", "scheduled-tick", "verified-outcome"] as const;
export type OrganEventKind = typeof EVENT_KINDS[number];
export interface OrganEventV1 { schema: "temperance.organ-lifecycle-event.v1"; occurrence_id: string; plant_id: string; source_manifest_digest: string; occurred_at: string; kind: OrganEventKind }
export interface OrganSubscriptionsV1 { schema: "temperance.organ-subscriptions.v1"; subscriptions: Array<{organ_id: OrganId; event_kinds: OrganEventKind[]}> }
export type OrganOutcome = "advisory-completed" | "held" | "unavailable" | "failed" | "timeout";
export interface OrganLifecycleReceiptV1 {
 schema: "temperance.organ-lifecycle-receipt.v1";
 event_digest: string; event_identity_digest: string; occurrence_id: string; source_manifest_digest: string; plant_id: string;
 mode: "advisory-only"; effect_authorized: false; execution_authorized: false;
 status: "completed" | "held" | "replay" | "in-progress" | "persistence-failed";
 persisted: boolean;
 organs: Array<{organ_id: OrganId; outcome: OrganOutcome; reason_code: string; cancellation_requested: boolean; callback_settled: boolean}>;
}
export interface OrganReplayLedger {
 /** Implement atomically and durably; claims remain held until terminal commit. */
 claim(eventIdentityDigest: string): Promise<"claimed" | "replay" | "in-progress">;
 commit(eventIdentityDigest: string, receipt: OrganLifecycleReceiptV1): Promise<void>;
}
export interface OrganHandlerContext { readonly event: Readonly<OrganEventV1>; readonly signal: AbortSignal; /** Logical advisory clock, advancing from injected now by elapsed monotonic time. Timer enforces lifetime. */ readonly deadline_ms: number }
export interface OrganLifecycleOptions {
 manifest: unknown; observations?: unknown; event: unknown; subscriptions: unknown;
 handlers: Partial<Record<OrganId, (context: OrganHandlerContext) => Promise<void> | void>>;
 /** Trusted injected ledger owns atomic durable storage; no built-in IO. */ ledger: OrganReplayLedger; now: number; timeout_ms?: number;
 /** Trusted injected monotonic elapsed clock for deterministic lifetime checks. */ elapsed_ms?: () => number;
}
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
function fail(): never { throw new Error("ORGAN_LIFECYCLE_INVALID_INPUT"); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
 if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
 if (Reflect.ownKeys(value).length !== keys.length) fail();
 for (const key of Reflect.ownKeys(value)) {
  if (typeof key !== "string" || !keys.includes(key)) fail();
  const d = Object.getOwnPropertyDescriptor(value, key)!;
  if (!d.enumerable || d.get || d.set) fail();
 }
 return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
 if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail();
 if (Reflect.ownKeys(value).length !== value.length + 1) fail();
 for (let i=0;i<value.length;i++) { const d=Object.getOwnPropertyDescriptor(value,String(i)); if (!d || d.get || d.set || !d.enumerable) fail(); }
 return value;
}
function eventInput(value: unknown, now: number): OrganEventV1 {
 const v = object(value,["schema","occurrence_id","plant_id","source_manifest_digest","occurred_at","kind"]);
 if (v.schema !== "temperance.organ-lifecycle-event.v1" || typeof v.occurrence_id !== "string" || !ID.test(v.occurrence_id) || typeof v.plant_id !== "string" || !ID.test(v.plant_id) || typeof v.source_manifest_digest !== "string" || !DIGEST.test(v.source_manifest_digest) || typeof v.kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(v.kind)) fail();
 if (typeof v.occurred_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.occurred_at)) fail();
 const t=Date.parse(v.occurred_at);
 if (!Number.isFinite(t) || new Date(t).toISOString() !== v.occurred_at || t>now || now-t>300000) fail();
 return {...v} as unknown as OrganEventV1;
}
function subscriptionsInput(value: unknown): OrganSubscriptionsV1["subscriptions"] {
 const v=object(value,["schema","subscriptions"]); if(v.schema !== "temperance.organ-subscriptions.v1") fail();
 const seen=new Set<string>();
 return array(v.subscriptions, ORGAN_IDS.length).map(raw=>{
  const s=object(raw,["organ_id","event_kinds"]);
  if(typeof s.organ_id!=="string" || !(ORGAN_IDS as readonly string[]).includes(s.organ_id) || seen.has(s.organ_id)) fail();
  seen.add(s.organ_id);
  const kinds=array(s.event_kinds, EVENT_KINDS.length);
  if(kinds.some(k=>typeof k!=="string" || !(EVENT_KINDS as readonly string[]).includes(k)) || new Set(kinds).size!==kinds.length) fail();
  return {organ_id:s.organ_id as OrganId,event_kinds:[...kinds].sort() as OrganEventKind[]};
 }).sort((a,b)=>a.organ_id.localeCompare(b.organ_id));
}

/** Executes injected advisory callbacks only. Configuration observations never grant effects.
 * Private legacy temperance.organ-event.v1 payloads are not parsed here. Harness
 * adapters must explicitly translate into this closed public lifecycle event.
 */
export async function runOrganLifecycle(options: OrganLifecycleOptions): Promise<OrganLifecycleReceiptV1> {
 if (!Number.isSafeInteger(options.now) || Math.abs(options.now)>8640000000000000) fail();
 const acceptedNow=options.now;
 const elapsedClock=options.elapsed_ms;
 const timeout=options.timeout_ms ?? 1000;
 if (!Number.isSafeInteger(timeout) || timeout<1 || timeout>30000) fail();
 const startClock=performance.now();
 let lastElapsed=0;
 function logicalNow(): number {
  const elapsed=elapsedClock ? elapsedClock() : performance.now()-startClock;
  if(!Number.isFinite(elapsed) || elapsed<lastElapsed || elapsed<0 || elapsed>8640000000000000-acceptedNow) throw new Error("ORGAN_LIFECYCLE_CLOCK_INVALID");
  lastElapsed=elapsed;
  return acceptedNow+Math.floor(elapsed);
 }
 const rawHandlers=options.handlers;
 if(!rawHandlers || typeof rawHandlers!=="object" || types.isProxy(rawHandlers) || ![Object.prototype,null].includes(Object.getPrototypeOf(rawHandlers))) fail();
 const handlers: OrganLifecycleOptions["handlers"]={};
 for(const key of Reflect.ownKeys(rawHandlers)) {
  if(typeof key!=="string" || !(ORGAN_IDS as readonly string[]).includes(key)) fail();
  const descriptor=Object.getOwnPropertyDescriptor(rawHandlers,key)!;
  if(descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value!=="function") fail();
  handlers[key as OrganId]=descriptor.value;
 }
 const event=Object.freeze(eventInput(options.event,acceptedNow));
 const subscriptions=subscriptionsInput(options.subscriptions);
 const manifest=validateComposition(options.manifest);
 const observations=options.observations===undefined ? undefined : validateObservations(options.observations);
 const report=inspectComposition(manifest,observations,acceptedNow);
 if(event.plant_id!==report.plant.id) throw new Error("ORGAN_LIFECYCLE_PLANT_MISMATCH");
 if(event.source_manifest_digest!==report.source_manifest_digest) throw new Error("ORGAN_LIFECYCLE_DIGEST_MISMATCH");
 const selected=subscriptions.filter(s=>s.event_kinds.includes(event.kind)).map(s=>s.organ_id);
 const event_digest=`sha256:${createHash("sha256").update(canonical(event)).digest("hex")}`;
 const event_identity_digest=`sha256:${createHash("sha256").update(canonical({plant_id:event.plant_id,occurrence_id:event.occurrence_id})).digest("hex")}`;
 const receipt: OrganLifecycleReceiptV1={schema:"temperance.organ-lifecycle-receipt.v1",event_digest,event_identity_digest,occurrence_id:event.occurrence_id,source_manifest_digest:report.source_manifest_digest,plant_id:report.plant.id,mode:"advisory-only",effect_authorized:false,execution_authorized:false,status:"completed",persisted:false,organs:[]};
 let claim: "claimed" | "replay" | "in-progress";
 try { claim=await options.ledger.claim(event_identity_digest); } catch { throw new Error("ORGAN_LIFECYCLE_CLAIM_FAILED"); }
 if(claim==="replay" || claim==="in-progress") return {...receipt,status:claim};
 if(claim!=="claimed") throw new Error("ORGAN_LIFECYCLE_CLAIM_FAILED");

 const rows=new Map(report.modules.map(m=>[m.id,m]));
 const results=new Map<OrganId,OrganLifecycleReceiptV1["organs"][number]>();
 async function invoke(id: OrganId): Promise<void> {
  if(results.has(id)) return;
  const mod=manifest.modules.find(m=>m.id===id);
  const ancestorIds=new Set<ModuleId>();
  function ancestors(moduleId: ModuleId): void {
   for(const dep of manifest.modules.find(m=>m.id===moduleId)?.requires ?? []) {
    if(!ancestorIds.has(dep)) {ancestorIds.add(dep);ancestors(dep);}
   }
  }
  ancestors(id);
  const dependencies=[...ancestorIds].sort();
  for(const dep of dependencies) if(selected.includes(dep as OrganId)) await invoke(dep as OrganId);
  const base={organ_id:id,cancellation_requested:false,callback_settled:true};
  if(!mod || rows.get(id)?.readiness!=="configuration-observed") {results.set(id,{...base,outcome:"held",reason_code:"CONFIGURATION_HELD"});return;}
  if(dependencies.some(dep=>rows.get(dep)?.readiness!=="configuration-observed" || (selected.includes(dep as OrganId) && results.get(dep as OrganId)?.outcome!=="advisory-completed"))) {results.set(id,{...base,outcome:"held",reason_code:"DEPENDENCY_HELD"});return;}
  const callbackNow=logicalNow();
  const freshReport=inspectComposition(manifest,observations,callbackNow);
  if(callbackNow-Date.parse(event.occurred_at)>300000 || freshReport.modules.find(m=>m.id===id)?.readiness!=="configuration-observed") {
   results.set(id,{...base,outcome:"held",reason_code:"CONFIGURATION_EXPIRED"});return;
  }
  const handler=handlers[id];
  if(typeof handler!=="function") {results.set(id,{...base,outcome:"unavailable",reason_code:"HANDLER_UNAVAILABLE"});return;}
  const controller=new AbortController(); let settled=false; let timer: ReturnType<typeof setTimeout>;
  const work=Promise.resolve().then(()=>handler({event,signal:controller.signal,deadline_ms:callbackNow+timeout})).then(()=>{settled=true;return "advisory-completed" as const;},()=>{settled=true;return "failed" as const;});
  const expiry=new Promise<"timeout">(resolve=>{timer=setTimeout(()=>{controller.abort();resolve("timeout");},timeout);});
  const outcome=await Promise.race([work,expiry]); clearTimeout(timer!);
  results.set(id,{...base,outcome,reason_code:outcome==="advisory-completed"?"ADVISORY_COMPLETED":outcome==="timeout"?"CALLBACK_TIMEOUT":"CALLBACK_FAILED",cancellation_requested:outcome==="timeout",callback_settled:settled});
 }
 for(const id of selected) await invoke(id);
 receipt.organs=[...results.values()];
 receipt.status=receipt.organs.some(r=>r.outcome!=="advisory-completed")?"held":"completed";
 try { await options.ledger.commit(event_identity_digest,structuredClone({...receipt,persisted:true})); return {...receipt,persisted:true}; }
 catch { return {...receipt,status:"persistence-failed",persisted:false}; }
}
