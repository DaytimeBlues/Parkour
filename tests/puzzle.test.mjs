import {test} from 'node:test';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import {ChargeBoost,CHARGE_TICKS,CHARGE_MAX_BURST,portalCrossing,portalAngle,rotateFlat,PuzzleRun} from '../src/simulation/puzzle.ts';
import {puzzlePortals,puzzlePlatforms,puzzleCourse} from '../src/simulation/puzzle-course.ts';
import {TokenRun} from '../src/simulation/tokens.ts';
const still={forward:0,right:0};
test('charge is grounded-only, capped, release-fired and shared across aliases',()=>{const b=new ChargeBoost();b.press('KeyE',false);assert.equal(b.state,'ready');b.release('KeyE',{x:0,z:-1});b.press('ShiftLeft',true);for(let i=0;i<100;i++)assert.equal(b.step(),null);assert.equal(b.ticks,CHARGE_TICKS);assert.equal(b.state,'charging');b.press('KeyE',true);assert.equal(b.release('ShiftLeft',{x:0,z:-1}),false);assert.equal(b.release('KeyE',{x:0,z:-1}),true);assert.equal(b.remaining,CHARGE_MAX_BURST);for(let i=0;i<CHARGE_MAX_BURST;i++){assert.deepEqual(b.step(),{x:0,z:-1});b.finishStep(false);}assert.equal(b.step(),null);assert.equal(b.state,'cooldown');for(let i=0;i<80;i++){b.step();b.finishStep(false);}assert.equal(b.state,'cooldown');for(let i=0;i<6;i++){b.step();b.finishStep(true);}assert.equal(b.state,'ready');});
test('pause cancels charge without firing, and active burst remains paused until stepped',()=>{const b=new ChargeBoost();b.press('KeyE',true);b.step();b.cancelHold();assert.equal(b.state,'ready');assert.equal(b.release('KeyE',{x:1,z:0}),false);b.press('KeyE',true);b.step();b.release('KeyE',{x:1,z:0});const n=b.remaining;b.cancelHold();assert.equal(b.remaining,n);assert.equal(b.state,'burst');});
test('upright portals sweep front to back, reject edge and backside, rotate burst without scaling',()=>{const p=puzzlePortals[0];const from={x:0,y:3.05,z:-15},to={x:0,y:3.05,z:-19};assert.equal(portalCrossing(p,from,to),true);assert.equal(portalCrossing(p,to,from),false);assert.equal(portalCrossing(p,{...from,x:1.4},{...to,x:1.4}),false);const d=rotateFlat({x:0,z:-1},portalAngle(p));assert.ok(Math.abs(d.x-1)<1e-9&&Math.abs(d.z)<1e-9);assert.ok(Math.abs(Math.hypot(d.x,d.z)-1)<1e-9);});
function ticks(run,n,input=still){for(let i=0;i<n;i++)run.step(input);}
function face(run,x,z){const p=run.position;run.yaw=Math.atan2(-(x-p.x),-(z-p.z));}
function walkTo(run,x,z,max=500){for(let i=0;i<max;i++){const p=run.position;if(run.finished)return;if(Math.hypot(x-p.x,z-p.z)<.18){ticks(run,4);return;}face(run,x,z);run.step({forward:1,right:0});}throw Error(`walk timeout target=${x},${z} pos=${JSON.stringify(run.position)}`);}
function jumpTo(run,from,to){const a=puzzlePlatforms.find(p=>p.id===from),b=puzzlePlatforms.find(p=>p.id===to);assert.ok(a&&b);const dx=b.x-a.x,dz=b.z-a.z,n=Math.hypot(dx,dz),ux=dx/n,uz=dz/n,edge=Math.min(Math.abs(ux)>1e-8?(a.w/2-1.05)/Math.abs(ux):Infinity,Math.abs(uz)>1e-8?(a.d/2-1.05)/Math.abs(uz):Infinity);walkTo(run,a.x+ux*edge,a.z+uz*edge);assert.equal(run.grounded,true,`takeoff grounded ${from}`);face(run,b.x,b.z);run.step({forward:1,right:0,jump:true});let landed=false;for(let i=0;i<100;i++){const p=run.position,near=Math.hypot(p.x-b.x,p.z-b.z)<.3;if(!near)face(run,b.x,b.z);run.step({forward:near?0:1,right:0});const q=run.position;if(run.grounded&&Math.abs(q.y-(b.y+.93))<.12&&Math.abs(q.x-b.x)<b.w/2-.3&&Math.abs(q.z-b.z)<b.d/2-.3){landed=true;break;}}assert.ok(landed,`land ${from} -> ${to}: ${JSON.stringify(run.position)}`);walkTo(run,b.x,b.z);}
function toFirstRelay(run){ticks(run,30);jumpTo(run,'garden','garden-step-1');jumpTo(run,'garden-step-1','garden-step-2');jumpTo(run,'garden-step-2','relay-1');walkTo(run,0,-14);assert.ok(run.relays.has(1));}
function throughFirstWarp(run){walkTo(run,0,-16.7);face(run,0,-18);for(let i=0;i<25&&!run.portalCount;i++)run.step({forward:1,right:0});assert.equal(run.portalCount,1);ticks(run,20);walkTo(run,20,-17);assert.equal(run.checkpoint,2);}
function toSkybridge(run){jumpTo(run,'balcony','atrium-step-1');jumpTo(run,'atrium-step-1','atrium-step-2');jumpTo(run,'atrium-step-2','atrium-step-3');jumpTo(run,'atrium-step-3','relay-2');walkTo(run,21,-29);assert.ok(run.relays.has(2));walkTo(run,18.3,-29);face(run,17,-29);for(let i=0;i<25&&run.portalCount<2;i++)run.step({forward:1,right:0});assert.equal(run.portalCount,2);ticks(run,20);walkTo(run,-6,-31);assert.equal(run.checkpoint,4);}
function safeFinish(run){jumpTo(run,'skybridge','summit-step-1');jumpTo(run,'summit-step-1','summit-step-2');jumpTo(run,'summit-step-2','summit');assert.equal(run.finished,true);}
function fallOff(run,yaw){const falls=run.falls;run.yaw=yaw;for(let i=0;i<500&&run.falls===falls;i++)run.step({forward:1,right:0});assert.equal(run.falls,falls+1);ticks(run,30);assert.equal(run.boost.state,'ready');assert.ok(run.grounded);}
test('continuous safe route uses both relays and warps, climbs to finish, and restarts',async()=>{
 await R.init();const run=new PuzzleRun();try{toFirstRelay(run);throughFirstWarp(run);toSkybridge(run);safeFinish(run);assert.equal(run.falls,0);run.reset();ticks(run,30);assert.equal(run.finished,false);assert.equal(run.relays.size,0);assert.equal(run.checkpoint,0);assert.equal(run.boost.state,'ready');assert.ok(run.grounded);}finally{run.dispose();}
});
test('continuous route survives a fall in every chamber without losing relay unlocks',async()=>{
 await R.init();const run=new PuzzleRun();try{toFirstRelay(run);fallOff(run,Math.PI/2);assert.equal(run.checkpoint,1);assert.ok(run.relays.has(1));throughFirstWarp(run);fallOff(run,Math.PI);assert.equal(run.checkpoint,2);toSkybridge(run);fallOff(run,-Math.PI/2);assert.equal(run.checkpoint,4);assert.equal(run.relays.size,2);safeFinish(run);assert.equal(run.penalty,9);}finally{run.dispose();}
});
test('full charge earns the final shortcut from the normally reached skybridge',async()=>{
 await R.init();const run=new PuzzleRun();try{toFirstRelay(run);throughFirstWarp(run);toSkybridge(run);walkTo(run,-6,-34.8);run.yaw=0;run.pressBoost('KeyE');ticks(run,CHARGE_TICKS);assert.equal(run.boost.ticks,CHARGE_TICKS);run.step({forward:1,right:0,jump:true});run.releaseBoost('KeyE',{forward:1,right:0});for(let i=0;i<90&&!run.finished;i++)run.step({forward:1,right:0});assert.equal(run.finished,true,JSON.stringify(run.position));assert.equal(run.falls,0);}finally{run.dispose();}
});
test('blocked exit refuses a warp without placing the capsule inside geometry',async()=>{
 await R.init();const run=new PuzzleRun();try{toFirstRelay(run);run.world.createCollider(R.ColliderDesc.cuboid(2,2,2).setTranslation(19.45,9,-17));run.world.step();walkTo(run,0,-16.7);run.yaw=0;ticks(run,5,{forward:1,right:0});assert.equal(run.portalCount,0);assert.match(run.lastEvent,/blocked/);assert.ok(run.position.x<2);}finally{run.dispose();}
});

test('charge HUD agrees with grounded permission and partial charge has bounded benefit',()=>{const b=new ChargeBoost();assert.match(b.label(false),/LAND/);assert.match(b.label(true),/HOLD/);b.press('KeyE',true);ticks({step:()=>b.step()},19);b.release('KeyE',{x:0,z:-1});assert.ok(b.remaining>6&&b.remaining<21);});
test('normally reached warp carries and rotates an active charged burst without rearming',async()=>{await R.init();const run=new PuzzleRun();try{toFirstRelay(run);walkTo(run,0,-16.2);run.yaw=0;run.pressBoost('KeyE');ticks(run,CHARGE_TICKS);run.releaseBoost('KeyE',{forward:1,right:0});for(let i=0;i<15&&!run.portalCount;i++)run.step(still);assert.equal(run.portalCount,1);assert.equal(run.boost.state,'burst');assert.ok(run.boost.remaining>0&&run.boost.remaining<21);assert.ok(run.boost.direction.x>.99);assert.ok(Math.abs(run.yaw+Math.PI/2)<1e-9);assert.equal(run.grounded,false);}finally{run.dispose();}});

// Integration uses the real controller and ordinary movement inputs, not a browser or teleports.
test('tokens survive a continuous Relay route, checkpoint fall, finish and explicit restart',async()=>{
 await R.init();const run=new PuzzleRun(),tokens=new TokenRun(puzzleCourse),step=run.step.bind(run);
 run.step=input=>{const falls=run.falls;step(input);if(falls===run.falls)tokens.collect(run.position,0,'playing');};
 try{
  ticks(run,30);assert.equal(tokens.score,0);walkTo(run,0,-1.8);assert.equal(tokens.score,10);
  toFirstRelay(run);const score=tokens.score;assert.ok(score>=30);fallOff(run,Math.PI/2);assert.equal(tokens.score,score);walkTo(run,0,-15);assert.equal(tokens.score,score);
  throughFirstWarp(run);toSkybridge(run);safeFinish(run);assert.ok(tokens.score>=80);const finishedScore=tokens.score;ticks(run,60);assert.equal(tokens.score,finishedScore);
  run.reset();tokens.reset();ticks(run,30);assert.equal(tokens.score,0);walkTo(run,0,-1.8);assert.equal(tokens.score,10);
 }finally{run.dispose();}
});
