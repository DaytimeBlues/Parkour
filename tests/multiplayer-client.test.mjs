import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {MultiplayerClient,api} from '../src/multiplayer/client.ts';
import {foxFactory} from '../src/multiplayer/avatar.ts';
import {encodeRoom,decodeRoom} from '../shared/multiplayer-wire.mjs';
import {createPlayer,stepPlayer} from '../shared/multiplayer.mjs';
const seat={code:'FORT12',seatToken:'opaque-seat-token',playerId:'p1'};
const move={forward:1,right:0,yaw:0,jump:false,glide:false,slide:false};
function room(version=1,epoch=1){return {code:seat.code,status:'running',epoch,version,remainingMs:300000,durationMs:300000,scores:{red:0,blue:0},zones:[],players:[{...createPlayer('red'),id:'p1',nickname:'Fox',active:true,connected:true,lastSeenMs:0,seq:0}],serverTime:0,locked:false};}
const response=(body,status=200)=>new Response(JSON.stringify(body.room?{...body,room:encodeRoom({...body.room,snapshotMs:body.room.snapshotMs??body.room.serverTime,controlRevision:body.room.controlRevision??0,winner:body.room.winner??null,teacher:false},seat.playerId)}:body),{status,headers:{'Content-Type':'application/json'}});
test('client predicts immediately, sends only bounded input frames, and replays unacknowledged movement after server correction',async()=>{
 let now=0,resolve,request;
 const initial=room(),client=new MultiplayerClient(seat,async(path,init)=>{request={path,init};return await new Promise(r=>resolve=r);},()=>now);
 client.accept(initial,0,true);const start=client.predicted.z;
 for(let n=0;n<12;n++)client.predict(move);assert.ok(client.predicted.z<start);
 now=200;const pending=client.pump();assert.equal(client.busy,true);
 for(let n=0;n<3;n++)client.predict(move);
 const body=JSON.parse(request.init.body);assert.deepEqual(Object.keys(body).sort(),['code','epoch','frames','sequence']);assert.equal(body.frames.length,12);assert.equal(request.init.headers['X-Skybound-Seat'],seat.seatToken);assert.ok(!request.init.body.includes(seat.seatToken));
 const authoritative=room(2);for(const input of body.frames)stepPlayer(authoritative.players[0],input,1/60);authoritative.players[0].x+=.2;authoritative.players[0].seq=1;
 const expected=structuredClone(authoritative.players[0]);for(let i=0;i<3;i++)stepPlayer(expected,move,1/60);
 resolve(response({room:authoritative,ack:1,playerId:'p1'}));await pending;assert.equal(client.ack,1);assert.equal(client.pending.length,3);assert.equal(client.predicted.x,expected.x);assert.equal(client.predicted.z,expected.z);
});
test('lost acknowledgment retries byte-identical batch, without resending newer frames or double applying',async()=>{
 let now=0,calls=0,first,receipt;const authoritative=room();
 const client=new MultiplayerClient(seat,async(path,init)=>{calls++;const b=JSON.parse(init.body);if(calls===1){first=init.body;for(const frame of b.frames)stepPlayer(authoritative.players[0],frame,1/60);authoritative.version++;receipt={room:authoritative,ack:b.sequence,playerId:'p1'};throw new Error('lost response');}assert.equal(init.body,first);return response(receipt);},()=>now);
 client.accept(room(),0,true);for(let i=0;i<12;i++)client.predict(move);now=200;await client.pump();assert.equal(client.ack,0);assert.ok(client.batch);for(let i=0;i<6;i++)client.predict(move);now=400;await client.pump();assert.equal(client.ack,1);assert.equal(client.pending.length,6);assert.equal(calls,2);
});
test('one request stays in flight; 5 Hz gate and 30-frame maximum are enforced',async()=>{
 let now=0,calls=0,resolve;const client=new MultiplayerClient(seat,async(path,init)=>{calls++;assert.equal(JSON.parse(init.body).frames.length,30);return await new Promise(r=>resolve=r);},()=>now);client.accept(room(),0,true);for(let i=0;i<45;i++)client.predict(move);now=200;const pending=client.pump();now=250;await client.pump();assert.equal(calls,1);resolve(response({room:room(2),ack:1,playerId:'p1'}));await pending;now=350;await client.pump();assert.equal(calls,1);
});
test('queue and stale-response bounds freeze prediction instead of replaying a long offline backlog',()=>{
 let now=0;const client=new MultiplayerClient(seat,fetch,()=>now);client.accept(room(),0,true);for(let i=0;i<60;i++)client.predict(move);const before=client.predicted.z;client.predict(move);assert.equal(client.pending.length,60);assert.equal(client.predicted.z,before);assert.equal(client.needsReconnect,true);
 const stale=new MultiplayerClient(seat,fetch,()=>now);stale.accept(room(),0,true);now=1001;stale.predict(move);assert.equal(stale.needsReconnect,true);assert.equal(stale.pending.length,0);
});
test('stale epoch rejection discards old batch and pending frames then rebases without replay',async()=>{
 let now=0,paths=[];const changed=room(9,2);changed.status='paused';changed.players[0].seq=3;
 const client=new MultiplayerClient(seat,async(path)=>{paths.push(path);return path.endsWith('/sync')?response({error:'STALE_EPOCH'},409):response({room:changed});},()=>now);client.accept(room(),0,true);for(let i=0;i<12;i++)client.predict(move);now=200;await client.pump();assert.equal(client.ack,3);assert.equal(client.pending.length,0);assert.equal(client.batch,null);assert.equal(client.room.epoch,2);assert.equal(client.predicted.z,changed.players[0].z);assert.equal(paths.length,2);
});
test('reconnect uses authoritative sequence and movement, clears uncertain work and ignores late old response',async()=>{
 let now=200,resolve;const changed=room(5);changed.players[0].seq=8;changed.players[0].x=15;
 const client=new MultiplayerClient(seat,async(path)=>path.endsWith('/sync')?await new Promise(r=>resolve=r):response({room:changed,ack:8,playerId:'p1'}),()=>now);client.accept(room(),0,true);client.predict(move);now=400;const old=client.pump();await client.reconnect();resolve(response({room:room(2),ack:1,playerId:'p1'}));await old;assert.equal(client.ack,8);assert.equal(client.predicted.x,15);assert.equal(client.pending.length,0);assert.equal(client.needsReconnect,false);
});
test('removed seat and server reconnect-required response stop participation',async()=>{
 let now=200;const client=new MultiplayerClient(seat,async()=>response({error:'RECONNECT_REQUIRED'},409),()=>now);client.accept(room(),0,true);now=400;await client.pump();assert.equal(client.needsReconnect,true);
 const removed=room(3);removed.players=[];client.accept(removed,1);assert.equal(client.predicted,null);assert.match(client.message,/removed/);
});
test('obsolete snapshots cannot rewind the room or acknowledged sequence',()=>{const c=new MultiplayerClient(seat);c.accept(room(8),9,true);c.accept(room(4),2);assert.equal(c.room.version,8);assert.equal(c.ack,9);});
test('fox crouch fits below 0.85m; original red triangle and blue square markers differ; geometry/materials reused',()=>{
 const factory=foxFactory(),red=factory.create('red'),blue=factory.create('blue');
 red.pose(1,3,true,false,true);red.root.updateMatrixWorld(true);const body=red.root.children[0];const bounds=new THREE.Box3().setFromObject(body);assert.ok(bounds.max.y<=.85,`crouch height ${bounds.max.y}`);assert.ok(bounds.min.y>=-.02);assert.equal(red.root.children[2].visible,false);
 red.pose(1,3,true,false,false);assert.equal(red.root.children[2].geometry.parameters.radialSegments,3);assert.equal(blue.root.children[2].geometry.type,'BoxGeometry');assert.equal(red.root.children[0].children[0].geometry,blue.root.children[0].children[0].geometry);factory.dispose();
});
test('markup keeps anonymous entry and teacher identity separate; radar source filters enemies and join key is saved before request',()=>{
 const html=readFileSync(new URL('../multiplayer/index.html',import.meta.url),'utf8'),main=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8'),scene=readFileSync(new URL('../src/multiplayer/scene.ts',import.meta.url),'utf8');assert.match(html,/signin-with-chatgpt\?return_to=\/game\/multiplayer\//);assert.match(html,/target="_top"/);assert.match(main,/sessionStorage.setItem\(JOIN_DRAFT/);assert.match(main,/\.\.\.joinIntent\(code,nickname\)/);assert.match(scene,/p.team!==own.team\|\|p.connected===false/);assert.doesNotMatch(scene,/nickname/);assert.match(main,/createPumpDriver\(\(\)=>client,\(\)=>!document.hidden\)/);
});

test('real client exchanges with production API and migrated SQLite: movement, uncertain acknowledgment, epoch pause and explicit stale reconnect',async(t)=>{
 const {handleMultiplayer}=await import('../server/lib/multiplayer.mjs');const {SqliteD1}=await import('../server/test/d1-sqlite.mjs');const db=new SqliteD1();t.after(()=>db.close());let now=1800000000000,loseNext=false;const controlRevisions=new Map();
 const call=async(path,body,token,principal=null)=>{if(path==='control')body={...body,revision:controlRevisions.get(body.code)??0,operationId:crypto.randomUUID()};const request=new Request(`https://skybound.example/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://skybound.example','Content-Type':'application/json',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)});const result=await handleMultiplayer(request,db,{now,principal});const parsed=await result.clone().json();if(parsed.room)controlRevisions.set(parsed.room.code,parsed.room.controlRevision);return result;};
 const created=await (await call('rooms',{durationSeconds:300},null,{userId:'teacher'})).json();assert.ok(created.code);
 const joined=await (await call('join',{code:created.code,nickname:'Fox',joinKey:'ab'.repeat(32)})).json();assert.ok(joined.seatToken);
 await call('join',{code:created.code,nickname:'Owl',joinKey:'cd'.repeat(32)});
 assert.equal((await call('control',{code:created.code,action:'start'},null,{userId:'teacher'})).status,200);
 const state=await (await call('state',{code:created.code},joined.seatToken)).json();
 const realSeat={code:created.code,seatToken:joined.seatToken,playerId:joined.playerId};
 const client=new MultiplayerClient(realSeat,async(path,init)=>{const response=await call(path.split('/').at(-1),JSON.parse(init.body),init.headers['X-Skybound-Seat']);if(loseNext){loseNext=false;throw new Error('response dropped after server commit');}return response;},()=>now);
 client.accept(decodeRoom(state.room),0,true);const initial=client.predicted.z;
 for(let round=0;round<4;round++){for(let i=0;i<12;i++)client.predict(move);now+=200;await client.pump();assert.equal(client.needsReconnect,false,client.message);}
 assert.ok(client.predicted.z<initial);assert.equal(client.ack,4);
 for(let i=0;i<12;i++)client.predict(move);now+=200;loseNext=true;await client.pump();const predictedBeforeRetry=client.predicted.z;now+=200;await client.pump();assert.equal(client.ack,5);assert.equal(client.predicted.z,predictedBeforeRetry);
 await call('control',{code:created.code,action:'pause'},null,{userId:'teacher'});for(let i=0;i<6;i++)client.predict(move);now+=200;await client.pump();assert.equal(client.room.status,'paused');assert.equal(client.pending.length,0);assert.equal(client.needsReconnect,false);
 await call('control',{code:created.code,action:'resume'},null,{userId:'teacher'});now+=200;await client.pump();assert.equal(client.room.status,'running');now+=1200;client.predict(move);assert.equal(client.needsReconnect,true);await client.reconnect();assert.equal(client.needsReconnect,false);assert.equal(client.pending.length,0);assert.equal(client.batch,null);
});

test('paused snapshots clear held prediction work and transmit only an empty heartbeat',async()=>{
 let now=0,sent;const paused=room(2,2);paused.status='paused';const client=new MultiplayerClient(seat,async(path,init)=>{sent=JSON.parse(init.body);return response({room:paused,ack:1,playerId:'p1'});},()=>now);client.accept(room(),0,true);client.predict(move);assert.equal(client.pending.length,1);client.accept(paused,0);assert.equal(client.pending.length,0);const z=client.predicted.z;client.predict(move);assert.equal(client.predicted.z,z);now=200;await client.pump();assert.deepEqual(sent.frames,[]);assert.equal(sent.epoch,2);
});
test('actual radar drawing output is identical with or without enemy runners',async()=>{
 const {drawRadar}=await import('../src/multiplayer/scene.ts');
 const own=room().players[0],friend={...own,id:'friend',x:3,z:8},enemy={...own,id:'enemy',team:'blue',x:20,z:2};const state=room();state.players=[own,friend];
 const draw=value=>{const log=[];const ctx=new Proxy({},{get(target,key){if(key in target)return target[key];return(...args)=>log.push([key,...args]);},set(target,key,value){target[key]=value;log.push([key,value]);return true;}});drawRadar({width:240,getContext:()=>ctx},value,own);return log;};
 assert.deepEqual(draw(state),draw({...state,players:[own,friend,enemy]}));assert.notDeepEqual(draw(state),draw({...state,players:[own]}));
});
test('actual blur/visibility/UI focus handlers clear physical aliases and pending jump, and release pointer lock',async()=>{
 const vm=await import('node:vm');const main=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const handlers=new Map();let exits=0;const keys=new Set(['KeyW','ArrowUp','Space']);const document={hidden:false,pointerLockElement:{},exitPointerLock(){exits++;},addEventListener(name,callback){handlers.set(name,callback);}};const context=vm.createContext({keys,jump:true,document,client:null,network:{wake(){}},window:{addEventListener(name,callback){handlers.set(name,callback);}},locked:()=>true,isKeyboardUI:()=>true});
 const functions=main.slice(main.indexOf('function clearInput()'),main.indexOf('function beginView('));const listeners=main.match(/window\.addEventListener\('blur',release\);document\.addEventListener\('visibilitychange'[^\n]+/)[0];vm.runInContext(functions+'\n'+listeners,context);
 handlers.get('blur')();assert.equal(keys.size,0);assert.equal(context.jump,false);assert.equal(exits,1);
 keys.add('ArrowRight');context.jump=true;handlers.get('visibilitychange')();assert.equal(keys.size,1);document.hidden=true;handlers.get('visibilitychange')();assert.equal(keys.size,0);assert.equal(context.jump,false);
 keys.add('KeyC');context.jump=true;handlers.get('focusin')({target:{}});assert.equal(keys.size,0);assert.equal(context.jump,false);assert.equal(exits,3);
});
test('view generation rejects late polls/controls after room switch or leave, and binds newly created rooms only once',async()=>{
 const {ViewGate}=await import('../src/multiplayer/client.ts');const gate=new ViewGate();const first=gate.begin('FIRST');assert.equal(gate.accepts(first,'FIRST'),true);assert.equal(gate.accepts(first,'OTHER'),false);const switched=gate.begin('SECOND');assert.equal(gate.accepts(first,'FIRST'),false);assert.equal(gate.accepts(switched,'SECOND'),true);const left=gate.begin(null);assert.equal(gate.accepts(switched,'SECOND'),false);const creating=gate.begin(null);assert.equal(gate.bind(left,'OLD'),false);assert.equal(gate.bind(creating,'NEW'),true);assert.equal(gate.accepts(gate.capture(),'NEW'),true);assert.equal(gate.bind(creating,'LATE'),false);
});

test('mismatched room code cannot replace active prediction or acknowledged state',()=>{const c=new MultiplayerClient(seat);c.accept(room(8),9,true);const wrong={...room(99),code:'OTHER'};wrong.players[0].x=999;c.accept(wrong,50);assert.equal(c.room.code,seat.code);assert.equal(c.room.version,8);assert.equal(c.ack,9);assert.notEqual(c.predicted.x,999);});

test('actual teacher poll refreshes enabled controls after completion and cannot paint a different room',async()=>{
 const vm=await import('node:vm');const {ViewGate}=await import('../src/multiplayer/client.ts');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const line=source.split('\n').find(s=>s.startsWith('const teacherPoll='));const gate=new ViewGate();gate.begin(seat.code);let callback,resolve;const states=[];const context=vm.createContext({teacher:true,room:room(),teacherBusy:false,document:{hidden:false},view:gate,setInterval(fn){callback=fn;return 1;},api:()=>new Promise(r=>resolve=r),displayRoom(value){context.room=value;states.push({code:value.code,busy:context.teacherBusy});},say(){},readable:e=>String(e)});
 const {stripTypeScriptTypes}=await import('node:module');vm.runInContext(stripTypeScriptTypes(line),context);const pending=callback();assert.equal(context.teacherBusy,true);resolve({room:room(2)});await pending;assert.equal(context.teacherBusy,false);assert.equal(states.at(-1).busy,false);
 const old=callback();gate.begin('OTHER');context.room={...room(5),code:'OTHER'};context.teacherBusy=false;resolve({room:room(99)});await old;assert.equal(context.room.code,'OTHER');assert.equal(states.at(-1).code,seat.code);
});

test('actual BFCache pageshow safely reloads a disposed app but initial load does not reload',async()=>{
 const vm=await import('node:vm');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const line=source.split('\n').find(s=>s.startsWith("window.addEventListener('pageshow'"));let callback,reloads=0;vm.runInNewContext(line,{window:{addEventListener(name,fn){assert.equal(name,'pageshow');callback=fn;}},location:{reload(){reloads++;}}});callback({persisted:false});assert.equal(reloads,0);callback({persisted:true});assert.equal(reloads,1);
});

test('pose freshness is independent of scoring version; old samples, epochs and acknowledgments cannot rewind it',()=>{
 const c=new MultiplayerClient(seat),a={...room(8,2),snapshotMs:1000};c.accept(a,5,true);const fresh={...room(8,2),snapshotMs:1200};fresh.players[0].x=12;c.accept(fresh,6);assert.equal(c.predicted.x,12);
 const late={...room(8,2),snapshotMs:1100};late.players[0].x=99;c.accept(late,6);assert.equal(c.predicted.x,12);
 const oldEpoch={...room(99,1),snapshotMs:99999};oldEpoch.players[0].x=88;c.accept(oldEpoch,50);assert.equal(c.room.epoch,2);assert.equal(c.predicted.x,12);
 c.accept({...room(9,2),snapshotMs:1300},4);assert.equal(c.ack,6);assert.equal(c.predicted.x,12);
});

test('actual graphics-loss callback cannot be undone by room rendering and stops renderer calls',async()=>{
 const vm=await import('node:vm');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const start=source.indexOf("graphics.canvas.addEventListener('webglcontextlost'");const end=source.indexOf('}catch(error)',start);const registration=source.slice(start,end-1);let callback,prevents=0,releases=0,renders=0;const context=vm.createContext({graphicsAvailable:true,graphics:{canvas:{addEventListener(name,fn){callback=fn;}},render(){renders++;}},graphicsError:{hidden:true,textContent:''},play:{disabled:false},client:{needsReconnect:false},release(){releases++;}});vm.runInContext(registration,context);callback({preventDefault(){prevents++;}});assert.equal(context.graphicsAvailable,false);assert.equal(prevents,1);assert.equal(releases,1);
 const disabled=source.match(/play\.disabled=!graphicsAvailable[^;]+;/)[0];vm.runInContext(disabled,context);assert.equal(context.play.disabled,true);vm.runInContext('if(graphicsAvailable)graphics?.render();',context);assert.equal(renders,0);
});

test('actual pagehide cancels its animation frame and a disposed frame cannot schedule or render again',async()=>{
 const vm=await import('node:vm');const {stripTypeScriptTypes}=await import('node:module');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const hide=source.split('\n').find(s=>s.startsWith("window.addEventListener('pagehide'"));let callback,cancelled=0,scheduled=0,freed=0;const context=vm.createContext({disposed:false,raf:91,graphicsAvailable:true,window:{addEventListener(name,fn){callback=fn;}},cancelAnimationFrame(id){cancelled=id;},requestAnimationFrame(){scheduled++;},release(){},clearInterval(){},network:{stop(){}},teacherPoll:2,client:{dispose(){}},graphics:{dispose(){freed++;}}});vm.runInContext(hide,context);callback();assert.equal(cancelled,91);assert.equal(freed,1);assert.equal(context.disposed,true);const frame=source.slice(source.indexOf('function frame('),source.indexOf('\nraf=requestAnimationFrame(frame);'));vm.runInContext(stripTypeScriptTypes(frame)+';frame(100);',context);assert.equal(scheduled,0);
});

test('finished match stops player heartbeat writes rather than polling forever',async()=>{
 let calls=0,now=0;const c=new MultiplayerClient(seat,async()=>{calls++;return response({});},()=>now);const finished=room(5,3);finished.status='ended';c.accept(finished,8,true);now=10000;await c.pump();assert.equal(calls,0);
});

test('actual teacher command retries uncertain acknowledgment with one operation ID and refreshes stale intent',async()=>{
 const vm=await import('node:vm'),{stripTypeScriptTypes}=await import('node:module');const {ViewGate}=await import('../src/multiplayer/client.ts');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const fn=source.slice(source.indexOf('async function control('),source.indexOf("\n$('join-form')"));
 for(const mode of['lost','stale']){
  const gate=new ViewGate();gate.begin(seat.code);const calls=[],messages=[];let context;const latest={...room(9,3),controlRevision:4,status:'paused'};
  context=vm.createContext({teacher:true,teacherBusy:false,room:{...room(8,2),controlRevision:3},view:gate,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},displayRoom(r){context.room=r;},say(s){messages.push(s);},readable:e=>String(e),api:async(path,body)=>{calls.push({path,body:structuredClone(body)});if(calls.length===1)throw vm.runInContext(mode==='lost'?"new Error('lost response')":"Object.assign(new Error('STALE_CONTROL'),{status:409})",context);return{room:latest};}});
  vm.runInContext(stripTypeScriptTypes(fn),context);await vm.runInContext("control('pause')",context);assert.equal(context.teacherBusy,false);assert.equal(context.room.controlRevision,4);assert.equal(calls.length,2);assert.equal(calls[0].body.revision,3);
  if(mode==='lost'){assert.equal(calls[1].path,'control');assert.deepEqual(calls[0].body,calls[1].body);}else{assert.equal(calls[1].path,'state');assert.ok(messages.some(m=>m.includes('View refreshed')));}
 }
});


test('late failed stale-control refresh cannot paint an error after leaving or switching rooms',async()=>{
 const vm=await import('node:vm'),{stripTypeScriptTypes}=await import('node:module');const {ViewGate}=await import('../src/multiplayer/client.ts');const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');const fn=source.slice(source.indexOf('async function control('),source.indexOf("\n$('join-form')"));
 for(const next of [null,'OTHER']){
  const gate=new ViewGate();gate.begin(seat.code);const messages=[];let rejectRefresh,context;
  context=vm.createContext({teacher:true,teacherBusy:false,room:{...room(),controlRevision:0},view:gate,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},displayRoom(r){context.room=r;},say(s){messages.push(s);},readable:e=>String(e),api:async(path)=>{if(path==='control')throw vm.runInContext("Object.assign(new Error('STALE_CONTROL'),{status:409})",context);return new Promise((resolve,reject)=>{rejectRefresh=reject;});}});
  vm.runInContext(stripTypeScriptTypes(fn),context);const pending=vm.runInContext("control('pause')",context);while(!rejectRefresh)await Promise.resolve();gate.begin(next);context.room=next?{...room(),code:next}:null;context.teacherBusy=false;rejectRefresh(new Error('late refresh failed'));await pending;assert.deepEqual(messages,[]);assert.equal(context.room?.code??null,next);assert.equal(context.teacherBusy,false);
 }
});

test('malformed wire or mismatched own identity cannot advance acknowledgment or seed prediction from remote defaults',async()=>{
 for(const mode of['version','tuple','identity']){
  let now=0;const initial=room(),wire=encodeRoom({...initial,snapshotMs:0,controlRevision:0,winner:null,teacher:false},'p1');
  if(mode==='version')wire.wireVersion=99;
  if(mode==='tuple')wire.peers=[['bad']];
  if(mode==='identity'){wire.own.id='someone-else';}
  const c=new MultiplayerClient(seat,async()=>new Response(JSON.stringify({room:wire,ack:1,playerId:'p1'}),{status:200}),()=>now);c.accept(initial,0,true);c.predict(move);const before={...c.predicted};now=200;await c.pump();assert.equal(c.ack,0);assert.ok(c.batch);assert.deepEqual(c.predicted,before);
 }
 const c=new MultiplayerClient(seat);c.accept(room(),0,true);const wrong={...room(99),viewerPlayerId:'other'};wrong.players[0].x=999;c.accept(wrong,90);assert.equal(c.ack,0);assert.notEqual(c.predicted.x,999);assert.equal(c.needsReconnect,true);
});

test('wire decoding preserves HTTP authorization/epoch errors instead of replacing them with codec failures',async()=>{
 for(const [status,error] of[[403,'SEAT_REMOVED'],[409,'STALE_EPOCH']])await assert.rejects(()=>api('sync',{},'token',async()=>new Response(JSON.stringify({error}),{status})),e=>e.status===status&&e.message===error);
});

test('actual client rebases after 500ms arrival jitter and resumes twenty debt-free 5Hz cycles',async()=>{
 const {handleMultiplayer}=await import('../server/lib/multiplayer.mjs'),{SqliteD1}=await import('../server/test/d1-sqlite.mjs');const db=new SqliteD1();let serverNow=1000,clientNow=1000,revision=0;
 const call=async(path,body,token,principal)=>{if(path==='control')body={...body,revision,operationId:crypto.randomUUID()};const res=await handleMultiplayer(new Request(`https://test.local/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{now:serverNow,principal});const parsed=await res.clone().json();if(parsed.room)revision=parsed.room.controlRevision;return res;};
 try{
  const created=await(await call('rooms',{},null,{userId:'teacher'})).json();const joined=await(await call('join',{code:created.code,nickname:'Fox',joinKey:'ab'.repeat(32)})).json();await call('join',{code:created.code,nickname:'Owl',joinKey:'cd'.repeat(32)});await call('control',{code:created.code,action:'start'},null,{userId:'teacher'});const initial=await(await call('state',{code:created.code},joined.seatToken)).json();
  const sent=[],statuses=[];const c=new MultiplayerClient({code:created.code,seatToken:joined.seatToken,playerId:joined.playerId},async(path,init)=>{sent.push({path,body:JSON.parse(init.body)});const res=await call(path.split('/').at(-1),JSON.parse(init.body),joined.seatToken);statuses.push(res.status);return res;},()=>clientNow);c.accept(decodeRoom(initial.room),0,true);
  const fill=n=>{for(let i=0;i<n;i++)c.predict(move);};fill(12);clientNow=1200;serverNow=1200;await c.pump();assert.equal(c.ack,1);
  fill(12);clientNow=1400;serverNow=1900;await c.pump();assert.equal(c.ack,2);clientNow=2000;fill(36);serverNow=2001;await c.pump();assert.deepEqual(statuses.slice(-2),[409,200]);assert.equal(c.ack,3);assert.equal(c.needsReconnect,false);assert.equal(c.batch,null);assert.equal(c.pending.length,0);assert.equal(c.budgetRebases,1);assert.ok(sent.at(-1).path.endsWith('/reconnect'));assert.match(c.message,/resynchronized/);
  const count=sent.length;clientNow=2100;await c.pump();assert.equal(sent.length,count);
  for(let i=0;i<20;i++){clientNow=2200+i*200;serverNow=2201+i*200;fill(12);await c.pump();assert.equal(statuses.at(-1),200);assert.equal(c.ack,4+i);assert.equal(c.pending.length,0);assert.equal(c.batch,null);assert.equal(c.needsReconnect,false);assert.equal(c.budgetRebases,1);assert.equal(sent.at(-1).body.frames.length,12);}
 }finally{db.close();}
});

test('automatic timing rebase is limited to two per10sec and failed recovery freezes without ack advance',async()=>{
 for(const failRecovery of[false,true]){
  let now=0,reconnects=0;const c=new MultiplayerClient(seat,async(path)=>{if(path.endsWith('/sync'))return response({error:'INPUT_TOO_FAST'},409);reconnects++;return failRecovery?response({error:'SEAT_REMOVED'},403):response({room:room(),ack:0,playerId:'p1'});},()=>now);c.accept(room(),0,true);
  for(let i=0;i<(failRecovery?1:3);i++){now+=200;c.predict(move);await c.pump();}
  assert.equal(c.needsReconnect,true);assert.equal(c.ack,0);assert.equal(reconnects,failRecovery?1:2);assert.equal(c.budgetRebases,failRecovery?1:2);
 }
});

test('late budget rejection never clears an already-frozen 60-frame backlog',async()=>{
 let now=0,resolve,calls=0;const c=new MultiplayerClient(seat,async()=>{calls++;return await new Promise(r=>resolve=r);},()=>now);c.accept(room(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const pending=c.pump();for(let i=0;i<49;i++)c.predict(move);assert.equal(c.needsReconnect,true);assert.equal(c.pending.length+c.batch.frames.length,60);resolve(response({error:'INPUT_TOO_FAST'},409));await pending;assert.equal(c.needsReconnect,true);assert.equal(c.ack,0);now=400;await c.pump();assert.equal(calls,1);
});

test('timing rebase cannot revive paused/ended/removed phases or a disposed generation; reconnect calls coalesce',async()=>{
 for(const phase of['paused','ended','removed']){
  let now=0,calls=0;const changed={...room(5,3),status:phase==='removed'?'running':phase};const c=new MultiplayerClient(seat,async(path)=>{calls++;if(path.endsWith('/sync'))return response({error:'INPUT_TOO_FAST'},409);return phase==='removed'?response({error:'SEAT_REMOVED'},403):response({room:changed,ack:0,playerId:'p1'});},()=>now);c.accept(room(),0,true);c.predict(move);now=200;await c.pump();assert.equal(c.ack,0);assert.equal(c.pending.length,0);if(phase==='removed'){assert.equal(c.needsReconnect,true);}else{assert.equal(c.room.status,phase);const z=c.predicted.z;c.predict(move);assert.equal(c.predicted.z,z);if(phase==='ended'){now=400;await c.pump();assert.equal(calls,2);}}
 }
 let resolve,reject,calls=0,changes=0;const c=new MultiplayerClient(seat,async()=>{calls++;return await new Promise((a,b)=>{resolve=a;reject=b;});},()=>0,()=>changes++);c.accept(room(),0,true);const a=c.reconnect(),b=c.reconnect();assert.equal(calls,1);const fresh=room(4);fresh.players[0].seq=4;resolve(response({room:fresh,ack:4,playerId:'p1'}));await Promise.all([a,b]);assert.equal(c.ack,4);
 const late=c.reconnect();c.dispose();c.message='disposed generation';const before=changes;reject(new Error('late failure'));await assert.rejects(late);assert.equal(c.message,'disposed generation');assert.equal(changes,before);assert.equal(c.needsReconnect,true);assert.equal(c.ack,4);
});

test('late failed stale-epoch refresh cannot mutate a disposed generation',async()=>{
 let now=0,rejectRefresh,changes=0;const c=new MultiplayerClient(seat,async(path)=>path.endsWith('/sync')?response({error:'STALE_EPOCH'},409):await new Promise((resolve,reject)=>{rejectRefresh=reject;}),()=>now,()=>changes++);c.accept(room(),0,true);now=200;const pending=c.pump();while(!rejectRefresh)await new Promise(r=>setTimeout(r,0));c.dispose();c.message='disposed generation';const before=changes;rejectRefresh(new Error('late failure'));await pending;assert.equal(c.message,'disposed generation');assert.equal(changes,before);assert.equal(c.ack,0);assert.equal(c.needsReconnect,true);
});
