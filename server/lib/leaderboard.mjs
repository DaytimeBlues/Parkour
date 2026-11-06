/**
 * Anonymous shared board: server timing and ordered CLIENT-CLAIMED milestones.
 * Not physics-authoritative, identity verification, or cheat-proof.
 * No framework/Node dependencies; D1 binding supplied by the route adapter.
 */
const MINUTE = 60_000, DAY = 86_400_000;
export const POLICY = Object.freeze({ bodyBytes: 2048, sessionMs: DAY, runMs: 30 * MINUTE, retentionMs: 30 * DAY, maxEvents: 256 });
export const COOKIE_NAME = '__Host-skybound_session';
const DEV_COOKIE_NAME = 'skybound_session_dev';
export const COURSE_RULES = Object.freeze(Object.fromEntries([
  ...['daybreak','sundown','storm','aurora','relay-gardens-v1'].flatMap(id=>[1,2].map(v=>[`${id}-flow-v${v}-glide-v1`,Object.freeze({version:'mapwide-glide-v1',milestones:Object.freeze(['checkpoint:1','checkpoint:2','checkpoint:3','checkpoint:4'])})])),
  ...['daybreak','sundown','storm','aurora','relay-gardens-v1'].map(id=>[`${id}-flow-v2`,Object.freeze({version:'flow-v2',milestones:Object.freeze(['checkpoint:1','checkpoint:2','checkpoint:3','checkpoint:4'])})]),
  ...['daybreak','sundown','storm','aurora','relay-gardens-v1'].map(id=>[`${id}-flow-v1`,Object.freeze({version:'flow-v1',milestones:Object.freeze(['checkpoint:1','checkpoint:2','checkpoint:3','checkpoint:4'])})]),
  ...['daybreak', 'sundown', 'storm', 'aurora'].map(id => [id, Object.freeze({ version: 'vertical-v1', milestones: Object.freeze(['checkpoint:1', 'checkpoint:2', 'checkpoint:3', 'checkpoint:4', 'checkpoint:5']) })]),
  ['relay-gardens-v1', Object.freeze({ version: 'relay-gardens-v1-be1290f', milestones: Object.freeze(['checkpoint:1', 'relay:1', 'checkpoint:2', 'checkpoint:3', 'relay:2', 'checkpoint:4']) })],
]));
const ADJECTIVES = ['Amber', 'Azure', 'Bright', 'Calm', 'Copper', 'Golden', 'Jade', 'Silver'];
const BIRDS = ['Finch', 'Heron', 'Kestrel', 'Lark', 'Owl', 'Robin', 'Sparrow', 'Swift'];
const NO_STORE = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
class ApiError extends Error { constructor(status, code, retryAfter) { super(code); this.status = status; this.code = code; this.retryAfter = retryAfter; } }
const fail = (status, code) => { throw new ApiError(status, code); };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { ...NO_STORE, ...headers } });
const savedReceipt = receipt => new Response(receipt, { status: 200, headers: NO_STORE });
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const hex = bytes => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
const digest = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const alias = () => { const b = crypto.getRandomValues(new Uint8Array(5)); return `${ADJECTIVES[b[0] % 8]} ${BIRDS[b[1] % 8]} ${hex(b.slice(2))}`; };
function exactKeys(body, required, optional = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY');
  if (required.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) fail(400, 'INVALID_FIELDS');
}
async function readBody(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > POLICY.bodyBytes)) fail(413, 'BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON');
  let length = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > POLICY.bodyBytes) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON'); }
}
function originCheck(request, url) {
  if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_REJECTED');
}
function cookiePolicy(request) {
  const url = new URL(request.url);
  // HTTP exception ONLY for actual loopback URLs. Never accept a development
  // cookie on the public Site, even if it is copied there by a visitor.
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return { name: localHttp ? DEV_COOKIE_NAME : COOKIE_NAME, secure: !localHttp };
}
async function session(request, db, now, required = true) {
  const name = cookiePolicy(request).name;
  const cookies = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (cookies.length !== 1) { if (required) fail(401, 'SESSION_REQUIRED'); return null; }
  const token = cookies[0].slice(name.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { if (required) fail(401, 'SESSION_REQUIRED'); return null; }
  const hash = await digest(token);
  const found = await stmt(db, 'SELECT token_hash,alias,expires_ms FROM lb_sessions WHERE token_hash=? AND expires_ms>?', hash, now).first();
  if (!found && required) fail(401, 'SESSION_EXPIRED');
  return found;
}
async function limit(db, category, key, now, period, maximum) {
  const window = Math.floor(now / period), bucket = `${category}:${key}:${window}`;
  const result = await stmt(db, `INSERT INTO lb_limits(bucket,count,expires_ms) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=lb_limits.count+1 WHERE lb_limits.count<? RETURNING count`, bucket, (window + 1) * period + DAY, maximum).first();
  if (!result) throw new ApiError(429, 'RATE_LIMITED', Math.max(1, Math.ceil(((window + 1) * period - now) / 1000)));
}
async function cleanup(db, now) {
  // Bounded opportunistic maintenance. Never DDL; no background account needed.
  // Remove links to expired sessions before deleting those same session records.
  await db.batch([
    stmt(db, `UPDATE lb_runs SET session_hash=NULL WHERE id IN
      (SELECT r.id FROM lb_runs r JOIN lb_sessions s ON s.token_hash=r.session_hash
       WHERE s.expires_ms<=? ORDER BY s.expires_ms,r.id LIMIT 25)`, now),
    stmt(db, `DELETE FROM lb_sessions WHERE token_hash IN (SELECT s.token_hash FROM lb_sessions s
      WHERE s.expires_ms<=? AND NOT EXISTS(SELECT 1 FROM lb_runs r WHERE r.session_hash=s.token_hash)
      ORDER BY s.expires_ms LIMIT 25)`, now),
    stmt(db, 'DELETE FROM lb_runs WHERE id IN (SELECT id FROM lb_runs WHERE started_ms<? ORDER BY started_ms LIMIT 25)', now - POLICY.retentionMs),
    stmt(db, 'DELETE FROM lb_limits WHERE bucket IN (SELECT bucket FROM lb_limits WHERE expires_ms<=? ORDER BY expires_ms LIMIT 25)', now),
  ]);
}
function validateCourse(courseId, rulesVersion) {
  if (typeof courseId !== 'string' || !Object.hasOwn(COURSE_RULES, courseId)) fail(400, 'UNKNOWN_COURSE');
  if (rulesVersion !== COURSE_RULES[courseId].version) fail(400, 'RULES_VERSION_MISMATCH');
  return COURSE_RULES[courseId];
}
function startReceipt(run) {
  // Immutable receipt: a retried start never changes as the run advances.
  return { runId: run.id, alias: run.alias, courseId: run.course_id, rulesVersion: run.rules_version,
    startedMs: run.started_ms, expiresMs: run.expires_ms, penaltyMs: 3000, timing: 'server-wall-clock-including-pauses', authority: 'client-claimed-milestones' };
}
async function createSession(request, db, now, body) {
  exactKeys(body, []);
  const existing = await session(request, db, now, false);
  if (existing) return json({ alias: existing.alias, expiresMs: existing.expires_ms });
  await limit(db, 'session-minute', 'global', now, MINUTE, 120);
  await limit(db, 'session-day', 'global', now, DAY, 2000);
  await cleanup(db, now);
  const token = randomToken(), hash = await digest(token), name = alias(), expiry = now + POLICY.sessionMs;
  await stmt(db, 'INSERT INTO lb_sessions(token_hash,alias,created_ms,expires_ms) VALUES(?,?,?,?)', hash, name, now, expiry).run();
  const cookie = cookiePolicy(request);
  return json({ alias: name, expiresMs: expiry }, 200, { 'Set-Cookie': `${cookie.name}=${token}; Path=/; ${cookie.secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict; Max-Age=86400` });
}
async function createRun(request, db, now, body) {
  exactKeys(body, ['courseId', 'rulesVersion', 'idempotencyKey']);
  validateCourse(body.courseId, body.rulesVersion);
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(body.idempotencyKey)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
  const owner = await session(request, db, now), hash = owner.token_hash;
  let run = await stmt(db, 'SELECT * FROM lb_runs WHERE session_hash=? AND start_key=?', hash, body.idempotencyKey).first();
  if (!run) {
    await limit(db, 'start-minute', hash, now, MINUTE, 10);
    await limit(db, 'start-global-minute', 'global', now, MINUTE, 600);
    await limit(db, 'start-global-day', 'global', now, DAY, 10_000);
    const id = crypto.randomUUID();
    const results = await db.batch([
      stmt(db, `UPDATE lb_runs SET status='abandoned' WHERE session_hash=? AND status='active'
        AND NOT EXISTS(SELECT 1 FROM lb_runs WHERE session_hash=? AND start_key=?)
        AND EXISTS(SELECT 1 FROM lb_sessions WHERE token_hash=? AND expires_ms>?)`, hash, hash, body.idempotencyKey, hash, now),
      stmt(db, `INSERT INTO lb_runs(id,session_hash,alias,course_id,rules_version,start_key,started_ms,expires_ms,last_event_ms)
        SELECT ?,token_hash,alias,?,?,?,?,?,? FROM lb_sessions WHERE token_hash=? AND expires_ms>?
        ON CONFLICT(session_hash,start_key) DO NOTHING`, id, body.courseId, body.rulesVersion, body.idempotencyKey, now, now + POLICY.runMs, now, hash, now),
      stmt(db, 'SELECT * FROM lb_runs WHERE session_hash=? AND start_key=?', hash, body.idempotencyKey),
    ]);
    run = results[2].results[0];
    if (!run) fail(401, 'SESSION_EXPIRED');
  }
  if (run.course_id !== body.courseId || run.rules_version !== body.rulesVersion) fail(409, 'IDEMPOTENCY_CONFLICT');
  return json(startReceipt(run));
}
function validateEvent(body) {
  exactKeys(body, ['sequence', 'kind'], ['checkpoint', 'relay']);
  if (!Number.isSafeInteger(body.sequence) || body.sequence < 1 || body.sequence > POLICY.maxEvents) fail(400, 'INVALID_SEQUENCE');
  if (!['checkpoint', 'relay', 'fall', 'finish', 'abandon'].includes(body.kind)) fail(400, 'INVALID_EVENT_KIND');
  const field = body.kind === 'checkpoint' ? 'checkpoint' : body.kind === 'relay' ? 'relay' : null;
  if (field && (!Number.isSafeInteger(body[field]) || body[field] < 1 || body[field] > 5)) fail(400, 'INVALID_MILESTONE');
  if (Object.hasOwn(body, 'checkpoint') !== (field === 'checkpoint') || Object.hasOwn(body, 'relay') !== (field === 'relay')) fail(400, 'INVALID_FIELDS');
  return field ? `${body.kind}:${body[field]}` : body.kind;
}
async function event(request, db, now, runId, body) {
  const label = validateEvent(body), payloadHash = await digest(JSON.stringify([body.sequence, label]));
  const owner = await session(request, db, now), hash = owner.token_hash;
  const run = await stmt(db, 'SELECT * FROM lb_runs WHERE id=? AND session_hash=?', runId, hash).first();
  if (!run) fail(404, 'RUN_NOT_FOUND');
  const previous = await stmt(db, 'SELECT payload_hash,receipt_json FROM lb_events WHERE run_id=? AND sequence=?', runId, body.sequence).first();
  if (previous) {
    if (previous.payload_hash !== payloadHash) fail(409, 'SEQUENCE_CONFLICT');
    if (!previous.receipt_json) fail(503, 'BOARD_UNAVAILABLE');
    return savedReceipt(previous.receipt_json);
  }
  if (run.status !== 'active') fail(409, 'RUN_CLOSED');
  if (run.expires_ms <= now) fail(410, 'RUN_EXPIRED');
  if (now < run.last_event_ms) fail(409, 'CLOCK_BEFORE_LAST_EVENT');
  if (body.sequence !== run.last_seq + 1) fail(409, 'OUT_OF_ORDER');
  const rules = validateCourse(run.course_id, run.rules_version);
  const milestone = body.kind === 'checkpoint' || body.kind === 'relay';
  const expected = milestone ? rules.milestones.indexOf(label) : body.kind === 'finish' ? rules.milestones.length : -1;
  if ((milestone && expected === -1) || (expected !== -1 && run.progress !== expected)) fail(409, 'MILESTONE_ORDER');
  await limit(db, 'event-minute', hash, now, MINUTE, 120);
  await limit(db, 'event-global-minute', 'global', now, MINUTE, 6000);
  await limit(db, 'event-global-day', 'global', now, DAY, 100_000);
  const status = body.kind === 'finish' ? 'finished' : body.kind === 'abandon' ? 'abandoned' : 'active';
  const results = await db.batch([
    stmt(db, `INSERT INTO lb_events(run_id,sequence,kind,payload_hash,accepted_ms)
      SELECT id,?,?,?,? FROM lb_runs WHERE id=? AND session_hash=? AND status='active'
      AND expires_ms>? AND last_event_ms<=? AND last_seq=? AND (?=-1 OR progress=?)
      AND EXISTS(SELECT 1 FROM lb_sessions WHERE token_hash=? AND expires_ms>?)
      ON CONFLICT(run_id,sequence) DO NOTHING`, body.sequence, body.kind, payloadHash, now, runId, hash, now, now, body.sequence - 1, expected, expected, hash, now),
    stmt(db, `UPDATE lb_runs SET last_seq=?,progress=progress+?,falls=falls+?,status=?,last_event_ms=?,
      finished_ms=CASE WHEN ?='finished' THEN ? ELSE NULL END,
      score_ms=CASE WHEN ?='finished' THEN ?-started_ms+falls*3000 ELSE NULL END
      WHERE id=? AND session_hash=? AND status='active' AND last_seq=?
      AND EXISTS(SELECT 1 FROM lb_events WHERE run_id=? AND sequence=? AND payload_hash=? AND receipt_json IS NULL)`,
      body.sequence, milestone ? 1 : 0, body.kind === 'fall' ? 1 : 0, status, now, status, now, status, now,
      runId, hash, body.sequence - 1, runId, body.sequence, payloadHash),
    stmt(db, `UPDATE lb_events SET receipt_json=(SELECT json_object('runId',id,'sequence',last_seq,'kind',?,
      'status',status,'progress',progress,'falls',falls,'serverTime',last_event_ms,'scoreMs',score_ms)
      FROM lb_runs WHERE id=? AND last_seq=?) WHERE run_id=? AND sequence=? AND payload_hash=? AND receipt_json IS NULL`,
      body.kind, runId, body.sequence, runId, body.sequence, payloadHash),
    stmt(db, 'SELECT payload_hash,receipt_json FROM lb_events WHERE run_id=? AND sequence=?', runId, body.sequence),
  ]);
  const accepted = results[3].results[0];
  if (!accepted) fail(409, 'TRANSITION_CONFLICT');
  if (accepted.payload_hash !== payloadHash) fail(409, 'SEQUENCE_CONFLICT');
  if (!accepted.receipt_json) fail(503, 'BOARD_UNAVAILABLE');
  return savedReceipt(accepted.receipt_json);
}
async function board(db, now, url) {
  if ([...url.searchParams.keys()].some(k => !['courseId', 'rulesVersion'].includes(k)) || url.searchParams.getAll('courseId').length !== 1 || url.searchParams.getAll('rulesVersion').length !== 1) fail(400, 'INVALID_QUERY');
  const course = url.searchParams.get('courseId'), version = url.searchParams.get('rulesVersion');
  validateCourse(course, version);
  const rows = await stmt(db, `SELECT alias,score_ms,falls,finished_ms FROM lb_runs
    WHERE course_id=? AND rules_version=? AND status='finished' AND started_ms>=?
    ORDER BY score_ms ASC,finished_ms ASC,id ASC LIMIT 30`, course, version, now - POLICY.retentionMs).all();
  return json({ courseId: course, rulesVersion: version, timing: 'server-wall-clock-including-pauses', authority: 'client-claimed-milestones',
    entries: rows.results.map((r, i) => ({ rank: i + 1, alias: r.alias, scoreMs: r.score_ms, falls: r.falls, completedMs: r.finished_ms })) });
}
/** All DB faults are a non-leaking 503. Never log requests, secrets or identity. */
export async function handleLeaderboard(request, db, now = Date.now()) {
  try {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid server time');
    const url = new URL(request.url), path = url.pathname;
    const eventMatch = /^\/api\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/events$/.exec(path);
    const known = ['/api/session', '/api/runs', '/api/leaderboard'].includes(path) || eventMatch;
    if (!known) fail(404, 'NOT_FOUND');
    const method = path === '/api/leaderboard' ? 'GET' : 'POST';
    if (request.method !== method) return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: method });
    if (method === 'POST') originCheck(request, url);
    const body = method === 'POST' ? await readBody(request) : null;
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') fail(503, 'BOARD_UNAVAILABLE');
    if (method === 'POST' && url.search) fail(400, 'INVALID_QUERY');
    if (path === '/api/session') return await createSession(request, db, now, body);
    if (path === '/api/runs') return await createRun(request, db, now, body);
    if (eventMatch) return await event(request, db, now, eventMatch[1], body);
    return await board(db, now, url);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status, error.status === 429 ? { 'Retry-After': String(error.retryAfter ?? 60) } : {});
    return json({ error: 'BOARD_UNAVAILABLE' }, 503);
  }
}
