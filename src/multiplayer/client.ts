import { decodeRoom } from '../../shared/multiplayer-wire.mjs';
import { createPlayer, stepPlayer } from '../../shared/multiplayer.mjs';

export type Team = 'red' | 'blue';
export type InputFrame = { forward: number; right: number; yaw: number; jump: boolean; glide: boolean; slide: boolean };
export type Runner = ReturnType<typeof createPlayer> & { id: string; nickname: string; team: Team; active?: boolean; connected?: boolean; lastSeenMs: number; seq: number; [key: string]: unknown };
export type Room = { code: string; status: 'lobby' | 'running' | 'paused' | 'ended'; epoch: number; version: number; remainingMs: number; durationMs: number; scores: Record<Team, number>; zones: { id: string; owner: Team | null; progress: number }[]; players: Runner[]; serverTime: number; snapshotMs?: number; controlRevision?: number; viewerPlayerId?: string | null; locked: boolean; winner?: string };
export type Seat = { code: string; seatToken: string; playerId: string };
type Reply = { room: Room; ack: number; playerId: string };
export class NetworkError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
const terminalProtocolError = (error: unknown) => error instanceof Error && /^(?:INVALID_MULTIPLAYER_|UNSUPPORTED_MULTIPLAYER_|Unexpected acknowledgment|Unexpected reconnect|Reconnect baseline|Timing baseline|Epoch baseline)/.test(error.message);
export async function api<T>(path: string, body?: unknown, token?: string, fetcher: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(`/api/multiplayer/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Skybound-Wire': '3', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { 'X-Skybound-Seat': token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let result;
    try { result = await response.json(); }
    catch { throw new NetworkError(response.status >= 400 ? response.status : 502, 'SERVICE_UNAVAILABLE'); }
    if (!response.ok) throw new NetworkError(response.status, typeof result.error === 'string' ? result.error : 'REQUEST_FAILED');
    if (result.room !== undefined) {
      result.room = decodeRoom(result.room);
      if (typeof result.playerId === 'string' && result.room.viewerPlayerId !== result.playerId) throw new Error('INVALID_MULTIPLAYER_OWN_IDENTITY');
    }
    return result as T;
  } finally { clearTimeout(timeout); }
}

export async function joinRoom<T>(body: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  try { return await api<T>('join', body, undefined, fetcher); }
  catch (error) {
    if (error instanceof NetworkError && error.status < 500 && error.status !== 429) throw error;
    return api<T>('join', body, undefined, fetcher);
  }
}

/** One in-flight request, immutable retries, bounded fixed-frame prediction. No client positions leave this class. */
export class MultiplayerClient {
  room: Room | null = null;
  predicted: Runner | null = null;
  pending: InputFrame[] = [];
  batch: { code: string; epoch: number; sequence: number; frames: InputFrame[] } | null = null;
  busy = false;
  ack = 0;
  lastGood = 0;
  lastAttempt = -Infinity;
  needsReconnect = false;
  message = '';
  private generation = 0;
  private autoRecovery = true;
  private recoveryAfter = 0;
  private recoveryFailures = 0;
  private recoveryDeadline = 0;
  private suspensionRevision = 0;
  /** A short visible on-map reconnect, not permission to predict or act. */
  get recovering() { return this.recoveryDeadline > 0 && this.autoRecovery; }
  private expireRecovery() {
    if (!this.recovering || this.clock() < this.recoveryDeadline) return false;
    this.recoveryDeadline = 0; this.autoRecovery = false; this.needsReconnect = true;
    this.suspensionRevision++; // Late replies cannot revive an expired lifecycle.
    this.message = 'Connection recovery timed out. Movement is frozen; reconnect when the network is stable.';
    this.changed(); return true;
  }
  private requireRecovery() {
    if (!this.recoveryDeadline && this.room?.status === 'running' && this.predicted) this.recoveryDeadline = this.clock() + 10000;
    this.needsReconnect = true; this.predictionHeld = true;
    this.message = 'Reconnecting — movement paused. Delayed inputs will not be replayed.';
  }
  predictionHeld = false;
  discardedPredictionFrames = 0;
  private reconnectTask: Promise<void> | null = null;
  budgetRebases = 0;
  seat: Seat; private fetcher: typeof fetch; private clock: () => number; changed: () => void;
  constructor(seat: Seat, fetcher: typeof fetch = fetch, clock: () => number = () => performance.now(), changed: () => void = () => {}) { this.seat=seat;this.fetcher=fetcher;this.clock=clock;this.changed=changed; }
  accept(room: Room, ack: number, initial = false, notify = true, pendingLimit = Infinity): boolean {
    if (!Number.isSafeInteger(ack) || ack < 0 || ack > 1000000) return false;
    if (room.code !== this.seat.code) return false;
    if (room.viewerPlayerId !== undefined && room.viewerPlayerId !== this.seat.playerId) { this.autoRecovery=false; this.needsReconnect=true; this.message='Seat identity changed or was removed. Reconnect before moving.'; if (notify) this.changed(); return false; }
    if (this.room && (room.epoch < this.room.epoch || ack < this.ack || room.epoch === this.room.epoch && (room.version < this.room.version || (room.snapshotMs ?? room.serverTime) < (this.room.snapshotMs ?? this.room.serverTime)))) return false;
    const epochChanged = this.room && room.epoch !== this.room.epoch;
    this.room = room; this.ack = ack;
    if (epochChanged || initial || room.status !== 'running') {
      this.discardedPredictionFrames += this.pending.length; this.pending = [];
    }
    // Inputs not yet submitted have no authoritative effect. Keep a bounded
    // recent window rather than perpetuating debt beyond the server credit cap.
    if (this.pending.length > pendingLimit) {
      this.discardedPredictionFrames += this.pending.length - pendingLimit;
      this.pending.splice(0, this.pending.length - pendingLimit);
    }
    const own = room.players.find(p => p.id === this.seat.playerId);
    if (!own || own.active === false) { this.predicted = null; this.autoRecovery = false; this.needsReconnect = true; this.message = 'This seat was removed. Ask your teacher before joining again.'; }
    else {
      this.predicted = structuredClone(own);
      for (const frame of this.pending) stepPlayer(this.predicted, frame, 1 / 60);
    }
    this.lastGood = this.clock(); if (initial) this.lastAttempt=this.lastGood; if (notify) this.changed();
    return !!own && own.active !== false;
  }
  predict(input: InputFrame) {
    if (this.expireRecovery() || this.recovering) return;
    if (!this.predicted || this.room?.status !== 'running' || this.needsReconnect) return;
    if (this.predictionHeld) return;
    if (this.clock() - this.lastGood > 1000 || this.pending.length + (this.batch?.frames.length ?? 0) >= 60) {
      if (this.busy) {
        // A bounded outstanding request is not evidence of revoked membership.
        // Stop local prediction, never replay extra time or exit the map. The
        // request timeout/error still fails closed and normal recovery owns it.
        this.predictionHeld = true; this.message = 'Waiting for the server — movement prediction paused.'; this.changed(); return;
      }
      this.requireRecovery(); this.changed(); return;
    }
    const frame = { ...input };
    this.pending.push(frame); stepPlayer(this.predicted, frame, 1 / 60);
  }
  async pump() {
    if (this.expireRecovery()) return;
    const now = this.clock();
    if (this.busy || this.needsReconnect || !this.room || this.room.status === 'ended' || now - this.lastAttempt < 200) return;
    if (!this.batch) this.batch = { code: this.seat.code, epoch: this.room.epoch, sequence: this.ack + 1, frames: this.room.status === 'running' && !this.recovering ? this.pending.splice(0, 30) : [] };
    const batch = this.batch, generation = this.generation, suspension = this.suspensionRevision;
    this.busy = true; this.lastAttempt = now;
    try {
      const reply = await api<Reply>('sync', batch, this.seat.seatToken, this.fetcher);
      if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
      if (!reply?.room || reply.ack !== batch.sequence || reply.playerId !== this.seat.playerId || reply.room.code !== this.seat.code) throw new Error('Unexpected acknowledgment');
      if (!this.accept(reply.room, reply.ack, false, false, 30)) throw new NetworkError(409, 'INVALID_AUTHORITATIVE_BASELINE');
      this.batch = null; this.predictionHeld = false; this.recoveryDeadline = 0; this.message = ''; this.changed();
    } catch (error) {
      if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
      if (error instanceof NetworkError && error.status === 409 && error.message === 'INPUT_TOO_FAST') {
        // This explicit rejection applied no movement. Read a fresh authorised
        // baseline rather than reconnecting (which resets credit and amplifies
        // sustained delay). No movement, sequence or server credit is invented.
        if (this.needsReconnect) return; // Suspension/removal already owns recovery.
        this.predictionHeld = true;
        this.message = 'Movement timing delayed — resynchronizing with the server.'; this.changed();
        try {
          const startedAt = this.clock();
          const reply = await api<Reply>('state', { code: this.seat.code }, this.seat.seatToken, this.fetcher);
          if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
          if (!reply?.room) throw new Error('Timing baseline rejected');
          const own = reply.room.players.find(player => player.id === this.seat.playerId);
          if (reply.playerId !== this.seat.playerId || !own || own.active === false || reply.ack !== own.seq ||
              !this.accept(reply.room, reply.ack, true, false)) throw new Error('Timing baseline rejected');
          this.discardedPredictionFrames += batch.frames.length;
          this.batch = null; this.predictionHeld = false; this.lastAttempt = startedAt; this.budgetRebases++;
          this.message = 'Movement timing resynchronized. Delayed inputs were discarded.';
        } catch (baselineError) {
          if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
          this.needsReconnect = true;
          if (terminalProtocolError(baselineError) || baselineError instanceof NetworkError && [400,401,403,404,409,410].includes(baselineError.status)) { this.autoRecovery = false; this.recoveryDeadline = 0; }
          this.message = 'Timing recovery failed. Reconnect before moving.';
        }
        this.changed(); return;
      }

      if (error instanceof NetworkError && error.message === 'STALE_EPOCH') {
        this.pending = []; this.batch = null;
        try {
          const startedAt = this.clock();
          const reply = await api<Reply>('state', {code:this.seat.code}, this.seat.seatToken, this.fetcher);
          if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
          if (!reply?.room) throw new Error('Epoch baseline rejected');
          const self=reply.room.players.find(p=>p.id===this.seat.playerId);
          this.message='Match state changed. Movement rebased to the server.';
          if (reply.playerId !== this.seat.playerId || !self || self.active === false || reply.ack !== self.seq || !this.accept(reply.room, reply.ack, true, false)) throw new Error('Epoch baseline rejected');
          // Notify only the validated final state. A slow state read already
          // satisfied the send spacing; do not add another receive-time delay.
          this.predictionHeld = false; this.lastAttempt = startedAt; this.changed();
        } catch (baselineError) { if(generation===this.generation && suspension===this.suspensionRevision && !this.expireRecovery()){this.needsReconnect=true; if(terminalProtocolError(baselineError) || baselineError instanceof NetworkError && [400,401,403,404,409,410].includes(baselineError.status)){this.autoRecovery=false;this.recoveryDeadline=0;} this.message='Match changed while offline. Reconnect before moving.'; this.changed();} }
        return;
      }
      this.message = error instanceof NetworkError ? error.message.replaceAll('_', ' ') : 'Connection delayed — retrying the same input batch.';
      if (terminalProtocolError(error)) {
        this.autoRecovery = false; this.recoveryDeadline = 0; this.needsReconnect = true;
        this.message = 'Invalid server baseline. Movement is frozen; reconnect before moving.'; this.changed(); return;
      }
      if (error instanceof NetworkError && [400, 401, 403, 404, 409, 410].includes(error.status)) {
        this.autoRecovery = error.message === 'RECONNECT_REQUIRED';
        this.needsReconnect = true;
        if (this.autoRecovery) this.requireRecovery();
      } else if (this.clock() - this.lastGood > 1000) this.requireRecovery();
      this.changed();
    } finally { if (generation === this.generation) this.busy = false; }
  }
  /** Freeze/discard old inputs on tab suspension; resume from server authority. */
  suspend() {
    if (!this.room || this.room.status === 'ended') return;
    this.suspensionRevision++; this.recoveryDeadline = 0;
    this.pending=[]; this.needsReconnect=true;
    this.message='Connection paused. Reconnecting when this tab is active.'; this.changed();
  }
  async recover() {
    if (this.expireRecovery()) return;
    if (!this.needsReconnect || !this.autoRecovery || this.clock() < this.recoveryAfter || this.busy) return;
    this.recoveryAfter=this.clock()+1000;
    const suspension = this.suspensionRevision;
    try { await this.reconnect(true); this.recoveryFailures=0; }
    catch (error) {
      if (suspension !== this.suspensionRevision || this.expireRecovery()) return;
      if (error instanceof NetworkError && [400,401,403,404,409,410].includes(error.status)) this.autoRecovery=false;
      this.recoveryFailures++;
      this.recoveryAfter=this.clock()+Math.min(10000,1000*2**Math.min(this.recoveryFailures,4));
    }
  }
  reconnect(automatic = false): Promise<void> {
    if(this.reconnectTask)return this.reconnectTask;
    // A user's explicit retry starts a new lifecycle, not the exhausted budget
    // of an earlier automatic attempt. Automatic retries never extend it.
    if (!automatic) this.recoveryDeadline = 0;
    const task=this.performReconnect();
    const tracked=task.finally(()=>{if(this.reconnectTask===tracked)this.reconnectTask=null;});
    this.reconnectTask=tracked;return tracked;
  }
  private async performReconnect() {
    const generation = ++this.generation, suspension = this.suspensionRevision, startedAt = this.clock();
    this.busy = true; this.needsReconnect = true;
    try {
      const reply = await api<Reply>('reconnect', { code: this.seat.code }, this.seat.seatToken, this.fetcher);
      if (generation !== this.generation || suspension !== this.suspensionRevision || this.expireRecovery()) return;
      if(!reply?.room||reply.room.code!==this.seat.code||reply.playerId!==this.seat.playerId)throw new Error('Unexpected reconnect response');
      const own = reply.room.players.find(player => player.id === this.seat.playerId);
      if (!own || own.active === false || reply.ack !== own.seq) throw new Error('Reconnect baseline rejected: acknowledgment does not match active runner sequence');
      // A rejected baseline must never unfreeze the prior prediction/timing.
      // Publish only the validated reconnect outcome in finally. An interim
      // frozen callback would incorrectly make the UI exit the map on success.
      if (!this.accept(reply.room, reply.ack, true, false)) throw new Error('Reconnect baseline rejected: stale room or invalid acknowledgment');
      this.lastAttempt = startedAt;
      if (reply.room.status !== 'running') this.recoveryDeadline = 0;
      this.batch = null; this.predictionHeld = this.recovering; this.needsReconnect = false; this.autoRecovery = true;
      this.message = this.recovering ? 'Reconnecting — checking live room. Movement paused.' : '';
    } catch (error) {
      if (generation === this.generation && suspension === this.suspensionRevision && !this.expireRecovery()) {
        if (error instanceof NetworkError && [400,401,403,404,409,410].includes(error.status) || terminalProtocolError(error)) { this.autoRecovery = false; this.recoveryDeadline = 0; }
        this.message = error instanceof Error ? error.message.replaceAll('_', ' ') : 'Reconnect failed';
      }
      throw error;
    }
    finally { if(generation===this.generation){this.busy = false; this.changed();} }
  }
  dispose() { this.autoRecovery=false; this.generation++; this.needsReconnect = true; this.pending = []; this.batch = null; }
}

/** Navigation ownership: no late room request may revive a departed or replaced view. */
export class ViewGate {
  private generation = 0;
  private code: string | null = null;
  begin(code: string | null) { this.generation++; this.code=code; return this.capture(); }
  capture() { return {generation:this.generation,code:this.code}; }
  accepts(ticket: {generation:number;code:string|null}, code: string|null=ticket.code) { return ticket.generation===this.generation && ticket.code===this.code && code===this.code; }
  bind(ticket: {generation:number;code:string|null}, code:string) { if(!this.accepts(ticket))return false;this.code=code;return true; }
}
