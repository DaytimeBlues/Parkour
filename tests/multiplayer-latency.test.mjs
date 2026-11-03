import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {SqliteD1} from '../server/test/d1-sqlite.mjs';
import {decodeRoom} from '../shared/multiplayer-wire.mjs';
const move={forward:1,right:0,yaw:0,jump:false,glide:false,slide:false};
test('sustained 700ms authoritative replies discard obsolete prediction without permanent map release',async t=>{
 const db=new SqliteD1();t.after(()=>db.close());let now=1000,revision=0;
 const call=(path,body,token,teacher=false)=>handleMultiplayer(new Request(`https://fixture.invalid/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://fixture.invalid','Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{now,principal:teacher?{userId:'latency-fixture-teacher'}:null});
 const created=await(await call('rooms',{durationSeconds:300},null,true)).json();
 const joined=await(await call('join',{code:created.code,nickname:'Synthetic Latency',joinKey:'a'.repeat(64)})).json();
 await call('join',{code:created.code,nickname:'Synthetic Other',joinKey:'b'.repeat(64)});
 assert.equal((await call('control',{code:created.code,action:'start',revision:revision++,operationId:crypto.randomUUID()},null,true)).status,200);
 let resolveSync,releaseSignals=0,maxQueued=0;const statuses=[];
 const c=new MultiplayerClient({code:created.code,seatToken:joined.seatToken,playerId:joined.playerId},async(path,init)=>{
  const endpoint=path.split('/').at(-1);if(endpoint==='sync')await new Promise(r=>resolveSync=r);
  const response=await call(endpoint,JSON.parse(init.body),joined.seatToken);statuses.push({endpoint,status:response.status});return response;
 },()=>now,()=>{if(c.needsReconnect)releaseSignals++;});t.after(()=>c.dispose());
 const state=await(await call('state',{code:created.code},joined.seatToken)).json();c.accept(decodeRoom(state.room),state.ack,true);assert.equal(c.room.status,'running');
 const advance=(ms)=>{const end=now+ms;while(now+1000/60<=end+.001){now+=1000/60;c.predict(move);maxQueued=Math.max(maxQueued,c.pending.length+(c.batch?.frames.length??0));}now=end;};
 advance(200);
 for(let cycle=0;cycle<20;cycle++){
  if(now-c.lastAttempt<200)advance(200-(now-c.lastAttempt));
  resolveSync=null;const task=c.pump();assert.ok(resolveSync,`cycle ${cycle} must dispatch bounded sync`);
  advance(700);resolveSync();await task;
  assert.equal(c.needsReconnect,false,`cycle ${cycle}: ${c.message}`);
  assert.equal(releaseSignals,0,`cycle ${cycle} must not ask player to leave map`);
 }
 assert.ok(c.ack>=20);assert.ok(maxQueued<=60);assert.equal(statuses.filter(s=>s.endpoint==='reconnect').length,0);
});

import {encodeRoom} from '../shared/multiplayer-wire.mjs';
import {createPlayer} from '../shared/multiplayer.mjs';
const seat={code:'LAT123',playerId:'p1',seatToken:'synthetic-seat'};
function snapshot(version=1,epoch=1){return{code:seat.code,status:'running',epoch,version,remainingMs:300000,durationMs:300000,scores:{red:0,blue:0},zones:[],players:[{...createPlayer('red'),id:'p1',nickname:'Fixture',active:true,connected:true,lastSeenMs:0,seq:0}],serverTime:0,snapshotMs:0,controlRevision:0,locked:false,winner:null};}
const reply=(room,ack=0,playerId='p1')=>new Response(JSON.stringify({room:encodeRoom({...room,teacher:false},'p1'),ack,playerId}));
const tooFast=()=>new Response(JSON.stringify({error:'INPUT_TOO_FAST'}),{status:409});
const tick=()=>new Promise(r=>setImmediate(r));

test('delayed timing-state read holds inputs and uses send-start rather than receive-time gate',async()=>{
 let now=0,resolveState,calls=0;const c=new MultiplayerClient(seat,async(path)=>{calls++;return path.endsWith('/sync')?(calls===1?tooFast():reply({...snapshot(3),players:[{...snapshot(3).players[0],seq:1}]},1)):await new Promise(r=>resolveState=r);},()=>now);c.accept(snapshot(),0,true);c.predict(move);now=200;const task=c.pump();while(!resolveState)await tick();
 const pose=structuredClone(c.predicted);for(let i=0;i<240;i++){now+=1000/60;c.predict({...move,jump:i===30});}assert.equal(c.predictionHeld,true);assert.equal(c.needsReconnect,false);assert.deepEqual(c.predicted,pose);assert.equal(c.pending.length,0);
 resolveState(reply(snapshot(2)));await task;assert.equal(c.predictionHeld,false);assert.equal(c.batch,null);assert.equal(c.pending.length,0);const count=calls;c.predict({...move,jump:false});assert.equal(c.pending.length,1);assert.equal(c.pending[0].jump,false);await c.pump();assert.equal(calls,count+1);assert.equal(c.ack,1);assert.equal(c.pending.length,0);c.dispose();
});

for(const mode of['stale-epoch','stale-version','stale-time','stale-ack','ack-sequence','wrong-player','wrong-room','malformed-wire','removed','forbidden'])test(`timing baseline ${mode} fails closed without advancing authority or replay`,async()=>{
 let now=0,stateReads=0;const baseline=snapshot(8,3);baseline.snapshotMs=1000;baseline.players[0].seq=4;
 const state=snapshot(9,3);state.snapshotMs=1200;state.players[0].seq=4;let ack=4,playerId='p1';
 if(mode==='stale-epoch')state.epoch=2;if(mode==='stale-version')state.version=7;if(mode==='stale-time')state.snapshotMs=900;
 if(mode==='stale-ack'){state.players[0].seq=3;ack=3;}if(mode==='ack-sequence')ack=5;if(mode==='wrong-player')playerId='other';if(mode==='wrong-room')state.code='OTHER';if(mode==='removed')state.players[0].active=false;
 const c=new MultiplayerClient(seat,async(path)=>{if(path.endsWith('/sync'))return tooFast();stateReads++;if(mode==='forbidden')return new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403});if(mode==='malformed-wire')return new Response(JSON.stringify({room:{wireVersion:999},ack:4,playerId:'p1'}));return reply(state,ack,playerId);},()=>now);c.accept(baseline,4,true);c.predict(move);const pose=structuredClone(c.predicted);now=200;await c.pump();
 assert.equal(c.needsReconnect,true);assert.equal(c.ack,4);assert.equal(c.room.version,8);assert.deepEqual(c.predicted,pose);assert.equal(c.budgetRebases,0);c.predict({...move,jump:true});assert.deepEqual(c.predicted,pose);if(mode==='forbidden'){now=30000;await c.recover();assert.equal(stateReads,1);}c.dispose();
});

test('disposed generation ignores successful delayed timing baseline, including callback and hold mutation',async()=>{
 let now=0,resolveState,changes=0;const c=new MultiplayerClient(seat,async(path)=>path.endsWith('/sync')?tooFast():await new Promise(r=>resolveState=r),()=>now,()=>changes++);c.accept(snapshot(),0,true);c.predict(move);now=200;const task=c.pump();while(!resolveState)await tick();c.dispose();const state={ack:c.ack,message:c.message,changes,held:c.predictionHeld};resolveState(reply(snapshot(5)));await task;assert.equal(c.ack,state.ack);assert.equal(c.message,state.message);assert.equal(changes,state.changes);assert.equal(c.predictionHeld,state.held);assert.equal(c.needsReconnect,true);
});

test('700ms ACK trims only never-submitted old inputs; discarded jump edges are not synthesized or duplicated',async()=>{
 let now=0,resolveSync,body,calls=0;const c=new MultiplayerClient(seat,async(path,init)=>{calls++;body=JSON.parse(init.body);return await new Promise(r=>resolveSync=r);},()=>now);c.accept(snapshot(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const task=c.pump();assert.equal(body.frames.length,12);
 for(let i=0;i<48;i++){now+=1000/60;c.predict({...move,yaw:i/100,jump:i===0||i===47});}c.predict({...move,jump:true});assert.equal(c.predictionHeld,true);const authority=snapshot(2);authority.players[0].seq=1;resolveSync(reply(authority,1));await task;
 assert.equal(c.needsReconnect,false);assert.equal(c.pending.length,30);assert.equal(c.discardedPredictionFrames,18);assert.equal(c.pending[0].yaw,.18);assert.equal(c.pending.filter(f=>f.jump).length,1);
 const next=c.pump();assert.equal(body.frames.length,30);assert.equal(body.frames.filter(f=>f.jump).length,1);assert.equal(body.frames.at(-1).yaw,.47);const second=snapshot(3);second.players[0].seq=2;resolveSync(reply(second,2));await next;assert.equal(c.pending.length,0);assert.equal(c.batch,null);assert.equal(calls,2);c.dispose();
});

test('lost ACK while prediction held retries exact bytes and does not drain or duplicate the newer jump edge',async()=>{
 let now=0,resolveSync,firstBody,calls=0;const c=new MultiplayerClient(seat,async(path,init)=>{calls++;if(calls===1){firstBody=init.body;return await new Promise((r,reject)=>resolveSync=()=>reject(new Error('lost ACK')));}assert.equal(init.body,firstBody);const state=snapshot(2);state.players[0].seq=1;return reply(state,1);},()=>now);c.accept(snapshot(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const task=c.pump();for(let i=0;i<49;i++)c.predict({...move,jump:i===48});assert.equal(c.predictionHeld,true);now=900;resolveSync();await task;assert.equal(c.needsReconnect,false);assert.ok(c.batch);await c.pump();assert.equal(c.ack,1);assert.equal(c.predictionHeld,false);assert.equal(c.pending.length,30);assert.equal(c.pending.filter(f=>f.jump).length,0);assert.equal(calls,2);c.dispose();
});

test('suspension during timing-state await remains frozen after a late valid baseline and cannot re-enable input',async()=>{
 let now=0,resolveState;const c=new MultiplayerClient(seat,async(path)=>path.endsWith('/sync')?tooFast():await new Promise(r=>resolveState=r),()=>now);c.accept(snapshot(),0,true);c.predict(move);now=200;const task=c.pump();while(!resolveState)await tick();c.suspend();assert.equal(c.needsReconnect,true);resolveState(reply(snapshot(2)));await task;assert.equal(c.needsReconnect,true);const before=structuredClone(c.predicted);c.predict({...move,jump:true});assert.deepEqual(c.predicted,before);assert.equal(c.pending.length,0);c.dispose();
});

test('silent10second fetch times out from bounded hold, then ordinary authenticated recovery clears the hold',async()=>{
 let now=0,aborted=false;const state=snapshot(2);state.players[0].seq=1;const paths=[];
 const c=new MultiplayerClient(seat,async(path,init)=>{paths.push(path);if(path.endsWith('/reconnect'))return reply(state,1);if(paths.length>=3)return reply({...state,version:3,players:[{...state.players[0],seq:2}]},2);return await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;now=10200;reject(new DOMException('synthetic silent request timeout','AbortError'));},{once:true}));},()=>now);
 c.accept(snapshot(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const task=c.pump();for(let i=0;i<1000;i++)c.predict(move);assert.equal(c.predictionHeld,true);assert.equal(c.pending.length+c.batch.frames.length,60);assert.equal(c.needsReconnect,false);await task;assert.equal(aborted,true);assert.equal(c.busy,false);assert.equal(c.needsReconnect,true);assert.equal(c.ack,0);await c.recover();assert.equal(c.needsReconnect,false);assert.equal(c.predictionHeld,true);assert.equal(c.recovering,true);assert.equal(c.pending.length,0);assert.equal(c.batch,null);assert.equal(c.ack,1);assert.ok(paths.at(-1).endsWith('/reconnect'));c.predict(move);assert.equal(c.pending.length,0);now+=200;await c.pump();assert.equal(c.predictionHeld,false);assert.equal(c.recovering,false);assert.equal(c.ack,2);c.predict(move);assert.equal(c.pending.length,1);c.dispose();
});

test('authenticated state reads after explicit credit rejection cannot refresh movement credit or runner sequence',async t=>{
 const db=new SqliteD1();t.after(()=>db.close());let now=1000;
 const call=(path,body,token,teacher=false)=>handleMultiplayer(new Request(`https://credit.test/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://credit.test','Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{now,principal:teacher?{userId:'synthetic-teacher'}:null});
 const {code}=await(await call('rooms',{},null,true)).json();const joined=await(await call('join',{code,nickname:'Credit fixture',joinKey:'c'.repeat(64)})).json();await call('join',{code,nickname:'Other fixture',joinKey:'d'.repeat(64)});await call('control',{code,action:'start',revision:0,operationId:crypto.randomUUID()},null,true);
 now=1200;const rejected=await call('sync',{code,epoch:1,sequence:1,frames:Array.from({length:30},()=>({...move}))},joined.seatToken);assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'INPUT_TOO_FAST');
 const row=()=>db.sqlite.prepare('SELECT state_json,version FROM mp_seats WHERE id=?').get(joined.playerId);const before=row();for(let i=0;i<5;i++){now+=700;const res=await call('state',{code},joined.seatToken);assert.equal(res.status,200);assert.equal((await res.json()).ack,0);assert.deepEqual(row(),before);}const p=JSON.parse(before.state_json);assert.equal(p.seq,0);assert.ok(p.creditMs<=500);
});

test('delayed epoch baseline publishes cleared hold once and reuses the state send-start deadline',async()=>{
 let now=0,resolveSync,resolveState;const calls=[],changes=[];
 const c=new MultiplayerClient(seat,async(path,init)=>{calls.push({path,at:now});if(path.endsWith('/state'))return await new Promise(r=>resolveState=r);if(calls.length===1)return await new Promise(r=>resolveSync=r);const s=snapshot(3,2);s.snapshotMs=Math.floor(now);s.players[0].seq=1;return reply(s,1);},()=>now,()=>changes.push({held:c.predictionHeld,lastAttempt:c.lastAttempt,epoch:c.room?.epoch}));
 c.accept(snapshot(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const task=c.pump();for(let i=0;i<49;i++){now+=1000/60;c.predict(move);}assert.equal(c.predictionHeld,true);resolveSync(new Response(JSON.stringify({error:'STALE_EPOCH'}),{status:409}));while(!resolveState)await tick();const stateStarted=now;
 now+=700;const s=snapshot(2,2);s.snapshotMs=Math.floor(now);const priorChanges=changes.length;resolveState(reply(s));await task;
 assert.deepEqual({held:c.predictionHeld,lastAttempt:c.lastAttempt,notification:changes.at(-1)},{held:false,lastAttempt:stateStarted,notification:{held:false,lastAttempt:stateStarted,epoch:2}});
 assert.equal(changes.length,priorChanges+1);assert.equal(c.needsReconnect,false);assert.equal(c.pending.length,0);assert.equal(c.batch,null);
 c.predict(move);const count=calls.length;await c.pump();assert.equal(calls.length,count+1);assert.equal(c.ack,1);c.dispose();
});

for(const mode of ['suspended','disposed','stale-epoch','stale-version','wrong-player','wrong-ack'])test(`delayed epoch baseline ${mode} cannot clear the hold or publish a successful update`,async()=>{
 let now=0,resolveState,changes=0;const initial=snapshot(5,3);initial.snapshotMs=1000;
 const c=new MultiplayerClient(seat,async(path)=>path.endsWith('/sync')?new Response(JSON.stringify({error:'STALE_EPOCH'}),{status:409}):await new Promise(r=>resolveState=r),()=>now,()=>changes++);
 c.accept(initial,0,true);c.predict(move);now=200;const task=c.pump();while(!resolveState)await tick();c.predictionHeld=true;
 if(mode==='suspended')c.suspend();if(mode==='disposed')c.dispose();const before={changes,lastAttempt:c.lastAttempt,lastGood:c.lastGood,epoch:c.room.epoch,version:c.room.version};now+=700;
 const s=snapshot(6,4);s.snapshotMs=1500;let ack=0,playerId='p1';if(mode==='stale-epoch')s.epoch=2;if(mode==='stale-version'){s.epoch=3;s.version=4;}if(mode==='wrong-player')playerId='other';if(mode==='wrong-ack')ack=1;
 resolveState(reply(s,ack,playerId));await task;assert.equal(c.needsReconnect,true);assert.equal(c.predictionHeld,true);assert.equal(c.lastAttempt,before.lastAttempt);assert.equal(c.lastGood,before.lastGood);assert.equal(c.room.epoch,before.epoch);assert.equal(c.room.version,before.version);if(['suspended','disposed'].includes(mode))assert.equal(changes,before.changes);c.dispose();
});
