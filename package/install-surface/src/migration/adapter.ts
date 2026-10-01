/** Dedicated migration reader. No discovery, enumeration, credential or service effects.
 * Path APIs cannot eliminate ancestor rename/ABA races; use private, quiescent
 * fixture/owner roots. Descriptor identity is checked around every content read.
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { EvidenceDimensions, MigrationSnapshotV1 } from './contracts.ts';

export type ProbeCode = 'ROOT_MISSING' | 'ARTIFACT_MISSING' | 'ARTIFACT_UNREADABLE' | 'ARTIFACT_DENIED' | 'ROOT_DENIED' | 'BYTE_LIMIT' | 'READ_LIMIT' | 'TIME_LIMIT' | 'CANCELLED' | 'ARTIFACT_CHANGED';
export class ProbeFailure extends Error { constructor(readonly code: ProbeCode) { super(code); } }
export interface ProbeLimits { max_file_bytes: number; max_total_bytes: number; max_reads: number; max_elapsed_ms: number }
export const DEFAULT_PROBE_LIMITS: Readonly<ProbeLimits> = Object.freeze({max_file_bytes:262144,max_total_bytes:2097152,max_reads:32,max_elapsed_ms:5000});
export interface ProbeBudget { limits: ProbeLimits; signal?: AbortSignal; check(): void; consumeRead(): void; /** Reserve bytes before content IO; failed reservations consume nothing. */ consumeBytes(count: number): void }
export interface ArtifactDescriptor { organ_id: string; artifact_id: string; root_id: string; relative_path: string }
export interface VersionObservation { id: string; present: 'yes'|'no'|'unknown'; version?: string; supported: 'yes'|'no'|'unknown' }
export interface ServiceMetadata { evidence?: Partial<EvidenceDimensions>; versions?: VersionObservation[] }
export interface KnowledgeSourcePin { ref_id: string; canonical_ref: string; source_digest: `sha256:${string}` }
export interface MigrationProbeAdapter {
 readonly declaration: MigrationSnapshotV1;
 readonly artifacts: readonly Pick<ArtifactDescriptor,'organ_id'|'artifact_id'>[];
 readonly knowledge_sources?: readonly KnowledgeSourcePin[];
 readArtifact(artifactId: string, budget: ProbeBudget): Promise<{value: unknown; digest: `sha256:${string}`} >;
 metadata?(signal?: AbortSignal): Promise<unknown>;
}
export const nodeMigrationReadIO = { lstat: (path: string) => lstat(path), open: (path: string, flags: number) => open(path, flags) };
export type MigrationReadIO = typeof nodeMigrationReadIO;
export function sameFile(a: Stats,b: Stats): boolean {
 return a.dev===b.dev && a.ino===b.ino && a.mode===b.mode && a.nlink===b.nlink && a.size===b.size && a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs;
}
export async function safeAncestors(path: string, stat: (path: string) => Promise<Stats> = lstat): Promise<{path:string; identity:Stats}[]> {
 if (!isAbsolute(path) || resolve(path)!==path || path.includes('\0')) throw new ProbeFailure('ROOT_DENIED');
 const paths=[parse(path).root];
 for (const part of path.slice(parse(path).root.length).split(sep).filter(Boolean)) paths.push(join(paths[paths.length-1],part));
 const result=[];
 for (const p of paths) { const s=await stat(p); if (!s.isDirectory() || s.isSymbolicLink()) throw new ProbeFailure('ROOT_DENIED'); result.push({path:p,identity:s}); }
 return result;
}
export async function unchangedAncestors(entries: {path:string;identity:Stats}[], stat: (path: string) => Promise<Stats> = lstat): Promise<void> {
 for (const e of entries) { const current=await stat(e.path); if (!current.isDirectory() || current.isSymbolicLink() || current.dev!==e.identity.dev || current.ino!==e.identity.ino || current.mode!==e.identity.mode) throw new ProbeFailure('ARTIFACT_CHANGED'); }
}
function failure(error: unknown): ProbeFailure {
 if (error instanceof ProbeFailure) return error;
 return new ProbeFailure((error as {code?:string})?.code==='ENOENT' ? 'ARTIFACT_MISSING' : 'ARTIFACT_UNREADABLE');
}
export function createNodeMigrationAdapter(options: {
 declaration: MigrationSnapshotV1; roots: Readonly<Record<string,string>>; artifacts: readonly ArtifactDescriptor[];
 metadata?: (signal?:AbortSignal)=>Promise<unknown>; knowledge_sources?: readonly KnowledgeSourcePin[]; io?: MigrationReadIO;
}): MigrationProbeAdapter {
 const io=options.io ?? nodeMigrationReadIO;
 const declaration=structuredClone(options.declaration), roots={...options.roots}, descriptors=structuredClone(options.artifacts);
 if (descriptors.length>32 || new Set(descriptors.map(a=>a.artifact_id)).size!==descriptors.length || new Set(descriptors.map(a=>a.organ_id)).size!==descriptors.length) throw new ProbeFailure('ARTIFACT_DENIED');
 return {
  declaration, artifacts:descriptors.map(({organ_id,artifact_id})=>({organ_id,artifact_id})),
  knowledge_sources:structuredClone(options.knowledge_sources ?? []), metadata:options.metadata,
  async readArtifact(id,budget) {
   budget.check(); const d=descriptors.find(a=>a.artifact_id===id);
   if (!d || !Object.hasOwn(roots,d.root_id)) throw new ProbeFailure('ARTIFACT_DENIED');
   const root=roots[d.root_id], rel=d.relative_path;
   if (!isAbsolute(root) || resolve(root)!==root || !rel || isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p=>!p || p==='.' || p==='..') || rel.includes('\0')) throw new ProbeFailure('ARTIFACT_DENIED');
   const path=resolve(root,rel), suffix=relative(root,path);
   if (suffix.startsWith(`..${sep}`) || suffix==='..' || isAbsolute(suffix)) throw new ProbeFailure('ARTIFACT_DENIED');
   let handle: Awaited<ReturnType<typeof open>> | undefined;
   try {
    const ancestors=await safeAncestors(parse(path).dir,io.lstat).catch(e=>{if((e as {code?:string}).code==='ENOENT')throw new ProbeFailure('ROOT_MISSING');throw e;}); budget.check();
    const before=await io.lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink!==1) throw new ProbeFailure('ARTIFACT_DENIED');
    if (before.size>budget.limits.max_file_bytes) throw new ProbeFailure('BYTE_LIMIT');
    // Reserve the complete declared size before open/read. The buffer is exactly
    // this allowance; growth is checked by post-read identity, not an extra byte.
    budget.consumeBytes(before.size);
    budget.consumeRead(); handle=await io.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const opened=await handle.stat(); if (!sameFile(before,opened)) throw new ProbeFailure('ARTIFACT_CHANGED');
    await unchangedAncestors(ancestors,io.lstat); budget.check();
    const bytes=Buffer.alloc(before.size);
    let count=0;
    while(count<bytes.length) { budget.check(); const read=await handle.read(bytes,count,bytes.length-count,count); if (!read.bytesRead) break; count+=read.bytesRead; }
    budget.check();
    if(count!==before.size || count>budget.limits.max_file_bytes) throw new ProbeFailure('ARTIFACT_CHANGED');
    if(!sameFile(before,await handle.stat()) || !sameFile(before,await io.lstat(path))) throw new ProbeFailure('ARTIFACT_CHANGED');
    await unchangedAncestors(ancestors,io.lstat); budget.check();
    const data=bytes.subarray(0,count);
    return {value:JSON.parse(data.toString('utf8')),digest:`sha256:${createHash('sha256').update(data).digest('hex')}`};
   } catch(e) { throw failure(e); } finally { await handle?.close().catch(()=>{}); }
  },
 };
}
