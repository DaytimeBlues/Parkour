import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import R from '@dimforge/rapier3d-compat';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FlowRun,GLIDE_TICKS,GLIDE_GRAVITY,RAMP_SPEED} from '../src/simulation/flow.ts';
import {flowCourses} from '../src/simulation/flow-course.ts';
import {tunnelCourses} from '../src/simulation/tunnel-course.ts';
import {createRootbridgeCourse} from '../src/simulation/rootbridge-course.ts';
import {GameplayKeys,movementInput} from '../src/simulation/keyboard.ts';
import {STEP,SPEED,JUMP,GRAVITY} from '../src/simulation/physics.ts';
import {GliderPose} from '../src/render/glider-pose.ts';
import {AppearanceAssets} from '../src/render/appearance-assets.ts';
import {appearanceFactory} from '../src/multiplayer/remote-avatar.ts';
import {ARENA,PLAYER,createPlayer,stepPlayer,createRoomState,publicRoom} from '../shared/multiplayer.mjs';
import {encodeRoom,decodeRoom} from '../shared/multiplayer-wire.mjs';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {SqliteD1} from '../server/test/d1-sqlite.mjs';
import {glideCourseId,glideBestKey,MAPWIDE_GLIDE_RULES} from '../src/simulation/glide-rules.ts';
import {rankingRules} from '../src/simulation/ranking.ts';
import {bestKey} from '../src/simulation/course-catalog.ts';
import {COURSE_RULES} from '../server/lib/leaderboard.mjs';
const still={forward:0,right:0},neutral={...still,yaw:0,jump:false,glide:false,slide:false};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const ticks=(run,n,input=still)=>{for(let i=0;i<n;i++)run.step(input);};
const key=(code,repeat=false)=>({code,repeat,preventDefault(){}});
const fields=p=>Object.fromEntries(['x','y','z','vx','vy','vz','yaw','grounded','gliding','sliding','glideRemaining','padCooldown','falls'].map(k=>[k,p[k]]));

for(const course of [...flowCourses,...tunnelCourses,createRootbridgeCourse()])test(`${course.id}: normal held jump glides without a ramp, keeps normal ascent and never auto-bounces`,async()=>{
 await R.init();const held=new FlowRun(course),tap=new FlowRun(course),keys=new GameplayKeys();
 try{
  ticks(held,30);ticks(tap,30);const groundY=held.position.y;
  ticks(held,3,{...still,glide:true});ticks(tap,3);assert.ok(Math.abs(held.position.y-groundY)<.001,'ground hold cannot lift the player');const y=held.position.y;assert.equal(held.gliding,false);
  assert.equal(keys.press(key('Space')),'jump');held.step({...still,jump:true,glide:keys.has('Space')});tap.step({...still,jump:true});
  near(held.vy,JUMP-GRAVITY*STEP);assert.equal(held.glideRemaining,0);assert.equal(held.launches,0);assert.equal(held.gliding,true);
  while(tap.vy>0){near(held.position.y,tap.position.y);near(held.vy,tap.vy);held.step({...still,glide:true});tap.step(still);}
  const descending=held.vy;held.step({...still,glide:true});near(held.vy,descending-GLIDE_GRAVITY*STEP);assert.ok(held.vy<0);
  for(let i=0;i<300&&!held.grounded;i++)held.step({...still,glide:true});assert.equal(held.grounded,true);assert.equal(held.gliding,false);ticks(held,30,{...still,glide:true});assert.ok(Math.abs(held.position.y-y)<.001,'landing settles to the same platform without lifting');
  for(let i=0;i<80;i++){assert.equal(keys.press(key('Space',true)),'held');held.step({...still,glide:keys.has('Space')});assert.equal(held.grounded,true);assert.equal(held.gliding,false);}
  keys.delete('Space');assert.equal(keys.press(key('Space')),'jump');held.step({...still,jump:true,glide:true});assert.ok(held.vy>0);assert.equal(held.grounded,false);assert.equal(held.launches,0);
 }finally{held.dispose();tap.dispose();}
});

test('Flow walk-off, late fall activation, release/repress, ordinary steering cap and bounds recovery need no ramp',async()=>{
 await R.init();const run=new FlowRun(flowCourses[0]);try{
  ticks(run,30);let left=false;
  for(let i=0;i<250&&!left;i++){run.step({forward:0,right:1});left=!run.grounded;}
  assert.equal(left,true);assert.equal(run.launches,0);assert.equal(run.glideRemaining,0);assert.ok(run.vy<0);
  ticks(run,9,{forward:0,right:1});const before=run.vy,prior=run.position;run.step({forward:1,right:1,glide:true});
  assert.equal(run.gliding,true);near(run.vy,before-GLIDE_GRAVITY*STEP);assert.ok(Math.hypot(run.position.x-prior.x,run.position.z-prior.z)<=SPEED*STEP+.001);
  const held=run.vy;run.step({...still,glide:false});near(run.vy,held-GRAVITY*STEP);assert.equal(run.gliding,false);
  const released=run.vy;run.step({...still,glide:true});near(run.vy,released-GLIDE_GRAVITY*STEP);assert.equal(run.gliding,true);
  const falls=run.falls;for(let i=0;i<400&&run.falls===falls;i++)run.step({forward:0,right:1,glide:true});assert.equal(run.falls,falls+1);assert.equal(run.penalty,3);assert.equal(run.gliding,false);assert.equal(run.glideRemaining,0);assert.equal(run.slideRemaining,0);assert.equal(run.low,false);assert.equal(run.launches,0);
  ticks(run,30);assert.equal(run.grounded,true);run.step({...still,jump:true,glide:true});assert.ok(run.vy>0);
 }finally{run.dispose();}
});

test('Flow repeated pause/input-clear/reset cannot resurrect held glide or a jump, and actual wing adapter follows airborne state',async()=>{
 await R.init();const run=new FlowRun(flowCourses[0]),keys=new GameplayKeys(),pose=new GliderPose();try{
  for(let cycle=0;cycle<3;cycle++){
   run.reset();keys.clear();ticks(run,30);keys.press(key('Space'));run.step({...movementInput(keys),jump:true,glide:true});ticks(run,28,{...still,glide:true});
   const p={...run.position},vy=run.vy;keys.clear();run.pause();pose.update({phase:'paused',flight:!run.grounded,gliding:run.gliding,dt:1/60,lateralSpeed:0,verticalSpeed:run.vy,reducedMotion:false});assert.equal(pose.visible,false);assert.deepEqual({...run.position},p);assert.equal(run.vy,vy);
   keys.press(key('Space',true));assert.equal(keys.has('Space'),false);run.step({...movementInput(keys),glide:keys.has('Space')});assert.equal(run.gliding,false);assert.ok(run.vy<vy);
   keys.press(key('Space'));run.step({...still,glide:true});pose.update({phase:'playing',flight:!run.grounded,gliding:run.gliding,dt:1/60,lateralSpeed:0,verticalSpeed:run.vy,reducedMotion:false});assert.equal(run.glideRemaining,0);assert.equal(pose.visible,true);
   run.reset();pose.update({phase:'ready',flight:!run.grounded,gliding:run.gliding,dt:1/60,lateralSpeed:0,verticalSpeed:run.vy,reducedMotion:false});assert.equal(run.gliding,false);assert.equal(pose.visible,false);assert.equal(run.glideRemaining,0);
  }
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');assert.match(main,/flight:!!flowRun&&!flowRun.grounded,gliding:!!flowRun\?\.gliding/);assert.doesNotMatch(main,/flight:[^,]*glideRemaining/);
 }finally{run.dispose();}
});

test('multiplayer ordinary jump/glide keeps ascent, ground hold does not lift, and landing clears glide until next jump edge',()=>{
 for(const team of ['red','blue']){
  const a=createPlayer(team),b=createPlayer(team);for(let i=0;i<10;i++){stepPlayer(a,neutral);stepPlayer(b,neutral);}stepPlayer(a,{...neutral,glide:true});stepPlayer(b,neutral);assert.equal(a.grounded,true);assert.equal(a.gliding,false);near(a.y,0);
  stepPlayer(a,{...neutral,jump:true,glide:true});stepPlayer(b,{...neutral,jump:true});near(a.vy,PLAYER.jump-PLAYER.gravity*STEP);
  while(b.vy>0){near(a.y,b.y);near(a.vy,b.vy);stepPlayer(a,{...neutral,glide:true});stepPlayer(b,neutral);}
  for(let i=0;i<240&&!a.grounded;i++)stepPlayer(a,{...neutral,glide:true});assert.equal(a.grounded,true);assert.equal(a.gliding,false);near(a.y,0);
  for(let i=0;i<90;i++)stepPlayer(a,{...neutral,glide:true});assert.equal(a.grounded,true);assert.equal(a.gliding,false);stepPlayer(a,{...neutral,jump:true,glide:true});assert.ok(a.vy>0);assert.equal(a.glideRemaining,0);
 }
});

test('multiplayer walk-offs, long falling activation, release/repress and out-of-bounds respawn stay safe',()=>{
 const crown={...createPlayer(),x:0,y:14,z:10,id:'same-seat'};
 let departed=false;for(let i=0;i<30&&!departed;i++){stepPlayer(crown,{...neutral,forward:-1});departed=!crown.grounded;}
 assert.equal(departed,true);assert.equal(crown.glideRemaining,0);for(let i=0;i<12;i++)stepPlayer(crown,{...neutral,forward:-1});
 const prior={...crown};stepPlayer(crown,{...neutral,forward:1,right:1,glide:true});assert.equal(crown.gliding,true);assert.ok(crown.vy<0);assert.ok(Math.hypot(crown.vx,crown.vz)<=PLAYER.speed+1e-7);
 stepPlayer(crown,neutral);assert.equal(crown.gliding,false);assert.ok(crown.vy<-2.4);stepPlayer(crown,{...neutral,glide:true});near(crown.vy,-2.4);
 const falling={...createPlayer('blue'),id:'same-seat',x:64,y:5,z:35,grounded:false,vy:-12};let fell=false;
 for(let i=0;i<900&&!fell;i++){stepPlayer(falling,{...neutral,right:1,glide:true});fell=falling.falls>0;}
 assert.equal(fell,true);assert.equal(falling.id,'same-seat');assert.equal(falling.team,'blue');assert.equal(falling.gliding,false);assert.equal(falling.glideRemaining,0);assert.equal(falling.padCooldown,0);assert.ok([falling.x,falling.y,falling.z].every(Number.isFinite));
 stepPlayer(falling,{...neutral,jump:true,glide:true});assert.ok(falling.vy>0);
});

test('pad boost expires while wings remain held, returning to normal speed with no extra lift or timer refill',()=>{
 const p={...createPlayer(),x:0,y:60,z:35,grounded:false,vy:-2.4,glideRemaining:STEP*2};
 stepPlayer(p,{...neutral,forward:1,glide:true});near(Math.hypot(p.vx,p.vz),12);assert.equal(p.gliding,true);
 stepPlayer(p,{...neutral,forward:1,glide:true});near(p.glideRemaining,0);assert.equal(p.gliding,true);
 stepPlayer(p,{...neutral,forward:1,glide:true});near(Math.hypot(p.vx,p.vz),PLAYER.speed);near(p.vy,-2.4);assert.equal(p.gliding,true);near(p.glideRemaining,0);
 stepPlayer(p,{...neutral,glide:false});assert.equal(p.gliding,false);const vy=p.vy;stepPlayer(p,{...neutral,glide:true});assert.equal(p.gliding,true);assert.ok(p.vy<=vy+PLAYER.gravity*STEP);near(p.glideRemaining,0);
});

test('actual API and client use identical map-wide glide, remote wire/wing visibility survives zero pad charge, teacher pause/end remain authoritative',async t=>{
 const db=new SqliteD1();t.after(()=>db.close());const origin='https://glide.fixture',teacher={userId:'glide-teacher'};let now=1800000000000;
 const raw=(path,body,token,principal)=>handleMultiplayer(new Request(`${origin}/api/multiplayer/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{principal,now});
 const call=async(...args)=>{const r=await raw(...args);return {status:r.status,...await r.json()};};
 const created=await call('rooms',{durationSeconds:300},null,teacher),code=created.code;
 const own=await call('join',{code,nickname:'Glider',joinKey:'ab'.repeat(32)}),peer=await call('join',{code,nickname:'Peer',joinKey:'cd'.repeat(32)});
 const started=await call('control',{code,action:'start',revision:0,operationId:crypto.randomUUID()},null,teacher);assert.equal(started.status,200);
 const baseline=await call('state',{code},own.seatToken),seat={code,seatToken:own.seatToken,playerId:own.playerId};
 const client=new MultiplayerClient(seat,(path,init)=>raw(path.split('/').at(-1),JSON.parse(init.body),own.seatToken),()=>now);client.accept(decodeRoom(baseline.room),baseline.ack,true);
 const authority=structuredClone(client.predicted);
 for(let batch=0;batch<4;batch++){
  for(let i=0;i<12;i++){const frame={...neutral,forward:1,jump:batch===0&&i===0,glide:true};client.predict(frame);stepPlayer(authority,frame);}
  now+=200;await client.pump();assert.deepEqual(fields(client.predicted),fields(authority));assert.equal(client.needsReconnect,false);
 }
 assert.equal(client.predicted.gliding,true);assert.equal(client.predicted.glideRemaining,0);assert.ok(client.predicted.vy<0);
 const observed=await call('state',{code},peer.seatToken),remote=decodeRoom(observed.room).players.find(p=>p.id===own.playerId);assert.equal(remote.gliding,true);assert.equal(remote.glideRemaining,0);
 const store=new AppearanceAssets('/',{loadAsync:async url=>{const bytes=readFileSync(new URL(`../public/models/appearance/${basename(url)}`,import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}}),factory=appearanceFactory(store),avatar=factory.create(remote.team,{character:'fox',wing:'angel'});
 try{await avatar.ready;avatar.pose(1,7.2,remote.grounded,remote.gliding,false);assert.equal(avatar.root.getObjectByName('WingSocket').children[0].visible,true);avatar.pose(1.1,0,true,false,false);assert.equal(avatar.root.getObjectByName('WingSocket').children[0].visible,false);}finally{await factory.dispose();}
 const illegal=await call('sync',{code,epoch:client.room.epoch,sequence:client.ack+1,frames:[{...neutral,x:100}]},own.seatToken);assert.equal(illegal.status,400);
 const oldEpoch=client.room.epoch,paused=await call('control',{code,action:'pause',revision:observed.room.controlRevision,operationId:crypto.randomUUID()},null,teacher);assert.equal(paused.status,200);
 const rejected=await call('sync',{code,epoch:oldEpoch,sequence:client.ack+1,frames:[{...neutral,glide:true}]},own.seatToken);assert.equal(rejected.status,409);assert.equal(rejected.error,'STALE_EPOCH');
 client.accept(decodeRoom((await call('state',{code},own.seatToken)).room),client.ack);const frozen=fields(client.predicted);client.predict({...neutral,jump:true,glide:true});assert.deepEqual(fields(client.predicted),frozen);
 const ended=await call('control',{code,action:'end',revision:paused.room.controlRevision,operationId:crypto.randomUUID()},null,teacher);assert.equal(ended.status,200);const current=await call('state',{code},own.seatToken);client.accept(decodeRoom(current.room),current.ack);client.predict({...neutral,glide:true});assert.deepEqual(fields(client.predicted),frozen);
 client.dispose();
});

test('map-wide best/board identities isolate every changed Flow mode and preserve all old rules and keys',()=>{
 for(const course of [...flowCourses,...tunnelCourses]){
  const id=glideCourseId(course.id);assert.notEqual(id,course.id);assert.equal(glideCourseId(id),id);assert.equal(rankingRules(id),MAPWIDE_GLIDE_RULES);assert.equal(COURSE_RULES[id].version,MAPWIDE_GLIDE_RULES);assert.deepEqual(COURSE_RULES[id].milestones,COURSE_RULES[course.id].milestones);assert.notEqual(glideBestKey(course.id),bestKey(course.id));assert.equal(rankingRules(course.id),course.id.endsWith('v1')?'flow-v1':'flow-v2');
 }
 for(const id of ['daybreak','sundown','storm','aurora','relay-gardens-v1'])assert.equal(glideCourseId(id),id);
 const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');assert.match(main,/createLeaderboardUI\(overlay,\(\)=>isWoodlandSelected\(\)\?null:glideCourseId\(courses\[selected\].id\)\)/);assert.match(main,/client.begin\(glideCourseId\(courses\[selected\].id\),leaderboard.enabled\(\)\)/);assert.match(main,/glideBestKey\(id\)/);
});
