import { decodeRoom } from '../../shared/multiplayer-wire.mjs';
import { createPlayer, stepPlayer } from '../../shared/multiplayer.mjs';

export type Team = 'red' | 'blue';
export type InputFrame = { forward: number; right: number; yaw: number; jump: boolean; glide: boolean; slide: boolean };
export type Runner = ReturnType<typeof createPlayer> & { id: string; nickname: string; team: Team; active?: boolean; connected?: boolean; lastSeenMs: number; seq: number; [key: string]: unknown };
export type Room = { code: string; status: 'lobby' | 'running' | 'paused' | 'ended'; epoch: number; version: number; remainingMs: number; durationMs: number; scores: Record<Team, number>; zones: { id: string; owner: Team | null; progress: number }[]; players: Runner[]; serverTime: number; snapshotMs?: number; controlRevision?: number; viewerPlayerId?: string | null; locked: boolean; winner?: string };
export type Seat = { code: string; seatToken: string; playerId: string };
type Reply = { room: Room; ack: number; playerId: string };
export class NetworkError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
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
  private budgetRecoveryTimes: number[] = [];
  private reconnectTask: Promise<void> | null = null;
  budgetRebases = 0;
  seat: Seat; private fetcher: typeof fetch; private clock: () => number; changed: () => void;
  constructor(seat: Seat, fetcher: typeof fetch = fetch, clock: () => number = () => performance.now(), changed: () => void = () => {}) { this.seat=seat;this.fetcher=fetcher;this.clock=clock;this.changed=changed; }
  accept(room: Room, ack: number, initial = false, notify = true): boolean {
    if (!Number.isSafeInteger(ack) || ack < 0 || ack > 1000000) return false;
    if (room.code !== this.seat.code) return false;
    if (room.viewerPlayerId !== undefined && room.viewerPlayerId !== this.seat.playerId) { this.autoRecovery=false; this.needsReconnect=true; this.message='Seat identity changed or was removed. Reconnect before moving.'; if (notify) this.changed(); return false; }
    if (this.room && (room.epoch < this.room.epoch || ack < this.ack || room.epoch === this.room.epoch && (room.version < this.room.version || (room.snapshotMs ?? room.serverTime) < (this.room.snapshotMs ?? this.room.serverTime)))) return false;
    const epochChanged = this.room && room.epoch !== this.room.epoch;
    this.room = room; this.ack = ack;
    if (epochChanged || initial || room.status !== 'running') this.pending = [];
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
    if (!this.predicted || this.room?.status !== 'running' || this.needsReconnect) return;
    if (this.clock() - this.lastGood > 1000 || this.pending.length + (this.batch?.frames.length ?? 0) >= 60) {
      this.needsReconnect = true; this.message = 'Connection interrupted. Movement is frozen; reconnect to the authoritative room.'; this.changed(); return;
    }
    const frame = { ...input };
    this.pending.push(frame); stepPlayer(this.predicted, frame, 1 / 60);
  }
  async pump() {
    const now = this.clock();
    if (this.busy || this.needsReconnect || !this.room || this.room.status === 'ended' || now - this.lastAttempt < 200) return;
    if (!this.batch) this.batch = { code: this.seat.code, epoch: this.room.epoch, sequence: this.ack + 1, frames: this.room.status === 'running' ? this.pending.splice(0, 30) : [] };
    const batch = this.batch, generation = this.generation;
    this.busy = true; this.lastAttempt = now;
    try {
      const reply = await api<Reply>('sync', batch, this.seat.seatToken, this.fetcher);
      if (generation !== this.generation) return;
      if (reply.ack !== batch.sequence || reply.playerId !== this.seat.playerId || reply.room.code !== this.seat.code) throw new Error('Unexpected acknowledgment');
      this.batch = null; this.message = ''; this.accept(reply.room, reply.ack);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof NetworkError && error.status === 409 && error.message === 'INPUT_TOO_FAST') {
        // Capped arrival-time credit can leave permanent queued-input debt.
        // Rejection did not apply this batch: discard it and rebase once, rather
        // than perpetuating catch-up retries. Never clear an existing freeze.
        const now=this.clock();
        this.budgetRecoveryTimes=this.budgetRecoveryTimes.filter(t=>now-t<10000);
        if(this.needsReconnect || now-this.lastGood>1000 || this.budgetRecoveryTimes.length>=2){
          this.needsReconnect=true;this.message='Movement timing interrupted. Reconnect to the authoritative room.';this.changed();return;
        }
        this.budgetRecoveryTimes.push(now);this.budgetRebases++;
        this.pending=[];this.batch=null;
        this.message='Movement timing delayed — resynchronizing with the server.';
        const expectedGeneration=this.generation+1;
        try{
          await this.reconnect();
          if(this.generation===expectedGeneration&&!this.needsReconnect){this.message='Movement timing resynchronized. Delayed inputs were discarded.';this.changed();}
        }catch{if(this.generation===expectedGeneration){this.needsReconnect=true;this.message='Timing recovery failed. Reconnect before moving.';this.changed();}}
        return;
      }
      if (error instanceof NetworkError && error.message === 'STALE_EPOCH') {
        this.pending = []; this.batch = null;
        try {
          const reply = await api<{room:Room}>('state', {code:this.seat.code}, this.seat.seatToken, this.fetcher);
          if (generation !== this.generation) return;
          const self=reply.room.players.find(p=>p.id===this.seat.playerId);
          this.message='Match state changed. Movement rebased to the server.';
          this.accept(reply.room, self?.seq ?? this.ack, true);
        } catch { if(generation===this.generation){this.needsReconnect=true; this.message='Match changed while offline. Reconnect before moving.'; this.changed();} }
        return;
      }
      this.message = error instanceof NetworkError ? error.message.replaceAll('_', ' ') : 'Connection delayed — retrying the same input batch.';
      if (error instanceof NetworkError && [400, 401, 403, 404, 409, 410].includes(error.status)) {
        this.autoRecovery = error.message === 'RECONNECT_REQUIRED';
        this.needsReconnect = true;
      } else if (this.clock() - this.lastGood > 1000) this.needsReconnect = true;
      this.changed();
    } finally { if (generation === this.generation) this.busy = false; }
  }
  /** Freeze/discard old inputs on tab suspension; resume from server authority. */
  suspend() {
    if (!this.room || this.room.status === 'ended') return;
    this.pending=[]; this.needsReconnect=true;
    this.message='Connection paused. Reconnecting when this tab is active.'; this.changed();
  }
  async recover() {
    if (!this.needsReconnect || !this.autoRecovery || this.clock() < this.recoveryAfter || this.busy) return;
    this.recoveryAfter=this.clock()+1000;
    try { await this.reconnect(); this.recoveryFailures=0; }
    catch (error) {
      if (error instanceof NetworkError && [400,401,403,404,409,410].includes(error.status)) this.autoRecovery=false;
      this.recoveryFailures++;
      this.recoveryAfter=this.clock()+Math.min(10000,1000*2**Math.min(this.recoveryFailures,4));
    }
  }
  reconnect(): Promise<void> {
    if(this.reconnectTask)return this.reconnectTask;
    const task=this.performReconnect();
    const tracked=task.finally(()=>{if(this.reconnectTask===tracked)this.reconnectTask=null;});
    this.reconnectTask=tracked;return tracked;
  }
  private async performReconnect() {
    const generation = ++this.generation;
    this.busy = true; this.needsReconnect = true;
    try {
      const reply = await api<Reply>('reconnect', { code: this.seat.code }, this.seat.seatToken, this.fetcher);
      if (generation !== this.generation) return;
      if(reply.room.code!==this.seat.code||reply.playerId!==this.seat.playerId)throw new Error('Unexpected reconnect response');
      const own = reply.room.players.find(player => player.id === this.seat.playerId);
      if (!own || own.active === false || reply.ack !== own.seq) throw new Error('Reconnect baseline rejected: acknowledgment does not match active runner sequence');
      // A rejected baseline must never unfreeze the prior prediction/timing.
      // Publish only the validated reconnect outcome in finally. An interim
      // frozen callback would incorrectly make the UI exit the map on success.
      if (!this.accept(reply.room, reply.ack, true, false)) throw new Error('Reconnect baseline rejected: stale room or invalid acknowledgment');
      this.batch = null; this.needsReconnect = false; this.autoRecovery = true; this.message = '';
    } catch (error) { if(generation===this.generation)this.message = error instanceof Error ? error.message.replaceAll('_', ' ') : 'Reconnect failed'; throw error; }
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
