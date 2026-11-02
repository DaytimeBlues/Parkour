import {appearanceCode,appearanceFromCode,validAppearance} from './appearance.mjs';
/** Versioned, self-contained presentation wire format. Never used for authority.
 * Own physics state stays full precision; only remote display poses are quantized.
 * No roster cache, ordering-dependent slots, credentials or schema migration.
 */
export const WIRE_VERSION = 3;
const ownKeys = ['id','nickname','team','active','x','y','z','vx','vy','vz','yaw','grounded','gliding','sliding','glideRemaining','padCooldown','falls','connected','seq','lastSeenMs'];
const roomKeys = ['wireVersion','code','epoch','version','status','serverTime','snapshotMs','remainingMs','durationMs','scores','winner','locked','teacher','controlRevision','zones','own','peers'];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
export function encodeRoom(room, viewerPlayerId = room.viewerPlayerId, version = WIRE_VERSION) {
  if (version !== 2 && version !== 3) throw new Error('UNSUPPORTED_MULTIPLAYER_WIRE_VERSION');
  const own = room.players.find(p => p.id === viewerPlayerId);
  return {
    wireVersion: version, code: room.code, epoch: room.epoch, version: room.version,
    status: room.status, serverTime: room.serverTime, snapshotMs: room.snapshotMs,
    remainingMs: room.remainingMs, durationMs: room.durationMs,
    scores: { red: room.scores.red, blue: room.scores.blue }, winner: room.winner,
    locked: room.locked, teacher: room.teacher, controlRevision: room.controlRevision,
    zones: room.zones.map(z => ({ id:z.id, owner:z.owner, progress:z.progress, counts:{red:z.counts.red,blue:z.counts.blue}, contested:z.contested })),
    own: own ? {...pick(own, ownKeys), ...(version === 3 ? {appearance: appearanceCode(own.appearance)} : {})} : null,
    peers: room.players.filter(p => p !== own).map(p => [p.id,p.nickname,p.team==='red'?0:1,
      Math.round(p.x*100),Math.round(p.y*100),Math.round(p.z*100),Math.round(p.yaw*1000),Math.round(Math.hypot(p.vx,p.vz)*100),
      Number(p.grounded)|(Number(p.gliding)<<1)|(Number(p.sliding)<<2)|(Number(p.connected)<<3), ...(version === 3 ? [appearanceCode(p.appearance)] : [])]),
  };
}
const invalid = () => { throw new Error('INVALID_MULTIPLAYER_WIRE'); };
const exact = (x, keys) => { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length!==keys.length || keys.some(k=>!Object.hasOwn(x,k))) invalid(); };
const number = (x, min=-1e9, max=1e9) => { if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)invalid(); };
const integer = (x, min=0, max=Number.MAX_SAFE_INTEGER) => { number(x,min,max);if(!Number.isSafeInteger(x))invalid(); };
const bool = x => { if(typeof x!=='boolean')invalid(); };
const text = (x,min,max) => { if(typeof x!=='string'||x.length<min||x.length>max)invalid(); };
const team = x => { if(x!=='red'&&x!=='blue')invalid(); };
function validateOwn(p, version) {
  exact(p,version === 3 ? [...ownKeys,'appearance'] : ownKeys);
  if (version === 3) integer(p.appearance,0,255);text(p.id,1,64);text(p.nickname,1,24);team(p.team);
  if(p.active!==true)invalid();
  for(const k of ['x','y','z','vx','vy','vz','yaw'])number(p[k]);
  for(const k of ['glideRemaining','padCooldown'])number(p[k],0);
  for(const k of ['grounded','gliding','sliding','connected'])bool(p[k]);
  integer(p.falls);integer(p.seq);integer(p.lastSeenMs);
}
/** Strict untrusted-wire decoder. No cache or shared mutation before freshness checks. */
export function decodeRoom(wire) {
  if(!wire||![2,3].includes(wire.wireVersion))throw new Error('UNSUPPORTED_MULTIPLAYER_WIRE_VERSION');
  exact(wire,roomKeys);text(wire.code,6,6);if(!/^[A-Z0-9]{6}$/.test(wire.code))invalid();
  for(const k of ['epoch','version','serverTime','snapshotMs','controlRevision'])integer(wire[k]);
  if(!['lobby','running','paused','ended'].includes(wire.status))invalid();
  integer(wire.durationMs,30000,1800000);number(wire.remainingMs,0,wire.durationMs);
  exact(wire.scores,['red','blue']);number(wire.scores.red,0);number(wire.scores.blue,0);
  if(![null,'red','blue','tie'].includes(wire.winner))invalid();bool(wire.locked);bool(wire.teacher);
  if(!Array.isArray(wire.zones)||wire.zones.length>5)invalid();const zoneIds=new Set();
  for(const z of wire.zones){exact(z,['id','owner','progress','counts','contested']);text(z.id,1,64);if(zoneIds.has(z.id))invalid();zoneIds.add(z.id);if(z.owner!==null)team(z.owner);number(z.progress,-5000,5000);exact(z.counts,['red','blue']);integer(z.counts.red,0,32);integer(z.counts.blue,0,32);if(z.counts.red+z.counts.blue>32)invalid();bool(z.contested);}
  if(!Array.isArray(wire.peers)||wire.peers.length+(wire.own?1:0)>32)invalid();
  const players=[],ids=new Set();if(wire.own!==null){validateOwn(wire.own,wire.wireVersion);if(wire.teacher)invalid();players.push({...wire.own,appearance: wire.wireVersion === 3 ? appearanceFromCode(wire.own.appearance) : validAppearance(null)});ids.add(wire.own.id);}
  for(const p of wire.peers){
    if(!Array.isArray(p)||p.length!==(wire.wireVersion === 3 ? 10 : 9))invalid();text(p[0],1,64);text(p[1],1,24);integer(p[2],0,1);
    for(let i=3;i<=6;i++)integer(p[i],-1e8,1e8);integer(p[7],0,1e6);integer(p[8],0,15);if(wire.wireVersion === 3)integer(p[9],0,255);
    if(ids.has(p[0]))invalid();ids.add(p[0]);const flags=p[8];
    // vx is display speed, not an authoritative velocity. Only own is replayed.
    players.push({appearance: wire.wireVersion === 3 ? appearanceFromCode(p[9]) : validAppearance(null),id:p[0],nickname:p[1],team:p[2]===0?'red':'blue',active:true,x:p[3]/100,y:p[4]/100,z:p[5]/100,yaw:p[6]/1000,vx:p[7]/100,vy:0,vz:0,grounded:!!(flags&1),gliding:!!(flags&2),sliding:!!(flags&4),connected:!!(flags&8),glideRemaining:0,padCooldown:0,falls:0});
  }
  const {wireVersion,own,peers,...room}=wire;
  return {...room,scores:{...wire.scores},zones:wire.zones.map(z=>({...z,counts:{...z.counts}})),players,viewerPlayerId:own?.id??null};
}
