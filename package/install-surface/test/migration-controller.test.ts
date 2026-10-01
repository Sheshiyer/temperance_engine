import { expect, test } from 'bun:test';
import { createMigrationController, validateMigrationView } from '../src/migration/controller.ts';
import { workstationSnapshot } from './migration-fixtures.ts';

test('bare controller is closed, unselected, unknown and unauthorized', () => {
  const view = createMigrationController().view();
  expect(view.profile).toBeNull();
  expect(view.evidence.auth).toBe('unknown');
  expect(view.execution_authorized).toBe(false);
  expect(validateMigrationView(view)).toBe(true);
  expect(validateMigrationView({...view, authorization: true})).toBe(false);
});
test('both profiles are an explicit in-memory selection, never readiness', async () => {
  for (const profile of ['workstation', 'always-on-node'] as const) {
    const controller = createMigrationController();
    const result = await controller.dispatch({action:'select-profile', profile});
    expect(result.exitCode).toBe(0);
    expect(result.view.profile).toBe(profile);
    expect(result.view.execution_authorized).toBe(false);
    expect((await controller.dispatch({action:'plan', profile})).exitCode).toBe(1);
  }
});
test('public snapshot does not select a migration profile or grant authority', () => {
  const view = createMigrationController({snapshot:workstationSnapshot}).view();
  expect(view.snapshot).toEqual(workstationSnapshot);
  expect(view.profile).toBeNull();
  expect(view.actions.find(a=>a.id==='apply')?.enabled).toBe(false);
});
test('unknown action and injected approval are rejected without echo', async () => {
  for(const request of [{action:'private-secret'}, {action:'inspect',approved:true}]) {
    const result = await createMigrationController().dispatch(request);
    expect(result.exitCode).toBe(64);
    expect(JSON.stringify(result)).not.toContain('private-secret');
    expect(JSON.stringify(result)).not.toContain('approved');
  }
});
test('sign-in is only a human request and cancellation preserves unknown auth', async () => {
  const controller = createMigrationController();
  const request = await controller.dispatch({action:'request-sign-in'});
  expect(request.exitCode).toBe(1);
  expect(request.view.handoffs[0]?.execution).toBe('not-performed');
  const cancel = await controller.dispatch({action:'cancel'});
  expect(cancel.view.evidence.auth).toBe('unknown');
  expect(cancel.view.outcome).toBe('cancelled');
});

import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
import type { LifecycleIO } from '../src/lifecycle/journal.ts';
import { createCoreOnboardingCatalog } from '../src/onboarding/core-catalog.ts';
import { makeExpectedContext, fakeDigest } from './migration-fixtures.ts';
import { createMigrationPlan, calculateMigrationInputDigests, calculateMigrationDigest, type CreateMigrationPlanOptions, type MigrationPlanReviewContext } from '../src/migration/planner.ts';
import { migrationPreimageDigest } from '../src/migration/recovery.ts';
import { sha256 } from '../src/lifecycle/copy-tree.ts';
import { canonical } from '../src/canonical-json.ts';
import { migrationExitCode, MIGRATION_ACTION_IDS, type MigrationOwnerPorts, type MigrationRequest, type MigrationViewV1 } from '../src/migration/controller.ts';
function fixture(profile: "workstation" | "always-on-node" = "workstation"): CreateMigrationPlanOptions {
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

/** In-memory atomic map model ONLY. No native adapter, disk durability or host proof. */
function memoryIO() {
  interface Entry {dir:boolean;body:string;mode:number;ino:number;clock:number}
  const entries=new Map<string,Entry>();let tick=0,ino=0,writes=0;
  const err=(code:string):never=>{throw Object.assign(new Error('private-error'),{code});};
  const put=(p:string,dir:boolean,body='',mode=dir?0o700:0o600)=>{entries.set(p,{dir,body,mode,ino:++ino,clock:++tick});};
  const entry=(p:string)=>entries.get(p)??err('ENOENT');
  put('/',true);put('/fixture',true);put('/fixture/state',true);put('/fixture/home',true);put('/fixture/home/config',true);
  const rename=(a:string,b:string,exclusive:boolean)=>{const source=entry(a);if(exclusive&&entries.has(b))err('EEXIST');entry(dirname(b));const moved=[...entries].filter(([p])=>p===a||p.startsWith(a+'/'));entries.delete(b);for(const [p]of moved)entries.delete(p);for(const [p,e]of moved)entries.set(b+p.slice(a.length),e);writes++;};
  const io:LifecycleIO={
    mkdir:async(p,o)=>{if(entries.has(p)){if(o.recursive&&entry(p).dir)return;err('EEXIST');}if(!entries.has(dirname(p))){if(!o.recursive)err('ENOENT');await io.mkdir(dirname(p),o);}put(p,true);writes++;},
    writeFile:async(p,d)=>{entry(dirname(p));put(p,false,d);writes++;},
    writeFileAtomic:async(p,d,o)=>{entry(dirname(p));put(p,false,d,o?.mode??0o600);writes++;},
    readFile:async p=>{const e=entry(p);if(e.dir)err('EISDIR');return e.body;},
    readdir:async p=>{entry(p);return [...entries.keys()].filter(k=>k!==p&&dirname(k)===p).map(k=>k.slice(p.length+1));},
    rm:async(p,o)=>{if(!entries.has(p)){if(o.force)return;err('ENOENT');}const children=[...entries.keys()].filter(k=>k.startsWith(p+'/'));if(children.length&&!o.recursive)err('ENOTEMPTY');for(const k of children)entries.delete(k);entries.delete(p);writes++;},
    lstat:async p=>{const e=entry(p);return {dev:1,ino:e.ino,mode:(e.dir?0o040000:0o100000)|e.mode,nlink:1,size:Buffer.byteLength(e.body),mtimeMs:e.clock,ctimeMs:e.clock,isFile:()=>!e.dir,isDirectory:()=>e.dir,isSymbolicLink:()=>false} as Stats;},
    chmod:async(p,m)=>{const e=entry(p);e.mode=m;e.clock=++tick;writes++;},
    rename:async(a,b)=>rename(a,b,false),renameNoReplace:async(a,b)=>rename(a,b,true),realpath:async p=>{entry(p);return p;},now:()=>new Date('2026-10-01T00:00:04Z'),
    fetch:async()=>{throw new Error('NETWORK_FORBIDDEN');},execFile:async()=>{throw new Error('EXEC_FORBIDDEN');},
  };
  return {io,entries,writes:()=>writes};
}
async function ownerFixture(profile:'workstation'|'always-on-node'='workstation') {
  const disk=memoryIO(),input=fixture(profile),output='owned-after\n',prior='owned-before\n';
  input.private_binding.variables.STATE_ROOT='/fixture/home';
  const requirement=input.module_bindings[0]!.destinations[0]!;
  requirement.prepared_digest=`sha256:${sha256(output)}`;
  requirement.preimage_digest=migrationPreimageDigest(sha256(prior),0o640) as `sha256:${string}`;
  await disk.io.writeFileAtomic('/fixture/home/config/fixture.json',prior,{mode:0o640});
  Object.assign(input.source_context,calculateMigrationInputDigests(input));
  const pinned=structuredClone(input.source_context); // Independently fixed before proposal.
  const plan=await createMigrationPlan(input);expect(plan.holds).toEqual([]);
  const {pinned_at:_p,expires_at:_e,...bindings}=pinned;
  let review:MigrationPlanReviewContext={...bindings,plan_digest:plan.plan_digest,reviewed_at:'2026-10-01T00:00:03Z',expires_at:'2026-10-02T00:00:00Z'};
  const operation={txid:'123456789abc-12345678',claim_nonce:'a'.repeat(32)};
  const issuedPlan=canonical(plan),issuedReview=canonical(review),issuedOperation=canonical(operation);
  let authorizations=0,finalReviews=0,allowed=true,remote:'none'|'unknown'='none';
  const ports:MigrationOwnerPorts={
    sourceContext:{readPinnedContext:async()=>structuredClone(pinned)},planning:{readInputs:async()=>{const {source_context:_s,...rest}=input;return structuredClone(rest);}},
    finalReview:{readFinalReview:async()=>{finalReviews++;return structuredClone(review);}},
    recovery:{resolveOperation:async request=>({operation,plan,stateRoot:'/fixture/state',io:disk.io,root_tokens:{STATE_ROOT:'HOME'},...(request.action==='apply'?{prepared:new Map(plan.steps.map(s=>[s.id,output]))}:{})}),
      authority:{authorize:async request=>{authorizations++;return {authorized:allowed&&canonical(request.plan)===issuedPlan&&canonical(request.review)===issuedReview&&canonical(request.operation)===issuedOperation,owned_step_ids:plan.steps.map(s=>s.id),lifecycle_state_root:'/fixture/state',remote_outcome:remote};},readFreshInputs:async io=>{const root=await io.lstat('/fixture/home');if(!root.isDirectory()||root.isSymbolicLink())throw new Error('ROOT_DRIFT');const {source_context:_s,...rest}=input;return structuredClone(rest);}}},
  };
  const request=(action:'apply'|'resume'|'rollback'|'release'|'status'):MigrationRequest=>action==='apply'?{action,plan:'approved-plan',reviewed_digest:plan.plan_digest}:action==='status'?{action,operation:operation.txid}:{action,operation:operation.txid,reviewed_digest:plan.plan_digest};
  return {disk,input,plan,ports,request,operation,output,prior,counts:()=>({authorizations,finalReviews}),deny:()=>{allowed=false;},unknown:()=>{remote='unknown';},review:(r:MigrationPlanReviewContext)=>{review=r;},getReview:()=>structuredClone(review)};
}

for(const profile of ['workstation','always-on-node'] as const)test(`${profile}: shared owner controller delegates apply/status/resume/rollback/release`,async()=>{
  const f=await ownerFixture(profile),controller=createMigrationController({ports:f.ports});
  await controller.dispatch({action:'select-profile',profile});
  const proposed=await controller.dispatch({action:'plan',profile});
  expect(proposed.exitCode).toBe(1);expect(proposed.view.outcome).toBe('planned');expect(f.counts().finalReviews).toBe(0);
  for(const action of ['apply','status','resume','rollback','release'] as const) {
    const result=await controller.dispatch(f.request(action));
    expect(result.exitCode,JSON.stringify(result.view)).toBe(0);
    expect(validateMigrationView(result.view)).toBe(true);
    expect(result.view.execution_authorized).toBe(false);
    expect(result.view.evidence.auth).toBe('unknown');
    const text=JSON.stringify(result);
    for(const privateValue of ['/fixture','claim_nonce','device:fixture-issued','relative_path','source_context',operationNonce(f)])expect(text).not.toContain(privateValue);
  }
  expect(controller.view().operation?.prior_status).toBe('rolled-back');
  expect(await f.disk.io.readFile('/fixture/home/config/fixture.json')).toBe(f.prior);
  expect((await f.disk.io.lstat('/fixture/home/config/fixture.json')).mode&0o777).toBe(0o640);
  const before=JSON.stringify([...f.disk.entries]);
  expect((await controller.dispatch(f.request('release'))).exitCode).toBe(0);
  expect(JSON.stringify([...f.disk.entries])).toBe(before);
  expect((await controller.dispatch({action:'cancel'})).view.outcome).toBe('released');
});
function operationNonce(f:Awaited<ReturnType<typeof ownerFixture>>) {return f.operation.claim_nonce;}

test('source pins precede input collection, remain independent, and never issue final review',async()=>{
  const f=await ownerFixture(),calls:string[]=[];
  const readPins=f.ports.sourceContext!.readPinnedContext,readInputs=f.ports.planning!.readInputs;
  f.ports.sourceContext!.readPinnedContext=async(...a)=>{calls.push('pin');return readPins(...a);};
  f.ports.planning!.readInputs=async(...a)=>{calls.push('input');const input=await readInputs(...a);input.destination.identity_digest=fakeDigest('drift');return input;};
  const result=await createMigrationController({ports:f.ports}).dispatch({action:'plan',profile:'workstation'});
  expect(calls).toEqual(['pin','input']);expect(result.view.outcome).toBe('held');expect(result.view.plan?.hold_count).toBeGreaterThan(0);expect(f.counts().finalReviews).toBe(0);
});
test('final review, exact digest, original operation and named authority are mandatory',async()=>{
  for(const change of ['no-review','no-authority','digest','operation','review-digest','review-time','expired','denied','fresh-drift','stale-evidence','source-pin-as-review'] as const){
    const f=await ownerFixture(),before=f.disk.writes();let request=f.request('apply');
    if(change==='no-review')delete f.ports.finalReview;
    if(change==='no-authority')delete (f.ports.recovery as unknown as Record<string,unknown>).authority;
    if(change==='digest')request={action:'apply',plan:'approved-plan',reviewed_digest:fakeDigest('wrong')};
    if(change==='operation')request={action:'resume',operation:'aaaaaaaaaaaa-bbbbbbbb',reviewed_digest:f.plan.plan_digest};
    if(change==='review-digest')f.review({...f.getReview(),plan_digest:fakeDigest('wrong')});
    if(change==='review-time')f.review({...f.getReview(),reviewed_at:'2026-10-01T00:00:01Z'});
    if(change==='expired')f.disk.io.now=()=>new Date('2026-10-03T00:00:00Z');
    if(change==='denied')f.deny();
    if(change==='fresh-drift')f.input.destination.identity_digest=fakeDigest('drift');
    if(change==='stale-evidence')f.input.expected_context.required_organ_ids=['genesis'];
    if(change==='source-pin-as-review')f.ports.finalReview!.readFinalReview=async()=>f.input.source_context as unknown as MigrationPlanReviewContext;
    const result=await createMigrationController({ports:f.ports}).dispatch(request);
    expect(result.exitCode,change).not.toBe(0);expect(f.disk.writes(),change).toBe(before);expect(result.view.execution_authorized).toBe(false);
  }
});
test('missing atomic custody primitive holds without pretending native support',async()=>{
  const f=await ownerFixture(),before=f.disk.writes();delete f.disk.io.renameNoReplace;
  const result=await createMigrationController({ports:f.ports}).dispatch(f.request('apply'));
  expect(result.exitCode).toBe(2);expect(result.view.operation?.reason).toBe('ATOMIC_CUSTODY_UNSUPPORTED');expect(f.disk.writes()).toBe(before);
});
test('unknown owner outcome is never replayed or promoted by successful projection',async()=>{
  const f=await ownerFixture(),before=f.disk.writes();f.unknown();
  const result=await createMigrationController({ports:f.ports}).dispatch(f.request('apply'));
  expect(result.exitCode).toBe(2);expect(result.view.outcome).toBe('unknown-effect');expect(f.disk.writes()).toBe(before);
});
test('cancel before dispatch calls no owner; cancellation during effect awaits guarded outcome',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports}),abort=new AbortController();abort.abort();
  expect((await controller.dispatch(f.request('apply'),{signal:abort.signal})).view.outcome).toBe('cancelled');expect(f.counts().finalReviews).toBe(0);
  let entered!:()=>void,unblock!:()=>void;
  const gate=new Promise<void>(r=>unblock=r),started=new Promise<void>(r=>entered=r);
  const write=f.disk.io.writeFileAtomic;
  f.disk.io.writeFileAtomic=async(...args)=>{await write(...args);entered();await gate;};
  const running=controller.dispatch(f.request('apply'));await started;
  const cancel=controller.dispatch({action:'cancel'});let settled=false;void cancel.then(()=>settled=true);
  await Promise.resolve();expect(settled).toBe(false);expect(controller.view().effect_class).toBe('reviewed-local-transaction');
  unblock();const [completed,cancelled]=await Promise.all([running,cancel]);
  expect(completed.view.outcome).not.toBe('cancelled');expect(cancelled.view.outcome).not.toBe('cancelled');expect(['incomplete','manual-recovery','unknown-effect']).toContain(completed.view.outcome);
  expect(completed.view.effect_class).toBe('reviewed-local-transaction');
});
test('cancel during owner input resolution prevents recovery effects and concurrent actions hold',async()=>{
  const f=await ownerFixture();let entered!:()=>void,unblock!:()=>void;
  const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>unblock=r),resolve=f.ports.recovery!.resolveOperation;
  f.ports.recovery!.resolveOperation=async(...a)=>{entered();await gate;return resolve(...a);};
  const controller=createMigrationController({ports:f.ports}),running=controller.dispatch(f.request('apply'));await started;
  expect((await controller.dispatch({action:'select-profile',profile:'workstation'})).view.findings).toEqual([{code:'BUSY'}]);
  const cancelled=controller.dispatch({action:'cancel'});unblock();await cancelled;
  expect((await running).view.outcome).toBe('cancelled');expect(f.counts().authorizations).toBe(0);
});
test('owner failures and malformed resolution are sanitized without fallback execution',async()=>{
  for(const mode of ['throw','authority-json','missing-operation','private-plan'] as const) {
    const f=await ownerFixture(),resolve=f.ports.recovery!.resolveOperation,before=f.disk.writes();
    f.ports.recovery!.resolveOperation=async(...a)=>{
      if(mode==='throw')throw new Error('/private/secret-token');const packet=await resolve(...a);
      if(mode==='authority-json')return {...packet,authority:{authorized:true}};
      if(mode==='missing-operation')return {...packet,operation:{txid:packet.operation.txid}} as typeof packet;
      return {...packet,plan:{...packet.plan,private_key:'/private/secret-token'}};
    };
    const result=await createMigrationController({ports:f.ports}).dispatch(f.request('apply'));
    expect(result.exitCode).not.toBe(0);expect(JSON.stringify(result)).not.toContain('/private');expect(f.disk.writes()).toBe(before);
  }
});
test('inspection, source snapshot and cancel keep authentication dimensions independent',async()=>{
  const snapshot=structuredClone(workstationSnapshot),controller=createMigrationController({ports:{inspection:{adapter:{declaration:snapshot,artifacts:[],readArtifact:async()=>{throw new Error('UNEXPECTED');},metadata:async()=>({evidence:{auth:'yes',installed:'no',runtime:'stopped',verification:'unknown'}})}}}});
  const result=await controller.dispatch({action:'inspect'});
  expect(result.exitCode).toBe(0);expect(result.view.evidence).toMatchObject({auth:'yes',installed:'no',runtime:'stopped',verification:'unknown'});
  expect((await controller.dispatch({action:'cancel'})).view.evidence.auth).toBe('yes');
  expect((await controller.dispatch({action:'request-sign-in'})).view.evidence.auth).toBe('yes');
});
test('comparison delegates target-only unknown destination and private raw bindings are rejected',async()=>{
  const f=await ownerFixture();
  for(const target of [f.input.target,f.input.private_binding]){
    const result=await createMigrationController({ports:{comparison:{readInputs:async()=>({source:workstationSnapshot,target})}}}).dispatch({action:'diff',bundle:'source',host_binding:'target'});
    if(target===f.input.target){expect(result.exitCode).toBe(0);expect(result.view.comparison?.status).toBe('nonauthoritative');expect(result.view.comparison?.hold_count).toBeGreaterThan(0);}
    else expect(result.exitCode).toBe(64);
    expect(JSON.stringify(result)).not.toContain('/fixture');
  }
});
test('closed view rejects nested extras and impossible authority; fixed action effects and exits agree',()=>{
  const view=createMigrationController().view();
  expect(view.actions.map(a=>a.id)).toEqual([...MIGRATION_ACTION_IDS]);
  for(const id of ['inspect','diff','plan','status'])expect(view.actions.find(a=>a.id===id)?.effect_class).toBe('read-only');
  for(const path of ['version','evidence','actions','handoffs']){
    const altered=structuredClone(view) as unknown as Record<string,unknown>;
    const value=altered[path];if(Array.isArray(value))(value[0] as Record<string,unknown>).secret='private';else (value as Record<string,unknown>).secret='private';
    expect(validateMigrationView(altered)).toBe(false);
  }
  expect(validateMigrationView({...view,execution_authorized:true})).toBe(false);
  for(const [outcome,exit]of [['completed',0],['held',1],['planned',64],['cancelled',64],['incomplete',64],['unknown-effect',64],['manual-recovery',64],['invalid',64]] as const)expect(migrationExitCode({...view,outcome})).toBe(exit);
  expect(migrationExitCode({...view,command:'release',outcome:'committed'})).toBe(64);
});

test('mutable owner result aliases cannot change an exact request during later final review',async()=>{
  const f=await ownerFixture(),originalReview=f.getReview(),resolve=f.ports.recovery!.resolveOperation;
  let packet:Awaited<ReturnType<typeof resolve>>|undefined;
  f.ports.recovery!.resolveOperation=async(...a)=>{packet=await resolve(...a);return packet;};
  f.ports.finalReview!.readFinalReview=async(request)=>{
    packet!.plan.plan_digest=fakeDigest('changed-after-resolution');packet!.operation.txid='aaaaaaaaaaaa-bbbbbbbb';
    (request as {action:string}).action='release';
    return originalReview;
  };
  const result=await createMigrationController({ports:f.ports}).dispatch(f.request('apply'));
  expect(result.exitCode).toBe(0);expect(result.view.command).toBe('apply');expect(result.view.operation?.txid).toBe('123456789abc-12345678');
});

import type { PreparedReleaseEvidence } from '../src/lifecycle/executor.ts';
import { migrationReviewDigest, migrationReleaseEvidenceDigest, type MigrationTerminalReleaseContext } from '../src/migration/recovery.ts';
async function independentlyIssueRelease(f:Awaited<ReturnType<typeof ownerFixture>>) {
  const io=f.disk.io,tx=`/fixture/state/transactions/${f.operation.txid}`,claim='/fixture/state/prepared-transaction-claim';
  const binding=JSON.parse(await io.readFile(claim+'/owner.json')).binding;
  const artifacts:PreparedReleaseEvidence['artifacts']=[];
  const walk=async(relative:string):Promise<void>=>{const path=tx+(relative?'/'+relative:''),stat=await io.lstat(path);artifacts.push({path:relative,mode:stat.mode&0o7777,hash:null});for(const name of(await io.readdir(path)).sort()) {if(!relative&&['prepared-claim','released-claim'].includes(name))continue;const child=relative?relative+'/'+name:name,p=tx+'/'+child,s=await io.lstat(p);if(s.isDirectory())await walk(child);else artifacts.push({path:child,mode:s.mode&0o7777,hash:sha256(await io.readFile(p))});}};
  await walk('');
  const destinations:PreparedReleaseEvidence['destinations']=[];
  for(const step of f.plan.steps){const path='/fixture/home/'+step.relative_path,stat=await io.lstat(path);destinations.push({step_id:step.id,hash:sha256(await io.readFile(path)),mode:stat.mode&0o7777});}
  const evidence:PreparedReleaseEvidence={kind:'terminal',binding,capture_started:await io.lstat(claim+'/capture.json').then(()=>true,()=>false),artifacts,destinations};
  const context:MigrationTerminalReleaseContext={schema:'temperance.migration.terminal-release.v1',authorization_id:'owner.fixture.release',plan_digest:f.plan.plan_digest,review_digest:migrationReviewDigest(f.getReview()),txid:f.operation.txid,claim_nonce:f.operation.claim_nonce,lifecycle_state_root:'/fixture/state',evidence_digest:migrationReleaseEvidenceDigest(evidence),issued_at:'2026-10-03T00:00:00Z',expires_at:'2026-10-04T00:00:00Z'};
  // Independently retained owner records precede the release request and verifier.
  const approvedContext=canonical(context),approvedEvidence=canonical(evidence),approvedReview=canonical(f.getReview());let observations=0;
  const resolve=f.ports.recovery!.resolveOperation;
  f.ports.recovery!.resolveOperation=async(...a)=>({...await resolve(...a),release_context:structuredClone(context)});
  f.ports.recovery!.authority.authorize=async request=>{
    if(request.release_evidence)observations++;
    const authenticated=request.action==='release'&&canonical(request.review)===approvedReview&&canonical(request.release_context)===approvedContext&&(!request.release_evidence||canonical(request.release_evidence)===approvedEvidence);
    return {authorized:authenticated,release_authorized:authenticated,owned_step_ids:f.plan.steps.map(s=>s.id),lifecycle_state_root:'/fixture/state',remote_outcome:'none'};
  };
  io.now=()=>new Date('2026-10-03T00:00:01Z');return {context,observations:()=>observations};
}
for(const profile of ['workstation','always-on-node'] as const)test(`${profile}: current owner evidence releases terminal claim after original source/review expiry`,async()=>{
  const f=await ownerFixture(profile),controller=createMigrationController({ports:f.ports});
  expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(0);
  const issued=await independentlyIssueRelease(f),tx=`/fixture/state/transactions/${f.operation.txid}`,history=await f.disk.io.readFile(tx+'/journal.json');
  f.input.snapshot.source_release_digest=fakeDigest('changed-after-terminal');
  for(const action of ['apply','resume','rollback'] as const)expect((await controller.dispatch(f.request(action))).exitCode).toBe(2);
  const result=await controller.dispatch(f.request('release'));
  expect(result.exitCode,JSON.stringify(result)).toBe(0);expect(result.view.operation?.status).toBe('released');expect(result.view.operation?.prior_status).toBe('committed');expect(issued.observations()).toBeGreaterThan(0);
  expect(await f.disk.io.readFile('/fixture/home/config/fixture.json')).toBe(f.output);expect(await f.disk.io.readFile(tx+'/journal.json')).toBe(history);
  expect(JSON.stringify(result)).not.toContain('authorization_id');expect(JSON.stringify(result)).not.toContain('claim_nonce');
  const before=JSON.stringify([...f.disk.entries]);expect((await controller.dispatch(f.request('release'))).exitCode).toBe(0);expect(JSON.stringify([...f.disk.entries])).toBe(before);
});
test('release context helpers alone, expired capability and changed disk evidence confer no release authority',async()=>{
  for(const invalid of ['denied','expired','changed-evidence'] as const){
    const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(0);
    await independentlyIssueRelease(f);
    if(invalid==='denied')f.ports.recovery!.authority.authorize=async()=>({authorized:true,release_authorized:false,owned_step_ids:f.plan.steps.map(s=>s.id),lifecycle_state_root:'/fixture/state',remote_outcome:'none'});
    if(invalid==='expired')f.disk.io.now=()=>new Date('2026-10-05T00:00:00Z');
    if(invalid==='changed-evidence')await f.disk.io.writeFileAtomic('/fixture/home/config/fixture.json','foreign',{mode:0o600});
    expect((await controller.dispatch(f.request('release'))).exitCode).toBe(2);expect(f.disk.entries.has('/fixture/state/prepared-transaction-claim')).toBe(true);
  }
});

import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeMigrationExportIO } from '../src/migration/export.ts';
test('export cancellation before dispatch makes no IO; cancellation after publication waits and retains outcome',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'task5-export-')));
  try {
    for(const throws of [false,true]){
      let published!:()=>void,unblock!:()=>void,calls=0;
      const started=new Promise<void>(r=>published=r),gate=new Promise<void>(r=>unblock=r),output=join(root,throws?'uncertain.json':'complete.json');
      const io={...nodeMigrationExportIO,publish:async(a:string,b:string)=>{calls++;await nodeMigrationExportIO.publish(a,b);published();await gate;if(throws)throw new Error('/private/secret\x1b[31m');}};
      const controller=createMigrationController({snapshot:workstationSnapshot,ports:{manifestExport:{io}}});
      const abort=new AbortController();abort.abort();
      expect((await controller.dispatch({action:'export',manifest_only:true,output},{signal:abort.signal})).view.outcome).toBe('cancelled');expect(calls).toBe(0);
      const exporting=controller.dispatch({action:'export',manifest_only:true,output});await started;
      const cancel=controller.dispatch({action:'cancel'});let settled=false;void cancel.then(()=>settled=true);await Promise.resolve();expect(settled).toBe(false);
      unblock();const [result,cancelled]=await Promise.all([exporting,cancel]);
      expect(cancelled.view.actions).toEqual(result.view.actions);expect(cancelled.view.actions).toEqual(controller.view().actions);expect(cancelled.view.actions.some(a=>a.reason==='BUSY')).toBe(false);
      expect(result.exitCode).toBe(throws?2:0);expect(result.view.outcome).toBe(throws?'unknown-effect':'completed');expect(cancelled.view.effect_class).toBe('local-manifest-write');
      expect(JSON.stringify(result)).not.toContain('/private');expect(JSON.parse(await fs.readFile(output,'utf8'))).toEqual(workstationSnapshot);
      expect((await controller.dispatch({action:'cancel'})).view.outcome).toBe(result.view.outcome);
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('invalid initial snapshot never enables or reaches owner effects',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({snapshot:{...workstationSnapshot,secret:'/private/secret'},ports:f.ports});
  expect(controller.view().actions.find(a=>a.id==='apply')?.enabled).toBe(false);
  expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(64);expect(f.counts().finalReviews).toBe(0);
});
test('selected profile and resolved exact plan cannot disagree at effect dispatch',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports}),before=f.disk.writes();
  await controller.dispatch({action:'select-profile',profile:'always-on-node'});
  expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(64);expect(f.disk.writes()).toBe(before);
});
test('public view copies cannot grant owner capability or alter retained evidence',()=>{
  const original=structuredClone(workstationSnapshot),controller=createMigrationController({snapshot:original}),view=controller.view();
  original.profile='recovery';view.evidence.auth='yes';view.actions.find(a=>a.id==='apply')!.enabled=true;view.snapshot!.profile='recovery';
  expect(controller.view().snapshot?.profile).toBe(workstationSnapshot.profile);expect(controller.view().evidence.auth).toBe('unknown');expect(controller.view().actions.find(a=>a.id==='apply')?.enabled).toBe(false);
});

test('accessor-bearing requests and snapshots are rejected before value evaluation',async()=>{
  let reads=0;
  const request={get action(){reads++;return 'apply';}},snapshot={...workstationSnapshot};
  Object.defineProperty(snapshot,'profile',{enumerable:true,get(){reads++;return 'workstation';}});
  expect((await createMigrationController().dispatch(request)).exitCode).toBe(64);
  expect(createMigrationController({snapshot}).view().outcome).toBe('invalid');
  const nested=structuredClone(workstationSnapshot);Object.defineProperty(nested.logical_module_refs,'0',{enumerable:true,get(){reads++;return 'core';}});
  expect(createMigrationController({snapshot:nested}).view().outcome).toBe('invalid');expect(reads).toBe(0);
});

test('held proposal disables new apply before owner resolution while recovery scenario uses original target profile',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});
  f.input.destination.identity_digest=fakeDigest('drift');
  await controller.dispatch({action:'plan',profile:'workstation'});
  expect(controller.view().actions.find(a=>a.id==='apply')?.enabled).toBe(false);
  expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(64);expect(f.counts().finalReviews).toBe(0);
  const healthy=await ownerFixture(),recovery=createMigrationController({ports:healthy.ports});
  expect((await recovery.dispatch(healthy.request('apply'))).exitCode).toBe(0);
  await recovery.dispatch({action:'select-profile',profile:'recovery'});
  expect(recovery.view().actions.find(a=>a.id==='apply')?.enabled).toBe(false);
  expect((await recovery.dispatch(healthy.request('status'))).exitCode).toBe(0);
  expect((await recovery.dispatch(healthy.request('rollback'))).exitCode).toBe(0);
  expect(recovery.view().profile).toBe('recovery');expect(recovery.view().plan?.profile).toBe('workstation');
});

// R2 regressions independently identified by the terminal CORE review.
test('R2 settled cancellation, original response and fresh view have identical available actions',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});
  let entered!:()=>void,unblock!:()=>void;
  const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>unblock=r),write=f.disk.io.writeFileAtomic;
  f.disk.io.writeFileAtomic=async(...args)=>{await write(...args);entered();await gate;};
  const original=controller.dispatch(f.request('apply'));await started;
  const cancelled=controller.dispatch({action:'cancel'});unblock();
  const [result,cancel]=await Promise.all([original,cancelled]);
  expect(cancel.view.actions).toEqual(result.view.actions);expect(cancel.view.actions).toEqual(controller.view().actions);
  expect(cancel.view.actions.some(a=>a.reason==='BUSY')).toBe(false);
  expect(cancel.view.outcome).toBe(result.view.outcome);expect(cancel.view.effect_class).toBe('reviewed-local-transaction');
});
function committedPublicView():MigrationViewV1 {
  return {...createMigrationController().view(),step:'recovery',command:'apply',outcome:'committed',effect_class:'reviewed-local-transaction',findings:[{code:'VERIFIED'}],handoffs:[],operation:{txid:'123456789abc-12345678',plan_digest:fakeDigest('public-plan'),status:'committed',reason:'VERIFIED',external_signins_preserved:true}};
}
for(const contradiction of ['effect','reason','outcome','missing-operation'] as const)test(`R2 relational validator rejects ${contradiction} contradiction`,()=>{
  const view=committedPublicView();expect(validateMigrationView(view)).toBe(true);
  if(contradiction==='effect')view.effect_class='none';
  if(contradiction==='reason')view.operation!.reason='INTERRUPTED';
  if(contradiction==='outcome'){view.operation!.status='unknown-effect';view.operation!.reason='OWNER_RECONCILIATION_REQUIRED';}
  if(contradiction==='missing-operation')delete view.operation;
  expect(validateMigrationView(view)).toBe(false);
});
for(const profile of ['workstation','always-on-node'] as const)test(`R2 ${profile} proposal exposes actual safe exact-change review before an independent final review`,async()=>{
  const f=await ownerFixture(profile),controller=createMigrationController({ports:f.ports});
  const result=await controller.dispatch({action:'plan',profile});
  const plan=result.view.plan as unknown as Record<string,unknown>;
  expect(plan.source_release_digest).toBe(f.plan.source_release_digest);
  expect(plan.module_lock_digest).toBe(f.plan.module_lock_digest);
  expect(plan.binding_digest).toBe(f.plan.binding_digest);
  expect(plan.final_review).toEqual({state:'not-acquired',execution_authorized:false});
  expect(plan.steps).toHaveLength(f.plan.steps.length);expect(f.counts().finalReviews).toBe(0);
});

test('R2 relational positive matrix preserves every accepted action/result pair and independent evidence dimensions',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});
  const pairs:Array<[NonNullable<MigrationViewV1['operation']>['status'],NonNullable<MigrationViewV1['operation']>['reason']]>=[['committed','VERIFIED'],['rolled-back','VERIFIED'],['released','VERIFIED'],['incomplete','INTERRUPTED'],['manual-recovery','RECOVERY_REQUIRED'],['manual-recovery','ATOMIC_CUSTODY_UNSUPPORTED'],['manual-recovery','FOREIGN_CUSTODY_HELD'],['unknown-effect','OWNER_RECONCILIATION_REQUIRED']];
  for(const command of ['apply','resume','status','rollback','release'] as const)for(const [status,reason]of pairs){
    if(status==='released'&&command!=='release'||command==='release'&&['committed','rolled-back'].includes(status)||status==='committed'&&command==='rollback'||status==='rolled-back'&&command==='apply')continue;
    const view=committedPublicView();view.command=command;view.effect_class=command==='status'?'read-only':'reviewed-local-transaction';view.outcome=status;view.operation!.status=status;view.operation!.reason=reason;view.findings=[{code:reason}];
    view.evidence={discovered:'yes',installed:'yes',configured:'full',auth:'yes',admission:'pending',runtime:'unreachable',verification:'unknown'};
    if(status==='manual-recovery'||status==='unknown-effect')view.handoffs=[{kind:'owner-reconciliation',execution:'not-performed'}];
    if(!['committed','rolled-back'].includes(status))view.operation!.prior_status='committed';
    expect(validateMigrationView(view),`${command}/${status}/${reason}`).toBe(true);
    expect(migrationExitCode(view)).toBe(['committed','rolled-back','released'].includes(status)?0:status==='incomplete'?1:2);
    for(const wrong of ['VERIFIED','INTERRUPTED','RECOVERY_REQUIRED','OWNER_RECONCILIATION_REQUIRED','ATOMIC_CUSTODY_UNSUPPORTED','FOREIGN_CUSTODY_HELD'] as const){
      const validForStatus=status==='manual-recovery'?['RECOVERY_REQUIRED','ATOMIC_CUSTODY_UNSUPPORTED','FOREIGN_CUSTODY_HELD'].includes(wrong):wrong===reason;
      if(!validForStatus)expect(validateMigrationView({...view,operation:{...view.operation!,reason:wrong}})).toBe(false);
    }
  }
  // Exercise all non-lifecycle commands and all absent-owner holds through the controller.
  const fresh=createMigrationController();
  const requests:MigrationRequest[]=[{action:'select-profile',profile:'workstation'},{action:'inspect'},{action:'export',manifest_only:true,output:'manifest.json'},{action:'diff',bundle:'source',host_binding:'target'},{action:'plan',profile:'workstation'},f.request('apply'),f.request('resume'),f.request('status'),f.request('rollback'),f.request('release'),{action:'request-sign-in'},{action:'cancel'}];
  for(const request of requests){const result=await fresh.dispatch(request);expect(validateMigrationView(result.view),request.action).toBe(true);}
  const proposed=await controller.dispatch({action:'plan',profile:'workstation'});expect(validateMigrationView(proposed.view)).toBe(true);expect(proposed.exitCode).toBe(1);
});
test('R2 relational validation distinguishes pre-dispatch cancellation, refused retry, current uncertainty and later historical views',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});
  expect((await controller.dispatch(f.request('apply'))).exitCode).toBe(0);
  const committed=controller.view(),abort=new AbortController();abort.abort();
  const cancelled=await controller.dispatch(f.request('rollback'),{signal:abort.signal});
  expect(cancelled.view.outcome).toBe('cancelled');expect(cancelled.view.effect_class).toBe('none');expect(cancelled.view.operation?.status).toBe('committed');expect(validateMigrationView(cancelled.view)).toBe(true);
  f.deny();const refused=await controller.dispatch(f.request('resume'));
  expect(refused.view.operation?.status).toBe('manual-recovery');expect(refused.view.operation?.prior_status).toBe('committed');expect(validateMigrationView(refused.view)).toBe(true);expect(refused.exitCode).toBe(2);
  for(const command of ['select-profile','inspect','diff','plan','export','request-sign-in','cancel'] as const){
    const historical=structuredClone(committed);historical.command=command;
    historical.outcome=command==='plan'?'planned':command==='request-sign-in'?'awaiting-human':command==='cancel'?'cancelled':'completed';
    historical.effect_class=command==='select-profile'||command==='cancel'?'none':command==='export'?'local-manifest-write':command==='request-sign-in'?'human-handoff':'read-only';
    if(command==='inspect')historical.snapshot=structuredClone(workstationSnapshot);
    if(command==='diff')historical.comparison={status:'nonauthoritative',hold_count:1,finding_count:1,execution_authorized:false};
    if(command==='export')historical.export={digest:fakeDigest('exported'),bytes:100,execution_authorized:false};
    if(command==='plan')historical.plan!.final_review={state:'not-acquired',execution_authorized:false};
    if(command==='request-sign-in'){historical.findings=[{code:'SIGN_IN_REQUIRED'}];historical.handoffs=[{kind:'sign-in',execution:'not-performed'}];}
    if(command==='cancel')historical.findings=[{code:'CANCELLED'}];
    expect(validateMigrationView(historical),command).toBe(true);
  }
  const unknownExport={...committed,command:'export' as const,outcome:'unknown-effect' as const,effect_class:'local-manifest-write' as const,findings:[{code:'EXPORT_FAILED' as const}],handoffs:[{kind:'owner-reconciliation' as const,execution:'not-performed' as const}]};
  expect(validateMigrationView(unknownExport)).toBe(true);expect(migrationExitCode(unknownExport)).toBe(2);
  for(const change of [
    {...committed,command:'release',outcome:'committed'},
    {...committed,effect_class:'none'},
    {...refused.view,operation:{...refused.view.operation!,prior_status:'unknown-effect'}},
    {...refused.view,outcome:'committed'},
    {...cancelled.view,effect_class:'reviewed-local-transaction'},
    {...committed,outcome:'cancelled'},
    {...committed,operation:undefined},
  ])expect(validateMigrationView(change)).toBe(false);
});
for(const profile of ['workstation','always-on-node'] as const)test(`R2 ${profile} exact safe review joins every digest and requirement without inferring backup availability`,async()=>{
  const f=await ownerFixture(profile),controller=createMigrationController({ports:f.ports}),trace:string[]=[];
  const pins=f.ports.sourceContext!.readPinnedContext,inputs=f.ports.planning!.readInputs,review=f.ports.finalReview!.readFinalReview;
  f.ports.sourceContext!.readPinnedContext=async(...a)=>{trace.push('source-pins');return pins(...a);};
  f.ports.planning!.readInputs=async(...a)=>{trace.push('inputs');return inputs(...a);};
  f.ports.finalReview!.readFinalReview=async(...a)=>{trace.push('final-review');return review(...a);};
  const proposed=await controller.dispatch({action:'plan',profile}),publicPlan=proposed.view.plan!;
  expect(trace).toEqual(['source-pins','inputs']);
  for(const key of ['snapshot_digest','source_release_digest','module_lock_digest','selection_digest','destination_identity_digest','destination_observation_digest','binding_digest','configuration_generation_digest','prepared_intent_digest','preimage_digest','plan_digest'] as const)expect(publicPlan[key]).toBe(f.plan[key]);
  expect(publicPlan.selected_modules).toEqual(f.plan.selected_modules);expect(publicPlan.generated_at).toBe(f.plan.generated_at);
  expect(publicPlan.source_pinned_at).toBe(f.plan.source_context_pinned_at);expect(publicPlan.source_expires_at).toBe(f.plan.source_context_expires_at);
  for(const [index,step]of publicPlan.steps.entries()){
    const actual=f.plan.steps[index]!;
    expect(step).toEqual({id:actual.id,module_id:actual.module_id,source_digest:actual.source_digest,depends_on:actual.depends_on,effect:actual.effect,prepared_digest:actual.prepared_digest,preimage_digest:actual.preimage_digest,preconditions:actual.preconditions,verifier_probes:actual.verifier_probes,rollback:{requirements:actual.rollback_requirements,preimage_availability:'unknown',backup_availability:'unknown',restoration_verification:'unknown'}});
  }
  expect(publicPlan.final_review.state).toBe('not-acquired');expect(publicPlan.limits).toContain('backup-availability-unobserved');
  const applied=await controller.dispatch(f.request('apply'));expect(applied.exitCode).toBe(0);expect(trace).toEqual(['source-pins','inputs','final-review']);
  expect(applied.view.plan!.final_review).toEqual({state:'acquired',review_digest:migrationReviewDigest(f.getReview()),plan_digest:f.plan.plan_digest,reviewed_at:f.getReview().reviewed_at,expires_at:f.getReview().expires_at,validation:'historical-context-only',execution_authorized:false});
  expect(applied.view.plan!.steps[0]!.rollback.backup_availability).toBe('unknown');
  expect(applied.view.plan!.steps[0]!.rollback.restoration_verification).toBe('unknown');
  expect(validateMigrationView(applied.view)).toBe(true);
  const text=JSON.stringify(applied.view);
  for(const forbidden of ['/fixture','STATE_ROOT','relative_path','root_ref','device:fixture-issued','claim_nonce',f.operation.claim_nonce,'private_binding','prepared-claim','authorization_id'])expect(text).not.toContain(forbidden);
  const reviewCopy=applied.view.plan!;reviewCopy.steps[0]!.rollback.backup_availability='verified' as 'unknown';reviewCopy.selected_modules[0]='private';
  expect(validateMigrationView(applied.view)).toBe(false);expect(controller.view().plan!.steps[0]!.rollback.backup_availability).toBe('unknown');expect(controller.view().plan!.selected_modules).toEqual(f.plan.selected_modules);
});
test('R2 independently acquired review remains visible without granting denied ownership, and malformed context stays unavailable',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});f.deny();
  const denied=await controller.dispatch(f.request('apply'));
  expect(denied.exitCode).toBe(2);expect(denied.view.plan!.final_review.state).toBe('acquired');expect(denied.view.execution_authorized).toBe(false);
  for(const value of [null,{...f.getReview(),secret:'/private/secret\x1b[31m'},{...f.getReview(),reviewed_at:'private\x1b[31m'},{...f.getReview(),plan_digest:fakeDigest('forged')},f.input.source_context]){
    f.ports.finalReview!.readFinalReview=async()=>value as MigrationPlanReviewContext;
    const result=await createMigrationController({ports:f.ports}).dispatch(f.request('apply'));
    expect(result.exitCode).not.toBe(0);expect(result.view.plan?.final_review).toEqual({state:'invalid',execution_authorized:false});expect(validateMigrationView(result.view)).toBe(true);expect(JSON.stringify(result)).not.toContain('/private');expect(JSON.stringify(result)).not.toContain('\x1b');
  }
});
test('R2 safe review privacy and structural boundaries reject private, ANSI, oversized, duplicate and substituted projection fields',async()=>{
  const f=await ownerFixture(),controller=createMigrationController({ports:f.ports}),original=(await controller.dispatch({action:'plan',profile:'workstation'})).view;
  const changes:Array<(view:MigrationViewV1)=>void>=[
    v=>{v.plan!.selected_modules[0]='/private/secret';},v=>{v.plan!.steps[0]!.id='step\x1b[31m';},v=>{v.plan!.steps[0]!.module_id='name@example.test';},v=>{v.plan!.steps[0]!.id='x'.repeat(129);},v=>{v.plan!.steps[0]!.id='sk-privatecredential';},v=>{v.plan!.steps[0]!.id='session:private-native-id';},
    v=>{v.plan!.steps[0]!.depends_on=['unobserved-step'];},v=>{v.plan!.steps.push(structuredClone(v.plan!.steps[0]!));v.plan!.step_count++;},v=>{v.plan!.step_count++;},v=>{v.plan!.hold_count=1;},
    v=>{(v.plan!.steps[0] as unknown as Record<string,unknown>).root_ref='STATE_ROOT';},v=>{(v.plan as unknown as Record<string,unknown>).issued_device_ref='device:private';},
    v=>{v.plan!.steps[0]!.rollback.backup_availability='available' as 'unknown';},v=>{v.plan!.steps[0]!.rollback.preimage_availability='captured' as 'unknown';},v=>{v.plan!.steps[0]!.rollback.restoration_verification='verified' as 'unknown';},
    v=>{v.plan!.steps[0]!.effect='provider' as 'local-file';},v=>{v.plan!.steps[0]!.rollback.requirements[0]='private' as 'owned-preimage';},v=>{v.plan!.limits=[];},v=>{v.plan!.steps=Array(513).fill(v.plan!.steps[0]);v.plan!.step_count=513;},
    v=>{v.plan!.final_review={state:'acquired',review_digest:fakeDigest('forged'),plan_digest:fakeDigest('different'),reviewed_at:'2026-10-01T00:00:03Z',expires_at:'2026-10-02T00:00:00Z',validation:'historical-context-only',execution_authorized:false};},
  ];
  for(const change of changes){const view=structuredClone(original);change(view);expect(validateMigrationView(view)).toBe(false);expect(migrationExitCode(view)).toBe(64);}
  let evaluated=0;const accessor=structuredClone(original);Object.defineProperty(accessor.plan!.steps[0],'id',{enumerable:true,get(){evaluated++;return 'private';}});expect(validateMigrationView(accessor)).toBe(false);expect(evaluated).toBe(0);
});
test('R2 acquired review timing and digest cannot be replaced through aliases while the operation is pending',async()=>{
  const f=await ownerFixture(),record=f.getReview(),controller=createMigrationController({ports:f.ports});
  f.ports.finalReview!.readFinalReview=async()=>record;
  let started!:()=>void,unblock!:()=>void;const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>unblock=r),authorize=f.ports.recovery!.authority.authorize;
  f.ports.recovery!.authority.authorize=async(...a)=>{started();await gate;return authorize(...a);};
  const run=controller.dispatch(f.request('apply'));await entered;
  const shown=controller.view();expect(shown.plan!.final_review.state).toBe('acquired');
  const expected=migrationReviewDigest(f.getReview());record.plan_digest=fakeDigest('mutated');record.reviewed_at='private\x1b[31m';
  shown.plan!.steps[0]!.depends_on.push('private');unblock();
  const result=await run;expect(result.exitCode).toBe(0);
  expect(result.view.plan!.final_review).toMatchObject({state:'acquired',review_digest:expected,plan_digest:f.plan.plan_digest});expect(result.view.plan!.steps[0]!.depends_on).toEqual(f.plan.steps[0]!.depends_on);expect(validateMigrationView(result.view)).toBe(true);
});

for(const profile of ['workstation','always-on-node'] as const)test(`R2 ${profile} release displays independently resolved current context separately from expired original review`,async()=>{
  const f=await ownerFixture(profile),controller=createMigrationController({ports:f.ports});
  const applied=await controller.dispatch(f.request('apply'));expect(applied.exitCode).toBe(0);
  expect(applied.view.plan!.terminal_release).toEqual({state:'not-acquired',execution_authorized:false});
  const issued=await independentlyIssueRelease(f),released=await controller.dispatch(f.request('release'));
  expect(released.exitCode).toBe(0);expect(validateMigrationView(released.view)).toBe(true);
  expect(released.view.plan!.terminal_release).toEqual({state:'acquired',context_digest:calculateMigrationDigest(issued.context),plan_digest:f.plan.plan_digest,original_review_digest:migrationReviewDigest(f.getReview()),evidence_digest:issued.context.evidence_digest,issued_at:issued.context.issued_at,expires_at:issued.context.expires_at,scope:'release-only',validation:'structure-only',evidence_observation:'not-exposed-by-owner-api',freshness:'not-assessed',execution_authorized:false});
  expect(released.view.plan!.final_review).toMatchObject({state:'acquired',expires_at:f.getReview().expires_at});
  expect(Date.parse(issued.context.issued_at)).toBeGreaterThan(Date.parse(f.getReview().expires_at));
  expect(released.view.plan!.steps[0]!.rollback.backup_availability).toBe('unknown');
  for(const privateValue of [issued.context.authorization_id,issued.context.claim_nonce,issued.context.lifecycle_state_root,'authorization_id','claim_nonce','lifecycle_state_root'])expect(JSON.stringify(released)).not.toContain(privateValue);
  const copy=structuredClone(released.view);if(copy.plan!.terminal_release.state==='acquired')copy.plan!.terminal_release.original_review_digest=fakeDigest('foreign');expect(validateMigrationView(copy)).toBe(false);
});
test('R2 displayed release context has no freshness or authority and malformed context never leaks',async()=>{
  for(const failure of ['expired','denied','malformed'] as const){
    const f=await ownerFixture(),controller=createMigrationController({ports:f.ports});await controller.dispatch(f.request('apply'));
    const issued=await independentlyIssueRelease(f);
    if(failure==='expired')f.disk.io.now=()=>new Date('2026-10-05T00:00:00Z');
    if(failure==='denied')f.ports.recovery!.authority.authorize=async()=>({authorized:false,owned_step_ids:[],lifecycle_state_root:'/fixture/state',remote_outcome:'none'});
    if(failure==='malformed')issued.context.evidence_digest='/private/secret\x1b[31m';
    const result=await controller.dispatch(f.request('release'));expect(result.exitCode).toBe(2);expect(validateMigrationView(result.view)).toBe(true);
    expect(result.view.plan!.terminal_release.state).toBe(failure==='malformed'?'invalid':'acquired');
    expect(result.view.execution_authorized).toBe(false);expect(JSON.stringify(result)).not.toContain('/private/secret');expect(JSON.stringify(result)).not.toContain('\x1b');
    if(result.view.plan!.terminal_release.state==='acquired'){expect(result.view.plan!.terminal_release.freshness).toBe('not-assessed');expect(result.view.plan!.terminal_release.validation).toBe('structure-only');}
  }
});
function expandedPlanInputs(size:number,dependencyGraph=false):CreateMigrationPlanOptions {
  const input=fixture(),binding=input.module_bindings[0]!,destination=binding.destinations[0]!;
  binding.destinations=Array.from({length:size},(_,i)=>({...destination,id:`config.fixture${i}`,relative_path:`config/fixture${i}.json`}));
  if(dependencyGraph){
    input.catalog.modules.unshift({id:'core.second',title:'Second',summary:'Dependent fixture',preselection:'available',depends_on:['core.fixture'],requires:[],guided_installs:[]});
    input.selected_modules.push('core.second');input.target.requested_modules.push('core.second');
    input.module_bindings.push({...binding,module_id:'core.second',destinations:Array.from({length:size},(_,i)=>({...destination,id:`config.second${i}`,relative_path:`config/second${i}.json`}))});
  }
  Object.assign(input.source_context,calculateMigrationInputDigests(input),{selected_modules:[...input.selected_modules]});return input;
}
test('R2 accepted plan above 512 entries has a complete bounded review without truncation',async()=>{
  const input=expandedPlanInputs(513),actual=await createMigrationPlan(input);expect(actual.holds).toEqual([]);expect(actual.steps).toHaveLength(513);
  const controller=createMigrationController({ports:{sourceContext:{readPinnedContext:async()=>structuredClone(input.source_context)},planning:{readInputs:async()=>input}}});
  const result=await controller.dispatch({action:'plan',profile:'workstation'});expect(result.exitCode).toBe(1);expect(result.view.outcome).toBe('planned');
  expect(result.view.plan!.steps.map(s=>s.id)).toEqual(actual.steps.map(s=>s.id));expect(result.view.plan!.step_count).toBe(513);expect(validateMigrationView(result.view)).toBe(true);
});
test('R2 excessive accepted dependency graph holds review and effects instead of silently truncating it',async()=>{
  const input=expandedPlanInputs(100,true),actual=await createMigrationPlan(input);expect(actual.holds).toEqual([]);expect(actual.steps.reduce((n,s)=>n+s.depends_on.length,0)).toBe(10000);
  const f=await ownerFixture(),before=f.disk.writes();f.ports.sourceContext!.readPinnedContext=async()=>structuredClone(input.source_context);f.ports.planning!.readInputs=async()=>input;
  const controller=createMigrationController({ports:f.ports}),result=await controller.dispatch({action:'plan',profile:'workstation'});
  expect(result.exitCode).toBe(64);expect(result.view.findings).toEqual([{code:'OWNER_RESULT_INVALID'}]);expect(result.view.plan).toBeUndefined();expect(validateMigrationView(result.view)).toBe(true);
  for(const action of ['apply','resume','rollback','release'] as const){expect(result.view.actions.find(a=>a.id===action)).toMatchObject({enabled:false,reason:'ACTION_DISABLED'});expect((await controller.dispatch(f.request(action))).exitCode).toBe(64);}
  expect(f.counts().finalReviews).toBe(0);expect(f.disk.writes()).toBe(before);
});

test('R2 accepted private-looking logical identities hold before any review or effect instead of leaking',async()=>{
  for(const identity of ['session:native-canary','sk-privatecredential','config.secret-value']){
    const input=fixture();input.module_bindings[0]!.destinations[0]!.id=identity;
    Object.assign(input.source_context,calculateMigrationInputDigests(input));
    const actual=await createMigrationPlan(input);expect(actual.holds).toEqual([]);
    const f=await ownerFixture(),before=f.disk.writes();
    f.ports.sourceContext!.readPinnedContext=async()=>structuredClone(input.source_context);f.ports.planning!.readInputs=async()=>input;
    const controller=createMigrationController({ports:f.ports}),result=await controller.dispatch({action:'plan',profile:'workstation'});
    expect(result.exitCode).toBe(64);expect(result.view.plan).toBeUndefined();expect(JSON.stringify(result)).not.toContain(identity);expect(validateMigrationView(result.view)).toBe(true);
    expect(result.view.actions.find(a=>a.id==='apply')?.enabled).toBe(false);expect(f.counts().finalReviews).toBe(0);expect(f.disk.writes()).toBe(before);
  }
});

for(const field of ['actions','findings','handoffs'] as const)for(const shape of ['sparse','accessor','moving-accessor','non-enumerable','own-every','getter-every','own-iterator','symbol-extra','string-extra','custom-prototype','subclass'] as const)test(`R3 public ${field} rejects ${shape} without evaluating caller code`,()=>{
  const view=createMigrationController().view();view.findings=[{code:'INPUT_REQUIRED'}];
  let evaluated=0;const values=view[field] as unknown[],first=values[0];
  if(shape==='sparse')delete values[0];
  if(shape==='accessor'||shape==='moving-accessor')Object.defineProperty(values,'0',{enumerable:true,configurable:true,get(){evaluated++;if(shape==='moving-accessor')values.length=0;return first;}});
  if(shape==='non-enumerable')Object.defineProperty(values,'0',{enumerable:false,value:first});
  if(shape==='own-every')Object.defineProperty(values,'every',{enumerable:true,value:()=>{evaluated++;return true;}});
  if(shape==='getter-every')Object.defineProperty(values,'every',{enumerable:true,get(){evaluated++;return ()=>true;}});
  if(shape==='own-iterator')Object.defineProperty(values,Symbol.iterator,{value:function*(){evaluated++;yield first;}});
  if(shape==='symbol-extra')Object.defineProperty(values,Symbol('private-extra'),{value:'private'});
  if(shape==='string-extra')Object.defineProperty(values,'private_flag',{value:'/private/canary'});
  if(shape==='custom-prototype'){const prototype=Object.create(Array.prototype);prototype.every=()=>{evaluated++;return true;};Object.setPrototypeOf(values,prototype);}
  if(shape==='subclass'){class ForeignArray extends Array<unknown>{}Object.setPrototypeOf(values,ForeignArray.prototype);}
  expect(validateMigrationView(view)).toBe(false);expect(migrationExitCode(view)).toBe(64);expect(evaluated).toBe(0);
});
test('R3 hostile own every cannot bless a private action or forged public effects',()=>{
  const view=createMigrationController().view();let evaluated=0;
  view.actions[0]={id:'/private/canary',effect_class:'provider',enabled:true,reason:null} as unknown as MigrationViewV1['actions'][number];
  Object.defineProperty(view.actions,'every',{enumerable:true,value:()=>{evaluated++;return true;}});
  expect(validateMigrationView(view)).toBe(false);expect(migrationExitCode(view)).toBe(64);expect(evaluated).toBe(0);
});
test('R3 ordinary frozen public lists remain valid and throwing reflective inputs fail safely',()=>{
  const view=createMigrationController().view();for(const field of ['actions','findings','handoffs'] as const)Object.freeze(view[field]);
  expect(validateMigrationView(view)).toBe(true);expect(migrationExitCode(view)).toBe(0);
  const revoked=Proxy.revocable([],{});revoked.revoke();expect(validateMigrationView({...view,actions:revoked.proxy})).toBe(false);
  const reflective=new Proxy(view.actions,{getOwnPropertyDescriptor(){throw new Error('/private/canary');}});expect(validateMigrationView({...view,actions:reflective})).toBe(false);
});
