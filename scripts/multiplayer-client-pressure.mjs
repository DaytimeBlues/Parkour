#!/usr/bin/env node
/** Default four ACTUAL clients (--players2..8), 60Hz prediction/5Hz pump, production SQL.
 * node --experimental-strip-types scripts/multiplayer-client-pressure.mjs
 * Isolated injected principals only, no HTTP auth bypass or browser/GPU claim.
 */
import {performance,monitorEventLoopDelay,PerformanceObserver} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MultiplayerClient} from '../src/multiplayer/client.ts';
import {createPumpDriver} from '../src/multiplayer/pump.ts';
import {CHARACTER_IDS,WING_IDS,appearanceCode} from '../shared/appearance.mjs';
import {ROOM_CAPACITY} from '../shared/multiplayer.mjs';
import {decodeRoom} from '../shared/multiplayer-wire.mjs';
import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {SqliteD1} from '../server/test/d1-sqlite.mjs';
const playerFlag=process.argv.indexOf('--players'),players=playerFlag<0?4:Number(process.argv[playerFlag+1]);
const durationFlag=process.argv.indexOf('--duration-seconds'),durationSeconds=durationFlag<0?12:Number(process.argv[durationFlag+1]);
if(!Number.isInteger(durationSeconds)||durationSeconds<12||durationSeconds>900)throw new Error('Use --duration-seconds with an integer12..900; default12.');
if(!Number.isInteger(players)||players<2||players>ROOM_CAPACITY)throw new Error('Use --players with an integer2..8; default4. Historical 32-player results belong to their archived source.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const db=new SqliteD1(),teacher={userId:'actual-client-fixture-teacher'};
const call=(path,body,token,principal)=>handleMultiplayer(new Request(`https://fixture.local/api/multiplayer/${path}`,{method:'POST',headers:{Origin:'https://fixture.local','Content-Type':'application/json','X-Skybound-Wire':'3',...(token?{'X-Skybound-Seat':token}:{})},body:JSON.stringify(body)}),db,{principal});
const hashes=Object.fromEntries(['../src/multiplayer/client.ts','../src/multiplayer/pump.ts','../src/multiplayer/main.ts','../server/lib/multiplayer.mjs','../shared/multiplayer.mjs','../shared/multiplayer-wire.mjs','../server/test/d1-sqlite.mjs','../shared/appearance.mjs','./multiplayer-client-pressure.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex')]));
const loop=monitorEventLoopDelay({resolution:10}),gc=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({durationMs:e.duration,kind:e.detail?.kind});});observer.observe({entryTypes:['gc']});loop.enable();const cpuStart=process.cpuUsage(),utilStart=performance.eventLoopUtilization();const pumpGaps=[],predictionGaps=[];let physicsMs=0,physicsSteps=0;
let timer;const networks=[],clients=[],metrics=[];let injected=false,start=0;
try{
 const created=await(await call('rooms',{durationSeconds:durationSeconds+60},null,teacher)).json();const seats=[];
 for(let i=0;i<players;i++){const joined=await(await call('join',{code:created.code,nickname:`Fixture Fox ${i}`,joinKey:String(i+1).padStart(64,'0'),appearance:{character:CHARACTER_IDS[Math.floor(i/6)%2],wing:WING_IDS[i%6]}})).json();seats.push({code:created.code,seatToken:joined.seatToken,playerId:joined.playerId});}
 await call('control',{code:created.code,action:'start',revision:0,operationId:crypto.randomUUID()},null,teacher);
 for(let i=0;i<players;i++){
  const m={client:i,acks:[],lastAck:0,maxPending:0,freeze:false,requests:0,reconnects:0,syncStarts:[],lastWake:0,inflight:0,maxInflight:0};metrics.push(m);
  const c=new MultiplayerClient(seats[i],async(path,init)=>{
   m.requests++;const endpoint=path.split('/').at(-1);if(endpoint==='sync')m.syncStarts.push(c.lastAttempt-start);m.inflight++;m.maxInflight=Math.max(m.maxInflight,m.inflight);
   if(endpoint==='reconnect')m.reconnects++;
   const delay=i===0&&endpoint==='sync'&&!injected&&performance.now()-start>=1000?500:20;
   if(delay===500)injected=true;
   try{await sleep(delay);const result=await call(endpoint,JSON.parse(init.body),seats[i].seatToken);await sleep(20);return result;}finally{m.inflight--;}
  },()=>performance.now(),()=>{if(c.ack>m.lastAck){m.acks.push(performance.now()-start);m.lastAck=c.ack;}});
  c.accept(decodeRoom((await(await call('state',{code:created.code},seats[i].seatToken)).json()).room),0,true);clients.push(c);
 }
 start=performance.now();let last=start,acc=0;
 timer=setInterval(()=>{
  const now=performance.now();predictionGaps.push(now-last);acc+=Math.min(100,now-last);last=now;
  while(acc>=1000/60){for(let i=0;i<clients.length;i++){const c=clients[i];const physicsAt=performance.now();c.predict({forward:Math.floor((now-start)/2000)%2?-1:1,right:0,yaw:i*Math.PI/2,jump:false,glide:false,slide:false});physicsMs+=performance.now()-physicsAt;physicsSteps++;metrics[i].maxPending=Math.max(metrics[i].maxPending,c.pending.length+(c.batch?.frames.length??0));}acc-=1000/60;}
 },8);
 for(let i=0;i<clients.length;i++){const c=clients[i],m=metrics[i];m.lastWake=start;networks.push(createPumpDriver(()=>c,()=>true,{onWake(t){pumpGaps.push(t-m.lastWake);m.lastWake=t;if(c.needsReconnect&&!c.busy)m.freeze=true;}}));}
 await sleep(durationSeconds*1000);clearInterval(timer);networks.forEach(n=>n.stop());await Promise.all(networks.map(n=>n.whenIdle()));
 const results=clients.map((c,i)=>{const m=metrics[i],stable=m.acks.filter(t=>t>=3000),gaps=stable.slice(1).map((t,j)=>t-stable[j]).sort((a,b)=>a-b),hz=stable.length>1?(stable.length-1)*1000/(stable.at(-1)-stable[0]):0;const sends=m.syncStarts.slice(1).map((t,j)=>t-m.syncStarts[j]);return{client:i,appearanceMatches:!!c.room&&c.room.players.length===players&&c.room.players.every(p=>appearanceCode(p.appearance)===seats.findIndex(s=>s.playerId===p.id)%12),ack:c.ack,maxInflight:m.maxInflight,minSendStartGapMs:Math.min(...sends),budgetRebases:c.budgetRebases,reconnectRequests:m.reconnects,maxPendingFrames:m.maxPending,finalPendingFrames:c.pending.length,needsReconnect:c.needsReconnect,observedFreeze:m.freeze,steadyAfter3SecondsAckHz:+hz.toFixed(3),steadyAckGapP95Ms:+(gaps[Math.floor(gaps.length*.95)]??0).toFixed(2)};});
 const pass=injected&&results.every((r,i)=>r.appearanceMatches&&!r.needsReconnect&&!r.observedFreeze&&r.maxPendingFrames<=60&&r.maxInflight===1&&r.minSendStartGapMs>=199.999&&r.steadyAfter3SecondsAckHz>=4.7&&r.steadyAckGapP95Ms<=280&&r.budgetRebases===(i===0?1:0));
 const dist=a=>{const b=[...a].sort((x,y)=>x-y);return{count:b.length,p50:b[Math.floor(b.length*.5)]??0,p95:b[Math.floor(b.length*.95)]??0,p99:b[Math.floor(b.length*.99)]??0,max:b.at(-1)??0};};const diagnostics={eventLoopDelayMs:{mean:loop.mean/1e6,p95:loop.percentile(95)/1e6,p99:loop.percentile(99)/1e6,max:loop.max/1e6},eventLoopUtilization:performance.eventLoopUtilization(utilStart),cpuMicroseconds:process.cpuUsage(cpuStart),gc:{count:gc.length,totalMs:gc.reduce((s,e)=>s+e.durationMs,0),durationMs:dist(gc.map(e=>e.durationMs))},driverWakeGapMs:dist(pumpGaps),predictionTimerGapMs:dist(predictionGaps),localPrediction:{physicsSteps,totalMs:physicsMs}};
 console.log(JSON.stringify({diagnostics,players,evidence:`${players} actual MultiplayerClient instances with continuous60Hz prediction and same adaptive one-shot production driver imported by main.ts targeting5Hz; original50ms failure preserved in docs/qa/protocol2, negotiated wire3 with mixed cosmetic identities, production handler/SQLite,20ms pre-handler+20ms return delay, one500ms client0 arrival delay. No HTTP server, browser render or hosted identity claim.`,sourceSha256:hashes,durationSeconds,forcedArrivalDelayMs:500,injected,results,pass}));if(!pass)process.exitCode=1;
}finally{if(timer)clearInterval(timer);networks.forEach(n=>n.stop());await Promise.allSettled(networks.map(n=>n.whenIdle()));clients.forEach(c=>c.dispose());loop.disable();observer.disconnect();db.close();}
