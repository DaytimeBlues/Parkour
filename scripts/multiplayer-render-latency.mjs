#!/usr/bin/env node
/** Separate slow-network acceptance. Never changes the fast pressure-test gates.
 * Eight actual clients + production pump/SQL/HTTP; synthetic fixture login only.
 * node --experimental-strip-types scripts/multiplayer-render-latency.mjs
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {createPumpDriver} from '../src/multiplayer/pump.ts';
import {decodeRoom} from '../shared/multiplayer-wire.mjs';
import {NodeDatabase} from '../render/storage.mjs';
import {createHandler} from '../render/server.mjs';
import {configuredTeachers} from '../render/auth.mjs';
const flag=process.argv.indexOf('--duration-seconds'),durationSeconds=flag<0?300:Number(process.argv[flag+1]);
assert.ok(Number.isInteger(durationSeconds)&&durationSeconds>=60&&durationSeconds<=900);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const db=new NodeDatabase(),clients=[],drivers=[],metrics=[],events=[],timers=[];
let handler,predictionTimer,start=0,revision=0,code,removed=false;
const http=createServer((req,res)=>handler(req,res));http.listen(0,'127.0.0.1');await once(http,'listening');
const origin=`http://127.0.0.1:${http.address().port}`;
handler=createHandler({origin,teachers:configuredTeachers(JSON.stringify({fixture:'isolated-latency-fixture-not-for-deployment'})),db});
const sourceSha256=Object.fromEntries(['src/multiplayer/client.ts','src/multiplayer/pump.ts','server/lib/multiplayer.mjs','shared/multiplayer.mjs','shared/multiplayer-wire.mjs','render/server.mjs','render/storage.mjs','scripts/multiplayer-render-latency.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
try{
 const login=await fetch(origin+'/teacher/login',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({teacher:'fixture',secret:'isolated-latency-fixture-not-for-deployment'})});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=(path,body,token,teacher=false)=>fetch(origin+`/api/multiplayer/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{}),...(teacher?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const control=async(action,extra={})=>{const res=await call('control',{code,action,revision,operationId:crypto.randomUUID(),...extra},null,true);assert.equal(res.status,200,await res.clone().text());const body=await res.json();revision=body.room.controlRevision;events.push({action,atMs:performance.now()-start});};
 const created=await(await call('rooms',{durationSeconds:Math.min(900,durationSeconds+60)},null,true)).json();code=created.code;
 const seats=[];for(let i=0;i<8;i++){const joined=await(await call('join',{code,nickname:`Latency fixture ${i}`,joinKey:String(i+1).padStart(64,'0')})).json();assert.ok(joined.seatToken);seats.push({code,playerId:joined.playerId,seatToken:joined.seatToken});}
 await control('start');
 const delays=[600,660,700,740,800,900,700,620];
 for(let i=0;i<8;i++){
  const m={index:i,sends:[],acks:[],requestMs:[],status:{},maxInflight:0,inflight:0,maxQueued:0,holds:0,releaseSignals:0,unexpectedFreezes:0,reconnects:0,states:0,lostAck:false,retriedIdentically:false,stalled:false,suspension:false,removed:false};metrics.push(m);let syncs=0,lostBody=null;
  const c=new MultiplayerClient(seats[i],async(path,init)=>{
   const endpoint=path.split('/').at(-1),at=performance.now();m.inflight++;m.maxInflight=Math.max(m.maxInflight,m.inflight);if(endpoint==='reconnect')m.reconnects++;if(endpoint==='state')m.states++;
   const elapsed=at-start;let delay=delays[(syncs+i)%delays.length];
   if(endpoint==='sync'){m.sends.push(elapsed);syncs++;if(lostBody){m.retriedIdentically=init.body===lostBody;assert.equal(init.body,lostBody);lostBody=null;}}
   const stall=i===2&&endpoint==='sync'&&!m.stalled&&elapsed>durationSeconds*200;
   if(stall){m.stalled=true;delay=2600;events.push({action:'request-stall',client:i,atMs:elapsed});}
   try{
    await sleep(delay/2);const result=await call(endpoint,JSON.parse(init.body),seats[i].seatToken);await sleep(delay/2);
    if(!result.ok)events.push({action:'http-rejection',client:i,endpoint,status:result.status,error:(await result.clone().json()).error,atMs:performance.now()-start});
    m.status[result.status]=(m.status[result.status]??0)+1;m.requestMs.push({endpoint,elapsedMs:performance.now()-at,stall});
    if(i===1&&endpoint==='sync'&&!m.lostAck&&elapsed>durationSeconds*80&&result.ok){m.lostAck=true;lostBody=init.body;events.push({action:'lost-ack-after-commit',client:i,atMs:performance.now()-start});throw new TypeError('synthetic lost acknowledgment after server commit');}
    return result;
   }finally{m.inflight--;}
  },()=>performance.now(),()=>{
   if(c.predictionHeld)m.holds++;
   if(c.needsReconnect&&!c.recovering){events.push({action:'client-freeze',client:i,message:c.message,held:c.predictionHeld,status:c.room?.status,pending:c.pending.length,batch:c.batch?.frames.length,lastGoodAgeMs:performance.now()-c.lastGood,atMs:performance.now()-start});m.releaseSignals++;if(!m.suspension&&!m.removed)m.unexpectedFreezes++;}
   if(c.ack>(m.acks.at(-1)?.ack??0))m.acks.push({ack:c.ack,atMs:performance.now()-start});
  });
  const initial=await(await call('state',{code},seats[i].seatToken)).json();c.accept(decodeRoom(initial.room),initial.ack,true);clients.push(c);
 }
 start=performance.now();let last=start,acc=0;
 predictionTimer=setInterval(()=>{const now=performance.now();acc+=Math.min(100,now-last);last=now;while(acc>=1000/60){clients.forEach((c,i)=>{c.predict({forward:Math.floor((now-start)/2000)%2?-1:1,right:0,yaw:i*Math.PI/2,jump:false,glide:false,slide:false});metrics[i].maxQueued=Math.max(metrics[i].maxQueued,c.pending.length+(c.batch?.frames.length??0));});acc-=1000/60;}},8);
 clients.forEach(c=>drivers.push(createPumpDriver(()=>c)));
 const schedule=(ratio,fn)=>timers.push(setTimeout(()=>{void fn().catch(error=>{events.push({action:'event-error',error:String(error)});});},durationSeconds*1000*ratio));
 schedule(.34,async()=>{const m=metrics[3];m.suspension=true;clients[3].suspend();events.push({action:'tab-suspend',client:3,atMs:performance.now()-start});});
 schedule(.47,()=>control('pause'));schedule(.51,()=>control('resume'));
 schedule(.88,async()=>{metrics[7].removed=true;removed=true;await control('remove',{playerId:seats[7].playerId});});
 schedule(.97,()=>control('end'));
 await sleep(durationSeconds*1000);clearInterval(predictionTimer);drivers.forEach(d=>d.stop());await Promise.all(drivers.map(d=>d.whenIdle()));
 const p95=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length*.95)]??0;};
 const results=clients.map((c,i)=>{
  const m=metrics[i],normal=m.requestMs.filter(x=>!x.stall),gaps=m.sends.slice(1).map((x,j)=>x-m.sends[j]);
  return{client:i,ack:c.ack,roomStatus:c.room.status,needsReconnect:c.needsReconnect,maxQueuedFrames:m.maxQueued,maxInflight:m.maxInflight,minSendGapMs:Math.min(...gaps),requestP95Ms:p95(normal.map(x=>x.elapsedMs)),normalSyncCount:normal.filter(x=>x.endpoint==='sync').length,statuses:m.status,predictionHoldSignals:m.holds,discardedPredictionFrames:c.discardedPredictionFrames,releaseSignals:m.releaseSignals,unexpectedFreezes:m.unexpectedFreezes,reconnects:m.reconnects,stateReads:m.states,lostAck:m.lostAck,retriedIdentically:m.retriedIdentically,stalled:m.stalled,suspended:m.suspension};
 });
 const removedClient=clients[7],beforeRemoved=metrics[7].reconnects;await removedClient.recover();
 const pass=events.every(e=>e.action!=='event-error')&&removed&&events.some(e=>e.action==='pause')&&events.some(e=>e.action==='resume')&&events.some(e=>e.action==='end')&&results.every(r=>r.maxQueuedFrames<=60&&r.maxInflight===1&&r.minSendGapMs>=199.999&&r.requestP95Ms<=950&&r.normalSyncCount>=durationSeconds*.75&&r.unexpectedFreezes===0&&(r.client===7?r.needsReconnect:r.roomStatus==='ended'&&!r.needsReconnect))&&metrics[1].retriedIdentically&&metrics[2].stalled&&metrics[3].reconnects>=1&&metrics[7].reconnects===beforeRemoved;
 console.log(JSON.stringify({pass,durationSeconds,players:8,evidence:'Actual loopback HTTP, production Node handler/SQLite, real synthetic teacher form login, production clients/driver; 600..900ms deterministic jitter centered near700ms; lost ACK immutable retry,2600ms request stall,tab suspension/reconnect,pause/resume,revocation/end. No browser/GPU or deployed service claim. Fast4.7Hz/p95<=280ms acceptance remains separate and unchanged.',sourceSha256,events,results}));if(!pass)process.exitCode=1;
}finally{clearInterval(predictionTimer);timers.forEach(clearTimeout);drivers.forEach(d=>d.stop());await Promise.allSettled(drivers.map(d=>d.whenIdle()));clients.forEach(c=>c.dispose());http.closeAllConnections();await new Promise(r=>http.close(r));db.close();}
