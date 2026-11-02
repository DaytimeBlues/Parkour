import {isAppearance,validAppearance,appearanceCode} from '../../shared/appearance.mjs';
/** Native Sites/D1 multiplayer demonstrator. No global in-memory room authority.
 * Principals are supplied ONLY by the trusted Sites route adapter (tests inject
 * explicit fixture principals). A room code never authorises teacher actions.
 */
import { createRoomState, createPlayer, stepPlayer, advanceRoom, publicRoom, STALE_MS, ROOM_CAPACITY } from '../../shared/multiplayer.mjs';
import { encodeRoom } from '../../shared/multiplayer-wire.mjs';
export const MP_POLICY = Object.freeze({ maxPlayers: ROOM_CAPACITY, bodyBytes: 12288, maxFrames: 30, frameMs: 1000 / 60, maxCreditMs: 500, roomMs: 6 * 60 * 60 * 1000, maxAttempts: 8, tickMs: 200 });
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });
class ApiError extends Error { constructor(status, code) { super(code); this.status = status; } }
const fail = (status, code) => { throw new ApiError(status, code); };
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
function exact(body, required, optional = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || required.some(k => !Object.hasOwn(body, k)) || Object.keys(body).some(k => !required.includes(k) && !optional.includes(k))) fail(400, 'INVALID_FIELDS');
}
function codeOf(value) { if (typeof value !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(value)) fail(400, 'INVALID_CODE'); return value; }
async function bodyOf(request) {
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_REJECTED');
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MP_POLICY.bodyBytes)) fail(413, 'BODY_TOO_LARGE');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'INVALID_JSON');
  let size = 0; const chunks = [];
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MP_POLICY.bodyBytes) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'INVALID_JSON'); }
}
function teacher(principal) { if (!principal || typeof principal.userId !== 'string' || !principal.userId) fail(401, 'TEACHER_SIGN_IN_REQUIRED'); return principal.userId; }
async function seatHash(request, required = true) {
  const value = request.headers.get('x-skybound-seat');
  if (!value && !required) return null;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) fail(401, 'SEAT_REQUIRED');
  return hash(value);
}
function seat(room, credential) {
  const found = room.players.find(p => p.tokenHash === credential);
  if (!found) fail(403, 'SEAT_NOT_IN_ROOM');
  if (!found.active) fail(403, 'SEAT_REMOVED');
  return found;
}
function validateFrames(frames) {
  if (!Array.isArray(frames) || frames.length > MP_POLICY.maxFrames) fail(400, 'INVALID_FRAMES');
  for (const f of frames) {
    exact(f, ['forward', 'right', 'yaw', 'jump', 'glide', 'slide']);
    if (![-1, 0, 1].includes(f.forward) || ![-1, 0, 1].includes(f.right) || typeof f.yaw !== 'number' || !Number.isFinite(f.yaw) || Math.abs(f.yaw) > 1000 || ['jump', 'glide', 'slide'].some(k => typeof f[k] !== 'boolean')) fail(400, 'INVALID_INPUT');
  }
}
// Scoring integrates the PREVIOUS stored occupancy sample. Live seats are read
// together by one SQL statement; later seat writes need not invalidate the tick.
const occupancy = players => players.filter(p => p.active).map(p => ({ id: p.id, team: p.team, active: true, x: p.x, y: p.y, z: p.z, lastSeenMs: p.lastSeenMs }));
function requireCurrent(room) { if (room.storageVersion !== 2) fail(409, 'ROOM_VERSION_RETIRED'); }
const SNAPSHOT_SQL = `SELECT r.*, (SELECT COALESCE(json_group_array(json(s.state_json)),'[]') FROM mp_seats s WHERE s.room_code=r.code) AS live_players_json FROM mp_rooms r WHERE r.code=?`;
async function snapshot(db, code, now) {
  const row = await statement(db, SNAPSHOT_SQL, code).first();
  if (!row) fail(404, 'ROOM_NOT_FOUND');
  if (row.expires_ms <= now) fail(410, 'ROOM_EXPIRED');
  const room = JSON.parse(row.state_json); requireCurrent(room);
  return { row, room, players: JSON.parse(row.live_players_json) };
}
function authorise(snap, auth) {
  if (auth.owner) { if (snap.row.owner_id !== auth.owner) fail(403, 'NOT_ROOM_TEACHER'); return null; }
  const player = snap.players.find(p => p.id === auth.id);
  if (!player) fail(403, 'SEAT_NOT_IN_ROOM');
  if (!player.active) fail(403, 'SEAT_REMOVED');
  return player;
}
function projection(snap, now, id, host = false, wireVersion = 2) {
  const r = snap.room;
  now = Math.max(now, r.lastTickMs, ...snap.players.map(p => p.lastSeenMs));
  // Score/ownership are committed. Display clock and connectivity use current
  // server sample time, independent from the low-frequency scoring version.
  const remainingMs = r.status === 'running' ? Math.max(0, r.remainingMs - Math.max(0, now - r.lastTickMs)) : r.remainingMs;
  return encodeRoom({ ...publicRoom({ ...r, remainingMs, lastTickMs: now, players: snap.players }, id, host), code: r.code, epoch: r.epoch, version: snap.row.version, locked: r.locked, controlRevision: r.controlRevision ?? 0, serverTime: now, snapshotMs: now }, id, wireVersion);
}
function authSql(auth) {
  return auth.owner ? { sql: 'owner_id=?', args: [auth.owner] } : { sql: `EXISTS(SELECT 1 FROM mp_seats s WHERE s.room_code=mp_rooms.code AND s.id=? AND s.token_hash=? AND json_extract(s.state_json,'$.active')=1)`, args: [auth.id, auth.credential] };
}
async function tick(db, snap, now, auth) {
  authorise(snap, auth);
  // A snapshot may contain a pose accepted after this request started. Never
  // stamp that next occupancy sample before the pose's server acceptance time.
  now = Math.max(now, snap.room.lastTickMs, ...snap.players.map(p => p.lastSeenMs));
  if (snap.room.status !== 'running' || now - snap.room.lastTickMs < MP_POLICY.tickMs && now - snap.room.lastTickMs < snap.room.remainingMs) return snap;
  const r = structuredClone(snap.room), epoch = r.epoch;
  advanceRoom(r, now); r.players = occupancy(snap.players);
  if (r.status === 'ended') r.epoch++;
  r.version = snap.row.version + 1;
  const guard = authSql(auth);
  const saved = await statement(db, `UPDATE mp_rooms SET state_json=?,version=? WHERE code=? AND version=? AND expires_ms>? AND json_extract(state_json,'$.epoch')=? AND ${guard.sql} RETURNING version`, JSON.stringify(r), r.version, r.code, snap.row.version, now, epoch, ...guard.args).first();
  if (saved) return { ...snap, room: r, row: { ...snap.row, version: r.version } };
  // A competing tick/control won. This is NOT a failed input. Reload once rather
  // than retrying an all-room write in every player's exchange.
  const fresh = await snapshot(db, r.code, now); authorise(fresh, auth); return fresh;
}
async function readSeat(db, code, credential, now) {
  const row = await statement(db, `SELECT s.id,s.state_json,s.version,r.state_json AS room_json,r.owner_id,r.expires_ms FROM mp_seats s JOIN mp_rooms r ON r.code=s.room_code WHERE s.room_code=? AND s.token_hash=?`, code, credential).first();
  if (!row) fail(403, 'SEAT_NOT_IN_ROOM');
  if (row.expires_ms <= now) fail(410, 'ROOM_EXPIRED');
  const room = JSON.parse(row.room_json); requireCurrent(room);
  const player = JSON.parse(row.state_json); if (!player.active) fail(403, 'SEAT_REMOVED');
  return { row, room, player };
}
async function updateSeat(db, code, credential, now, body, payloadHash, reconnect) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { row, room, player: p } = await readSeat(db, code, credential, now);
    const effectiveNow = Math.max(now, p.creditAtMs);
    if (!reconnect) {
      if (body.epoch !== room.epoch) fail(409, 'STALE_EPOCH');
      if (body.sequence <= p.seq) {
        const receipt = (p.receipts || [{ seq: p.seq, hash: p.lastHash }]).find(r => r.seq === body.sequence);
        if (!receipt) fail(409, 'SEQUENCE_ORDER');
        if (payloadHash !== receipt.hash) fail(409, 'SEQUENCE_CONFLICT');
        return { id: p.id, ack: body.sequence, credential };
      }
      if (body.sequence !== p.seq + 1) fail(409, 'SEQUENCE_ORDER');
      const running = room.status === 'running' && effectiveNow < room.lastTickMs + room.remainingMs;
      if (running && effectiveNow - p.lastSeenMs >= STALE_MS) fail(409, 'RECONNECT_REQUIRED');
      const credit = Math.min(MP_POLICY.maxCreditMs, p.creditMs + Math.max(0, effectiveNow - p.creditAtMs));
      if (running && body.frames.length * MP_POLICY.frameMs > credit + .001) fail(409, 'INPUT_TOO_FAST');
      if (running) for (const input of body.frames) stepPlayer(p, input, 1 / 60);
      p.creditMs = running ? credit - body.frames.length * MP_POLICY.frameMs : 0;
      p.seq = body.sequence; p.lastHash = payloadHash;
      p.receipts = [...(p.receipts || []), { seq: p.seq, hash: payloadHash }].slice(-8);
    } else {
      // Fence an already dispatched pre-reconnect batch inside the same guarded
      // seat CAS. Reconnect never replays movement or restores revoked access.
      if (!Number.isSafeInteger(p.seq) || p.seq >= 1000000) fail(409, 'SEQUENCE_EXHAUSTED');
      p.seq++; p.receipts = []; p.lastHash = ''; p.creditMs = 0;
    }
    p.creditAtMs = effectiveNow; p.lastSeenMs = effectiveNow;
    // Membership, current phase and epoch are checked IN the effect statement.
    // A pause/remove/end after the read cannot leave an accepted stale movement.
    const saved = await statement(db, `UPDATE mp_seats SET state_json=?,version=version+1 WHERE id=? AND room_code=? AND token_hash=? AND version=? AND json_extract(state_json,'$.active')=1 AND EXISTS(SELECT 1 FROM mp_rooms r WHERE r.code=mp_seats.room_code AND r.expires_ms>? AND json_extract(r.state_json,'$.epoch')=? AND json_extract(r.state_json,'$.status')=?) RETURNING version`, JSON.stringify(p), p.id, code, credential, row.version, now, room.epoch, room.status).first();
    if (saved) return { id: p.id, ack: p.seq, credential };
  }
  fail(503, 'SEAT_BUSY');
}
async function teacherControl(db, code, now, owner, body, wireVersion) {
  const payloadHash = await hash(JSON.stringify([body.revision, body.action, body.playerId ?? null, body.locked ?? null]));
  for (let attempt = 0; attempt < MP_POLICY.maxAttempts; attempt++) {
    const snap = await snapshot(db, code, now); authorise(snap, { owner });
    const receipt = (snap.room.controlReceipts || []).find(r => r.id === body.operationId);
    if (receipt) { if (receipt.hash !== payloadHash) fail(409, 'OPERATION_CONFLICT'); return json({ room: projection(snap, now, undefined, true, wireVersion) }); }
    if (body.revision !== (snap.room.controlRevision ?? 0)) fail(409, 'STALE_CONTROL');
    const room = structuredClone(snap.room), originalEpoch = room.epoch, action = body.action, effectiveNow = Math.max(now, room.lastTickMs, ...snap.players.map(p => p.lastSeenMs));
    advanceRoom(room, effectiveNow);
    const players = structuredClone(snap.players), mutations = [];
    const nonce = crypto.randomUUID();
    const guard = `EXISTS(SELECT 1 FROM mp_rooms r WHERE r.code=mp_seats.room_code AND r.owner_id=? AND r.expires_ms>? AND json_extract(r.state_json,'$.controlNonce')=?)`;
    if (action === 'start') {
      if (room.status !== 'lobby') fail(409, 'INVALID_PHASE');
      if (!['red', 'blue'].every(team => players.some(p => p.active && p.team === team))) fail(409, 'NEED_TWO_TEAMS');
      room.status = 'running'; room.lastTickMs = effectiveNow; room.epoch++;
      for (const team of ['red', 'blue']) {
        const patch = { ...createPlayer(team), creditMs: 0, creditAtMs: effectiveNow, lastSeenMs: effectiveNow };
        mutations.push(statement(db, `UPDATE mp_seats SET state_json=json_patch(state_json,json(?)),version=version+1 WHERE room_code=? AND json_extract(state_json,'$.active')=1 AND json_extract(state_json,'$.team')=? AND ${guard}`, JSON.stringify(patch), code, team, owner, now, nonce));
        for (const p of players.filter(p => p.active && p.team === team)) Object.assign(p, patch);
      }
    } else if (action === 'pause') {
      if (room.status !== 'running') fail(409, 'INVALID_PHASE'); room.status = 'paused'; room.epoch++;
    } else if (action === 'resume') {
      if (room.status !== 'paused') fail(409, 'INVALID_PHASE'); room.status = 'running'; room.lastTickMs = effectiveNow; room.epoch++;
      mutations.push(statement(db, `UPDATE mp_seats SET state_json=json_set(state_json,'$.creditMs',0,'$.creditAtMs',?,'$.lastSeenMs',CASE WHEN json_extract(state_json,'$.lastSeenMs')>? THEN ? ELSE 0 END),version=version+1 WHERE room_code=? AND json_extract(state_json,'$.active')=1 AND ${guard}`, effectiveNow, effectiveNow - STALE_MS, effectiveNow, code, owner, now, nonce));
      for (const p of players) { p.creditMs = 0; p.creditAtMs = effectiveNow; p.lastSeenMs = effectiveNow - p.lastSeenMs < STALE_MS ? effectiveNow : 0; }
    } else if (action === 'end') {
      if (room.status !== 'ended') { room.status = 'ended'; room.winner = Math.abs(room.scores.red - room.scores.blue) < 1e-8 ? 'tie' : room.scores.red > room.scores.blue ? 'red' : 'blue'; room.epoch++; }
    } else if (action === 'remove') {
      const p = players.find(p => p.id === body.playerId); if (!p) fail(404, 'PLAYER_NOT_FOUND'); p.active = false; p.creditMs = 0;
      mutations.push(statement(db, `UPDATE mp_seats SET state_json=json_set(state_json,'$.active',json('false'),'$.creditMs',0),version=version+1 WHERE id=? AND room_code=? AND ${guard}`, p.id, code, owner, now, nonce));
    } else room.locked = body.locked;
    room.players = occupancy(players); room.controlNonce = nonce; room.controlRevision = body.revision + 1;
    room.controlReceipts = [...(room.controlReceipts || []), { id: body.operationId, hash: payloadHash }].slice(-16);
    room.version = snap.row.version + 1;
    const change = statement(db, `UPDATE mp_rooms SET state_json=?,version=? WHERE code=? AND version=? AND owner_id=? AND expires_ms>? AND json_extract(state_json,'$.epoch')=? AND COALESCE(json_extract(state_json,'$.controlRevision'),0)=? RETURNING version`, JSON.stringify(room), room.version, code, snap.row.version, owner, now, originalEpoch, body.revision);
    // D1 batch is one transaction: either room fence and seat effects commit, or
    // neither. Unique nonce prevents effects following a failed CAS.
    const results = await db.batch([change, ...mutations]);
    if (results[0].results?.length) {
      const fresh = await snapshot(db, code, now); authorise(fresh, { owner }); return json({ room: projection(fresh, now, undefined, true, wireVersion) });
    }
    await new Promise(resolve => setTimeout(resolve, 2 + attempt * 3));
  }
  fail(503, 'ROOM_BUSY');
}
/** @param {Request} request
 * @param {any} db Native D1 binding or isolated SQL fixture.
 * @param {{now?: number, principal?: {userId: string} | null}} options
 */
export async function handleMultiplayer(request, db, { now = Date.now(), principal = null } = {}) {
  try {
    const wireVersion = request.headers.get('x-skybound-wire') === '3' ? 3 : 2;
    const project = (snap, time, id, host = false) => projection(snap, time, id, host, wireVersion);
    const url = new URL(request.url), path = url.pathname.replace(/\/$/, '');
    if (path === '/api/multiplayer/me' && request.method === 'GET') return json({ signedIn: !!principal?.userId });
    if (!db) fail(503, 'MULTIPLAYER_UNAVAILABLE');
    if (path === '/api/multiplayer/rooms' && request.method === 'GET') {
      const owner = teacher(principal);
      const rows = await statement(db, `SELECT r.code,r.state_json,(SELECT count(*) FROM mp_seats s WHERE s.room_code=r.code AND json_extract(s.state_json,'$.active')=1) AS seats FROM mp_rooms r WHERE r.owner_id=? AND r.expires_ms>? ORDER BY r.created_ms DESC LIMIT 8`, owner, now).all();
      return json({ rooms: rows.results.map(row => { const r = JSON.parse(row.state_json); return { code: row.code, status: r.storageVersion === 2 ? r.status : 'retired', players: row.seats, createdMs: r.createdMs }; }) });
    }
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
    const body = await bodyOf(request);
    if (path === '/api/multiplayer/rooms') {
      const owner = teacher(principal); exact(body, [], ['durationSeconds']); const duration = body.durationSeconds ?? 300;
      if (!Number.isInteger(duration) || duration < 30 || duration > 1800) fail(400, 'INVALID_DURATION');
      await statement(db, 'DELETE FROM mp_rooms WHERE code IN (SELECT code FROM mp_rooms WHERE expires_ms<=? LIMIT 25)', now).run();
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = roomCode(), room = { ...createRoomState(now, duration * 1000), code, epoch: 0, version: 0, storageVersion: 2, controlRevision: 0, controlReceipts: [], locked: false, createdMs: now };
        const row = await statement(db, 'INSERT INTO mp_rooms(code,owner_id,state_json,version,created_ms,expires_ms) SELECT ?,?,?,0,?,? WHERE (SELECT count(*) FROM mp_rooms WHERE owner_id=? AND expires_ms>?)<8 ON CONFLICT(code) DO NOTHING RETURNING code', code, owner, JSON.stringify(room), now, now + MP_POLICY.roomMs, owner, now).first();
        if (row) return json({ code, room: project({ room, players: [], row: { version: 0 } }, now, undefined, true) });
      }
      fail(429, 'ROOM_LIMIT');
    }
    if (path === '/api/multiplayer/join') {
      exact(body, ['code', 'nickname', 'joinKey'], ['appearance']);
      if (body.appearance !== undefined && !isAppearance(body.appearance)) fail(400, 'INVALID_APPEARANCE');
      const appearance = validAppearance(body.appearance); const code = codeOf(body.code);
      if (typeof body.nickname !== 'string') fail(400, 'INVALID_NICKNAME');
      const nickname = body.nickname.trim().replace(/\s+/g, ' ');
      if (!nickname || nickname.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(nickname)) fail(400, 'INVALID_NICKNAME');
      if (typeof body.joinKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.joinKey)) fail(400, 'INVALID_JOIN_KEY');
      const seatToken = await hash('skybound-seat-v1:' + code + ':' + body.joinKey), credential = await hash(seatToken);
      // Existing join retry precedes lock/cap checks; revoked seats stay revoked.
      const prior = await statement(db, 'SELECT state_json FROM mp_seats WHERE room_code=? AND token_hash=?', code, credential).first();
      if (prior) {
        const p = JSON.parse(prior.state_json); if (!p.active) fail(403, 'SEAT_REMOVED'); if (p.nickname !== nickname || body.appearance !== undefined && appearanceCode(p.appearance) !== appearanceCode(appearance)) fail(409, 'JOIN_KEY_CONFLICT');
        const snap = await snapshot(db, code, now); return json({ seatToken, playerId: p.id, room: project(snap, now, p.id) });
      }
      const snap = await snapshot(db, code, now);
      if (snap.room.status === 'ended') fail(409, 'ROOM_ENDED'); if (snap.room.locked) fail(403, 'ROOM_LOCKED');
      const id = crypto.randomUUID();
      // Team assignment and cap are selected from current seats INSIDE INSERT,
      // not a preceding count. The stored pose starts at the selected team's spawn.
      const red = { ...createPlayer('red'), id, nickname, appearance, active: true, lastSeenMs: now, seq: 0, lastHash: '', creditMs: 0, creditAtMs: now };
      const blue = { ...red, ...createPlayer('blue') };
      const added = await statement(db, `INSERT INTO mp_seats(id,room_code,token_hash,state_json,version)
        SELECT ?,r.code,?,CASE WHEN (SELECT count(*) FROM mp_seats WHERE room_code=r.code AND json_extract(state_json,'$.active')=1 AND json_extract(state_json,'$.team')='red') <= (SELECT count(*) FROM mp_seats WHERE room_code=r.code AND json_extract(state_json,'$.active')=1 AND json_extract(state_json,'$.team')='blue') THEN ? ELSE ? END,0
        FROM mp_rooms r WHERE r.code=? AND r.expires_ms>? AND json_extract(r.state_json,'$.storageVersion')=2 AND json_extract(r.state_json,'$.status')!='ended' AND json_extract(r.state_json,'$.locked')=0 AND (SELECT count(*) FROM mp_seats WHERE room_code=r.code AND json_extract(state_json,'$.active')=1)<? AND (SELECT count(*) FROM mp_seats WHERE room_code=r.code)<128
        ON CONFLICT(room_code,token_hash) DO NOTHING RETURNING id`, id, credential, JSON.stringify(red), JSON.stringify(blue), code, now, MP_POLICY.maxPlayers).first();
      if (!added) {
        const existing = await statement(db, 'SELECT state_json FROM mp_seats WHERE room_code=? AND token_hash=?', code, credential).first();
        if (existing) { const p = JSON.parse(existing.state_json); if (!p.active) fail(403, 'SEAT_REMOVED'); if (p.nickname !== nickname || body.appearance !== undefined && appearanceCode(p.appearance) !== appearanceCode(appearance)) fail(409, 'JOIN_KEY_CONFLICT'); const s = await snapshot(db, code, now); return json({ seatToken, playerId: p.id, room: project(s, now, p.id) }); }
        const fresh = await snapshot(db, code, now); if (fresh.room.locked) fail(403, 'ROOM_LOCKED'); if (fresh.room.status === 'ended') fail(409, 'ROOM_ENDED'); fail(409, 'ROOM_FULL');
      }
      const fresh = await snapshot(db, code, now); return json({ seatToken, playerId: id, room: project(fresh, now, id) });
    }
    if (['/api/multiplayer/sync', '/api/multiplayer/state', '/api/multiplayer/reconnect'].includes(path)) {
      const sync = path.endsWith('/sync'), reconnect = path.endsWith('/reconnect');
      exact(body, sync ? ['code', 'sequence', 'epoch', 'frames'] : ['code']); const code = codeOf(body.code);
      const credential = await seatHash(request, sync || reconnect);
      let auth, ack;
      if (sync) {
        if (!Number.isSafeInteger(body.sequence) || body.sequence < 1 || body.sequence > 1000000) fail(400, 'INVALID_SEQUENCE');
        if (!Number.isSafeInteger(body.epoch) || body.epoch < 0) fail(400, 'INVALID_EPOCH'); validateFrames(body.frames);
        const digest = await hash(JSON.stringify([body.epoch, body.sequence, body.frames.map(f => [f.forward, f.right, f.yaw, f.jump, f.glide, f.slide])]));
        auth = await updateSeat(db, code, credential, now, body, digest, false); ack = auth.ack;
      } else if (reconnect) { auth = await updateSeat(db, code, credential, now, null, '', true); ack = auth.ack; }
      else if (credential) { const p = await readSeat(db, code, credential, now); auth = { id: p.player.id, credential }; ack = p.player.seq; }
      else auth = { owner: teacher(principal) };
      let snap = await snapshot(db, code, now); authorise(snap, auth); snap = await tick(db, snap, now, auth);
      const self = authorise(snap, auth);
      return json({ room: project(snap, now, auth.id, !!auth.owner), ...(self ? { ack: reconnect ? self.seq : ack ?? self.seq, playerId: self.id } : {}) });
    }
    if (path === '/api/multiplayer/control') {
      const owner = teacher(principal);
      if (!body || typeof body.action !== 'string' || !['start', 'pause', 'resume', 'end', 'remove', 'lock'].includes(body.action)) fail(400, 'INVALID_ACTION');
      exact(body, ['code', 'action', 'revision', 'operationId', ...(body.action === 'remove' ? ['playerId'] : body.action === 'lock' ? ['locked'] : [])]);
      const code = codeOf(body.code);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.operationId)) fail(400, 'INVALID_CONTROL');
      if (body.action === 'remove' && typeof body.playerId !== 'string') fail(400, 'INVALID_PLAYER');
      if (body.action === 'lock' && typeof body.locked !== 'boolean') fail(400, 'INVALID_LOCK');
      return await teacherControl(db, code, now, owner, body, wireVersion);
    }
    fail(404, 'NOT_FOUND');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status, error.status === 503 ? { 'Retry-After': '1' } : {});
    return json({ error: 'MULTIPLAYER_UNAVAILABLE' }, 503, { 'Retry-After': '1' });
  }
}
