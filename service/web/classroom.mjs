const version = 'fox-run-classroom-v1';
const teacherPage = location.pathname === '/teacher';
const storageKey = version + (teacherPage ? ':teacher' : ':student');
const actions = ['jump', 'sprint', 'glide', 'dive', 'climb'];
const view = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const transport = { ws: null, timer: null, retry: 0, retryOwner: null };
let admission = readAdmission();
let signedIn = false;
let publicPreview = false;
let seatId = null;
let round = null;
let nextSeq = 0;
let state = null;
let waitingForState = true;
let recovering = false;
let frame = null;
let gameReady = false;
let gameAccess = null;
let gameMap = null;
let gameTimer = null;
let lastIntent = null;
let lastRendered = '';
let lastBasesRendered = '';
const BASE_LABELS = new Map([
  ['base_root_walk', 'Root Walk'], ['base_bridge_far', 'Bridge Lookout'], ['base_canopy_fork', 'Canopy Fork']
]);
let pendingJoin = null;
let knownPresence = new Map();
let phaseWas = '';

view[teacherPage ? 'teacher-link' : 'student-link'].setAttribute('aria-current', 'page');

function readAdmission() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    return typeof saved?.code === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function saveAdmission(next) {
  admission = next;
  try {
    if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // In-memory reconnect still works if this browser restricts session storage.
  }
}

function error(message = '') {
  view.error.textContent = message;
  view.error.hidden = !message;
}

function entry() {
  view.join.hidden = teacherPage || Boolean(admission);
  view.login.hidden = publicPreview || !teacherPage || signedIn;
  view.host.hidden = !teacherPage || (!publicPreview && !signedIn);
  view.create.hidden = Boolean(admission);
  view['sign-out'].hidden=publicPreview;
  view['nickname-label'].hidden=publicPreview;
  view['nickname-note'].hidden=publicPreview;
  view.join.elements.nickname.required=!publicPreview;
  view.room.hidden = !admission;
}

async function post(path, body = {}) {
  const response = await fetch('/api/v1/' + path, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function act(button, action) {
  error();
  button.disabled = true;
  try {
    await action();
  } catch (reason) {
    error(reason.message || 'Fox Run is unavailable');
  } finally {
    button.disabled = false;
    if (button === view.start || button === view['close-room']) render();
  }
}

function form(id, submit) {
  view[id].addEventListener('submit', event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(view[id]));
    void act(event.submitter || view[id].querySelector('button'), () => submit(fields));
  });
}

form('join', async fields => {
  if(publicPreview)delete fields.nickname;
  const request = JSON.stringify(fields);
  if (pendingJoin?.request !== request) pendingJoin = { request, key: crypto.randomUUID() };
  const result = await post('join', { ...fields, joinKey: pendingJoin.key });
  pendingJoin = null;
  saveAdmission({ code: result.code, seatToken: result.seatToken });
  connect();
});

form('login', async fields => {
  await post('teacher/sign-in', fields);
  view.login.reset();
  signedIn = true;
  entry();
  if (admission) connect();
  else view.create.focus();
});

form('teacher-seat', async fields => {
  const result = await post('teacher/seat', { code: admission.code, species: fields.species });
  saveAdmission({ code: admission.code, seatToken: result.seatToken });
  connect();
});

view.create.addEventListener('click', () => void act(view.create, async () => {
  const result = await post(publicPreview?'public/host':'teacher/rooms');
  if(publicPreview)signedIn=true;
  saveAdmission({ code: result.code });
  connect();
}));

view.start.addEventListener('click', () => void act(view.start, () =>
  post('teacher/start', { code: admission.code })));

view['close-room'].addEventListener('click', () => void act(view['close-room'], async () => {
  await post('teacher/close', { code: admission.code });
  leave();
  view.status.textContent = 'Room closed.';
}));

view['sign-out'].addEventListener('click', () => void act(view['sign-out'], async () => {
  await post('teacher/sign-out');
  signedIn = false;
  leave();
}));

view.leave.addEventListener('click', leave);
view['copy-code'].addEventListener('click', () => void act(view['copy-code'], async () => {
  await navigator.clipboard.writeText(admission.code);
  view.status.textContent = 'Room code copied.';
}));
view['focus-game'].addEventListener('click', () => {
  frame?.contentWindow.focus();
  sendGame('focus');
});

function sendSocket(message) {
  if (transport.ws?.readyState === WebSocket.OPEN) {
    transport.ws.send(JSON.stringify({ ...message, version }));
  }
}

function connect() {
  if (!admission || (teacherPage && !signedIn)) return entry();
  entry();
  clearTimeout(transport.timer);
  const previous = transport.ws;
  const target = admission;
  const url = new URL('/api/v1/socket', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  let admitted = false;
  waitingForState = true;
  transport.ws = ws;
  if (previous) previous.close();
  if (transport.retryOwner !== target) {
    transport.retryOwner = target;
    transport.retry = 0;
  }
  view.status.textContent = recovering ? 'Reconnecting to the same seat…' : 'Connecting to room ' + target.code + '…';
  render();
  ws.addEventListener('open', () => {
    if (ws !== transport.ws) return;
    sendSocket(target.seatToken
      ? { type: 'connect', code: target.code, seatToken: target.seatToken }
      : { type: 'watch', code: target.code });
  });
  ws.addEventListener('message', event => {
    if (ws !== transport.ws) return;
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') {
      error(msg.message);
    } else if (msg.version === version && msg.type === 'connected') {
      seatId = msg.seatId;
      admitted = true;
      transport.retry = 0;
      view['room-heading'].tabIndex = -1;
      view['room-heading'].focus({ preventScroll: true });
    } else if (admitted && msg.version === version && msg.type === 'state') {
      if (waitingForState) {
        waitingForState = false;
        view.status.textContent = recovering && seatId ? 'Rejoined the same seat.' : '';
        recovering = false;
      }
      if (msg.room.round !== round) {
        round = msg.room.round;
        nextSeq = 0;
        lastIntent = null;
      }
      const me = msg.players.find(player => player.id === seatId);
      if (me) nextSeq = Math.max(nextSeq, me.seq + 1);
      state = msg;
      render();
      sendGame('state', { state, seatId });
    }
  });
  ws.addEventListener('close', event => {
    if (ws !== transport.ws) return;
    transport.ws = null;
    waitingForState = true;
    lastIntent = null;
    render();
    if (event.code === 4002) {
      leave();
      view.status.textContent = 'The teacher closed the room.';
      return;
    }
    if (event.code === 4001 || event.code === 1008) {
      view.status.textContent = event.code === 4001
        ? 'This seat rejoined in another tab or window.'
        : 'The room connection was rejected.';
      return;
    }
    recovering = Boolean(seatId);
    view.status.textContent = 'Disconnected. Reconnecting…';
    transport.timer = setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(transport.retry++, 4)));
  });
}

function leave() {
  saveAdmission(null);
  gameAccess = null;
  clearTimeout(transport.timer);
  const previous = transport.ws;
  transport.ws = null;
  previous?.close();
  seatId = null;
  round = null;
  state = null;
  recovering = false;
  waitingForState = true;
  phaseWas = '';
  lastBasesRendered = '';
  pendingJoin = null;
  knownPresence.clear();
  view.presence.textContent = '';
  error();
  view.status.textContent = '';
  gameReady = false;
  gameMap = null;
  clearTimeout(gameTimer);
  frame?.remove();
  frame = null;
  entry();
  if (teacherPage) (publicPreview || signedIn ? view.create : view.login.querySelector('input')).focus();
  else view.join.querySelector('input').focus();
}

function render() {
  view['room-code'].textContent = admission?.code || '';
  const online = transport.ws?.readyState === WebSocket.OPEN && !waitingForState;
  view.match.hidden = !online || !state?.match;
  view['game-panel'].hidden = !online || !frame;
  view.result.hidden = !online;
  view['host-controls'].hidden = !teacherPage || !signedIn;
  view.start.disabled = !online || !state || state.room.phase === 'running' || !state.room.seats.some(s => s.connected);
  view['close-room'].disabled = !online || !state || (!publicPreview && state.room.phase === 'running');
  view['teacher-seat'].hidden = Boolean(admission?.seatToken) || state?.room.phase !== 'lobby';
  if (!state) return;
  const { room, match, interrupted } = state;
  const hasPlayer = room.seats.some(s => s.connected);
  const lobbyHint = teacherPage
    ? (hasPlayer ? 'Ready to play. Select Start match.' : 'Share the room code, or choose Take a seat to play yourself.')
    : 'You are in. Wait for the host to start.';
  const phaseText = { lobby: lobbyHint, running: 'Match in progress', finished: 'Match finished' }[room.phase];
  if (view.phase.textContent !== phaseText) view.phase.textContent = phaseText;
  view.start.textContent = room.phase === 'finished' ? 'Start rematch' : 'Start match';
  view['roster-heading'].textContent = 'Players · ' + room.seats.length + ' / ' + (state.maxSeats??8);
  const names = new Map(room.seats.map(s => [s.id, s.nickname]));
  const presence = room.seats.map(s => [s.id, s.connected]);
  const rosterScoreKey = JSON.stringify([presence, room.seats.length, match?.scores]);
  if (rosterScoreKey !== lastRendered) {
    lastRendered = rosterScoreKey;
    const events = [];
    for (const s of room.seats) {
      const previous = knownPresence.get(s.id);
      if (previous === true && !s.connected) events.push(s.nickname + ' disconnected.');
      if (previous === false && s.connected) events.push(s.nickname + ' rejoined.');
      if (s.connected || knownPresence.has(s.id)) knownPresence.set(s.id, s.connected);
    }
    if (events.length) view.presence.textContent = events.join(' ');
    view.roster.replaceChildren(...room.seats.map(s => {
      const line = document.createElement('li');
      const animal = s.species === 'fox' ? 'Fox' : 'Deer';
      const score = match?.scores[s.id];
      line.textContent = s.nickname + ' · ' + animal + ' · ' + (s.connected ? 'Connected' : 'Disconnected') +
        (score == null ? '' : ' · ' + score + (score === 1 ? ' point' : ' points'));
      return line;
    }));
  }
  if (match) {
    const remaining = Math.ceil(match.remainingSeconds);
    const clockText = 'Time left ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
    if (view.clock.textContent !== clockText) view.clock.textContent = clockText;
    const shapes = match.bases.map(base => [
      BASE_LABELS.get(base.id) ?? base.id, names.get(base.owner) ?? 'Unclaimed', base.contested,
      base.claimant ? names.get(base.claimant) ?? 'Player' : '', base.claimant ? Math.round(base.progress * 100) : 0
    ]);
    const key = JSON.stringify(shapes);
    if (key !== lastBasesRendered) {
      lastBasesRendered = key;
      view.bases.replaceChildren(...shapes.map(baseLine));
    }
  }
  const result = interrupted ? 'The match was interrupted. The teacher can start a rematch.' :
    match?.finished && match.leaders.length
      ? (match.winner ? names.get(match.winner) + ' wins.' : 'Tie · ' + match.leaders.map(id => names.get(id)).join(', '))
      : match?.finished ? 'Time is up.' : '';
  if (view.result.textContent !== result) view.result.textContent = result;

  if ((!state.protectedPlay || online) && (admission?.seatToken || room.phase === 'running')) void prepareGame();
  view['game-panel'].hidden = !online || !frame;
  if (room.phase !== phaseWas && room.phase === 'running' && seatId && gameReady) {
    view['focus-game'].focus({ preventScroll: true });
  }
  phaseWas = room.phase;
}

function baseLine([label, owner, contested, claimant, percent]) {
  const item = document.createElement('li');
  item.textContent = label + ' · ' + owner + (contested ? ' · Contested' : '');
  if (claimant) {
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute('aria-label', label + ' capture by ' + claimant);
    item.append(progress);
  }
  return item;
}

async function prepareGame() {
  if (frame || gameAccess) return;
  if (state?.protectedPlay && admission?.seatToken) {
    const target = admission;
    const ws = transport.ws;
    const attempt = {};
    gameAccess = attempt;
    try {
      await post('play/access', { code: target.code, seatToken: target.seatToken });
      if (target !== admission || ws !== transport.ws || waitingForState || gameAccess !== attempt) return;
    } catch {
      if (target === admission) {
        view.status.textContent = 'Could not open the woodland. Reload to rejoin your seat.';
      }
      return;
    } finally {
      if (gameAccess === attempt) gameAccess = null;
    }
  }
  frame = document.createElement('iframe');
  frame.title = 'Fox Run woodland';
  frame.src = '/play/index.html';
  view['game-mount'].append(frame);
  view['game-status'].textContent = 'Loading woodland…';
  view['focus-game'].hidden = true;
  if (state?.protectedPlay) view['game-panel'].hidden = false;
  gameTimer = setTimeout(() => {
    if (!gameReady) view['game-status'].textContent = 'The woodland could not load. Reload this page to rejoin your seat.';
  }, 30000);
}

function sendGame(type, data = {}) {
  if (!gameReady) return;
  frame.contentWindow.postMessage({ source: version, type, ...data }, location.origin);
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.source !== version) return;
  const msg = event.data;
  if (msg.type === 'ready') {
    if (typeof msg.mapId !== 'string' || msg.mapId !== state?.mapId) {
      view['game-status'].textContent = 'The woodland version does not match this room.';
      return;
    }
    clearTimeout(gameTimer);
    gameMap = msg.mapId;
    gameReady = true;
    view['game-status'].textContent = '';
    view['focus-game'].hidden = !admission?.seatToken;
    sendGame('state', { state, seatId });
  } else if (msg.type === 'input' && !waitingForState && gameReady && gameMap === state?.mapId &&
      seatId && state?.room.phase === 'running' && state.players.some(p => p.id === seatId)) {
    if (!Array.isArray(msg.move) || msg.move.length !== 2 || !msg.move.every(Number.isFinite) ||
        !Number.isFinite(msg.yaw) || actions.some(action => typeof msg[action] !== 'boolean')) return;
    lastIntent = { move: msg.move, yaw: msg.yaw };
    const actionFlags = Object.fromEntries(actions.map(action => [action, msg[action]]));
    sendSocket({ type: 'input', round, seq: nextSeq++, ...lastIntent, ...actionFlags });
  } else if (msg.type === 'error') {
    view['game-status'].textContent = 'The woodland could not start.';
  }
});

window.addEventListener('blur', () => {
  if (!lastIntent || !seatId || state?.room.phase !== 'running') return;
  const released = Object.fromEntries(actions.map(action => [action, false]));
  sendSocket({ type: 'input', round, seq: nextSeq++, move: [0, 0], yaw: lastIntent.yaw, ...released });
  lastIntent = null;
});

try {
  ({publicPreview}=await post('mode'));
  if(publicPreview) {
    view['teacher-link'].textContent='Host';
    view['student-link'].textContent='Join';
    view.create.textContent='Host room';
    document.querySelector('.brand span').textContent='Public preview';
  }
} catch (reason) {error(reason.message);}
entry();
if (teacherPage) {
  try {
    ({ signedIn } = await post('teacher/status'));
  } catch (reason) {
    error(reason.message);
  }
  if(publicPreview && !signedIn && admission)saveAdmission(null);
  entry();
}
connect();
