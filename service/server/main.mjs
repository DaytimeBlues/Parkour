import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createPreviewAccess, loadPreviewRelease } from './preview-policy.mjs';
import { gateRenderRequest } from './render-layer.mjs';
import { PublicHostAuth, renderPublicConfig, loadPublicRelease, publicMap, publicScene, publicController, hostTTL } from './public-preview.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { AuthorityProcess } from './authority-process.mjs';
import { Match, loadRules } from './match.mjs';
import { RoomRegistry } from './rooms.mjs';
import { TeacherAuth } from './teacher-auth.mjs';

const VERSION = 'fox-run-classroom-v1';
const ACTIONS = ['jump', 'sprint', 'glide', 'dive', 'climb'];
const env = process.env;
let bind = env.FOX_BIND || '127.0.0.1';
let port = Number(env.FOX_PORT || '8080');
const publicRoot = fileURLToPath(new URL('../web', import.meta.url));
let auth;
const rooms = new RoomRegistry();
const services = new Map();
const peers = new Map();
const budgets = new Map();
const socketServer = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
const operator = { reserve: null, stopping: false };

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function required(name) {
  if (!env[name]) throw new Error('Set ' + name);
  return env[name];
}

function spend(key, amount, windowMs) {
  const now = Date.now();
  const record = budgets.get(key);
  if (!record || record.expires <= now) {
    budgets.set(key, { attempts: 1, expires: now + windowMs });
  } else if (++record.attempts > amount) {
    throw failure(429, 'Too many attempts. Try again shortly.');
  }
}

function safeError(error) {
  return Number.isInteger(error?.status) ? error.message : 'Fox Run service is unavailable';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw failure(415, 'Expected JSON');
  }
  if (Number(req.headers['content-length']) > 4096) throw failure(413, 'Request is too large');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw failure(413, 'Request is too large');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw failure(400, 'Invalid JSON request');
  }
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'], ['.pck', 'application/octet-stream'], ['.png', 'image/png'],
  ['.ico', 'image/x-icon'], ['.svg', 'image/svg+xml'], ['.json', 'application/json'],
  ['.webp', 'image/webp'], ['.zip', 'application/zip']
]);

async function serveFile(res, root, relativePath, isHead) {
  const mime = mimeTypes.get(extname(relativePath));
  if (!mime) throw failure(404, 'Page unavailable');
  const candidate = resolve(root, relativePath);
  if (!candidate.startsWith(root + sep)) throw failure(404, 'Page unavailable');
  const real = await realpath(candidate).catch(() => null);
  if (!real?.startsWith(root + sep)) throw failure(404, 'Page unavailable');
  const details = await stat(real);
  if (!details.isFile()) throw failure(404, 'Page unavailable');
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': details.size, 'Cache-Control': 'no-cache' });
  if (isHead) res.end();
  else await pipeline(createReadStream(real), res);
}

let rules;
let origin;
let webExport;
let authorityConfig;
let mapMetadata;
let previewAccess;
const mode = env.FOX_PROTECTED_PREVIEW;
const loopbackFixture = mode === 'isolated-loopback-fixture';
const publicFixture = env.FOX_PUBLIC_PREVIEW === 'loopback-tls-test';
const publicMode = publicFixture || env.FOX_PUBLIC_PREVIEW === 'render-public-v1';
let renderContract,publicRelease;
const publicRoomTTL=20*60*1000;

function projection(room) {
  const service = services.get(room.code);
  return {
    type: 'state', version: VERSION, mapId: mapMetadata.mapId, room: rooms.view(room),
    ...(previewAccess ? { protectedPlay: true } : {}),
    ...(publicMode ? { publicPreview:true, maxSeats:4 } : {}),
    tick: service?.tick ?? 0, players: service?.players ?? [],
    match: service?.match?.snapshot() ?? null, interrupted: service?.interrupted ?? false
  };
}

function sendSocket(ws, data) {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 262144) return;
  ws.send(JSON.stringify(data));
}

function broadcast(room) {
  const view = projection(room);
  for (const peer of peers.values()) {
    if (peer.room === room) sendSocket(peer.ws, view);
  }
}

function updatePresence(room, seat, connected) {
  const service = services.get(room.code);
  if (room.phase === 'running' && service?.worker) {
    service.match.disconnect(seat.id);
    service.players = service.players.filter(player => player.id !== seat.id);
    try {
      service.worker.send({ type: 'seat', room: room.code, round: room.round, seatId: seat.id, connected, presence: seat.presence });
    } catch (error) {
      service.worker.fail(error);
    }
  }
  broadcast(room);
}

function vector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function receivePhysics(room, service, frame) {
  if (frame.type !== 'snapshot') throw new Error('Unexpected authority frame');
  if (room.phase !== 'running' || frame.room !== room.code || frame.round !== room.round) return;
  if (!Number.isSafeInteger(frame.tick) || frame.tick <= service.tick ||
      (service.tick !== 0 && frame.tick !== service.tick + 1) ||
      !Number.isFinite(frame.delta) || frame.delta <= 0 || frame.delta > 0.25 ||
      !Array.isArray(frame.players) || frame.players.length !== room.seats.size) {
    throw new Error('Invalid or discontinuous Fox Run physics frame');
  }
  const ids = new Set();
  const connected = [];
  for (const player of frame.players) {
    const seat = room.seats.get(player?.id);
    if (!seat || ids.has(seat.id) || player.species !== seat.species ||
        !vector(player.position, 3) || !vector(player.velocity, 3) ||
        !Number.isFinite(player.yaw) || typeof player.grounded !== 'boolean' ||
        typeof player.connected !== 'boolean' || !Number.isSafeInteger(player.presence) ||
        typeof player.wing !== 'string' || !player.wing.length || player.wing.length > 80 ||
        !Number.isSafeInteger(player.seq) || player.seq < -1) {
      throw new Error('Invalid Fox Run pose');
    }
    ids.add(seat.id);
    if (seat.connected && player.connected && player.presence === seat.presence) {
      const { id, species, position, yaw, velocity, grounded, wing, seq } = player;
      connected.push({ id, species, position, yaw, velocity, grounded, wing, seq });
    }
  }
  service.tick = frame.tick;
  service.lastPhysics = Date.now();
  service.players = connected;
  service.match.tick(frame.delta, connected);
  if (service.match.finished) {
    rooms.finish(room.code);
    service.worker.send({ type: 'stop', room: room.code, round: room.round });
    broadcast(room);
  } else if (frame.tick % 3 === 0) {
    broadcast(room);
  }
}

async function openWorker() {
  const worker = new AuthorityProcess(authorityConfig);
  const metadata = await worker.open();
  try {
    new Match(metadata.bases, rules);
    if (metadata.mapId !== webExport.mapId ||
        (mapMetadata && JSON.stringify(metadata) !== JSON.stringify(mapMetadata))) {
      throw new Error('Godot authority map differs from the pinned Web export or initial authority');
    }
    return worker;
  } catch (error) {
    worker.close();
    throw error;
  }
}

async function beginRound(room, round, authorize) {
  let service = services.get(room.code);
  let worker = service?.worker;
  try {
    if (!worker || worker.closed) {
      worker = operator.reserve;
      operator.reserve = null;
      if (!worker || worker.closed) worker = await openWorker();
      service = { worker };
      services.set(room.code, service);
      worker.on('frame', frame => {
        if (!frame || typeof frame !== 'object') throw new Error('Invalid authority frame');
        if (frame.round === service.pendingRound) {
          if (service.pendingFrames.length >= 120) throw new Error('Godot round handoff stalled');
          service.pendingFrames.push(frame);
        } else receivePhysics(room, service, frame);
      });
      worker.on('failure', error => {
        console.error('Fox Run room authority:', error.message);
        if (room.phase === 'running' && rooms.rooms.get(room.code)===room) {
          rooms.finish(room.code);
          service.interrupted = true;
          service.players = [];
          broadcast(room);
        }
      });
    }
    authorize();
    const seats = [...room.seats.values()].map(({ id, species, connected, presence }) => ({ id, species, connected, presence: presence ?? 0 }));
    if (!seats.some(seat => seat.connected)) throw failure(409, 'Connect a player before starting');
    if (operator.stopping) throw new Error('Fox Run is stopping');
    service.match = new Match(worker.metadata.bases, rules);
    service.players = [];
    service.tick = 0;
    service.lastPhysics = Date.now();
    service.interrupted = false;
    service.pendingFrames = [];
    service.pendingRound = round;
    await worker.start(room.code, round, seats);
    authorize();
    if (![...room.seats.values()].some(seat => seat.connected)) {
      throw failure(409, 'Connect a player before starting');
    }
    if (worker.closed) throw new Error('Godot authority lost during start');
    for (const seat of seats) {
      const { connected, presence } = room.seats.get(seat.id);
      if (presence !== seat.presence) {
        worker.send({ type: 'seat', room: room.code, round, seatId: seat.id, connected, presence });
      }
    }
  } catch (error) {
    if (worker) worker.close();
    services.delete(room.code);
    throw error;
  }
}

function requireTeacher(req) {
  const principal = auth.identify(req.headers.cookie);
  if (!principal) throw failure(403, 'Sign in as a teacher');
  return principal;
}

async function api(req, res, path) {
  if (req.method !== 'POST') throw failure(405, 'Use POST');
  if (req.headers.origin !== origin) throw failure(403, 'Origin is unavailable');
  const ip = req.socket.remoteAddress;
  // In hosted mode IP is the shared ingress peer; combine global bounds with app ownership.
  if (publicMode && (req.headers.host !== new URL(origin).host)) throw failure(403,'Preview unavailable');
  if (publicMode && path === '/api/v1/public/host') spend('public-host',10,60000);
  if (previewAccess && req.headers.host !== new URL(origin).host) throw failure(403, 'Preview unavailable');
  if (path === '/api/v1/teacher/sign-in') spend('login:' + ip, 10, 60000);
  if (path === '/api/v1/join') spend('join:' + ip, 100, 60000);
  const body = await readJson(req);
  switch (path) {
    case '/api/v1/mode':
      sendJson(res,200,{publicPreview:publicMode});
      return;
    case '/api/v1/public/host': {
      if (!publicMode) throw failure(404,'Page unavailable');
      if (Object.keys(body).length) throw failure(400,'Invalid host request');
      const principal=auth.identify(req.headers.cookie);
      const existing=[...rooms.rooms.values()].find(r=>r.teacherId===principal);
      if(existing) {sendJson(res,200,{code:existing.code});return;}
      if(rooms.rooms.size)throw failure(409,'A preview room is already open. Try again in a few minutes.');
      const host=principal?null:auth.newHost();
      const room=rooms.create(principal??host.principal);
      room.publicDeadline=Date.now()+publicRoomTTL;
      if(host)res.setHeader('Set-Cookie',host.cookie);
      sendJson(res,201,{code:room.code});
      return;
    }
    case '/api/v1/play/access': {
      if (!previewAccess) throw failure(404, 'Page unavailable');
      spend('play-access:' + ip, 100, 60000);
      if (Object.keys(body).length !== 2 || !Object.hasOwn(body,'code') || !Object.hasOwn(body,'seatToken')) {
        throw failure(403, 'Preview unavailable');
      }
      res.setHeader('Set-Cookie', previewAccess.mint({
        origin: req.headers.origin, code: body.code, seatToken: body.seatToken, cookie: req.headers.cookie
      }));
      sendJson(res, 200, { ok: true });
      return;
    }
    case '/api/v1/teacher/sign-in':
      if(publicMode)throw failure(404,'Page unavailable');
      res.setHeader('Set-Cookie', auth.login(body.username, body.password));
      sendJson(res, 200, { ok: true });
      return;
    case '/api/v1/teacher/status':
      sendJson(res, 200, { signedIn: Boolean(auth.identify(req.headers.cookie)) });
      return;
    case '/api/v1/teacher/sign-out':
      if(publicMode) {
        const owner=auth.identify(req.headers.cookie);
        for(const room of rooms.rooms.values()) if(room.teacherId===owner) closeRoom(room);
      }
      res.setHeader('Set-Cookie', previewAccess
        ? [auth.logout(req.headers.cookie), previewAccess.clear()] : auth.logout(req.headers.cookie));
      for (const peer of peers.values()) {
        if (peer.room && !peer.seat && !auth.identify(peer.wsCookie)) peer.ws.close(1008, 'Teacher session ended');
      }
      sendJson(res, 200, { ok: true });
      return;
    case '/api/v1/teacher/rooms': {
      if(publicMode)throw failure(404,'Page unavailable');
      const teacher = requireTeacher(req);
      if (rooms.rooms.size >= (previewAccess ? 1 : 4)) throw failure(409, 'Classroom room limit reached');
      sendJson(res, 201, { code: rooms.create(teacher).code });
      return;
    }
    case '/api/v1/teacher/close': {
      const teacher = requireTeacher(req);
      const room = rooms.get(body.code);
      if (room.teacherId !== teacher) throw failure(403, 'Teacher access required');
      if (room.startPending || (!publicMode && room.phase === 'running')) throw failure(409, 'Wait until the match ends');
      closeRoom(room);
      sendJson(res, 200, { ok: true });
      return;
    }
    case '/api/v1/teacher/seat': {
      const teacher = requireTeacher(req);
      const room=rooms.get(body.code);
      if(publicMode && room.seats.size>=4 && !room.teacherSeat) throw failure(409,'Room is full');
      sendJson(res, 200, rooms.joinTeacher(body.code, teacher, body.species));
      broadcast(room);
      return;
    }
    case '/api/v1/teacher/start': {
      const teacher = requireTeacher(req);
      const room = await rooms.start(body.code, teacher, (pending, _seats, round) =>
        beginRound(pending, round, () => requireTeacher(req)));
      const service = services.get(room.code);
      service.pendingRound = null;
      try {
        for (const frame of service.pendingFrames) receivePhysics(room, service, frame);
      } catch (error) {
        service.worker.fail(error);
      } finally {
        service.pendingFrames = [];
      }
      broadcast(room);
      sendJson(res, 200, { room: rooms.view(room) });
      return;
    }
    case '/api/v1/join': {
      if (typeof body.joinKey !== 'string') throw failure(400, 'Invalid join request');
      const room = rooms.get(body.code);
      if (publicMode && room.seats.size >= 4 && !room.joinKeys.has(body.joinKey)) throw failure(409,'Room is full');
      if (publicMode && Object.keys(body).some(k=>!['code','species','joinKey'].includes(k))) throw failure(400,'Use room code and animal only');
      const name=publicMode ? ['Fern','Moss','Pebble','River'][room.seats.size] : body.nickname;
      const result = rooms.join(body.code, name, body.species, body.joinKey);
      sendJson(res, 201, { ...result, code: room.code });
      broadcast(room);
      return;
    }
    default:
      throw failure(404, 'Page unavailable');
  }
}

async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    if (renderContract) gateRenderRequest(renderContract,req);
    if (previewAccess || publicMode) {
      if (req.headers.host !== new URL(origin).host) throw failure(403, 'Preview unavailable');
      // No absolute-form or normalized aliases, URL tokens, or path traversal for the gated assets.
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') ||
          req.url.includes('\\')) throw failure(404, 'Page unavailable');
    }
    const path = new URL(req.url, origin).pathname;
    if (path === '/health' && ['GET', 'HEAD'].includes(req.method)) {
      if(publicMode) {
        if (req.method==='HEAD') {res.writeHead(200,{'Cache-Control':'no-store'});res.end();}
        else sendJson(res,200,{ok:true});
      } else sendJson(res, 200, { version: VERSION, mapId: mapMetadata.mapId });
    } else if (path.startsWith('/api/')) {
      await api(req, res, path);
    } else if (!['GET', 'HEAD'].includes(req.method)) {
      throw failure(405, 'Use GET');
    } else if (path.startsWith('/play/')) {
      if (publicMode) {
        const file=publicRelease.asset(path);
        if(!file || req.url!==path)throw failure(404,'Page unavailable');
        res.writeHead(200,{'Content-Type':file.mime,'Content-Length':file.size,
          'Cache-Control':'no-cache','Cross-Origin-Resource-Policy':'same-origin'});
        if(req.method==='HEAD')res.end();
        else await pipeline(createReadStream(file.path),res);
      } else if (previewAccess) {
        if (req.url !== path) throw failure(404, 'Page unavailable');
        const { file, headers } = previewAccess.lookup({ method:req.method, pathname:path,
          cookie:req.headers.cookie, host:req.headers.host });
        res.writeHead(200, headers);
        if (req.method === 'HEAD') res.end();
        else await pipeline(createReadStream(file.path), res);
      } else {
        await serveFile(res, webExport.root, decodeURIComponent(path.slice(6) || 'index.html'), req.method === 'HEAD');
      }
    } else {
      const publicFile = { '/': 'index.html', '/teacher': 'index.html', '/classroom.mjs': 'classroom.mjs',
        '/classroom.css': 'classroom.css' }[path];
      if (!publicFile) throw failure(404, 'Page unavailable');
      await serveFile(res, publicRoot, publicFile, req.method === 'HEAD');
    }
  } catch (error) {
    if (!error.status) console.error('Fox Run request:', error.message);
    if (!res.headersSent && !res.destroyed) sendJson(res, error.status || 500, { error: safeError(error) });
  }
}
let server;

function closeRoom(room) {
  for(const peer of peers.values()) if(peer.room===room) wsCloseRoom(peer);
  rooms.rooms.delete(room.code);
  const worker=services.get(room.code)?.worker;
  services.delete(room.code);
  worker?.close();
}

function wsCloseRoom(peer) {
  peer.room = null;
  peer.seat = null;
  peer.ws.close(4002, 'Teacher closed the room');
}

function acceptInput(peer, msg) {
  const { room, seat } = peer;
  if (!seat || seat.connectionId !== peer.id || room.phase !== 'running' || msg.round !== room.round) return;
  if (!Number.isSafeInteger(msg.seq) || msg.seq < 0 || !vector(msg.move, 2) ||
      Math.hypot(...msg.move) > 1.000004 || !Number.isFinite(msg.yaw) ||
      Math.abs(msg.yaw) > 2 * Math.PI || ACTIONS.some(action => typeof msg[action] !== 'boolean')) return;
  if (peer.inputRound !== room.round) {
    peer.inputRound = room.round;
    peer.inputSeq = -1;
  }
  if (msg.seq <= peer.inputSeq) return;
  peer.inputSeq = msg.seq;
  const service = services.get(room.code);
  if (!service?.worker || service.worker.closed) return;
  const intent = { type: 'input', room: room.code, round: room.round, seatId: seat.id,
    seq: msg.seq, move: msg.move, yaw: msg.yaw };
  for (const action of ACTIONS) intent[action] = msg[action];
  try {
    service.worker.send(intent);
  } catch (error) {
    service.worker.fail(error);
  }
}

socketServer.on('connection', (ws, req) => {
  const id = randomUUID();
  const peer = { id, ws, alive: true, wsCookie: req.headers.cookie };
  peers.set(id, peer);
  const handshake = setTimeout(() => ws.close(1008, 'Connection setup expired'), 5000);
  ws.on('pong', () => { peer.alive = true; });
  ws.on('error', () => ws.terminate());
  ws.on('message', (payload, isBinary) => {
    try {
      spend('socket:' + id, 65, 1000);
      if (isBinary) throw failure(400, 'Expected JSON');
      const msg = JSON.parse(payload.toString());
      if (!msg || typeof msg !== 'object' || msg.version !== VERSION) {
        throw failure(400, 'Open the Fox Run classroom build');
      }
      if (!peer.room) {
        const room = rooms.get(msg.code);
        if (msg.type === 'watch') {
          if (requireTeacher(req) !== room.teacherId) throw failure(403, 'Teacher access required');
          peer.room = room;
        } else if (msg.type === 'connect') {
          if ((previewAccess || publicMode) && room.teacherSeat && msg.seatToken === room.teacherSeat.seatToken &&
              requireTeacher(req) !== room.teacherId) throw failure(403, 'Teacher access required');
          const seat = rooms.connect(room.code, msg.seatToken, id);
          seat.presence = (seat.presence ?? 0) + 1;
          peer.room = room;
          peer.seat = seat;
          for (const other of peers.values()) {
            if (other !== peer && other.room === room && other.seat === seat) other.ws.close(4001, 'Seat rejoined elsewhere');
          }
          updatePresence(room, seat, true);
        } else {
          throw failure(400, 'Choose a seat or teacher view');
        }
        clearTimeout(handshake);
        sendSocket(ws, { type: 'connected', version: VERSION, seatId: peer.seat?.id ?? null });
        sendSocket(ws, projection(room));
      } else if (msg.type === 'input') {
        acceptInput(peer, msg);
      }
    } catch (error) {
      sendSocket(ws, { type: 'error', message: safeError(error) });
      ws.close(1008, 'Room request rejected');
    }
  });
  ws.on('close', () => {
    clearTimeout(handshake);
    peers.delete(id);
    budgets.delete('socket:' + id);
    if (peer.room && peer.seat && rooms.disconnect(peer.room.code, peer.seat.id, id)) {
      peer.seat.presence++;
      updatePresence(peer.room, peer.seat, false);
    }
  });
});

function handleUpgrade(req, socket, head) {
  try {
    if (renderContract) gateRenderRequest(renderContract,req,{upgrade:true});
    if (((previewAccess || publicMode) && req.headers.host !== new URL(origin).host) || req.headers.origin !== origin || req.url !== '/api/v1/socket') throw failure(403, 'Origin is unavailable');
    spend('upgrade:' + req.socket.remoteAddress, 100, 60000);
    if (peers.size >= 64) throw failure(503, 'Classroom connection limit reached');
    socketServer.handleUpgrade(req, socket, head, ws => socketServer.emit('connection', ws, req));
  } catch {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
}

setInterval(() => {
  for (const peer of peers.values()) {
    if (!peer.alive || (peer.room && (!peer.seat || (publicMode && peer.seat.id===peer.room.teacherSeat?.seatId)) &&
        auth.identify(peer.wsCookie) !== peer.room.teacherId)) {
      peer.ws.terminate();
    } else {
      peer.alive = false;
      peer.ws.ping();
    }
  }
  if(publicMode) {
    auth.sweep();
    for(const room of rooms.rooms.values()) {
      if(room.publicDeadline<=Date.now() || (room.phase!=='running'&&!room.startPending &&
          Date.now()-room.updated>=3*60*1000 && ![...room.seats.values()].some(seat=>seat.connected)))closeRoom(room);
    }
  }
  for (const code of rooms.sweep()) {
    services.get(code)?.worker?.close();
    services.delete(code);
  }
  for (const [key, record] of budgets) if (record.expires < Date.now()) budgets.delete(key);
}, 5000).unref();

setInterval(() => {
  for (const [code, service] of services) {
    if (!service.worker.closed && rooms.get(code).phase === 'running' && Date.now() - service.lastPhysics > 3000) {
      service.worker.fail(new Error('Godot physics stopped responding'));
    }
  }
}, 1000).unref();

function shutDown() {
  if (operator.stopping) return;
  operator.stopping = true;
  for (const peer of peers.values()) peer.ws.terminate();
  for (const service of services.values()) service.worker?.close();
  operator.reserve?.close();
  server?.close();
}
process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);

try {
  if (env.FOX_PUBLIC_PREVIEW && !publicMode) throw new Error('Unknown public preview mode');
  if (publicMode && mode) throw new Error('Public and protected/local fixture modes cannot be combined');
  if (publicMode && (env.FOX_LOCAL_HTTP || env.FOX_ALLOW_LOCAL_ALIGNMENT_FIXTURE ||
                     env.FOX_ALLOW_LINUX_AUTHORITY_SMOKE || env.FOX_TEACHER_USERNAME ||
                     env.FOX_TEACHER_PASSWORD || env.FOX_COOKIE_SECRET)) throw new Error('Public preview accepts no classroom credentials or local flags');
  if (publicMode && !publicFixture) {
    renderContract=renderPublicConfig(env);
    bind=renderContract.bind;
    port=renderContract.port;
  }
  if (publicFixture && (!/^https:\/\/localhost:\d+$/.test(env.FOX_ORIGIN??'') ||
      bind!=='127.0.0.1' || Number(new URL(env.FOX_ORIGIN).port)!==port ||
      [env.RENDER,env.RENDER_EXTERNAL_URL,env.RENDER_EXTERNAL_HOSTNAME].some(Boolean))) {
    throw new Error('Public fixture is TLS loopback only');
  }
  if (mode && !loopbackFixture) {
    throw new Error('Hosted protected preview is blocked pending approved Linux hosted authority, platform ingress and export');
  }
  origin = renderContract?.origin ?? new URL(required('FOX_ORIGIN')).origin;
  if (!renderContract && env.FOX_ORIGIN !== origin) throw new Error('FOX_ORIGIN must be a bare canonical origin');
  const local = env.FOX_LOCAL_HTTP === '1';
  if (local ? !/^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?$/.test(origin) || bind !== '127.0.0.1'
            : !origin.startsWith('https://')) {
    throw new Error('Use an HTTPS origin, or configure loopback-only HTTP');
  }
  if (loopbackFixture && (local || bind !== '127.0.0.1' || !/^https:\/\/localhost:\d+$/.test(origin) ||
      Number(new URL(origin).port) !== port || env.FOX_ALLOW_LOCAL_ALIGNMENT_FIXTURE ||
      env.FOX_ALLOW_LINUX_AUTHORITY_SMOKE)) {
    throw new Error('Protected test fixture requires explicit isolated TLS loopback only');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FOX_PORT');
  if(publicMode) {
    auth = new PublicHostAuth();
    authorityConfig = { godot:resolve(required('FOX_PUBLIC_GODOT_BIN')), pack:resolve(required('FOX_PUBLIC_AUTHORITY_PACK')),
      map:publicScene, controller:publicController, dedicatedPublicMap:publicMap, runtimeData:resolve(required('FOX_PUBLIC_RUNTIME_DATA')) };
  } else {
    required('FOX_TEACHER_USERNAME');
    if (required('FOX_TEACHER_PASSWORD').length < 32 || required('FOX_COOKIE_SECRET').length < 32 ||
        env.FOX_TEACHER_PASSWORD === env.FOX_COOKIE_SECRET) {
      throw new Error('Configure separate teacher password and cookie secret of at least 32 characters each');
    }
    auth = new TeacherAuth();
    authorityConfig = { godot: env.FOX_GODOT_BIN || 'godot', project: resolve(required('FOX_GODOT_PROJECT')),
      map: required('FOX_MAP_SCENE'), controller: required('FOX_CONTROLLER_SCRIPT') };
  }
  if (loopbackFixture) {
    if (authorityConfig.map !== 'res://classroom_draft/map.tscn' ||
        authorityConfig.controller !== 'res://authority_smoke/controller_linux.gd' ||
        env.FOX_GODOT_BIN ||
        createHash('sha256').update(await readFile(resolve(authorityConfig.project,
          'authority_smoke/controller_linux.gd'))).digest('hex') !== '0c72455daf08d08916fe28dff735871102193ad86acd5a19de1e042dc1880885') {
      throw new Error('Protected test fixture requires the pinned Linux loopback-only controller');
    }
    authorityConfig.loopbackTLSFixture = true;
  }
  if (!publicMode) await stat(resolve(authorityConfig.project, 'project.godot'));
  const exportRoot = await realpath(required('FOX_WEB_EXPORT'));
  if (publicMode) {
    publicRelease=await loadPublicRelease(exportRoot,authorityConfig.pack,authorityConfig.godot);
    webExport=publicRelease;
  } else if (loopbackFixture) {
    const release = await loadPreviewRelease({ directory:exportRoot, primaryOrigin:origin,
      approvedMapId:required('FOX_PREVIEW_MAP_ID'), manifestSHA256:required('FOX_PREVIEW_MANIFEST_SHA256'),
      loopbackFixture:true });
    previewAccess = createPreviewAccess({ release, lookupRoom:code => rooms.rooms.get(code),
      identifyTeacher:cookie => auth.identify(cookie) });
    webExport = { root:exportRoot, mapId:release.mapId };
  } else {
  const exportManifest = JSON.parse(await readFile(resolve(exportRoot, 'fox-classroom-export.json'), 'utf8'));
  if (exportManifest.version !== VERSION || typeof exportManifest.mapId !== 'string' || !exportManifest.mapId) {
    throw new Error('Set FOX_WEB_EXPORT to a matching versioned Godot export');
  }
  if (exportManifest.mapId.startsWith('fox-woodland-seven-stage-draft-') &&
      (!local || bind !== '127.0.0.1' || env.FOX_ALLOW_LOCAL_ALIGNMENT_FIXTURE !== '1')) {
    throw new Error('Draft map scope is closed outside the explicit loopback alignment fixture');
  }
  if (exportManifest.mapId.startsWith('fox-woodland-seven-stage-draft-')) {
    if (exportManifest.scope !== 'loopback-rendered-probe') throw new Error('Draft Web export must be the rendered probe');
    for (const file of ['index.html','index.js','index.wasm','index.pck']) {
      const actual = createHash('sha256').update(await readFile(resolve(exportRoot,file))).digest('hex');
      if (actual !== exportManifest.sha256?.[file]) throw new Error('Draft Web export failed byte pin: '+file);
    }
  }
  for (const file of ['index.html', 'index.js', 'index.wasm', 'index.pck']) {
    if (!(await stat(resolve(exportRoot, file))).isFile()) throw new Error('Missing Godot Web export file ' + file);
  }
  webExport = { root: exportRoot, mapId: exportManifest.mapId };
  }
  server = (loopbackFixture || publicFixture) ? createSecureServer({
    cert:await readFile(required('FOX_FIXTURE_TLS_CERT')),
    key:await readFile(required('FOX_FIXTURE_TLS_KEY'))
  },handleRequest) : createServer(handleRequest);
  server.requestTimeout = 10000;
  server.on('upgrade', handleUpgrade);
  rules = loadRules((!publicMode || publicFixture) && env.FOX_MATCH_RULES ? JSON.parse(env.FOX_MATCH_RULES) : {});
  operator.reserve = await openWorker();
  if (operator.stopping) throw new Error('Fox Run is stopping');
  mapMetadata = operator.reserve.metadata;
  operator.reserve.on('failure', error => console.error('Fox Run idle authority:', error.message));
  await new Promise((success, reject) => {
    server.once('error', reject);
    server.listen(port, bind, success);
  });
  console.log(VERSION + ' listening at ' + origin + ' with map ' + mapMetadata.mapId);
} catch (error) {
  console.error(VERSION + ' startup:', error.message);
  shutDown();
  process.exitCode = 1;
}
