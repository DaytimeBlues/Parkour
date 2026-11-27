// Pure contract. This module deliberately exposes no start function and binds no port.
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.onrender\.com$/;
const validDigest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const serviceId = /^srv-[a-z0-9]+$/;
const blockedPorts = new Set([18012,18013,19099]);
const reject = (reason, status=403) => { throw Object.assign(new Error(reason),{status}); };

export function readRenderContract(env, reviewed) {
  // 'reviewed' is a caller-supplied trusted input, not a claim collected from this service's environment.
  // A future executable must verify its review signature separately before calling this pure function.
  if (!reviewed || typeof reviewed.origin!=='string' || !serviceId.test(reviewed.serviceId ?? '') ||
      !validDigest(reviewed.manifestSHA256) || !validDigest(reviewed.authoritySHA256) ||
      reviewed.roomLimit !== 1) reject('Missing independent release review',500);
  if (env.RENDER!=='true' || env.RENDER_SERVICE_TYPE!=='web' || env.IS_PULL_REQUEST!=='false' ||
      env.RENDER_SERVICE_ID!==reviewed.serviceId) reject('Unapproved Render runtime',500);
  const host=env.RENDER_EXTERNAL_HOSTNAME;
  if (typeof host !== 'string' || !hostname.test(host)) reject('Unapproved Render hostname',500);
  const origin='https://'+host;
  if (origin!==env.RENDER_EXTERNAL_URL || origin!==reviewed.origin || new URL(origin).origin!==origin) reject('Noncanonical or unapproved HTTPS origin',500);
  if (env.FOX_ORIGIN!==undefined && env.FOX_ORIGIN!==origin) reject('Conflicting Fox origin',500);
  if (['FOX_LOCAL_HTTP','FOX_ALLOW_LOCAL_ALIGNMENT_FIXTURE','FOX_ALLOW_LINUX_AUTHORITY_SMOKE',
       'FOX_FIXTURE_TLS_KEY','FOX_FIXTURE_TLS_CERT','FOX_PORT','FOX_BIND','FOX_GODOT_BIN'].some(k=>Object.hasOwn(env,k))) {
    reject('Existing local mode or unreviewed runtime override',500);
  }
  if (typeof env.PORT!=='string' || !/^[1-9][0-9]{0,4}$/.test(env.PORT)) reject('Invalid Render port',500);
  const port=Number(env.PORT);
  if (port>65535 || blockedPorts.has(port)) reject('Unavailable Render port',500);
  return Object.freeze({origin,host,bind:'0.0.0.0',port,listenerProtocol:'http:',
    cookieSecure:true,roomLimit:1,manifestSHA256:reviewed.manifestSHA256,
    authoritySHA256:reviewed.authoritySHA256});
}

function onlyHeader(req,name) {
  const raw=req.rawHeaders;
  if (!Array.isArray(raw) || raw.length%2!==0) return undefined;
  let found;
  for(let i=0;i<raw.length;i+=2) {
    if (typeof raw[i]!=='string' || raw[i].toLowerCase()!==name) continue;
    if (found!==undefined || typeof raw[i+1]!=='string') return undefined;
    found=raw[i+1];
  }
  return found;
}
export function gateRenderRequest(contract, req, {upgrade=false}={}) {
  // Validate the immediate HTTP Host; never infer identity/scheme/auth from forwarding headers.
  if (onlyHeader(req,'host')!==contract.host) reject('Unapproved Host');
  const raw=req.url;
  if (typeof raw!=='string' || !raw.startsWith('/') || raw.startsWith('//') ||
      raw.includes('\\') || /[\t\r\n#]/.test(raw) ||
      new URL(raw,contract.origin).pathname!==raw.split('?')[0]) reject('Invalid request target',404);
  if (upgrade) {
    if (req.method!=='GET' || raw!=='/api/v1/socket' || onlyHeader(req,'origin')!==contract.origin) {
      reject('Unapproved upgrade');
    }
    return 'socket';
  }
  if (raw.startsWith('/api/')) {
    if (req.method!=='POST' || raw.includes('?') || onlyHeader(req,'origin')!==contract.origin) {
      reject('Unapproved mutation');
    }
    return 'api'; // Delegates all teacher/room authorization to the existing application.
  }
  if (!['GET','HEAD'].includes(req.method)) reject('Unsupported method',405);
  if (raw==='/' || raw==='/teacher' || raw==='/classroom.mjs' || raw==='/classroom.css') return 'lobby';
  if (raw==='/health') return 'health';
  if (/^\/play\/(?:index\.(?:html|js|pck|wasm|audio\.(?:worklet|position\.worklet)\.js))?$/.test(raw)) return 'protected-asset';
  reject('Unapproved route',404);
}

export function authorityProcessContract() {
  // Absolute review-pinned executable, paths and existing random IPC challenge are caller inputs.
  // Do not inherit PATH/HOME from deployment, any RENDER/FOX credentials, local flags, or loader overrides.
  return Object.freeze({bind:'127.0.0.1',port:0, headless:true,
    env:Object.freeze({LANG:'C.UTF-8',TZ:'UTC'})});
}

export function secureHostCookie(cookie) {
  // Final response assertion, not a signer or a replacement for TeacherAuth/createPreviewAccess.
  // Reject Domain and loose Path to keep the provider origin isolated.
  return typeof cookie==='string' &&
    (cookie.startsWith('fox_teacher=') || cookie.startsWith('__Secure-fox_play=')) &&
    /^\s*[^;\r\n]+(?:;[^;\r\n]+)+$/.test(cookie) &&
    !/(?:^|;)\s*domain(?:=|;|$)/i.test(cookie) &&
    (cookie.startsWith('fox_teacher=') ? /(?:^|;)\s*Path=\/(?:;|$)/i
      : /(?:^|;)\s*Path=\/play\/(?:;|$)/i).test(cookie) &&
    /(?:^|;)\s*SameSite=Strict(?:;|$)/i.test(cookie) &&
    /(?:^|;)\s*Secure(?:;|$)/i.test(cookie) && /(?:^|;)\s*HttpOnly(?:;|$)/i.test(cookie);
}
