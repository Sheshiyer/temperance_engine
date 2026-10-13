import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normalizeRuntimeDependencies } from "../src/runtime-dependencies.ts";
import { validateFragment, validateLock } from "../src/schema.ts";
import { checkDependencies } from "../src/lifecycle/hazards.ts";
import type { SurfaceRecord } from "../src/types.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";

const base = JSON.parse(readFileSync(new URL("fixtures/schema/valid-fragment.v1.json", import.meta.url), "utf8"));
test("both schemas align closed bounded dependency union", () => {
  const valid = [undefined, [], [{kind:"binary",name:"python3.14"}], [{kind:"http-health",url_token:"BRIDGE_URL"}]];
  const invalid = [null, [{kind:"binary",name:"--help"}], [{kind:"binary",name:"/bin/sh"}], [{kind:"binary",name:"x;echo"}], [{kind:"binary",name:"é"}], [{kind:"binary",name:"x\n"}], [{kind:"http-health",url_token:"URL\n"}], [{kind:"binary",name:"x",extra:true}], [{kind:"binary",name:"x",url_token:"URL"}], [{kind:"http-health",url_token:"https://private"}], [{kind:"unknown",name:"x"}], Array(33).fill({kind:"binary",name:"x"}), [{kind:"binary",name:"x"},{kind:"binary",name:"x"}]];
  for (const [values,accepted] of [[valid,true],[invalid,false]] as const) for (const requires of values) {
    const fragment=structuredClone(base); if(requires !== undefined) fragment.records[0].requires=requires;
    const lock={...fragment,schema:"temperance.install-surface.lock.v1",schema_uri:"https://thoughtseed.space/schemas/temperance/install-surface/lock/v1"};
    expect(validateFragment(fragment)).toBe(accepted); expect(validateLock(lock)).toBe(accepted);
    if(accepted) expect(()=>normalizeRuntimeDependencies(requires)).not.toThrow();
    else expect(()=>normalizeRuntimeDependencies(requires)).toThrow("DEPENDENCY_DECLARATION_INVALID");
  }
});
test("direct typed bypass rejects proxies/accessors/sparse arrays without getters", () => {
  let calls=0; const proxy=new Proxy({}, {ownKeys(){calls++;return [];}});
  const getter={kind:"binary",get name(){calls++;return "bun";}};
  for(const value of [[proxy],[getter],new Array(1)]) expect(()=>normalizeRuntimeDependencies(value)).toThrow();
  expect(calls).toBe(0);
});
test("all declarations validated before first binary or HTTP probe", async () => {
  let calls=0; const io={execFile:async()=>{calls++;return {exitCode:0,stdout:"",stderr:""};},fetch:async()=>{calls++;return new Response();}} as unknown as LifecycleIO;
  const record=(requires:unknown)=>({...base.records[0],requires}) as SurfaceRecord;
  const signal=new AbortController().signal;
  await expect(checkDependencies([record([{kind:"binary",name:"bun"}]),record([{kind:"http-health",url_token:"URL"}])],()=>{calls++;return "private";},io,signal)).rejects.toThrow("DEPENDENCY_HTTP_UNSUPPORTED");
  await expect(checkDependencies([record([{kind:"binary",name:"bun"}]),record([{kind:"binary",name:"-x"}])],()=>"",io,signal)).rejects.toThrow("DEPENDENCY_DECLARATION_INVALID");
  expect(calls).toBe(0);
});
