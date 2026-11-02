import {validAppearance} from './appearance.mjs';
/** Shared, dependency-free arena physics and authoritative match rules.
 * Positions are feet coordinates. Boxes use centre coordinates. There are no
 * player/player colliders. Never accept client coordinates as room authority.
 */
// New admissions only; legacy rooms retain existing seats and the 32-seat wire bound.
export const ROOM_CAPACITY = 8;
export const STEP = 1 / 60;
export const STALE_MS = 1000;
export const CAPTURE_MS = 5000;
export const PLAYER = Object.freeze({ radius: .35, height: 1.7, slideHeight: .85, eye: 1.5, slideEye: .65, speed: 7.2, jump: 8.2, gravity: 21 });
export const TEAMS = Object.freeze({ red: { color: 0xef675d, label: 'RED · TRIANGLE', shape: 'triangle' }, blue: { color: 0x50b8f5, label: 'BLUE · SQUARE', shape: 'square' } });
const boxes = [];
const box = (id, x, top, z, w, h, d, color = 0x697e9c) => boxes.push({ id, x, y: top - h / 2, z, w, h, d, color });
box('fortress-deck', 0, 0, 0, 128, 3, 96, 0x899aae);
box('crown-deck', 0, 14, 0, 24, 1, 24, 0xb0bfd0);
box('north-deck', 0, 8, -32, 20, 1, 16, 0x9cacbf);
// Small regular steps, not invisible ramps: identical render/collision geometry.
for (let n = 0; n < 50; n++) box(`crown-stair-${n}`, 9, (n + 1) * .28, 41.7 - n * .6, 4, (n + 1) * .28, .62, 0xd0ae6e);
for (let n = 0; n < 32; n++) box(`north-stair-${n}`, -6, (n + 1) * .25, -6.28 - n * .5625, 4, (n + 1) * .25, .58, 0xd0ae6e);
for (const side of [-1, 1]) {
  const x = side * 31;
  box(`tunnel-roof-${side}`, x, 1.6, 0, 18, .5, 8, 0x66758a);
  for (const z of [-4.6, 4.6]) box(`tunnel-side-${side}-${z}`, x, 3, z, 18, 3, 1.2, 0x66758a);
  for (const z of [-18, 18]) {
    box(`cover-${side}-${z}`, side * 35, 3, z, 7, 3, 2, 0x63728b);
    box(`cover-end-${side}-${z}`, side * 39, 3, z + 3, 2, 3, 8, 0x63728b);
  }
  box(`bastion-${side}`, side * 55, 2.4, -36, 8, 2.4, 8, 0x8393a8);
  for (let n = 0; n < 8; n++) box(`bastion-stair-${side}-${n}`, side * 55, (n + 1) * .3, -27.5 - n * .6, 4, (n + 1) * .3, .62, 0xd0ae6e);
}
export const ARENA = Object.freeze({
  name: 'Cloudkeep Fortress', boxes,
  bounds: { minX: -64, maxX: 64, minZ: -48, maxZ: 48, minY: -20, maxY: 70 },
  spawns: { red: { x: -55, y: .02, z: 35 }, blue: { x: 55, y: .02, z: 35 } },
  zones: [
    { id: 'west', label: 'WEST COURT', shape: 'circle', x: -43, y: 0, z: -25, radius: 5 },
    { id: 'east', label: 'EAST COURT', shape: 'square', x: 43, y: 0, z: -25, radius: 5 },
    { id: 'garden', label: 'GARDEN', shape: 'diamond', x: -20, y: 0, z: 30, radius: 5 },
    { id: 'north', label: 'NORTH TOWER', shape: 'triangle', x: 0, y: 8, z: -32, radius: 4.5 },
    { id: 'crown', label: 'CROWN', shape: 'pentagon', x: 0, y: 14, z: 0, radius: 5 },
  ],
  pads: [
    { id: 'west-launch', kind: 'launch', x: -15, y: 0, z: 13, radius: 2.6, lift: 26 },
    { id: 'east-launch', kind: 'launch', x: 15, y: 0, z: 13, radius: 2.6, lift: 26 },
    { id: 'north-updraft', kind: 'updraft', x: 16, y: 0, z: -26, radius: 3, lift: 12, ceiling: 20 },
    { id: 'west-updraft', kind: 'updraft', x: -17, y: 0, z: -5, radius: 3, lift: 12, ceiling: 22 },
  ],
});

export function createPlayer(team = 'red') {
  const spawn = ARENA.spawns[team] || ARENA.spawns.red;
  return { ...spawn, team, vx: 0, vy: 0, vz: 0, yaw: team === 'red' ? -Math.PI / 2 : Math.PI / 2,
    grounded: true, gliding: false, sliding: false, glideRemaining: 0, padCooldown: 0, falls: 0 };
}
const extents = b => ({ l: b.x - b.w / 2, r: b.x + b.w / 2, back: b.z - b.d / 2, front: b.z + b.d / 2, bottom: b.y - b.h / 2, top: b.y + b.h / 2 });
const overlaps = (a, b, c, d) => a < d - 1e-7 && b > c + 1e-7;
function headClear(p, height, y = p.y, x = p.x, z = p.z) {
  return !ARENA.boxes.some(b => { const e = extents(b); return overlaps(x - PLAYER.radius, x + PLAYER.radius, e.l, e.r) && overlaps(z - PLAYER.radius, z + PLAYER.radius, e.back, e.front) && overlaps(y + .02, y + height, e.bottom, e.top); });
}
function moveHorizontal(p, axis, amount, height) {
  const other = axis === 'x' ? 'z' : 'x', radius = PLAYER.radius, prior = p[axis];
  let next = prior + amount;
  for (const b of ARENA.boxes) {
    const e = extents(b), lo = axis === 'x' ? e.l : e.back, hi = axis === 'x' ? e.r : e.front;
    const otherLo = axis === 'x' ? e.back : e.l, otherHi = axis === 'x' ? e.front : e.r;
    if (!overlaps(p[other] - radius, p[other] + radius, otherLo, otherHi) || !overlaps(next - radius, next + radius, lo, hi) || !overlaps(p.y + .02, p.y + height, e.bottom, e.top)) continue;
    const rise = e.top - p.y;
    if (p.grounded && rise > -.02 && rise <= .305 && headClear(p, height, e.top + .001, axis === 'x' ? next : p.x, axis === 'z' ? next : p.z)) { p.y = e.top + .001; continue; }
    if (amount > 0 && prior + radius <= lo + .03) next = Math.min(next, lo - radius);
    else if (amount < 0 && prior - radius >= hi - .03) next = Math.max(next, hi + radius);
    else next = prior;
  }
  p[axis] = next;
}

/** One ordinary fixed simulation step; input validation belongs to the API. */
export function stepPlayer(p, input, dt = STEP) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > STEP + 1e-8) throw new RangeError('fixed step required');
  p.yaw = input.yaw;
  p.padCooldown = Math.max(0, (p.padCooldown || 0) - dt);
  const wantsSlide = !!input.slide;
  p.sliding = wantsSlide || !headClear(p, PLAYER.height);
  const height = p.sliding ? PLAYER.slideHeight : PLAYER.height;
  if (input.jump && p.grounded && !p.sliding) { p.vy = PLAYER.jump; p.grounded = false; }
  for (const pad of ARENA.pads) {
    if (Math.hypot(p.x - pad.x, p.z - pad.z) > pad.radius) continue;
    if (pad.kind === 'launch' && p.grounded && p.y >= pad.y - .1 && p.y < pad.y + .3 && p.padCooldown <= 0) {
      p.vy = pad.lift; p.grounded = false; p.glideRemaining = 5; p.padCooldown = 1;
    } else if (pad.kind === 'updraft' && input.glide && p.y >= pad.y - .1 && p.y < pad.ceiling) {
      p.vy = pad.lift; p.grounded = false; p.glideRemaining = 5;
    }
  }
  p.gliding = !!input.glide && !p.grounded && p.glideRemaining > 0;
  if (p.gliding) p.glideRemaining = Math.max(0, p.glideRemaining - dt);
  p.vy -= PLAYER.gravity * dt;
  if (p.gliding && p.vy < -2.4) p.vy = -2.4;
  let f = input.forward, r = input.right; const norm = Math.hypot(f, r);
  if (norm > 1) { f /= norm; r /= norm; }
  const speed = p.gliding ? 12 : p.sliding ? 6 : PLAYER.speed;
  p.vx = (Math.cos(p.yaw) * r - Math.sin(p.yaw) * f) * speed;
  p.vz = (-Math.sin(p.yaw) * r - Math.cos(p.yaw) * f) * speed;
  moveHorizontal(p, 'x', p.vx * dt, height); moveHorizontal(p, 'z', p.vz * dt, height);
  const oldY = p.y, dy = p.vy * dt; let nextY = oldY + dy;
  p.grounded = false;
  for (const b of ARENA.boxes) {
    const e = extents(b);
    if (!overlaps(p.x - PLAYER.radius, p.x + PLAYER.radius, e.l, e.r) || !overlaps(p.z - PLAYER.radius, p.z + PLAYER.radius, e.back, e.front)) continue;
    if (dy <= 0 && oldY >= e.top - .03 && nextY <= e.top) { nextY = Math.max(nextY, e.top); p.vy = 0; p.grounded = true; }
    if (dy > 0 && oldY + height <= e.bottom + .001 && nextY + height >= e.bottom) { nextY = Math.min(nextY, e.bottom - height); p.vy = 0; }
  }
  p.y = nextY;
  if (p.grounded) { p.gliding = false; p.glideRemaining = 0; }
  if (p.y < ARENA.bounds.minY || Math.abs(p.x) > 100 || Math.abs(p.z) > 85) {
    const falls = (p.falls || 0) + 1; Object.assign(p, createPlayer(p.team), { falls });
  }
  return p;
}

export function createRoomState(now, durationMs = 300000) {
  return { status: 'lobby', durationMs, remainingMs: durationMs, lastTickMs: now,
    scores: { red: 0, blue: 0 }, zones: ARENA.zones.map(z => ({ id: z.id, owner: null, progress: 0 })), players: [], winner: null };
}
export function zonePresence(room, zone, now) {
  const counts = { red: 0, blue: 0 };
  for (const p of room.players) if (p.active && p.lastSeenMs + STALE_MS > now && Math.abs(p.y - zone.y) <= .8 && Math.hypot(p.x - zone.x, p.z - zone.z) <= zone.radius && (p.team === 'red' || p.team === 'blue')) counts[p.team]++;
  return counts;
}
function advanceZone(zone, counts, ms) {
  const direction = Math.sign(counts.red - counts.blue), prior = zone.progress;
  const target = direction * CAPTURE_MS;
  const captureAt = direction && prior !== target ? Math.abs(target - prior) : Infinity;
  const oldOwner = zone.owner;
  if (direction) zone.progress = Math.max(-CAPTURE_MS, Math.min(CAPTURE_MS, prior + direction * ms));
  if (direction && captureAt <= ms) zone.owner = direction > 0 ? 'red' : 'blue';
  const points = { red: 0, blue: 0 };
  const award = (owner, time) => { if (owner && counts[owner === 'red' ? 'blue' : 'red'] === 0) points[owner] += time / 1000; };
  if (oldOwner !== zone.owner) { award(oldOwner, captureAt); award(zone.owner, ms - captureAt); }
  else award(zone.owner, ms);
  zone.counts = counts;
  zone.contested = !!zone.owner && counts[zone.owner === 'red' ? 'blue' : 'red'] > 0;
  return points;
}
/** Integrates continuous server time, split exactly at stale-seat boundaries. */
export function advanceRoom(room, now) {
  if (!Number.isFinite(now)) throw new RangeError('server time required');
  if (now <= room.lastTickMs) return room;
  if (room.status !== 'running') { room.lastTickMs = now; return room; }
  const end = Math.min(now, room.lastTickMs + room.remainingMs);
  let cursor = room.lastTickMs;
  const cuts = room.players.filter(p => p.active).map(p => p.lastSeenMs + STALE_MS).filter(t => t > cursor && t < end).sort((a, b) => a - b);
  cuts.push(end);
  for (const cut of cuts) {
    if (cut <= cursor) continue;
    for (let i = 0; i < room.zones.length; i++) {
      const points = advanceZone(room.zones[i], zonePresence(room, ARENA.zones[i], cursor), cut - cursor);
      room.scores.red += points.red; room.scores.blue += points.blue;
    }
    room.remainingMs = Math.max(0, room.remainingMs - (cut - cursor)); cursor = cut;
  }
  room.lastTickMs = now;
  if (room.remainingMs <= 0) {
    room.status = 'ended'; room.endedMs = end;
    const difference = room.scores.red - room.scores.blue;
    room.winner = Math.abs(difference) < 1e-8 ? 'tie' : difference > 0 ? 'red' : 'blue';
  }
  return room;
}

/** Explicit allowlist: room owner identity and all seat credentials stay private. */
export function publicRoom(room, viewerPlayerId, teacher = false) {
  return { id: room.id, code: room.code, version: room.version, epoch: room.epoch || 0, status: room.status,
    serverTime: room.lastTickMs, remainingMs: room.remainingMs, durationMs: room.durationMs,
    scores: { ...room.scores }, winner: room.winner, locked: !!room.locked, teacher: !!teacher,
    zones: room.zones.map((z, i) => {
      const counts = zonePresence(room, ARENA.zones[i], room.lastTickMs);
      return { id: z.id, owner: z.owner, progress: z.progress, counts, contested: !!z.owner && counts[z.owner === 'red' ? 'blue' : 'red'] > 0 };
    }),
    players: room.players.filter(p => p.active).map(p => ({ id: p.id, nickname: p.nickname, team: p.team, active: true, appearance: validAppearance(p.appearance),
      x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw,
      grounded: p.grounded, gliding: p.gliding, sliding: p.sliding, glideRemaining: p.glideRemaining,
      padCooldown: p.padCooldown, falls: p.falls, connected: room.lastTickMs < p.lastSeenMs + STALE_MS,
      ...(p.id === viewerPlayerId ? { seq: p.seq, lastSeenMs: p.lastSeenMs } : {}) })),
    viewerPlayerId: viewerPlayerId || null,
  };
}
