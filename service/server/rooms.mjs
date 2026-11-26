import { randomBytes, randomInt } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const idleLimit = 4 * 60 * 60 * 1000;

function fail(status, message) {
  throw Object.assign(new Error(message), {status});
}

function requireTeacher(room, teacherId) {
  if (!teacherId || room.teacherId !== teacherId) fail(403, 'Teacher access required');
}

function publicSeat({id, nickname, species, connected}) {
  return {id, nickname, species, connected};
}

export class RoomRegistry {
  rooms = new Map();

  create(teacherId) {
    if (!teacherId) fail(403, 'Teacher access required');
    let code;
    do {
      code = Array.from({length: 6}, () => alphabet[randomInt(alphabet.length)]).join('');
    } while (this.rooms.has(code));
    const room = {code, teacherId, teacherSeat: null, phase: 'lobby', round: 0,
      seats: new Map(), joinKeys: new Map(), updated: Date.now()};
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    const room = this.rooms.get(String(code).trim().toUpperCase());
    if (!room) fail(404, 'Room unavailable');
    return room;
  }

  join(code, nickname, species, joinKey) {
    const room = this.get(code);
    if (joinKey !== undefined && (typeof joinKey !== 'string' || !/^[0-9a-f-]{36}$/.test(joinKey))) {
      fail(400, 'Invalid join request');
    }
    const previous = room.joinKeys.get(joinKey);
    if (previous) return { ...previous };
    if (room.startPending || room.phase !== 'lobby') fail(409, 'Round has already started');
    if (room.seats.size >= 8) fail(409, 'Room is full');
    if (typeof nickname !== 'string' || !/^[a-z0-9][a-z0-9 -]{0,19}$/i.test(nickname.trim())) {
      fail(400, 'Use a nickname of 1–20 letters, numbers, spaces or hyphens');
    }
    if (!['fox', 'deer'].includes(species)) fail(400, 'Choose Fox or Deer');
    nickname = nickname.trim();
    if ([...room.seats.values()].some(s => s.nickname.toLowerCase() === nickname.toLowerCase())) {
      fail(409, 'Choose another nickname');
    }
    const id = randomBytes(8).toString('hex');
    const seatToken = randomBytes(32).toString('base64url');
    room.seats.set(id, {id, nickname, species, connected: false, seatToken, connectionId: null});
    room.updated = Date.now();
    const admission = {seatId: id, seatToken};
    if (joinKey) room.joinKeys.set(joinKey, admission);
    return {...admission};
  }

  joinTeacher(code, teacherId, species) {
    const room = this.get(code);
    requireTeacher(room, teacherId);
    if (room.teacherSeat) return {...room.teacherSeat};
    let nickname = 'Teacher';
    for (let i = 2; [...room.seats.values()].some(s => s.nickname.toLowerCase() === nickname.toLowerCase()); i++) {
      nickname = 'Teacher ' + i;
    }
    room.teacherSeat = this.join(code, nickname, species);
    return {...room.teacherSeat};
  }

  connect(code, seatToken, connectionId) {
    const room = this.get(code);
    const seat = [...room.seats.values()].find(s => s.seatToken === seatToken);
    if (!seat || !connectionId) fail(403, 'Seat unavailable');
    Object.assign(seat, {connected: true, connectionId});
    room.updated = Date.now();
    return seat;
  }

  disconnect(code, seatId, connectionId) {
    const room = this.get(code);
    const seat = room.seats.get(seatId);
    if (!seat?.connected || seat.connectionId !== connectionId) return false;
    Object.assign(seat, {connected: false, connectionId: null});
    room.updated = Date.now();
    return true;
  }

  async start(code, teacherId, beginRound) {
    const room = this.get(code);
    requireTeacher(room, teacherId);
    if (room.startPending || room.phase === 'running') fail(409, 'Round already running');
    const seats = [...room.seats.values()].filter(s => s.connected).map(publicSeat);
    if (!seats.length) fail(409, 'Connect a player before starting');
    room.startPending = true;
    try {
      await beginRound(room, seats, room.round + 1);
    } finally {
      room.startPending = false;
    }
    room.round++;
    room.phase = 'running';
    room.updated = Date.now();
    return room;
  }

  finish(code) {
    const room = this.get(code);
    if (room.phase === 'running') room.phase = 'finished';
    return room;
  }

  view(room) {
    return {code: room.code, phase: room.phase, round: room.round,
      seats: [...room.seats.values()].map(publicSeat)};
  }

  sweep() {
    const expired = [];
    for (const room of this.rooms.values()) {
      if (!room.startPending && Date.now() - room.updated > idleLimit && ![...room.seats.values()].some(s => s.connected)) {
        this.rooms.delete(room.code);
        expired.push(room.code);
      }
    }
    return expired;
  }
}
