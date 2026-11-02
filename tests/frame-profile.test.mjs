import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FrameProfile,profilingEnabled} from '../src/dev/frame-profile.ts';
const sample=n=>({intervalMs:n,updateMs:n/2,renderSubmitMs:n/4,calls:n,triangles:n*10});
test('profiling requires development and exact explicit opt-in',()=>{for(const search of ['', '?profile=0','?profile=true'])assert.equal(profilingEnabled(true,search),false);assert.equal(profilingEnabled(true,'?profile=1'),true);assert.equal(profilingEnabled(false,'?profile=1'),false);});
test('bounded buffer reports nearest-rank percentiles and evicts oldest',()=>{const p=new FrameProfile(20);for(let i=1;i<=25;i++)p.record(sample(i));const s=p.snapshot();assert.equal(s.count,20);assert.deepEqual(s.intervalMs,{median:15,p95:24,max:25});assert.deepEqual(s.renderSubmitMs,{median:3.75,p95:6,max:6.25});});
test('empty/reset metrics are unknown, not zero performance',()=>{const p=new FrameProfile();assert.equal(p.snapshot().intervalMs.p95,null);p.record(sample(1));p.reset();assert.equal(p.snapshot().count,0);assert.equal(p.snapshot().updateMs.max,null);});
test('reject invalid durations/counters; copy input and bound capacity',()=>{const p=new FrameProfile(2);for(const n of [-1,NaN,Infinity])p.record(sample(n));assert.equal(p.snapshot().count,0);const s=sample(4);p.record(s);s.intervalMs=999;assert.equal(p.snapshot().intervalMs.max,4);for(const n of [0,-1,1.5,3601])assert.throws(()=>new FrameProfile(n),RangeError);});
