import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ASSETS = new Map([
  ['index.html','text/html; charset=utf-8'],
  ['index.js','text/javascript; charset=utf-8'],
  ['index.wasm','application/wasm'],
  ['index.pck','application/octet-stream'],
]);
const VERSION = 'fox-run-classroom-v1';
const SCOPE = 'protected-render-preview-v1';
const COOKIE = '__Secure-fox_play';
const TTL_MS = 15 * 60 * 1000;
const codePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9]{16}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (status, message='Preview unavailable') =>
  Object.assign(new Error(message), { status });
const exactKeys = (o, keys) =>
  o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o,k));

function sameSecret(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
}

export async function loadPreviewRelease({directory, primaryOrigin, approvedMapId, manifestSHA256, loopbackFixture=false}) {
  let url;
  try { url = new URL(primaryOrigin); } catch { throw fail(500); }
  if (url.origin !== primaryOrigin || url.protocol !== 'https:' ||
      !(loopbackFixture ? url.hostname === 'localhost' && !!url.port : url.hostname.endsWith('.onrender.com') && !url.port) || !shaPattern.test(manifestSHA256 ?? '') ||
      typeof approvedMapId !== 'string' || !/^[a-z0-9-]{10,100}$/.test(approvedMapId)) throw fail(500);
  const root = await realpath(directory);
  async function pinnedFile(name) {
    const path = join(root,name);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || await realpath(path) !== resolve(root,name)) throw fail(500);
    return { path, size: entry.size, digest: sha(await readFile(path)) };
  }
  const manifestEntry = await pinnedFile('fox-preview-export.json');
  if (manifestEntry.digest !== manifestSHA256) throw fail(500);
  const manifestBytes = await readFile(manifestEntry.path);
  if (sha(manifestBytes) !== manifestSHA256) throw fail(500);
  let manifest;
  try { manifest = JSON.parse(manifestBytes); } catch { throw fail(500); }
  if (!exactKeys(manifest, ['version','scope','mapId','sha256']) ||
      manifest.version !== VERSION || manifest.scope !== (loopbackFixture ? 'protected-loopback-fixture-v1' : SCOPE) || manifest.mapId !== approvedMapId ||
      !exactKeys(manifest.sha256,[...ASSETS.keys()])) throw fail(500);
  const files = new Map();
  for (const [name,mime] of ASSETS) {
    const file = await pinnedFile(name);
    if (file.digest !== manifest.sha256[name]) throw fail(500);
    files.set(name,Object.freeze({...file,mime}));
  }
  return Object.freeze({
    origin: primaryOrigin, mapId: approvedMapId, manifestSHA256,
    // No arbitrary path resolution from request paths.
    asset(pathname) {
      if (pathname === '/play/') return files.get('index.html');
      if (typeof pathname !== 'string' || !pathname.startsWith('/play/')) return undefined;
      return files.get(pathname.slice(6));
    }
  });
}

// Reuse existing admitted seat identities; no additional user-facing credential.
// The resolver must return the *current* room and must not mint seats.
export function createPreviewAccess({release, lookupRoom, identifyTeacher, now=Date.now}) {
  if (new URL(release.origin).protocol !== 'https:') throw fail(500);
  const key = randomBytes(32);
  const sign = body => createHmac('sha256',key).update('fox-play-v1\0').update(body).digest('base64url');
  const cookies = expired =>
    '; Path=/play/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (expired ? '0' : TTL_MS/1000);
  function currentRoom(code) {
    if (typeof code !== 'string' || !codePattern.test(code)) return undefined;
    const room = lookupRoom(code);
    return room?.code === code && room.seats instanceof Map ? room : undefined;
  }
  function mint({origin, code, seatToken, cookie}) {
    if (origin !== release.origin) throw fail(403);
    if (typeof seatToken !== 'string' || !tokenPattern.test(seatToken)) throw fail(403);
    const room = currentRoom(code);
    if (!room) throw fail(403);
    const seat = [...room.seats.values()].find(s => sameSecret(s.seatToken,seatToken));
    if (!seat || !idPattern.test(seat.id) ||
        (seat.id === room.teacherSeat?.seatId && identifyTeacher(cookie) !== room.teacherId)) throw fail(403);
    // An asset cookie conveys no room seat authentication.
    const body = Buffer.from(JSON.stringify([release.manifestSHA256,code,seat.id,now()+TTL_MS])).toString('base64url');
    return COOKIE + '=' + body + '.' + sign(body) + cookies(false);
  }
  function hasSeat(header) {
    if (typeof header !== 'string' || header.length > 4096) return false;
    const fields = header.split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE+'='));
    if (fields.length !== 1) return false;
    const match = /^([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/.exec(fields[0].slice(COOKIE.length+1));
    if (!match || !sameSecret(sign(match[1]),match[2])) return false;
    try {
      const record = JSON.parse(Buffer.from(match[1],'base64url').toString('utf8'));
      if (!Array.isArray(record) || record.length !== 4) return false;
      const [digest,code,id,expiry] = record;
      const room = currentRoom(code);
      return digest === release.manifestSHA256 && Number.isSafeInteger(expiry) && expiry > now() &&
        !!room?.seats.get(id) && (id !== room.teacherSeat?.seatId || identifyTeacher(header) === room.teacherId);
    } catch { return false; }
  }
  return {
    mint,
    clear: () => COOKIE + '=' + cookies(true),
    lookup({method, pathname, cookie, host}) {
      if (host !== new URL(release.origin).host) throw fail(403);
      if (!['GET','HEAD'].includes(method)) throw fail(405);
      const file = release.asset(pathname);
      if (!file) throw fail(404);
      if (!hasSeat(cookie) && !identifyTeacher(cookie)) throw fail(403);
      return { file, headers: {'Content-Type': file.mime, 'Content-Length': file.size,
        'Cache-Control': 'private, no-store', 'Vary':'Cookie', 'X-Content-Type-Options':'nosniff'} };
    }
  };
}
