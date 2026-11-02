#!/usr/bin/env node
/** Local CPU/byte microbenchmark, not browser/device/GPU acceptance. */
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRoomState,createPlayer,stepPlayer,publicRoom} from '../shared/multiplayer.mjs';
import {encodeRoom,decodeRoom} from '../shared/multiplayer-wire.mjs';
const iterations=5000;
function sample(nickname='QA Fox'){
 const r={...createRoomState(1700000000000),code:'ABCDEF',epoch:4,version:8,status:'running'};
 r.players=Array.from({length:32},(_,i)=>({...createPlayer(i%2?'blue':'red'),id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,nickname,active:true,seq:123,lastSeenMs:r.lastTickMs}));
 for(let i=0;i<32;i++)for(let t=0;t<89;t++)stepPlayer(r.players[i],{forward:1,right:i%3-1,yaw:i*.13456789,jump:t===1,glide:t>20,slide:false},1/60);
 return{...publicRoom(r,r.players[0].id),snapshotMs:r.lastTickMs,controlRevision:7};
}
let sink;
function measure(fn){for(let i=0;i<500;i++)sink=fn();const times=[];const start=performance.now();for(let i=0;i<iterations;i++){const t=performance.now();sink=fn();times.push((performance.now()-t)*1000);}const totalMs=performance.now()-start;times.sort((a,b)=>a-b);return{iterations,totalMs:+totalMs.toFixed(3),microseconds:{p50:+times[Math.floor(iterations*.5)].toFixed(3),p95:+times[Math.floor(iterations*.95)].toFixed(3),p99:+times[Math.floor(iterations*.99)].toFixed(3),max:+times.at(-1).toFixed(3)}};}
const plain=sample(),old=JSON.stringify(plain),wire=JSON.stringify(encodeRoom(plain)),worst=JSON.stringify(encodeRoom(sample('界'.repeat(24))));
const hashes=Object.fromEntries(['../shared/multiplayer.mjs','../shared/multiplayer-wire.mjs','./multiplayer-wire-bench.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex')]));
console.log(JSON.stringify({evidence:'Local Node CPU microbenchmark with deterministic32-runner simulated fixture. Not actual browser, school laptop, network or hosted D1 measurement. Timing includes GC/outliers; no compression.',sourceSha256:hashes,bytes:{legacyRoom:Buffer.byteLength(old),wireRoom:Buffer.byteLength(wire),worst24CjkNicknameWireRoom:Buffer.byteLength(worst)},legacyParse:measure(()=>JSON.parse(old)),wireParse:measure(()=>JSON.parse(wire)),wireParseAndStrictDecode:measure(()=>decodeRoom(JSON.parse(wire))),serverPack:measure(()=>encodeRoom(plain)),serverPackAndStringify:measure(()=>JSON.stringify(encodeRoom(plain)))}));
if(!sink)throw Error('benchmark produced no result');
