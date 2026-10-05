import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {realpathSync} from "node:fs";
import {isAbsolute,normalize,relative,resolve} from "node:path";
import {types} from "node:util";
import {canonical} from "../canonical-json.ts";
import {validateHostBindingV1,validateProjectCapsuleV1} from "./contract-schema.ts";
import {normalizeRepositoryIdentity} from "./project-discovery.ts";
import type {HostBindingV1,ProjectCapsuleV1} from "./public-contracts.ts";
export interface GitWorktreeEntry {path:string;head:string;branch:string|null;prunable:boolean;locked:boolean;valid:boolean}
export interface GitProjectProbeResult {
 canonical_root:string;common_dir:string;branch:string|null;head:string;origin:string|null;observed_at:number;
 inventory:{observed_at:number;common_dir:string;entries:GitWorktreeEntry[]};
}
export interface GitProjectProbe {observe(root:string):Promise<GitProjectProbeResult>}
export interface GitVolumeProof {binding_id:string;observed_uuid:string;observed_at:number;canonical_root_present:boolean;state:"verified"}
export interface GitProjectEvidence {
 schema:"temperance.git-project-evidence.v1";state:"verified"|"held";reason_code:string;project_id:string;
 execution_authorized:false;lease_authorized:false;observed_at:number;mode:"read"|"write";capsule_access:"read-only"|"read-write";
 fingerprints?:{capsule:string;host_binding:string;root:string;common_dir:string;branch:string;inventory:string;volume:string};
 repository_identity?:string;head?:string;linked_worktree?:boolean;
}
export interface VerifyGitProjectOptions {
 capsule:unknown;binding:unknown;probe:GitProjectProbe;now:()=>number;
 /** Explicit private target; linked worktrees are proved by exact Git inventory membership. */ worktree_root?:string;
 volume_proofs?:GitVolumeProof[];mode?:"read"|"write";
}
const hash=(value:unknown)=>`sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
function safe(value:unknown,depth=0,count={n:0}):void{
 if(++count.n>8192||depth>16)throw new Error("GIT_PROJECT_INVALID_INPUT");
 if(value===null||typeof value==="boolean"||typeof value==="number"&&Number.isSafeInteger(value))return;
 if(typeof value==="string"){if(value.length>8192)throw new Error("GIT_PROJECT_INVALID_INPUT");return;}
 if(typeof value!=="object"||types.isProxy(value))throw new Error("GIT_PROJECT_INVALID_INPUT");
 if(Array.isArray(value)){if(Object.getPrototypeOf(value)!==Array.prototype||value.length>512||Reflect.ownKeys(value).length!==value.length+1)throw new Error("GIT_PROJECT_INVALID_INPUT");}else if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error("GIT_PROJECT_INVALID_INPUT");
 for(const key of Reflect.ownKeys(value)){if(Array.isArray(value)&&key==="length")continue;if(typeof key!=="string"||["__proto__","constructor","prototype"].includes(key))throw new Error("GIT_PROJECT_INVALID_INPUT");const d=Object.getOwnPropertyDescriptor(value,key)!;if(d.get||d.set||!d.enumerable)throw new Error("GIT_PROJECT_INVALID_INPUT");safe(d.value,depth+1,count);}
}
function immutable<T>(value:T):T{if(value&&typeof value==="object"){for(const v of Object.values(value))immutable(v);Object.freeze(value);}return value;}
function exact(v:object,keys:string[]):boolean{return Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));}
function inventoryGeneration(entries:GitWorktreeEntry[]):string{return hash([...entries].sort((a,b)=>a.path.localeCompare(b.path)));}
function validBranch(value:unknown):boolean{return value===null||typeof value==="string"&&value.length>0&&value.length<=512&&!/[\x00-\x1f]/.test(value);}
function probeSnapshot(input:unknown):GitProjectProbeResult {
 safe(input);if(Buffer.byteLength(JSON.stringify(input))>65536)throw new Error("GIT_PROJECT_INVALID_INPUT");
 const p=input as GitProjectProbeResult;
 if(p.origin!==null&&(typeof p.origin!=="string"||p.origin.length>8192))throw new Error("GIT_PROJECT_INVALID_INPUT");
 if(!exact(p,["canonical_root","common_dir","branch","head","origin","observed_at","inventory"])||!p.inventory||!exact(p.inventory,["observed_at","common_dir","entries"])||!Array.isArray(p.inventory.entries)||p.inventory.entries.length>512)throw new Error("GIT_PROJECT_INVALID_INPUT");
 for(const e of p.inventory.entries)if(!e||!exact(e,["path","head","branch","prunable","locked","valid"])||!path(e.path)||!validBranch(e.branch)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(e.head)||typeof e.valid!=="boolean"||typeof e.prunable!=="boolean"||typeof e.locked!=="boolean")throw new Error("GIT_PROJECT_INVALID_INPUT");
 return structuredClone(p);
}
function path(value:unknown):value is string{return typeof value==="string"&&value.length>1&&value.length<=4096&&isAbsolute(value)&&normalize(value)===value&&!/[\x00-\x1f]/.test(value);}
function inside(root:string,target:string):boolean{const p=relative(root,target);return p===""||(!p.startsWith("..")&&!isAbsolute(p));}
function fresh(time:number,now:number):boolean{return Number.isSafeInteger(time)&&time<=now&&now-time<=300000;}
/** Source identity evidence only; a verified result does not authorize execution or a lease. */
export async function verifyGitProjectAdmission(options:VerifyGitProjectOptions):Promise<GitProjectEvidence>{
 for(const value of [options.capsule,options.binding,options.volume_proofs??[]]){safe(value);if(Buffer.byteLength(JSON.stringify(value))>65536)throw new Error("GIT_PROJECT_INVALID_INPUT");}
 if(!validateProjectCapsuleV1(options.capsule)||!validateHostBindingV1(options.binding))throw new Error("GIT_PROJECT_INVALID_INPUT");
 const proofs=structuredClone(options.volume_proofs??[]);
 for(const proof of proofs)if(!proof||!exact(proof,["binding_id","observed_uuid","observed_at","canonical_root_present","state"])||typeof proof.binding_id!=="string"||! /^[A-Za-z0-9_.-]{1,128}$/.test(proof.binding_id)||typeof proof.observed_uuid!=="string"||proof.observed_uuid.length>256||typeof proof.canonical_root_present!=="boolean"||!Number.isSafeInteger(proof.observed_at)||proof.state!=="verified")throw new Error("GIT_PROJECT_INVALID_INPUT");
 if(new Set(proofs.map(p=>p.binding_id)).size!==proofs.length)throw new Error("GIT_PROJECT_INVALID_INPUT");
 const capsule=structuredClone(options.capsule) as ProjectCapsuleV1,binding=structuredClone(options.binding) as HostBindingV1;
 const requestedTarget=options.worktree_root;const clock=options.now;const observe=options.probe.observe.bind(options.probe);const mode=options.mode??"read";if(mode!=="read"&&mode!=="write")throw new Error("GIT_PROJECT_INVALID_INPUT");
 const initialNow=clock();if(!Number.isSafeInteger(initialNow))throw new Error("GIT_PROJECT_INVALID_INPUT");
 const held=(code:string):GitProjectEvidence=>immutable({schema:"temperance.git-project-evidence.v1",state:"held",reason_code:code,project_id:capsule.id,execution_authorized:false,lease_authorized:false,observed_at:initialNow,mode,capsule_access:capsule.access});
 if(!capsule.approved)return held("PROJECT_NOT_APPROVED");
 if(mode==="write"&&capsule.access!=="read-write")return held("PROJECT_READ_ONLY");
 const base=binding.variables[capsule.root_variable];if(!path(base)||capsule.relative_path.includes("\\")||capsule.relative_path.includes("\0")||isAbsolute(capsule.relative_path)||capsule.relative_path.split("/").includes("..")||normalize(capsule.relative_path)!==capsule.relative_path)return held("PROJECT_PATH_UNSAFE");
 const declaredRoot=resolve(base,capsule.relative_path);if(!inside(base,declaredRoot))return held("PROJECT_PATH_UNSAFE");
 const target=requestedTarget??declaredRoot;if(!path(target))return held("PROJECT_PATH_UNSAFE");
 let primary:GitProjectProbeResult,current:GitProjectProbeResult;
 try{primary=probeSnapshot(await observe(declaredRoot));current=target===declaredRoot?primary:probeSnapshot(await observe(target));}catch{return held("GIT_PROBE_FAILED");}
 const now=clock();if(!Number.isSafeInteger(now)||now<initialNow)return held("CLOCK_INVALID");
 for(const p of [primary,current]){
  if(!path(p.canonical_root)||!path(p.common_dir)||!path(p.inventory.common_dir)||!Array.isArray(p.inventory.entries))return held("GIT_PROBE_INVALID");
  if(!fresh(p.observed_at,now)||!fresh(p.inventory.observed_at,now))return held("GIT_PROBE_STALE");
  if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(p.head)||p.branch!==null&&(typeof p.branch!=="string"||p.branch.length>512||/[\x00-\x1f]/.test(p.branch)))return held("GIT_PROBE_INVALID");
  if(p.inventory.common_dir!==p.common_dir||new Set(p.inventory.entries.map(e=>e.path)).size!==p.inventory.entries.length||!p.inventory.entries.some(e=>e.path===p.canonical_root))return held("WORKTREE_INVENTORY_MISMATCH");
 }
 if(primary.canonical_root!==declaredRoot||current.canonical_root!==target)return held("GIT_ROOT_MISMATCH");
 if(primary.common_dir!==current.common_dir||!primary.inventory.entries.some(e=>e.path===target)||!current.inventory.entries.some(e=>e.path===declaredRoot)||inventoryGeneration(primary.inventory.entries)!==inventoryGeneration(current.inventory.entries))return held("WORKTREE_INVENTORY_MISMATCH");
 for(const p of [primary,current]){const entry=p.inventory.entries.find(e=>e.path===p.canonical_root)!;if(!entry.valid||entry.prunable||entry.locked||entry.head!==p.head||entry.branch!==p.branch)return held("WORKTREE_IDENTITY_MISMATCH");}
 if(!primary.origin||!current.origin)return held("LOCAL_REPOSITORY_IDENTITY_UNDEFINED");
 const expected=capsule.repository_identity.toLowerCase();const repo=normalizeRepositoryIdentity(primary.origin),targetRepo=normalizeRepositoryIdentity(current.origin);
 if(expected.length>256||!/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(expected)||repo!==expected||targetRepo!==expected)return held("REPOSITORY_IDENTITY_MISMATCH");
 const verifiedVolumes:unknown[]=[];
 for(const volume of binding.volume_bindings){const mount=binding.variables[volume.mount_path_variable];if(!path(mount))return held("VOLUME_BINDING_INVALID");if(!inside(mount,declaredRoot)&&!inside(mount,target))continue;
 const proof=proofs.find(p=>p.binding_id===volume.id);if(!proof||proof.state!=="verified"||!proof.canonical_root_present||proof.observed_uuid!==volume.volume_uuid||!fresh(proof.observed_at,now))return held("VOLUME_NOT_VERIFIED");verifiedVolumes.push({binding_id:volume.id,uuid:proof.observed_uuid});}
 return immutable({schema:"temperance.git-project-evidence.v1",state:"verified",reason_code:"GIT_IDENTITY_VERIFIED",project_id:capsule.id,execution_authorized:false,lease_authorized:false,observed_at:now,mode,capsule_access:capsule.access,repository_identity:repo,head:current.head,linked_worktree:target!==declaredRoot,fingerprints:{capsule:hash(capsule),host_binding:hash(binding),root:hash(target),common_dir:hash(current.common_dir),branch:hash(current.branch),inventory:inventoryGeneration(current.inventory.entries),volume:hash(verifiedVolumes)}});
}
export const GIT_PROJECT_HELD_REASONS=["PROJECT_NOT_APPROVED","PROJECT_READ_ONLY","PROJECT_PATH_UNSAFE","GIT_PROBE_FAILED","CLOCK_INVALID","GIT_PROBE_INVALID","GIT_PROBE_STALE","WORKTREE_INVENTORY_MISMATCH","GIT_ROOT_MISMATCH","WORKTREE_IDENTITY_MISMATCH","LOCAL_REPOSITORY_IDENTITY_UNDEFINED","REPOSITORY_IDENTITY_MISMATCH","VOLUME_BINDING_INVALID","VOLUME_NOT_VERIFIED"] as const;
/** Closed evidence validation proves contract shape, never authenticity or execution permission. */
export function validateGitProjectEvidence(value:unknown):value is GitProjectEvidence {
 try {
  safe(value);if(Buffer.byteLength(JSON.stringify(value))>65536)return false;
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as GitProjectEvidence;
  const base=["schema","state","reason_code","project_id","execution_authorized","lease_authorized","observed_at","mode","capsule_access"];
  if(v.schema!=="temperance.git-project-evidence.v1"||typeof v.project_id!=="string"||!/^[A-Za-z0-9_.-]{1,128}$/.test(v.project_id)||v.execution_authorized!==false||v.lease_authorized!==false||!Number.isSafeInteger(v.observed_at)||!["read","write"].includes(v.mode)||!["read-only","read-write"].includes(v.capsule_access))return false;
  if(v.state==="held")return exact(v,base)&&(GIT_PROJECT_HELD_REASONS as readonly string[]).includes(v.reason_code);
  if(v.state!=="verified"||!exact(v,[...base,"fingerprints","repository_identity","head","linked_worktree"])||v.reason_code!=="GIT_IDENTITY_VERIFIED"||v.mode==="write"&&v.capsule_access!=="read-write"||typeof v.linked_worktree!=="boolean"||typeof v.head!=="string"||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(v.head)||typeof v.repository_identity!=="string"||v.repository_identity.length>256||!/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(v.repository_identity)||!v.fingerprints||!exact(v.fingerprints,["capsule","host_binding","root","common_dir","branch","inventory","volume"]))return false;
  return Object.values(v.fingerprints).every(d=>typeof d==="string"&&/^sha256:[a-f0-9]{64}$/.test(d));
 }catch{return false;}
}
/** Local read-only Git commands. No remote contact, shell interpolation, host discovery or hooks. */
export function createLocalGitProjectProbe(now:()=>number=Date.now,gitExecutable="/usr/bin/git"):GitProjectProbe{
 if(typeof now!=="function"||!path(gitExecutable))throw new Error("GIT_PROJECT_INVALID_INPUT");
 const childEnv={PATH:"/usr/bin:/bin",HOME:"/nonexistent",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0"};
 return {async observe(root){
  if(!path(root))throw new Error("GIT_PROJECT_INVALID_INPUT");
  const git=(args:string[])=>execFileSync(gitExecutable,["-C",root,...args],{encoding:"utf8",timeout:5000,maxBuffer:65536,env:childEnv}).trim();
  const canonical_root=realpathSync(root);const top=realpathSync(git(["rev-parse","--show-toplevel"]));if(top!==canonical_root)throw new Error("GIT_ROOT_MISMATCH");
  const common_dir=realpathSync(resolve(root,git(["rev-parse","--git-common-dir"])));
  const readBranch=():string|null=>{try{return git(["symbolic-ref","--quiet","--short","HEAD"]);}catch{return null;}};
  const readOrigin=():string|null=>{try{return git(["config","--get","remote.origin.url"]);}catch{return null;}};
  const inventory=()=>execFileSync(gitExecutable,["-C",root,"worktree","list","--porcelain","-z"],{encoding:"utf8",timeout:5000,maxBuffer:65536,env:childEnv});
  const branch=readBranch(),origin=readOrigin(),head=git(["rev-parse","HEAD"]),inventoryRaw=inventory();
  if(git(["rev-parse","HEAD"])!==head||readBranch()!==branch||readOrigin()!==origin||inventory()!==inventoryRaw||realpathSync(root)!==canonical_root||realpathSync(git(["rev-parse","--show-toplevel"]))!==canonical_root||realpathSync(resolve(root,git(["rev-parse","--git-common-dir"])))!==common_dir)throw new Error("GIT_SOURCE_DRIFT");
  const entries:GitWorktreeEntry[]=[];
  let fields:string[]=[];
  const finish=()=>{
   if(!fields.length)return;
   const paths=fields.filter(f=>f.startsWith("worktree ")),heads=fields.filter(f=>f.startsWith("HEAD ")),branches=fields.filter(f=>f.startsWith("branch "));
   if(paths.length!==1||heads.length!==1||branches.length>1||fields.some(f=>!/^worktree |^HEAD |^branch |^detached$|^locked(?: |$)|^prunable(?: |$)/.test(f)))throw new Error("GIT_INVENTORY_INVALID");
   const detached=fields.filter(f=>f==="detached"),locks=fields.filter(f=>f.startsWith("locked")),prunes=fields.filter(f=>f.startsWith("prunable"));
   if(detached.length>1||locks.length>1||prunes.length>1||(branches.length===1)===(detached.length===1))throw new Error("GIT_INVENTORY_INVALID");
   const p=paths[0]!.slice(9),prunable=fields.some(f=>f.startsWith("prunable")),locked=fields.some(f=>f.startsWith("locked"));let canonicalPath=p,valid=true;try{canonicalPath=realpathSync(p);}catch{valid=false;}
   entries.push({path:canonicalPath,head:heads[0]!.slice(5),branch:branches[0]?.slice(7).replace(/^refs\/heads\//,"")??null,prunable,locked,valid});fields=[];
  };
  for(const field of inventoryRaw.split("\0")){if(field)fields.push(field);else finish();}finish();if(entries.length>512)throw new Error("GIT_INVENTORY_INVALID");
  const observed_at=now();if(!Number.isSafeInteger(observed_at))throw new Error("GIT_PROJECT_INVALID_INPUT");return {canonical_root,common_dir,branch,head,origin,observed_at,inventory:{observed_at,common_dir,entries}};
 }};
}
