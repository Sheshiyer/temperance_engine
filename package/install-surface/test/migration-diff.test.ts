import { expect, test } from 'bun:test';
import { diff } from '../src/migration/diff.ts';
import { assessMigrationCompatibility, validateMigrationSnapshot } from '../src/migration/contracts.ts';
import { workstationSnapshot, workstationTarget, fakeDigest } from './migration-fixtures.ts';

test('pure deterministic diff reports actual substitutions and unresolved states',()=>{
 const source=structuredClone(workstationSnapshot); const target=structuredClone(source);
 target.source_release_digest=fakeDigest('changed'); target.module_lock_digest=fakeDigest('lock'); target.logical_module_refs=[];
 target.organs.operating[0].version='2.0.0'; target.evidence.auth='no'; target.knowledge_refs[0].source_digest=fakeDigest('source');
 const before=JSON.stringify([source,target]); const result=diff(source,target);
 expect(result.findings.map(f=>f.code)).toEqual(expect.arrayContaining(['SOURCE_RELEASE_CHANGED','MODULE_LOCK_CHANGED','MODULE_REMOVED','ORGAN_CHANGED','KNOWLEDGE_CHANGED','AUTHENTICATION_PENDING']));
 expect(result).toEqual(diff(source,target)); expect(JSON.stringify([source,target])).toBe(before); expect(result.execution_authorized).toBe(false);
 expect(diff(source,workstationTarget).findings.some(f=>f.code==='TARGET_CHECK_ONLY')).toBe(true);
 expect(diff({...source,extra:true},target).findings[0].code).toBe('INVALID_SOURCE');
});

test('disabled modes and Adytum are observational holds and evidence arrays compare by identities',()=>{
 const {capability_hit_modes}=require('./migration-fixtures.ts').integratedMacSnapshot;
 const a={...structuredClone(workstationSnapshot),capability_hit_modes};const b=structuredClone(a);b.organs.operating.reverse();
 const result=diff(a,b);
 expect(result.findings.filter(f=>f.code==='CAPABILITY_HIT_DISABLED')).toHaveLength(4);
 expect(result.findings.some(f=>f.code==='ADYTUM_SOURCE_PARITY_HELD')).toBe(true);
 expect(result.findings.some(f=>f.code==='ORGAN_CHANGED')).toBe(false);
 expect(diff(a,{...workstationTarget,unexpected:'private'}).findings[0].code).toBe('INVALID_TARGET');
});

test('target declarations retain unknown destination evidence even with a compatible source',()=>{
 const {makeInputChainSnapshot,makeInputChainExpectedContext}=require('./migration-fixtures.ts');
 const source=makeInputChainSnapshot(),expected=makeInputChainExpectedContext();
 expect(assessMigrationCompatibility(source,expected).status).toBe('compatible');
 for(const missing of [false,true]) {
  const target=structuredClone(workstationTarget);if(missing)target.requested_modules.push('module:missing');
  const result=diff(source,target,expected);
  expect(result.assessment?.status).toBe('nonauthoritative');
  expect(result.assessment?.holds).toContain('DESTINATION_OBSERVATION_UNKNOWN');
  expect(result.findings.some(f=>f.code==='DESTINATION_OBSERVATION_UNKNOWN')).toBe(true);
  expect(result.assessment?.holds.some(h=>h==='MODULE_REQUIRED:module:missing')).toBe(missing);
  expect(result.execution_authorized).toBe(false);
 }
});

test('knowledge and toolchain identity ambiguity is deterministic for either side and order',()=>{
 for(const side of ['source','target'] as const)for(const kind of ['knowledge','toolchain'] as const) {
  const results=[];
  for(const prepend of [true,false]) {
   const source=structuredClone(workstationSnapshot),target=structuredClone(source),edited=side==='source'?source:target;
   if(kind==='knowledge') {
    const duplicate={...edited.knowledge_refs[0],source_digest:fakeDigest('changed-source')};
    if(prepend)edited.knowledge_refs.unshift(duplicate);else edited.knowledge_refs.push(duplicate);
   } else {
    const duplicate={...edited.toolchain_requirements[0],version_constraint:'=99.0.0'};
    if(prepend)edited.toolchain_requirements.unshift(duplicate);else edited.toolchain_requirements.push(duplicate);
   }
   expect(validateMigrationSnapshot(edited).ok).toBe(true);
   const result=diff(source,target);
   expect(result.assessment?.holds.some(h=>h.startsWith(`${kind.toUpperCase()}_IDENTITY_AMBIGUOUS:`))).toBe(true);
   expect(result.findings.some(f=>f.code===`${kind.toUpperCase()}_CHANGED`)).toBe(true);
   expect(result.findings.some(f=>f.code===`${kind.toUpperCase()}_IDENTITY_AMBIGUOUS`)).toBe(true);
   results.push(result);
  }
  expect(results[0]).toEqual(results[1]);
 }
});
