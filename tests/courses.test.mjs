import {test} from 'node:test';
import assert from 'node:assert/strict';
import {courses,platformX,validBest} from '../src/simulation/courses.ts';
test('four independent courses have start, checkpoints and a goal',()=>{
 assert.equal(courses.length,4);assert.equal(new Set(courses.map(c=>c.id)).size,4);
 for(const c of courses){assert.deepEqual(c.platforms.filter(p=>p.checkpoint).map(p=>p.checkpoint),[1,2,3,4,5]);assert.equal(c.platforms.length,49);assert.ok(c.platforms.at(-1).y>=39);assert.equal(c.platforms.filter(p=>p.goal).length,1);assert.ok(c.platforms.at(-1).goal);assert.deepEqual([c.platforms[0].x,c.platforms[0].z],[0,0]);}
});
test('moving islands remain within declared bounds and return after a period',()=>{
 for(const p of courses.flatMap(c=>c.platforms).filter(p=>p.move)) {for(let i=0;i<=100;i++){const x=platformX(p,i*p.move.period/100);assert.ok(Math.abs(x-p.x)<=p.move.amplitude+1e-10);}assert.ok(Math.abs(platformX(p,0)-platformX(p,p.move.period))<1e-10);}
});
test('stored best values reject corrupt or unreasonable values',()=>{for(const x of [null,undefined,NaN,Infinity,-1,86400,'12'])assert.equal(validBest(x),null);assert.equal(validBest(12.25),12.25);});
