import test from 'node:test';
import assert from 'node:assert/strict';
import { RankingClient } from '../src/simulation/ranking.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const response = body => Response.json(body);
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fake(eventHandler) {
  const sent = []; let completed = 0;
  const client = new RankingClient(async (url, init) => {
    const body = JSON.parse(init.body);
    if (url === '/api/session') return response({ alias: 'Calm Owl abc123' });
    if (url === '/api/runs') return response({ runId: 'run-one', startedMs: 1000, expiresMs: 9999999, alias: 'Calm Owl abc123' });
    sent.push(body);
    if (eventHandler) return eventHandler(body, sent.length);
    return response({ runId: 'run-one', sequence: body.sequence, kind: body.kind, status: body.kind === 'finish' ? 'finished' : 'active', scoreMs: body.kind === 'finish' ? 10000 : null });
  }, () => {}, () => { completed++; });
  return { client, sent, get completed() { return completed; } };
}

test('ordered relay/checkpoint/fall outbox completes with one finish', async () => {
  const f = fake(); assert.equal(await f.client.begin('relay-gardens-v1', true), true);
  f.client.observe(1, 0, new Set([1]));
  f.client.observe(2, 1, new Set([1]));
  f.client.observe(3, 1, new Set([1, 2]));
  f.client.observe(4, 1, new Set([1, 2]));
  f.client.finish(); f.client.finish(); await f.client.flush(); await tick();
  assert.deepEqual(f.sent.map(e => `${e.kind}:${e.checkpoint ?? e.relay ?? ''}`), ['checkpoint:1', 'relay:1', 'checkpoint:2', 'fall:', 'checkpoint:3', 'relay:2', 'checkpoint:4', 'finish:']);
  assert.deepEqual(f.sent.map(e => e.sequence), [1,2,3,4,5,6,7,8]); assert.equal(f.completed, 1); assert.equal(f.client.state, 'finished');
});

test('lost response blocks later sequences and retry sends the identical event first', async () => {
  const f = fake((body, attempt) => {
    if (attempt === 1) throw Error('Response lost after server commit');
    return response({ sequence: body.sequence, status: body.kind === 'finish' ? 'finished' : 'active', scoreMs: 10000 });
  });
  await f.client.begin('daybreak', true); f.client.observe(1, 0); f.client.observe(2, 0); await tick();
  assert.equal(f.sent.length, 1); assert.equal(f.client.pending, 2);
  await f.client.retry(); await tick();
  assert.deepEqual(f.sent.map(e => e.sequence), [1,1,2]); assert.deepEqual(f.sent[0], f.sent[1]); assert.equal(f.client.pending, 0);
});

test('late receipt after reset cannot mutate new client state or finish callback', async () => {
  const gate = deferred(), f = fake(() => gate.promise);
  await f.client.begin('daybreak', true); f.client.observe(1, 0); f.client.reset();
  gate.resolve(response({ sequence: 1, status: 'finished', scoreMs: 0 })); await tick();
  assert.equal(f.client.state, 'practice'); assert.equal(f.client.ticket, null); assert.equal(f.client.pending, 0); assert.equal(f.completed, 0);
});

test('practice never sends API requests', async () => {
  let calls = 0; const client = new RankingClient(async () => { calls++; throw Error(); }, () => {}, () => {});
  assert.equal(await client.begin('daybreak', false), true); client.observe(5, 3); client.finish(); await client.retry(); assert.equal(calls, 0);
});

test('stale session completion cannot issue a server-side start after reset (fixed regression)', async () => {
  const firstSession = deferred(); let sessions = 0; const issued = [];
  const client = new RankingClient(async (url, init) => {
    if (url === '/api/session') { sessions++; return sessions === 1 ? firstSession.promise : response({ alias: 'Calm Owl' }); }
    const body = JSON.parse(init.body); issued.push(body.courseId);
    return response({ runId: body.courseId, startedMs: 1000, alias: 'Calm Owl' });
  }, () => {}, () => {});
  const stale = client.begin('daybreak', true);
  await tick(); const fresh = client.begin('storm', true);
  firstSession.resolve(response({ alias: 'Calm Owl' })); assert.equal(await stale, false);
  assert.equal(await fresh, true); assert.deepEqual(issued, ['storm']);
  assert.equal(client.ticket.runId, 'storm');
});

test('uncertain previous start is reconciled with identical key before a new start is issued', async () => {
  const issued = []; let first = true;
  const client = new RankingClient(async (url, init) => {
    if (url === '/api/session') return response({ alias: 'Calm Owl' });
    const body = JSON.parse(init.body); issued.push(body);
    if (first) { first = false; throw Error('Network response lost'); }
    return response({ runId: body.idempotencyKey, startedMs: 1000, alias: 'Calm Owl' });
  }, () => {}, () => {});
  assert.equal(await client.begin('daybreak', true), false);
  assert.equal(await client.begin('storm', true), true);
  assert.equal(issued.length, 3); assert.deepEqual(issued[0], issued[1]);
  assert.notEqual(issued[1].idempotencyKey, issued[2].idempotencyKey);
  assert.equal(issued[2].courseId, 'storm');
});

test('skipped checkpoint stops ranking without fabricating milestone claims', async () => {
  const f = fake(); await f.client.begin('daybreak', true); f.client.observe(3, 0); await f.client.flush();
  // Main currently accepts any greater checkpoint; this adapter claims all three.
  assert.deepEqual(f.sent, []); assert.equal(f.client.state,'error');
});

test('outbox overflow is terminal practice-only, including late response', async () => {
  const gate = deferred(); let waiting = true;
  const f = fake(body => waiting ? gate.promise : response({ sequence: body.sequence, status: 'active', scoreMs: null }));
  await f.client.begin('daybreak', true); f.client.observe(0, 251); f.client.finish();
  assert.equal(f.client.pending, 0); assert.match(f.client.message, /practice only/);
  waiting = false; gate.resolve(response({ sequence: 1, status: 'active', scoreMs: null })); await tick(); await f.client.retry(); await tick();
  assert.equal(f.client.pending, 0); assert.equal(f.client.state, 'error'); assert.ok(!f.sent.some(e => e.kind === 'finish'));
  assert.match(f.client.message, /practice only/);
});

test('explicit discard reset clears pending completed submission', async () => {
  const gate = deferred(), f = fake(() => gate.promise);
  await f.client.begin('daybreak', true); for(let cp=1;cp<=5;cp++)f.client.observe(cp,0); f.client.finish();
  assert.equal(f.client.pending, 6); f.client.reset();
  gate.resolve(response({ sequence: 1, status: 'active', scoreMs: null })); await tick();
  assert.equal(f.client.pending, 0); assert.equal(f.sent.length, 1);
  assert.ok(!f.sent.some(e => e.kind === 'finish')); assert.equal(f.completed, 0);
});

test('pending finish is protected until confirmed or explicit reset',async()=>{const gate=deferred(),f=fake(()=>gate.promise);await f.client.begin('daybreak',true);f.client.finish();assert.equal(f.client.awaitingSubmission,true);gate.resolve(response({sequence:1,status:'finished',scoreMs:1000}));await tick();assert.equal(f.client.awaitingSubmission,false);assert.equal(f.client.state,'finished');});
test('permanent rejection is not presented as retryable pending submission',async()=>{const f=fake(()=>Response.json({error:'MILESTONE_ORDER'},{status:409}));await f.client.begin('daybreak',true);f.client.observe(1,0);await tick();assert.equal(f.client.state,'error');assert.equal(f.client.pending,0);await f.client.retry();assert.equal(f.sent.length,1);});
