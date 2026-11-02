#!/usr/bin/env node
/** Bounded LOCAL HTTP/SQLite pressure, not hosted D1 or browser/device proof.
 * Teacher identity is trusted fixture context, never an HTTP auth-bypass header.
 * node scripts/multiplayer-load.mjs --seconds 15 --hz 5 --players 4,16,32 --db-delay-ms 20
 * --soak --players 32 --seconds 310 runs a full 300-second server match,
 * five-second teacher pause, mid-match reconnect, removal and terminal stability.
 * --arrival-jitter-ms500 delays one client0 sync arrival after1s; fixture only.
 * Synthetic delay applies after every async database call, including one delay
 * per transactional batch. It is not measured hosted latency or per-row cost.
 */
import { createServer } from 'node:http';
import { performance, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handleMultiplayer } from '../server/lib/multiplayer.mjs';
import { SqliteD1 } from '../server/test/d1-sqlite.mjs';
import { decodeRoom } from '../shared/multiplayer-wire.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const soak = args.includes('--soak');
const seconds = Number(option('--seconds', soak ? 310 : 15)), hz = Number(option('--hz', 5)), dbDelayMs = Number(option('--db-delay-ms', 0)), arrivalJitterMs = Number(option('--arrival-jitter-ms', 0));
const playerCounts = String(option('--players', soak ? '32' : '4,16,32')).split(',').map(Number);
if (![seconds,hz,dbDelayMs,arrivalJitterMs,...playerCounts].every(Number.isFinite) || seconds < 2 || seconds > 340 || soak && seconds < 308 || hz < 1 || hz > 10 || dbDelayMs < 0 || dbDelayMs > 100 || arrivalJitterMs < 0 || arrivalJitterMs > 700 || playerCounts.some(n => !Number.isInteger(n) || n < 2 || n > 32)) throw Error('Use seconds2..340 (soak308..340), hz1..10, players2..32 comma-separated, db-delay-ms0..100, arrival-jitter-ms0..700.');
const decodeResponse = text => { const parsed = JSON.parse(text); if (parsed.room) parsed.room = decodeRoom(parsed.room); return parsed; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const teacher = { userId: 'local-pressure-fixture-teacher' };
const quantile = (v, p) => v.length ? +[...v].sort((a,b) => a-b)[Math.min(v.length-1, Math.floor(v.length*p))].toFixed(2) : null;
const distribution = v => ({ count:v.length, p50:quantile(v,.5), p95:quantile(v,.95), p99:quantile(v,.99), max:quantile(v,1) });
const hashes = Object.fromEntries(['../server/lib/multiplayer.mjs','../src/multiplayer/client.ts','../shared/multiplayer.mjs','../shared/multiplayer-wire.mjs','../server/test/d1-sqlite.mjs','./multiplayer-load.mjs'].map(path => [path,createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')]));

async function scenario(players) {
  const db = new SqliteD1();
  if (dbDelayMs) {
    const prepare = db.prepare.bind(db), batch = db.batch.bind(db);
    const wrap = s => ({ bind:(...v)=>wrap(s.bind(...v)), execute:(...v)=>s.execute(...v),
      first:async(...v)=>{const r=await s.first(...v);await sleep(dbDelayMs);return r;},
      all:async(...v)=>{const r=await s.all(...v);await sleep(dbDelayMs);return r;},
      run:async(...v)=>{const r=await s.run(...v);await sleep(dbDelayMs);return r;} });
    db.prepare = sql => wrap(prepare(sql));
    db.batch = async statements => { const r=await batch(statements);await sleep(dbDelayMs);return r; };
  }
  let origin, controlRevision = 0, jitterToken = null, jitterAt = Infinity, jitterEvent = null, eventLoopLag, gcObserver;
  const server = createServer(async(req,res)=>{
    try {
      const chunks=[];let bytes=0;
      for await(const c of req){bytes+=c.length;if(bytes>16000)throw Error('bounded request too large');chunks.push(c);}
      if(arrivalJitterMs&&!jitterEvent&&req.url==='/api/multiplayer/sync'&&req.headers['x-skybound-seat']===jitterToken&&performance.now()>=jitterAt){jitterEvent={client:0,delayMs:arrivalJitterMs,atSeconds:+((performance.now()-jitterAt+1000)/1000).toFixed(3)};await sleep(arrivalJitterMs);}
      const r=await handleMultiplayer(new Request(`${origin}${req.url}`,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}),db);
      res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());
    }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'LOCAL_HARNESS_FAILURE',detail:String(error)}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  async function direct(path,body,principal=null){
    const begin=performance.now();
    const r=await handleMultiplayer(new Request(`${origin}/api/multiplayer/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),db,{principal});
    const text=await r.text(),parsed=decodeResponse(text);if(Number.isInteger(parsed.room?.controlRevision))controlRevision=Math.max(controlRevision,parsed.room.controlRevision);return{status:r.status,body:parsed,bytes:Buffer.byteLength(text),ms:performance.now()-begin};
  }
  async function setup(path,body,principal=null){const r=await direct(path,body,principal);if(r.status!==200)throw Error(`Fixture ${path}: ${r.status} ${JSON.stringify(r.body)}`);return r.body;}
  try{
    const {code}=await setup('rooms',{durationSeconds:300},teacher),seats=[];
    for(let i=0;i<players;i++)seats.push({...await setup('join',{code,nickname:`Load fox ${i+1}`,joinKey:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')}),sequence:1,epoch:0,phase:'lobby',acks:0,ackTimes:[],budgetRebaseTimes:[],inputCycleGaps:[],inputFrameCounts:[],removed:false});
    const stats={requests:0,acks:0,retries:0,budgetRebases:0,budgetEvents:[],phaseEvents:[],phaseEventCount:0,responses:{},requestBytes:0,responseBytes:0,responseSizes:[],latencies:[],errors:[],recoveries:{epoch:0,stale:0,manual:0},teacherPolls:0,teacherErrors:[],teacherLatencies:[],teacherBytes:0,controls:[],manualReconnections:[]};
    const baseMetrics={...db.metrics};
    function phaseEvent(event){stats.phaseEventCount++;if(stats.phaseEvents.length<128)stats.phaseEvents.push(event);}
    async function post(seat,path,body){
      const begin=performance.now(),payload=JSON.stringify(body);stats.requests++;stats.requestBytes+=Buffer.byteLength(payload);
      try{
        const r=await fetch(`${origin}/api/multiplayer/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Skybound-Seat':seat.seatToken},body:payload,signal:AbortSignal.timeout(6000)});
        const text=await r.text(),bytes=Buffer.byteLength(text);stats.responseBytes+=bytes;stats.responseSizes.push(bytes);stats.responses[r.status]=(stats.responses[r.status]??0)+1;stats.latencies.push(performance.now()-begin);
        if(path==='sync'&&performance.now()-begin>250)phaseEvent({phase:'response',client:seats.indexOf(seat),sequence:body.sequence,frames:body.frames.length,durationMs:+(performance.now()-begin).toFixed(2),status:r.status});
        return{status:r.status,body:decodeResponse(text)};
      }catch(error){stats.responses.network=(stats.responses.network??0)+1;stats.latencies.push(performance.now()-begin);return{status:0,body:{error:String(error)}};}
    }
    function accept(seat,r,record=true){seat.lastGoodAt=performance.now();if(seat.epoch!==r.body.room.epoch||seat.phase!==r.body.room.status||!record)seat.inputAt=performance.now();seat.sequence=r.body.ack+1;seat.epoch=r.body.room.epoch;seat.phase=r.body.room.status;if(record){seat.acks++;seat.ackTimes.push(performance.now());stats.acks++;}}
    async function reconnect(seat){
      for(let n=0;n<4;n++){
        const r=await post(seat,'reconnect',{code});
        if(r.status===200){accept(seat,r,false);return true;}
        if(![0,429,503].includes(r.status))return false;
        stats.retries++;await sleep(30+n*30);
      }return false;
    }
    const burstStart=performance.now(),burst=await Promise.all(seats.map(s=>post(s,'sync',{code,sequence:s.sequence,epoch:s.epoch,frames:[]})));
    const initialBurst={durationMs:+(performance.now()-burstStart).toFixed(2),responses:{}};
    burst.forEach((r,i)=>{initialBurst.responses[r.status]=(initialBurst.responses[r.status]??0)+1;if(r.status===200)accept(seats[i],r);});
    for(let i=0;i<seats.length;i++)if(burst[i].status!==200){if(!await reconnect(seats[i]))throw Error(`Cannot recover initial burst seat ${i}`);}
    const start=await setup('control',{code,action:'start',revision:controlRevision,operationId:crypto.randomUUID()},teacher);
    for(const s of seats){s.epoch=start.room.epoch;s.phase='running';s.inputAt=performance.now();s.ackTimes=[];s.acks=0;}
    await sleep(250);
    const startAt=performance.now(),duration=seconds*1000,period=1000/hz,removedId=seats.at(-1).playerId;
    eventLoopLag=monitorEventLoopDelay({resolution:10});eventLoopLag.enable();
    const cpuStart=process.cpuUsage(),eluStart=performance.eventLoopUtilization(),heapStart=process.memoryUsage().heapUsed;
    const gcStats={count:0,totalMs:0,maxMs:0,largestEvents:[]};
    gcObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries()){gcStats.count++;gcStats.totalMs+=entry.duration;gcStats.maxMs=Math.max(gcStats.maxMs,entry.duration);gcStats.largestEvents.push({atSeconds:+((entry.startTime-startAt)/1000).toFixed(3),durationMs:+entry.duration.toFixed(3),kind:entry.detail?.kind??null});gcStats.largestEvents.sort((a,b)=>b.durationMs-a.durationMs);gcStats.largestEvents.length=Math.min(32,gcStats.largestEvents.length);}});gcObserver.observe({entryTypes:['gc']});
    jitterToken=seats[0].seatToken;jitterAt=startAt+1000;
    const schedule=soak?[{at:30/seconds,action:'pause'},{at:35/seconds,action:'resume'},{at:60/seconds,action:'lock',locked:true},{at:90/seconds,action:'lock',locked:false},{at:120/seconds,action:'remove',playerId:removedId}]:[{at:.22,action:'pause'},{at:.32,action:'resume'},{at:.5,action:'lock',locked:true},{at:.6,action:'lock',locked:false},{at:.75,action:'remove',playerId:removedId}];
    const controls=(async()=>{
      for(const event of schedule){await sleep(Math.max(0,startAt+duration*event.at-performance.now()));
        const {at,...action}=event;const begin=performance.now(),controlBody={code,...action,revision:controlRevision,operationId:crypto.randomUUID()};const attempts=[];let result;
        for(let n=0;n<4;n++){result=await direct('control',controlBody,teacher);attempts.push({status:result.status,ms:+result.ms.toFixed(2),error:result.body.error??null});if(result.status===200||![429,503].includes(result.status))break;await sleep(50+n*50);}
        stats.controls.push({action:event.action,scheduledFraction:at,latencyMs:+(performance.now()-begin).toFixed(2),status:result.status,attempts});
      }
    })();
    const teacherPolling=(async()=>{while(performance.now()-startAt<duration){const begin=performance.now();const r=await direct('state',{code},teacher);stats.teacherPolls++;stats.teacherLatencies.push(r.ms);stats.teacherBytes+=r.bytes;if(r.status!==200)stats.teacherErrors.push({status:r.status,error:r.body.error});if(soak&&r.body.room?.status==='ended')break;await sleep(Math.max(0,500-(performance.now()-begin)));}})();
    const clientTasks=seats.map(async(seat,index)=>{
      await sleep(index*period/players);
      while(performance.now()-startAt<duration&&!seat.removed&&seat.phase!=='ended'){
        if(soak&&index===0&&!seat.manualReconnect&&performance.now()-startAt>=150000){
          seat.manualReconnect=true;const beforeAck=seat.sequence-1,at=performance.now()-startAt;
          await sleep(1250);const ok=await reconnect(seat);
          stats.manualReconnections.push({client:index,startedAtSeconds:+(at/1000).toFixed(3),disconnectedMs:1250,success:ok,ackBefore:beforeAck,ackAfter:seat.sequence-1});
          if(!ok){stats.errors.push({client:index,error:'EXPLICIT_SOAK_RECONNECT_FAILED'});break;}
          stats.recoveries.manual++;await sleep(period);continue;
        }
        const cycle=performance.now(),input={forward:Math.floor((cycle-startAt)/2000)%2?-1:1,right:0,yaw:index*Math.PI*2/players,jump:false,glide:false,slide:false};
        const body={code,sequence:seat.sequence,epoch:seat.epoch,frames:seat.phase==='running'?Array.from({length:Math.min(30,Math.max(0,Math.floor((cycle-seat.inputAt)*60/1000)))},()=>({...input})):[]};
        if(seat.previousCycle!==undefined)seat.inputCycleGaps.push(cycle-seat.previousCycle);seat.previousCycle=cycle;seat.inputFrameCounts.push(body.frames.length);
        if(cycle-seat.inputAt>300)phaseEvent({phase:'input',client:index,sequence:body.sequence,frames:body.frames.length,atSeconds:+((cycle-startAt)/1000).toFixed(3),inputElapsedMs:+(cycle-seat.inputAt).toFixed(2),lastAckAgeMs:+(cycle-seat.lastGoodAt).toFixed(2)});
        seat.inputAt=cycle;
        let result,recovered=false,lastAttemptAt=cycle;
        for(let attempt=0;attempt<8;attempt++){
          const attemptAt=performance.now();lastAttemptAt=attemptAt;
          result=await post(seat,'sync',body);
          if(result.status===200){accept(seat,result);break;}
          if(result.status===409&&result.body.error==='INPUT_TOO_FAST'){
            const at=performance.now(),recent=seat.budgetRebaseTimes.filter(t=>at-t<10000);
            const allowed=at-seat.lastGoodAt<=1000&&recent.length<2;
            const event={client:index,sequence:body.sequence,frames:body.frames.length,atSeconds:+((at-startAt)/1000).toFixed(3),lastAckAgeMs:+(at-seat.lastGoodAt).toFixed(2),allowed,success:false};stats.budgetEvents.push(event);
            if(!allowed)break;
            seat.budgetRebaseTimes.push(at);stats.budgetRebases++;
            // Reject + unsent catch-up is discarded only by an authoritative
            // reconnect. Its acknowledgment remains unchanged; next input
            // begins after the normal200ms gate, not from disconnected time.
            recovered=await reconnect(seat);event.success=recovered;break;
          }
          if(result.status===409&&['STALE_EPOCH','RECONNECT_REQUIRED'].includes(result.body.error)){
            stats.recoveries[result.body.error==='STALE_EPOCH'?'epoch':'stale']++;recovered=await reconnect(seat);break;
          }
          if(result.status===403&&result.body.error==='SEAT_REMOVED'&&seat.playerId===removedId){seat.removed=true;break;}
          if(![0,429,503].includes(result.status))break;
          stats.retries++;await sleep(25+attempt*25+index%7);
        }
        if(result.status!==200&&!recovered&&!seat.removed){if(stats.errors.length<64)stats.errors.push({client:index,sequence:seat.sequence,...result});break;}
        // Reconnect clears earned movement credit. Allow a full input interval
        // rather than replaying disconnected backlog or immediately overspending.
        await sleep(recovered?period:Math.max(0,period-(performance.now()-lastAttemptAt)));
      }
    });
    await Promise.all([...clientTasks,teacherPolling,controls]);
    const elapsed=performance.now()-startAt;eventLoopLag.disable();gcObserver.disconnect();
    const cpu=process.cpuUsage(cpuStart),elu=performance.eventLoopUtilization(eluStart);
    const runtimeDiagnostics={scope:'Single-process local HTTP clients, server simulation, SQLite and wire decoder; NOT isolated browser or hosted Worker CPU',eventLoopLagMs:{max:+(eventLoopLag.max/1e6).toFixed(3),p95:+(eventLoopLag.percentile(95)/1e6).toFixed(3),p99:+(eventLoopLag.percentile(99)/1e6).toFixed(3),mean:+(eventLoopLag.mean/1e6).toFixed(3)},eventLoopUtilization:elu,cpuMs:{user:cpu.user/1000,system:cpu.system/1000,total:(cpu.user+cpu.system)/1000},heapBytes:{start:heapStart,end:process.memoryUsage().heapUsed},gc:{...gcStats,totalMs:+gcStats.totalMs.toFixed(3),maxMs:+gcStats.maxMs.toFixed(3)},phaseEvents:{total:stats.phaseEventCount,recorded:stats.phaseEvents.length,limit:128,events:stats.phaseEvents}};
    const final=await setup('state',{code},teacher),finalPlayers=final.room.players.filter(p=>p.active!==false);
    let terminalStability=null,postEndProbe=null;
    if(soak){
      const beforeRequests=stats.requests;await sleep(1000);const later=await setup('state',{code},teacher);
      terminalStability={observationMs:1000,statusBefore:final.room.status,statusAfter:later.room.status,remainingBefore:final.room.remainingMs,remainingAfter:later.room.remainingMs,winner:later.room.winner,scoresUnchanged:JSON.stringify(final.room.scores)===JSON.stringify(later.room.scores),versionUnchanged:final.room.version===later.room.version,playerRequestsAfterEnd:stats.requests-beforeRequests};
      const probeSeat=seats[0],beforeProbe=await post(probeSeat,'state',{code}),pose=p=>JSON.stringify(['x','y','z','vx','vy','vz','yaw','grounded','gliding','sliding'].map(k=>p?.[k])),beforePose=pose(beforeProbe.body.room.players.find(p=>p.id===probeSeat.playerId));
      const statuses=[];let lastProbe;
      for(let n=0;n<3;n++){lastProbe=await post(probeSeat,'sync',{code,sequence:probeSeat.sequence,epoch:later.room.epoch,frames:Array.from({length:12},()=>({forward:1,right:1,yaw:2,jump:true,glide:true,slide:false}))});statuses.push(lastProbe.status);if(lastProbe.status===200)accept(probeSeat,lastProbe,false);}
      const probed=lastProbe.body.room;
      postEndProbe={diagnosticOnly:true,movementPackets:3,framesPerPacket:12,statuses,poseUnchanged:!!probed&&pose(probed.players.find(p=>p.id===probeSeat.playerId))===beforePose,scoresUnchanged:!!probed&&JSON.stringify(probed.scores)===JSON.stringify(later.room.scores),remainingUnchanged:!!probed&&probed.remainingMs===0,winnerUnchanged:!!probed&&probed.winner===later.room.winner};
    }
    const gaps=seats.flatMap(s=>s.ackTimes.slice(1).map((at,i)=>at-s.ackTimes[i]));
    const clientCadence=seats.map((s,index)=>{const g=s.ackTimes.slice(1).map((at,i)=>at-s.ackTimes[i]);return{client:index,acknowledgedInputs:s.acks,removed:s.removed,ackGapMs:distribution(g),inputCycleGapMs:distribution(s.inputCycleGaps),inputFrameCounts:distribution(s.inputFrameCounts),budgetRebases:s.budgetRebaseTimes.length,budgetRollingLimitPassed:s.budgetRebaseTimes.every((at,i)=>s.budgetRebaseTimes.filter(t=>t<=at&&at-t<10000).length<=2),observedAckHz:s.ackTimes.length>1?+((s.ackTimes.length-1)*1000/(s.ackTimes.at(-1)-s.ackTimes[0])).toFixed(3):0};});
    const arrivalJitterRecoveryPassed=!arrivalJitterMs||!!jitterEvent&&stats.budgetEvents.some(e=>e.client===0&&e.success);
    const responsivenessPassed=arrivalJitterRecoveryPassed&&clientCadence.every(c=>c.observedAckHz>=4.7&&c.budgetRebases<=6&&c.budgetRollingLimitPassed);
    const controlsPassed=stats.controls.length===schedule.length&&stats.controls.every(c=>c.status===200);
    const scoreDifference=final.room.scores.red-final.room.scores.blue,expectedWinner=Math.abs(scoreDifference)<1e-8?'tie':scoreDifference>0?'red':'blue';
    const lifecyclePassed=stats.errors.length===0&&stats.teacherErrors.length===0&&controlsPassed&&finalPlayers.length===players-1&&seats.at(-1).removed&&(!soak||(final.room.status==='ended'&&final.room.remainingMs===0&&['red','blue','tie'].includes(final.room.winner)&&terminalStability.scoresUnchanged&&terminalStability.versionUnchanged&&terminalStability.playerRequestsAfterEnd===0&&stats.recoveries.manual===1&&final.room.winner===expectedWinner&&postEndProbe.statuses.every(s=>s===200)&&postEndProbe.poseUnchanged&&postEndProbe.scoresUnchanged&&postEndProbe.remainingUnchanged&&postEndProbe.winnerUnchanged));
    return{evidence:'LOCAL Node HTTP + production SQL on SQLite; teacher uses injected test principal, NOT browser sign-in. Synthetic DB result delays are not measured D1 latency.',sourceSha256:hashes,
      players,hz,soak,syntheticDatabaseCallDelayMs:dbDelayMs,delayPolicy:'After first/all/run results and once per atomic batch result',requestedDurationSeconds:seconds,measuredWorkloadSeconds:+(elapsed/1000).toFixed(3),
      httpRequests:stats.requests,acknowledgedInputs:stats.acks,responses:stats.responses,retries:stats.retries,budgetRebases:stats.budgetRebases,budgetEvents:stats.budgetEvents,arrivalJitter:jitterEvent,arrivalJitterRecoveryPassed,recoveries:stats.recoveries,
      payloadBytes:{scope:'Raw protocol-v2 uncompressed JSON bodies, measured BEFORE decode; excludes HTTP/TLS headers',targetP95Bytes:4096,targetP95Passed:quantile(stats.responseSizes,.95)<=4096,requests:stats.requestBytes,responses:stats.responseBytes,total:stats.requestBytes+stats.responseBytes,response:distribution(stats.responseSizes),teacherResponses:stats.teacherBytes},
      runtimeDiagnostics,latencyMs:distribution(stats.latencies),ackGapMs:distribution(gaps),clientCadence,initialSynchronizedBurst:initialBurst,
      teacher:{directTrustedFixturePolls:stats.teacherPolls,targetHz:2,latencyMs:distribution(stats.teacherLatencies),errors:stats.teacherErrors,controls:stats.controls},
      sql:Object.fromEntries(Object.entries(db.metrics).map(([k,v])=>[k,v-(baseMetrics[k]??0)])),
      finalStatus:final.room.status,finalRemainingMs:final.room.remainingMs,winner:final.room.winner,winnerMatchesScores:final.room.winner===expectedWinner,terminalStability,postEndProbe,manualReconnections:stats.manualReconnections,expectedSeatCount:players-1,finalSeatCount:finalPlayers.length,removedSeatConfirmed:!finalPlayers.some(p=>p.id===removedId),errors:stats.errors,
      lifecyclePass:lifecyclePassed,responsivenessPass:responsivenessPassed,pass:lifecyclePassed&&responsivenessPassed};
  }finally{eventLoopLag?.disable();gcObserver?.disconnect();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}
const results=[];for(const players of playerCounts){const r=await scenario(players);results.push(r);console.log(JSON.stringify(r));}if(results.some(r=>!r.pass))process.exitCode=1;
