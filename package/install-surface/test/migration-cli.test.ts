import { expect, test } from 'bun:test';
import { parseMigrationArgs, runMigrationCli } from '../src/migration/cli-args.ts';

test('closed parser accepts bare snapshot view only', () => {
  expect(parseMigrationArgs(['--snapshot','fictional.json','--json'])).toEqual({json:true,snapshotPath:'fictional.json',request:null});
  for(const args of [['--tui'],['apply','--snapshot','fictional.json'],['--json','--json'],['--snapshot'],['--yes'],['--','anything']]) {
    expect(()=>parseMigrationArgs(args)).toThrow('ARGUMENT_INVALID');
  }
});
test('bare CLI succeeds as projection while mutation with no owner holds', async () => {
  expect((await runMigrationCli(['--json'])).exitCode).toBe(0);
  const held = await runMigrationCli(['rollback','--operation','123456789abc-12345678','--reviewed-digest',`sha256:${'a'.repeat(64)}`]);
  expect(held.exitCode).toBe(1);
  expect(held.view.execution_authorized).toBe(false);
});

import { afterAll, afterEach, beforeAll } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readSuppliedMigrationSnapshot, validateMigrationView, migrationExitCode, type MigrationOwnerPorts } from '../src/migration/controller.ts';
import { nodeMigrationReadIO, type MigrationReadIO } from '../src/migration/adapter.ts';
import { MAX_MIGRATION_SNAPSHOT_BYTES } from '../src/migration/contracts.ts';
import { workstationSnapshot, alwaysOnNodeSnapshot } from './migration-fixtures.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function temporary(){const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'task5-snapshot-')));roots.push(root);return root;}
async function publicFile(snapshot:unknown=workstationSnapshot) {const root=await temporary(),file=join(root,'public.json');await fs.writeFile(file,JSON.stringify(snapshot),{mode:0o600});return {root,file};}
const hash=`sha256:${'a'.repeat(64)}`,txid='123456789abc-12345678';
const forms=[[],['--json'],['inspect'],['export','--manifest-only','--output','manifest.json'],['diff','--bundle','source.json','--host-binding','target.json'],['plan','--profile','workstation'],['plan','--profile','always-on-node'],['plan','--profile','recovery'],['apply','--plan','plan.json','--reviewed-digest',hash],['resume','--operation',txid,'--reviewed-digest',hash],['status','--operation',txid],['rollback','--operation',txid,'--reviewed-digest',hash],['release','--operation',txid,'--reviewed-digest',hash],['cancel'],['request-sign-in']];
test('all admitted command forms accept a consistent JSON selector',()=>{
  for(const args of forms) {
    expect(()=>parseMigrationArgs(args)).not.toThrow();
    if(!args.includes('--json'))expect(parseMigrationArgs([...args,'--json']).json).toBe(true);
  }
});
test('parser matrix denies unknown/duplicate/extra/missing flags and authority injection',()=>{
  const bad=[['constructor'],['toString'],['__proto__'],['view'],['select-profile'],['--tui'],['--snapshot','a','--snapshot','b'],['--snapshot',''],['--snapshot','--json'],['--snapshot','a','inspect'],['export','--output','a'],['export','--manifest-only'],['export','--manifest-only','--output','a','--output','b'],['diff','--bundle','a'],['diff','--host-binding','b'],['plan','--profile','browser-worker'],['plan','--profile','workstation','--profile','always-on-node'],['apply','--plan','a','--reviewed-digest','a'.repeat(64)],['status','--operation','../private'],['status','--operation',txid,'--reviewed-digest',hash],['inspect','extra'],['inspect','--bundle','a'],['apply','--plan','a','--reviewed-digest',hash,'--snapshot','a'],['--json','inspect'],['--json\n'],Array(17).fill('--json'),['--snapshot','a'.repeat(4097)]];
  for(const flag of ['--yes','--force','--authority','--claim-nonce','--shell','--backend','--module','--'])for(const base of forms)bad.push([...base,flag]);
  for(const args of bad)expect(()=>parseMigrationArgs(args),JSON.stringify(args)).toThrow('ARGUMENT_INVALID');
});
test('closed snapshot view retains organs and references but no destination authority',async()=>{
  for(const snapshot of [workstationSnapshot,alwaysOnNodeSnapshot]) {
    const {file}=await publicFile(snapshot),result=await runMigrationCli(['--snapshot',file,'--json']);
    expect(result.exitCode).toBe(0);expect(validateMigrationView(result.view)).toBe(true);expect(result.view.snapshot).toEqual(snapshot);expect(result.view.profile).toBeNull();expect(result.view.evidence.auth).toBe('unknown');expect(result.view.snapshot?.organs.operating).toHaveLength(5);expect(result.view.snapshot?.organs.cognitive).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain(file);expect(result.view.actions.find(a=>a.id==='apply')?.enabled).toBe(false);
  }
});
test('untrusted public input rejects private extras, raw paths, malformed JSON and bad UTF-8',async()=>{
  const {file}=await publicFile();
  const invalid=[{...workstationSnapshot,approval:true},{...workstationSnapshot,private_binding:{root:'/private/secret'}},{...workstationSnapshot,logical_module_refs:['/private/secret']},{...workstationSnapshot,source_context:{authorized:true}},'{"secret":"private"',Buffer.from([0xff,0xfe]),'['.repeat(4000)+'0'+']'.repeat(4000)];
  for(const value of invalid) {
    await fs.writeFile(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
    const result=await runMigrationCli(['--snapshot',file,'--json']);expect(result.exitCode).toBe(64);expect(result.view.snapshot).toBeUndefined();expect(JSON.stringify(result)).not.toContain('/private');expect(JSON.stringify(result)).not.toContain('secret');
  }
});
function countingIO(hook?:{beforeOpen?:()=>Promise<void>;beforeRead?:()=>Promise<void>;afterRead?:()=>Promise<void>;readLimit?:number}) {
  let opens=0,reads=0,bytes=0,allocation=0;
  const io:MigrationReadIO={...nodeMigrationReadIO,open:async(...args)=>{opens++;await hook?.beforeOpen?.();const handle=await nodeMigrationReadIO.open(...args);return new Proxy(handle,{get(target,key){if(key==='read')return async(buffer:Buffer,offset:number,length:number,position:number)=>{reads++;allocation=Math.max(allocation,buffer.byteLength);await hook?.beforeRead?.();const result=await target.read(buffer,offset,Math.min(length,hook?.readLimit??length),position);bytes+=result.bytesRead;await hook?.afterRead?.();return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
  return {io,counts:()=>({opens,reads,bytes,allocation})};
}
test('links, ancestor symlinks, nonfiles and oversized descriptors fail before content access',async()=>{
  const {root,file}=await publicFile(),link=join(root,'linked.json');await fs.symlink(file,link);
  const directory=join(root,'parent');await fs.mkdir(directory);await fs.symlink(root,join(directory,'alias'));
  const hard=join(root,'hard.json');await fs.link(file,hard);
  for(const path of [link,hard,file,join(directory,'alias','public.json'),directory]) {
    const io=countingIO(),result=await readSuppliedMigrationSnapshot(path,{io:io.io});expect(result.ok).toBe(false);expect(io.counts().opens).toBe(0);expect(io.counts().reads).toBe(0);
  }
  await fs.unlink(hard);await fs.truncate(file,MAX_MIGRATION_SNAPSHOT_BYTES+1);
  const io=countingIO(),result=await readSuppliedMigrationSnapshot(file,{io:io.io});expect(result).toEqual({ok:false,code:'BYTE_LIMIT'});expect(io.counts().opens).toBe(0);
});
test('descriptor replacement and ancestor/mode drift fail before read',async()=>{
  for(const mutation of ['replace','mode','ancestor'] as const) {
    const {root,file}=await publicFile();
    const io=countingIO({beforeOpen:async()=>{if(mutation==='replace'){await fs.rename(file,file+'.old');await fs.writeFile(file,JSON.stringify(workstationSnapshot));}else if(mutation==='mode')await fs.chmod(file,0o640);else await fs.chmod(root,0o755);}});
    const result=await readSuppliedMigrationSnapshot(file,{io:io.io});expect(result.ok).toBe(false);expect(io.counts().reads).toBe(0);
  }
});
test('post-read drift, growth and truncation never publish a snapshot or exceed allocation',async()=>{
  for(const mutation of ['growth','truncate','mode','replace','ancestor'] as const) {
    const {root,file}=await publicFile(),size=(await fs.stat(file)).size;
    const io=countingIO({afterRead:async()=>{if(mutation==='growth')await fs.appendFile(file,'private');else if(mutation==='truncate')await fs.truncate(file,5);else if(mutation==='mode')await fs.chmod(file,0o640);else if(mutation==='replace'){await fs.rename(file,file+'.old');await fs.writeFile(file,JSON.stringify(workstationSnapshot));}else await fs.chmod(root,0o755);}});
    const result=await readSuppliedMigrationSnapshot(file,{io:io.io});expect(result.ok).toBe(false);expect(io.counts().allocation).toBe(size);expect(io.counts().bytes).toBeLessThanOrEqual(size);
  }
});
test('bounded content read count, cancellation and missing paths expose only fixed codes',async()=>{
  const {file}=await publicFile(),io=countingIO({readLimit:1});
  expect(await readSuppliedMigrationSnapshot(file,{io:io.io})).toEqual({ok:false,code:'READ_LIMIT'});expect(io.counts().reads).toBe(64);
  const cancelled=new AbortController();cancelled.abort();const before=countingIO();
  expect(await readSuppliedMigrationSnapshot(file,{signal:cancelled.signal,io:before.io})).toEqual({ok:false,code:'CANCELLED'});expect(before.counts().opens).toBe(0);
  const during=new AbortController(),partial=countingIO({afterRead:async()=>during.abort()});
  expect(await readSuppliedMigrationSnapshot(file,{signal:during.signal,io:partial.io})).toEqual({ok:false,code:'CANCELLED'});
  const missing=await runMigrationCli(['--snapshot',file+'private','--json']);expect(missing.exitCode).toBe(64);expect(JSON.stringify(missing)).not.toContain(file);
});

let buildRoot:string,entry:string;
beforeAll(async()=>{
  buildRoot=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'task5-compiled-')));
  await fs.symlink(resolve(import.meta.dir,'../node_modules'),join(buildRoot,'node_modules'));
  const build=await Bun.build({entrypoints:[resolve(import.meta.dir,'../src/cli.ts')],outdir:buildRoot,target:'bun',packages:'external'});
  expect(build.success).toBe(true);entry=join(buildRoot,'cli.js');
});
afterAll(async()=>{if(buildRoot)await fs.rm(buildRoot,{recursive:true,force:true});});
async function compiled(args:string[],root:string) {
  const env={PATH:'/usr/bin:/bin',HOME:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),TEMPERANCE_STATE:join(root,'state'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'xdg-state'),TMPDIR:root,CI:'1'};
  const child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null',entry,'migrate',...args],{cwd:root,env,stdout:'pipe',stderr:'pipe'});
  const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,err,exit};
}
test('actual compiled bare CLI is headless and creates no state roots or selected profile',async()=>{
  const root=await temporary(),before=await fs.readdir(root),result=await compiled(['--json'],root);
  expect(result.err).toBe('');expect(result.exit).toBe(0);const view=JSON.parse(result.out);expect(validateMigrationView(view)).toBe(true);expect(view.profile).toBeNull();expect(view.evidence.auth).toBe('unknown');expect(await fs.readdir(root)).toEqual(before);
});
test('actual compiled snapshot CLI preserves fictional public projection and leaves input bytes intact',async()=>{
  const {root,file}=await publicFile(),before=await fs.readFile(file),result=await compiled(['--snapshot',file,'--json'],root);
  expect(result.err).toBe('');expect(result.exit).toBe(0);expect(JSON.parse(result.out).snapshot).toEqual(workstationSnapshot);expect(result.out).not.toContain(root);expect(await fs.readFile(file)).toEqual(before);expect(await fs.readdir(root)).toEqual(['public.json']);
});
test('compiled mutations hold without owner; unknown flags fail safely and never route legacy rollback',async()=>{
  const root=await temporary();
  for(const args of [['rollback','--operation',txid,'--reviewed-digest',hash],['release','--operation',txid,'--reviewed-digest',hash],['apply','--plan','private-plan','--reviewed-digest',hash],['status','--operation',txid],['--private-secret']]) {
    const result=await compiled(args,root);expect(result.err).toBe('');expect(result.exit).toBe(args[0]==='--private-secret'?64:1);expect(validateMigrationView(JSON.parse(result.out))).toBe(true);expect(result.out).not.toContain('private-secret');expect(result.out).not.toContain('private-plan');expect(await fs.readdir(root)).toEqual([]);
  }
});

test('snapshot member/depth budgets reject large collections without forwarding owner data',async()=>{
  const {file}=await publicFile({...workstationSnapshot,held_requirements:Array(30001).fill('held')});
  expect((await runMigrationCli(['--snapshot',file])).exitCode).toBe(64);
  const root=await temporary();
  const result=await runMigrationCli(['--snapshot',join(root,...Array(130).fill('folder'),'snapshot')]);
  expect(result.view.findings).toEqual([{code:'SNAPSHOT_DENIED'}]);
});

for(const argv of [[],['--json'],['plan','--profile','workstation'],['plan','--profile','always-on-node']])test(`R3 pre-aborted CLI ${argv.join(' ')||'bare'} returns a valid mapped no-effect cancellation`,async()=>{
  const abort=new AbortController();abort.abort();let owners=0;
  const result=await runMigrationCli(argv,{signal:abort.signal,ports:{sourceContext:{readPinnedContext:async()=>{owners++;throw new Error('/private/canary');}},planning:{readInputs:async()=>{owners++;throw new Error('/private/canary');}}}});
  expect(result.view).toMatchObject({command:'cancel',outcome:'cancelled',effect_class:'none',profile:null,findings:[{code:'CANCELLED'}],execution_authorized:false});
  expect(validateMigrationView(result.view)).toBe(true);expect(result.exitCode).toBe(1);expect(migrationExitCode(result.view)).toBe(result.exitCode);expect(owners).toBe(0);
});
test('R3 actual snapshot loader cancellation yields a valid mapper-consistent cancellation and closes its descriptor',async()=>{
  const {file}=await publicFile(),before=await fs.readFile(file),open=nodeMigrationReadIO.open;
  let entered!:()=>void,resume!:()=>void,closed=0;
  const opened=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>resume=r),abort=new AbortController();
  nodeMigrationReadIO.open=async(...args)=>{const handle=await open(...args);entered();await gate;return new Proxy(handle,{get(target,key){if(key==='close')return async()=>{closed++;return target.close();};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});};
  try {
    const pending=runMigrationCli(['--snapshot',file,'--json'],{signal:abort.signal});await opened;abort.abort();resume();const result=await pending;
    expect(result.view).toMatchObject({command:'cancel',outcome:'cancelled',effect_class:'none',findings:[{code:'CANCELLED'}]});expect(result.view.snapshot).toBeUndefined();
    expect(validateMigrationView(result.view)).toBe(true);expect(result.exitCode).toBe(1);expect(migrationExitCode(result.view)).toBe(1);expect(closed).toBe(1);expect(await fs.readFile(file)).toEqual(before);expect(JSON.stringify(result)).not.toContain(file);
  }finally{resume();nodeMigrationReadIO.open=open;}
});
for(const shape of ['sparse','accessor','moving-accessor','non-enumerable','extra','symbol','own-some','getter-some','own-iterator','getter-iterator','custom-prototype','subclass'] as const)test(`R3 parser and headless runner reject ${shape} argv before evaluation, owner calls or IO`,async()=>{
  let evaluated=0,owners=0,ioCalls=0;const args=['inspect'];
  if(shape==='sparse')delete args[0];
  if(shape==='accessor'||shape==='moving-accessor')Object.defineProperty(args,'0',{enumerable:true,get(){evaluated++;if(shape==='moving-accessor')args.push('--private-canary');return 'inspect';}});
  if(shape==='non-enumerable')Object.defineProperty(args,'0',{enumerable:false,value:'inspect'});
  if(shape==='extra')Object.defineProperty(args,'private_flag',{enumerable:true,value:'--force'});
  if(shape==='symbol')Object.defineProperty(args,Symbol('private'),{value:true});
  if(shape==='own-some')Object.defineProperty(args,'some',{value:()=>{evaluated++;return false;}});
  if(shape==='getter-some')Object.defineProperty(args,'some',{get(){evaluated++;return ()=>false;}});
  if(shape==='own-iterator')Object.defineProperty(args,Symbol.iterator,{value:function*(){evaluated++;yield 'inspect';}});
  if(shape==='getter-iterator')Object.defineProperty(args,Symbol.iterator,{get(){evaluated++;return function*(){yield 'inspect';};}});
  if(shape==='custom-prototype'){const prototype=Object.create(Array.prototype);prototype[Symbol.iterator]=function*(){evaluated++;yield 'inspect';};Object.setPrototypeOf(args,prototype);}
  if(shape==='subclass'){class ForeignArgs extends Array<string>{}Object.setPrototypeOf(args,ForeignArgs.prototype);}
  const lstat=nodeMigrationReadIO.lstat;nodeMigrationReadIO.lstat=async()=>{ioCalls++;throw new Error('/private/canary');};
  const ports:MigrationOwnerPorts={inspection:{adapter:{declaration:structuredClone(workstationSnapshot),artifacts:[],readArtifact:async()=>{owners++;throw new Error('/private/canary');},metadata:async()=>{owners++;return {};}}}};
  try {
    expect(()=>parseMigrationArgs(args)).toThrow('ARGUMENT_INVALID');
    const result=await runMigrationCli(args,{ports});expect(result.view.findings).toEqual([{code:'ARGUMENT_INVALID'}]);expect(result.exitCode).toBe(64);expect(validateMigrationView(result.view)).toBe(true);expect(migrationExitCode(result.view)).toBe(64);
    expect(evaluated).toBe(0);expect(owners).toBe(0);expect(ioCalls).toBe(0);expect(JSON.stringify(result)).not.toContain('private');
  }finally{nodeMigrationReadIO.lstat=lstat;}
});
test('R3 parser copies ordinary frozen argv data and sanitizes detectably invalid or throwing reflective inputs',async()=>{
  const args=Object.freeze(['plan','--profile','always-on-node','--json']);expect(parseMigrationArgs(args)).toEqual({json:true,request:{action:'plan',profile:'always-on-node'}});
  const invalid:unknown[]=[null,{},'inspect',Object.create(null),new Proxy(['inspect'],{getOwnPropertyDescriptor(){throw new Error('/private/canary');}})];
  const revoked=Proxy.revocable(['inspect'],{});revoked.revoke();invalid.push(revoked.proxy);
  for(const value of invalid){expect(()=>parseMigrationArgs(value as string[])).toThrow('ARGUMENT_INVALID');const result=await runMigrationCli(value as string[]);expect(result.exitCode).toBe(64);expect(result.view.findings).toEqual([{code:'ARGUMENT_INVALID'}]);expect(JSON.stringify(result)).not.toContain('/private');}
});
