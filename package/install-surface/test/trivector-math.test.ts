import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIT_EQUIVALENCE_TOLERANCE, TRIVECTOR_V41_POLICY, finiteSignal, fitBucket, resolveArbitrationMode, effectiveHeadroom, decayedHazard, hazardAdjustedHeadroom, headGateReasons, wilsonUpperBound, g9GateV41, arbitrateFitBucket } from "../src/routing/trivector-math.ts";

test("numerical policy preserved frozen and explicit arbitration", () => {
 expect(TRIVECTOR_V41_POLICY).toEqual({schema:"temperance.trivector-arbitration-policy.v1",version:"trivector-v4.1.0",arbitration_default:"legacy",hazard_k:0.5,hazard_half_life_ms:1800000,hazard_max_events:32,headroom_saturation_units:100,neutral_headroom:0.5,per_seat_concurrency_cap:4,g9_min_evidence_mass:20,g9_upper_bound_floor:0.2,g9_consecutive_failures_min:5});
 expect(Object.isFrozen(TRIVECTOR_V41_POLICY)).toBe(true); expect(FIT_EQUIVALENCE_TOLERANCE).toBe(0.02);
 expect(resolveArbitrationMode()).toBe("legacy");expect(resolveArbitrationMode(undefined,"v4.1")).toBe("v4.1");expect(resolveArbitrationMode("legacy","v4.1")).toBe("legacy");
 for(const bad of [true,1,"V4.1",{},"unknown"])expect(resolveArbitrationMode(bad,"v4.1")).toBe("legacy");
});
test("finite signals preserve unknown and ranges",()=>{
 for(const v of [null,undefined,"1",NaN,Infinity,-Infinity,-1])expect(finiteSignal(v)).toBeNull();
 expect(finiteSignal(0)).toBe(0);expect(finiteSignal(1,0,1)).toBe(1);expect(finiteSignal(1.01,0,1)).toBeNull();expect(finiteSignal(-2,-Infinity)).toBe(-2);
});
test("ambient arbitration cannot select new mode and module has no runtime imports",()=>{
 const previous=process.env.TEMPERANCE_TRIVECTOR_ARBITRATION;
 try {process.env.TEMPERANCE_TRIVECTOR_ARBITRATION="v4.1";expect(resolveArbitrationMode()).toBe("legacy");}
 finally {if(previous===undefined)delete process.env.TEMPERANCE_TRIVECTOR_ARBITRATION;else process.env.TEMPERANCE_TRIVECTOR_ARBITRATION=previous;}
 const source=readFileSync(new URL("../src/routing/trivector-math.ts",import.meta.url),"utf8");
 expect(source).not.toMatch(/process\.env|^import\s/m);
});
test("fit owns tolerance bucket without mutation",()=>{
 const input=[1,0.98,0.979,NaN,-1,2],copy=[...input];const result=fitBucket(input,x=>x);
 expect(result.maxFit).toBe(1);expect(result.bucket).toEqual([1,0.98]);expect(result.rest).toEqual([0.979,NaN,-1,2]);expect(input).toEqual(copy);
 expect(fitBucket([NaN],x=>x)).toEqual({maxFit:null,bucket:[],rest:[NaN]});expect(fitBucket([],()=>0)).toEqual({maxFit:null,bucket:[],rest:[]});
});
test("minimum headroom windows inflight margins and resets",()=>{
 const windows=[{window:"weekly",remaining:80,inflight:10,margin:10},{window:"session",remaining:20,inflight:5,margin:5}],before=JSON.stringify(windows);
 expect(effectiveHeadroom(windows,100,2)).toEqual({units:5,normalized:0.05,exhausted:[]});expect(JSON.stringify(windows)).toBe(before);
 expect(effectiveHeadroom(undefined,100)).toEqual({units:null,normalized:null,exhausted:[]});
 expect(effectiveHeadroom([{window:"old",remaining:0,resets_at_ms:100}],100).units).toBeNull();
 expect(effectiveHeadroom([{window:"a",remaining:0},{window:"z",remaining:-1},{window:"nonblocking",remaining:0,blocking:false}],100)).toEqual({units:-1,normalized:0,exhausted:["a","z"]});
 expect(effectiveHeadroom([{window:"high",remaining:200}],100).normalized).toBe(1);expect(effectiveHeadroom(windows,100,0).units).toBe(10);
});
test("cooldown blocking exhaustion exclusive boundary",()=>{
 expect(headGateReasons({nowMs:100,rateLimitedUntilMs:101,windows:[{window:"weekly",remaining:0}]})).toEqual(["head-gate:cooldown","head-gate:window-exhausted:weekly"]);
 expect(headGateReasons({nowMs:100,rateLimitedUntilMs:100})).toEqual([]);
});
test("429 hazard half life remains independent of G9",()=>{
 const half=TRIVECTOR_V41_POLICY.hazard_half_life_ms,now=half*2;
 expect(decayedHazard([now,now-half,now-half*2,now+1,NaN],now)).toBe(1.75);expect(decayedHazard(undefined,now)).toBe(0);
 expect(hazardAdjustedHeadroom(0.8,2)).toBeCloseTo(0.8*Math.exp(-1),12);expect(hazardAdjustedHeadroom(0.8,-1)).toBe(0.8);expect(g9GateV41({})).toEqual({acts:false,mass:0,upper:null});
});
test("Wilson and G9 low sample thresholds",()=>{
 expect(wilsonUpperBound(0,0)).toBeNull();expect(wilsonUpperBound(NaN,10)).toBeNull();expect(wilsonUpperBound(0,20)).toBeCloseTo(0.16113012549493322,12);
 expect(wilsonUpperBound(100,20)).toBeCloseTo(1,12);expect(wilsonUpperBound(-1,20)).toBe(wilsonUpperBound(0,20));
 expect(g9GateV41({successes:0,failures:19,consecutiveFailures:19}).acts).toBe(false);expect(g9GateV41({successes:0,failures:20,consecutiveFailures:5}).acts).toBe(true);
 expect(g9GateV41({successes:0,failures:20,consecutiveFailures:4}).acts).toBe(false);expect(g9GateV41({successes:20,failures:20,consecutiveFailures:5}).acts).toBe(false);
});
test("quota then latency then static arbitration and unknown signals",()=>{
 const a={quota:0.8,latency:100,rank:2},b={quota:0.9,latency:200,rank:1},c={quota:NaN,latency:1,rank:0},input=[a,b,c],cmp=(x:typeof a,y:typeof a)=>x.rank-y.rank;
 expect(arbitrateFitBucket(input,{quotaHeadroom:x=>x.quota,latencyMs:x=>x.latency,compareStatic:cmp})).toEqual({head:b,arbiter:"quota_headroom"});
 expect(arbitrateFitBucket([a,b],{latencyMs:x=>x.latency,compareStatic:cmp})).toEqual({head:a,arbiter:"latency"});expect(arbitrateFitBucket([a,b],{compareStatic:cmp})).toEqual({head:b,arbiter:"static_rank"});
 expect(arbitrateFitBucket([],{compareStatic:cmp})).toEqual({head:null,arbiter:"static_rank"});expect(input).toEqual([a,b,c]);
});
