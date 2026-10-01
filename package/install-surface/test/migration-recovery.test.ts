import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";
import { tmpdir } from "node:os";
import { Journal, type LifecycleIO } from "../src/lifecycle/journal.ts";
import { rollbackTransaction } from "../src/lifecycle/executor.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function temporary() { const root = await fs.mkdtemp(join(tmpdir(), "migration-recovery-")); roots.push(root); return root; }
const nativeRename = process.platform === "darwin" ? dlopen("/usr/lib/libSystem.B.dylib", { renamex_np: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }, __error: { args: [], returns: FFIType.ptr } }) : null;
function diskIO(): LifecycleIO {
  return { mkdir: async (p,o) => { await fs.mkdir(p,o); }, writeFile: (p,d) => fs.writeFile(p,d), readFile: p => fs.readFile(p,"utf8"), readdir: p => fs.readdir(p), rm: (p,o) => fs.rm(p,o), lstat: p => fs.lstat(p), chmod: (p,m) => fs.chmod(p,m), rename: (a,b) => fs.rename(a,b), realpath: p => fs.realpath(p), now: () => new Date("2026-10-01T00:00:04Z"),
    renameNoReplace: nativeRename ? async (a,b) => {
      const from=Buffer.from(`${a}\0`),to=Buffer.from(`${b}\0`);
      // Darwin sys/stdio.h: RENAME_EXCL=0x4; actual atomic kernel primitive.
      if(nativeRename.symbols.renamex_np(ptr(from),ptr(to),0x4)!==0) {
        const errno=new Int32Array(toArrayBuffer(nativeRename.symbols.__error()!,0,4))[0];
        throw Object.assign(new Error("NOREPLACE_FAILED"),{code:errno===17?"EEXIST":"NATIVE_RENAME_FAILED",errno});
      }
    } : undefined,
    writeFileAtomic: async (p,d,o) => { const temp = `${p}.writing`; const handle = await fs.open(temp,"w",o?.mode ?? 0o600); try { await handle.writeFile(d); await handle.sync(); } finally { await handle.close(); } await fs.chmod(temp,o?.mode ?? 0o600); await fs.rename(temp,p); },
    fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); }, execFile: async () => { throw new Error("EXEC_FORBIDDEN"); } };
}
test("failed journal append does not cache a phantom durable fact", async () => {
  const root = await temporary(), io = diskIO(), journal = await Journal.create(root,io);
  io.writeFileAtomic = async () => { throw new Error("disk-failure"); };
  await expect(journal.append({kind:"ABORT",ts:"fixture",reason:"fixture"})).rejects.toThrow();
  expect(await journal.readEntries()).toEqual(await Journal.open(journal.txDir,diskIO()).readEntries());
});
test("uncertain append reloads disk and concurrent same-instance appends serialize", async () => {
  const root = await temporary(), io = diskIO(), journal = await Journal.create(root,io);
  const write = io.writeFileAtomic; let first = true;
  io.writeFileAtomic = async (...args) => { await write(...args); if(first) { first=false; throw new Error("durable-then-reject"); } };
  await expect(journal.append({kind:"ABORT",ts:"fixture",reason:"first"})).rejects.toThrow();
  expect(await journal.readEntries()).toHaveLength(1);
  await Promise.all([journal.append({kind:"ABORT",ts:"fixture",reason:"second"}),journal.append({kind:"ABORT",ts:"fixture",reason:"third"})]);
  expect(await Journal.open(journal.txDir,diskIO()).readEntries()).toHaveLength(3);
});
test("orphan partial capture without BEGIN never succeeds as empty rollback", async () => {
  const root = await temporary(), txid = "123456789abc-12345678";
  await fs.mkdir(join(root,"transactions",txid,"preimage"),{recursive:true});
  await fs.writeFile(join(root,"transactions",txid,"preimage","partial"),"owned-before");
  expect((await rollbackTransaction(txid,root,diskIO())).status).toBe("failed");
});

import { createCoreOnboardingCatalog } from "../src/onboarding/core-catalog.ts";
import { workstationSnapshot, makeExpectedContext, fakeDigest } from "./migration-fixtures.ts";
import { createMigrationPlan, calculateMigrationInputDigests, type CreateMigrationPlanOptions, type MigrationPlannerInputs, type MigrationPlanV1, type MigrationPlanReviewContext } from "../src/migration/planner.ts";
import { recoverMigration, createMigrationOperation, migrationPreimageDigest, type MigrationRecoveryOptions, type MigrationRecoveryAction } from "../src/migration/recovery.ts";
import { sha256 } from "../src/lifecycle/copy-tree.ts";
function plannerFixture(profile: "workstation" | "always-on-node" = "workstation"): CreateMigrationPlanOptions {
  const base: Omit<CreateMigrationPlanOptions, "source_context"> = {
    snapshot: structuredClone(workstationSnapshot),
    target: { schema: "temperance.migration.target.v1" as const, version: { major: 1, minor: 0 }, target_profile: profile,
      destination_id: "destination:fixture", compatibility_check_only: true, requested_modules: ["core.fixture"], held_requirements: [] },
    profile, selected_modules: ["core.fixture"], backend: "none" as const,
    catalog: { ...createCoreOnboardingCatalog(), modules: [{ id: "core.fixture", title: "Fixture", summary: "Owned fixture", preselection: "available" as const,
      depends_on: [], requires: [], guided_installs: [] }, ...createCoreOnboardingCatalog().modules] },
    host_profile: { schema: "temperance.host-profile.v1" as const, version: { major: 1 as const, minor: 0 as const }, id: "fixture",
      variables: [{ name: "STATE_ROOT", kind: "absolute-path" as const, required: true }], secret_references: [],
      preselected_modules: ["provider.9router"], required_routing_aliases: [] },
    private_binding: { schema: "temperance.host-binding.v1" as const, version: { major: 1 as const, minor: 0 as const }, profile_id: "fixture",
      variables: { STATE_ROOT: ["", "private", "fixture", "temperance"].join("/") }, secret_references: {}, routing_aliases: [], volume_bindings: [] },
    module_bindings: [{ module_id: "core.fixture", owner: "temperance", version: "1.0.0", source_digest: fakeDigest("fixture-module"),
      destinations: [{ id: "config.fixture", root_ref: "STATE_ROOT", relative_path: "config/fixture.json", effect: "configuration-create" as const,
        prepared_digest: fakeDigest("prepared"), preimage_digest: fakeDigest("absent"), mode: 384 }], runtime_requirements: [] }],
    destination: { destination_id: "destination:fixture", issued_device_ref: "device:fixture-issued", identity_digest: fakeDigest("destination-identity"),
      platform: "darwin", architecture: "arm64", free_bytes: 8192, required_bytes: 1024, port_20128: "free" as const,
      roots: [{ root_ref: "STATE_ROOT", owner: "temperance", identity_digest: fakeDigest("root-identity"), state: "available" as const }], runtime_environments: [] },
    observations: [], expected_context: makeExpectedContext({ required_work_ids: ["work:modular-mac-phase-a"], required_organ_ids: [] }),
    now: "2026-10-01T00:00:02Z",
  };
  const digests = calculateMigrationInputDigests(base);
  return { ...base, source_context: { ...digests, destination_id: base.destination.destination_id, issued_device_ref: base.destination.issued_device_ref,
    profile, backend: base.backend, selected_modules: [...base.selected_modules], pinned_at: "2026-10-01T00:00:01Z", expires_at: "2026-10-02T00:00:00Z" } };
}

async function migrationFixture(existing = true, leafCount = 1) {
  const root = await temporary(), home = join(root,"destination"), state = join(root,"state"), evidence = join(root,"evidence.json");
  await fs.mkdir(home); await fs.mkdir(state);
  const destination = join(home,"config","fixture.json");
  await fs.mkdir(join(home,"config"));
  const prior = "owned-before\n", output = "owned-after\n";
  if(existing) { await fs.writeFile(destination,prior); await fs.chmod(destination,0o640); }
  await fs.writeFile(join(home,"identical-unowned"),output,{mode:0o644});
  await fs.writeFile(join(home,"different-user"),"leave-this-user-file\n",{mode:0o600});
  const options = plannerFixture();
  options.private_binding.variables.STATE_ROOT = home;
  const requirement = options.module_bindings[0]!.destinations[0]!;
  requirement.prepared_digest = `sha256:${sha256(output)}`;
  requirement.preimage_digest = migrationPreimageDigest(existing ? sha256(prior) : null, existing ? 0o640 : null) as `sha256:${string}`;
  for(let index=1;index<leafCount;index++) {
    const extra={...requirement,id:`config.fixture${index}`,relative_path:`config/fixture${index}.json`};
    options.module_bindings[0]!.destinations.push(extra);
    if(existing){await fs.writeFile(join(home,extra.relative_path),prior);await fs.chmod(join(home,extra.relative_path),0o640);}
  }
  Object.assign(options.source_context,calculateMigrationInputDigests(options));
  const plan = await createMigrationPlan(options);
  expect(plan.holds).toEqual([]);
  const {pinned_at:_p,expires_at:_e,...context} = options.source_context;
  const review: MigrationPlanReviewContext = {...context,plan_digest:plan.plan_digest,reviewed_at:"2026-10-01T00:00:03Z",expires_at:"2026-10-02T00:00:00Z"};
  const operation = createMigrationOperation();
  await fs.writeFile(evidence,JSON.stringify(options));
  await fs.writeFile(join(root,"packet.json"),JSON.stringify({plan,review,operation}));
  const run = async (action: MigrationRecoveryAction, io = diskIO(), overrides: Partial<MigrationRecoveryOptions> = {}) => {
    // Every restart loads a new packet, new authority, new IO and new Journal.
    const packet = JSON.parse(await fs.readFile(join(root,"packet.json"),"utf8"));
    return recoverMigration({ ...packet, action, io, stateRoot:state, root_tokens:{STATE_ROOT:"HOME"}, prepared:action === "apply" ? new Map(plan.steps.map(step=>[step.id,output])) : undefined,
      authority:{authorize:async () => ({authorized:true,owned_step_ids:plan.steps.map(step=>step.id),lifecycle_state_root:state,remote_outcome:"none"}),readFreshInputs:async reader => JSON.parse(await reader.readFile(evidence)) as MigrationPlannerInputs}, ...overrides });
  };
  return {root,home,state,evidence,destination,prior,output,plan,review,operation,run};
}
test("owned configuration applies, disk-only resumes and restores exact preimage with preserved sentinels",async () => {
  const f = await migrationFixture();
  expect((await f.run("apply")).status).toBe("committed");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
  expect((await f.run("status")).status).toBe("committed");
  expect((await f.run("resume")).status).toBe("committed");
  expect((await f.run("rollback")).status).toBe("rolled-back");
  expect((await f.run("status")).status).toBe("rolled-back");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
  expect((await fs.stat(f.destination)).mode & 0o777).toBe(0o640);
  expect(await fs.readFile(join(f.home,"identical-unowned"),"utf8")).toBe(f.output);
  expect((await fs.stat(join(f.home,"identical-unowned"))).mode & 0o777).toBe(0o644);
  expect(await fs.readFile(join(f.home,"different-user"),"utf8")).toBe("leave-this-user-file\n");
});

/** An injected rejection can happen before OR after the real disk effect. */
function traceIO(base: LifecycleIO, trace: string[], failAt = -1, after = false): LifecycleIO {
  let sequence = 0;
  return new Proxy(base,{ get(target,key:keyof LifecycleIO) {
    const value=target[key];
    if(typeof value !== "function" || key === "now") return value;
    return async (...args: unknown[]) => {
      const path = String(args[0]);
      const included = ["writeFileAtomic","rename","renameNoReplace","readFile","lstat","mkdir","rm"].includes(key)
        && (/surface-|custody-|surface-manifest|journal\.json|receipt\.json|temperance-stage|fixture\.json|surface-restore/.test(path));
      const marker = included ? sequence++ : -1;
      if(included) trace.push(`${key}:${path.replace(/.*\/(transactions\/[^/]+\/)?/,"")}:${key === "writeFileAtomic" && path.endsWith("journal.json") ? JSON.parse(String(args[1])).at(-1).kind : ""}`);
      if(included && marker===failAt && !after) throw new Error("injected-before");
      const result = await (value as (...a:unknown[])=>unknown).apply(target,args);
      if(included && marker===failAt && after) throw new Error("injected-after");
      return result;
    };
  } }) as LifecycleIO;
}
test("every capture, journal, stage, verification, promotion and receipt IO boundary recovers from fresh disk",async () => {
  const baseline=await migrationFixture(), trace:string[]=[];
  expect((await baseline.run("apply",traceIO(diskIO(),trace))).status).toBe("committed");
  for(const after of [false,true]) for(let index=0;index<trace.length;index++) {
    const f=await migrationFixture();
    await f.run("apply",traceIO(diskIO(),[],index,after));
    const status=await f.run("status");
    const resumed=await f.run("resume");
    if(status.status === "incomplete" || status.status === "committed") {
      expect(resumed.status,`apply boundary ${index} ${after} ${trace[index]}`).toBe("committed");
      expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
      expect((await f.run("rollback")).status).toBe("rolled-back");
      expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
    } else expect(resumed.status).toBe("manual-recovery");
    expect(await fs.readFile(join(f.home,"identical-unowned"),"utf8")).toBe(f.output);
    expect(await fs.readFile(join(f.home,"different-user"),"utf8")).toBe("leave-this-user-file\n");
  }
  console.info(`apply fault matrix: ${trace.length} boundaries x before/after`);
},120000);
test("every compensation boundary preserves restore facts and never rolls forward after rollback intent",async () => {
  const baseline=await migrationFixture(); await baseline.run("apply"); const trace:string[]=[];
  expect((await baseline.run("rollback",traceIO(diskIO(),trace))).status).toBe("rolled-back");
  for(const after of [false,true]) for(let index=0;index<trace.length;index++) {
    const f=await migrationFixture(); await f.run("apply");
    await f.run("rollback",traceIO(diskIO(),[],index,after));
    const recovered=await f.run("rollback");
    expect(recovered.status,`rollback boundary ${index} ${after} ${trace[index]}`).toBe("rolled-back");
    expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
    expect((await fs.stat(f.destination)).mode & 0o777).toBe(0o640);
    expect((await f.run("resume")).status).toBe("rolled-back");
  }
  console.info(`rollback fault matrix: ${trace.length} boundaries x before/after`);
},120000);

for (const drift of ["source-release","module-lock","snapshot","selection","module-source","identity","observation","binding","prepared-intent","preimage","generation"] as const) test(`fresh disk evidence ${drift} drift holds resume and rollback`,async () => {
  const f=await migrationFixture(); expect((await f.run("apply")).status).toBe("committed");
  const source=JSON.parse(await fs.readFile(f.evidence,"utf8")) as CreateMigrationPlanOptions;
  if(drift === "source-release") source.snapshot.source_release_digest=fakeDigest("different-release");
  if(drift === "module-lock") source.snapshot.module_lock_digest=fakeDigest("different-lock");
  if(drift === "snapshot") source.snapshot.observed_at="2026-10-01T00:00:00Z";
  if(drift === "selection") source.selected_modules=[];
  if(drift === "module-source") source.module_bindings[0]!.source_digest=fakeDigest("different-module");
  if(drift === "identity") source.destination.identity_digest=fakeDigest("different-device");
  if(drift === "observation") source.destination.free_bytes=4096;
  if(drift === "binding") source.private_binding.variables.EXTRA="different-binding";
  if(drift === "prepared-intent") source.module_bindings[0]!.destinations[0]!.prepared_digest=fakeDigest("different-intent");
  if(drift === "preimage") source.module_bindings[0]!.destinations[0]!.preimage_digest=fakeDigest("different-preimage");
  if(drift === "generation") source.module_bindings[0]!.destinations[0]!.mode=0o644;
  await fs.writeFile(f.evidence,JSON.stringify(source));
  expect((await f.run("resume")).status).toBe("manual-recovery");
  expect((await f.run("rollback")).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
for(const artifact of ["destination","output","preimage","surface-manifest"] as const) for(const drift of ["bytes","mode"] as const) test(`${artifact} ${drift} drift blocks all recovery mutation`,async () => {
  const f=await migrationFixture(); await f.run("apply");
  const tx=join(f.state,"transactions",f.operation.txid);
  const path=artifact === "destination" ? f.destination : artifact === "surface-manifest" ? join(tx,"surface-manifest.json") : join(tx,artifact,`surface-${sha256("config.fixture")}.txt`);
  if(drift === "bytes") await fs.writeFile(path,"unexpected-user-change\n"); else await fs.chmod(path,0o444);
  const before=await fs.readFile(f.destination,"utf8"), mode=(await fs.stat(f.destination)).mode;
  expect((await f.run("resume")).status).toBe("manual-recovery");
  expect((await f.run("rollback")).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(before);
  expect((await fs.stat(f.destination)).mode).toBe(mode);
});
for(const corruption of ["journal-null","journal-extra","receipt-extra","receipt-outcome","binding-extra"] as const) test(`${corruption} fails safe before mutation`,async () => {
  const f=await migrationFixture(); await f.run("apply");
  const path=join(f.state,"transactions",f.operation.txid,corruption.startsWith("receipt")?"receipt.json":"journal.json");
  const value=JSON.parse(await fs.readFile(path,"utf8"));
  if(corruption === "journal-null") value.push(null);
  if(corruption === "journal-extra") value[1].unrecognized=true;
  if(corruption === "receipt-extra") value.unrecognized=true;
  if(corruption === "receipt-outcome") value.steps[0].outcome="failed";
  if(corruption === "binding-extra") value[0].transaction_binding.context.unrecognized="fixture";
  await fs.writeFile(path,JSON.stringify(value));
  expect((await f.run("rollback")).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
test("two local writers cannot share the complete destination set",async () => {
  const f=await migrationFixture();
  const results=await Promise.all([f.run("apply"),f.run("apply",diskIO(),{operation:createMigrationOperation()})]);
  expect(results.filter(r=>r.status === "committed")).toHaveLength(1);
  expect(results.filter(r=>r.status === "manual-recovery")).toHaveLength(1);
});
for(const claimDrift of ["nonce","missing","unobservable","active-stale"] as const) test(`${claimDrift} ownership holds without takeover`,async () => {
  const f=await migrationFixture(); await f.run("apply");
  const claim=join(f.state,"prepared-transaction-claim"), owner=join(claim,"owner.json");
  if(claimDrift === "nonce") { const data=JSON.parse(await fs.readFile(owner,"utf8")); data.binding.claim_nonce="f".repeat(32); await fs.writeFile(owner,JSON.stringify(data)); }
  if(claimDrift === "missing") await fs.rm(owner);
  if(claimDrift === "active-stale") await fs.mkdir(join(claim,"active"));
  const io=diskIO(), read=io.readFile;
  if(claimDrift === "unobservable") io.readFile=async path=>{if(path===owner) throw new Error("unobservable"); return read(path);};
  expect((await f.run("rollback",io)).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
test("same transaction concurrent recovery permits exactly one active writer",async () => {
  const f=await migrationFixture(); await f.run("apply");
  const results=await Promise.all([f.run("rollback"),f.run("rollback")]);
  expect(results.filter(r=>r.status === "rolled-back")).toHaveLength(1);
  expect(results.filter(r=>r.status === "manual-recovery")).toHaveLength(1);
});
test("unknown remote ownership remains a handoff hold and cancellation preserves independent sign-ins",async () => {
  const f=await migrationFixture();
  const authority={authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"unknown" as const}),readFreshInputs:async(io:LifecycleIO)=>JSON.parse(await io.readFile(f.evidence))};
  const result=await f.run("apply",diskIO(),{authority});
  expect(result.status).toBe("unknown-effect"); expect(result.reason).toBe("OWNER_RECONCILIATION_REQUIRED");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
  const controller=new AbortController(); const io=diskIO(), rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{await rename(a,b);controller.abort();};
  const cancelled=await f.run("apply",io,{signal:controller.signal});
  expect(cancelled.status).toBe("incomplete"); expect(cancelled.external_signins_preserved).toBe(true);
  expect((await f.run("resume")).status).toBe("committed");
});
for(const identical of [true,false]) test(`${identical?"identical":"differing"} existing unowned selected file is never adopted`,async () => {
  const f=await migrationFixture();
  if(identical) {
    await fs.writeFile(f.destination,f.output);
    const options=JSON.parse(await fs.readFile(f.evidence,"utf8")) as CreateMigrationPlanOptions;
    options.module_bindings[0]!.destinations[0]!.preimage_digest=migrationPreimageDigest(sha256(f.output),0o640) as `sha256:${string}`;
    Object.assign(options.source_context,calculateMigrationInputDigests(options));
    const plan=await createMigrationPlan(options); const {pinned_at:_p,expires_at:_e,...context}=options.source_context;
    await fs.writeFile(f.evidence,JSON.stringify(options));
    await fs.writeFile(join(f.root,"packet.json"),JSON.stringify({plan,operation:f.operation,review:{...context,plan_digest:plan.plan_digest,reviewed_at:"2026-10-01T00:00:03Z",expires_at:"2026-10-02T00:00:00Z"}}));
  }
  const before=await fs.readFile(f.destination,"utf8");
  const authority={authorize:async()=>({authorized:true,owned_step_ids:[],lifecycle_state_root:f.state,remote_outcome:"none" as const}),readFreshInputs:async(io:LifecycleIO)=>JSON.parse(await io.readFile(f.evidence))};
  expect((await f.run("apply",diskIO(),{authority})).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(before);
  expect((await fs.stat(f.destination)).mode & 0o777).toBe(0o640);
});
test("unauthenticated review hashes never confer effect authority",async () => {
  const f=await migrationFixture();
  expect((await f.run("apply",diskIO(),{authority:{authorize:async()=>({authorized:false,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"none"}),readFreshInputs:async(io)=>JSON.parse(await io.readFile(f.evidence))}})).status).toBe("manual-recovery");
  expect(await fs.readdir(f.state)).toEqual([]);
});
test("absent owned destination can be created then removed by compensation",async () => {
  const f=await migrationFixture(false);
  expect((await f.run("apply")).status).toBe("committed");
  expect((await f.run("rollback")).status).toBe("rolled-back");
  expect(await fs.stat(f.destination).then(()=>true,()=>false)).toBe(false);
});

test("trusted lifecycle namespace rejects caller-selected alternate state roots",async()=>{
  const f=await migrationFixture(); const alternate=join(f.root,"alternate-state"); await fs.mkdir(alternate);
  expect((await f.run("apply",diskIO(),{stateRoot:alternate})).status).toBe("manual-recovery");
  expect(await fs.readdir(alternate)).toEqual([]);
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
});
for(const alias of [false,true,"ancestor"] as const) test(`partially overlapping plans are fenced in one namespace${alias === "ancestor" ? " with parent-child overlap" : alias ? " with normalized root alias" : ""}`,async()=>{
  const f=await migrationFixture();
  const packets: MigrationRecoveryOptions[]=[];
  for(const side of ["a","c"]) {
    const source=JSON.parse(await fs.readFile(f.evidence,"utf8")) as CreateMigrationPlanOptions;
    const base=source.module_bindings[0]!.destinations[0]!;
    source.module_bindings[0]!.destinations.push({...base,id:`config.${side}`,relative_path:`config/${side}.json`,preimage_digest:migrationPreimageDigest(null,null) as `sha256:${string}`});
    if(alias === "ancestor") source.module_bindings[0]!.destinations[1]!.relative_path=side === "a" ? "config/nested" : "config/nested/child";
    Object.assign(source.source_context,calculateMigrationInputDigests(source));
    const plan=await createMigrationPlan(source);expect(plan.holds).toEqual([]);
    const {pinned_at:_p,expires_at:_e,...context}=source.source_context;
    const evidence=join(f.root,`evidence-${side}.json`);await fs.writeFile(evidence,JSON.stringify(source));
    packets.push({action:"apply",operation:createMigrationOperation(),plan,review:{...context,plan_digest:plan.plan_digest,reviewed_at:"2026-10-01T00:00:03Z",expires_at:"2026-10-02T00:00:00Z"},stateRoot:f.state,io:diskIO(),root_tokens:{STATE_ROOT:alias === true && side === "c" ? "CODEX_HOME" : "HOME"},prepared:new Map([["config.fixture",f.output],[`config.${side}`,f.output]]),
      authority:{authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"none"}),readFreshInputs:async io=>JSON.parse(await io.readFile(evidence))}});
  }
  const results=await Promise.all(packets.map(recoverMigration));
  expect(results.filter(r=>r.status==="committed")).toHaveLength(1);
  expect(results.filter(r=>r.status==="manual-recovery")).toHaveLength(1);
  if(alias === "ancestor") {
    const nested=await fs.stat(join(f.home,"config","nested"));
    expect(nested.isFile() || nested.isDirectory()).toBe(true);
  } else {
    const exists=await Promise.all(["a","c"].map(s=>fs.stat(join(f.home,"config",`${s}.json`)).then(()=>true,()=>false)));
    expect(exists.filter(Boolean)).toHaveLength(1);
  }
});
for(const link of ["symbolic","hard"] as const) test(`${link} links never grant destination or artifact ownership`,async()=>{
  const f=await migrationFixture();await f.run("apply");
  const victim=join(f.home,"different-user"), path=join(f.state,"transactions",f.operation.txid,"output",`surface-${sha256("config.fixture")}.txt`);
  await fs.rm(path);
  if(link==="symbolic") await fs.symlink(victim,path);else await fs.link(victim,path);
  expect((await f.run("rollback")).status).toBe("manual-recovery");
  expect(await fs.readFile(victim,"utf8")).toBe("leave-this-user-file\n");
});
test("legacy rollback cannot bypass a guarded migration claim",async()=>{
  const f=await migrationFixture();await f.run("apply");
  expect((await rollbackTransaction(f.operation.txid,f.state,diskIO(),{resolveRoot:()=>f.home})).status).toBe("failed");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});

test("root identity replacement after capture invalidates the owned claim before promotion",async()=>{
  const f=await migrationFixture(), io=diskIO(), write=io.writeFileAtomic;let moved=false;
  io.writeFileAtomic=async(path,data,options)=>{
    await write(path,data,options);
    if(!moved && path.endsWith("journal.json") && JSON.parse(data).at(-1).kind==="STAGE") {
      moved=true;await fs.rename(f.home,`${f.home}-original`);await fs.mkdir(f.home);await fs.mkdir(join(f.home,"config"));await fs.writeFile(f.destination,f.prior,{mode:0o640});
    }
  };
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
  expect((await f.run("resume")).status).toBe("manual-recovery");
});
test("claim revocation immediately after durable STAGE prevents promotion and rollback",async()=>{
  const f=await migrationFixture(), io=diskIO(), write=io.writeFileAtomic;let revoked=false;
  io.writeFileAtomic=async(path,data,options)=>{
    await write(path,data,options);
    if(!revoked && path.endsWith("journal.json") && JSON.parse(data).at(-1).kind==="STAGE") {
      revoked=true;await fs.writeFile(join(f.state,"prepared-transaction-claim","owner.json"),"revoked");
    }
  };
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect((await f.run("rollback")).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
});
test("prepared output changed after durable STAGE is not recompiled or promoted",async()=>{
  const f=await migrationFixture(), io=diskIO(), write=io.writeFileAtomic;let changed=false;
  io.writeFileAtomic=async(path,data,options)=>{
    await write(path,data,options);
    if(!changed && path.endsWith("journal.json") && JSON.parse(data).at(-1).kind==="STAGE") {
      changed=true;await fs.writeFile(join(f.state,"transactions",f.operation.txid,"output",`surface-${sha256("config.fixture")}.txt`),"changed-output");
    }
  };
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
  expect((await f.run("resume")).status).toBe("manual-recovery");
});

import { pruneCompletedTransactions } from "../src/lifecycle/journal.ts";
test("legacy retention cannot delete claimed migration recovery evidence",async()=>{
  const f=await migrationFixture();await f.run("apply");
  expect(await pruneCompletedTransactions(f.state,diskIO(),0)).toEqual([]);
  expect((await f.run("rollback")).status).toBe("rolled-back");
});

test("malformed runtime plan and operation casts return bounded hold projections",async()=>{
  const f=await migrationFixture();
  const response=await f.run("apply",diskIO(),{plan:null as unknown as MigrationPlanV1,operation:{txid:"arbitrary-untrusted-value",claim_nonce:"invalid"}});
  expect(response.status).toBe("manual-recovery");
  expect(response.plan_digest).toBe("unavailable");
  expect(response.txid).toBe("unavailable");
  expect(await fs.readdir(f.state)).toEqual([]);
});

import { makeInputChainSnapshot, makeInputChainExpectedContext } from "./migration-fixtures.ts";
async function rereview(f: Awaited<ReturnType<typeof migrationFixture>>, change: (source: CreateMigrationPlanOptions) => void) {
  const source=JSON.parse(await fs.readFile(f.evidence,"utf8")) as CreateMigrationPlanOptions;
  change(source);Object.assign(source.source_context,calculateMigrationInputDigests(source));
  const plan=await createMigrationPlan(source);expect(plan.holds).toEqual([]);
  const {pinned_at:_p,expires_at:_e,...context}=source.source_context;
  await fs.writeFile(f.evidence,JSON.stringify(source));
  await fs.writeFile(join(f.root,"packet.json"),JSON.stringify({plan,operation:f.operation,review:{...context,plan_digest:plan.plan_digest,reviewed_at:"2026-10-01T00:00:03Z",expires_at:"2026-10-02T00:00:00Z"}}));
}
test("review: five-second required verdicts expire before effect despite unchanged digests",async()=>{
  for(const action of ["apply","resume","rollback"] as const) {
    const f=await migrationFixture();await rereview(f,source=>{source.snapshot=makeInputChainSnapshot();source.expected_context=makeInputChainExpectedContext();source.expected_context.now=source.now;for(const v of source.expected_context.expected_verdicts!) v.max_age_days=5/86400;});
    if(action!=="apply") expect((await f.run("apply")).status).toBe("committed");
    const source=JSON.parse(await fs.readFile(f.evidence,"utf8"));source.now=source.expected_context.now="2026-10-01T00:00:10Z";await fs.writeFile(f.evidence,JSON.stringify(source));
    const before=await fs.readFile(f.destination,"utf8"),io=diskIO();io.now=()=>new Date("2026-10-01T00:00:10Z");
    expect((await f.run(action,io)).status).toBe("manual-recovery");expect(await fs.readFile(f.destination,"utf8")).toBe(before);
  }
});
for(const damage of ["deleted","null","malformed","disguised"] as const) test(`review: ${damage} BEGIN binding never downgrades guarded rollback or retention`,async()=>{
  const f=await migrationFixture();await f.run("apply");const path=join(f.state,"transactions",f.operation.txid,"journal.json"),entries=JSON.parse(await fs.readFile(path,"utf8"));
  if(damage==="null") entries[0].transaction_binding=null;else if(damage==="malformed") entries[0].transaction_binding={};else delete entries[0].transaction_binding;
  if(damage==="disguised") entries[0].verb="install";
  await fs.writeFile(path,JSON.stringify(entries));
  expect((await rollbackTransaction(f.operation.txid,f.state,diskIO(),{resolveRoot:()=>f.home})).status).toBe("failed");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
  expect(await pruneCompletedTransactions(f.state,diskIO(),0)).toEqual([]);
});
for(const file of ["journal.json","receipt.json"]) for(const link of ["symbolic","hard","mode","ancestor"] as const) test(`review: ${file} ${link} metadata holds before content read`,async()=>{
  const f=await migrationFixture();await f.run("apply");let path=join(f.state,"transactions",f.operation.txid,file);
  if(link==="ancestor") {const tx=join(f.state,"transactions",f.operation.txid);await fs.rename(tx,`${tx}-moved`);await fs.symlink(`${tx}-moved`,tx);} else if(link==="mode") await fs.chmod(path,0o644);else {const outside=join(f.root,`outside-${file}`);await fs.copyFile(path,outside);await fs.chmod(outside,0o600);await fs.rm(path);if(link==="symbolic") await fs.symlink(outside,path);else await fs.link(outside,path);}
  const io=diskIO(),read=io.readFile;let reads=0;io.readFile=async p=>{if(p===path) reads++;return read(p);};
  expect((await f.run("status",io)).status).toBe("manual-recovery");expect(reads).toBe(0);
});
test("review: authenticated identical prior and output have stable outcomes without rewriting",async()=>{
  const f=await migrationFixture();await fs.writeFile(f.destination,f.output);await fs.chmod(f.destination,0o600);await rereview(f,source=>{source.module_bindings[0]!.destinations[0]!.preimage_digest=migrationPreimageDigest(sha256(f.output),0o600) as `sha256:${string}`;});
  expect((await f.run("apply")).status).toBe("committed");expect((await f.run("status")).status).toBe("committed");
  const inode=(await fs.stat(f.destination)).ino;
  expect((await f.run("resume")).status).toBe("committed");expect((await fs.stat(f.destination)).ino).toBe(inode);
  expect((await f.run("rollback")).status).toBe("rolled-back");expect((await f.run("status")).status).toBe("rolled-back");expect((await fs.stat(f.destination)).ino).toBe(inode);
});
test("review: pure missing prepared intent never strands a global claim",async()=>{
  const f=await migrationFixture();expect((await f.run("apply",diskIO(),{prepared:undefined})).status).toBe("manual-recovery");expect(await fs.readdir(f.state)).toEqual([]);
});
test("review: separate Journal instances serialize durable appends without stale caches",async()=>{
  const root=await temporary(),io=diskIO(),journal=await Journal.create(root,io),a=Journal.open(journal.txDir,diskIO()),b=Journal.open(journal.txDir,diskIO());
  await Promise.all([a.readEntries(),b.readEntries()]);
  await Promise.all([a.append({kind:"ABORT",ts:"fixture",reason:"one"}),b.append({kind:"ABORT",ts:"fixture",reason:"two"})]);
  expect(await Journal.open(journal.txDir,diskIO()).readEntries()).toHaveLength(2);
});
test("review: rollback receipt without its terminal COMPLETE remains incomplete",async()=>{
  const f=await migrationFixture();await f.run("apply");await f.run("rollback");const path=join(f.state,"transactions",f.operation.txid,"journal.json"),entries=JSON.parse(await fs.readFile(path,"utf8"));entries.pop();await fs.writeFile(path,JSON.stringify(entries));
  expect((await f.run("status")).status).toBe("incomplete");expect((await f.run("rollback")).status).toBe("rolled-back");
});
test("review: terminal resume and rollback preserve journal and receipt bytes",async()=>{
  const f=await migrationFixture();await f.run("apply");const tx=join(f.state,"transactions",f.operation.txid);
  for(const action of ["resume","rollback"] as const) {
    if(action==="rollback") await f.run("rollback");
    const before=await Promise.all(["journal.json","receipt.json"].map(p=>fs.readFile(join(tx,p),"utf8")));
    await f.run(action);await f.run(action);
    expect(await Promise.all(["journal.json","receipt.json"].map(p=>fs.readFile(join(tx,p),"utf8")))).toEqual(before);
  }
});
test("review: boundary competitor bytes survive promotion",async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{if(b===f.destination) await fs.writeFile(b,"foreign-at-final-boundary\n");await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect(await fs.readFile(f.destination,"utf8")).toBe("foreign-at-final-boundary\n");
});

test("review: explicit authenticated terminal release preserves history and admits next disjoint operation",async()=>{
  const f=await migrationFixture();await f.run("apply");const tx=join(f.state,"transactions",f.operation.txid),history=await fs.readFile(join(tx,"journal.json"),"utf8");
  expect((await f.run("release" as MigrationRecoveryAction)).status).toBe("released");
  expect(await fs.readFile(join(tx,"journal.json"),"utf8")).toBe(history);
  expect(await fs.stat(join(f.state,"prepared-transaction-claim")).then(()=>true,()=>false)).toBe(false);
  expect(await fs.stat(join(tx,"released-claim","owner.json")).then(()=>true,()=>false)).toBe(true);
  await rereview(f,source=>{const d=source.module_bindings[0]!.destinations[0]!;d.relative_path="config/next.json";d.preimage_digest=migrationPreimageDigest(null,null) as `sha256:${string}`;});
  expect((await f.run("apply",diskIO(),{operation:createMigrationOperation()})).status).toBe("committed");
});
test("review: explicit release of authenticated claim-only failure requires no transaction artifacts",async()=>{
  const f=await migrationFixture(),io=diskIO(),write=io.writeFileAtomic;io.writeFileAtomic=async(p,d,o)=>{if(p.endsWith("/capture.json")) throw new Error("before-capture");await write(p,d,o);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect((await f.run("release" as MigrationRecoveryAction)).status).toBe("released");
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
});
for(const invalid of ["incomplete","drift","unknown","unowned"] as const) test(`review: explicit release refuses ${invalid} evidence`,async()=>{
  const f=await migrationFixture(),io=diskIO(),write=io.writeFileAtomic;
  if(invalid==="incomplete") io.writeFileAtomic=async(p,d,o)=>{await write(p,d,o);if(p.endsWith("journal.json")&&JSON.parse(d).at(-1).kind==="STAGE") throw new Error("interrupted");};
  await f.run("apply",io);
  if(invalid==="drift") await fs.writeFile(f.destination,"user-new-content");
  if(invalid==="unowned") await fs.writeFile(join(f.state,"prepared-transaction-claim","unowned"),"foreign");
  const authority=invalid==="unknown"?{authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"unknown" as const}),readFreshInputs:async(reader:LifecycleIO)=>JSON.parse(await reader.readFile(f.evidence))}:undefined;
  const result=await f.run("release" as MigrationRecoveryAction,diskIO(),authority?{authority}:{});
  expect(["manual-recovery","unknown-effect"]).toContain(result.status);
  expect(await fs.stat(join(f.state,"prepared-transaction-claim")).then(()=>true,()=>false)).toBe(true);
});

test("review: native exclusive rename reports genuine EEXIST and preserves both files",async()=>{
  const root=await temporary(),a=join(root,"source"),b=join(root,"destination");await fs.writeFile(a,"source");await fs.writeFile(b,"competitor");
  await expect(diskIO().renameNoReplace!(a,b)).rejects.toMatchObject({code:"EEXIST",errno:17});
  expect(await fs.readFile(a,"utf8")).toBe("source");expect(await fs.readFile(b,"utf8")).toBe("competitor");
});
test("review: unsupported atomic custody capability holds before claiming",async()=>{
  const f=await migrationFixture(),io=diskIO();delete io.renameNoReplace;
  expect(await f.run("apply",io)).toMatchObject({status:"manual-recovery",reason:"ATOMIC_CUSTODY_UNSUPPORTED"});expect(await fs.readdir(f.state)).toEqual([]);expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
});
for(const phase of ["apply","rollback"] as const) for(const occupied of [false,true]) test(`review: ${phase} custody returns foreign bytes or retains them when destination is occupied=${occupied}`,async()=>{
  const f=await migrationFixture();if(phase==="rollback") await f.run("apply");
  const io=diskIO(),rename=io.renameNoReplace!;let injected=false;const foreign="foreign-at-custody-boundary\n",second="second-foreign-writer\n";
  io.renameNoReplace=async(a,b)=>{
    if(!injected && a===f.destination) {injected=true;await fs.writeFile(a,foreign);await fs.chmod(a,0o644);await rename(a,b);if(occupied) await fs.writeFile(a,second);return;}
    await rename(a,b);
  };
  expect((await f.run(phase,io)).status).toBe("manual-recovery");
  const tx=join(f.state,"transactions",f.operation.txid),custody=join(tx,"preimage",`custody-${phase}-${sha256("config.fixture")}.txt`);
  if(occupied) {expect(await fs.readFile(custody,"utf8")).toBe(foreign);expect(await fs.readFile(f.destination,"utf8")).toBe(second);} else {expect(await fs.readFile(f.destination,"utf8")).toBe(foreign);expect((await fs.stat(f.destination)).mode & 0o777).toBe(0o644);}
  const entries=JSON.parse(await fs.readFile(join(tx,"journal.json"),"utf8"));expect(entries.at(-1)).toMatchObject({kind:"CUSTODY_HOLD",observed_hash:sha256(foreign),observed_mode:0o644,returned:!occupied});
  expect((await f.run("resume")).status).toBe("manual-recovery");expect((await f.run("release")).status).toBe("manual-recovery");
});
for(const after of [false,true]) test(`review: explicit terminal release uncertain rename reconciles after=${after}`,async()=>{
  const f=await migrationFixture();await f.run("apply");const io=diskIO(),rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{if(b.endsWith("/released-claim")){if(after)await rename(a,b);throw new Error("release-uncertain");}await rename(a,b);};
  expect((await f.run("release",io)).status).toBe("manual-recovery");
  expect((await f.run("release")).status).toBe("released");expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
test("review: a separate Bun process respects the existing active transaction claim",async()=>{
  const f=await migrationFixture();await f.run("apply");await fs.mkdir(join(f.state,"prepared-transaction-claim","active"));
  const runner=join(f.root,"claim-check.ts"),moduleURL=new URL("../src/migration/recovery.ts",import.meta.url).href;
  const source=`import {recoverMigration} from ${JSON.stringify(moduleURL)};
import * as fs from "node:fs/promises";
import {dlopen,FFIType,ptr,toArrayBuffer} from "bun:ffi";
const nativeRename=dlopen("/usr/lib/libSystem.B.dylib",{renamex_np:{args:[FFIType.ptr,FFIType.ptr,FFIType.u32],returns:FFIType.i32},__error:{args:[],returns:FFIType.ptr}});
${diskIO.toString()}
const packet=JSON.parse(await fs.readFile(${JSON.stringify(join(f.root,"packet.json"))},"utf8"));
const state=${JSON.stringify(f.state)},evidence=${JSON.stringify(f.evidence)};
const result=await recoverMigration({...packet,action:"rollback",stateRoot:state,io:diskIO(),root_tokens:{STATE_ROOT:"HOME"},authority:{authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:state,remote_outcome:"none"}),readFreshInputs:async(io)=>JSON.parse(await io.readFile(evidence))}});
console.log(result.status);`;
  await fs.writeFile(runner,source);
  const processHandle=Bun.spawn([process.execPath,runner],{cwd:f.root,env:{PATH:""},stdout:"pipe",stderr:"pipe"});
  const output=await new Response(processHandle.stdout).text(),error=await new Response(processHandle.stderr).text();
  expect(await processHandle.exited,error).toBe(0);expect(output.trim()).toBe("manual-recovery");expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});

test("review: lost transaction history cannot masquerade as a claim-only failure",async()=>{
  const f=await migrationFixture();await f.run("apply");await fs.rm(join(f.state,"transactions",f.operation.txid),{recursive:true});await fs.writeFile(f.destination,f.prior);await fs.chmod(f.destination,0o640);
  expect((await f.run("release")).status).toBe("manual-recovery");expect(await fs.stat(join(f.state,"prepared-transaction-claim")).then(()=>true,()=>false)).toBe(true);
});
test("review: non-text prepared intent fails pure validation without claiming",async()=>{
  const f=await migrationFixture(),content="invalid\0text";await rereview(f,s=>{s.module_bindings[0]!.destinations[0]!.prepared_digest=`sha256:${sha256(content)}`;});
  expect((await f.run("apply",diskIO(),{prepared:new Map([["config.fixture",content]])})).status).toBe("manual-recovery");expect(await fs.readdir(f.state)).toEqual([]);
});

test("review: custody drift after promotion blocks commit and release",async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{await rename(a,b);if(b===f.destination)await fs.writeFile(join(f.state,"transactions",f.operation.txid,"preimage",`custody-apply-${sha256("config.fixture")}.txt`),"custody-drift");};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect((await f.run("release")).status).toBe("manual-recovery");
});

for(const after of [false,true]) test(`review: explicit no-artifact release retries uncertain rename after=${after}`,async()=>{
  const f=await migrationFixture(),initial=diskIO(),write=initial.writeFileAtomic;
  initial.writeFileAtomic=async(p,d,o)=>{if(p.endsWith("/capture.json")) throw new Error("before-capture");await write(p,d,o);};await f.run("apply",initial);
  const io=diskIO(),rename=io.renameNoReplace!;io.renameNoReplace=async(a,b)=>{if(b.endsWith("/released-claim")){if(after)await rename(a,b);throw new Error("release-uncertain");}await rename(a,b);};
  expect((await f.run("release",io)).status).toBe("manual-recovery");expect((await f.run("release")).status).toBe("released");expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
});
for(const after of [false,true]) test(`review: foreign return with uncertain exclusive rename preserves foreign bytes after=${after}`,async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!;const foreign="foreign-captured-before-uncertain-return";let injected=false;
  io.renameNoReplace=async(a,b)=>{if(a===f.destination && !injected){injected=true;await fs.writeFile(a,foreign);await rename(a,b);return;}if(a.includes("custody-")&&b===f.destination){if(after)await rename(a,b);throw new Error("return-uncertain");}await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  const path=after?f.destination:join(f.state,"transactions",f.operation.txid,"preimage",`custody-apply-${sha256("config.fixture")}.txt`);
  expect(await fs.readFile(path,"utf8")).toBe(foreign);expect((await f.run("resume")).status).toBe("manual-recovery");
});

for(const variant of ["symlink","hardlink","mode","ancestor"] as const) test(`r3: unsafe active ${variant} holds before content reads and survives cleanup`,async()=>{
  const f=await migrationFixture(),io=diskIO(),write=io.writeFileAtomic,read=io.readFile;
  const active=join(f.state,"prepared-transaction-claim","active"),marker=join(active,"owner.json"),outside=join(f.root,"outside-active");let injected=false,unsafeReads=0;
  io.writeFileAtomic=async(p,d,o)=>{await write(p,d,o);if(p!==marker)return;injected=true;
    if(variant==="ancestor"){await fs.rename(active,outside);await fs.symlink(outside,active);}
    else if(variant==="mode")await fs.chmod(marker,0o644);
    else {await fs.writeFile(outside,d,{mode:0o600});await fs.rm(marker);if(variant==="symlink")await fs.symlink(outside,marker);else await fs.link(outside,marker);}
  };
  io.readFile=async p=>{if(injected&&p===marker)unsafeReads++;return read(p);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect(unsafeReads).toBe(0);
  expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);expect(await fs.lstat(active).then(()=>true,()=>false)).toBe(true);
});
for(const boundary of ["owner","capture","journal","publication"] as const) for(const after of [false,true]) test(`r3: private bootstrap ${boundary} after=${after} cannot strand global ownership`,async()=>{
  const f=await migrationFixture(),io=diskIO(),write=io.writeFileAtomic,rename=io.renameNoReplace!;let injected=false;
  io.writeFileAtomic=async(p,d,o)=>{const hit=!injected&&((boundary==="owner"&&p.endsWith("/owner.json"))||(boundary==="capture"&&p.endsWith("/capture.json"))||(boundary==="journal"&&p.endsWith("/journal.json")));if(hit){injected=true;if(after)await write(p,d,o);throw new Error("bootstrap-interrupt");}await write(p,d,o);};
  io.renameNoReplace=async(a,b)=>{if(boundary==="publication"&&b===join(f.state,"prepared-transaction-claim")){injected=true;if(after)await rename(a,b);throw new Error("bootstrap-publication-interrupt");}await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect(injected).toBe(true);expect(await fs.readFile(f.destination,"utf8")).toBe(f.prior);
  const ownsGlobal=await fs.lstat(join(f.state,"prepared-transaction-claim")).then(()=>true,()=>false);
  if(ownsGlobal) {expect((await f.run("resume")).status).toBe("committed");expect((await f.run("release")).status).toBe("released");}
  else {const released=await f.run("release");expect(released.status).toBe(boundary==="owner"&&!after?"manual-recovery":"released");}
  await rereview(f,s=>{const d=s.module_bindings[0]!.destinations[0]!;d.relative_path="config/next-bootstrap.json";d.preimage_digest=migrationPreimageDigest(null,null) as `sha256:${string}`;});
  expect((await f.run("apply",diskIO(),{operation:createMigrationOperation()})).status).toBe("committed");
});

import { canonical } from "../src/canonical-json.ts";
import type { PreparedReleaseEvidence } from "../src/lifecycle/executor.ts";
import type { MigrationTerminalReleaseContext, MigrationRecoveryAuthority } from "../src/migration/recovery.ts";
// Independent owner fixture issues approval from its own fs read, not engine
// supplied hashes. Production adapters must authenticate their own issued record.
async function ownerRelease(f: Awaited<ReturnType<typeof migrationFixture>>, unpublished=false) {
  const tx=join(f.state,"transactions",f.operation.txid),claim=unpublished?join(tx,"prepared-claim"):join(f.state,"prepared-transaction-claim");
  const binding=JSON.parse(await fs.readFile(join(claim,"owner.json"),"utf8")).binding;
  const artifacts:PreparedReleaseEvidence["artifacts"]=[];
  const walk=async(relative:string):Promise<void>=>{const path=join(tx,relative),stat=await fs.lstat(path);artifacts.push({path:relative,mode:stat.mode&0o7777,hash:null});
    for(const name of (await fs.readdir(path)).sort()){if(!relative&&["prepared-claim","released-claim"].includes(name))continue;const child=relative?`${relative}/${name}`:name,p=join(tx,child),s=await fs.lstat(p);if(s.isDirectory())await walk(child);else artifacts.push({path:child,mode:s.mode&0o7777,hash:sha256(await fs.readFile(p,"utf8"))});}};
  await walk("");
  const destinations:PreparedReleaseEvidence["destinations"]=[];
  for(const step of f.plan.steps){const path=join(f.home,step.relative_path),stat=await fs.lstat(path).catch(error=>{if(error.code==="ENOENT")return null;throw error;});destinations.push({step_id:step.id,hash:stat?sha256(await fs.readFile(path,"utf8")):null,mode:stat?stat.mode&0o7777:null});}
  const evidence:PreparedReleaseEvidence={kind:unpublished?"unpublished":"terminal",binding,capture_started:await fs.stat(join(claim,"capture.json")).then(()=>true,()=>false),artifacts,destinations};
  const context:MigrationTerminalReleaseContext={schema:"temperance.migration.terminal-release.v1",authorization_id:"owner.fixture.release",plan_digest:f.plan.plan_digest,review_digest:`sha256:${sha256(canonical(f.review))}`,txid:f.operation.txid,claim_nonce:f.operation.claim_nonce,lifecycle_state_root:f.state,evidence_digest:`sha256:${sha256(canonical(evidence))}`,issued_at:"2026-10-03T00:00:00Z",expires_at:"2026-10-04T00:00:00Z"};
  const issued=canonical(context);let observed=0;
  const authority:MigrationRecoveryAuthority={authorize:async request=>{const authenticated=request.action==="release"&&canonical(request.release_context)===issued&&(!request.release_evidence||canonical(request.release_evidence)===canonical(evidence));if(request.release_evidence)observed++;return {authorized:authenticated,release_authorized:authenticated,owned_step_ids:f.plan.steps.map(step=>step.id),lifecycle_state_root:f.state,remote_outcome:"none"};},readFreshInputs:async io=>JSON.parse(await io.readFile(f.evidence))};
  const io=diskIO();io.now=()=>new Date("2026-10-03T00:00:01Z");
  return {context,authority,io,observed:()=>observed};
}
for(const terminal of ["committed","rolled-back","unpublished"] as const) test(`r3: independent fresh release after source and review expiry preserves ${terminal} evidence`,async()=>{
  const f=await migrationFixture(),io=diskIO(),write=io.writeFileAtomic;if(terminal==="unpublished")io.writeFileAtomic=async(p,d,o)=>{if(p.endsWith("/capture.json"))throw new Error("bootstrap-fault");await write(p,d,o);};await f.run("apply",io);if(terminal==="rolled-back")await f.run("rollback");
  const issued=await ownerRelease(f,terminal==="unpublished"),before=await fs.readFile(f.destination,"utf8"),tx=join(f.state,"transactions",f.operation.txid);
  const history=await fs.readFile(join(tx,"journal.json"),"utf8").catch(()=>null);
  const source=JSON.parse(await fs.readFile(f.evidence,"utf8"));source.snapshot.source_release_digest=fakeDigest("changed-after-terminal");await fs.writeFile(f.evidence,JSON.stringify(source));
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");expect(issued.observed()).toBeGreaterThan(0);
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");expect(await fs.readFile(f.destination,"utf8")).toBe(before);expect(await fs.readFile(join(tx,"journal.json"),"utf8").catch(()=>null)).toBe(history);
});
for(const invalid of ["absent","stale","forged","nonce","evidence","destination","incomplete","unknown"] as const) test(`r3: expired release rejects ${invalid} owner evidence`,async()=>{
  const f=await migrationFixture();await f.run("apply");const issued=await ownerRelease(f);let authority=issued.authority,context:MigrationTerminalReleaseContext|undefined=structuredClone(issued.context);
  if(invalid==="absent")context=undefined;if(invalid==="stale")context!.expires_at="2026-10-03T00:00:00Z";if(invalid==="forged")authority={authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"none"}),readFreshInputs:issued.authority.readFreshInputs};if(invalid==="nonce")context!.claim_nonce="a".repeat(32);if(invalid==="evidence")context!.evidence_digest=fakeDigest("forged-evidence");
  if(invalid==="destination")await fs.writeFile(f.destination,"user-after-approval");if(invalid==="incomplete"){const p=join(f.state,"transactions",f.operation.txid,"journal.json"),entries=JSON.parse(await fs.readFile(p,"utf8"));entries.pop();await fs.writeFile(p,JSON.stringify(entries));}if(invalid==="unknown"){const auth=authority.authorize;authority={...authority,authorize:async r=>({...await auth(r),remote_outcome:"unknown"})};}
  expect(["manual-recovery","unknown-effect"]).toContain((await f.run("release",issued.io,{release_context:context,authority})).status);expect(await fs.lstat(join(f.state,"prepared-transaction-claim")).then(()=>true,()=>false)).toBe(true);
});
test("r3: fresh release capability cannot extend apply resume or rollback freshness",async()=>{
  const f=await migrationFixture();await f.run("apply");const issued=await ownerRelease(f);
  for(const action of ["apply","resume","rollback"] as const){expect((await f.run(action,issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect((await f.run(action,issued.io)).status).toBe("manual-recovery");}expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});

for(const drift of ["destination","preimage","output"] as const) test(`r3: publication revalidates captured ${drift} before effects`,async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!;let changed=false;
  io.renameNoReplace=async(a,b)=>{await rename(a,b);if(b!==join(f.state,"prepared-transaction-claim"))return;changed=true;
    const tx=join(f.state,"transactions",f.operation.txid),manifest=JSON.parse(await fs.readFile(join(tx,"surface-manifest.json"),"utf8"));
    await fs.writeFile(drift==="destination"?f.destination:join(tx,drift==="preimage"?manifest.leaves[0].preimage:manifest.leaves[0].output),"post-publication-drift");};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect(changed).toBe(true);expect(await fs.readFile(f.destination,"utf8")).toBe(drift==="destination"?"post-publication-drift":f.prior);
});
test("r3: an exclusive publication loser retains its private capture and never affects the destination",async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!,competitor=createMigrationOperation();let winnerStatus="";
  io.renameNoReplace=async(a,b)=>{if(b===join(f.state,"prepared-transaction-claim"))winnerStatus=(await f.run("apply",diskIO(),{operation:competitor})).status;await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect(winnerStatus).toBe("committed");expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
  const tx=join(f.state,"transactions",f.operation.txid);expect(await fs.lstat(join(tx,"prepared-claim","owner.json")).then(()=>true,()=>false)).toBe(true);expect(JSON.parse(await fs.readFile(join(tx,"journal.json"),"utf8")).map((e:{kind:string})=>e.kind)).toEqual(["BEGIN"]);
});
test("r3: fresh owner approval of incomplete facts still cannot release them",async()=>{
  const f=await migrationFixture();await f.run("apply");const path=join(f.state,"transactions",f.operation.txid,"journal.json"),entries=JSON.parse(await fs.readFile(path,"utf8"));entries.pop();await fs.writeFile(path,JSON.stringify(entries));const issued=await ownerRelease(f);
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
test("r3: fresh owner release context cannot discharge foreign custody",async()=>{
  const f=await migrationFixture(),io=diskIO(),rename=io.renameNoReplace!;let changed=false;
  io.renameNoReplace=async(a,b)=>{if(!changed&&a===f.destination){changed=true;await fs.writeFile(a,"foreign-returned");}await rename(a,b);};await f.run("apply",io);const issued=await ownerRelease(f);
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(await fs.readFile(f.destination,"utf8")).toBe("foreign-returned");
});

async function unpublishedLoserFixture() {
  const f=await migrationFixture(),winner=createMigrationOperation(),io=diskIO(),rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{if(b===join(f.state,"prepared-transaction-claim"))expect((await f.run("apply",diskIO(),{operation:winner})).status).toBe("committed");await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
  return {...f,winner};
}
async function retainedTree(path:string):Promise<unknown> {
  const stat=await fs.lstat(path);
  if(!stat.isDirectory())return {mode:stat.mode&0o7777,ino:stat.ino,bytes:(await fs.readFile(path)).toString("base64")};
  const children:Record<string,unknown>={};for(const name of (await fs.readdir(path)).sort())children[name]=await retainedTree(join(path,name));return {mode:stat.mode&0o7777,ino:stat.ino,children};
}
test("r4: fresh owner releases unpublished loser against winner current bytes without changing winner or retained history",async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),tx=join(f.state,"transactions",f.operation.txid),winnerTx=join(f.state,"transactions",f.winner.txid),claim=join(f.state,"prepared-transaction-claim");
  const winnerBefore=await retainedTree(winnerTx),claimBefore=await retainedTree(claim),destinationBefore=await retainedTree(f.destination),journal=await fs.readFile(join(tx,"journal.json"),"utf8");
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");expect(issued.observed()).toBeGreaterThan(0);
  const loserAfter=await retainedTree(tx);expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");expect(await retainedTree(tx)).toEqual(loserAfter);
  expect(await retainedTree(winnerTx)).toEqual(winnerBefore);expect(await retainedTree(claim)).toEqual(claimBefore);expect(await retainedTree(f.destination)).toEqual(destinationBefore);expect(await fs.readFile(join(tx,"journal.json"),"utf8")).toBe(journal);expect(await fs.lstat(join(tx,"receipt.json")).then(()=>true,()=>false)).toBe(false);
});
for(const invalid of ["custody-file","custody-intent","stage","commit","receipt","ambiguous","lost-history","null-history","binding","global-owner","unknown-global","stale","forged","current-drift"] as const) test(`r4: private loser release holds ${invalid} and preserves winner`,async()=>{
  const f=await unpublishedLoserFixture(),tx=join(f.state,"transactions",f.operation.txid),journal=join(tx,"journal.json"),entries=JSON.parse(await fs.readFile(journal,"utf8"));
  if(invalid==="custody-file")await fs.writeFile(join(tx,"preimage","custody-apply-fixture.txt"),"held-foreign");
  if(["custody-intent","stage","commit"].includes(invalid)){entries.push({kind:invalid==="custody-intent"?"CUSTODY":invalid==="stage"?"STAGE":"COMMIT_STEP",ts:"2026-10-01T00:00:04Z",step_id:"config.fixture"});await fs.writeFile(journal,JSON.stringify(entries));}
  if(invalid==="receipt")await fs.writeFile(join(tx,"receipt.json"),JSON.stringify({status:"committed"}));
  if(invalid==="ambiguous")await fs.writeFile(join(tx,"unrecognized-effect.json"),"unknown");
  if(invalid==="lost-history")await fs.rm(journal);
  if(invalid==="null-history")await fs.writeFile(journal,"[null]");
  if(invalid==="unknown-global")await fs.writeFile(join(f.state,"prepared-transaction-claim","owner.json"),JSON.stringify({txid:f.winner.txid,binding:{}}));
  if(invalid==="binding"){entries[0].transaction_binding.claim_nonce="a".repeat(32);await fs.writeFile(journal,JSON.stringify(entries));}
  if(invalid==="global-owner")await fs.copyFile(join(tx,"prepared-claim","owner.json"),join(f.state,"prepared-transaction-claim","owner.json"));
  const issued=await ownerRelease(f,true);let context=issued.context,authority=issued.authority;
  if(invalid==="stale")context={...context,expires_at:"2026-10-03T00:00:00Z"};
  if(invalid==="forged")authority={...authority,authorize:async()=>({authorized:true,owned_step_ids:["config.fixture"],lifecycle_state_root:f.state,remote_outcome:"none"})};
  if(invalid==="current-drift")await fs.writeFile(f.destination,"changed-after-owner-approval");
  const winnerBefore=await retainedTree(join(f.state,"transactions",f.winner.txid)),claimBefore=await retainedTree(join(f.state,"prepared-transaction-claim")),destinationBefore=await retainedTree(f.destination);
  expect((await f.run("release",issued.io,{release_context:context,authority})).status).toBe("manual-recovery");
  expect(await fs.lstat(join(tx,"prepared-claim","owner.json")).then(()=>true,()=>false)).toBe(true);expect(await retainedTree(join(f.state,"transactions",f.winner.txid))).toEqual(winnerBefore);expect(await retainedTree(join(f.state,"prepared-transaction-claim"))).toEqual(claimBefore);expect(await retainedTree(f.destination)).toEqual(destinationBefore);
});

for(const invalid of ["empty-context","context-type","context-extra","module-type","duplicate-modules","missing-BEGIN","mismatched-BEGIN","legacy-BEGIN","duplicate-BEGIN","malformed-history"] as const) test(`r5: foreign global ${invalid} holds private release without changing approval`,async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),ownerPath=join(f.state,"prepared-transaction-claim","owner.json"),journalPath=join(f.state,"transactions",f.winner.txid,"journal.json");
  const owner=JSON.parse(await fs.readFile(ownerPath,"utf8")),entries=JSON.parse(await fs.readFile(journalPath,"utf8"));
  if(invalid==="empty-context")owner.binding.context={};if(invalid==="context-type")owner.binding.context="unrecognized";if(invalid==="context-extra")owner.binding.context.extra="unrecognized";if(invalid==="module-type")owner.binding.context.selected_modules=[42];if(invalid==="duplicate-modules")owner.binding.context.selected_modules=["core.fixture","core.fixture"];
  if(["empty-context","context-type","context-extra","module-type","duplicate-modules"].includes(invalid)){
    // Keep the forged records mutually consistent so only a closed context
    // validator, not merely the journal equality comparison, rejects them.
    entries[0].transaction_binding=owner.binding;await fs.writeFile(journalPath,JSON.stringify(entries));
    await fs.writeFile(ownerPath,JSON.stringify(owner));await fs.writeFile(join(f.state,"prepared-transaction-claim","capture.json"),JSON.stringify(owner));
  }
  if(invalid==="missing-BEGIN")await fs.rm(journalPath);if(invalid==="mismatched-BEGIN")entries[0].transaction_binding.claim_nonce="f".repeat(32);if(invalid==="legacy-BEGIN")entries[0].verb="install";if(invalid==="duplicate-BEGIN")entries.push(entries[0]);
  if(["mismatched-BEGIN","legacy-BEGIN","duplicate-BEGIN"].includes(invalid))await fs.writeFile(journalPath,JSON.stringify(entries));if(invalid==="malformed-history")await fs.writeFile(journalPath,"{}");
  const globalBefore=await retainedTree(join(f.state,"prepared-transaction-claim")),winnerBefore=await retainedTree(join(f.state,"transactions",f.winner.txid)),destinationBefore=await retainedTree(f.destination);
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(await retainedTree(join(f.state,"prepared-transaction-claim"))).toEqual(globalBefore);expect(await retainedTree(join(f.state,"transactions",f.winner.txid))).toEqual(winnerBefore);expect(await retainedTree(f.destination)).toEqual(destinationBefore);
});
for(const target of ["owner","journal"] as const) for(const variant of ["symlink","hardlink","mode","ancestor"] as const) test(`r5: unsafe global ${target} ${variant} holds before content access`,async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),parent=target==="owner"?join(f.state,"prepared-transaction-claim"):join(f.state,"transactions",f.winner.txid),path=join(parent,target==="owner"?"owner.json":"journal.json"),outside=join(f.root,"unsafe-global");
  if(variant==="ancestor"){await fs.rename(parent,outside);await fs.symlink(outside,parent);}else if(variant==="mode")await fs.chmod(path,0o644);else{await fs.copyFile(path,outside);await fs.rm(path);if(variant==="symlink")await fs.symlink(outside,path);else await fs.link(outside,path);}
  const read=issued.io.readFile;let unsafeReads=0;issued.io.readFile=async p=>{if(p===path)unsafeReads++;return read(p);};
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(unsafeReads).toBe(0);expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);expect(await fs.lstat(path).then(()=>true,()=>false)).toBe(true);
});
test("r5: foreign global evidence changing during private release holds without rewriting it",async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),authorize=issued.authority.authorize,path=join(f.state,"prepared-transaction-claim","owner.json");let changed=false;
  issued.authority.authorize=async request=>{const answer=await authorize(request);if(request.release_evidence&&!changed){changed=true;const owner=JSON.parse(await fs.readFile(path,"utf8"));owner.binding.claim_nonce="e".repeat(32);await fs.writeFile(path,JSON.stringify(owner));}return answer;};
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(changed).toBe(true);expect(JSON.parse(await fs.readFile(path,"utf8")).binding.claim_nonce).toBe("e".repeat(32));expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);
});
test("r5: coherent foreign publication drift still invalidates the release observation",async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),authorize=issued.authority.authorize,claim=join(f.state,"prepared-transaction-claim"),journal=join(f.state,"transactions",f.winner.txid,"journal.json");let changed=false;
  issued.authority.authorize=async request=>{const answer=await authorize(request);if(request.release_evidence&&!changed){changed=true;const owner=JSON.parse(await fs.readFile(join(claim,"owner.json"),"utf8")),entries=JSON.parse(await fs.readFile(journal,"utf8"));owner.binding.claim_nonce="d".repeat(32);entries[0].transaction_binding=owner.binding;await fs.writeFile(journal,JSON.stringify(entries));await fs.writeFile(join(claim,"owner.json"),JSON.stringify(owner));await fs.writeFile(join(claim,"capture.json"),JSON.stringify(owner));}return answer;};
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(changed).toBe(true);expect(JSON.parse(await fs.readFile(join(claim,"owner.json"),"utf8")).binding.claim_nonce).toBe("d".repeat(32));expect(await fs.readFile(f.destination,"utf8")).toBe(f.output);expect(await fs.lstat(join(f.state,"transactions",f.operation.txid,"prepared-claim")).then(()=>true,()=>false)).toBe(true);
});

test("r6: exact malformed foreign STAGE holds freshly authorized private release",async()=>{
  const f=await unpublishedLoserFixture(),winnerTx=join(f.state,"transactions",f.winner.txid),path=join(winnerTx,"journal.json");
  const entries=JSON.parse(await fs.readFile(path,"utf8"));entries.push({kind:"STAGE"});await fs.writeFile(path,JSON.stringify(entries));
  const issued=await ownerRelease(f,true),before=await retainedTree(winnerTx),claim=await retainedTree(join(f.state,"prepared-transaction-claim")),destination=await retainedTree(f.destination);
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");
  expect(await retainedTree(winnerTx)).toEqual(before);expect(await retainedTree(join(f.state,"prepared-transaction-claim"))).toEqual(claim);expect(await retainedTree(f.destination)).toEqual(destination);
  expect(await fs.lstat(join(f.state,"transactions",f.operation.txid,"prepared-claim")).then(()=>true,()=>false)).toBe(true);
});

/** Persisted prefixes are collected from the real writer, including apply's
 * COMPLETE followed by rollback's ABORT/custody/compensation/COMPLETE. */
async function foreignWriterHistory() {
  const f=await unpublishedLoserFixture();
  expect((await f.run("rollback",diskIO(),{operation:f.winner})).status).toBe("rolled-back");
  const path=join(f.state,"transactions",f.winner.txid,"journal.json");
  const entries=JSON.parse(await fs.readFile(path,"utf8")) as Array<Record<string,unknown>>;
  return {...f,path,entries};
}
async function expectForeignHistoryHold(f:Awaited<ReturnType<typeof unpublishedLoserFixture>>) {
  // Issued after the adversarial edit; fail-closed is independent of freshness.
  const issued=await ownerRelease(f,true),winner=join(f.state,"transactions",f.winner.txid),claim=join(f.state,"prepared-transaction-claim");
  const before=await retainedTree(winner),global=await retainedTree(claim),destination=await retainedTree(f.destination);
  const loser=join(f.state,"transactions",f.operation.txid),history=await retainedTree(join(loser,"journal.json"));
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");
  expect(await retainedTree(winner)).toEqual(before);expect(await retainedTree(claim)).toEqual(global);expect(await retainedTree(f.destination)).toEqual(destination);expect(await retainedTree(join(loser,"journal.json"))).toEqual(history);
  expect(await fs.lstat(join(loser,"prepared-claim")).then(()=>true,()=>false)).toBe(true);
}
for(const kind of ["STAGE","COMMIT_STEP","COMPENSATE","ABORT","COMPLETE","CUSTODY","CUSTODY_HOLD"] as const) test(`r6: every foreign ${kind} field is closed typed and manifest bound`,async()=>{
  const f=await foreignWriterHistory();
  const entries=structuredClone(f.entries.slice(0,f.entries.findIndex(entry=>entry.kind===(kind==="CUSTODY_HOLD"?"CUSTODY":kind))+1));
  if(kind==="CUSTODY_HOLD")entries.push({kind,ts:entries.at(-1)!.ts,step_id:entries.at(-1)!.step_id,custody_ref:entries.at(-1)!.custody_ref,observed_hash:sha256("foreign"),observed_mode:0o644,returned:true});
  const last=entries.at(-1)!;
  const mutations:Array<[string,(entry:Record<string,unknown>)=>void]>=[
    ["extra",e=>{e.unrecognized=true;}],["unknown-kind",e=>{e.kind="UNKNOWN";}],["prototype-kind",e=>{e.kind="toString";}],
    ["numeric-timestamp",e=>{e.ts=0;}],["invalid-timestamp",e=>{e.ts="invalid";}],["non-writer-timestamp",e=>{e.ts="2026-10-01";}],
    ...Object.keys(last).filter(key=>key!=="kind").map(key=>[`missing-${key}`,(e:Record<string,unknown>)=>{delete e[key];}] as [string,(entry:Record<string,unknown>)=>void]),
  ];
  if("step_id" in last)mutations.push(["unknown-step",e=>{e.step_id="unknown-step";}],["unsafe-step",e=>{e.step_id="../config.fixture";}],["typed-step",e=>{e.step_id=42;}]);
  if(kind==="STAGE")mutations.push(["destination",e=>{e.destination_symbolic="$HOME/unowned";}],["destination-type",e=>{e.destination_symbolic=null;}],["mode",e=>{e.mode="remove";}]);
  if(kind==="COMPENSATE")mutations.push(["method",e=>{e.method="restore-preimage";}]);
  if(kind==="ABORT")mutations.push(["reason",e=>{e.reason="UNKNOWN";}]);
  if(kind==="COMPLETE")mutations.push(["receipt-path",e=>{e.receipt_ref="../receipt.json";}]);
  if(kind==="CUSTODY"||kind==="CUSTODY_HOLD")mutations.push(["custody-path",e=>{e.custody_ref="../foreign";}],["custody-other-phase",e=>{e.custody_ref=String(e.custody_ref).replace("apply","rollback");}]);
  if(kind==="CUSTODY")mutations.push(["phase",e=>{e.phase="unknown";}],["hash",e=>{e.expected_hash=sha256("unbound");}],["hash-type",e=>{e.expected_hash=42;}],["mode",e=>{e.expected_mode=0o777;}],["mode-type",e=>{e.expected_mode="416";}]);
  if(kind==="CUSTODY_HOLD")mutations.push(["hash",e=>{e.observed_hash="unhashed";}],["mode",e=>{e.observed_mode=0o10000;}],["mode-fraction",e=>{e.observed_mode=1.5;}],["returned-type",e=>{e.returned="true";}],["not-foreign",e=>{e.observed_hash=entries.at(-2)!.expected_hash;e.observed_mode=entries.at(-2)!.expected_mode;}]);
  for(const [label,mutate] of mutations){const changed=structuredClone(entries);mutate(changed.at(-1)!);await fs.writeFile(f.path,JSON.stringify(changed));try{await expectForeignHistoryHold(f);}catch(error){throw new Error(`${kind}:${label}`,{cause:error});}}
});
for(const disorder of ["commit-before-stage","stage-after-abort","apply-custody-before-stage","rollback-custody-before-abort","compensate-before-abort","complete-before-commit","complete-before-compensation","duplicate-stage","duplicate-commit","duplicate-custody","duplicate-abort","duplicate-compensate","duplicate-complete","hold-without-custody","hold-after-commit","event-after-hold","event-after-rollback","custody-after-compensation"] as const) test(`r6: foreign writer order holds ${disorder}`,async()=>{
  const f=await foreignWriterHistory(),get=(kind:string)=>structuredClone(f.entries.find(e=>e.kind===kind)!),begin=get("BEGIN"),stage=get("STAGE"),custody=get("CUSTODY"),commit=get("COMMIT_STEP"),complete=get("COMPLETE"),abort=get("ABORT"),compensate=get("COMPENSATE"),rollback=structuredClone(f.entries.find(e=>e.kind==="CUSTODY"&&e.phase==="rollback")!);
  const hold={kind:"CUSTODY_HOLD",ts:custody.ts,step_id:custody.step_id,custody_ref:custody.custody_ref,observed_hash:sha256("foreign"),observed_mode:0o644,returned:true};
  const cases:Record<typeof disorder,Array<Record<string,unknown>>>={
    "commit-before-stage":[begin,commit],"stage-after-abort":[begin,abort,stage],"apply-custody-before-stage":[begin,custody],"rollback-custody-before-abort":[begin,stage,rollback],
    "compensate-before-abort":[begin,compensate],"complete-before-commit":[begin,stage,complete],"complete-before-compensation":[begin,stage,custody,commit,abort,complete],
    "duplicate-stage":[begin,stage,stage],"duplicate-commit":[begin,stage,custody,commit,commit],"duplicate-custody":[begin,stage,custody,custody],"duplicate-abort":[begin,abort,abort],
    "duplicate-compensate":[begin,abort,compensate,compensate],"duplicate-complete":[begin,stage,custody,commit,complete,complete],"hold-without-custody":[begin,stage,hold],
    "hold-after-commit":[begin,stage,custody,commit,hold],"event-after-hold":[begin,stage,custody,hold,commit],"event-after-rollback":[...f.entries,stage],"custody-after-compensation":[begin,stage,custody,commit,abort,compensate,rollback],
  };
  await fs.writeFile(f.path,JSON.stringify(cases[disorder]));await expectForeignHistoryHold(f);
});

for(const scenario of ["begin","stage","apply-custody","commit","applied","resumed","rollback-unstarted","rollback-abort","rollback-custody","compensated","rolled-back","hold-returned","hold-retained"] as const) test(`r6: actual foreign writer ${scenario} history permits independent private release`,async()=>{
  const f=await migrationFixture(),winner=createMigrationOperation(),io=diskIO(),rename=io.renameNoReplace!;
  let winnerStatus="";
  io.renameNoReplace=async(a,b)=>{
    if(b===join(f.state,"prepared-transaction-claim")){
      const winnerIO=diskIO(),write=winnerIO.writeFileAtomic,native=winnerIO.renameNoReplace!;
      const stopKind=scenario==="begin"||scenario==="rollback-unstarted"?"STAGE":scenario==="stage"||scenario==="resumed"?"STAGE":scenario==="apply-custody"?"CUSTODY":scenario==="commit"?"COMMIT_STEP":null;
      winnerIO.writeFileAtomic=async(p,d,o)=>{const event=p.endsWith("journal.json")?JSON.parse(d).at(-1).kind:null;if((scenario==="begin"||scenario==="rollback-unstarted")&&event===stopKind)throw new Error("before-stage");await write(p,d,o);if(event===stopKind&&stopKind)throw new Error("persisted-prefix");};
      if(scenario.startsWith("hold-"))winnerIO.renameNoReplace=async(from,to)=>{if(from===f.destination){await fs.writeFile(from,"foreign-inserted");await native(from,to);if(scenario==="hold-retained")await fs.writeFile(from,"occupied-concurrently");return;}await native(from,to);};
      winnerStatus=(await f.run("apply",winnerIO,{operation:winner})).status;
      if(scenario==="resumed")winnerStatus=(await f.run("resume",diskIO(),{operation:winner})).status;
      if(scenario.startsWith("rollback-")||scenario==="compensated"||scenario==="rolled-back"){
        const rollbackIO=diskIO(),writeRollback=rollbackIO.writeFileAtomic,target=scenario==="rollback-abort"?"ABORT":scenario==="rollback-custody"?"CUSTODY":scenario==="compensated"?"COMPENSATE":null;
        rollbackIO.writeFileAtomic=async(p,d,o)=>{await writeRollback(p,d,o);if(target&&p.endsWith("journal.json")&&JSON.parse(d).at(-1).kind===target)throw new Error("rollback-prefix");};
        winnerStatus=(await f.run("rollback",rollbackIO,{operation:winner})).status;
      }
    }
    await rename(a,b);
  };
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  expect(winnerStatus).toBe(["applied","resumed"].includes(scenario)?"committed":["rollback-unstarted","rolled-back"].includes(scenario)?"rolled-back":"manual-recovery");
  const tx=join(f.state,"transactions",winner.txid),claim=join(f.state,"prepared-transaction-claim"),loser=join(f.state,"transactions",f.operation.txid);
  const before=await retainedTree(tx),global=await retainedTree(claim),destination=await retainedTree(f.destination),history=await retainedTree(join(loser,"journal.json")),issued=await ownerRelease(f,true);
  for(let repetition=0;repetition<2;repetition++)expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");
  expect(issued.observed()).toBeGreaterThan(0);expect(await retainedTree(tx)).toEqual(before);expect(await retainedTree(claim)).toEqual(global);expect(await retainedTree(f.destination)).toEqual(destination);expect(await retainedTree(join(loser,"journal.json"))).toEqual(history);
});

for(const variant of ["valid-three-leaf-rollback","valid-no-preimage-rollback","stage-out-of-manifest-order","commit-out-of-manifest-order","compensation-out-of-manifest-order","rollback-custody-forward-order"] as const) test(`r6: ${variant} respects actual multi-leaf writer order`,async()=>{
  const f=await migrationFixture(variant!=="valid-no-preimage-rollback",3),winner=createMigrationOperation(),io=diskIO(),rename=io.renameNoReplace!;
  io.renameNoReplace=async(a,b)=>{if(b===join(f.state,"prepared-transaction-claim")){expect((await f.run("apply",diskIO(),{operation:winner})).status).toBe("committed");expect((await f.run("rollback",diskIO(),{operation:winner})).status).toBe("rolled-back");}await rename(a,b);};
  expect((await f.run("apply",io)).status).toBe("manual-recovery");
  const tx=join(f.state,"transactions",winner.txid),path=join(tx,"journal.json"),entries=JSON.parse(await fs.readFile(path,"utf8")) as Array<Record<string,unknown>>;
  if(!variant.startsWith("valid-")){
    const kind=variant==="stage-out-of-manifest-order"?"STAGE":variant==="commit-out-of-manifest-order"?"COMMIT_STEP":variant==="compensation-out-of-manifest-order"?"COMPENSATE":"CUSTODY";
    const positions=entries.flatMap((e,i)=>e.kind===kind&&(kind!=="CUSTODY"||e.phase==="rollback")?[i]:[]);
    [entries[positions[0]!],entries[positions[1]!]]=[entries[positions[1]!]!,entries[positions[0]!]!];
    await fs.writeFile(path,JSON.stringify(entries));await expectForeignHistoryHold({...f,winner});
  }else{
    const issued=await ownerRelease(f,true),before=await retainedTree(tx),global=await retainedTree(join(f.state,"prepared-transaction-claim")),destinations=await retainedTree(f.home);
    for(let repetition=0;repetition<2;repetition++)expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("released");
    expect(await retainedTree(tx)).toEqual(before);expect(await retainedTree(join(f.state,"prepared-transaction-claim"))).toEqual(global);expect(await retainedTree(f.home)).toEqual(destinations);
  }
});

for(const target of ["capture","manifest"] as const) for(const variant of ["symlink","hardlink","mode","ancestor"] as const) test(`r6: unsafe global ${target} ${variant} holds with zero unsafe reads`,async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),parent=target==="capture"?join(f.state,"prepared-transaction-claim"):join(f.state,"transactions",f.winner.txid),path=join(parent,target==="capture"?"capture.json":"surface-manifest.json"),outside=join(f.root,"unsafe-global"),destination=await retainedTree(f.destination);
  if(variant==="ancestor"){await fs.rename(parent,outside);await fs.symlink(outside,parent);}else if(variant==="mode")await fs.chmod(path,0o644);else{await fs.copyFile(path,outside);await fs.rm(path);if(variant==="symlink")await fs.symlink(outside,path);else await fs.link(outside,path);}
  const read=issued.io.readFile;let unsafeReads=0;issued.io.readFile=async p=>{if(p===path)unsafeReads++;return read(p);};
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(unsafeReads).toBe(0);expect(await retainedTree(f.destination)).toEqual(destination);expect(await fs.lstat(path).then(()=>true,()=>false)).toBe(true);
});
test("r6: foreign history appended during authorization holds the same release invocation",async()=>{
  const f=await unpublishedLoserFixture(),issued=await ownerRelease(f,true),authorize=issued.authority.authorize,path=join(f.state,"transactions",f.winner.txid,"journal.json");let changed=false;
  issued.authority.authorize=async request=>{const verdict=await authorize(request);if(request.release_evidence&&!changed){changed=true;const entries=JSON.parse(await fs.readFile(path,"utf8"));entries.push({kind:"STAGE"});await fs.writeFile(path,JSON.stringify(entries));}return verdict;};
  const destination=await retainedTree(f.destination),global=await retainedTree(join(f.state,"prepared-transaction-claim"));
  expect((await f.run("release",issued.io,{release_context:issued.context,authority:issued.authority})).status).toBe("manual-recovery");expect(changed).toBe(true);expect(await retainedTree(f.destination)).toEqual(destination);expect(await retainedTree(join(f.state,"prepared-transaction-claim"))).toEqual(global);expect(JSON.parse(await fs.readFile(path,"utf8")).at(-1)).toEqual({kind:"STAGE"});expect(await fs.lstat(join(f.state,"transactions",f.operation.txid,"prepared-claim")).then(()=>true,()=>false)).toBe(true);
});

for(const variant of ["unknown-manifest-field","unknown-leaf-field","unselected-module","unsafe-step","unknown-destination-root","unsafe-bound-destination","unbound-output","empty-manifest"] as const) test(`r6: coherently rebound foreign ${variant} holds`,async()=>{
  const f=await unpublishedLoserFixture(),tx=join(f.state,"transactions",f.winner.txid),path=join(tx,"surface-manifest.json"),journal=join(tx,"journal.json"),manifest=JSON.parse(await fs.readFile(path,"utf8")),entries=JSON.parse(await fs.readFile(journal,"utf8"));
  if(variant==="unknown-manifest-field")manifest.extra=true;if(variant==="unknown-leaf-field")manifest.leaves[0].extra=true;if(variant==="unselected-module")manifest.leaves[0].record_id="module.unselected";if(variant==="unsafe-step"){const leaf=manifest.leaves[0];leaf.step_id="..";leaf.output=`output/surface-${sha256("..")}.txt`;leaf.preimage=`preimage/surface-${sha256("..")}.txt`;for(const entry of entries)if(entry.step_id){entry.step_id="..";if(entry.kind==="CUSTODY")entry.custody_ref=`preimage/custody-${entry.phase}-${sha256("..")}.txt`;}}if(variant==="unsafe-bound-destination"){manifest.leaves[0].relative_path="config/unsafe\npath";for(const entry of entries)if(entry.kind==="STAGE")entry.destination_symbolic="$HOME/config/unsafe\npath";}if(variant==="unknown-destination-root")manifest.leaves[0].root_token="UNKNOWN";if(variant==="unbound-output")manifest.leaves[0].output="../unowned";if(variant==="empty-manifest")manifest.leaves=[];
  const bytes=JSON.stringify(manifest);entries[0].surface_manifest_sha256=sha256(bytes);await fs.writeFile(path,bytes);await fs.writeFile(journal,JSON.stringify(entries));await expectForeignHistoryHold(f);
});
