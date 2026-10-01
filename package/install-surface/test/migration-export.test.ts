import { expect, test } from 'bun:test';
import { realpath, mkdtemp, readFile, rm, writeFile, stat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportManifest, canonicalManifestBytes, nodeMigrationExportIO } from '../src/migration/export.ts';
import { workstationSnapshot } from './migration-fixtures.ts';

test('private canonical no-overwrite export and fresh process byte roundtrip', async () => {
 const root=await realpath(await mkdtemp(join(tmpdir(),'migration-export-'))); const destination=join(root,'snapshot.json');
 try {
  const result=await exportManifest(workstationSnapshot,destination);
  expect(result.ok).toBe(true); expect((await stat(destination)).mode&0o777).toBe(0o600);
  expect(await readFile(destination,'utf8')).toBe(canonicalManifestBytes(workstationSnapshot));
  const child=Bun.spawn([process.execPath,'--no-env-file','-e',`const b=await Bun.file(process.argv[1]).text(); console.log(new Bun.CryptoHasher('sha256').update(b).digest('hex'));`,destination],{env:{},stdout:'pipe'});
  expect((await new Response(child.stdout).text()).trim()).toBe(result.digest!.slice(7)); expect(await child.exited).toBe(0);
  expect((await exportManifest(workstationSnapshot,destination)).ok).toBe(false);
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('competing writer is never overwritten or removed and staging is cleaned', async () => {
 const root=await realpath(await mkdtemp(join(tmpdir(),'migration-export-'))); const destination=join(root,'snapshot.json');
 try {
  const io={...nodeMigrationExportIO, publish:async(from:string,to:string)=>{await writeFile(to,'competitor',{flag:'wx'}); await nodeMigrationExportIO.publish(from,to);}};
  expect((await exportManifest(workstationSnapshot,destination,io)).ok).toBe(false);
  expect(await readFile(destination,'utf8')).toBe('competitor'); expect(await readdir(root)).toEqual(['snapshot.json']);
  await symlink(destination,join(root,'unsafe'));
  expect((await exportManifest(workstationSnapshot,join(root,'unsafe'))).ok).toBe(false);
  const invalid={...workstationSnapshot,private_path:root};
  expect((await exportManifest(invalid,destination)).ok).toBe(false);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test('unsafe parents, hardlink destinations, publication failure and replaced staging never touch user files',async()=>{
 const {mkdir,link,rename,chmod}=await import('node:fs/promises');
 const root=await realpath(await mkdtemp(join(tmpdir(),'migration-export-')));
 try {
  const owner=join(root,'owner');await mkdir(owner,{mode:0o700});await symlink(owner,join(root,'alias'));
  expect((await exportManifest(workstationSnapshot,join(root,'alias','new.json'))).ok).toBe(false);
  await writeFile(join(owner,'user'),'owned');await link(join(owner,'user'),join(owner,'linked'));
  expect((await exportManifest(workstationSnapshot,join(owner,'linked'))).ok).toBe(false);expect(await readFile(join(owner,'user'),'utf8')).toBe('owned');
  await chmod(owner,0o777);expect((await exportManifest(workstationSnapshot,join(owner,'unsafe.json'))).ok).toBe(false);await chmod(owner,0o700);
  const failed=await exportManifest(workstationSnapshot,join(owner,'failed.json'),{...nodeMigrationExportIO,publish:async()=>{throw new Error(root);}});
  expect(failed.ok).toBe(false);expect(JSON.stringify(failed)).not.toContain(root);expect((await readdir(owner)).sort()).toEqual(['linked','user']);
  let replaced='';
  const replacement=await exportManifest(workstationSnapshot,join(owner,'replaced.json'),{...nodeMigrationExportIO,publish:async(from)=>{replaced=from;await rename(from,join(owner,'detached-original'));await writeFile(from,'new-user-file',{flag:'wx'});throw new Error('injected');}});
  expect(replacement.ok).toBe(false);expect(await readFile(replaced,'utf8')).toBe('new-user-file');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('same-size staging content drift during publication cannot yield an original digest receipt',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'migration-export-')));const destination=join(root,'snapshot.json');
 try {
  const io={...nodeMigrationExportIO,publish:async(from:string,to:string)=>{const bytes=await readFile(from);bytes[0]=32;await writeFile(from,bytes);await nodeMigrationExportIO.publish(from,to);}};
  const result=await exportManifest(workstationSnapshot,destination,io);
  expect(result.ok).toBe(false);expect(result.digest).toBeUndefined();expect((await readFile(destination))[0]).toBe(32);
 }finally{await rm(root,{recursive:true,force:true});}
});
