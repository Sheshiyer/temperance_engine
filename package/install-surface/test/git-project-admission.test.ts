import {expect,test} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {verifyGitProjectAdmission,createLocalGitProjectProbe,type GitProjectProbeResult,type VerifyGitProjectOptions} from "../src/onboarding/git-project-admission.ts";
const now=1760000000000;
function fixture():VerifyGitProjectOptions{
 const snapshot:GitProjectProbeResult={canonical_root:"/projects/repo",common_dir:"/projects/repo/.git",branch:"main",head:"a".repeat(40),origin:"git@github.com:example/repo.git",observed_at:now,inventory:{common_dir:"/projects/repo/.git",observed_at:now,entries:["/projects/repo","/worktrees/one"].map(path=>({path,head:"a".repeat(40),branch:"main",prunable:false,locked:false,valid:true}))}};
 return {capsule:{schema:"temperance.project-capsule.v1",version:{major:1,minor:0},id:"repo",repository_identity:"github.com/example/repo",root_variable:"PROJECTS",relative_path:"repo",access:"read-write",approved:true},binding:{schema:"temperance.host-binding.v1",version:{major:1,minor:0},profile_id:"host",variables:{PROJECTS:"/projects"},secret_references:{},routing_aliases:[],volume_bindings:[]},probe:{async observe(root){return {...snapshot,canonical_root:root};}},now:()=>now};
}
test("verified Git identity returns redacted fingerprints without authority",async()=>{
 const f=fixture();const r=await verifyGitProjectAdmission(f);expect(r.state).toBe("verified");expect(r.execution_authorized).toBe(false);expect(r.lease_authorized).toBe(false);expect(r.repository_identity).toBe("github.com/example/repo");expect(r.head).toBe("a".repeat(40));expect(JSON.stringify(r)).not.toContain("/projects");expect(JSON.stringify(r)).not.toContain("git@");expect(r.fingerprints?.branch).toMatch(/^sha256:/);
});
test("approval and unsafe paths held before probe",async()=>{
 for(const patch of [{approved:false},{relative_path:"../escape"},{relative_path:"repo/../repo"}]){const f=fixture();f.capsule={...(f.capsule as object),...patch};let calls=0;f.probe.observe=async()=>{calls++;throw new Error("private");};if(patch.approved===false)expect((await verifyGitProjectAdmission(f)).state).toBe("held");else await expect(verifyGitProjectAdmission(f)).rejects.toThrow("GIT_PROJECT_INVALID_INPUT");expect(calls).toBe(0);}
});
test("linked worktrees require exact fresh inventory and common dir",async()=>{
 const f=fixture();f.worktree_root="/worktrees/one";expect((await verifyGitProjectAdmission(f)).linked_worktree).toBe(true);
 const original=f.probe.observe;f.probe.observe=async root=>{const p=await original(root);p.inventory={...p.inventory,entries:[{path:"/projects/repo",head:"a".repeat(40),branch:"main",prunable:false,locked:false,valid:true}]};return p;};expect((await verifyGitProjectAdmission(f)).reason_code).toBe("WORKTREE_INVENTORY_MISMATCH");
 f.probe.observe=async root=>({...await original(root),common_dir:root==="/projects/repo"?"/projects/repo/.git":"/other/.git"});expect((await verifyGitProjectAdmission(f)).state).toBe("held");
});
test("no origin, wrong identity, root drift and stale inventory held",async()=>{
 for(const patch of [{origin:null},{origin:"git@github.com:other/repo.git"},{canonical_root:"/projects/other"},{observed_at:now-300001},{inventory:{common_dir:"/projects/repo/.git",observed_at:now-300001,entries:[{path:"/projects/repo",head:"a".repeat(40),branch:"main",prunable:false,locked:false,valid:true}]}}]){
 const f=fixture();const original=f.probe.observe;f.probe.observe=async root=>({...await original(root),...patch});expect((await verifyGitProjectAdmission(f)).state).toBe("held");}
});
test("volume proof must match bound UUID and fresh same source operation",async()=>{
 const f=fixture();const binding=f.binding as {variables:Record<string,string>;volume_bindings:unknown[]};binding.variables.MOUNT="/projects";binding.volume_bindings=[{id:"projects-volume",mount_path_variable:"MOUNT",volume_uuid:"uuid-1"}];expect((await verifyGitProjectAdmission(f)).reason_code).toBe("VOLUME_NOT_VERIFIED");
 f.volume_proofs=[{binding_id:"projects-volume",observed_uuid:"uuid-1",observed_at:now,canonical_root_present:true,state:"verified"}];expect((await verifyGitProjectAdmission(f)).state).toBe("verified");f.volume_proofs[0]!.observed_uuid="uuid-2";expect((await verifyGitProjectAdmission(f)).state).toBe("held");f.volume_proofs[0]!.observed_uuid="uuid-1";f.volume_proofs[0]!.observed_at=now-300001;expect((await verifyGitProjectAdmission(f)).state).toBe("held");
});
test("safe descriptors prevent caller getters and proxy traps",async()=>{
 const f=fixture();let calls=0;f.capsule=new Proxy(f.capsule as object,{ownKeys(){calls++;throw new Error("private");},getPrototypeOf(){calls++;throw new Error("private");}});await expect(verifyGitProjectAdmission(f)).rejects.toThrow("GIT_PROJECT_INVALID_INPUT");expect(calls).toBe(0);const g=fixture();Object.defineProperty(g.binding,"variables",{enumerable:true,get(){calls++;throw new Error("private");}});await expect(verifyGitProjectAdmission(g)).rejects.toThrow();expect(calls).toBe(0);
});
test("probe failure is held with fixed public code",async()=>{
 const f=fixture();f.probe.observe=async()=>{throw new Error("/private/secret");};const r=await verifyGitProjectAdmission(f);expect(r.reason_code).toBe("GIT_PROBE_FAILED");expect(JSON.stringify(r)).not.toContain("private");
});
test("disposable real repository and outside linked worktree prove Git membership",async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"temperance-git-admission-")));const repo=join(root,"repo"),worktree=join(root,"linked");mkdirSync(repo);
 const git=(args:string[])=>execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 try{git(["init","-b","main"]);writeFileSync(join(repo,"README.md"),"fixture\n");git(["add","README.md"]);git(["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","commit.gpgsign=false","commit","-m","fixture"]);git(["remote","add","origin","https://github.com/example/repo.git"]);git(["worktree","add","-b","fixture-linked",worktree]);
 const f=fixture();(f.binding as {variables:Record<string,string>}).variables.PROJECTS=root;f.probe=createLocalGitProjectProbe(()=>now);f.worktree_root=worktree;const r=await verifyGitProjectAdmission(f);expect(r.state).toBe("verified");expect(r.linked_worktree).toBe(true);expect(r.head).toMatch(/^[a-f0-9]{40}$/);expect(JSON.stringify(r)).not.toContain(root);
 git(["remote","remove","origin"]);expect((await verifyGitProjectAdmission(f)).reason_code).toBe("LOCAL_REPOSITORY_IDENTITY_UNDEFINED");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("registered branch HEAD prunable locked and valid flags must match",async()=>{
 for(const patch of [{head:"b".repeat(40)},{branch:"other"},{prunable:true},{locked:true},{valid:false}]){
 const f=fixture();const observe=f.probe.observe;f.probe.observe=async root=>{const p=await observe(root);p.inventory.entries=p.inventory.entries.map(e=>e.path===root?{...e,...patch}:e);return p;};expect((await verifyGitProjectAdmission(f)).reason_code).toBe("WORKTREE_IDENTITY_MISMATCH");}
});
test("primary and target inventories must share same generation",async()=>{
 const f=fixture();f.worktree_root="/worktrees/one";const observe=f.probe.observe;f.probe.observe=async root=>{const p=await observe(root);p.inventory.entries=structuredClone(p.inventory.entries);if(root==="/worktrees/one")p.inventory.entries[0]!.branch="changed";return p;};expect((await verifyGitProjectAdmission(f)).reason_code).toBe("WORKTREE_INVENTORY_MISMATCH");
});
test("trusted probe results still reject proxy and getter data without invoking traps",async()=>{
 const f=fixture();let calls=0;const observe=f.probe.observe;f.probe.observe=async root=>new Proxy(await observe(root),{getPrototypeOf(){calls++;throw new Error("private");},ownKeys(){calls++;throw new Error("private");}});expect((await verifyGitProjectAdmission(f)).reason_code).toBe("GIT_PROBE_FAILED");expect(calls).toBe(0);
 const g=fixture();const original=g.probe.observe;g.probe.observe=async root=>{const p=await original(root);Object.defineProperty(p,"head",{enumerable:true,get(){calls++;throw new Error("private");}});return p;};expect((await verifyGitProjectAdmission(g)).reason_code).toBe("GIT_PROBE_FAILED");expect(calls).toBe(0);
});
test("access mode read-only capsules hold write evidence and freeze all returned fields",async()=>{
 const f=fixture();f.capsule={...(f.capsule as object),access:"read-only"};f.mode="write";const held=await verifyGitProjectAdmission(f);expect(held.reason_code).toBe("PROJECT_READ_ONLY");expect(held.mode).toBe("write");expect(held.capsule_access).toBe("read-only");expect(Object.isFrozen(held)).toBe(true);
 f.mode="read";const read=await verifyGitProjectAdmission(f);expect(read.state).toBe("verified");expect(read.mode).toBe("read");expect(Object.isFrozen(read.fingerprints)).toBe(true);
});
test("methods clock and private target are snapshotted before awaits",async()=>{
 const f=fixture();f.worktree_root="/worktrees/one";const observe=f.probe.observe;let calls=0;f.probe.observe=async root=>{calls++;f.probe.observe=async()=>{throw new Error("changed");};f.now=()=>now-1;f.worktree_root="/other";return observe(root);};const r=await verifyGitProjectAdmission(f);expect(r.state).toBe("verified");expect(calls).toBe(2);expect(r.linked_worktree).toBe(true);
});
test("strict evidence consumer rejects authority extra fields and invalid conditional shapes",async()=>{
 const {validateGitProjectEvidence}=await import("../src/onboarding/git-project-admission.ts");const f=fixture();const verified=await verifyGitProjectAdmission(f);expect(validateGitProjectEvidence(verified)).toBe(true);
 for(const patch of [{execution_authorized:true},{lease_authorized:true},{private:"/secret"},{mode:"write",capsule_access:"read-only"},{reason_code:"unknown"},{head:"private"}])expect(validateGitProjectEvidence({...verified,...patch})).toBe(false);
 let traps=0;expect(validateGitProjectEvidence(new Proxy(verified,{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;throw new Error("private");}}))).toBe(false);expect(traps).toBe(0);
 f.capsule={...(f.capsule as object),approved:false};const held=await verifyGitProjectAdmission(f);expect(validateGitProjectEvidence(held)).toBe(true);expect(validateGitProjectEvidence({...held,head:"a".repeat(40)})).toBe(false);
});
test("duplicate malformed and unknown volume proof fields rejected",async()=>{
 const f=fixture();const proof={binding_id:"one",observed_uuid:"uuid-1",observed_at:now,canonical_root_present:true,state:"verified" as const};for(const proofs of [[proof,proof],[{...proof,private:"secret"}],[{...proof,observed_at:NaN}],[null]]){f.volume_proofs=proofs as never;await expect(verifyGitProjectAdmission(f)).rejects.toThrow("GIT_PROJECT_INVALID_INPUT");}
});
test("local probe rejects ambient Git redirection without inheriting it",async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"temperance-git-env-")));const repo=join(root,"repo");mkdirSync(repo);const git=(args:string[])=>execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 const vars=["GIT_DIR","GIT_WORK_TREE","GIT_CONFIG_COUNT","GIT_NAMESPACE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY"];
 const saved=new Map(vars.map(k=>[k,process.env[k]]));
 try{git(["init","-b","main"]);writeFileSync(join(repo,"fixture"),"fixture");git(["add","fixture"]);git(["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","commit.gpgsign=false","commit","-m","fixture"]);for(const k of vars)process.env[k]=k==="GIT_CONFIG_COUNT"?"999":"/nonexistent";const p=await createLocalGitProjectProbe(()=>now).observe(repo);expect(p.canonical_root).toBe(repo);expect(p.head).toMatch(/^[a-f0-9]{40}$/);expect(p.inventory.entries[0]?.branch).toBe("main");}
 finally{for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;rmSync(root,{recursive:true,force:true});}
});
