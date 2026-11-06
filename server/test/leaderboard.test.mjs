import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLeaderboard, COOKIE_NAME, COURSE_RULES, POLICY } from '../lib/leaderboard.mjs';
import { SqliteD1 } from './d1-sqlite.mjs';
const ORIGIN = 'https://skybound.example', START = 1_800_000_000_000;

function fixture(t) {
  const db = new SqliteD1(); t.after(() => db.close());
  async function call(path, { cookie, body, now = START, method = body === undefined ? 'GET' : 'POST', headers = {}, raw, binding = db } = {}) {
    const request = new Request(`${ORIGIN}${path}`, { method, headers: { ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) });
    const response = await handleLeaderboard(request, binding, now), text = await response.text();
    return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
  }
  async function session(now = START) { const r = await call('/api/session', { body: {}, now }); assert.equal(r.status, 200, r.text); return { cookie: r.headers.get('set-cookie').split(';')[0], ...r }; }
  async function run(cookie, { courseId = 'daybreak', key = crypto.randomUUID(), now = START } = {}) { const r = await call('/api/runs', { cookie, now, body: { courseId, rulesVersion: COURSE_RULES[courseId].version, idempotencyKey: key } }); assert.equal(r.status, 200, r.text); return r.body; }
  async function event(cookie, runId, sequence, kind, fields = {}, now = START + sequence * 1000) { return call(`/api/runs/${runId}/events`, { cookie, now, body: { sequence, kind, ...fields } }); }
  async function finish(cookie, run, base = START) {
    let sequence = 0;
    for (const item of COURSE_RULES[run.courseId].milestones) {
      const [kind, value] = item.split(':'); const r = await event(cookie, run.runId, ++sequence, kind, { [kind]: Number(value) }, base + sequence * 1000); assert.equal(r.status, 200, r.text);
    }
    const r = await event(cookie, run.runId, ++sequence, 'finish', {}, base + sequence * 1000); assert.equal(r.status, 200, r.text); return r;
  }
  const board = (courseId = 'daybreak', now = START + 100_000) => call(`/api/leaderboard?courseId=${courseId}&rulesVersion=${COURSE_RULES[courseId].version}`, { now });
  return { db, call, session, run, event, finish, board };
}

test('opaque session cookie; database stores only SHA-256 token hash and fixed alias', async t => {
  const f = fixture(t), s = await f.session();
  assert.match(s.cookie, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}$`));
  for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=86400']) assert.ok(s.headers.get('set-cookie').includes(flag));
  const row = f.db.sqlite.prepare('SELECT * FROM lb_sessions').get();
  assert.match(row.token_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(s.cookie.split('=')[1]));
  assert.match(row.alias, /^(Amber|Azure|Bright|Calm|Copper|Golden|Jade|Silver) (Finch|Heron|Kestrel|Lark|Owl|Robin|Sparrow|Swift) [a-f0-9]{6}$/);
  const repeat = await f.call('/api/session', { cookie: s.cookie, body: {} });
  assert.deepEqual(repeat.body, s.body); assert.equal(repeat.headers.get('set-cookie'), null);
});

test('valid vertical run uses server wall clock and accepted falls, not client totals', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  const fall = await f.event(s.cookie, r.runId, 1, 'fall'); assert.equal(fall.status, 200);
  for (let n = 1; n <= 5; n++) assert.equal((await f.event(s.cookie, r.runId, n + 1, 'checkpoint', { checkpoint: n })).status, 200);
  const done = await f.event(s.cookie, r.runId, 7, 'finish', {}, START + 60_000);
  assert.equal(done.body.scoreMs, 63_000); assert.equal(done.body.falls, 1);
  assert.equal((await f.board()).body.entries[0].scoreMs, 63_000);
  const raw = f.db.sqlite.prepare('SELECT * FROM lb_runs').get(); assert.equal(raw.last_seq, 7); assert.equal(raw.status, 'finished');
});

test('separate anonymous sessions see the same real shared board; no secrets exposed', async t => {
  const f = fixture(t), a = await f.session(), b = await f.session();
  const r = await f.run(a.cookie); await f.finish(a.cookie, r);
  const path = '/api/leaderboard?courseId=daybreak&rulesVersion=vertical-v1';
  const x = await f.call(path, { cookie: a.cookie }), y = await f.call(path, { cookie: b.cookie });
  assert.deepEqual(x.body, y.body); assert.equal(x.body.entries.length, 1);
  for (const secret of [r.runId, a.cookie.split('=')[1], 'token_hash', 'session_hash']) assert.ok(!x.text.includes(secret));
});

test('same start key returns exact immutable receipt; different course conflicts; new key abandons old', async t => {
  const f = fixture(t), s = await f.session(), key = crypto.randomUUID();
  const run = await f.run(s.cookie, { key }); await f.event(s.cookie, run.runId, 1, 'fall');
  const repeat = await f.run(s.cookie, { key, now: START + 9000 }); assert.deepEqual(repeat, run);
  const conflict = await f.call('/api/runs', { cookie: s.cookie, body: { courseId: 'storm', rulesVersion: 'vertical-v1', idempotencyKey: key } });
  assert.equal(conflict.status, 409);
  const next = await f.run(s.cookie, { now: START + 10_000 }); assert.notEqual(next.runId, run.runId);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM lb_runs WHERE status='active'").get().n, 1);
  assert.equal((await f.event(s.cookie, run.runId, 2, 'fall', {}, START + 11_000)).status, 409);
});

test('duplicate fall and finish receipts are byte-identical and effects exactly once', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  const fall = await f.event(s.cookie, r.runId, 1, 'fall');
  const repeat = await f.event(s.cookie, r.runId, 1, 'fall', {}, START + 20_000); assert.equal(repeat.text, fall.text);
  for (let n = 1; n <= 5; n++) await f.event(s.cookie, r.runId, n + 1, 'checkpoint', { checkpoint: n });
  const done = await f.event(s.cookie, r.runId, 7, 'finish');
  const retry = await f.event(s.cookie, r.runId, 7, 'finish', {}, START + POLICY.runMs + 1); assert.equal(retry.text, done.text);
  assert.equal(done.body.falls, 1); assert.equal((await f.board()).body.entries.length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM lb_events').get().n, 7);
});

test('reject reordered, skipped, conflicting or post-finish events without mutation', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  assert.equal((await f.event(s.cookie, r.runId, 2, 'fall')).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 1, 'checkpoint', { checkpoint: 2 })).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 1, 'finish')).status, 409);
  const first = await f.event(s.cookie, r.runId, 1, 'checkpoint', { checkpoint: 1 }); assert.equal(first.status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 1, 'fall')).body.error, 'SEQUENCE_CONFLICT');
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM lb_events').get().n, 1);
});

test('fifth course enforces checkpoint/relay gating and accepts ordered same-tick milestones', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie, { courseId: 'relay-gardens-v1' });
  assert.equal((await f.event(s.cookie, r.runId, 1, 'relay', { relay: 1 })).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 1, 'checkpoint', { checkpoint: 1 }, START + 1000)).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 2, 'checkpoint', { checkpoint: 2 })).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 2, 'relay', { relay: 1 }, START + 1000)).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 3, 'checkpoint', { checkpoint: 2 })).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 4, 'relay', { relay: 2 })).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 4, 'checkpoint', { checkpoint: 3 })).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 5, 'checkpoint', { checkpoint: 4 })).status, 409);
  assert.equal((await f.event(s.cookie, r.runId, 5, 'relay', { relay: 2 })).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 6, 'checkpoint', { checkpoint: 4 })).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 7, 'finish')).status, 200);
  assert.equal((await f.board('relay-gardens-v1')).body.entries.length, 1);
});

test('ownership, session expiry and run expiry are enforced', async t => {
  const f = fixture(t), a = await f.session(), b = await f.session(), r = await f.run(a.cookie);
  assert.equal((await f.event(b.cookie, r.runId, 1, 'fall')).status, 404);
  assert.equal((await f.event(undefined, r.runId, 1, 'fall')).status, 401);
  assert.equal((await f.event(a.cookie, r.runId, 1, 'fall', {}, START + POLICY.runMs)).status, 410);
  assert.equal((await f.event(a.cookie, r.runId, 1, 'fall', {}, START + POLICY.sessionMs)).status, 401);
});

test('strict payload bounds, field rejection, content type and origin controls', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie), path = `/api/runs/${r.runId}/events`;
  for (const body of [{ sequence: 1, kind: 'fall', duration: 0 }, { sequence: 1, kind: 'fall', falls: 0 }, { sequence: 1, kind: 'fall', checkpoint: 1 }, { sequence: 1.5, kind: 'fall' }, { sequence: 257, kind: 'fall' }, []]) {
    assert.equal((await f.call(path, { cookie: s.cookie, body })).status, 400);
  }
  assert.equal((await f.call('/api/session', { body: { name: 'Student' } })).status, 400);
  assert.equal((await f.call(path, { cookie: s.cookie, body: {}, raw: ' '.repeat(2049) })).status, 413);
  assert.equal((await f.call(path, { cookie: s.cookie, body: {}, headers: { 'Content-Length': '2049' } })).status, 413);
  assert.equal((await f.call(path, { cookie: s.cookie, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.call(path, { cookie: s.cookie, body: {}, headers: { Origin: '' } })).status, 403);
  assert.equal((await f.call(path, { cookie: s.cookie, body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.call(path)).status, 405);
});

test('missing or failing database returns non-leaking 503', async t => {
  const f = fixture(t);
  for (const binding of [null, { prepare() { throw new Error('secret db details'); }, batch() {} }]) {
    const r = await f.call('/api/session', { body: {}, binding }); assert.equal(r.status, 503); assert.equal(r.text, '{"error":"BOARD_UNAVAILABLE"}');
  }
});

test('atomic batch failure rolls back event insertion and all run changes', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  f.db.failBatchStatement = 2;
  assert.equal((await f.event(s.cookie, r.runId, 1, 'fall')).status, 503);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM lb_events').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT falls FROM lb_runs').get().falls, 0);
  f.db.failBatchStatement = -1;
  assert.equal((await f.event(s.cookie, r.runId, 1, 'fall')).status, 200);
});

test('concurrent duplicate fall/finish and conflicting sequence do not double-apply', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  const falls = await Promise.all(Array.from({ length: 8 }, () => f.event(s.cookie, r.runId, 1, 'fall')));
  assert.ok(falls.every(x => x.status === 200)); assert.equal(new Set(falls.map(x => x.text)).size, 1);
  const race = await Promise.all([f.event(s.cookie, r.runId, 2, 'fall'), f.event(s.cookie, r.runId, 2, 'checkpoint', { checkpoint: 1 })]);
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  const state = f.db.sqlite.prepare('SELECT * FROM lb_runs').get(); let seq = 2;
  for (let cp = state.progress + 1; cp <= 5; cp++) assert.equal((await f.event(s.cookie, r.runId, ++seq, 'checkpoint', { checkpoint: cp })).status, 200);
  const finals = await Promise.all(Array.from({ length: 8 }, () => f.event(s.cookie, r.runId, seq + 1, 'finish')));
  assert.ok(finals.every(x => x.status === 200)); assert.equal(new Set(finals.map(x => x.text)).size, 1);
  assert.equal((await f.board()).body.entries.length, 1);
});

test('concurrent start keys preserve one active run; same key preserves single issuance', async t => {
  const f = fixture(t), s = await f.session(), key = crypto.randomUUID();
  const runs = await Promise.all(Array.from({ length: 4 }, () => f.run(s.cookie, { key })));
  assert.equal(new Set(runs.map(x => x.runId)).size, 1);
  await Promise.all([f.run(s.cookie), f.run(s.cookie)]);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM lb_runs WHERE status='active'").get().n, 1);
});

test('per-session and global database-backed issuance limits reject excess requests', async t => {
  const f = fixture(t), s = await f.session();
  for (let n = 0; n < 10; n++) await f.run(s.cookie);
  const blocked = await f.call('/api/runs', { cookie: s.cookie, body: { courseId: 'daybreak', rulesVersion: 'vertical-v1', idempotencyKey: crypto.randomUUID() } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  // Seed the actual current global bucket at capacity, then exercise real SQL.
  const bucket = `session-minute:global:${Math.floor(START / 60_000)}`;
  f.db.sqlite.prepare('UPDATE lb_limits SET count=120 WHERE bucket=?').run(bucket);
  assert.equal((await f.call('/api/session', { body: {} })).status, 429);
});

test('board is allowlisted, bounded to 30, stable, and excludes expired retention', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie); await f.finish(s.cookie, r);
  const insert = f.db.sqlite.prepare(`INSERT INTO lb_runs(id,session_hash,alias,course_id,rules_version,start_key,started_ms,expires_ms,status,last_seq,progress,falls,last_event_ms,finished_ms,score_ms)
    VALUES(?,NULL,?,'daybreak','vertical-v1',?,?,?,'finished',6,5,0,?,?,?)`);
  for (let n = 0; n < 35; n++) insert.run(`fixture-${n}`, `Calm Owl ${n}`, `key-${n}`, START, START + 1000, START + 1000, START + 1000, 1000 + n);
  const board = await f.board(); assert.equal(board.body.entries.length, 30); assert.equal(board.body.entries[0].scoreMs, 1000);
  assert.deepEqual((await f.board()).body, board.body);
  assert.equal((await f.board('daybreak', START + POLICY.retentionMs + 1)).body.entries.length, 0);
  assert.equal((await f.call('/api/leaderboard?courseId=nope&rulesVersion=vertical-v1')).status, 400);
  assert.equal((await f.call('/api/leaderboard?courseId=daybreak&rulesVersion=vertical-v1&limit=999')).status, 400);
});

test('cleanup removes expired session linkage and old runs/events in bounded batches', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie); await f.finish(s.cookie, r);
  await f.session(START + POLICY.sessionMs + 1);
  assert.equal(f.db.sqlite.prepare('SELECT session_hash FROM lb_runs WHERE id=?').get(r.runId).session_hash, null);
  assert.equal((await f.board('daybreak', START + POLICY.sessionMs + 1)).body.entries.length, 1);
  await f.session(START + POLICY.retentionMs + 1);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM lb_runs').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM lb_events').get().n, 0);
});

test('loopback HTTP gets a distinct non-Secure development cookie; public host cannot use it', async t => {
  const f = fixture(t);
  const local = new Request('http://127.0.0.1:5173/api/session', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' }, body: '{}' });
  const created = await handleLeaderboard(local, f.db, START), header = created.headers.get('set-cookie');
  assert.equal(created.status, 200); assert.match(header, /^skybound_session_dev=/); assert.ok(!header.includes('Secure'));
  const cookie = header.split(';')[0];
  const localStart = new Request('http://127.0.0.1:5173/api/runs', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ courseId: 'daybreak', rulesVersion: 'vertical-v1', idempotencyKey: crypto.randomUUID() }) });
  assert.equal((await handleLeaderboard(localStart, f.db, START)).status, 200);
  const publicStart = await f.call('/api/runs', { cookie, body: { courseId: 'daybreak', rulesVersion: 'vertical-v1', idempotencyKey: crypto.randomUUID() } });
  assert.equal(publicStart.status, 401);
});

test('failed start batch does not abandon the existing active run', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  f.db.failBatchStatement = 1;
  const rejected = await f.call('/api/runs', { cookie: s.cookie, body: { courseId: 'daybreak', rulesVersion: 'vertical-v1', idempotencyKey: crypto.randomUUID() } });
  assert.equal(rejected.status, 503); assert.equal(f.db.sqlite.prepare('SELECT status FROM lb_runs WHERE id=?').get(r.runId).status, 'active');
});

test('abandon closes once, permits exact retry, and rejects new milestones', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  const abandoned = await f.event(s.cookie, r.runId, 1, 'abandon'); assert.equal(abandoned.body.status, 'abandoned');
  assert.equal((await f.event(s.cookie, r.runId, 1, 'abandon', {}, START + 10_000)).text, abandoned.text);
  assert.equal((await f.event(s.cookie, r.runId, 2, 'fall')).status, 409);
  assert.equal((await f.board()).body.entries.length, 0);
});

test('server timestamp regression and oversized Unicode bodies cannot affect a run', async t => {
  const f = fixture(t), s = await f.session(), r = await f.run(s.cookie);
  assert.equal((await f.event(s.cookie, r.runId, 1, 'fall', {}, START + 10_000)).status, 200);
  assert.equal((await f.event(s.cookie, r.runId, 2, 'fall', {}, START + 9000)).body.error, 'CLOCK_BEFORE_LAST_EVENT');
  const tooLarge = await f.call(`/api/runs/${r.runId}/events`, { cookie: s.cookie, body: {}, raw: JSON.stringify({ padding: '界'.repeat(700) }) });
  assert.equal(tooLarge.status, 413);
  assert.equal(f.db.sqlite.prepare('SELECT falls FROM lb_runs').get().falls, 1);
});

test('Flow records never mix with legacy times; both remain valid and old in-flight runs can finish',async t=>{
 const f=fixture(t),oldSession=await f.session(),newSession=await f.session(),old=await f.run(oldSession.cookie),flow=await f.run(newSession.cookie,{courseId:'daybreak-flow-v1'});
 const mismatch=await f.call('/api/runs',{cookie:newSession.cookie,body:{courseId:'daybreak-flow-v1',rulesVersion:'vertical-v1',idempotencyKey:crypto.randomUUID()}});assert.equal(mismatch.status,400);
 assert.equal((await f.event(newSession.cookie,flow.runId,1,'checkpoint',{checkpoint:2})).status,409);
 await f.finish(oldSession.cookie,old);await f.finish(newSession.cookie,flow);
 const legacy=await f.board(),modern=await f.board('daybreak-flow-v1');assert.equal(legacy.body.entries.length,1);assert.equal(modern.body.entries.length,1);assert.notEqual(legacy.body.entries[0].alias,modern.body.entries[0].alias);
 assert.equal((await f.call('/api/leaderboard?courseId=daybreak&rulesVersion=flow-v1')).status,400);
});

test('all five Flow course rules require four ordered checkpoints before finish',async t=>{
 const f=fixture(t);for(const courseId of Object.keys(COURSE_RULES).filter(id=>id.endsWith('-flow-v1'))){const s=await f.session(),run=await f.run(s.cookie,{courseId});assert.equal((await f.event(s.cookie,run.runId,1,'finish')).status,409);await f.finish(s.cookie,run);assert.equal((await f.board(courseId)).body.entries.length,1);}
});

test('Flow II and Flow I boards stay separate; older in-flight tickets still finish without rewriting records',async t=>{const f=fixture(t),s1=await f.session(),s2=await f.session(),old=await f.run(s1.cookie,{courseId:'daybreak-flow-v1'}),modern=await f.run(s2.cookie,{courseId:'daybreak-flow-v2'});assert.equal((await f.call('/api/runs',{cookie:s2.cookie,body:{courseId:'daybreak-flow-v2',rulesVersion:'flow-v1',idempotencyKey:crypto.randomUUID()}})).status,400);await f.finish(s1.cookie,old);await f.finish(s2.cookie,modern);assert.equal((await f.board('daybreak-flow-v1')).body.entries.length,1);assert.equal((await f.board('daybreak-flow-v2')).body.entries.length,1);assert.equal((await f.board('daybreak')).body.entries.length,0);assert.equal(f.db.sqlite.prepare('SELECT rules_version FROM lb_runs WHERE id=?').get(old.runId).rules_version,'flow-v1');});
test('all five Flow II rules still require four ordered checkpoints',async t=>{const f=fixture(t);for(const courseId of Object.keys(COURSE_RULES).filter(id=>id.endsWith('-flow-v2'))){const s=await f.session(),r=await f.run(s.cookie,{courseId});assert.equal((await f.event(s.cookie,r.runId,1,'finish')).status,409);await f.finish(s.cookie,r);assert.equal((await f.board(courseId)).body.entries.length,1);}});

test('map-wide glide aliases have isolated boards and permit old Flow tickets to finish unchanged',async t=>{
 const f=fixture(t);
 for(const base of ['daybreak','sundown','storm','aurora','relay-gardens-v1'])for(const version of [1,2]){
  const oldId=`${base}-flow-v${version}`,newId=`${oldId}-glide-v1`,oldSession=await f.session(),newSession=await f.session();
  const oldRun=await f.run(oldSession.cookie,{courseId:oldId}),newRun=await f.run(newSession.cookie,{courseId:newId});
  assert.equal(newRun.rulesVersion,'mapwide-glide-v1');assert.equal(oldRun.rulesVersion,`flow-v${version}`);
  assert.equal((await f.call('/api/runs',{cookie:newSession.cookie,body:{courseId:newId,rulesVersion:`flow-v${version}`,idempotencyKey:crypto.randomUUID()}})).status,400);
  await f.finish(oldSession.cookie,oldRun);assert.equal((await f.board(oldId)).body.entries.length,1);assert.equal((await f.board(newId)).body.entries.length,0);
  await f.finish(newSession.cookie,newRun);assert.equal((await f.board(oldId)).body.entries.length,1);assert.equal((await f.board(newId)).body.entries.length,1);
  assert.equal(f.db.sqlite.prepare('SELECT rules_version FROM lb_runs WHERE id=?').get(oldRun.runId).rules_version,`flow-v${version}`);
 }
});
