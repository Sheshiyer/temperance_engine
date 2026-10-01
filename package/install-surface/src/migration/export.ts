/** Explicit private export with atomic no-replace publication.
 * lstat/open/path operations do not provide openat-style ancestor ABA safety.
 * Callers must provide a stable owner-controlled directory; no destination
 * replacement or deletion is attempted, including after publication failure.
 */
import { constants } from 'node:fs';
import { lstat, open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, dirname, resolve, join, basename } from 'node:path';
import { validateMigrationSnapshot, MAX_MIGRATION_SNAPSHOT_BYTES, type MigrationSnapshotV1 } from './contracts.ts';
import { safeAncestors, unchangedAncestors, sameFile } from './adapter.ts';
export function canonicalManifestBytes(snapshot:unknown):string {
 if(!validateMigrationSnapshot(snapshot).ok)throw new Error('INVALID_SNAPSHOT');
 function canonical(v:unknown):unknown {if(Array.isArray(v))return v.map(canonical);if(v!==null&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])]));return v;}
 return JSON.stringify(canonical(snapshot))+'\n';
}
export const nodeMigrationExportIO={lstat:(path:string)=>lstat(path),open:(path:string,flags:number,mode:number)=>open(path,flags,mode),publish:(from:string,to:string)=>link(from,to),unlink:(path:string)=>unlink(path)};
export type MigrationExportIO=typeof nodeMigrationExportIO;
export interface ExportResult {ok:boolean;code:'EXPORTED'|'INVALID_SNAPSHOT'|'DESTINATION_DENIED'|'EXPORT_FAILED';digest?:`sha256:${string}`;bytes?:number;execution_authorized:false}
/** IO injection is an explicit trusted test seam, not an ambient capability. */
export async function exportManifest(snapshot:unknown,destination:string,io:MigrationExportIO=nodeMigrationExportIO):Promise<ExportResult> {
 const fail=(code:ExportResult['code']):ExportResult=>({ok:false,code,execution_authorized:false});
 if(!validateMigrationSnapshot(snapshot).ok)return fail('INVALID_SNAPSHOT');
 const data=Buffer.from(canonicalManifestBytes(snapshot as MigrationSnapshotV1));
 if(data.length>MAX_MIGRATION_SNAPSHOT_BYTES)return fail('INVALID_SNAPSHOT');
 if(typeof destination!=='string'||!isAbsolute(destination)||resolve(destination)!==destination||destination.includes('\0')||basename(destination)==='.')return fail('DESTINATION_DENIED');
 let handle:Awaited<ReturnType<typeof open>>|undefined;let staging:string|undefined;let identity:Awaited<ReturnType<typeof lstat>>|undefined;
 const start=performance.now();const check=()=>{if(performance.now()-start>5000)throw new Error('EXPORT_TIMEOUT');};
 try {
  const ancestors=await safeAncestors(dirname(destination),io.lstat);check();
  const parent=ancestors[ancestors.length-1].identity;
  if((parent.mode&0o022)!==0) return fail('DESTINATION_DENIED');
  try {await io.lstat(destination);return fail('DESTINATION_DENIED');} catch(e) {if((e as {code?:string}).code!=='ENOENT')throw e;}
  staging=join(dirname(destination),`.migration-${randomUUID()}.tmp`);
  handle=await io.open(staging,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  identity=await handle.stat();
  if(!identity.isFile()||identity.nlink!==1||(identity.mode&0o777)!==0o600)throw new Error('UNSAFE_STAGING');
  await handle.writeFile(data);await handle.sync();check();
  const written=await handle.stat();
  if(written.dev!==identity.dev||written.ino!==identity.ino||written.nlink!==1||(written.mode&0o777)!==0o600||written.size!==data.length)throw new Error('STAGING_CHANGED');
  const readback=Buffer.alloc(data.length+1);let count=0;
  while(count<readback.length){check();const r=await handle.read(readback,count,readback.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
  if(count!==data.length||!readback.subarray(0,count).equals(data)||!sameFile(written,await handle.stat())||!sameFile(written,await io.lstat(staging)))throw new Error('STAGING_CHANGED');
  await unchangedAncestors(ancestors,io.lstat);check();
  // link(2) fails EEXIST atomically; an exists-check then rename can overwrite.
  await io.publish(staging,destination);
  const published=await io.lstat(destination),after=await handle.stat();
  if(!published.isFile()||published.isSymbolicLink()||published.dev!==written.dev||published.ino!==written.ino||published.nlink!==2||(published.mode&0o777)!==0o600||published.size!==data.length||published.mtimeMs!==written.mtimeMs||!sameFile(published,after))throw new Error('PUBLICATION_CHANGED');
  await unchangedAncestors(ancestors,io.lstat);check();
  const publishedBytes=Buffer.alloc(data.length+1);let publishedCount=0;
  while(publishedCount<publishedBytes.length){check();const r=await handle.read(publishedBytes,publishedCount,publishedBytes.length-publishedCount,publishedCount);if(!r.bytesRead)break;publishedCount+=r.bytesRead;}
  if(publishedCount!==data.length||!publishedBytes.subarray(0,publishedCount).equals(data)||!sameFile(after,await handle.stat()))throw new Error('PUBLICATION_CHANGED');
  // Only unlink our exact private staging inode. Never unlink destination.
  if(!sameFile(after,await io.lstat(staging)))throw new Error('STAGING_CHANGED');
  await io.unlink(staging);staging=undefined;
  const final=await io.lstat(destination);
  if(final.dev!==written.dev||final.ino!==written.ino||final.nlink!==1||final.size!==data.length||final.mtimeMs!==written.mtimeMs||(final.mode&0o777)!==0o600)throw new Error('PUBLICATION_CHANGED');
  return {ok:true,code:'EXPORTED',digest:`sha256:${createHash('sha256').update(data).digest('hex')}`,bytes:data.length,execution_authorized:false};
 } catch {return fail('EXPORT_FAILED');}
 finally {
  if(staging&&identity)try {const current=await io.lstat(staging);if(current.isFile()&&!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino)await io.unlink(staging);}catch{/* Retain an unidentifiable path for owner recovery. */}
  await handle?.close().catch(()=>{});
 }
}
