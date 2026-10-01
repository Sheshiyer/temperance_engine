import { describe, expect, test } from 'bun:test';
import { realpath, mkdtemp, writeFile, rm, symlink, link, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeMigrationAdapter, nodeMigrationReadIO } from '../src/migration/adapter.ts';
import { inspect } from '../src/migration/inspect.ts';
import { makeInputChainSnapshot, makeInputChainExpectedContext } from './migration-fixtures.ts';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'migration-inspect-')));
  try { await run(root); } finally { await rm(root, {recursive:true, force:true}); }
}
function declaration() { return makeInputChainSnapshot(); }

describe('bounded migration inspector', () => {
  test('independent producer/input/work/consumer/verdict chain and Hermes observation', async () => fixture(async root => {
    const source = declaration();
    const artifacts = source.organs.operating.map(o => ({organ_id:o.organ_id, root_id:'fixture', artifact_id:`organ:${o.organ_id}`, relative_path:`${o.organ_id}.json`}));
    for (const o of source.organs.operating) await writeFile(join(root, `${o.organ_id}.json`), JSON.stringify(o));
    const adapter = createNodeMigrationAdapter({declaration:source, roots:{fixture:root}, artifacts});
    const result = await inspect(adapter, {expected_context:makeInputChainExpectedContext()});
    expect(result.snapshot?.organs.operating).toEqual(source.organs.operating);
    expect(result.assessment?.status).toBe('compatible');
    expect(result.execution_authorized).toBe(false);
    expect(result.snapshot?.organs.cognitive).toHaveLength(6);
    expect(result.snapshot?.will_role_desks).toHaveLength(6);
    expect(result.snapshot?.evidence.auth).toBe('unknown');
    const hermes = {...source.organs.operating[0], plant:'hermes'};
    await writeFile(join(root, 'genesis.json'), JSON.stringify(hermes));
    const changed = await inspect(adapter, {expected_context:makeInputChainExpectedContext()});
    expect(changed.snapshot?.organs.operating[0].plant).toBe('hermes');
    expect(changed.assessment?.status).toBe('held');
  }));
  test('denies traversal, sibling escape, symlink ancestors/leaves, hardlinks and directories before content read', async () => fixture(async root => {
    await writeFile(join(root,'good.json'), '{}'); await mkdir(join(root,'dir'));
    await symlink(join(root,'good.json'), join(root,'leaf')); await symlink(join(root,'dir'), join(root,'ancestor'));
    await link(join(root,'good.json'), join(root,'hard'));
    for (const relative_path of ['../outside', '../migration-sibling/file', 'leaf', 'ancestor/file', 'hard', 'dir']) {
      let reads = 0;
      const io = {...nodeMigrationReadIO, open: async (...args: Parameters<typeof nodeMigrationReadIO.open>) => { reads++; return nodeMigrationReadIO.open(...args); }};
      const adapter = createNodeMigrationAdapter({declaration:declaration(), roots:{fixture:root}, artifacts:[{organ_id:'genesis', root_id:'fixture', artifact_id:'organ:genesis', relative_path}], io});
      const result = await inspect(adapter);
      expect(reads).toBe(0); expect(result.findings.some(f=>f.code.includes('DENIED'))).toBe(true);
      expect(JSON.stringify(result)).not.toContain(root);
    }
  }));
  test('missing, malformed, byte limit, cancellation and metadata errors stay safe', async () => fixture(async root => {
    const source = declaration();
    let calls = 0;
    const adapter = createNodeMigrationAdapter({declaration:source, roots:{fixture:root}, artifacts:[{organ_id:'genesis',root_id:'fixture',artifact_id:'organ:genesis',relative_path:'missing'}], metadata:async()=>{calls++; throw new Error(root);}});
    const missing = await inspect(adapter);
    expect(missing.findings.some(f=>f.code==='ARTIFACT_MISSING')).toBe(true);
    expect(missing.snapshot?.organs.operating[0].freshness).toBe('unknown');
    expect(JSON.stringify(missing)).not.toContain(root);
    const abort = new AbortController(); abort.abort();
    await inspect(adapter, {signal:abort.signal}); expect(calls).toBe(1);
    await writeFile(join(root,'missing'), 'x'.repeat(100));
    expect((await inspect(adapter,{limits:{max_file_bytes:20}})).findings.some(f=>f.code==='BYTE_LIMIT')).toBe(true);
    await writeFile(join(root,'missing'), '{}');
    expect((await inspect(adapter)).findings.some(f=>f.code==='INVALID_ORGAN_OBSERVATION')).toBe(true);
  }));
});

test('metadata is closed, versions never imply auth/runtime, and errors contain no private values', async () => fixture(async root=> {
 const base={declaration:declaration(),roots:{fixture:root},artifacts:[]};
 for(const metadata of [{versions:[{id:'node',present:'yes',version:'99.0.0',supported:'no'}]}, {versions:[{id:'node',present:'no',supported:'unknown'}]}]) {
  const result=await inspect(createNodeMigrationAdapter({...base,metadata:async()=>metadata}));
  expect(result.findings.some(f=>['UNSUPPORTED_NATIVE_VERSION','NATIVE_BINARY_MISSING'].includes(f.code))).toBe(true);
  expect(result.snapshot?.evidence.auth).toBe('unknown');expect(result.snapshot?.evidence.runtime).toBe('unknown');
 }
 const bad=await inspect(createNodeMigrationAdapter({...base,metadata:async()=>({evidence:{auth:'yes',private:root}})}));
 expect(bad.findings.some(f=>f.code==='INVALID_SERVICE_METADATA')).toBe(true);expect(JSON.stringify(bad)).not.toContain(root);
}));

test('unknown IDs and missing root are denied without file opening or effects',async()=>fixture(async root=>{
 let opens=0,stats=0; const effects:string[]=[];
 const io={...nodeMigrationReadIO,lstat:async(...a:Parameters<typeof nodeMigrationReadIO.lstat>)=>{stats++;return nodeMigrationReadIO.lstat(...a);},open:async(...a:Parameters<typeof nodeMigrationReadIO.open>)=>{opens++;return nodeMigrationReadIO.open(...a);}};
 const adapter=createNodeMigrationAdapter({declaration:declaration(),roots:{fixture:join(root,'absent-volume')},artifacts:[{organ_id:'genesis',root_id:'fixture',artifact_id:'organ:genesis',relative_path:'data'}],io});
 await expect(adapter.readArtifact('unapproved',{limits:{max_file_bytes:20,max_reads:1,max_total_bytes:20,max_elapsed_ms:100},check(){},consumeRead(){},consumeBytes(){}})).rejects.toThrow('ARTIFACT_DENIED');
 expect(stats).toBe(0);expect(opens).toBe(0);
 const result=await inspect(adapter);expect(result.findings.some(f=>f.code==='ROOT_MISSING')).toBe(true);expect(opens).toBe(0);expect(effects).toEqual([]);
}));

test('mode and inode replacement are rejected before descriptor content reads',async()=>fixture(async root=>{
 const {chmod,rename}=await import('node:fs/promises');
 for(const replacement of ['mode','inode']) {
  const file=join(root,`${replacement}.json`);await writeFile(file,JSON.stringify(declaration().organs.operating[0]),{mode:0o600});let contentReads=0;
  const io={...nodeMigrationReadIO,open:async(...args:Parameters<typeof nodeMigrationReadIO.open>)=>{
   if(replacement==='mode')await chmod(file,0o644);else {await rename(file,file+'.old');await writeFile(file,'{}',{mode:0o600});}
   const handle=await nodeMigrationReadIO.open(...args);const read=handle.read.bind(handle);
   handle.read=((...a:Parameters<typeof handle.read>)=>{contentReads++;return read(...a);}) as typeof handle.read;
   return handle;
  }};
  const result=await inspect(createNodeMigrationAdapter({declaration:declaration(),roots:{fixture:root},artifacts:[{organ_id:'genesis',root_id:'fixture',artifact_id:'organ:genesis',relative_path:`${replacement}.json`}],io}));
  expect(result.findings.some(f=>f.code==='ARTIFACT_CHANGED')).toBe(true);expect(contentReads).toBe(0);
 }
}));

test('count, byte, elapsed and abort limits apply to injected readers',async()=>{
 const source=declaration();let calls=0;
 const adapter={declaration:source,artifacts:source.organs.operating.map(o=>({organ_id:o.organ_id,artifact_id:`organ:${o.organ_id}`})),async readArtifact(id:string){calls++;return {value:source.organs.operating.find(o=>`organ:${o.organ_id}`===id),digest:'sha256:'+'0'.repeat(64) as `sha256:${string}`};}};
 const count=await inspect(adapter,{limits:{max_reads:1}});expect(calls).toBe(1);expect(count.findings.some(f=>f.code==='READ_LIMIT')).toBe(true);
 const slow={...adapter,readArtifact:async()=>new Promise<never>(()=>{})};
 const timed=await inspect(slow,{limits:{max_elapsed_ms:10}});expect(timed.findings.some(f=>f.code==='TIME_LIMIT')).toBe(true);
 const controller=new AbortController();const pending=inspect(slow,{signal:controller.signal});controller.abort();expect((await pending).findings.some(f=>f.code==='CANCELLED')).toBe(true);
});

test('canonical and PDF derivation pins detect source drift and unresolved links',async()=>{
 const source=declaration();const derived=source.knowledge_refs.find(k=>k.kind==='derived')!;
 const result=await inspect(createNodeMigrationAdapter({declaration:source,roots:{},artifacts:[],knowledge_sources:[{ref_id:derived.ref_id,canonical_ref:source.knowledge_refs[0].ref_id,source_digest:`sha256:${'f'.repeat(64)}`},{ref_id:derived.ref_id,canonical_ref:'knowledge:unresolved',source_digest:`sha256:${'a'.repeat(64)}`}]}));
 expect(result.findings.map(f=>f.code)).toEqual(expect.arrayContaining(['KNOWLEDGE_SOURCE_DRIFT','KNOWLEDGE_LINK_UNRESOLVED','KNOWLEDGE_STALE']));expect(result.execution_authorized).toBe(false);
});

test('owner scope mismatch, stale evidence, and unknown verdict stay distinct without forbidden calls',async()=>{
 const source=declaration(), context=makeInputChainExpectedContext();
 const effects={writes:0,network:0,auth:0,reads:0};
 const adapter={declaration:source,artifacts:source.organs.operating.map(o=>({organ_id:o.organ_id,artifact_id:`organ:${o.organ_id}`})),
  async readArtifact(id:string){effects.reads++;return {value:structuredClone(source.organs.operating.find(o=>`organ:${o.organ_id}`===id)),digest:`sha256:${'a'.repeat(64)}` as const};},
  write(){effects.writes++;},network(){effects.network++;},auth(){effects.auth++;},
 };
 source.organs.operating[0].scope='different-scope';
 const mismatch=await inspect(adapter,{expected_context:context});expect(mismatch.assessment?.status).toBe('held');
 source.organs.operating[0].scope='workstation';source.organs.operating[0].freshness='stale';
 const stale=await inspect(adapter,{expected_context:context});expect(stale.findings.some(f=>f.code==='EVIDENCE_STALE'&&f.subject==='genesis')).toBe(true);
 source.organs.operating[0].freshness='unknown';source.organs.operating[0].independent_verdict='unknown';delete source.organs.operating[0].verdict_attestation;
 const unknown=await inspect(adapter,{expected_context:context});expect(unknown.findings.some(f=>f.code==='FRESHNESS_UNKNOWN'&&f.subject==='genesis')).toBe(true);expect(unknown.assessment?.status).toBe('held');
 expect(effects).toEqual({writes:0,network:0,auth:0,reads:15});
});

test('total byte budget holds even if an injected adapter omits budget accounting',async()=>{
 const source=declaration();const first=Buffer.byteLength(JSON.stringify(source.organs.operating[0]));
 const result=await inspect({declaration:source,artifacts:source.organs.operating.map(o=>({organ_id:o.organ_id,artifact_id:`organ:${o.organ_id}`})),async readArtifact(id){return {value:source.organs.operating.find(o=>`organ:${o.organ_id}`===id),digest:`sha256:${'a'.repeat(64)}`};}},{limits:{max_total_bytes:first+1}});
 expect(result.snapshot?.organs.operating[0].independent_verdict).toBe('passed');expect(result.snapshot?.organs.operating[1].independent_verdict).toBe('unknown');expect(result.findings.some(f=>f.code==='BYTE_LIMIT')).toBe(true);
});

test('private extra fields in valid JSON are excluded from the observed snapshot',async()=>fixture(async root=>{
 const privatePath=['','Users','fixture-private','native-store'].join('/');
 const value={...declaration().organs.operating[0],native_session_id:'do-not-export',private_path:privatePath};
 await writeFile(join(root,'owner.json'),JSON.stringify(value));
 const result=await inspect(createNodeMigrationAdapter({declaration:declaration(),roots:{fixture:root},artifacts:[{organ_id:'genesis',root_id:'fixture',artifact_id:'organ:genesis',relative_path:'owner.json'}]}));
 expect(result.findings.some(f=>f.code==='INVALID_ORGAN_OBSERVATION')).toBe(true);expect(JSON.stringify(result)).not.toContain('do-not-export');expect(JSON.stringify(result)).not.toContain(privatePath);
}));

test('Node byte reservations bound actual IO before the first read and across files without an EOF sentinel',async()=>fixture(async root=>{
 const source=declaration(); const organs=source.organs.operating.slice(0,2);
 const sizes=await Promise.all(organs.map(async o=>{const data=JSON.stringify(o);await writeFile(join(root,`${o.organ_id}.json`),data);return Buffer.byteLength(data);}));
 let returnedBytes=0,requestedBytes=0,opens=0;
 const io={...nodeMigrationReadIO,open:async(...args:Parameters<typeof nodeMigrationReadIO.open>)=>{
  opens++; const handle=await nodeMigrationReadIO.open(...args);const read=handle.read.bind(handle);
  handle.read=(async(buffer:Buffer,offset:number,length:number,position:number)=>{requestedBytes+=length;const result=await read(buffer,offset,length,position);returnedBytes+=result.bytesRead;return result;}) as typeof handle.read;
  return handle;
 }};
 const adapter=createNodeMigrationAdapter({declaration:source,roots:{fixture:root},artifacts:organs.map(o=>({organ_id:o.organ_id,root_id:'fixture',artifact_id:`organ:${o.organ_id}`,relative_path:`${o.organ_id}.json`})),io});
 const tiny=await inspect(adapter,{limits:{max_total_bytes:1}});
 expect(tiny.findings.some(f=>f.code==='BYTE_LIMIT')).toBe(true);
 expect({returnedBytes,requestedBytes,opens}).toEqual({returnedBytes:0,requestedBytes:0,opens:0});
 const cumulative=await inspect(adapter,{limits:{max_total_bytes:sizes[0]+sizes[1]-1}});
 expect(cumulative.snapshot?.organs.operating[0].independent_verdict).toBe('passed');
 expect(cumulative.snapshot?.organs.operating[1].independent_verdict).toBe('unknown');
 expect(cumulative.findings.some(f=>f.code==='BYTE_LIMIT'&&f.subject===organs[1].organ_id)).toBe(true);
 expect({returnedBytes,requestedBytes,opens}).toEqual({returnedBytes:sizes[0],requestedBytes:sizes[0],opens:1});
 returnedBytes=0;requestedBytes=0;opens=0;
 const exact=await inspect(adapter,{limits:{max_total_bytes:sizes[0]+sizes[1]}});
 expect(exact.snapshot?.organs.operating[1].independent_verdict).toBe('passed');
 expect({returnedBytes,requestedBytes,opens}).toEqual({returnedBytes:sizes[0]+sizes[1],requestedBytes:sizes[0]+sizes[1],opens:2});
}));

test('growth during a reserved read remains drift without reading past the allowance',async()=>fixture(async root=>{
 const {appendFile}=await import('node:fs/promises');const source=declaration();const file=join(root,'owner.json');
 const data=JSON.stringify(source.organs.operating[0]),size=Buffer.byteLength(data);await writeFile(file,data);let returnedBytes=0;
 const io={...nodeMigrationReadIO,open:async(...args:Parameters<typeof nodeMigrationReadIO.open>)=>{
  const handle=await nodeMigrationReadIO.open(...args),read=handle.read.bind(handle);
  handle.read=(async(...a:Parameters<typeof handle.read>)=>{const r=await read(...a);returnedBytes+=r.bytesRead;await appendFile(file,' ');return r;}) as typeof handle.read;
  return handle;
 }};
 const result=await inspect(createNodeMigrationAdapter({declaration:source,roots:{fixture:root},artifacts:[{organ_id:'genesis',root_id:'fixture',artifact_id:'organ:genesis',relative_path:'owner.json'}],io}),{limits:{max_total_bytes:size}});
 expect(result.findings.some(f=>f.code==='ARTIFACT_CHANGED')).toBe(true);
 expect(result.snapshot?.organs.operating[0].independent_verdict).toBe('unknown');expect(returnedBytes).toBe(size);
}));
