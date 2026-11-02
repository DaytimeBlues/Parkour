import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, PLAYER, STEP, STALE_MS, CAPTURE_MS, createPlayer, stepPlayer, createRoomState, advanceRoom, zonePresence, publicRoom } from '../shared/multiplayer.mjs';
const neutral = { forward: 0, right: 0, yaw: 0, jump: false, glide: false, slide: false };
const run = (p, frames, input = {}) => { for (let n = 0; n < frames; n++) stepPlayer(p, { ...neutral, ...input }); return p; };
function player(team, zone = ARENA.zones[0], id = team) { return { ...createPlayer(team), x: zone.x, y: zone.y, z: zone.z, id, nickname: id, active: true, lastSeenMs: 0, seq: 0 }; }
function room(players = [], duration = 300000) { const r = createRoomState(0, duration); r.status = 'running'; r.players = players; return r; }
function advanceLive(r, end) { while (r.lastTickMs < end) { for (const p of r.players) p.lastSeenMs = r.lastTickMs; advanceRoom(r, Math.min(end, r.lastTickMs + 500)); } }
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
function walk(p, x, z) {
  for (let n = 0; n < 2000; n++) {
    if (Math.hypot(p.x - x, p.z - z) < .13) return;
    stepPlayer(p, { ...neutral, forward: 1, yaw: Math.atan2(-(x - p.x), -(z - p.z)) });
  }
  assert.fail(`Ordinary movement could not reach ${x},${z}: ${JSON.stringify(p)}`);
}

test('five separate labelled/shaped zones, team spawns, cover, tunnels and elevated routes', () => {
  assert.equal(ARENA.zones.length, 5); assert.equal(new Set(ARENA.zones.map(z => z.shape)).size, 5);
  assert.ok(ARENA.boxes.some(b => b.id.startsWith('tunnel-roof'))); assert.ok(ARENA.boxes.some(b => b.id.startsWith('cover')));
  assert.equal(ARENA.pads.filter(p => p.kind === 'launch').length, 2); assert.equal(ARENA.pads.filter(p => p.kind === 'updraft').length, 2);
  assert.ok(ARENA.zones.filter(z => z.y > 0).length === 2); assert.ok(ARENA.bounds.maxX - ARENA.bounds.minX >= 120);
});
test('fixed-step movement normalizes diagonals, yaw transforms movement, release stops and jump has one-frame edge', () => {
  const a = createPlayer('red'), b = createPlayer('red');
  run(a, 60, { forward: 1 }); run(b, 60, { forward: 1, right: 1 });
  near(Math.hypot(a.x + 55, a.z - 35), 7.2); near(Math.hypot(b.x + 55, b.z - 35), 7.2);
  const prior = { ...a }; run(a, 60); near(a.x, prior.x); near(a.z, prior.z);
  stepPlayer(a, { ...neutral, jump: true }); assert.ok(a.y > .1 && !a.grounded);
  const vy = a.vy; stepPlayer(a, { ...neutral, jump: true }); assert.ok(a.vy < vy);
  run(a, 120); assert.ok(a.grounded); near(a.y, 0);
  assert.throws(() => stepPlayer(a, neutral, 1), /fixed step/);
});
test('tunnel requires sliding and cannot force standing inside its roof', () => {
  const standing = { ...createPlayer(), x: 18, y: 0, z: 0 }, sliding = { ...standing };
  run(standing, 180, { right: 1 }); assert.ok(standing.x < 21.8, `standing entered tunnel: ${standing.x}`);
  run(sliding, 230, { right: 1, slide: true }); assert.ok(sliding.x > 40, `slide failed: ${sliding.x}`);
  const inside = { ...createPlayer(), x: 30, y: 0, z: 0, sliding: true };
  run(inside, 1); assert.ok(inside.sliding); assert.ok(PLAYER.slideHeight < 1.1);
});
test('ordinary movement can climb both complete stair routes without jumping or teleporting between steps', () => {
  const crown = { ...createPlayer(), x: 9, y: 0, z: 44 };
  run(crown, 280, { forward: 1 }); assert.ok(crown.y >= 13.9, `crown stuck ${JSON.stringify(crown)}`);
  run(crown, 90, { forward: 1 }); assert.ok(crown.y >= 13.9 && crown.z < 8);
  const north = { ...createPlayer(), x: -6, y: 0, z: -4 };
  run(north, 200, { forward: 1 }); assert.ok(north.y >= 7.9, `north stuck ${JSON.stringify(north)}`);
});
test('all five zones are reachable continuously from a real team spawn through ordinary movement inputs', () => {
  const paths = [
    { team: 'red', zone: 'west', points: [[-55, -25], [-43, -25]] },
    { team: 'blue', zone: 'east', points: [[55, -25], [43, -25]] },
    { team: 'red', zone: 'garden', points: [[-20, 30]] },
    { team: 'red', zone: 'crown', points: [[-20, 30], [-20, 44], [9, 44], [9, 10], [0, 0]] },
    { team: 'red', zone: 'north', points: [[-55, 10], [-10, 10], [-6, -4], [-6, -28], [0, -32]] },
  ];
  for (const path of paths) {
    const p = { ...createPlayer(path.team), id: path.team, active: true, lastSeenMs: 0 };
    for (const [x, z] of path.points) walk(p, x, z);
    const z = ARENA.zones.find(z => z.id === path.zone);
    assert.equal(zonePresence(room([p]), z, 0)[path.team], 1, path.zone);
    assert.equal(p.falls, 0, path.zone);
  }
});
test('launch pad and held-glide updraft grant bounded flight; glide release restores gravity', () => {
  const pad = ARENA.pads[0], p = { ...createPlayer(), x: pad.x, y: 0, z: pad.z };
  run(p, 1); assert.ok(p.vy > 20 && !p.grounded && p.glideRemaining > 0);
  run(p, 90, { glide: true }); assert.ok(p.y > 14 && p.gliding);
  p.vy = -2.4; run(p, 10, { glide: true }); near(p.vy, -2.4);
  run(p, 10); assert.ok(p.vy < -5 && !p.gliding);
  const draft = ARENA.pads.find(p => p.kind === 'updraft'), flyer = { ...createPlayer(), x: draft.x, y: 0, z: draft.z };
  run(flyer, 90, { glide: true }); assert.ok(flyer.y > 10 && flyer.gliding);
});
test('falling off fortress safely respawns without erasing membership', () => {
  const p = { ...createPlayer('blue'), id: 'seat', x: 63, z: 35 };
  run(p, 240, { right: 1 }); assert.equal(p.id, 'seat'); assert.ok(p.falls > 0); assert.ok(Number.isFinite(p.y));
});
test('capture takes exactly five server seconds and larger numerical majority does not speed it up', () => {
  for (const count of [1, 3]) {
    const r = room(Array.from({ length: count }, (_, n) => player('red', undefined, `red${n}`)));
    advanceLive(r, 4999); assert.equal(r.zones[0].owner, null); near(r.zones[0].progress, 4999);
    advanceLive(r, 5000); assert.equal(r.zones[0].owner, 'red'); near(r.scores.red, 0);
    advanceLive(r, 6000); near(r.scores.red, 1);
  }
});
test('equal numbers pause progress, opposite majority unwinds then captures, and empty retains owner', () => {
  const r = room([player('red')]); advanceLive(r, 2500);
  r.players.push(player('blue')); advanceLive(r, 4000); near(r.zones[0].progress, 2500);
  r.players[0].active = false; advanceLive(r, 6500); near(r.zones[0].progress, 0); assert.equal(r.zones[0].owner, null);
  advanceLive(r, 11500); assert.equal(r.zones[0].owner, 'blue');
  r.players[1].active = false; advanceLive(r, 12500); assert.equal(r.zones[0].owner, 'blue'); near(r.zones[0].progress, -CAPTURE_MS); near(r.scores.blue, 1);
});
test('any opposing occupancy pauses owner scoring, including enemy-only takeover', () => {
  const r = room([player('red')]); advanceLive(r, 6000); near(r.scores.red, 1);
  r.players.push(player('blue')); advanceLive(r, 7000); near(r.scores.red, 1);
  r.players[0].active = false; advanceLive(r, 9000); near(r.scores.red, 1); assert.ok(r.zones[0].contested);
});
test('airborne above zone, outside radius, removed and stale seats do not count', () => {
  const z = ARENA.zones[0], p = player('red'), r = room([p]);
  p.y = 5; assert.equal(zonePresence(r, z, 0).red, 0);
  p.y = z.y; p.x = z.x + z.radius + .01; assert.equal(zonePresence(r, z, 0).red, 0);
  p.x = z.x; assert.equal(zonePresence(r, z, STALE_MS).red, 0);
  p.active = false; assert.equal(zonePresence(r, z, 0).red, 0);
});
test('long request gap stops capture exactly at stale lease while clock continues', () => {
  const r = room([player('red')]); advanceRoom(r, 10000); near(r.zones[0].progress, STALE_MS); near(r.remainingMs, 290000); assert.equal(r.zones[0].owner, null);
});
test('pause freezes capture/clock/points; server deadline clips all effects and declares tie or winner', () => {
  const r = room([player('red')], 7000); advanceLive(r, 6000); r.status = 'paused';
  advanceRoom(r, 20000); near(r.remainingMs, 1000); near(r.scores.red, 1);
  r.status = 'running'; r.players[0].lastSeenMs = 20000; advanceRoom(r, 40000);
  assert.equal(r.status, 'ended'); assert.equal(r.winner, 'red'); assert.equal(r.endedMs, 21000); near(r.scores.red, 2); near(r.remainingMs, 0);
  advanceRoom(r, 50000); near(r.scores.red, 2);
  const tied = room([], 100); advanceRoom(tied, 101); assert.equal(tied.winner, 'tie');
});
test('public projection never leaks teacher IDs or token hashes and includes complete self movement for reconciliation', () => {
  const r = room([player('red'), player('blue')]); r.ownerId = 'secret-owner'; r.players[0].tokenHash = 'secret-token'; r.players[0].seq = 9;
  const pub = publicRoom(r, 'red'); const text = JSON.stringify(pub);
  assert.ok(!text.includes('secret-')); assert.equal(pub.players[0].seq, 9); assert.equal(pub.players[1].seq, undefined);
  for (const key of Object.keys(createPlayer())) assert.ok(key in pub.players[0], key);
});
