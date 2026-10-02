import { expect, test } from 'bun:test';
import { parseMigrationArgs, runMigrationCli } from '../src/migration/cli-args.ts';

test('closed parser accepts bare snapshot view only', () => {
  expect(parseMigrationArgs(['--snapshot','fictional.json','--json'])).toEqual({json:true,snapshotPath:'fictional.json',request:null});
  for(const args of [['--tui','--json'],['apply','--snapshot','fictional.json'],['--json','--json'],['--snapshot'],['--yes'],['--','anything']]) {
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
import { dirname, join, relative, resolve, sep } from 'node:path';
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
  const bad=[['constructor'],['toString'],['__proto__'],['view'],['select-profile'],['--tui','--json'],['--snapshot','a','--snapshot','b'],['--snapshot',''],['--snapshot','--json'],['--snapshot','a','inspect'],['export','--output','a'],['export','--manifest-only'],['export','--manifest-only','--output','a','--output','b'],['diff','--bundle','a'],['diff','--host-binding','b'],['plan','--profile','browser-worker'],['plan','--profile','workstation','--profile','always-on-node'],['apply','--plan','a','--reviewed-digest','a'.repeat(64)],['status','--operation','../private'],['status','--operation',txid,'--reviewed-digest',hash],['inspect','extra'],['inspect','--bundle','a'],['apply','--plan','a','--reviewed-digest',hash,'--snapshot','a'],['--json','inspect'],['--json\n'],Array(17).fill('--json'),['--snapshot','a'.repeat(4097)]];
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
  // Use the shipping command's flags; only relocate its output into this test's private directory.
  const pkg=JSON.parse(await fs.readFile(resolve(import.meta.dir,'../package.json'),'utf8'));
  const args:string[]=pkg.scripts.build.split(' ');
  expect(args.slice(0,3)).toEqual(['bun','build','src/cli.ts']);
  const out=args.indexOf('--outdir=dist');expect(out).toBeGreaterThan(0);args[out]=`--outdir=${buildRoot}`;
  const build=Bun.spawn([process.execPath,...args.slice(1)],{cwd:resolve(import.meta.dir,'..'),env:{...process.env,BUN_CONFIG_NO_CLEAR_TERMINAL:'1'},stdout:'pipe',stderr:'pipe'});
  const [exit,stdout,stderr]=await Promise.all([build.exited,new Response(build.stdout).text(),new Response(build.stderr).text()]);
  expect(exit,stdout+stderr).toBe(0);entry=join(buildRoot,'cli.js');
});
afterAll(async()=>{if(buildRoot)await fs.rm(buildRoot,{recursive:true,force:true});});
async function compiled(args:string[],root:string) {
  const env={PATH:'/usr/bin:/bin',HOME:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),TEMPERANCE_STATE:join(root,'state'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'xdg-state'),TMPDIR:root,CI:'1',LIVE:'0',TEMPERANCE_ALLOW_LIVE_INSPECTION:'0',DO_NOT_TRACK:'1'};
  const child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null',entry,'migrate',...args],{cwd:root,env,stdout:'pipe',stderr:'pipe'});
  const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,err,exit};
}
test('shipping compiled entry has no eager native dependency and retains lazy UI chunks',async()=>{
  const scanner=new Bun.Transpiler({loader:'js',target:'bun'}),visited=new Set<string>(),lazy=new Set<string>();
  async function walk(file:string):Promise<void>{
    if(visited.has(file))return;visited.add(file);
    for(const ref of scanner.scanImports(await fs.readFile(file,'utf8'))){
      if(ref.kind==='dynamic-import'){if(ref.path.startsWith('.'))lazy.add(resolve(dirname(file),ref.path));continue;}
      expect(ref.path,'eager native import in '+relative(buildRoot,file)).not.toMatch(/^(?:@opentui(?:\/|$)|bun:ffi$|node:ffi$)/);
      if(ref.path.startsWith('.')){
        const next=resolve(dirname(file),ref.path);expect(next.startsWith(buildRoot+sep)).toBe(true);await walk(next);
      }
    }
  }
  await walk(entry);expect(lazy.size).toBeGreaterThan(0);
  for(const file of lazy){expect(file.startsWith(buildRoot+sep)).toBe(true);expect((await fs.stat(file)).isFile()).toBe(true);}
});
test('same compiled closure remains headless with copied native asset or core module absent',async()=>{
  const root=await temporary(),copy=join(root,'compiled');await fs.mkdir(copy);
  for(const name of await fs.readdir(buildRoot))if(name.endsWith('.js'))await fs.copyFile(join(buildRoot,name),join(copy,name));
  await fs.cp(resolve(import.meta.dir,'../node_modules'),join(copy,'node_modules'),{recursive:true});
  const native=join(copy,'node_modules/@opentui/core-darwin-arm64/libopentui.dylib');
  expect((await fs.stat(native)).isFile()).toBe(true);await fs.unlink(native);
  const home=join(root,'home');await fs.mkdir(home);const snapshot=join(home,'public.json');await fs.writeFile(snapshot,JSON.stringify(workstationSnapshot),{mode:0o600});
  for(const unavailable of ['native-asset','native-module']){
  if(unavailable==='native-module')await fs.rm(join(copy,'node_modules/@opentui/core'),{recursive:true});
  for(const args of [['--json'],['--snapshot',snapshot,'--json'],['status','--operation',txid,'--json']]){
    const child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null',join(copy,'cli.js'),'migrate',...args],{cwd:home,env:{PATH:'/usr/bin:/bin',HOME:home,TMPDIR:home,XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'state'),XDG_DATA_HOME:join(home,'data'),CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),OPENCODE_HOME:join(home,'opencode'),CURSOR_HOME:join(home,'cursor'),PAI_HOME:join(home,'pai'),TEMPERANCE_STATE:join(home,'state'),TEMPERANCE_STATE_DIR:join(home,'state'),LIVE:'0',TEMPERANCE_ALLOW_LIVE_INSPECTION:'0',DO_NOT_TRACK:'1',CI:'1'},stdout:'pipe',stderr:'pipe'});
    const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(err).toBe('');expect(exit).toBe(args[0]==='status'?1:0);const view=JSON.parse(out);expect(validateMigrationView(view)).toBe(true);expect(view.execution_authorized).toBe(false);
    if(args[0]==='--snapshot')expect(view.snapshot).toEqual(workstationSnapshot);
    if(args[0]==='status')expect(view.outcome).toBe('held');
    expect(await fs.readdir(home)).toEqual(['public.json']);
  }
  }
  expect(await fs.exists(native)).toBe(false);
},20000);
test('compiled headless paths never attempt UI or FFI resolution even when import errors could be caught',async()=>{
  const root=await temporary(),copy=join(root,'compiled');await fs.mkdir(copy);
  for(const name of await fs.readdir(buildRoot))if(name.endsWith('.js'))await fs.copyFile(join(buildRoot,name),join(copy,name));
  await fs.symlink(resolve(import.meta.dir,'../node_modules'),join(copy,'node_modules'));
  const scanner=new Bun.Transpiler({loader:'js',target:'bun'});
  const uiChunks:string[]=[];
  for(const name of await fs.readdir(copy))if(name.endsWith('.js')){
    const source=await fs.readFile(join(copy,name),'utf8');
    if(scanner.scan(source).exports.includes('runMigrationTui'))uiChunks.push(name);
  }
  expect(uiChunks).toHaveLength(1);
  const marker=join(root,'resolution-attempts.jsonl'),preload=join(root,'sentinel.ts');
  // Observe attempted resolution BEFORE export linking or module evaluation. Rejecting here
  // also prevents the negative control from evaluating the real native dependency.
  await fs.writeFile(preload,`import { plugin } from 'bun';\nimport { appendFileSync } from 'node:fs';\nplugin({name:'headless-resolution-sentinel',setup(build){build.onResolve({filter:/^(?:@opentui(?:\\/|$)|bun:ffi$|node:ffi$)/},args=>{appendFileSync(${JSON.stringify(marker)},JSON.stringify({phase:'resolve',specifier:args.path})+'\\n');throw new Error('FORBIDDEN_UI_RESOLUTION');});}});\n`);
  const control=join(copy,'caught-eager-control.js');
  // This deliberately broken startup catches a real emitted UI chunk's import failure,
  // then runs the untouched shipping entry. Its successful output cannot prove isolation.
  await fs.writeFile(control,`await import(${JSON.stringify('./'+uiChunks[0])}).catch(()=>{});\nawait import('./cli.js');\n`);
  for(const snapshot of [workstationSnapshot,alwaysOnNodeSnapshot]){
    const home=join(root,snapshot.profile);await fs.mkdir(home);
    const publicPath=join(home,'public.json');await fs.writeFile(publicPath,JSON.stringify(snapshot),{mode:0o600});
    for(const args of [['--json'],['--snapshot',publicPath,'--json'],['status','--operation',txid,'--json']]){
      let controlView:unknown;
      for(const caughtEager of [true,false]){
        await fs.writeFile(marker,'');
        const child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null','--preload',preload,join(copy,caughtEager?'caught-eager-control.js':'cli.js'),'migrate',...args],{cwd:home,env:{PATH:'/usr/bin:/bin',HOME:home,TMPDIR:home,XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'state'),XDG_DATA_HOME:join(home,'data'),CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),OPENCODE_HOME:join(home,'opencode'),CURSOR_HOME:join(home,'cursor'),PAI_HOME:join(home,'pai'),TEMPERANCE_STATE:join(home,'state'),TEMPERANCE_STATE_DIR:join(home,'state'),LIVE:'0',TEMPERANCE_ALLOW_LIVE_INSPECTION:'0',DO_NOT_TRACK:'1',CI:'1'},stdout:'pipe',stderr:'pipe'});
        const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
        expect(err).toBe('');expect(exit).toBe(args[0]==='status'?1:0);
        const view=JSON.parse(out);expect(validateMigrationView(view)).toBe(true);expect(view.execution_authorized).toBe(false);
        if(args[0]==='--snapshot')expect(view.snapshot).toEqual(snapshot);
        if(args[0]==='status')expect(view.outcome).toBe('held');
        const attempts=(await fs.readFile(marker,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
        if(caughtEager){
          expect(attempts.length).toBeGreaterThan(0);
          for(const attempt of attempts){expect(attempt.phase).toBe('resolve');expect(attempt.specifier).toMatch(/^(?:@opentui(?:\/|$)|bun:ffi$|node:ffi$)/);}
          controlView=view;
        }else{expect(attempts).toEqual([]);expect(view).toEqual(controlView);}
        expect(await fs.readdir(home)).toEqual(['public.json']);
      }
    }
  }
},20000);
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

test('Task6 presentation grammar is explicit and the callback receives one already loaded controller',async()=>{
  expect(parseMigrationArgs(['--tui'])).toEqual({json:false,tui:true,request:null});
  expect(parseMigrationArgs(['--snapshot','public.json','--tui'])).toEqual({json:false,tui:true,request:null,snapshotPath:'public.json'});
  for(const argv of [['--tui','--json'],['--tui','--tui'],['apply','--plan','a','--reviewed-digest',hash,'--tui'],['inspect','--tui']])expect(()=>parseMigrationArgs(argv)).toThrow('ARGUMENT_INVALID');
  const {file}=await publicFile();let calls=0;
  const result=await runMigrationCli(['--snapshot',file,'--tui'],{present:async controller=>{calls++;expect(controller.view().snapshot).toEqual(workstationSnapshot);return controller.dispatch({action:'select-profile',profile:'always-on-node'});}});
  expect(calls).toBe(1);expect(result.view.profile).toBe('always-on-node');expect(result.view.snapshot).toEqual(workstationSnapshot);
});

test('Task6 actual compiled nonTTY fallback is fixed, preserves cancellation and rejects conflicting presentation before native import',async()=>{
  const root=await temporary();
  for(const args of [['--tui'],['--tui','--json'],['apply','--plan','private-plan','--reviewed-digest','sha256:'+'a'.repeat(64),'--tui']]){
    const result=await compiled(args,root),view=JSON.parse(result.out);expect(validateMigrationView(view)).toBe(true);expect(view.execution_authorized).toBe(false);
    if(args.length===1){expect(result.exit).toBe(1);expect(result.err).toBe('NATIVE_TUI_UNAVAILABLE; use migrate --json or migrate status --operation OPERATION --json.\n');expect(view.outcome).toBe('cancelled');}else{expect(result.exit).toBe(64);expect(result.err).toBe('');}
    expect(await fs.readdir(root)).toEqual([]);
  }
});
test('Task6 actual compiled final write tolerates a closed output pipe without raw EPIPE or stack',async()=>{
  const root=await temporary(),child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null',entry,'migrate','--json'],{cwd:root,env:{HOME:root,PATH:'/usr/bin:/bin',TEMPERANCE_ALLOW_LIVE_INSPECTION:'0'},stdout:'pipe',stderr:'pipe'});
  await child.stdout.cancel();const [error,status]=await Promise.all([new Response(child.stderr).text(),child.exited]);expect(error).toBe('');expect(status).toBe(0);expect(await fs.readdir(root)).toEqual([]);
});
for(const uncertain of [false,true])test(`Task6 synthetic CLI entry preserves ${uncertain?'unknown':'completed'} export exit after presentation failure`,async()=>{
  const root=await temporary(),output=join(root,'public-export.json'),script=join(root,'synthetic-cli.ts');
  const argsPath=resolve(import.meta.dir,'../src/migration/cli-args.ts'),tuiPath=resolve(import.meta.dir,'../src/migration/tui.ts'),cliPath=resolve(import.meta.dir,'../src/cli.ts'),exportPath=resolve(import.meta.dir,'../src/migration/export.ts'),fixturePath=resolve(import.meta.dir,'migration-fixtures.ts');
  // Trusted test-host injection only. No production CLI flag or owner adapter is added.
  await fs.writeFile(script,`
import {mock} from 'bun:test';
import {runMigrationCli as originalRun} from ${JSON.stringify(argsPath)};
import {nodeMigrationExportIO} from ${JSON.stringify(exportPath)};
import {workstationSnapshot} from ${JSON.stringify(fixturePath)};
const ports={manifestExport:{io:{...nodeMigrationExportIO,publish:async(a,b)=>{await nodeMigrationExportIO.publish(a,b);${uncertain?"throw new Error('/private/export-canary');":""}}}}};
const trustedRun=originalRun;
mock.module(${JSON.stringify(argsPath)},()=>({runMigrationCli:(argv,options)=>trustedRun(argv,{...options,snapshot:workstationSnapshot,ports})}));
mock.module(${JSON.stringify(tuiPath)},()=>({runMigrationTui:async(controller)=>{await controller.dispatch({action:'export',output:${JSON.stringify(output)},manifest_only:true});throw new Error('/private/renderer-canary');}}));
Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});
process.argv=[process.execPath,${JSON.stringify(cliPath)},'migrate','--tui'];
await import(${JSON.stringify(cliPath)});
`);
  const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),OPENCODE_HOME:join(root,'opencode'),CURSOR_HOME:join(root,'cursor'),AGENTS_HOME:join(root,'agents'),PAI_HOME:join(root,'pai'),TEMPERANCE_STATE:join(root,'state'),TEMPERANCE_STATE_DIR:join(root,'state'),XDG_CONFIG_HOME:join(root,'config'),XDG_STATE_HOME:join(root,'state'),XDG_DATA_HOME:join(root,'data'),LIVE:'0',TEMPERANCE_ALLOW_LIVE_INSPECTION:'0',DO_NOT_TRACK:'1'};
  const child=Bun.spawn([process.execPath,'--no-env-file','--config=/dev/null',script],{cwd:root,env,stdout:'pipe',stderr:'pipe'});
  const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(err).toBe('NATIVE_TUI_UNAVAILABLE; use migrate --json or migrate status --operation OPERATION --json.\n');
  const view=JSON.parse(out);expect(validateMigrationView(view)).toBe(true);expect(view.outcome).toBe(uncertain?'unknown-effect':'completed');expect(view.effect_class).toBe('local-manifest-write');expect(exit).toBe(migrationExitCode(view));expect(exit).toBe(uncertain?2:0);expect(view.execution_authorized).toBe(false);expect(await fs.stat(output).then(s=>s.isFile())).toBe(true);expect(out+err).not.toContain('canary');
});
