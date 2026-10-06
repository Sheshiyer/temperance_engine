import {expect,test} from "bun:test";
import {runGitAuthorityCommand as run} from "../src/execution/git-authority-cli.ts";
import {gitDeliveryTicketFingerprint,gitExecutionGrantFingerprint,evaluateGitAuthorityEligibility} from "../src/execution/git-authority-contracts.ts";
const now=Date.parse("2026-10-05T12:00:00.000Z"),iso=(n:number)=>new Date(n).toISOString(),sha=`sha256:${"a".repeat(64)}`;
function fixture(){
 const workspace={kind:"git",project_id:"project",repository_identity:"github.com/example/project",capsule_id:"capsule",admission_fingerprint:sha,workspace_fingerprint:sha,root_fingerprint:sha,source_commit:"a".repeat(40),source_fingerprint:sha};
 const ticket={schema:"temperance.git-delivery-ticket.v2",workspace,ticket_id:"ticket",plan_id:"plan",task_id:"task",phase:"Execute",effort:"E3",lane:"noesis-execute",outstanding_work:1,created_at:iso(now-1000)};
 const grant={schema:"temperance.git-execution-grant.v2",workspace,grant_id:"grant",ticket_fingerprint:gitDeliveryTicketFingerprint(ticket),allowed_phases:["Execute"],allowed_lanes:["noesis-execute"],issued_at:iso(now-500),expires_at:iso(now+60000),retry_budget:2,time_budget_ms:10000};
 const admission={schema:"temperance.git-project-admission-envelope.v2",mode:"context-only",workspace,status:"context-verified",observed_at:iso(now-100),expires_at:iso(now+1000),execution_authorized:false,capacity_authorization:false,lease_authorized:false};
 return {ticket,grant,admission,expected_grant_fingerprint:gitExecutionGrantFingerprint(grant),retries_used:0,elapsed_ms:0,now};
}
async function actual(args:string[],input:string|Uint8Array,dedicated=false){const child=Bun.spawn([process.execPath,...(dedicated?["src/execution/git-authority-cli.ts"]:["src/cli.ts","git-authority"]),...args],{stdin:"pipe",stdout:"pipe",stderr:"pipe"});child.stdin.write(input);child.stdin.end();const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};}
test("context CLI invokes actual evaluator without granting authority",async()=>{
 const p=fixture(),r=await run(["inspect"],()=>JSON.stringify(p));expect(r.code).toBe(0);expect(r.stderr).toBe("");expect(r.stdout.endsWith("\n")).toBe(true);expect(JSON.parse(r.stdout)).toEqual(evaluateGitAuthorityEligibility(p));const out=JSON.parse(r.stdout);expect(out.context_eligible).toBe(true);expect(out.claim_status).toBe("held-authority-migration");for(const field of ["execution_authorized","capacity_authorization","lease_authorized"])expect(out[field]).toBe(false);expect(r.stdout).not.toContain("repository_identity");expect(r.stdout).not.toContain("github.com");
});
test("strict argv rejects before reading including zero-trap proxies and getters",async()=>{
 let reads=0,traps=0;const reader=()=>{reads++;return "{}";};for(const args of [[],["apply"],["inspect","--now",String(now)],["inspect","--output","/private/context"]])expect((await run(args,reader)).stderr).toContain("GIT_AUTHORITY_CLI_INVALID_ARGUMENTS");const getter=["inspect"];Object.defineProperty(getter,"0",{get(){traps++;return "inspect";}});expect((await run(getter,reader)).code).toBe(2);const proxy=new Proxy(["inspect"],{get(){traps++;throw Error("private");},ownKeys(){traps++;throw Error("private");}});expect((await run(proxy,reader)).code).toBe(2);expect(reads).toBe(0);expect(traps).toBe(0);
});
test("closed context rejects injected observers paths issuer and authority with fixed errors",async()=>{
 for(const mutate of [(p:any)=>p.observer={},(p:any)=>p.probe={},(p:any)=>p.issuer_authority=true,(p:any)=>p.execution_authorized=true,(p:any)=>p.private_path="/private/context",(p:any)=>p.ticket.workspace.root="/private/context",(p:any)=>p.admission.execution_authorized=true,(p:any)=>delete p.now]){const p=fixture();mutate(p);const r=await run(["inspect"],()=>JSON.stringify(p));expect(r.code).toBe(2);expect(r.stdout).toBe("");expect(r.stderr).toBe('{"error":"GIT_AUTHORITY_CLI_INVALID_CONTEXT"}\n');}
});
test("bounded read failures malformed JSON and nonpacket data remain redacted",async()=>{
 for(const raw of ["{", "null", "[]", '"/private/context"'," ".repeat(65537),"é".repeat(32769)]){const r=await run(["inspect"],()=>raw);expect(r.code).toBe(2);expect(r.stdout).toBe("");expect(r.stderr).not.toContain("private/context");}const r=await run(["inspect"],()=>{throw Error("/private/context secret");});expect(r.stderr).toBe('{"error":"GIT_AUTHORITY_CLI_READ_FAILED"}\n');
});
test("explicit caller time and expected fingerprint produce context consistency only",async()=>{
 const p=fixture();p.expected_grant_fingerprint=`sha256:${"b".repeat(64)}`;let r=JSON.parse((await run(["inspect"],()=>JSON.stringify(p))).stdout);expect(r.reason_code).toBe("grant-fingerprint-mismatch");p.expected_grant_fingerprint=gitExecutionGrantFingerprint(p.grant);p.now+=1000;r=JSON.parse((await run(["inspect"],()=>JSON.stringify(p))).stdout);expect(r.reason_code).toBe("admission-expired");expect(r.execution_authorized).toBe(false);expect(r.lease_authorized).toBe(false);
});
test("actual main subprocess command emits only evaluator result",async()=>{
 const p=fixture(),r=await actual(["inspect"],JSON.stringify(p));expect(r.code).toBe(0);expect(r.stderr).toBe("");expect(r.stdout.endsWith("\n")).toBe(true);expect(JSON.parse(r.stdout)).toEqual(evaluateGitAuthorityEligibility(p));expect(r.stdout).not.toContain("superset");expect(r.stdout).not.toContain("/Users/");const held=await actual(["inspect"],JSON.stringify({...p,elapsed_ms:10000}));expect(held.code).toBe(0);expect(JSON.parse(held.stdout).reason_code).toBe("time-budget-exhausted");
});
test("actual main rejects malformed UTF8 oversized stdin and unknown argv without raw output",async()=>{
 for(const [args,input] of [[["inspect"],new Uint8Array([0xc3,0x28])],[["inspect"]," ".repeat(65537)],[["inspect","--private","/private/context"],JSON.stringify(fixture())]] as Array<[string[],string|Uint8Array]>){const r=await actual(args,input);expect(r.code).toBe(2);expect(r.stdout).toBe("");expect(r.stderr).toMatch(/^\{"error":"GIT_AUTHORITY_CLI_[A-Z_]+"\}\n$/);expect(r.stderr).not.toContain("/private/context");}
});

test("dedicated three-file closure entry evaluates without broad interactive CLI",async()=>{
 const p=fixture(),r=await actual(["inspect"],JSON.stringify(p),true);expect(r.code).toBe(0);expect(r.stderr).toBe("");expect(r.stdout.endsWith("\n")).toBe(true);expect(JSON.parse(r.stdout)).toEqual(evaluateGitAuthorityEligibility(p));const bad=await actual(["apply"],"/private/context",true);expect(bad.code).toBe(2);expect(bad.stderr).toBe('{"error":"GIT_AUTHORITY_CLI_INVALID_ARGUMENTS"}\n');
});
