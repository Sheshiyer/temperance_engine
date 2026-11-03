import { types } from "node:util";
import type { OrganHandlerContext, OrganLifecycleOptions } from "./lifecycle.ts";

/** Trusted adapters select context. These labels and filters are not a sandbox or DLP system. */
export interface OrientationContext {
 schema:"temperance.vestibule-context.v1";
 plant_id:string;
 occurrence_id:string;
 source_manifest_digest:string;
 observed_at:string;
 expires_at:string;
 items:Array<{id:string;visibility:"public"|"synthetic";source_ref:string;summary:string}>;
}
export interface OrientationCard {
 readonly schema:"temperance.vestibule-orientation.v1";
 readonly plant_id:string;
 readonly occurrence_id:string;
 readonly source_manifest_digest:string;
 readonly observed_at:string;
 readonly expires_at:string;
 readonly items:readonly Readonly<OrientationContext["items"][number]>[];
 readonly advisory_only:true;
 readonly execution_authorized:false;
 readonly acceptance_asserted:false;
}
type Handler=NonNullable<OrganLifecycleOptions["handlers"]["organ.vestibule"]>;
function invalid():never {throw new Error("VESTIBULE_CONTEXT_INVALID");}
function plain(value:unknown,keys:readonly string[]):Record<string,unknown> {
 if(!value || typeof value!=="object" || types.isProxy(value) || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) invalid();
 if(Reflect.ownKeys(value).length!==keys.length) invalid();
 const result:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(value)) {
  if(typeof key!=="string" || !keys.includes(key)) invalid();
  const d=Object.getOwnPropertyDescriptor(value,key)!;
  if(d.get || d.set || !d.enumerable) invalid();
  result[key]=d.value;
 }
 return result;
}
function safeText(value:unknown,max:number):value is string {
 return typeof value==="string" && value.trim().length>0 && value.length<=max && !/[\x00-\x1f\x7f]|https?:|file:|plugin:|[~\\/]|(?:bearer|api[_-]?key|password|token)\s*[:=]/i.test(value);
}
function utc(value:unknown):number {
 if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
 const t=Date.parse(value); if(!Number.isFinite(t) || new Date(t).toISOString()!==value) invalid();return t;
}
function ensureLive(context:OrganHandlerContext, now:number):void {
 if(!Number.isSafeInteger(now) || context.signal.aborted || now>=context.deadline_ms) throw new Error("VESTIBULE_CANCELLED_OR_EXPIRED");
}
export function orientationCard(input:unknown, context:OrganHandlerContext, now:number):Readonly<OrientationCard> {
 ensureLive(context,now);
 const v=plain(input,["schema","plant_id","occurrence_id","source_manifest_digest","observed_at","expires_at","items"]);
 if(v.schema!=="temperance.vestibule-context.v1" || v.plant_id!==context.event.plant_id || v.occurrence_id!==context.event.occurrence_id || v.source_manifest_digest!==context.event.source_manifest_digest) invalid();
 const observed=utc(v.observed_at),expires=utc(v.expires_at);
 if(observed>now || expires<=now || expires<=observed || expires-observed>300000 || now-observed>300000) throw new Error("VESTIBULE_CONTEXT_STALE");
 if(!v.items || typeof v.items!=="object" || types.isProxy(v.items) || !Array.isArray(v.items) || Object.getPrototypeOf(v.items)!==Array.prototype || v.items.length>16 || Reflect.ownKeys(v.items).length!==v.items.length+1) invalid();
 const ids=new Set<string>();
 const items=[];
 for(let i=0;i<v.items.length;i++) {
  const d=Object.getOwnPropertyDescriptor(v.items,String(i));if(!d || d.get || d.set || !d.enumerable) invalid();
  const item=plain(d.value,["id","visibility","source_ref","summary"]);
  if(!safeText(item.id,64) || !/^[A-Za-z0-9_.-]+$/.test(item.id) || ids.has(item.id) || !["public","synthetic"].includes(item.visibility as string) || !safeText(item.summary,512) || typeof item.source_ref!=="string" || !/^(public|fixture):sha256:[a-f0-9]{64}$/.test(item.source_ref) || (item.visibility==="synthetic")!==(item.source_ref.startsWith("fixture:"))) invalid();
  ids.add(item.id);items.push(Object.freeze({...item}) as Readonly<OrientationContext["items"][number]>);
 }
 return Object.freeze({schema:"temperance.vestibule-orientation.v1",plant_id:v.plant_id as string,occurrence_id:v.occurrence_id as string,source_manifest_digest:v.source_manifest_digest as string,observed_at:v.observed_at as string,expires_at:v.expires_at as string,items:Object.freeze(items),advisory_only:true,execution_authorized:false,acceptance_asserted:false});
}
/** No default IO. Provider and consumer are trusted, cooperative, injected callbacks.
 * The existing lifecycle owns admission observations, replay and terminal persistence.
 * A consumer that ignores abort cannot be forcibly undone by this handler.
 */
export function createVestibuleHandler(options:{
 provide:(context:OrganHandlerContext)=>unknown|Promise<unknown>;
 consume:(card:Readonly<OrientationCard>,context:OrganHandlerContext)=>void|Promise<void>;
 now:()=>number;
}):Handler {
 const {provide,consume,now}=options;
 if(typeof provide!=="function" || typeof consume!=="function" || typeof now!=="function") invalid();
 return async context=>{
  ensureLive(context,now());
  if(!["session-start","prompt-submit"].includes(context.event.kind)) throw new Error("VESTIBULE_EVENT_UNSUPPORTED");
  const provided=provide(context);
  if(provided && typeof provided==="object" && types.isProxy(provided)) invalid();
  // Only native promises are awaited. Arbitrary thenables are context input, not code.
  const input=types.isPromise(provided) ? await provided : provided;
  const card=orientationCard(input,context,now());
  const deliveryTime=now();
  ensureLive(context,deliveryTime);
  if(deliveryTime>=Date.parse(card.expires_at)) throw new Error("VESTIBULE_CONTEXT_STALE");
  await consume(card,context);
  const finished=now();ensureLive(context,finished);
  if(finished>=Date.parse(card.expires_at)) throw new Error("VESTIBULE_CONTEXT_STALE");
 };
}
