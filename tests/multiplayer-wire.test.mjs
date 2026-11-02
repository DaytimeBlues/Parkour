import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomState,createPlayer,publicRoom,stepPlayer,ARENA} from '../shared/multiplayer.mjs';
import {encodeRoom,decodeRoom} from '../shared/multiplayer-wire.mjs';
function sample(count=32,nickname='QA Fox'){
 const r={...createRoomState(1700000000000),code:'ABCDEF',epoch:4,version:8,status:'running'};
 r.players=Array.from({length:count},(_,i)=>({...createPlayer(i%2?'blue':'red'),id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,nickname,active:true,seq:123,lastSeenMs:r.lastTickMs}));
 for(let i=0;i<count;i++)for(let t=0;t<89;t++)stepPlayer(r.players[i],{forward:1,right:i%3-1,yaw:i*.13456789,jump:t===1,glide:t>20,slide:false},1/60);
 return{...publicRoom(r,r.players[0]?.id),snapshotMs:r.lastTickMs,controlRevision:7};
}
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
test('wire3 own state and authority fields remain exact; remote positions/yaw/speed have bounded display error',()=>{
 const source=sample(),wire=encodeRoom(source),decoded=decodeRoom(JSON.parse(JSON.stringify(wire)));
 assert.deepEqual(decoded.players[0],source.players[0]);
 for(const k of['code','epoch','version','status','remainingMs','durationMs','scores','winner','locked','teacher','controlRevision','serverTime','snapshotMs','zones'])assert.deepEqual(decoded[k],source[k]);
 for(const p of source.players.slice(1)){const q=decoded.players.find(q=>q.id===p.id);for(const k of['x','y','z'])assert.ok(Math.abs(q[k]-p[k])<=.005+1e-12);assert.ok(Math.abs(q.yaw-p.yaw)<=.0005+1e-12);assert.ok(Math.abs(Math.hypot(q.vx,q.vz)-Math.hypot(p.vx,p.vz))<=.005+1e-12);for(const k of['id','nickname','team','active','connected','grounded','gliding','sliding'])assert.equal(q[k],p[k]);}
});
test('wire3 preserves valid authority yaw ±1000 and actual physics boundary poses',()=>{
 const source=sample(2);for(const yaw of[-1000,1000]){for(const p of source.players){p.yaw=yaw;p.x=ARENA.bounds.minX;p.z=ARENA.bounds.maxZ;}const decoded=decodeRoom(encodeRoom(source));assert.equal(decoded.players[0].yaw,yaw);assert.equal(decoded.players[1].yaw,yaw);}
});
test('32-runner typical snapshot ≤4KiB; worst permitted Unicode nickname ≤6KiB including own state',()=>{
 assert.ok(bytes(encodeRoom(sample()))<=4096);const worst=sample(32,'界'.repeat(24));assert.ok(bytes(encodeRoom(worst))<=6144);assert.equal(decodeRoom(encodeRoom(worst)).players.length,32);
});
test('teacher and empty-lobby snapshots are self-contained with no own or roster cache',()=>{
 const source=sample();source.teacher=true;source.viewerPlayerId=null;const decoded=decodeRoom(encodeRoom(source));assert.equal(decoded.viewerPlayerId,null);assert.equal(decoded.players.length,32);const empty=sample(0);assert.equal(decodeRoom(encodeRoom(empty)).players.length,0);
});
test('wire packing is an explicit secret-free allowlist even if caller accidentally adds private fields',()=>{
 const source=sample(2);source.tokenHash='PRIVATE';source.controlReceipts=['PRIVATE'];for(const p of source.players){p.tokenHash='PRIVATE';p.joinKey='PRIVATE';p.creditMs=999;}const raw=JSON.stringify(encodeRoom(source));assert.ok(!raw.includes('PRIVATE'));assert.ok(!raw.includes('creditMs'));assert.ok(!raw.includes('controlReceipts'));
});
test('wire decoder rejects unsupported/missing versions and exact object/tuple schema violations',()=>{
 const base=encodeRoom(sample(2));for(const version of[undefined,1,4,'2'])assert.throws(()=>decodeRoom({...base,wireVersion:version}),/UNSUPPORTED/);
 const changes=[w=>{w.extra=1;},w=>{delete w.epoch;},w=>{w.peers[0].push(0);},w=>{w.peers[0].pop();},w=>{w.peers[0][8]=16;},w=>{w.peers[0][2]=2;},w=>{w.peers[0][3]=1.2;},w=>{w.peers[0][3]=Infinity;},w=>{w.peers[0][3]=1e9;},w=>{w.peers[0][1]='x'.repeat(25);},w=>{w.peers[0][0]=w.own.id;},w=>{w.peers.push([...w.peers[0]]);},w=>{w.own.x=NaN;},w=>{w.own.extra=0;},w=>{delete w.own.seq;},w=>{w.teacher=true;},w=>{w.zones[0].counts.red=33;},w=>{w.zones[0].progress=5001;},w=>{w.status='invented';}];for(const change of changes){const w=structuredClone(base);change(w);assert.throws(()=>decodeRoom(w),/INVALID/);}
});
test('decoding is stateless and does not mutate prior room or share own/zone authority objects',()=>{
 const wire=encodeRoom(sample(2)),a=decodeRoom(wire);a.players[0].x=999;a.scores.red=999;a.zones[0].counts.red=999;const b=decodeRoom(wire);assert.notEqual(b.players[0].x,999);assert.notEqual(b.scores.red,999);assert.notEqual(b.zones[0].counts.red,999);const other=encodeRoom({...sample(1),code:'OTHER1',epoch:1});assert.equal(decodeRoom(other).code,'OTHER1');assert.equal(decodeRoom(wire).epoch,4);
});
