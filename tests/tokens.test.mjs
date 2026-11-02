import {test} from 'node:test';
import assert from 'node:assert/strict';
import {courses,platformX} from '../src/simulation/courses.ts';
import {puzzleCourse} from '../src/simulation/puzzle-course.ts';
import {TokenRun,courseTokens,tokenPosition,TOKEN_RADIUS,TOKEN_VERTICAL_REACH} from '../src/simulation/tokens.ts';
import {RADIUS} from '../src/simulation/physics.ts';
const all=[...courses,puzzleCourse];

test('all five courses have stable, unique tokens and bounded transparent scoring totals',()=>{
 const ids=[];for(const course of all){const run=new TokenRun(course);assert.deepEqual(courseTokens(course),run.tokens);ids.push(...run.tokens.map(t=>t.id));assert.equal(run.total,course===puzzleCourse?17:53);assert.equal(run.availablePoints,course===puzzleCourse?370:730);assert.ok(run.tokens.some(t=>t.value===50));assert.ok(!run.tokens.some(t=>t.platform.goal));}
 assert.equal(new Set(ids).size,ids.length);
});
test('every token is reachable over an existing platform with capsule edge clearance',()=>{
 for(const course of all)for(const token of courseTokens(course)){const p=token.platform;assert.ok(Math.abs(token.offsetX)+RADIUS+.1<p.w/2,token.id);assert.ok(Math.abs(token.offsetZ)+RADIUS+.1<p.d/2,token.id);const at=tokenPosition(token,0);assert.ok(Math.abs((p.y+.93)-at.y)<TOKEN_VERTICAL_REACH);}
});
test('the first visible route token needs movement, then awards exactly once',()=>{
 for(const course of all){const run=new TokenRun(course);assert.deepEqual(run.collect({x:0,y:1.5,z:2},0,'playing'),[]);const at=tokenPosition(run.tokens[0],0);assert.equal(run.collect({...at,y:.93},0,'playing').length,1);assert.equal(run.score,10);for(let frame=0;frame<300;frame++)run.collect(at,frame/60,'playing');assert.equal(run.score,10);assert.equal(run.collected.size,1);}
});
test('ready, starting, paused and finished phases cannot award points',()=>{
 for(const phase of ['ready','starting','paused','finished']){const run=new TokenRun(courses[0]),at=tokenPosition(run.tokens[0],0);assert.deepEqual(run.collect(at,0,phase),[]);assert.equal(run.score,0);assert.equal(run.collected.size,0);}
});
test('unique IDs prevent checkpoint and fall revisits farming; restart deliberately resets',()=>{
 const run=new TokenRun(courses[0]),token=run.tokens.find(t=>t.platform.checkpoint),at=tokenPosition(token,0);run.collect(at,0,'playing');const score=run.score;run.collect({x:0,y:-30,z:0},4,'playing');run.collect(at,5,'playing');run.collect(at,6,'playing');assert.equal(run.score,score);run.reset();assert.equal(run.score,0);assert.equal(run.collected.size,0);assert.equal(run.collect(at,0,'playing').length,1);assert.equal(run.score,10);
});
test('side bonus is a distinct detour and awards 50 rather than altering time',()=>{
 for(const course of all){const run=new TokenRun(course),bonus=run.tokens.find(t=>t.id.endsWith(':bonus'));const at=tokenPosition(bonus,0);assert.ok(Math.hypot(bonus.offsetX,bonus.offsetZ)>2*TOKEN_RADIUS);assert.equal(run.collect(at,0,'playing').length,1);assert.equal(run.score,50);assert.equal(run.collect(at,0,'playing').length,0);}
});
test('moving tokens follow exact physics-time platform positions and pause keeps their position',()=>{
 const run=new TokenRun(courses[3]),token=run.tokens.find(t=>t.platform.move);for(const seconds of [0,.25,1,3,8]){const at=tokenPosition(token,seconds);assert.equal(at.x,platformX(token.platform,seconds)+token.offsetX);const snapshot={...at};run.collect(at,seconds,'paused');assert.deepEqual(tokenPosition(token,seconds),snapshot);assert.equal(run.score,0);}assert.equal(run.collect(tokenPosition(token,3),3,'playing').length,1);
});
test('a portal or respawn cannot collect tokens on an imaginary swept path',()=>{
 const run=new TokenRun(puzzleCourse);run.collect({x:-100,y:1.35,z:-1.8},0,'playing');run.collect({x:100,y:1.35,z:-1.8},0,'playing');assert.equal(run.score,0);assert.equal(run.collected.size,0);
});
test('pickup reach is bounded, rejects corrupt coordinates, and covers maximum boost steps',()=>{
 const run=new TokenRun(courses[0]),at=tokenPosition(run.tokens[0],0);for(const position of [{...at,x:at.x+TOKEN_RADIUS+.01},{...at,y:at.y+TOKEN_VERTICAL_REACH+.01},{...at,x:NaN},{...at,z:Infinity}])assert.equal(run.collect(position,0,'playing').length,0);
 assert.equal(run.collect(at,NaN,'playing').length,0);for(let z=at.z+1;z>=at.z-1;z-=14.4/60)run.collect({...at,z},0,'playing');assert.equal(run.score,10);
});
test('runs and courses do not share collected IDs or points',()=>{const first=new TokenRun(courses[0]),second=new TokenRun(courses[0]),other=new TokenRun(courses[1]);first.collect(tokenPosition(first.tokens[0],0),0,'playing');assert.equal(second.score,0);assert.equal(other.score,0);assert.equal(second.collected.size,0);});
