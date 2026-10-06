import {createHash} from "node:crypto";
import {types} from "node:util";
import {canonical} from "../canonical-json.ts";
import {inspectComposition} from "./inspect.ts";
import {EVENT_KINDS,ORGAN_IDS,type OrganEventV1,type OrganId} from "./lifecycle.ts";
export const OWNER_OBSERVATION_SCHEMA="temperance.lifecycle-owner-observation.v1" as const;
export const OWNER_OUTCOMES=["process_completed","failed","busy","indeterminate","held_context_conflict","duplicate_process_completed","duplicate_failed","duplicate_pending","duplicate_indeterminate"] as const;
export interface OwnerObservationV1 {
 schema:typeof OWNER_OBSERVATION_SCHEMA;source_kind:"contained-owner-process";plant_id:string;occurrence_id:string;source_manifest_digest:string;event_digest:string;event_identity_digest:string;organ_id:OrganId;observed_at:string;
 status:"process-completed"|"held"|"replay"|"in-progress";owner_outcome:typeof OWNER_OUTCOMES[number];owner_receipt_digest:string;
 semantic_acceptance:false;capacity_authorization:false;effect_authorized:false;execution_authorized:false;
}
function invalid():never{throw new Error("OWNER_OBSERVATION_INVALID_INPUT");}
export function ownerCanonicalDigest(value:unknown):string{return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;}
function safe(value:unknown,depth:number,counter:{nodes:number}):void{
 if(++counter.nodes>4096||depth>16)invalid();
 if(value===null||typeof value==="boolean")return;
 if(typeof value==="string"){if(Buffer.byteLength(value)>65536)invalid();return;}
 if(typeof value!=="object"||types.isProxy(value))invalid();
 if(Array.isArray(value)){
  if(Object.getPrototypeOf(value)!==Array.prototype||value.length>64||Reflect.ownKeys(value).length!==value.length+1)invalid();
  for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||d.get||d.set)invalid();safe(d.value,depth+1,counter);}return;
 }
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 const keys=Reflect.ownKeys(value);if(keys.length>64)invalid();
 for(const key of keys){if(typeof key!=="string"||["__proto__","constructor","prototype"].includes(key))invalid();const d=Object.getOwnPropertyDescriptor(value,key)!;if(!d.enumerable||d.get||d.set)invalid();safe(d.value,depth+1,counter);}
}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
 safe(value,0,{nodes:0});if(Buffer.byteLength(JSON.stringify(value))>65536)invalid();
 if(!value||typeof value!=="object"||Array.isArray(value))invalid();const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))invalid();return v;
}
function symbolic(value:unknown):void{if(typeof value!=="string"||!/^[A-Za-z0-9_.-]{1,64}$/.test(value))invalid();}
function hash(value:unknown):void{if(typeof value!=="string"||!/^sha256:[a-f0-9]{64}$/.test(value))invalid();}
export function ownerUtc(value:unknown):number{
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))invalid();const t=Date.parse(value);if(!Number.isFinite(t)||new Date(t).toISOString()!==value)invalid();return t;
}
export function validateOwnerObservation(value:unknown):OwnerObservationV1{
 const v=exact(value,["schema","source_kind","plant_id","occurrence_id","source_manifest_digest","event_digest","event_identity_digest","organ_id","observed_at","status","owner_outcome","owner_receipt_digest","semantic_acceptance","capacity_authorization","effect_authorized","execution_authorized"]);
 if(v.schema!==OWNER_OBSERVATION_SCHEMA||v.source_kind!=="contained-owner-process"||!(ORGAN_IDS as readonly unknown[]).includes(v.organ_id)||!(OWNER_OUTCOMES as readonly unknown[]).includes(v.owner_outcome))invalid();
 symbolic(v.plant_id);symbolic(v.occurrence_id);ownerUtc(v.observed_at);
 for(const key of ["source_manifest_digest","event_digest","event_identity_digest","owner_receipt_digest"])hash(v[key]);
 for(const key of ["semantic_acceptance","capacity_authorization","effect_authorized","execution_authorized"])if(v[key]!==false)invalid();
 const expected=v.owner_outcome==="process_completed"?"process-completed":v.owner_outcome==="duplicate_process_completed"?"replay":v.owner_outcome==="duplicate_pending"?"in-progress":"held";
 if(v.status!==expected)invalid();return {...v} as unknown as OwnerObservationV1;
}
export function validateOwnerEvent(value:unknown,now:number):OrganEventV1{
 const v=exact(value,["schema","occurrence_id","plant_id","source_manifest_digest","occurred_at","kind"]);
 if(v.schema!=="temperance.organ-lifecycle-event.v1"||!(EVENT_KINDS as readonly unknown[]).includes(v.kind))invalid();symbolic(v.plant_id);symbolic(v.occurrence_id);hash(v.source_manifest_digest);if(ownerUtc(v.occurred_at)>now)invalid();return {...v} as unknown as OrganEventV1;
}
/** Digests bind caller-supplied content and lineage; they do not authenticate a process receipt. */
export function inspectOwnerObservation(manifest:unknown,observations:unknown,eventInput:unknown,ownerInput:unknown,now:number){
 if(!Number.isSafeInteger(now)||Math.abs(now)>8640000000000000)invalid();
 const event=validateOwnerEvent(eventInput,now);const owner=validateOwnerObservation(ownerInput);const report=inspectComposition(manifest,observations,now);
 if(ownerUtc(owner.observed_at)>now||ownerUtc(owner.observed_at)<ownerUtc(event.occurred_at))invalid();
 const event_digest=ownerCanonicalDigest(event),event_identity_digest=ownerCanonicalDigest({plant_id:event.plant_id,occurrence_id:event.occurrence_id});
 if(owner.plant_id!==report.plant.id||event.plant_id!==report.plant.id||owner.occurrence_id!==event.occurrence_id||owner.source_manifest_digest!==report.source_manifest_digest||event.source_manifest_digest!==report.source_manifest_digest||owner.event_digest!==event_digest||owner.event_identity_digest!==event_identity_digest||!report.modules.some(m=>m.id===owner.organ_id))throw new Error("OWNER_OBSERVATION_LINEAGE_MISMATCH");
 return {owner,event,report,event_digest,event_identity_digest,owner_observation_digest:ownerCanonicalDigest(owner),freshness:(now-ownerUtc(owner.observed_at)>300000||now-ownerUtc(event.occurred_at)>300000?"stale":"fresh") as "stale"|"fresh"};
}
