import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiplayerClient,joinRoom} from '../src/multiplayer/client.ts';
import {decodeRoom,encodeRoom} from '../shared/multiplayer-wire.mjs';
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
function observeActualMapRelease(client){const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const guard=source.match(/if\(client\?\.needsReconnect&&!client\.recovering\)\{release\(\);say\(client\.message\);\}/)?.[0];assert.ok(guard);let releases=0;const context=vm.createContext({client,release:()=>{releases++;},say(){}});client.changed=()=>vm.runInContext(guard,context);return()=>releases;}
test('successful bounded timing rebase does not falsely release the map UI',async t=>{const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);f.setNow(1200);for(let i=0;i<30;i++)c.predict(move);await c.pump();assert.equal(c.budgetRebases,1);assert.equal(c.needsReconnect,false);assert.equal(c.pending.length,0);assert.equal(count(),0);});
test('failed reconnect still publishes frozen state to the actual map-release guard',async t=>{const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);c.fetcher=async()=>new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403});await assert.rejects(c.reconnect(),/SEAT_REMOVED/);assert.equal(c.needsReconnect,true);assert.ok(count()>0);const before=structuredClone(c.predicted);c.predict(move);assert.deepEqual(c.predicted,before);});

test('stale authority recovers visibly on-map with no actions until a fresh empty sync, then resumes',async t=>{
 const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);t.after(()=>c.dispose());
 f.setNow(2400);await c.pump();assert.equal(c.needsReconnect,true);assert.equal(c.recovering,true);assert.match(c.message,/Reconnecting/);assert.equal(count(),0);
 const before=structuredClone(c.predicted);c.predict({...move,jump:true});assert.deepEqual(c.predicted,before);
 f.setNow(2600);await c.recover();assert.equal(c.needsReconnect,false);assert.equal(c.recovering,true);assert.equal(c.pending.length,0);c.predict(move);assert.equal(c.pending.length,0);assert.match(c.message,/checking live room/);
 f.setNow(2800);await c.pump();assert.equal(c.recovering,false);assert.equal(c.needsReconnect,false);assert.equal(count(),0);assert.deepEqual([c.predicted.x,c.predicted.z],[before.x,before.z]);c.predict(move);assert.equal(c.pending.length,1);
});

for(const action of ['deadline','suspend','dispose'])test(`a ${action} during reconnect rejects its late baseline and cannot revive movement`,async t=>{
 const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);t.after(()=>c.dispose());f.setNow(2400);await c.pump();
 let resolve;const original=c.fetcher;c.fetcher=async(...args)=>{await new Promise(r=>resolve=r);return original(...args);};f.setNow(2600);const request=c.recover();while(!resolve)await new Promise(r=>setImmediate(r));const ack=c.ack;
 if(action==='deadline'){f.setNow(12401);c.predict(move);assert.equal(c.recovering,false);assert.match(c.message,/timed out/);assert.ok(count()>0);}
 if(action==='suspend')c.suspend();if(action==='dispose')c.dispose();resolve();await request;assert.equal(c.needsReconnect,true);assert.equal(c.ack,ack);c.predict(move);assert.equal(c.pending.length,0);
});

test('revocation during bounded recovery terminates automatic attempts and releases the actual UI guard',async t=>{
 const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);t.after(()=>c.dispose());f.setNow(2400);await c.pump();assert.equal(count(),0);
 await f.call('control',{code:f.code,action:'remove',playerId:c.seat.playerId,revision:1,operationId:crypto.randomUUID()});f.setNow(2600);await c.recover();assert.equal(c.recovering,false);assert.equal(c.needsReconnect,true);assert.ok(count()>0);const calls=f.paths.length;f.setNow(30000);await c.recover();assert.equal(f.paths.length,calls);
});

for(const outcome of ['success','rejection'])test(`late timing-state ${outcome} after suspension preserves frozen lifecycle exactly`,async t=>{
 const f=await fixture(t),c=f.client;t.after(()=>c.dispose());let settle;
 c.fetcher=async(path)=>path.endsWith('/sync')?new Response(JSON.stringify({error:'INPUT_TOO_FAST'}),{status:409}):await new Promise((resolve,reject)=>settle={resolve,reject});
 f.setNow(1200);c.predict(move);const task=c.pump();while(!settle)await new Promise(r=>setImmediate(r));c.suspend();const before={ack:c.ack,room:structuredClone(c.room),message:c.message,lastAttempt:c.lastAttempt,lastGood:c.lastGood};
 if(outcome==='success')settle.resolve(await f.call('state',{code:f.code},c.seat.seatToken));else settle.reject(new TypeError('late state rejection'));await task;
 for(const [key,value]of Object.entries(before))assert.deepEqual(c[key],value,key);assert.equal(c.needsReconnect,true);assert.equal(c.pending.length,0);
});

test('late reconnect rejection after recovery deadline preserves the terminal timeout and does not retry',async t=>{
 const f=await fixture(t),c=f.client;t.after(()=>c.dispose());f.setNow(2400);await c.pump();let reject,calls=0;c.fetcher=async()=>{calls++;return await new Promise((_,r)=>reject=r);};f.setNow(2600);const task=c.recover();while(!reject)await new Promise(r=>setImmediate(r));f.setNow(12401);c.predict(move);const message=c.message;reject(new TypeError('late offline rejection'));await task;assert.equal(c.message,message);assert.match(message,/timed out/);f.setNow(30000);await c.recover();assert.equal(calls,1);assert.equal(c.recovering,false);assert.equal(c.needsReconnect,true);
});

test('explicit manual retry after terminal recovery failure starts fresh, never revives the old deadline',async t=>{
 const f=await fixture(t),c=f.client;t.after(()=>c.dispose());const original=c.fetcher;f.setNow(2400);await c.pump();c.fetcher=async()=>new Response(JSON.stringify({error:'SEAT_REMOVED'}),{status:403});f.setNow(2600);await c.recover();assert.equal(c.recovering,false);assert.equal(c.needsReconnect,true);
 c.fetcher=original;f.setNow(30000);await c.reconnect();assert.equal(c.needsReconnect,false);assert.equal(c.recovering,false);c.predict(move);assert.equal(c.needsReconnect,false);assert.equal(c.pending.length,1);
});

for(const outcome of ['success','rejection'])test(`late epoch-state ${outcome} after on-map deadline preserves terminal lifecycle`,async t=>{
 const f=await fixture(t),c=f.client;t.after(()=>c.dispose());f.setNow(2400);await c.pump();f.setNow(2600);await c.recover();assert.equal(c.recovering,true);let settle;
 c.fetcher=async(path)=>path.endsWith('/sync')?new Response(JSON.stringify({error:'STALE_EPOCH'}),{status:409}):await new Promise((resolve,reject)=>settle={resolve,reject});f.setNow(2800);const task=c.pump();while(!settle)await new Promise(r=>setImmediate(r));f.setNow(12401);c.predict(move);const before={ack:c.ack,room:structuredClone(c.room),message:c.message,lastGood:c.lastGood};
 if(outcome==='success')settle.resolve(await f.call('state',{code:f.code},c.seat.seatToken));else settle.reject(new TypeError('late epoch state rejection'));await task;for(const [key,value]of Object.entries(before))assert.deepEqual(c[key],value,key);assert.equal(c.needsReconnect,true);assert.equal(c.recovering,false);
});

for(const kind of ['unsupported-wire','missing-room','wrong-ack'])test(`invalid sync ${kind} is terminal without predicting or retrying`,async t=>{
 const f=await fixture(t),c=f.client;t.after(()=>c.dispose());let calls=0;const own=structuredClone(c.room);c.fetcher=async()=>{calls++;return new Response(JSON.stringify(kind==='unsupported-wire'?{room:{wireVersion:999},ack:1,playerId:c.seat.playerId}:kind==='missing-room'?{ack:1,playerId:c.seat.playerId}:{room:encodeRoom({...own,teacher:false},c.seat.playerId),ack:999,playerId:c.seat.playerId}));};f.setNow(1200);c.predict(move);await c.pump();assert.equal(c.needsReconnect,true);assert.equal(c.recovering,false);const before=structuredClone(c.predicted),queued=c.pending.length;c.predict({...move,jump:true});assert.deepEqual(c.predicted,before);assert.equal(c.pending.length,queued);f.setNow(30000);await c.recover();assert.equal(calls,1);
});

test('repeated reconnect success without a healthy live sync never renews the on-map recovery deadline',async t=>{
 const f=await fixture(t),c=f.client,count=observeActualMapRelease(c);t.after(()=>c.dispose());const original=c.fetcher;let reconnects=0;c.fetcher=async(...args)=>{if(args[0].endsWith('/sync'))return new Response(JSON.stringify({error:'RECONNECT_REQUIRED'}),{status:409});reconnects++;return original(...args);};f.setNow(2400);await c.pump();
 for(let i=0;i<10;i++){f.setNow(2600+i*1000);await c.recover();assert.equal(c.recovering,true);f.setNow(2800+i*1000);await c.pump();assert.equal(c.recovering,true);assert.equal(count(),0);}
 f.setNow(12401);await c.recover();assert.equal(c.recovering,false);assert.equal(c.needsReconnect,true);assert.match(c.message,/timed out/);assert.ok(count()>0);f.setNow(30000);await c.recover();assert.equal(reconnects,10);
});

test('actual manual reconnect UI never announces connected when a cancelled or expired request resolves without recovery',async()=>{
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8'),line=source.split('\n').find(l=>l.startsWith('reconnect.onclick='));const messages=[],button={disabled:false},client={seat:{code:'ROOM12'},needsReconnect:true,recovering:false,message:'Connection recovery timed out.',async reconnect(){}};
 const context=vm.createContext({client,reconnect:button,view:{begin:()=>({}),accepts:()=>true},network:{wake(){}},say:x=>messages.push(x),readable:String});vm.runInContext(line,context);await button.onclick();assert.deepEqual(messages,[client.message]);assert.equal(button.disabled,false);
});
