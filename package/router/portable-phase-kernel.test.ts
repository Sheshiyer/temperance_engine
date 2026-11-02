import {expect,test} from "bun:test";
import {PORTABLE_PHASES,startPortableRun,transitionPhase,advancePhase,retryPhase,phaseIntent,validatePhaseFrame} from "./portable-phase-kernel.ts";
const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"disposable",owner:"operator",kind:"local"},coordinator:{surface:"codex-cli",mode:"native"},modules:[],integrations:[]};
const task=`sha256:${"1".repeat(64)}`;
test("seven-phase no-profile synthetic cycle is process evidence only",()=>{
 let frame=startPortableRun(manifest,"synthetic-run",task);
 const visited=[];
 for(const phase of PORTABLE_PHASES) {
  expect(frame.phase).toBe(phase);visited.push(frame.phase);
  for(const state of ["admitted","running","completed"] as const)frame=transitionPhase(frame,state);
  expect(frame.execution_authorized).toBe(false);expect(frame.acceptance_asserted).toBe(false);
  const next=advancePhase(frame,frame);if(next)frame=next;else expect(phase).toBe("learn");
 }
 expect(visited).toEqual([...PORTABLE_PHASES]);
});
test("illegal completion, skip and identity drift refused",()=>{
 const frame=startPortableRun(manifest,"run",task);
 expect(()=>transitionPhase(frame,"completed")).toThrow("ILLEGAL_TRANSITION");
 expect(()=>advancePhase(frame,frame)).toThrow("NOT_COMPLETED");
 const completed=transitionPhase(transitionPhase(transitionPhase(frame,"admitted"),"running"),"completed");
 for(const patch of [{run_id:"other"},{phase:"think"},{task_digest:`sha256:${"2".repeat(64)}`},{source_manifest_digest:`sha256:${"0".repeat(64)}`}])expect(()=>advancePhase(completed,{...completed,...patch} as never)).toThrow("IDENTITY_MISMATCH");
 expect(()=>transitionPhase(completed,"running")).toThrow("ILLEGAL_TRANSITION");
});
test("bounded explicit retry and cancellation are terminal",()=>{
 let f=startPortableRun(manifest,"run",task,2);f=transitionPhase(transitionPhase(f,"admitted"),"running");f=transitionPhase(f,"failed");
 expect(retryPhase(f).attempt).toBe(2);
 const exhausted={...f,attempt:2};expect(()=>retryPhase(exhausted)).toThrow("RETRY_REFUSED");
 expect(()=>retryPhase(transitionPhase(startPortableRun(manifest,"run",task),"cancelled"))).toThrow("RETRY_REFUSED");
});
test("missing adapter stays unsupported with descriptive Koshas",()=>{
 expect(new Set(PORTABLE_PHASES.map(p=>phaseIntent(p).kosha)).size).toBe(5);
 for(const phase of PORTABLE_PHASES)expect(phaseIntent(phase)).toMatchObject({adapter_state:"unsupported",execution_authorized:false,lane_intent:`phase.${phase}`});
});
test("existing composition rejects private, duplicate, dangling and retired input",()=>{
 for(const patch of [{private_payload:"secret"},{modules:[{id:"projection.constellation",owner:"operator",plant_id:"disposable",requires:[],configuration_refs:[]}]}])expect(()=>startPortableRun({...manifest,...patch},"run",task)).toThrow();
 for(const requires of [["organ.adytum"],[]]) {
  const m={id:"organ.vestibule",owner:"operator",plant_id:"disposable",requires,configuration_refs:[]};
  expect(()=>startPortableRun({...manifest,modules:requires.length?[m]:[m,m]},"run",task)).toThrow();
 }
});
test("strict frame bounds and accessor rejection",()=>{
 const f=startPortableRun(manifest,"run",task);
 for(const patch of [{run_id:"/private"},{phase:"other"},{attempt:0},{max_attempts:33},{execution_authorized:true},{acceptance_asserted:true},{payload:"private"}])expect(()=>validatePhaseFrame({...f,...patch})).toThrow();
 let called=0;const v={...f};Object.defineProperty(v,"run_id",{get(){called++;return "run";},enumerable:true});expect(()=>validatePhaseFrame(v)).toThrow();expect(called).toBe(0);
});
