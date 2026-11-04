import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {createRoomState,createPlayer} from '../shared/multiplayer.mjs';
const input={forward:1,right:0,yaw:0,jump:false,glide:false,slide:false};
function setup(error='SEAT_REMOVED',status=403){let now=1000,calls=0;const room={...createRoomState({now}),code:'ABC123',status:'running',epoch:1,version:1,serverTime:now,players:[{...createPlayer('red'),id:'runner',nickname:'Runner',active:true,connected:true,lastSeenMs:now,seq:0}],viewerPlayerId:'runner'};const c=new MultiplayerClient({code:'ABC123',playerId:'runner',seatToken:'private-seat'},async()=>{calls++;return new Response(JSON.stringify({error}),{status});},()=>now);c.accept(room,0,true);return {c,setNow:n=>now=n,calls:()=>calls};}
test('a revoked seat discards old rendered position and queued movement, with no misleading manual retry',async()=>{const f=setup(),c=f.c;for(let i=0;i<12;i++)c.predict(input);f.setNow(1200);await c.pump();assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.pending.length,0);assert.equal(c.batch,null);assert.equal(c.recovering,false);const calls=f.calls();await c.reconnect();await c.recover();f.setNow(30000);await c.pump();assert.equal(f.calls(),calls);});

import {membershipIssueFor,membershipNotice,forgetMatchingSeat} from '../src/multiplayer/membership.ts';
import {NetworkError} from '../src/multiplayer/client.ts';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
for(const [code,status,issue] of [['SEAT_REMOVED',403,'seat-removed'],['SEAT_REVOKED',403,'seat-removed'],['SEAT_NOT_IN_ROOM',403,'seat-invalid'],['ROOM_EXPIRED',410,'room-expired'],['ROOM_NOT_FOUND',404,'room-missing'],['ROOM_VERSION_RETIRED',409,'room-retired']]){
 test(`${code} is a permanent membership outcome during sync and direct restore`,async()=>{
  for(const stage of ['sync','reconnect']){const f=setup(code,status),c=f.c;f.setNow(1200);if(stage==='sync')await c.pump();else await assert.rejects(c.reconnect(),new RegExp(code));assert.equal(c.membershipIssue,issue);assert.equal(c.busy,false);assert.equal(c.predicted,null);assert.match(c.message,/teacher/);const calls=f.calls();c.suspend();await c.reconnect();await c.recover();c.predict(input);assert.equal(c.pending.length,0);assert.equal(c.recovering,false);assert.equal(f.calls(),calls);assert.equal(c.accept({...c.room,version:10},0,true),false);assert.equal(c.predicted,null);}
 });
}
test('unknown server errors, transport failures and automatic recovery do not discard a saved membership',async()=>{
 for(const code of ['RECONNECT_REQUIRED','INPUT_TOO_FAST','ROOM_BUSY','SERVICE_UNAVAILABLE','INVALID_AUTHORITATIVE_BASELINE'])assert.equal(membershipIssueFor(new NetworkError(409,code)),null);
 assert.equal(membershipIssueFor(new Error('SEAT_REMOVED')),null);assert.equal(membershipIssueFor(new NetworkError(500,'SEAT_REMOVED')),null);
 const f=setup('SERVICE_UNAVAILABLE',503);f.setNow(1200);await f.c.pump();assert.equal(f.c.membershipIssue,null);assert.ok(f.c.predicted);
});
test('an authoritative missing runner clears old movement without accepting a later baseline',()=>{const f=setup(),c=f.c;const old=c.room;c.predict(input);assert.equal(c.accept({...old,players:[],version:2},1),false);assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.accept({...old,version:3},2),false);});
for(const stage of ['INPUT_TOO_FAST','STALE_EPOCH'])test(`membership rejection during ${stage} state recovery does not keep stale position or retry`,async()=>{
 const f=setup(),c=f.c;let calls=0;c.fetcher=async(path)=>{calls++;return new Response(JSON.stringify({error:path.endsWith('/sync')?stage:'SEAT_REMOVED'}),{status:path.endsWith('/sync')?409:403});};c.predict(input);f.setNow(1200);await c.pump();assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.pending.length,0);assert.equal(c.batch,null);assert.equal(c.predicted,null);assert.equal(c.busy,false);await c.reconnect();await c.recover();assert.equal(calls,2);
});
test('a late valid sync cannot restore membership after a newer reconnect rejection',async()=>{
 const f=setup(),c=f.c;let resolve;const baseline=c.room;c.fetcher=async(path)=>path.endsWith('/sync')?new Promise(r=>resolve=r):new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403});c.predict(input);f.setNow(1200);const sync=c.pump();while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(c.reconnect(),/SEAT_REMOVED/);resolve(new Response(JSON.stringify({room:baseline,ack:1,playerId:'runner'})));await sync;assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.pending.length,0);assert.equal(c.busy,false);
});
test('seat cleanup is exact and cannot erase a newer room, player or token',()=>{
 const seat={code:'ABC123',playerId:'runner',seatToken:'private-seat'};let removed=0,value=JSON.stringify(seat);const storage={getItem:()=>value,removeItem:()=>removed++};assert.equal(forgetMatchingSeat(storage,'saved',seat),true);assert.equal(removed,1);
 for(const changed of [{code:'OTHER1'},{playerId:'other'},{seatToken:'new-secret'}]){value=JSON.stringify({...seat,...changed});assert.equal(forgetMatchingSeat(storage,'saved',seat),false);}value='{';assert.equal(forgetMatchingSeat(storage,'saved',seat),false);assert.equal(forgetMatchingSeat({getItem(){throw Error('blocked');},removeItem(){}},'saved',seat),false);assert.equal(removed,1);
});
test('the actual terminal view clears old roster, gameplay and reconnect UI and provides a single return path',()=>{
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8'),start=source.indexOf('function displayMembershipIssue()'),end=source.indexOf('function updateConnectionMessage()',start),nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'old',replaceChildren(){this.cleared=true;}});return nodes.get(id);};let clears=0,releases=0,forgot=0;
 const context={client:{membershipIssue:'seat-removed',seat:{code:'ABC123'}},release:()=>releases++,graphics:{clear:()=>clears++},room:{players:['old']},rosterKey:'old',forgetMatchingSeat:()=>forgot++,sessionStorage:{},STORAGE:'saved',membershipNotice,$,entry:{hidden:false},roomPanel:{hidden:false},lobby:{hidden:true},hud:{hidden:false},play:{hidden:false},reconnect:{hidden:false},say:message=>context.notice=message,updateConnectionMessage(){},updateConnectionDetails(){},beginView(){},entrySteps:{show(){}}};
 vm.runInNewContext(source.slice(start,end),context);context.displayMembershipIssue();assert.equal(context.room,null);assert.equal(context.entry.hidden,true);assert.equal(context.roomPanel.hidden,true);assert.equal($('membership-panel').hidden,false);assert.equal($('roster').cleared,true);assert.equal($('zone-list').cleared,true);assert.equal($('score').hidden,true);assert.equal(context.play.hidden,true);assert.equal(context.reconnect.hidden,true);assert.equal($('restore').hidden,true);assert.equal(releases,1);assert.equal(clears,1);assert.equal(forgot,1);assert.match($('membership-title').textContent,/removed/);assert.match(context.notice,/no longer/);
 const html=readFileSync(new URL('../multiplayer/index.html',import.meta.url),'utf8');for(const id of ['membership-panel','membership-title','membership-message','membership-back'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))??[]).length,1);assert.match(html,/id="membership-panel"[^>]*hidden[^>]*aria-labelledby="membership-title"/);
});

import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {SqliteD1} from '../server/test/d1-sqlite.mjs';
import {decodeRoom} from '../shared/multiplayer-wire.mjs';
test('real teacher removal reaches terminal UI state and cannot recover the revoked seat',async t=>{
 const db=new SqliteD1();t.after(()=>db.close());let now=1000,calls=0;
 const call=(path,body,token)=>handleMultiplayer(new Request(`https://game.test/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://game.test','Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{now,principal:{userId:'fixture-teacher'}});
 const created=await(await call('rooms',{})).json();const joined=await(await call('join',{code:created.code,nickname:'Runner',joinKey:'ab'.repeat(32)})).json();await call('join',{code:created.code,nickname:'Other',joinKey:'cd'.repeat(32)});await call('control',{code:created.code,action:'start',revision:0,operationId:crypto.randomUUID()});const initial=await(await call('state',{code:created.code},joined.seatToken)).json();
 const client=new MultiplayerClient({code:created.code,playerId:joined.playerId,seatToken:joined.seatToken},async(path,init)=>{calls++;return call(path.split('/').at(-1),JSON.parse(init.body),joined.seatToken);},()=>now);client.accept(decodeRoom(initial.room),0,true);for(let i=0;i<10;i++)client.predict(input);
 const removed=await call('control',{code:created.code,action:'remove',playerId:joined.playerId,revision:1,operationId:crypto.randomUUID()});assert.equal(removed.status,200);now=1200;await client.pump();assert.equal(client.membershipIssue,'seat-removed');assert.equal(client.predicted,null);assert.equal(client.pending.length,0);assert.equal(client.batch,null);assert.equal(client.busy,false);now=30000;await client.reconnect();await client.recover();assert.equal(calls,1);
 const rejected=await call('reconnect',{code:created.code},joined.seatToken);assert.equal(rejected.status,403);assert.equal((await rejected.json()).error,'SEAT_REMOVED');
});

import {stripTypeScriptTypes} from 'node:module';
test('actual restored-client callback shows terminal membership without a prior room snapshot, but ignores obsolete views',()=>{
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8'),code=source.slice(source.indexOf('function useClient('),source.indexOf('async function loadTeacherRooms('));let issues=0,rooms=0,wakes=0,viewCode='ABC123';
 class FakeClient{room=null;membershipIssue=null;constructor(seat,fetcher,clock,changed){Object.assign(this,{seat,changed});}dispose(){this.disposed=true;}accept(){}}
 const context={client:null,teacher:true,previousEpoch:4,MultiplayerClient:FakeClient,fetch(){},performance:{now:()=>1000},view:{capture:()=>({code:viewCode})},displayMembershipIssue:()=>issues++,displayRoom:()=>rooms++,saveSeat(){},network:{wake:()=>wakes++}};
 vm.runInNewContext(stripTypeScriptTypes(code),context);context.useClient({code:'ABC123',playerId:'runner',seatToken:'secret'});const first=context.client;first.membershipIssue='seat-removed';first.changed();assert.equal(issues,1);assert.equal(rooms,0);assert.equal(first.room,null);assert.equal(wakes,1);
 viewCode='OTHER1';first.changed();assert.equal(issues,1);viewCode='ABC123';context.useClient({code:'ABC123',playerId:'new',seatToken:'new-secret'});first.changed();assert.equal(issues,1);context.client.room={code:'ABC123'};context.client.changed();assert.equal(rooms,1);
});
for(const lifecycle of ['deadline','suspend','dispose','replaced-view'])test(`definitive delayed membership rejection after ${lifecycle} tightens only its current generation`,async()=>{
 const f=setup(),c=f.c;let settle,calls=0;c.fetcher=async()=>{calls++;if(calls===1)return await new Promise(r=>settle=r);return new Response(JSON.stringify({error:'SERVICE_UNAVAILABLE'}),{status:503});};f.setNow(2400);c.predict(input);assert.equal(c.recovering,true);f.setNow(2600);const task=c.recover();while(!settle)await new Promise(r=>setImmediate(r));
 if(lifecycle==='deadline'){f.setNow(12401);c.predict(input);assert.match(c.message,/timed out/);}if(lifecycle==='suspend')c.suspend();if(lifecycle==='dispose')c.dispose();if(lifecycle==='replaced-view'){c.dispose();} // Replaced views dispose the old generation.
 settle(new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403}));await task;
 if(lifecycle==='deadline'||lifecycle==='suspend'){assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.pending.length,0);}else assert.equal(c.membershipIssue,null);
});
for(const lifecycle of ['already-expired','expires-on-reply'])test(`an outer sync rejection ${lifecycle} still clears permanently revoked membership`,async()=>{
 const f=setup(),c=f.c;let settle;c.fetcher=async()=>new Promise(r=>settle=r);c.predict(input);f.setNow(1200);const task=c.pump();while(!settle)await new Promise(r=>setImmediate(r));f.setNow(2400);c.predict(input);f.setNow(12401);if(lifecycle==='already-expired')c.predict(input);settle(new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403}));await task;assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.busy,false);
});
for(const stage of ['INPUT_TOO_FAST','STALE_EPOCH'])test(`a delayed ${stage} state rejection tightens an expired lifecycle`,async()=>{
 const f=setup(),c=f.c;let settle;c.fetcher=async(path)=>path.endsWith('/sync')?new Response(JSON.stringify({error:stage}),{status:409}):new Promise(r=>settle=r);c.predict(input);f.setNow(1200);const task=c.pump();while(!settle)await new Promise(r=>setImmediate(r));f.setNow(2400);c.predict(input);f.setNow(12401);c.predict(input);settle(new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403}));await task;assert.equal(c.membershipIssue,'seat-removed');assert.equal(c.predicted,null);assert.equal(c.busy,false);
});
