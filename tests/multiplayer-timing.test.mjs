import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setImmediate as settle} from 'node:timers/promises';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {createPlayer} from '../shared/multiplayer.mjs';
import {encodeRoom} from '../shared/multiplayer-wire.mjs';
const seat={code:'FORT12',seatToken:'synthetic-token',playerId:'p1'};
const move={forward:1,right:0,yaw:0,jump:false,glide:false,slide:false};
function room(version=1,ack=0){return {code:seat.code,status:'running',epoch:1,version,remainingMs:300000,durationMs:300000,scores:{red:0,blue:0},zones:[],players:[{...createPlayer('red'),id:'p1',nickname:'Synthetic',active:true,connected:true,lastSeenMs:0,seq:ack}],serverTime:0,snapshotMs:0,controlRevision:0,winner:null,teacher:false,locked:false};}
const response=(r,ack)=>new Response(JSON.stringify({room:encodeRoom(r,seat.playerId),ack,playerId:seat.playerId}),{status:200});
class Timers{
 now=0;serial=0;events=new Map();early=0;late=0;
 setTimeout(fn,delay){const id=++this.serial;this.events.set(id,{id,fn,due:this.now+Math.max(.001,delay-this.early)+this.late});return id;}
 clearTimeout(id){this.events.delete(id);}
 setInterval(fn,period){const id=++this.serial;this.events.set(id,{id,fn,period,n:1,origin:this.now,due:this.now+period});return id;}
 clearInterval(id){this.events.delete(id);}
 async until(end){let count=0;for(;;){const event=[...this.events.values()].sort((a,b)=>a.due-b.due||a.id-b.id)[0];if(!event||event.due>end)break;assert.ok(++count<5000,'timer must not spin');this.now=event.due;this.events.delete(event.id);if(event.period){const n=event.n+1;this.events.set(event.id,{...event,n,due:event.origin+n*event.period+(n%5===4?.1:0)});}event.fn();await settle();}this.now=end;}
}
async function productionDriver(timers,getClient,document={hidden:false}){
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.startsWith('const network='));assert.ok(line);
 const actual=line.includes('createPumpDriver')?(await import('../src/multiplayer/pump.ts')).createPumpDriver:null;
 const context=vm.createContext({document,get client(){return getClient();},setInterval:timers.setInterval.bind(timers),createPumpDriver:(get,enabled)=>actual(get,enabled,{clock:()=>timers.now,setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)})});
 vm.runInContext(line,context);const network=vm.runInContext('network',context);
 return {wake:()=>network.wake?.(),stop:()=>network.stop?network.stop():timers.clearInterval(network)};
}
test('ACTUAL production network path avoids persistent fifth-poll quantization under bounded callback lateness',async()=>{
 const timers=new Timers(),acks=[],sends=[];let lastAck=0;
 const c=new MultiplayerClient(seat,async(path,init)=>{const b=JSON.parse(init.body);sends.push(timers.now);return response(room(b.sequence+1,b.sequence),b.sequence);},()=>timers.now,()=>{if(c.ack>lastAck){acks.push(timers.now);lastAck=c.ack;}});c.accept(room(),0,true);
 const driver=await productionDriver(timers,()=>c);
 try{await timers.until(10000);const hz=(acks.length-1)*1000/(acks.at(-1)-acks[0]);assert.ok(hz>=4.7&&hz<=5.001,`actual client cadence ${hz.toFixed(3)} Hz; sends ${sends.slice(0,5)}`);assert.ok(sends.slice(1).every((t,i)=>t-sends[i]>=200));}finally{driver.stop();c.dispose();}
});
test('ACTUAL reconnect keeps movement frozen when authoritative acceptance rejects an older ack/version',async()=>{
 for(const [reply,ack] of [[room(9,4),4],[room(7,5),5],[room(9,5),null]]){
  let now=100;const c=new MultiplayerClient(seat,async()=>response(reply,ack),()=>now);c.accept(room(8,5),5,true);c.needsReconnect=true;const before={ack:c.ack,version:c.room.version,x:c.predicted.x,lastGood:c.lastGood};now=500;
  await assert.rejects(c.reconnect(),/baseline|acknowledg|stale/i);
  assert.equal(c.needsReconnect,true);assert.equal(c.ack,before.ack);assert.equal(c.room.version,before.version);assert.equal(c.lastGood,before.lastGood);const x=c.predicted.x;c.predict(move);assert.equal(c.predicted.x,x);c.dispose();
 }
});
test('ACTUAL reconnect rejects ack/own-sequence disagreement without clearing frozen work or timing',async()=>{
 for(const [runnerSequence,ack] of [[5,99],[99,5]]){
  let now=100;
  const c=new MultiplayerClient(seat,async(path)=>{
   if(path.endsWith('/sync'))throw new Error('lost sync response');
   return response(room(9,runnerSequence),ack);
  },()=>now);
  c.accept(room(8,5),5,true);c.predict(move);c.predict(move);now=300;await c.pump();c.predict(move);c.needsReconnect=true;
  const before={ack:c.ack,room:structuredClone(c.room),predicted:structuredClone(c.predicted),pending:structuredClone(c.pending),batch:structuredClone(c.batch),lastGood:c.lastGood,lastAttempt:c.lastAttempt};
  now=500;await assert.rejects(c.reconnect(),/baseline|acknowledg|sequence/i);
  assert.equal(c.needsReconnect,true);assert.equal(c.busy,false);
  for(const [key,value] of Object.entries(before))assert.deepEqual(c[key],value,`${key} must survive rejected reconnect`);
  c.predict(move);assert.deepEqual(c.pending,before.pending);assert.deepEqual(c.predicted,before.predicted);c.dispose();
 }
});
test('ACTUAL fresh reconnect adopts server ack and normal200ms gate, and old error/finally cannot touch new work',async()=>{
 let now=0,oldReject,newResolve,syncs=0;const bodies=[];
 const c=new MultiplayerClient(seat,async(path,init)=>{if(path.endsWith('/reconnect'))return response(room(9,41),41);syncs++;bodies.push(JSON.parse(init.body));return await new Promise((resolve,reject)=>{if(syncs===1)oldReject=reject;else newResolve=resolve;});},()=>now);
 c.accept(room(),0,true);for(let i=0;i<12;i++)c.predict(move);now=200;const old=c.pump();now=500;await c.reconnect();assert.equal(c.ack,41);assert.equal(c.pending.length,0);assert.equal(c.batch,null);
 for(let i=0;i<12;i++)c.predict(move);now=699;await c.pump();assert.equal(syncs,1);now=700;const fresh=c.pump();assert.equal(bodies.at(-1).sequence,42);assert.equal(bodies.at(-1).frames.length,12);
 const state={ack:c.ack,lastGood:c.lastGood,lastAttempt:c.lastAttempt,budget:c.budgetRebases,batch:c.batch};oldReject(new Error('late old transport rejection'));await old;assert.equal(c.busy,true);for(const [k,v] of Object.entries(state))assert.equal(k==='budget'?c.budgetRebases:c[k],v);
 now=720;newResolve(response(room(10,42),42));await fresh;assert.equal(c.ack,42);assert.equal(c.needsReconnect,false);c.dispose();
});
test('ACTUAL driver handles busy/hidden, client replacement, early/late wake and stop without overlap or bursts',async()=>{
 const {createPumpDriver}=await import('../src/multiplayer/pump.ts');const timers=new Timers();timers.early=.1;let hidden=false,current,resolve,requests=0,inflight=0,maxInflight=0;const sends=[],resolvers=[];
 const makeClient=()=>{const c=new MultiplayerClient(seat,async(path,init)=>{requests++;inflight++;maxInflight=Math.max(maxInflight,inflight);sends.push(timers.now);const b=JSON.parse(init.body);try{return await new Promise(r=>{resolve=()=>r(response(room(b.sequence+1,b.sequence),b.sequence));resolvers.push(resolve);});}finally{inflight--; }},()=>timers.now);c.accept(room(),0,true);return c;};current=makeClient();
 const driver=createPumpDriver(()=>current,()=>!hidden,{clock:()=>timers.now,setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
 try{await timers.until(250);assert.equal(requests,1);await timers.until(600);assert.equal(requests,1);resolve();await settle();await timers.until(602);assert.equal(requests,2);assert.equal(maxInflight,1);resolve();await settle();hidden=true;await timers.until(1200);assert.equal(requests,2);hidden=false;await timers.until(1400);assert.equal(requests,3);
  const old=current;old.dispose();current=makeClient();driver.wake();await timers.until(1602);assert.equal(requests,4,'replacement must not wait for obsolete request');driver.stop();const before=requests;await timers.until(3000);assert.equal(requests,before);current.dispose();
 }finally{driver.stop();current?.dispose();for(const resolve of resolvers)resolve();await settle();}
});

test('ACTUAL driver skips missed slots and uses send-start deadlines under slow replies',async()=>{
 const {createPumpDriver}=await import('../src/multiplayer/pump.ts');
 for(const rtt of [40,250]){
  const timers=new Timers();timers.late=.1;const sends=[];let busy=0,maxBusy=0;
  const c=new MultiplayerClient(seat,async(path,init)=>{sends.push(c.lastAttempt);busy++;maxBusy=Math.max(maxBusy,busy);const body=JSON.parse(init.body);return await new Promise(resolve=>timers.setTimeout(()=>{busy--;resolve(response(room(body.sequence+1,body.sequence),body.sequence));},rtt));},()=>timers.now);c.accept(room(),0,true);
  const driver=createPumpDriver(()=>c,()=>true,{clock:()=>timers.now,setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
  try{await timers.until(1800);assert.ok(sends.length>=5);assert.equal(maxBusy,1);const gaps=sends.slice(1).map((t,i)=>t-sends[i]);assert.ok(gaps.every(g=>g>=Math.max(200,rtt)));assert.ok(gaps.every(g=>g<Math.max(200,rtt)+3),`must not add response latency +200ms: ${gaps}`);
  }finally{driver.stop();await timers.until(2200);await driver.whenIdle();c.dispose();}
 }
 const timers=new Timers(),sends=[];const c=new MultiplayerClient(seat,async(path,init)=>{sends.push(c.lastAttempt);const body=JSON.parse(init.body);return response(room(body.sequence+1,body.sequence),body.sequence);},()=>timers.now);c.accept(room(),0,true);
 const driver=createPumpDriver(()=>c,()=>true,{clock:()=>timers.now,setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
 try{await timers.until(199);const due=[...timers.events.values()].sort((a,b)=>a.due-b.due)[0];timers.events.delete(due.id);timers.now=650;due.fn();await settle();assert.deepEqual(sends,[650]);await timers.until(849.999);assert.deepEqual(sends,[650]);await timers.until(851);assert.deepEqual(sends,[650,850]);}finally{driver.stop();await driver.whenIdle();c.dispose();}
});
test('ACTUAL manual reconnect wakes a fresh generation without waiting for obsolete sync',async()=>{
 const {createPumpDriver}=await import('../src/multiplayer/pump.ts'),{ViewGate}=await import('../src/multiplayer/client.ts');const timers=new Timers();let oldResolve,requests=0;const sends=[];
 const c=new MultiplayerClient(seat,async(path,init)=>{if(path.endsWith('/reconnect'))return response(room(9,40),40);requests++;sends.push(c.lastAttempt);const body=JSON.parse(init.body);if(requests===1)return await new Promise(resolve=>oldResolve=()=>resolve(response(room(2,1),1)));return response(room(body.sequence+1,body.sequence),body.sequence);},()=>timers.now);c.accept(room(),0,true);
 const driver=createPumpDriver(()=>c,()=>true,{clock:()=>timers.now,setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
 try{await timers.until(250);assert.equal(requests,1);const button={disabled:false},view=new ViewGate();view.begin(seat.code);const context=vm.createContext({reconnect:button,client:c,view,network:driver,say(){},readable:e=>String(e)});const line=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8').split('\n').find(l=>l.startsWith('reconnect.onclick='));vm.runInContext(line,context);await button.onclick();assert.equal(c.ack,40);await timers.until(451);assert.equal(requests,2,'fresh generation must not wait for old network promise');assert.ok(sends[1]>=450&&sends[1]<=451);assert.equal(c.ack,41);
 }finally{driver.stop();c.dispose();oldResolve?.();await settle();await driver.whenIdle();}
});
