import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiplayerClient,joinRoom} from '../src/multiplayer/client.ts';
import {decodeRoom} from '../shared/multiplayer-wire.mjs';
import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {SqliteD1} from '../server/test/d1-sqlite.mjs';
const move={forward:1,right:0,yaw:0,jump:false,glide:false,slide:false};
async function fixture(t){
 const db=new SqliteD1();t.after(()=>db.close());let now=1000;
 const call=(path,body,token)=>handleMultiplayer(new Request(`https://game.test/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://game.test','Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{now,principal:{userId:'fixture-teacher'}});
 const created=await(await call('rooms',{})).json();const joined=await(await call('join',{code:created.code,nickname:'Recovery',joinKey:'ab'.repeat(32)})).json();
 await call('join',{code:created.code,nickname:'Other',joinKey:'cd'.repeat(32)});
 await call('control',{code:created.code,action:'start',revision:0,operationId:crypto.randomUUID()});
 const initial=await(await call('state',{code:created.code},joined.seatToken)).json();
 const paths=[];const client=new MultiplayerClient({code:created.code,seatToken:joined.seatToken,playerId:joined.playerId},async(path,init)=>{paths.push(path);return call(path.split('/').at(-1),JSON.parse(init.body),joined.seatToken);},()=>now);
 client.accept(decodeRoom(initial.room),0,true);
 return {client,paths,setNow:n=>{now=n;},call,code:created.code};
}
test('a lobby wait, long tab suspension and stale server seat recover automatically without replaying queued movement',async t=>{
 const f=await fixture(t),c=f.client;const spawn=c.predicted.z;
 // Empty heartbeats before entering do not consume movement or fill prediction.
 for(let i=1;i<=20;i++){f.setNow(1000+i*200);await c.pump();}
 assert.equal(c.pending.length,0);assert.equal(c.predicted.z,spawn);
 for(let i=0;i<12;i++)c.predict(move);
 c.suspend();assert.equal(c.pending.length,0);assert.equal(c.needsReconnect,true);
 f.setNow(20000);await c.recover();assert.equal(c.needsReconnect,false);assert.equal(c.predicted.z,spawn);assert.equal(c.batch,null);
 f.setNow(20200);for(let i=0;i<12;i++)c.predict(move);await c.pump();assert.ok(c.predicted.z<spawn);assert.equal(c.needsReconnect,false);
 // A server stale response also leads to recovery, without needing a click.
 f.setNow(24000);await c.pump();assert.equal(c.needsReconnect,true);await c.recover();assert.equal(c.needsReconnect,false);
});
test('a removed seat cannot auto reconnect or rejoin',async t=>{
 const f=await fixture(t),c=f.client;
 await f.call('control',{code:f.code,action:'remove',playerId:c.seat.playerId,revision:1,operationId:crypto.randomUUID()});
 f.setNow(1200);await c.pump();assert.equal(c.needsReconnect,true);const count=f.paths.length;
 f.setNow(10000);await c.recover();assert.equal(f.paths.length,count);assert.equal(c.needsReconnect,true);
});
test('failed automatic recovery backs off instead of spinning or overlapping requests',async t=>{
 const f=await fixture(t);let calls=0;const c=new MultiplayerClient(f.client.seat,async()=>{calls++;throw new TypeError('offline');},()=>now);let now=1000;
 c.accept(f.client.room,0,true);c.suspend();await c.recover();assert.equal(calls,1);
 now=1500;await c.recover();assert.equal(calls,1);now=3000;await c.recover();assert.equal(calls,2);
 now=4000;await c.recover();assert.equal(calls,2);assert.equal(c.needsReconnect,true);
});
test('a lost join response retries the identical key and keeps one durable seat',async t=>{
 const db=new SqliteD1();t.after(()=>db.close());const principal={userId:'fixture-teacher'};
 const call=(path,body)=>handleMultiplayer(new Request(`https://game.test/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://game.test','Content-Type':'application/json','X-Skybound-Wire':'3'},body:JSON.stringify(body)}),db,{now:1000,principal});
 const {code}=await(await call('rooms',{})).json();let calls=0,first;
 const result=await joinRoom({code,nickname:'Retry',joinKey:'ef'.repeat(32)},async(path,init)=>{calls++;if(!first)first=init.body;assert.equal(init.body,first);const res=await call('join',JSON.parse(init.body));if(calls===1)throw new TypeError('lost response');return res;});
 assert.equal(calls,2);assert.equal(result.room.players.length,1);assert.ok(result.seatToken);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM mp_seats').get().n,1);
});
test('join waits for a slow response and does not retry permanent room errors',async()=>{
 const result=await joinRoom({},async(path,init)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1700);init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('too short'));});});return new Response(JSON.stringify({joined:true}));});assert.equal(result.joined,true);
 let calls=0;await assert.rejects(joinRoom({},async()=>{calls++;return new Response(JSON.stringify({error:'ROOM_LOCKED'}),{status:403});}),/ROOM_LOCKED/);assert.equal(calls,1);
});
test('the production driver automatically recovers a frozen client without a reconnect click',async t=>{
 const {createPumpDriver}=await import('../src/multiplayer/pump.ts');const f=await fixture(t);f.client.suspend();
 let callback;const driver=createPumpDriver(()=>f.client,()=>true,{clock:()=>20000,setTimer(fn){callback=fn;return 1;},clearTimer(){}});t.after(()=>driver.stop());
 f.setNow(20000);callback();await driver.whenIdle();assert.equal(f.client.needsReconnect,false);assert.ok(f.paths.at(-1).endsWith('/reconnect'));assert.equal(f.client.pending.length,0);
});

for(const moving of [false,true]) test(`reconnect overtaking a still-unapplied ${moving?'movement':'empty'} sync cannot poison the next client sequence`,async t=>{
 const f=await fixture(t),c=f.client,original=c.fetcher;let release;
 t.after(()=>c.dispose());
 c.fetcher=async(...args)=>{if(args[0].endsWith('/sync')&&!release)await new Promise(resolve=>{release=resolve;});return original(...args);};
 f.setNow(1200);if(moving)for(let i=0;i<6;i++)c.predict(move);const old=c.pump();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.setNow(1400);await c.reconnect();const ack=c.ack,pose=[c.predicted.x,c.predicted.y,c.predicted.z];
 assert.equal(c.needsReconnect,false);release();await old;assert.equal(c.ack,ack);
 assert.deepEqual([c.predicted.x,c.predicted.y,c.predicted.z],pose);
 f.setNow(1600);for(let i=0;i<6;i++)c.predict(move);await c.pump();
 assert.equal(c.needsReconnect,false,c.message);assert.equal(c.ack,ack+1);assert.equal(c.pending.length,0);
 assert.equal(c.room.players.filter(p=>p.id===c.seat.playerId).length,1);
});

import {readFileSync} from 'node:fs';import vm from 'node:vm';
function observeActualMapRelease(client){const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const guard=source.match(/if\(client\?\.needsReconnect\)\{release\(\);say\(client\.message\);\}/)?.[0];assert.ok(guard);let releases=0;const context=vm.createContext({client,release:()=>{releases++;},say(){}});client.changed=()=>vm.runInContext(guard,context);return()=>releases;}
test('successful bounded timing rebase does not falsely release the map UI',async t=>{const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);f.setNow(1200);for(let i=0;i<30;i++)c.predict(move);await c.pump();assert.equal(c.budgetRebases,1);assert.equal(c.needsReconnect,false);assert.equal(c.pending.length,0);assert.equal(count(),0);});
test('failed reconnect still publishes frozen state to the actual map-release guard',async t=>{const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);c.fetcher=async()=>new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403});await assert.rejects(c.reconnect(),/SEAT_REMOVED/);assert.equal(c.needsReconnect,true);assert.ok(count()>0);const before=structuredClone(c.predicted);c.predict(move);assert.deepEqual(c.predicted,before);});
