import {inspectOwnerObservation,ownerCanonicalDigest,type OwnerObservationV1} from "./owner-observation.ts";
import type {CompositionProjectionV1} from "./projection.ts";
export interface CompositionOwnerProjectionV1 {
 schema:"temperance.composition-owner-projection.v1";mode:"presentation-only";source_kind:"contained-owner-process";
 semantic_acceptance:false;capacity_authorization:false;effect_authorized:false;execution_authorized:false;
 projection_digest:string;owner_observation_digest:string;owner_receipt_digest:string;source_manifest_digest:string;event_digest:string;event_identity_digest:string;plant_id:string;occurrence_id:string;freshness:"fresh"|"stale";
 owner:{organ_id:string;status:OwnerObservationV1["status"];outcome:OwnerObservationV1["owner_outcome"];summary:string};targets:CompositionProjectionV1["targets"];
}
/** Pure presentation of contained owner process observations. Acceptance remains unproved. */
export function projectOwnerObservation(manifest:unknown,observations:unknown,event:unknown,ownerObservation:unknown,now:number):Readonly<CompositionOwnerProjectionV1>{
 const inspected=inspectOwnerObservation(manifest,observations,event,ownerObservation,now);const {owner,report,freshness}=inspected;
 const labels:Record<OwnerObservationV1["owner_outcome"],string>={process_completed:"Owner process completed; acceptance unproved",failed:"Owner process failed; acceptance unproved",busy:"Owner process busy; acceptance unproved",indeterminate:"Owner process indeterminate; acceptance unproved",held_context_conflict:"Owner process held for context conflict; acceptance unproved",duplicate_process_completed:"Owner process completion previously recorded; acceptance unproved",duplicate_failed:"Owner process failure previously recorded; acceptance unproved",duplicate_pending:"Owner process occurrence in progress; acceptance unproved",duplicate_indeterminate:"Owner process prior occurrence indeterminate; acceptance unproved"};
 const summary=labels[owner.owner_outcome];
 const targets:CompositionProjectionV1["targets"]=report.modules.filter(m=>m.id==="projection.banner"||m.id==="projection.island").map(m=>{
  const common={id:m.id as "projection.banner"|"projection.island",enabled:freshness==="fresh"&&m.readiness==="configuration-observed",state:m.readiness};
  return m.id==="projection.banner"?{...common,banner_text:`Temperance · ${summary} · ${freshness} · ${m.readiness}`}:{...common,island_model:{title:"Temperance owner process observation",summary,freshness,execution_authorized:false}};
 });
 const value:Omit<CompositionOwnerProjectionV1,"projection_digest">={schema:"temperance.composition-owner-projection.v1",mode:"presentation-only",source_kind:"contained-owner-process",semantic_acceptance:false,capacity_authorization:false,effect_authorized:false,execution_authorized:false,owner_observation_digest:inspected.owner_observation_digest,owner_receipt_digest:owner.owner_receipt_digest,source_manifest_digest:report.source_manifest_digest,event_digest:inspected.event_digest,event_identity_digest:inspected.event_identity_digest,plant_id:owner.plant_id,occurrence_id:owner.occurrence_id,freshness,owner:{organ_id:owner.organ_id,status:owner.status,outcome:owner.owner_outcome,summary},targets};
 const result={...value,projection_digest:ownerCanonicalDigest(value)};function freeze(v:unknown):void{if(v&&typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}}freeze(result);return result;
}
