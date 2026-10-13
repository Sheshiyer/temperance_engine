import {createHash} from "node:crypto";
import {types} from "node:util";
import {canonical} from "../canonical-json.ts";
import {inspectComposition} from "./inspect.ts";
import {EVENT_KINDS,ORGAN_IDS,type OrganEventV1,type OrganLifecycleReceiptV1} from "./lifecycle.ts";

export interface CompositionProjectionV1 {
 schema:"temperance.composition-projection.v1";
 mode:"presentation-only"; effect_authorized:false; execution_authorized:false;
 projection_digest:string; source_manifest_digest:string; receipt_digest:string; event_digest:string; event_identity_digest:string;
 plant_id:string; occurrence_id:string; freshness:"fresh"|"stale";
 lifecycle:{status:OrganLifecycleReceiptV1["status"];persisted:boolean;summary:string;outcomes:Array<{organ_id:string;outcome:string;callback_settled:boolean;cancellation_requested:boolean}>};
 targets:Array<{id:"projection.banner"|"projection.island";enabled:boolean;state:"held"|"unknown"|"configuration-observed";banner_text?:string;island_model?:{title:string;summary:string;freshness:"fresh"|"stale";execution_authorized:false}}>;
}
const ID=/^[A-Za-z0-9_.-]{1,64}$/;
const SHA=/^sha256:[a-f0-9]{64}$/;
const STATES=["completed","held","replay","in-progress","persistence-failed"] as const;
const OUTCOMES=["advisory-completed","held","unavailable","failed","timeout"] as const;
const REASONS=["CONFIGURATION_HELD","DEPENDENCY_HELD","HANDLER_UNAVAILABLE","CONFIGURATION_EXPIRED","ADVISORY_COMPLETED","CALLBACK_TIMEOUT","CALLBACK_FAILED"] as const;
function invalid():never {throw new Error("COMPOSITION_PROJECTION_INVALID_INPUT");}
function safeTree(value:unknown,depth=0,budget={nodes:0}):void {
 if(++budget.nodes>65536||depth>16)invalid();
 if(value===null||typeof value==="boolean")return;
 if(typeof value==="string"){if(Buffer.byteLength(value)>65536)invalid();return;}
 if(typeof value!=="object"||types.isProxy(value))invalid();
 if(Array.isArray(value)){
  if(Object.getPrototypeOf(value)!==Array.prototype||value.length>64||Reflect.ownKeys(value).length!==value.length+1)invalid();
  for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||d.get||d.set)invalid();safeTree(d.value,depth+1,budget);}return;
 }
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 for(const k of Reflect.ownKeys(value)){if(typeof k!=="string"||["__proto__","constructor","prototype"].includes(k))invalid();const d=Object.getOwnPropertyDescriptor(value,k)!;if(!d.enumerable||d.get||d.set)invalid();safeTree(d.value,depth+1,budget);}
}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))invalid();
 const v=value as Record<string,unknown>;if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))invalid();return v;
}
function digest(value:unknown):string{return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;}
function symbol(value:unknown):void{if(typeof value!=="string"||!ID.test(value))invalid();}
function hash(value:unknown):void{if(typeof value!=="string"||!SHA.test(value))invalid();}
function utc(value:unknown):number{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))invalid();const t=Date.parse(value);if(!Number.isFinite(t)||new Date(t).toISOString()!==value)invalid();return t;}
function validateEvent(value:unknown,now:number):OrganEventV1{
 const v=exact(value,["schema","occurrence_id","plant_id","source_manifest_digest","occurred_at","kind"]);
 if(v.schema!=="temperance.organ-lifecycle-event.v1"||!(EVENT_KINDS as readonly unknown[]).includes(v.kind))invalid();symbol(v.occurrence_id);symbol(v.plant_id);hash(v.source_manifest_digest);if(utc(v.occurred_at)>now)invalid();return {...v} as unknown as OrganEventV1;
}
function validateReceipt(value:unknown):OrganLifecycleReceiptV1{
 const v=exact(value,["schema","event_digest","event_identity_digest","occurrence_id","source_manifest_digest","plant_id","mode","effect_authorized","execution_authorized","status","persisted","organs"]);
 if(v.schema!=="temperance.organ-lifecycle-receipt.v1"||v.mode!=="advisory-only"||v.effect_authorized!==false||v.execution_authorized!==false||!(STATES as readonly unknown[]).includes(v.status)||typeof v.persisted!=="boolean"||!Array.isArray(v.organs)||v.organs.length>ORGAN_IDS.length)invalid();
 for(const k of ["event_digest","event_identity_digest","source_manifest_digest"])hash(v[k]);symbol(v.occurrence_id);symbol(v.plant_id);
 const seen=new Set<unknown>();
 for(const raw of v.organs){const row=exact(raw,["organ_id","outcome","reason_code","cancellation_requested","callback_settled"]);if(!(ORGAN_IDS as readonly unknown[]).includes(row.organ_id)||seen.has(row.organ_id)||!(OUTCOMES as readonly unknown[]).includes(row.outcome)||!(REASONS as readonly unknown[]).includes(row.reason_code)||typeof row.cancellation_requested!=="boolean"||typeof row.callback_settled!=="boolean")invalid();seen.add(row.organ_id);
  const reason=row.outcome==="advisory-completed"?"ADVISORY_COMPLETED":row.outcome==="unavailable"?"HANDLER_UNAVAILABLE":row.outcome==="failed"?"CALLBACK_FAILED":row.outcome==="timeout"?"CALLBACK_TIMEOUT":null;
  if(reason!==null&&row.reason_code!==reason)invalid();if(row.outcome==="held"&&!["CONFIGURATION_HELD","DEPENDENCY_HELD","CONFIGURATION_EXPIRED"].includes(row.reason_code as string))invalid();
  if(row.outcome==="timeout"?row.cancellation_requested!==true:row.cancellation_requested!==false||row.callback_settled!==true)invalid();
 }
 if(["replay","in-progress"].includes(v.status as string)&&(v.persisted!==false||v.organs.length!==0))invalid();
 if(v.status==="persistence-failed"&&v.persisted!==false)invalid();
 if(v.status==="completed"&&v.organs.some((r:unknown)=>(r as Record<string,unknown>).outcome!=="advisory-completed"))invalid();
 if(v.status==="held"&&!v.organs.some((r:unknown)=>(r as Record<string,unknown>).outcome!=="advisory-completed"))invalid();
 if(["completed","held"].includes(v.status as string)&&v.persisted!==true)invalid();
 return structuredClone(v) as unknown as OrganLifecycleReceiptV1;
}
/** Presentation of caller-supplied receipts; digest integrity establishes lineage, not authenticity or authority. */
export function projectComposition(manifest:unknown,observations:unknown,eventInput:unknown,receiptInput:unknown,now:number):Readonly<CompositionProjectionV1>{
 if(!Number.isSafeInteger(now)||Math.abs(now)>8640000000000000)invalid();
 for(const input of [eventInput,receiptInput]){safeTree(input);if(Buffer.byteLength(JSON.stringify(input))>65536)invalid();}
 const event=validateEvent(eventInput,now);const receipt=validateReceipt(receiptInput);const report=inspectComposition(manifest,observations,now);
 const eventDigest=digest(event), identityDigest=digest({plant_id:event.plant_id,occurrence_id:event.occurrence_id});
 if(event.plant_id!==report.plant.id||receipt.plant_id!==event.plant_id||receipt.occurrence_id!==event.occurrence_id||event.source_manifest_digest!==report.source_manifest_digest||receipt.source_manifest_digest!==report.source_manifest_digest||receipt.event_digest!==eventDigest||receipt.event_identity_digest!==identityDigest)throw new Error("COMPOSITION_PROJECTION_LINEAGE_MISMATCH");
 const declared=new Set(report.modules.map(m=>m.id));if(receipt.organs.some(o=>!declared.has(o.organ_id) && !(o.outcome === "held" && o.reason_code === "CONFIGURATION_HELD" && o.callback_settled === true && o.cancellation_requested === false)))throw new Error("COMPOSITION_PROJECTION_LINEAGE_MISMATCH");
 const freshness=now-Date.parse(event.occurred_at)>300000?"stale":"fresh";
 const labels={completed:"Advisory callbacks completed",held:"Advisory lifecycle held",replay:"Occurrence already recorded", "in-progress":"Occurrence in progress", "persistence-failed":"Receipt persistence failed"};
 let summary=receipt.status === "completed" && receipt.organs.length === 0 ? "No advisory callbacks selected" : labels[receipt.status];if(receipt.organs.some(o=>o.outcome==="timeout"))summary+="; callback timeout";if(receipt.organs.some(o=>!o.callback_settled))summary+="; callback remains unsettled";
 const targets:CompositionProjectionV1["targets"]=report.modules.filter(m=>m.id==="projection.banner"||m.id==="projection.island").map(m=>{
 const state=m.readiness;const enabled=freshness==="fresh"&&state==="configuration-observed";
 const common={id:m.id as "projection.banner"|"projection.island",enabled,state};
 return m.id==="projection.banner"?{...common,banner_text:`Temperance · ${summary} · ${freshness} · ${state}`}:{...common,island_model:{title:"Temperance advisory lifecycle",summary,freshness,execution_authorized:false}};
 });
 const value:Omit<CompositionProjectionV1,"projection_digest">={schema:"temperance.composition-projection.v1",mode:"presentation-only",effect_authorized:false,execution_authorized:false,source_manifest_digest:report.source_manifest_digest,receipt_digest:digest(receipt),event_digest:eventDigest,event_identity_digest:identityDigest,plant_id:event.plant_id,occurrence_id:event.occurrence_id,freshness,lifecycle:{status:receipt.status,persisted:receipt.persisted,summary,outcomes:receipt.organs.map(o=>({organ_id:o.organ_id,outcome:o.outcome,callback_settled:o.callback_settled,cancellation_requested:o.cancellation_requested}))},targets};
 const result={...value,projection_digest:digest(value)};
 function freeze(v:unknown):void{if(v&&typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}}freeze(result);return result;
}
