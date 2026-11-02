import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { handleMultiplayer } from '../lib/multiplayer.mjs';
import { SqliteD1 } from './d1-sqlite.mjs';
import { ARENA } from '../../shared/multiplayer.mjs';
import { decodeRoom } from '../../shared/multiplayer-wire.mjs';

// Test principals enter the handler as trusted adapter context, NOT HTTP headers.
// This exercises real production SQL on SQLite, not hosted D1 or browser sign-in.
const ORIGIN = 'https://skybound.example', BASE = 1_800_000_000_000;
const TEACHER = { userId: 'teacher-a' }, OTHER = { userId: 'teacher-b' };
const frame = (fields = {}) => ({ forward: 0, right: 0, yaw: 0, jump: false, glide: false, slide: false, ...fields });
const frames = (count = 6, fields = {}) => Array.from({ length: count }, () => frame(fields));

function fixture(t, filename) {
  let db = new SqliteD1(filename);
  const epochs = new Map(), revisions = new Map();
  t.after(() => db.close());
  const f = {
    get db() { return db; },
    reopen() { db.close(); db = new SqliteD1(filename); },
    async call(path, { body, token, principal = null, now = BASE, method = body === undefined ? 'GET' : 'POST', headers = {}, raw } = {}) {
      const request = new Request(`${ORIGIN}/api/multiplayer/${path}`, {
        method,
        headers: { ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Skybound-Seat': token } : {}), ...headers },
        ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}),
      });
      const response = await handleMultiplayer(request, db, { now, principal });
      const text = await response.text();
      const parsed = JSON.parse(text);
      const wireRoom = parsed.room;
      if (wireRoom) parsed.room = decodeRoom(wireRoom);
      if (parsed.room?.code) { epochs.set(parsed.room.code, Math.max(epochs.get(parsed.room.code) ?? 0, parsed.room.epoch)); revisions.set(parsed.room.code, Math.max(revisions.get(parsed.room.code) ?? 0, parsed.room.controlRevision)); }
      return { status: response.status, headers: response.headers, text, body: parsed, wireRoom };
    },
    async create(principal = TEACHER, now = BASE) {
      const r = await f.call('rooms', { body: { durationSeconds: 300 }, principal, now });
      assert.equal(r.status, 200, r.text); assert.ok(r.body.code); return r.body;
    },
    async join(code, nickname, now = BASE, joinKey = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')) {
      const r = await f.call('join', { body: { code, nickname, joinKey }, now });
      assert.equal(r.status, 200, r.text); assert.ok(r.body.seatToken); assert.ok(r.body.playerId); return r.body;
    },
    control(code, action, fields = {}, now = BASE + 1000, principal = TEACHER) {
      return f.call('control', { body: { code, action, revision: revisions.get(code), operationId: crypto.randomUUID(), ...fields }, principal, now });
    },
    sync(code, seat, sequence, input = frames(), now = BASE + 1200) {
      return f.call('sync', { body: { code, sequence, epoch: epochs.get(code), frames: input }, token: seat.seatToken, now });
    },
    async game(count = 4) {
      const room = await f.create(); const seats = [];
      for (let i = 0; i < count; i++) seats.push(await f.join(room.code, `Fox ${i + 1}`));
      const started = await f.control(room.code, 'start'); assert.equal(started.status, 200, started.text);
      return { code: room.code, seats, room: started.body.room };
    },
  };
  return f;
}

// Synthetic pre-upgrade durable seats: deliberately bypass new admission only in this fixture.
function addLegacySeats(f,g,total) {
  const template=f.db.sqlite.prepare('SELECT * FROM mp_seats WHERE id=?').get(g.seats[0].playerId);
  for(let i=g.seats.length;i<total;i++) {
    const id=crypto.randomUUID(),p={...JSON.parse(template.state_json),id,nickname:`Legacy ${i}`};
    f.db.sqlite.prepare('INSERT INTO mp_seats(id,room_code,token_hash,state_json,version) VALUES(?,?,?,?,0)').run(id,g.code,`legacy-fixture-${i}`,JSON.stringify(p));
  }
}

function delayedDatabase(db, ms = 2) {
  const prepare = db.prepare.bind(db), batch = db.batch.bind(db);
  const delay = () => new Promise(resolve => setTimeout(resolve, ms));
  const wrap = s => ({ bind: (...v) => wrap(s.bind(...v)), execute: (...v) => s.execute(...v),
    first: async (...v) => { const r = await s.first(...v); await delay(); return r; },
    all: async (...v) => { const r = await s.all(...v); await delay(); return r; },
    run: async (...v) => { const r = await s.run(...v); await delay(); return r; } });
  db.prepare = sql => wrap(prepare(sql));
  db.batch = async statements => { const r = await batch(statements); await delay(); return r; };
}

// Diagnostic placement only; never counted as an ordinary-navigation playtest.
function placeSeat(f, code, playerId, zone, { sample = false } = {}) {
  const row = f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE room_code=? AND id=?').get(code, playerId);
  const player = JSON.parse(row.state_json);
  Object.assign(player, { x: zone.x, y: zone.y, z: zone.z, grounded: true, vx: 0, vy: 0, vz: 0 });
  f.db.sqlite.prepare('UPDATE mp_seats SET state_json=? WHERE room_code=? AND id=?').run(JSON.stringify(player), code, playerId);
  if (sample) {
    const room = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(code).state_json);
    const at = room.players.findIndex(p => p.id === playerId);
    if (at >= 0) room.players[at] = { ...room.players[at], ...player };
    else room.players.push(player);
    f.db.sqlite.prepare('UPDATE mp_rooms SET state_json=? WHERE code=?').run(JSON.stringify(room), code);
  }
}

test('multiplayer: authenticated teacher plus four independently tokened anonymous players share one room', async t => {
  const f = fixture(t), g = await f.game();
  assert.equal(g.room.status, 'running'); assert.equal(g.room.players.length, 4);
  assert.equal(new Set(g.seats.map(s => s.seatToken)).size, 4);
  assert.equal(new Set(g.seats.map(s => s.playerId)).size, 4);
  assert.deepEqual(g.room.players.map(p => p.team).sort(), ['blue', 'blue', 'red', 'red']);
  for (const s of g.seats) {
    const r = await f.call('state', { body: { code: g.code }, token: s.seatToken, now: BASE + 1100 });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.room.players.length, 4);
    for (const secret of [...g.seats.map(x => x.seatToken), 'tokenHash', 'ownerId', 'teacher-a']) assert.ok(!r.text.includes(secret), secret);
  }
  const raw = JSON.stringify(f.db.sqlite.prepare('SELECT token_hash,state_json FROM mp_seats WHERE room_code=?').all(g.code));
  for (const s of g.seats) assert.ok(!raw.includes(s.seatToken), 'raw seat token must not be stored');
});

test('multiplayer: sign-in is separate from room code and spoofable request headers are not trusted identity', async t => {
  const f = fixture(t);
  assert.equal((await f.call('me')).body.signedIn, false);
  assert.equal((await f.call('me', { principal: TEACHER })).body.signedIn, true);
  assert.ok([401, 403].includes((await f.call('rooms', { body: { durationSeconds: 300 } })).status));
  assert.ok([401, 403].includes((await f.call('rooms', { body: {}, headers: { 'oai-authenticated-user-id': 'teacher-a', 'oai-authenticated-user-email': 'teacher@example.com' } })).status));
  const { code } = await f.create();
  const s = await f.join(code, 'Student');
  for (const principal of [null, OTHER]) {
    const r = await f.call('control', { body: { code, action: 'end', revision: s.room.controlRevision, operationId: crypto.randomUUID() }, token: s.seatToken, principal });
    assert.ok([401, 403, 404].includes(r.status), r.text);
  }
  const mine = await f.call('rooms', { principal: TEACHER }), theirs = await f.call('rooms', { principal: OTHER });
  assert.equal(mine.status, 200); assert.ok(mine.text.includes(code)); assert.ok(!theirs.text.includes(code));
});

test('multiplayer: a room or player id cannot substitute for a secret seat token or cross rooms', async t => {
  const f = fixture(t), a = await f.game(2), b = await f.create(OTHER);
  for (const token of [undefined, a.code, a.seats[0].playerId, 'A'.repeat(43)]) {
    const r = await f.call('state', { body: { code: a.code }, token, now: BASE + 1100 });
    assert.ok([401, 403, 404].includes(r.status), r.text);
  }
  const r = await f.call('state', { body: { code: b.code }, token: a.seats[0].seatToken });
  assert.ok([401, 403, 404].includes(r.status), r.text);
});

test('multiplayer: movement is derived from bounded fixed-step inputs, never supplied positions or scores', async t => {
  const f = fixture(t), g = await f.game(2), s = g.seats[0];
  const before = g.room.players.find(p => p.id === s.playerId);
  const good = await f.sync(g.code, s, 1, frames(6, { forward: 1 }));
  assert.equal(good.status, 200, good.text); assert.equal(good.body.ack, 1);
  const after = good.body.room.players.find(p => p.id === s.playerId);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0);
  for (const field of ['position', 'x', 'score', 'team', 'playerId', 'seat', 'duration', 'now']) {
    const body = { code: g.code, sequence: 2, epoch: g.room.epoch, frames: [], [field]: field === 'team' ? 'red' : 999999 };
    const r = await f.call('sync', { body, token: s.seatToken, now: BASE + 1400 });
    assert.equal(r.status, 400, `${field}: ${r.text}`);
  }
  for (const input of [frame({ forward: 2 }), frame({ right: 0.5 }), frame({ yaw: null }), frame({ yaw: 1e100 }), frame({ jump: 'yes' }), frame({ x: 100 })]) {
    const r = await f.sync(g.code, s, 2, [input], BASE + 1400); assert.equal(r.status, 400, r.text);
  }
  assert.equal((await f.sync(g.code, s, 2, frames(31), BASE + 1400)).status, 400);
});

test('multiplayer: exactly-once input effects survive lost acknowledgment; reorder and conflicting retry fail', async t => {
  const f = fixture(t), g = await f.game(2), s = g.seats[0], input = frames(6, { forward: 1 });
  const accepted = await f.sync(g.code, s, 1, input);
  assert.equal(accepted.status, 200, accepted.text);
  const retried = await f.sync(g.code, s, 1, input, BASE + 1300);
  assert.equal(retried.status, 200, retried.text); assert.equal(retried.body.ack, 1);
  const position = r => { const p = r.body.room.players.find(p => p.id === s.playerId); return [p.x, p.y, p.z]; };
  assert.deepEqual(position(retried), position(accepted), 'retry must not move again');
  assert.equal((await f.sync(g.code, s, 1, frames(6, { right: 1 }), BASE + 1400)).status, 409);
  assert.equal((await f.sync(g.code, s, 3, [], BASE + 1400)).status, 409);
  const next = await f.sync(g.code, s, 2, [], BASE + 1400); assert.equal(next.status, 200, next.text);
});

test('multiplayer: excessive simulation rate is rejected and does not consume the sequence', async t => {
  const f = fixture(t), g = await f.game(2), s = g.seats[0];
  const fast = await f.sync(g.code, s, 1, frames(30), BASE + 1010);
  assert.equal(fast.status, 409, fast.text);
  const valid = await f.sync(g.code, s, 1, frames(6), BASE + 1200); assert.equal(valid.status, 200, valid.text);
});

test('multiplayer: reconnect preserves seat and fences prior sequence; removal permanently revokes that seat token', async t => {
  const f = fixture(t), g = await f.game(), s = g.seats[0];
  await f.sync(g.code, s, 1);
  const rejoined = await f.call('reconnect', { body: { code: g.code }, token: s.seatToken, now: BASE + 2000 });
  assert.equal(rejoined.status, 200, rejoined.text); assert.equal(rejoined.body.playerId, s.playerId); assert.equal(rejoined.body.ack, 2);
  assert.equal(rejoined.body.room.players.filter(p => p.id === s.playerId).length, 1);
  const removed = await f.control(g.code, 'remove', { playerId: s.playerId }, BASE + 2100); assert.equal(removed.status, 200, removed.text);
  for (const path of ['state', 'reconnect']) {
    const r = await f.call(path, { body: { code: g.code }, token: s.seatToken, now: BASE + 2200 });
    assert.ok([401, 403, 404, 410].includes(r.status), r.text);
  }
  assert.ok([401, 403, 404, 410].includes((await f.sync(g.code, s, 2, [], BASE + 2200)).status));
});

test('multiplayer: room lock blocks new seats without locking out existing reconnect', async t => {
  const f = fixture(t), g = await f.game(2);
  assert.equal((await f.control(g.code, 'lock', { locked: true }, BASE + 1100)).status, 200);
  const denied = await f.call('join', { body: { code: g.code, nickname: 'New fox', joinKey: 'c'.repeat(64) }, now: BASE + 1200 });
  assert.ok([403, 409].includes(denied.status), denied.text);
  assert.equal((await f.call('reconnect', { body: { code: g.code }, token: g.seats[0].seatToken, now: BASE + 1200 })).status, 200);
});

test('multiplayer: pause freezes timer and score; resume resets time anchor; ending cannot be undone', async t => {
  const f = fixture(t), g = await f.game(2);
  const paused = await f.control(g.code, 'pause', {}, BASE + 2000); assert.equal(paused.status, 200, paused.text);
  const snapshot = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 102000 });
  assert.equal(snapshot.status, 200); assert.equal(snapshot.body.room.status, 'paused');
  assert.equal(snapshot.body.room.remainingMs, paused.body.room.remainingMs); assert.deepEqual(snapshot.body.room.scores, paused.body.room.scores);
  const resumed = await f.control(g.code, 'resume', {}, BASE + 102000); assert.equal(resumed.status, 200, resumed.text);
  const ticking = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 103000 });
  assert.equal(ticking.body.room.remainingMs, resumed.body.room.remainingMs - 1000);
  const ended = await f.control(g.code, 'end', {}, BASE + 103000); assert.equal(ended.status, 200); assert.equal(ended.body.room.status, 'ended');
  for (const action of ['start', 'resume']) assert.equal((await f.control(g.code, action, {}, BASE + 104000)).status, 409);
});

test('multiplayer: concurrent duplicate inputs apply once and control races do not resurrect ended rooms', async t => {
  const f = fixture(t), g = await f.game(), s = g.seats[0];
  const results = await Promise.all(Array.from({ length: 4 }, () => f.sync(g.code, s, 1, frames(6, { right: 1 }))));
  assert.ok(results.every(r => r.status === 200), results.map(r => r.text).join('\n'));
  const poses = results.map(r => { const p = r.body.room.players.find(p => p.id === s.playerId); return JSON.stringify([p.x, p.y, p.z]); });
  assert.equal(new Set(poses).size, 1);
  const race = await Promise.all([f.control(g.code, 'pause', {}, BASE + 1300), f.control(g.code, 'end', {}, BASE + 1300)]);
  assert.ok(race.every(r => [200, 409].includes(r.status)), race.map(r => r.text).join('\n'));
  const state = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1400 });
  assert.ok(['paused', 'ended'].includes(state.body.room.status));
  if (state.body.room.status === 'paused') assert.equal((await f.control(g.code, 'end', {}, BASE + 1500)).body.room.status, 'ended');
});

test('multiplayer: durable database reopen retains room, ack and revoked access', async t => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'skybound-mp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = fixture(t, pathJoin(dir, 'rooms.sqlite')), g = await f.game(), s = g.seats[0];
  assert.equal((await f.sync(g.code, s, 1)).status, 200);
  assert.equal((await f.control(g.code, 'remove', { playerId: g.seats[1].playerId }, BASE + 1300)).status, 200);
  f.reopen();
  const resumed = await f.call('reconnect', { body: { code: g.code }, token: s.seatToken, now: BASE + 1400 });
  assert.equal(resumed.status, 200, resumed.text); assert.equal(resumed.body.ack, 2);
  assert.ok([401, 403, 404, 410].includes((await f.call('reconnect', { body: { code: g.code }, token: g.seats[1].seatToken, now: BASE + 1400 })).status));
});

test('multiplayer: strict bodies, origin, content type, nickname and secrets stay bounded', async t => {
  const f = fixture(t), { code } = await f.create();
  for (const nickname of ['', 'x'.repeat(25), '<script>alert(1)</script>']) {
    const r = await f.call('join', { body: { code, nickname, joinKey: 'd'.repeat(64) } }); assert.equal(r.status, 400, r.text);
  }
  assert.equal((await f.call('join', { body: { code, nickname: 'Fox', joinKey: 'd'.repeat(64), team: 'red' } })).status, 400);
  assert.equal((await f.call('rooms', { body: {}, principal: TEACHER, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.call('rooms', { body: {}, principal: TEACHER, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.call('rooms', { body: {}, principal: TEACHER, raw: ' '.repeat(20000) })).status, 413);
  const r = await f.call('rooms', { body: {}, principal: TEACHER, raw: '{bad json' }); assert.equal(r.status, 400);
});

test('multiplayer: interrupted join acknowledgment retries the same seat, not an orphan', async t => {
  const f = fixture(t), { code } = await f.create(), joinKey = 'e'.repeat(64);
  const first = await f.join(code, 'Retry fox', BASE, joinKey);
  const again = await f.join(code, 'Retry fox', BASE + 100, joinKey);
  assert.equal(again.seatToken, first.seatToken); assert.equal(again.playerId, first.playerId);
  assert.equal(again.room.players.length, 1);
  const conflict = await f.call('join', { body: { code, nickname: 'Another fox', joinKey }, now: BASE + 200 });
  assert.equal(conflict.status, 409, conflict.text);
  assert.equal((await f.control(code, 'remove', { playerId: first.playerId }, BASE + 300)).status, 200);
  assert.equal((await f.call('join', { body: { code, nickname: 'Retry fox', joinKey }, now: BASE + 400 })).status, 403);
  const saved = JSON.stringify(f.db.sqlite.prepare('SELECT token_hash,state_json FROM mp_seats WHERE room_code=?').all(code));
  assert.ok(!saved.includes(joinKey)); assert.ok(!saved.includes(first.seatToken));
});

test('multiplayer: an old epoch cannot replay movement across teacher pause and resume', async t => {
  const f = fixture(t), g = await f.game(2), s = g.seats[0];
  const oldBody = { code: g.code, sequence: 1, epoch: g.room.epoch, frames: frames(6, { forward: 1 }) };
  assert.equal((await f.control(g.code, 'pause', {}, BASE + 1100)).status, 200);
  const resumed = await f.control(g.code, 'resume', {}, BASE + 1200); assert.equal(resumed.status, 200);
  const stale = await f.call('sync', { body: oldBody, token: s.seatToken, now: BASE + 1400 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'STALE_EPOCH');
  const reconnect = await f.call('reconnect', { body: { code: g.code }, token: s.seatToken, now: BASE + 1400 });
  assert.equal(reconnect.status, 200); assert.equal(reconnect.body.ack, 1);
  assert.equal((await f.sync(g.code, s, reconnect.body.ack + 1, frames(6), BASE + 1600)).status, 200);
});

test('multiplayer: stale clients must reconnect and cannot cash disconnected time into movement', async t => {
  const f = fixture(t), g = await f.game(2), s = g.seats[0];
  const stale = await f.sync(g.code, s, 1, frames(30), BASE + 10000);
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'RECONNECT_REQUIRED');
  const reconnect = await f.call('reconnect', { body: { code: g.code }, token: s.seatToken, now: BASE + 10000 });
  assert.equal(reconnect.status, 200); assert.equal(reconnect.body.ack, 1);
  const tooSoon = await f.sync(g.code, s, reconnect.body.ack + 1, frames(30), BASE + 10001);
  assert.equal(tooSoon.status, 409); assert.equal(tooSoon.body.error, 'INPUT_TOO_FAST');
  assert.equal((await f.sync(g.code, s, reconnect.body.ack + 1, frames(6), BASE + 10200)).status, 200);
});

test('multiplayer: concurrent room creation enforces the teacher room cap atomically', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.call('rooms', { body: { durationSeconds: 300 }, principal: TEACHER })));
  const successes = results.filter(r => r.status === 200);
  assert.equal(successes.length, 8, results.map(r => `${r.status}:${r.text}`).join('\n'));
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM mp_rooms WHERE owner_id=?').get(TEACHER.userId).n, 8);
  assert.ok(results.filter(r => r.status !== 200).every(r => [429, 503].includes(r.status)));
});

test('multiplayer: stale occupancy is bounded even after all requests stop for ten seconds', async t => {
  const f = fixture(t), g = await f.game(2), zone = ARENA.zones[0];
  // Diagnostic state placement isolates the server occupancy clock. It is NOT
  // ordinary-input evidence that a player navigated to this zone.
  const row = f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code), state = JSON.parse(row.state_json);
  const red = state.players.find(p => p.team === 'red');
  Object.assign(red, { x: zone.x, y: zone.y, z: zone.z });
  f.db.sqlite.prepare('UPDATE mp_rooms SET state_json=? WHERE code=?').run(JSON.stringify(state), g.code);
  const observed = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 11000 });
  assert.equal(observed.status, 200); assert.equal(observed.body.room.zones[0].progress, 1000);
  assert.equal(observed.body.room.zones[0].owner, null); assert.deepEqual(observed.body.room.scores, { red: 0, blue: 0 });
  assert.equal(observed.body.room.remainingMs, 290000);
});

test('multiplayer: uncertain database failure leaks no internals and a safe retry applies once', async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0], prepare = f.db.prepare.bind(f.db);
  let failOnce = true;
  f.db.prepare = sql => {
    const wrapped = statement => ({
      bind: (...values) => wrapped(statement.bind(...values)),
      execute: (...values) => statement.execute(...values),
      first: async (...values) => {
        if (failOnce && sql.startsWith('UPDATE mp_seats')) { failOnce = false; throw Error('private database internals'); }
        return statement.first(...values);
      },
      all: (...values) => statement.all(...values), run: (...values) => statement.run(...values),
    });
    return wrapped(prepare(sql));
  };
  const failed = await f.sync(g.code, seat, 1, frames(6, { forward: 1 }));
  assert.equal(failed.status, 503); assert.ok(!failed.text.includes('private database'));
  const retry = await f.sync(g.code, seat, 1, frames(6, { forward: 1 }), BASE + 1300);
  assert.equal(retry.status, 200); assert.equal(retry.body.ack, 1);
  const duplicate = await f.sync(g.code, seat, 1, frames(6, { forward: 1 }), BASE + 1400);
  assert.equal(duplicate.status, 200);
  const pose = r => { const p = r.body.room.players.find(p => p.id === seat.playerId); return [p.x, p.y, p.z]; };
  assert.deepEqual(pose(duplicate), pose(retry));
});

test('multiplayer: asynchronous SQL scheduling exercises CAS without losing acknowledged input', async t => {
  const f = fixture(t), g = await f.game(4), prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    const wrap = statement => ({
      bind: (...values) => wrap(statement.bind(...values)),
      execute: (...values) => statement.execute(...values),
      first: async (...values) => { const result = await statement.first(...values); await new Promise(r => setTimeout(r, 2)); return result; },
      all: (...values) => statement.all(...values), run: (...values) => statement.run(...values),
    });
    return wrap(prepare(sql));
  };
  const baseline = f.db.metrics.statements;
  const results = await Promise.all(g.seats.map(s => f.sync(g.code, s, 1, frames(6))));
  assert.ok(results.every(r => r.status === 200), results.map(r => r.text).join('\n'));
  assert.ok(f.db.metrics.statements - baseline > 8, 'real asynchronous SQL calls were exercised');
  const saved = f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE room_code=?').all(g.code).map(r => JSON.parse(r.state_json));
  assert.ok(saved.every(p => p.seq === 1));
});

test('multiplayer: room capacity and expiry are enforced', async t => {
  const f = fixture(t), { code } = await f.create();
  for (let i = 0; i < 8; i++) await f.join(code, `Seat ${i}`);
  const overflow = await f.call('join', { body: { code, nickname: 'Seat overflow', joinKey: 'f'.repeat(64) } });
  assert.equal(overflow.status, 409); assert.equal(overflow.body.error, 'ROOM_FULL');
  const expired = await f.call('state', { body: { code }, principal: TEACHER, now: BASE + 6 * 60 * 60 * 1000 });
  assert.equal(expired.status, 410); assert.equal(expired.body.error, 'ROOM_EXPIRED');
});

test('multiplayer: sampled occupancy captures at five seconds, not before, and score starts after capture', async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0];
  placeSeat(f, g.code, seat.playerId, ARENA.zones[0], { sample: true });
  let sequence = 0;
  for (let elapsed = 200; elapsed <= 4800; elapsed += 200) {
    const r = await f.sync(g.code, seat, ++sequence, [], BASE + 1000 + elapsed);
    assert.equal(r.status, 200, r.text); assert.equal(r.body.room.zones[0].owner, null);
  }
  const before = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 5999 });
  assert.equal(before.status, 200); assert.equal(before.body.room.zones[0].owner, null);
  const captured = await f.sync(g.code, seat, ++sequence, [], BASE + 6000);
  assert.equal(captured.status, 200, captured.text); assert.equal(captured.body.room.zones[0].owner, 'red');
  assert.equal(captured.body.room.zones[0].progress, 5000); assert.equal(captured.body.room.scores.red, 0);
  const scored = await f.sync(g.code, seat, ++sequence, [], BASE + 6200);
  assert.equal(scored.status, 200); assert.ok(Math.abs(scored.body.room.scores.red - .2) < 1e-8);
});

test('multiplayer: newly joined live poses cannot backdate capture into the previous occupancy sample', async t => {
  const f = fixture(t), g = await f.game(2);
  const joined = await f.join(g.code, 'Late red fox', BASE + 4000);
  assert.equal(joined.room.players.find(p => p.id === joined.playerId).team, 'red');
  placeSeat(f, g.code, joined.playerId, ARENA.zones[0]);
  const first = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 4000 });
  assert.equal(first.status, 200); assert.equal(first.body.room.zones[0].progress, 0);
  const next = await f.sync(g.code, joined, 1, [], BASE + 4200);
  assert.equal(next.status, 200, next.text); assert.ok(next.body.room.zones[0].progress <= 200, next.text);
  assert.equal(next.body.room.zones[0].owner, null);
});

test('multiplayer: competing room ticks count elapsed time once while live snapshots remain fresh', async t => {
  const f = fixture(t), g = await f.game(4);
  delayedDatabase(f.db);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1200 })));
  assert.ok(results.every(r => r.status === 200), results.map(r => r.text).join('\n'));
  const row = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code).state_json);
  assert.equal(row.remainingMs, 299800); assert.equal(row.lastTickMs, BASE + 1200);
  const a = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1250 });
  const b = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1300 });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.ok(b.body.room.snapshotMs > a.body.room.snapshotMs);
  assert.equal(a.body.room.version, b.body.room.version, 'fresh snapshots need not change the scoring version');
});

test('multiplayer: delayed in-flight sync cannot undo teacher pause, removal or end', async t => {
  const f = fixture(t), g = await f.game(4), seat = g.seats[0];
  delayedDatabase(f.db);
  const pauseRace = await Promise.all([f.sync(g.code, seat, 1, frames(6), BASE + 1200), f.control(g.code, 'pause', {}, BASE + 1200)]);
  assert.ok(pauseRace.every(r => [200,409].includes(r.status)), pauseRace.map(r => r.text).join('\n'));
  const paused = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1300 });
  assert.equal(paused.body.room.status, 'paused');
  assert.equal((await f.control(g.code, 'resume', {}, BASE + 1400)).status, 200);
  const live = await f.call('reconnect', { body: { code: g.code }, token: seat.seatToken, now: BASE + 1400 });
  const removeRace = await Promise.all([f.sync(g.code, seat, live.body.ack + 1, frames(6), BASE + 1600), f.control(g.code, 'remove', { playerId: seat.playerId }, BASE + 1600)]);
  assert.ok(removeRace.every(r => [200,403,409].includes(r.status)), removeRace.map(r => r.text).join('\n'));
  const stored = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  assert.equal(stored.active, false);
  assert.equal((await f.call('reconnect', { body: { code: g.code }, token: seat.seatToken, now: BASE + 1700 })).status, 403);
  const other = g.seats[1];
  const otherLive = await f.call('reconnect', { body: { code: g.code }, token: other.seatToken, now: BASE + 1700 });
  const endRace = await Promise.all([f.sync(g.code, other, otherLive.body.ack + 1, frames(6), BASE + 1900), f.control(g.code, 'end', {}, BASE + 1900)]);
  assert.ok(endRace.every(r => [200,409].includes(r.status)), endRace.map(r => r.text).join('\n'));
  const end = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 2100 });
  assert.equal(end.body.room.status, 'ended');
});

test('multiplayer: teacher transaction failure rolls back room and seat changes together', async t => {
  const f = fixture(t), g = await f.game(2);
  const beforeRoom = f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code).state_json;
  const beforeSeats = f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE room_code=? ORDER BY id').all(g.code);
  f.db.failBatchStatement = 1;
  const failed = await f.control(g.code, 'remove', { playerId: g.seats[0].playerId }, BASE + 1000);
  assert.equal(failed.status, 503);
  assert.equal(f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code).state_json, beforeRoom);
  assert.deepEqual(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE room_code=? ORDER BY id').all(g.code), beforeSeats);
  f.db.failBatchStatement = -1;
  assert.equal((await f.control(g.code, 'remove', { playerId: g.seats[0].playerId }, BASE + 1000)).status, 200);
});

for (const action of ['pause', 'remove', 'end']) test(`multiplayer: ${action} committed exactly between seat read and update fences the stale effect`, async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0];
  const before = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  let reach, release, blocked = false;
  const reached = new Promise(resolve => { reach = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    const wrap = s => ({ bind: (...v) => wrap(s.bind(...v)), execute: (...v) => s.execute(...v),
      first: async (...v) => {
        if (!blocked && sql.startsWith('UPDATE mp_seats')) { blocked = true; reach(); await gate; }
        return s.first(...v);
      }, all: (...v) => s.all(...v), run: (...v) => s.run(...v) });
    return wrap(prepare(sql));
  };
  const inFlight = f.sync(g.code, seat, 1, frames(6, { forward: 1 }), BASE + 1200);
  await reached;
  const control = await f.control(g.code, action, action === 'remove' ? { playerId: seat.playerId } : {}, BASE + 1250);
  release();
  assert.equal(control.status, 200, control.text);
  const response = await inFlight;
  assert.equal(response.status, action === 'remove' ? 403 : 409, response.text);
  assert.equal(response.body.error, action === 'remove' ? 'SEAT_REMOVED' : 'STALE_EPOCH');
  const after = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  assert.equal(after.seq, before.seq);
  assert.deepEqual([after.x, after.y, after.z], [before.x, before.y, before.z]);
});

for (const observer of ['state', 'teacher-control']) test(`multiplayer: earlier ${observer} request cannot backdate a later accepted seat sample`, async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0];
  // Diagnostic placement leaves the PREVIOUS occupancy sample at the spawn.
  // The real sync below accepts this live seat at server time +1400.
  placeSeat(f, g.code, seat.playerId, ARENA.zones[0]);
  let reach, release, blocked = false;
  const reached = new Promise(resolve => { reach = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    const wrap = s => ({ bind: (...v) => wrap(s.bind(...v)), execute: (...v) => s.execute(...v),
      first: async (...v) => {
        // The later sync has committed its seat update, but has not read the
        // all-seat snapshot or tried to advance scoring yet.
        if (!blocked && sql.startsWith('SELECT r.*,')) { blocked = true; reach(); await gate; }
        return s.first(...v);
      }, all: (...v) => s.all(...v), run: (...v) => s.run(...v) });
    return wrap(prepare(sql));
  };
  const later = f.sync(g.code, seat, 1, [], BASE + 1400);
  await reached;
  let earlier;
  try {
    earlier = observer === 'state'
      ? await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1200 })
      : await f.control(g.code, 'lock', { locked: true }, BASE + 1200);
    assert.equal(earlier.status, 200, earlier.text);
    const stored = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code).state_json);
    assert.ok(stored.lastTickMs >= BASE + 1400, 'occupancy sample time must not precede its latest accepted pose');
    assert.equal(stored.zones[0].progress, 0, 'new pose cannot earn capture for the earlier interval');
  } finally { release(); }
  assert.equal((await later).status, 200);
  const next = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1600 });
  assert.equal(next.status, 200); assert.equal(next.body.room.zones[0].progress, 200);
});

test('multiplayer: an identical old sequence retry within receipt window is acknowledged without replay', async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0], firstFrames = frames(6, { forward: 1 });
  assert.equal((await f.sync(g.code, seat, 1, firstFrames, BASE + 1200)).status, 200);
  const second = await f.sync(g.code, seat, 2, frames(6, { right: 1 }), BASE + 1400);
  assert.equal(second.status, 200);
  const retry = await f.sync(g.code, seat, 1, firstFrames, BASE + 1500);
  assert.equal(retry.status, 200, retry.text); assert.equal(retry.body.ack, 1);
  const pose = r => { const p = r.body.room.players.find(p => p.id === seat.playerId); return [p.x, p.y, p.z, p.seq]; };
  assert.deepEqual(pose(retry), pose(second)); assert.equal(pose(retry)[3], 2);
  assert.equal((await f.sync(g.code, seat, 1, frames(6, { right: -1 }), BASE + 1600)).status, 409);
  for (let sequence = 3; sequence <= 9; sequence++) assert.equal((await f.sync(g.code, seat, sequence, [], BASE + 1000 + sequence * 200)).status, 200);
  const expired = await f.sync(g.code, seat, 1, firstFrames, BASE + 2900);
  assert.equal(expired.status, 409); assert.equal(expired.body.error, 'SEQUENCE_ORDER');
});

test('multiplayer: delayed old resume cannot resume a later teacher pause', async t => {
  const f = fixture(t), g = await f.game(2);
  const firstPause = await f.control(g.code, 'pause', {}, BASE + 1100);
  assert.equal(firstPause.status, 200);
  const delayedResume = { code: g.code, action: 'resume', revision: firstPause.body.room.controlRevision, operationId: crypto.randomUUID() };
  assert.equal((await f.control(g.code, 'resume', {}, BASE + 1200)).status, 200);
  const laterPause = await f.control(g.code, 'pause', {}, BASE + 1300); assert.equal(laterPause.status, 200);
  const delayed = await f.call('control', { body: delayedResume, principal: TEACHER, now: BASE + 1400 });
  assert.equal(delayed.status, 409); assert.equal(delayed.body.error, 'STALE_CONTROL');
  const state = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1500 });
  assert.equal(state.body.room.status, 'paused');
  assert.equal(state.body.room.controlRevision, laterPause.body.room.controlRevision);
});

test('multiplayer: lost control acknowledgment retries once even after later controls; conflicting reuse and other owners fail', async t => {
  const f = fixture(t), g = await f.game(2);
  const operation = { code: g.code, action: 'pause', revision: g.room.controlRevision, operationId: crypto.randomUUID() };
  const paused = await f.call('control', { body: operation, principal: TEACHER, now: BASE + 1100 }); assert.equal(paused.status, 200);
  const resumed = await f.control(g.code, 'resume', {}, BASE + 1200); assert.equal(resumed.status, 200);
  const retry = await f.call('control', { body: operation, principal: TEACHER, now: BASE + 1300 });
  assert.equal(retry.status, 200); assert.equal(retry.body.room.status, 'running');
  assert.equal(retry.body.room.controlRevision, resumed.body.room.controlRevision);
  assert.ok(!retry.text.includes(operation.operationId)); assert.ok(!retry.text.includes('controlReceipts'));
  const conflict = await f.call('control', { body: { ...operation, action: 'end' }, principal: TEACHER, now: BASE + 1400 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'OPERATION_CONFLICT');
  const stranger = await f.call('control', { body: operation, principal: OTHER, now: BASE + 1400 });
  assert.equal(stranger.status, 403); assert.equal(stranger.body.error, 'NOT_ROOM_TEACHER');
});

test('multiplayer: scoring ticks do not invalidate a control revision; concurrent identical operations apply once', async t => {
  const f = fixture(t), g = await f.game(2);
  const oldRevision = g.room.controlRevision;
  const state = await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1400 });
  assert.equal(state.status, 200); assert.ok(state.body.room.version > g.room.version);
  assert.equal(state.body.room.controlRevision, oldRevision);
  const body = { code: g.code, action: 'pause', revision: oldRevision, operationId: crypto.randomUUID() };
  delayedDatabase(f.db);
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.call('control', { body, principal: TEACHER, now: BASE + 1500 })));
  assert.ok(responses.every(r => r.status === 200), responses.map(r => r.text).join('\n'));
  assert.ok(responses.every(r => r.body.room.controlRevision === oldRevision + 1));
  const room = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_rooms WHERE code=?').get(g.code).state_json);
  assert.equal(room.controlRevision, oldRevision + 1); assert.equal(room.status, 'paused');
});

test('multiplayer wire v2: student keeps exact own authority; remote tuples are compact and self-contained', async t => {
  const f = fixture(t), g = await f.game(4), seat = g.seats[0];
  const r = await f.sync(g.code, seat, 1, frames(6, { forward: 1, yaw: 0.123456789 }));
  assert.equal(r.status, 200, r.text);
  const wire = r.wireRoom, decoded = r.body.room;
  assert.equal(wire.wireVersion, 2);
  assert.equal(wire.own.id, seat.playerId);
  assert.equal(wire.peers.length, 3);
  assert.ok(!Object.hasOwn(wire, 'players'));
  assert.ok(!Object.hasOwn(wire, 'viewerPlayerId'));
  const stored = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  for (const key of ['x','y','z','vx','vy','vz','yaw','grounded','gliding','sliding','glideRemaining','padCooldown','falls','seq','lastSeenMs']) assert.equal(wire.own[key], stored[key], `own ${key} loses no precision`);
  assert.equal(decoded.viewerPlayerId, seat.playerId);
  assert.deepEqual(decoded.players.find(p => p.id === seat.playerId), {...wire.own,appearance:{character:'fox',wing:'angel'}});
  for (const tuple of wire.peers) {
    assert.equal(tuple.length, 9);
    const original = JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(tuple[0]).state_json);
    assert.equal(tuple[1], original.nickname);
    assert.equal(tuple[2], original.team === 'red' ? 0 : 1);
    for (const [index, field] of [[3,'x'],[4,'y'],[5,'z']]) assert.ok(Math.abs(tuple[index] / 100 - original[field]) <= 0.005000001);
    assert.ok(Math.abs(tuple[6] / 1000 - original.yaw) <= 0.000500001);
    for (let i = 2; i < tuple.length; i++) assert.ok(Number.isInteger(tuple[i]), `tuple field ${i} integer`);
    assert.equal(tuple[8] & 1, +original.grounded);
    assert.equal((tuple[8] >> 1) & 1, +original.gliding);
    assert.equal((tuple[8] >> 2) & 1, +original.sliding);
  }
  // No roster cache: independently decoding this single reply recovers all names.
  assert.deepEqual(decodeRoom(JSON.parse(r.text).room).players.map(p => p.id).sort(), g.seats.map(s => s.playerId).sort());
  for (const secret of [...g.seats.map(s => s.seatToken), 'tokenHash','token_hash','owner_id','teacher-a','receipts','creditMs']) assert.ok(!r.text.includes(secret), secret);
});

test('multiplayer wire v2: teacher projection omits full runners and control replies stay compact', async t => {
  const f = fixture(t), g = await f.game(8); addLegacySeats(f,g,32);
  for (const r of [await f.call('state', { body: { code: g.code }, principal: TEACHER, now: BASE + 1200 }), await f.control(g.code, 'pause', {}, BASE + 1300)]) {
    assert.equal(r.status, 200, r.text);
    assert.equal(r.wireRoom.wireVersion, 2);
    assert.equal(r.wireRoom.own, null);
    assert.equal(r.wireRoom.peers.length, 32);
    assert.equal(r.body.room.players.length, 32);
    assert.equal(r.body.room.viewerPlayerId, null);
    assert.ok(r.wireRoom.peers.every(p => Array.isArray(p) && p.length === 9));
    assert.ok(Buffer.byteLength(r.text) <= 4096, `32-seat teacher fixture exceeds 4KiB: ${Buffer.byteLength(r.text)}`);
  }
});

test('multiplayer wire v2: API response decoder fails closed on stale versions and injected fields', async t => {
  const f = fixture(t), g = await f.game(2);
  const r = await f.call('state', { body: { code: g.code }, token: g.seats[0].seatToken, now: BASE + 1200 });
  const clone = () => structuredClone(r.wireRoom);
  for (const version of [undefined, 1, 4, '2']) {
    const wire = clone(); if (version === undefined) delete wire.wireVersion; else wire.wireVersion = version;
    assert.throws(() => decodeRoom(wire), /UNSUPPORTED_MULTIPLAYER_WIRE_VERSION/);
  }
  for (const mutate of [wire => { wire.ownerId = 'injected'; }, wire => { wire.own.tokenHash = 'injected'; }, wire => { wire.peers[0].push('extra'); }, wire => { wire.peers[0][3] = null; }, wire => { wire.peers[0][8] = 16; }, wire => { wire.peers.push([...wire.peers[0]]); }]) {
    const wire = clone(); mutate(wire); assert.throws(() => decodeRoom(wire), /INVALID_MULTIPLAYER_WIRE/);
  }
});

test('multiplayer: delayed packet arrival can exhaust capped credit; reconnect rebases without replaying catch-up', async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0];
  assert.equal((await f.sync(g.code, seat, 1, frames(12), BASE + 1200)).status, 200);
  // A packet produced at client time1400 reaches the server at1900. The
  // server correctly caps 700ms earned time at500ms and spends200ms, leaving300.
  const delayed = await f.sync(g.code, seat, 2, frames(12), BASE + 1900);
  assert.equal(delayed.status, 200, delayed.text);
  const saved = () => JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  const before = saved(); assert.ok(Math.abs(before.creditMs - 300) < 1e-7);
  // Client time2000 computes the max30 catch-up frames from its600ms local
  // cycle, but arrival2001 only adds101ms server credit:500ms >401ms.
  const catchup = await f.sync(g.code, seat, 3, frames(30, { forward: 1 }), BASE + 2001);
  assert.equal(catchup.status, 409); assert.equal(catchup.body.error, 'INPUT_TOO_FAST');
  assert.deepEqual(saved(), before, 'rejected input has no sequence, time or movement effects');
  const reconnected = await f.call('reconnect', { body: { code: g.code }, token: seat.seatToken, now: BASE + 2001 });
  assert.equal(reconnected.status, 200); assert.equal(reconnected.body.ack, 3); assert.equal(saved().creditMs, 0);
  const resumed = await f.sync(g.code, seat, reconnected.body.ack + 1, frames(12), BASE + 2201);
  assert.equal(resumed.status, 200, resumed.text); assert.equal(resumed.body.ack, 4);
  assert.deepEqual(['x','y','z'].map(k => saved()[k]), ['x','y','z'].map(k => before[k]), 'rejected forward backlog was not replayed');
});

test('multiplayer: input-budget rejection retries identical batch after normal interval exactly once', async t => {
  const f = fixture(t), g = await f.game(2), seat = g.seats[0];
  assert.equal((await f.sync(g.code, seat, 1, frames(12), BASE + 1200)).status, 200);
  assert.equal((await f.sync(g.code, seat, 2, frames(12), BASE + 1900)).status, 200);
  const input = frames(30, { forward: 1 });
  const rejected = await f.sync(g.code, seat, 3, input, BASE + 2001);
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error, 'INPUT_TOO_FAST');
  const saved = () => JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
  const before = saved(); assert.equal(before.seq, 2);
  const retry = await f.sync(g.code, seat, 3, input, BASE + 2201);
  assert.equal(retry.status, 200, retry.text); assert.equal(retry.body.ack, 3);
  const after = saved(); assert.equal(after.seq, 3);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0);
  const duplicate = await f.sync(g.code, seat, 3, input, BASE + 2301);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.ack, 3);
  assert.deepEqual(saved(), after, 'ack-loss retry must not replay accepted movement');
});

for(const oldFrames of[[],frames(6,{forward:1})]) for(const first of['sync','reconnect']) test(`multiplayer: reconnect CAS fence wins safely when ${first} writes first (${oldFrames.length} old frames)`,async t=>{
 const f=fixture(t),g=await f.game(2),seat=g.seats[0];let reach,release,blocked=false;const reached=new Promise(r=>reach=r),gate=new Promise(r=>release=r),prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{const wrap=s=>({bind:(...v)=>wrap(s.bind(...v)),execute:(...v)=>s.execute(...v),first:async(...v)=>{if(!blocked&&sql.startsWith('UPDATE mp_seats')){blocked=true;reach();await gate;}return s.first(...v);},all:(...v)=>s.all(...v),run:(...v)=>s.run(...v)});return wrap(prepare(sql));};
 const sync=()=>f.sync(g.code,seat,1,oldFrames,BASE+1200),reconnect=()=>f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1200});
 const held=first==='sync'?reconnect():sync();await reached;const winner=await(first==='sync'?sync():reconnect());assert.equal(winner.status,200,winner.text);release();const loser=await held;
 const saved=JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);
 if(first==='reconnect'){assert.equal(loser.status,409,loser.text);assert.equal(loser.body.error,'SEQUENCE_ORDER');assert.equal(saved.seq,1);assert.deepEqual([saved.x,saved.y,saved.z],['x','y','z'].map(k=>g.room.players.find(p=>p.id===seat.playerId)[k]));}
 else{assert.equal(loser.status,200,loser.text);assert.equal(saved.seq,2);const pose=winner.body.room.players.find(p=>p.id===seat.playerId);assert.deepEqual([saved.x,saved.y,saved.z],[pose.x,pose.y,pose.z]);}
 assert.equal(saved.creditMs,0);assert.deepEqual(saved.receipts,[]);assert.equal(saved.lastHash,'');
 assert.equal((await f.sync(g.code,seat,saved.seq+1,frames(6),BASE+1400)).status,200);
});

test('multiplayer: lost or concurrent reconnect responses remain coherent and preserve legacy v2 identity',async t=>{
 const f=fixture(t),g=await f.game(2),seat=g.seats[0];
 const lost=await f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1200});assert.equal(lost.status,200); // response discarded by a hypothetical transport
 const retried=await f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1200});assert.equal(retried.body.ack,lost.body.ack+1);assert.equal(retried.wireRoom.wireVersion,2);assert.equal(retried.body.playerId,seat.playerId);
 delayedDatabase(f.db);const concurrent=await Promise.all([1,2].map(()=>f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1400})));
 for(const result of concurrent){assert.equal(result.status,200,result.text);assert.equal(result.body.ack,result.body.room.players.find(p=>p.id===seat.playerId).seq);assert.equal(result.body.playerId,seat.playerId);}
 const fresh=await f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1600});assert.equal((await f.sync(g.code,seat,fresh.body.ack+1,frames(6),BASE+1800)).status,200);
});

for(const action of['pause','remove','end']) test(`multiplayer: reconnect fence cannot undo a teacher ${action} during seat CAS`,async t=>{
 const f=fixture(t),g=await f.game(2),seat=g.seats[0];let reach,release,blocked=false;const reached=new Promise(r=>reach=r),gate=new Promise(r=>release=r),prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{const wrap=s=>({bind:(...v)=>wrap(s.bind(...v)),execute:(...v)=>s.execute(...v),first:async(...v)=>{if(!blocked&&sql.startsWith('UPDATE mp_seats')){blocked=true;reach();await gate;}return s.first(...v);},all:(...v)=>s.all(...v),run:(...v)=>s.run(...v)});return wrap(prepare(sql));};
 const pending=f.call('reconnect',{body:{code:g.code},token:seat.seatToken,now:BASE+1200});await reached;assert.equal((await f.control(g.code,action,action==='remove'?{playerId:seat.playerId}:{},BASE+1250)).status,200);release();const result=await pending;
 if(action==='remove'){assert.equal(result.status,403);assert.equal(result.body.error,'SEAT_REMOVED');}else{assert.equal(result.status,200,result.text);assert.equal(result.body.room.status,action==='pause'?'paused':'ended');}
 const saved=JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(seat.playerId).state_json);assert.equal(saved.active,action!=='remove');assert.deepEqual([saved.x,saved.y,saved.z],['x','y','z'].map(k=>g.room.players.find(p=>p.id===seat.playerId)[k]));
});

test('eight-player admissions are atomic; full-room retries and reconnect retain identity; teacher removal revokes', async t => {
  const f=fixture(t), {code}=await f.create();
  const bodies=Array.from({length:12},(_,i)=>({code,nickname:`Capacity ${i}`,joinKey:(i+1).toString(16).padStart(64,'0')}));
  delayedDatabase(f.db);
  const replies=await Promise.all(bodies.map(body=>f.call('join',{body})));
  const admitted=replies.map((r,i)=>({r,i})).filter(({r})=>r.status===200);
  assert.equal(admitted.length,8);assert.equal(replies.filter(r=>r.status===409&&r.body.error==='ROOM_FULL').length,4);
  const {r:first,i}=admitted[0], seat=first.body;
  const retry=await f.call('join',{body:bodies[i],now:BASE+5000});
  assert.equal(retry.status,200);assert.equal(retry.body.playerId,seat.playerId);assert.equal(retry.body.seatToken,seat.seatToken);
  const reconnected=await f.call('reconnect',{body:{code},token:seat.seatToken,now:BASE+5000});
  assert.equal(reconnected.status,200);assert.equal(reconnected.body.room.players.length,8);
  assert.equal((await f.call('join',{body:{code,nickname:'Ninth',joinKey:'ff'.repeat(32)},now:BASE+5000})).body.error,'ROOM_FULL','stale seats remain reserved');
  assert.equal((await f.control(code,'remove',{playerId:seat.playerId},BASE+5100)).status,200);
  for(const path of ['state','reconnect'])assert.equal((await f.call(path,{body:{code},token:seat.seatToken,now:BASE+5200})).status,403);
  assert.equal((await f.call('join',{body:bodies[i],now:BASE+5200})).status,403);
  const replacement=await f.join(code,'Replacement',BASE+5200);assert.equal(replacement.room.players.length,8);assert.notEqual(replacement.playerId,seat.playerId);
  assert.equal((await f.call('join',{body:{code,nickname:'Tenth',joinKey:'ee'.repeat(32)},now:BASE+5300})).body.error,'ROOM_FULL');
});

test('legacy rooms above eight preserve every existing seat without permitting new admissions', async t => {
  const f=fixture(t),g=await f.game(8);addLegacySeats(f,g,12);
  const before=f.db.sqlite.prepare('SELECT id FROM mp_seats WHERE room_code=?').all(g.code).map(s=>s.id).sort();
  const r=await f.call('reconnect',{body:{code:g.code},token:g.seats[0].seatToken,now:BASE+1200});
  assert.equal(r.status,200);assert.equal(r.body.room.players.length,12);
  assert.deepEqual(r.body.room.players.map(p=>p.id).sort(),before);
  assert.equal((await f.call('join',{body:{code:g.code,nickname:'Extra',joinKey:'ef'.repeat(32)},now:BASE+1300})).body.error,'ROOM_FULL');
  await f.control(g.code,'remove',{playerId:g.seats[0].playerId},BASE+1400);
  assert.equal((await f.call('join',{body:{code:g.code,nickname:'Still full',joinKey:'ab'.repeat(32)},now:BASE+1500})).body.error,'ROOM_FULL');
  assert.equal((await f.call('reconnect',{body:{code:g.code},token:g.seats[1].seatToken,now:BASE+1600})).body.room.players.length,11);
  for(let i=1;i<4;i++)await f.control(g.code,'remove',{playerId:g.seats[i].playerId},BASE+1700+i*100);
  assert.equal((await f.call('join',{body:{code:g.code,nickname:'At eight',joinKey:'ac'.repeat(32)},now:BASE+2100})).body.error,'ROOM_FULL');
  await f.control(g.code,'remove',{playerId:g.seats[4].playerId},BASE+2200);
  const replacement=await f.join(g.code,'After migration',BASE+2300);assert.equal(replacement.room.players.length,8);
  assert.equal((await f.call('reconnect',{body:{code:g.code},token:g.seats[5].seatToken,now:BASE+2400})).status,200);
});

test('reconnect sequence exhaustion fails closed without changing seat state',async t=>{
 const f=fixture(t),g=await f.game(2),s=g.seats[0];const row=f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(s.playerId);const p=JSON.parse(row.state_json);p.seq=1000000;
 f.db.sqlite.prepare('UPDATE mp_seats SET state_json=? WHERE id=?').run(JSON.stringify(p),s.playerId);
 const r=await f.call('reconnect',{body:{code:g.code},token:s.seatToken,now:BASE+1200});assert.equal(r.status,409);assert.equal(r.body.error,'SEQUENCE_EXHAUSTED');
 assert.deepEqual(JSON.parse(f.db.sqlite.prepare('SELECT state_json FROM mp_seats WHERE id=?').get(s.playerId).state_json),p);
});
