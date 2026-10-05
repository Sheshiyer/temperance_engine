import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {canonical} from "../src/canonical-json.ts";
import {verifyGitProjectAdmission,createLocalGitProjectProbe,type GitProjectProbeResult} from "../src/onboarding/git-project-admission.ts";
import {buildGitHandsEnvelope} from "../src/execution/git-hands-envelope.ts";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
const now=1760000000000,sha=`sha256:${"a".repeat(64)}`;
const hash=(v:unknown)=>`sha256:${createHash("sha256").update(canonical(v)).digest("hex")}`;
async function fixture(){
 const inventory=[{path:"/projects/repo",head:"a".repeat(40),branch:"main",prunable:false,locked:false,valid:true},{path:"/outside/linked",head:"a".repeat(40),branch:"work",prunable:false,locked:false,valid:true}];
 const snapshot:GitProjectProbeResult={canonical_root:"/projects/repo",head:"a".repeat(40),branch:"main",common_dir:"/projects/repo/.git",origin:"https://github.com/example/repo.git",observed_at:now,inventory:{common_dir:"/projects/repo/.git",observed_at:now,entries:inventory}};
 const capsule={schema:"temperance.project-capsule.v1",version:{major:1,minor:0},id:"repo",repository_identity:"github.com/example/repo",root_variable:"PROJECTS",relative_path:"repo",access:"read-write",approved:true};
 const binding={schema:"temperance.host-binding.v1",version:{major:1,minor:0},profile_id:"host",variables:{PROJECTS:"/projects"},secret_references:{},routing_aliases:[],volume_bindings:[]};
 const evidenceOptions={capsule,binding,mode:"write" as const,probe:{async observe(root:string){return {...snapshot,canonical_root:root,branch:root==="/projects/repo"?"main":"work"};}},now:()=>now};
 const evidence=await verifyGitProjectAdmission({...evidenceOptions,worktree_root:"/outside/linked"});const primary_evidence=await verifyGitProjectAdmission(evidenceOptions);
 return {evidence,primary_evidence,context:{context_id:"context",run_id:"run",project_id:"repo",observed_at:new Date(now).toISOString()},workspace:{primary_root:"/projects/repo",execution_root:"/outside/linked",common_dir:"/projects/repo/.git",branch:"work",observed_at:new Date(now).toISOString(),inventory},source:{commit:evidence.head!,dirty_fingerprint:sha,reviewed_fingerprint:sha},isa:{path:"/outside/linked/ISA.md",criteria_hash:sha,observed_criteria_hash:sha},tasks:[{id:"task",phase:"Execute",lane:"noesis-execute",effort_tier:3,source_fingerprint:sha,isa_criteria_hash:sha}],lease:{lease_id:"lease",run_id:"run",task_ids:["task"],issued_at:new Date(now).toISOString(),expires_at:new Date(now+1000).toISOString(),seat_fingerprint:sha}};
}
test("private external workspace envelope binds reviewed evidence without granting authority",async()=>{
 const f=await fixture(),before=JSON.stringify(f);const e=buildGitHandsEnvelope(f,now);expect(e.schema).toBe("temperance.hands-git-envelope.v1");expect(e.mode).toBe("private-context-only");expect(e.workspace.execution_root).toBe("/outside/linked");expect(e.execution_authorized).toBe(false);expect(e.capacity_authorization).toBe(false);expect(e.lease_authorized).toBe(false);expect(Object.isFrozen(e.workspace.inventory)).toBe(true);expect(Object.isFrozen(e.tasks[0])).toBe(true);expect(e.evidence_fingerprint).toBe(hash(f.evidence));expect(JSON.stringify(f)).toBe(before);expect(JSON.stringify(e)).not.toContain("superset");
});
test("root common-directory branch and inventory drift reject",async()=>{
 for(const patch of [{execution_root:"/outside/other"},{primary_root:"/other"},{common_dir:"/other/.git"},{branch:"wrong"}]){const f=await fixture();Object.assign(f.workspace,patch);expect(()=>buildGitHandsEnvelope(f,now)).toThrow("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");}
 const f=await fixture();f.workspace.inventory[1]!.head="b".repeat(40);expect(()=>buildGitHandsEnvelope(f,now)).toThrow();
});
test("source task ISA run and lease crosses rejected",async()=>{
 const f=await fixture();for(const mutate of [(g:typeof f)=>{g.source.commit="b".repeat(40);},(g:typeof f)=>{g.source.dirty_fingerprint=`sha256:${"b".repeat(64)}`;},(g:typeof f)=>{g.isa.path="/projects/repo/ISA.md";},(g:typeof f)=>{g.isa.observed_criteria_hash=`sha256:${"b".repeat(64)}`;},(g:typeof f)=>{g.tasks[0]!.source_fingerprint=`sha256:${"b".repeat(64)}`;},(g:typeof f)=>{g.tasks[0]!.isa_criteria_hash=`sha256:${"b".repeat(64)}`;},(g:typeof f)=>{g.lease.run_id="other";},(g:typeof f)=>{g.lease.task_ids=["other"];}]){const g=structuredClone(f);mutate(g);expect(()=>buildGitHandsEnvelope(g,now)).toThrow("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");}
});
test("shared PlanMax E4 E5 and closed phase lanes applied",async()=>{
 const f=await fixture();f.tasks[0]!.phase="Plan";f.tasks[0]!.lane="noesis-plan-max";for(const effort of [4,5]){f.tasks[0]!.effort_tier=effort;expect(buildGitHandsEnvelope(f,now).tasks[0]?.lane).toBe("noesis-plan-max");}f.tasks[0]!.effort_tier=3;expect(()=>buildGitHandsEnvelope(f,now)).toThrow("GIT_HANDS_ENVELOPE_INVALID_INPUT");f.tasks[0]!.phase="Execute";f.tasks[0]!.effort_tier=5;expect(()=>buildGitHandsEnvelope(f,now)).toThrow();
});
test("evidence context and exclusive lease freshness rechecked",async()=>{
 const f=await fixture();expect(()=>buildGitHandsEnvelope(f,now+1000)).toThrow("GIT_HANDS_ENVELOPE_LEASE_INVALID");expect(()=>buildGitHandsEnvelope(f,now+300001)).toThrow("GIT_HANDS_ENVELOPE_STALE_CONTEXT");f.workspace.observed_at=new Date(now-1).toISOString();expect(()=>buildGitHandsEnvelope(f,now)).toThrow("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");
 const g=await fixture();g.lease.issued_at=new Date(now+1).toISOString();expect(()=>buildGitHandsEnvelope(g,now)).toThrow();g.lease.issued_at=new Date(now).toISOString();g.lease.seat_fingerprint="raw";expect(()=>buildGitHandsEnvelope(g,now)).toThrow();
});
test("fake verified flags serialized replay malformed fields and getter proxies rejected",async()=>{
 const f=await fixture();expect(()=>buildGitHandsEnvelope({...f,evidence:{verified:true}},now)).toThrow();expect(()=>buildGitHandsEnvelope({...f,superset_project_id:"fake"},now)).toThrow();expect(()=>buildGitHandsEnvelope({...f,tasks:Array(33).fill(f.tasks[0])},now)).toThrow();const g=structuredClone(f);g.tasks.push({...g.tasks[0]!});expect(()=>buildGitHandsEnvelope(g,now)).toThrow();let traps=0;const proxy=new Proxy(f,{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");}});expect(()=>buildGitHandsEnvelope(proxy,now)).toThrow();const getter=structuredClone(f);Object.defineProperty(getter.workspace,"branch",{enumerable:true,get(){traps++;throw new Error("private");}});expect(()=>buildGitHandsEnvelope(getter,now)).toThrow();expect(traps).toBe(0);expect(()=>buildGitHandsEnvelope(JSON.parse(JSON.stringify(f)),now+300001)).toThrow();
});
test("deterministic task and inventory ordering gives immutable context fingerprint",async()=>{
 const f=await fixture();f.tasks.push({...f.tasks[0]!,id:"another"});f.lease.task_ids.push("another");const first=buildGitHandsEnvelope(f,now);f.tasks.reverse();f.lease.task_ids.reverse();f.workspace.inventory.reverse();expect(buildGitHandsEnvelope(f,now).envelope_fingerprint).toBe(first.envelope_fingerprint);
});
test("actual disposable Git linked evidence builds private context",async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"temperance-hands-git-"))),repo=join(root,"repo"),linked=join(root,"external");mkdirSync(repo);const git=(args:string[])=>execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 try{git(["init","-b","main"]);writeFileSync(join(repo,"fixture"),"fixture");git(["add","fixture"]);git(["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","commit.gpgsign=false","commit","-m","fixture"]);git(["remote","add","origin","https://github.com/example/repo.git"]);git(["worktree","add","-b","linked",linked]);
 const probe=createLocalGitProjectProbe(()=>now);const observed=await probe.observe(linked);const f=await fixture();const actualOptions={capsule:{schema:"temperance.project-capsule.v1",version:{major:1,minor:0},id:"repo",repository_identity:"github.com/example/repo",root_variable:"PROJECTS",relative_path:"repo",access:"read-write",approved:true},binding:{schema:"temperance.host-binding.v1",version:{major:1,minor:0},profile_id:"host",variables:{PROJECTS:root},secret_references:{},routing_aliases:[],volume_bindings:[]},probe,now:()=>now,worktree_root:linked,mode:"write" as const};f.evidence=await verifyGitProjectAdmission(actualOptions);f.primary_evidence=await verifyGitProjectAdmission({...actualOptions,worktree_root:undefined});f.workspace={primary_root:repo,execution_root:linked,common_dir:observed.common_dir,branch:observed.branch!,observed_at:new Date(now).toISOString(),inventory:observed.inventory.entries};f.source.commit=observed.head;f.isa.path=join(linked,"ISA.md");const e=buildGitHandsEnvelope(f,now);expect(e.evidence.linked_worktree).toBe(true);expect(e.source.commit).toBe(observed.head);expect(e.execution_authorized).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("another linked inventory member cannot replace admitted primary root",async()=>{
 const f=await fixture();f.workspace.primary_root=f.workspace.execution_root;
 expect(()=>buildGitHandsEnvelope(f,now)).toThrow("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");
 const g=await fixture();g.primary_evidence=g.evidence;
 expect(()=>buildGitHandsEnvelope(g,now)).toThrow("GIT_HANDS_ENVELOPE_INVALID_INPUT");
 const h=await fixture();h.primary_evidence=structuredClone(h.primary_evidence);h.primary_evidence.fingerprints!.common_dir=`sha256:${"b".repeat(64)}`;
 expect(()=>buildGitHandsEnvelope(h,now)).toThrow("GIT_HANDS_ENVELOPE_BINDING_MISMATCH");
});
test("mixed-case task IDs share deterministic ordering with lease task set",async()=>{
 const f=await fixture();f.tasks=[{...f.tasks[0]!,id:"a"},{...f.tasks[0]!,id:"A"}];f.lease.task_ids=["A","a"];
 const first=buildGitHandsEnvelope(f,now);expect(first.tasks.map(t=>t.id)).toEqual(["A","a"]);expect(first.lease.task_ids).toEqual(["A","a"]);
 f.tasks.reverse();f.lease.task_ids.reverse();expect(buildGitHandsEnvelope(f,now).envelope_fingerprint).toBe(first.envelope_fingerprint);
});
test("private path-bearing envelope cannot cross valid public projection packet boundary",async()=>{
 const {runCompositionCommand}=await import("../src/composition/cli.ts");const {inspectComposition}=await import("../src/composition/inspect.ts");const privateEnvelope=buildGitHandsEnvelope(await fixture(),now);
 const manifest={schema:"temperance.composition.v1",product:{id:"temperance-engine",repository:"github.com/Sheshiyer/temperance_engine"},plant:{id:"test",owner:"operator",kind:"local"},coordinator:{surface:"codex-app",mode:"native"},integrations:[],modules:[{id:"projection.banner",owner:"operator",plant_id:"test",requires:[],configuration_refs:[]}]};
 const event={schema:"temperance.organ-lifecycle-event.v1",plant_id:"test",occurrence_id:"public-event",source_manifest_digest:inspectComposition(manifest,undefined,now).source_manifest_digest,occurred_at:new Date(now).toISOString(),kind:"session-start"};
 for(const command of ["project","owner-project"]){const packet=command==="project"?{manifest,event,receipt:privateEnvelope}:{manifest,event,owner_observation:privateEnvelope};const r=await runCompositionCommand([command],()=>JSON.stringify(packet),now);expect(r.code).toBe(2);expect(r.stdout).toBe("");expect(JSON.parse(r.stderr).error).toMatch(/^[A-Z_]+$/);expect(r.stderr).not.toContain("/outside/linked");expect(r.stderr).not.toContain("/projects/repo");expect(r.stderr).not.toContain("ISA.md");expect(r.stderr).not.toContain("private-context-only");}
});
