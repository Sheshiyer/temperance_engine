/** Pure process bookkeeping. No execution, admission, provider or acceptance authority. */
import { types } from "node:util";
import { PHASES_V4 } from "./phase-projection.v4.ts";
import { inspectComposition } from "../install-surface/src/composition/inspect.ts";

export const PORTABLE_PHASES = ["observe", "think", "plan", "build", "execute", "verify", "learn"] as const;
export type PortablePhase = typeof PORTABLE_PHASES[number];
export const PROCESS_STATES = ["planned", "admitted", "running", "waiting_capacity", "waiting_operator", "held_missing_capability", "completed", "failed", "blocked", "cancelled", "budget_ended"] as const;
export type ProcessState = typeof PROCESS_STATES[number];
const transitions: Record<ProcessState, readonly ProcessState[]> = {
 planned:["admitted","waiting_capacity","waiting_operator","held_missing_capability","cancelled","budget_ended"],
 admitted:["running","waiting_capacity","waiting_operator","held_missing_capability","cancelled","budget_ended"],
 running:["completed","failed","blocked","cancelled","budget_ended","waiting_capacity","waiting_operator","held_missing_capability"],
 waiting_capacity:["admitted","blocked","cancelled","budget_ended"],
 waiting_operator:["admitted","blocked","cancelled","budget_ended"],
 held_missing_capability:["admitted","blocked","cancelled","budget_ended"],
 completed:[],failed:[],blocked:[],cancelled:[],budget_ended:[],
};
export interface PhaseFrame {
 readonly schema: "temperance.portable-phase-frame.v1";
 readonly run_id: string;
 readonly task_digest: string;
 readonly source_manifest_digest: string;
 readonly phase: PortablePhase;
 readonly state: ProcessState;
 readonly attempt: number;
 readonly max_attempts: number;
 readonly execution_authorized: false;
 readonly acceptance_asserted: false;
}
const keys=["schema","run_id","task_digest","source_manifest_digest","phase","state","attempt","max_attempts","execution_authorized","acceptance_asserted"];
const digest=/^sha256:[a-f0-9]{64}$/;
function invalid():never {throw new Error("PORTABLE_PHASE_INVALID_INPUT");}
export function validatePhaseFrame(input: unknown): Readonly<PhaseFrame> {
 if(!input || typeof input!=="object" || types.isProxy(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) invalid();
 if(Reflect.ownKeys(input).length!==keys.length) invalid();
 const v:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(input)) {
  if(typeof key!=="string" || !keys.includes(key)) invalid();
  const d=Object.getOwnPropertyDescriptor(input,key)!;
  if(d.get || d.set || !d.enumerable) invalid();
  v[key]=d.value;
 }
 if(v.schema!=="temperance.portable-phase-frame.v1" || typeof v.run_id!=="string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(v.run_id) || typeof v.task_digest!=="string" || !digest.test(v.task_digest) || typeof v.source_manifest_digest!=="string" || !digest.test(v.source_manifest_digest) || !(PORTABLE_PHASES as readonly unknown[]).includes(v.phase) || !(PROCESS_STATES as readonly unknown[]).includes(v.state) || !Number.isSafeInteger(v.attempt) || !Number.isSafeInteger(v.max_attempts) || (v.attempt as number)<1 || (v.max_attempts as number)>32 || (v.attempt as number)>(v.max_attempts as number) || v.execution_authorized!==false || v.acceptance_asserted!==false) invalid();
 return Object.freeze(v) as unknown as Readonly<PhaseFrame>;
}
/** Uses the existing composition authority, including its dependency and retired-module checks. */
export function startPortableRun(manifest:unknown, run_id:string, task_digest:string, max_attempts=1):Readonly<PhaseFrame> {
 const report=inspectComposition(manifest);
 return validatePhaseFrame({schema:"temperance.portable-phase-frame.v1",run_id,task_digest,source_manifest_digest:report.source_manifest_digest,phase:"observe",state:"planned",attempt:1,max_attempts,execution_authorized:false,acceptance_asserted:false});
}
export function transitionPhase(input:unknown, next:ProcessState):Readonly<PhaseFrame> {
 const frame=validatePhaseFrame(input);
 if(!transitions[frame.state].includes(next)) throw new Error("PORTABLE_PHASE_ILLEGAL_TRANSITION");
 return validatePhaseFrame({...frame,state:next});
}
/** A completed process is never an accepted result. Caller must retain the owning ISA. */
export function advancePhase(input:unknown, expected: Pick<PhaseFrame,"run_id"|"task_digest"|"source_manifest_digest"|"phase">):Readonly<PhaseFrame>|null {
 const frame=validatePhaseFrame(input);
 if(!expected || typeof expected!=="object" || types.isProxy(expected) || ![Object.prototype,null].includes(Object.getPrototypeOf(expected))) invalid();
 for(const key of ["run_id","task_digest","source_manifest_digest","phase"] as const) {
  const d=Object.getOwnPropertyDescriptor(expected,key);
  if(!d || d.get || d.set || !d.enumerable) invalid();
  if(frame[key]!==d.value) throw new Error("PORTABLE_PHASE_IDENTITY_MISMATCH");
 }
 if(frame.state!=="completed") throw new Error("PORTABLE_PHASE_NOT_COMPLETED");
 const phase=PORTABLE_PHASES[PORTABLE_PHASES.indexOf(frame.phase)+1];
 return phase ? validatePhaseFrame({...frame,phase,state:"planned",attempt:1}) : null;
}
export function retryPhase(input:unknown):Readonly<PhaseFrame> {
 const frame=validatePhaseFrame(input);
 if(!["failed","blocked"].includes(frame.state) || frame.attempt>=frame.max_attempts) throw new Error("PORTABLE_PHASE_RETRY_REFUSED");
 return validatePhaseFrame({...frame,state:"planned",attempt:frame.attempt+1});
}
/** Logical intent only. No host aliases, credentials, provider seats or implicit fallback. */
export function phaseIntent(phase:PortablePhase) {
 if(!(PORTABLE_PHASES as readonly unknown[]).includes(phase)) invalid();
 return Object.freeze({phase,kosha:PHASES_V4[phase]!.kosha,lane_intent:`phase.${phase}`,skill_intent:`work.${phase}`,adapter_state:"unsupported" as const,execution_authorized:false as const});
}
