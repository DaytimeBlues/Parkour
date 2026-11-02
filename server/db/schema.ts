import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';

export const lbSessions = sqliteTable('lb_sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  alias: text('alias').notNull(),
  createdMs: integer('created_ms').notNull(),
  expiresMs: integer('expires_ms').notNull(),
}, t => [index('lb_sessions_expiry').on(t.expiresMs)]);

export const lbRuns = sqliteTable('lb_runs', {
  id: text('id').primaryKey().notNull(),
  // Nullable so expired session linkage can be removed without deleting scores.
  sessionHash: text('session_hash'),
  alias: text('alias').notNull(),
  courseId: text('course_id').notNull(),
  rulesVersion: text('rules_version').notNull(),
  startKey: text('start_key').notNull(),
  startedMs: integer('started_ms').notNull(),
  expiresMs: integer('expires_ms').notNull(),
  status: text('status', { enum: ['active', 'finished', 'abandoned'] }).notNull().default('active'),
  lastSeq: integer('last_seq').notNull().default(0),
  progress: integer('progress').notNull().default(0),
  falls: integer('falls').notNull().default(0),
  lastEventMs: integer('last_event_ms').notNull(),
  finishedMs: integer('finished_ms'),
  scoreMs: integer('score_ms'),
}, t => [
  uniqueIndex('lb_runs_session_start').on(t.sessionHash, t.startKey),
  uniqueIndex('lb_runs_one_active').on(t.sessionHash).where(sql`${t.status}='active'`),
  index('lb_runs_board').on(t.courseId, t.rulesVersion, t.status, t.scoreMs, t.finishedMs, t.id),
  index('lb_runs_expiry').on(t.expiresMs), index('lb_runs_retention').on(t.startedMs),
  check('lb_runs_status', sql`${t.status} IN ('active','finished','abandoned')`),
  check('lb_runs_seq', sql`${t.lastSeq} BETWEEN 0 AND 256`),
  check('lb_runs_progress', sql`${t.progress} BETWEEN 0 AND 6`),
  check('lb_runs_falls', sql`${t.falls} BETWEEN 0 AND 256`),
]);

export const lbEvents = sqliteTable('lb_events', {
  runId: text('run_id').notNull().references(() => lbRuns.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  kind: text('kind', { enum: ['checkpoint', 'relay', 'fall', 'finish', 'abandon'] }).notNull(),
  payloadHash: text('payload_hash').notNull(),
  acceptedMs: integer('accepted_ms').notNull(),
  receiptJson: text('receipt_json'),
}, t => [primaryKey({ columns: [t.runId, t.sequence] }),
  check('lb_events_seq', sql`${t.sequence} BETWEEN 1 AND 256`),
  check('lb_events_kind', sql`${t.kind} IN ('checkpoint','relay','fall','finish','abandon')`),
]);

export const lbLimits = sqliteTable('lb_limits', {
  bucket: text('bucket').primaryKey().notNull(), count: integer('count').notNull(), expiresMs: integer('expires_ms').notNull(),
}, t => [index('lb_limits_expiry').on(t.expiresMs), check('lb_limits_positive', sql`${t.count}>0`)]);

// Short-lived multiplayer rooms. CAS makes authorisation and state one boundary.
export const mpRooms = sqliteTable('mp_rooms', {
  code: text('code').primaryKey().notNull(),
  ownerId: text('owner_id').notNull(),
  stateJson: text('state_json').notNull(),
  version: integer('version').notNull().default(0),
  createdMs: integer('created_ms').notNull(),
  expiresMs: integer('expires_ms').notNull(),
}, t => [index('mp_rooms_owner').on(t.ownerId, t.expiresMs), index('mp_rooms_expiry').on(t.expiresMs)]);

// Independent seat writes avoid contending on the room scoring row.
export const mpSeats = sqliteTable('mp_seats', {
  id: text('id').primaryKey().notNull(),
  roomCode: text('room_code').notNull().references(() => mpRooms.code, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  stateJson: text('state_json').notNull(),
  version: integer('version').notNull().default(0),
}, t => [uniqueIndex('mp_seats_room_token').on(t.roomCode, t.tokenHash), index('mp_seats_room').on(t.roomCode)]);
