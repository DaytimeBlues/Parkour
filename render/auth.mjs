import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest();
const TTL=6*60*60*1000,MAX_SESSIONS=32;
export function configuredOrigin(value){
 if(typeof value!=='string'||!value)throw Error('PUBLIC_ORIGIN or RENDER_EXTERNAL_URL is required');
 let url;try{url=new URL(value);}catch{throw Error('Invalid public origin');}
 if(url.origin!==value||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('Use an exact public origin without path or trailing slash');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('HTTPS required except explicit loopback tests');
 return value;
}
export function configuredTeachers(raw){
 if(!raw)return new Map();let object;try{object=JSON.parse(raw);}catch{throw Error('Invalid teacher configuration');}
 if(!object||Array.isArray(object)||typeof object!=='object')throw Error('Invalid teacher configuration');
 const entries=Object.entries(object),secrets=new Set();if(entries.length>16)throw Error('At most16 named teachers');
 const result=new Map();for(const [id,secret]of entries){if(!/^[a-z][a-z0-9_-]{0,31}$/.test(id)||typeof secret!=='string'||secret.length<32||secret.length>1024||secret.trim()!==secret||secrets.has(secret))throw Error('Invalid or duplicate teacher configuration');secrets.add(secret);result.set(id,digest(secret));}return result;
}
export function createTeacherAuth({origin,teachers,clock=Date.now}){
 const secure=origin.startsWith('https:'),cookieName=secure?'__Host-parkour_teacher':'parkour_teacher_dev',sessions=new Map();let windowStart=clock(),attempts=0;
 const cookie=(token,maxAge)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
 function tokenOf(request){const values=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));return values.length===1&&/^[a-f0-9]{64}$/.test(values[0].slice(cookieName.length+1))?values[0].slice(cookieName.length+1):null;}
 function prune(){const now=clock();for(const [key,s]of sessions)if(s.until<=now)sessions.delete(key);}
 const keyOf=token=>digest(token).toString('hex');
 function principal(request){prune();const token=tokenOf(request),session=token?sessions.get(keyOf(token)):null;return session?{userId:`render-teacher:${session.id}`}:null;}
 function sameOrigin(request){return request.headers.get('origin')===origin&&request.headers.get('sec-fetch-site')!=='cross-site';}
 function login(request,body){
  if(!teachers.size)return{status:503,error:'TEACHER_CONFIGURATION_REQUIRED'};
  if(!sameOrigin(request))return{status:403,error:'ORIGIN_REJECTED'};
  const now=clock();if(now-windowStart>=60000||now<windowStart){windowStart=now;attempts=0;}if(++attempts>10)return{status:429,error:'LOGIN_RATE_LIMITED'};
  if([...body.keys()].length!==2||body.getAll('teacher').length!==1||body.getAll('secret').length!==1)return{status:400,error:'INVALID_FORM'};
  const id=body.get('teacher'),secret=body.get('secret');if(typeof id!=='string'||typeof secret!=='string'||secret.length>1024)return{status:403,error:'SIGN_IN_FAILED'};
  const expected=teachers.get(id),actual=digest(secret),valid=timingSafeEqual(expected??Buffer.alloc(32),actual)&&!!expected;
  if(!valid)return{status:403,error:'SIGN_IN_FAILED'};
  prune();const old=tokenOf(request),oldKey=old?keyOf(old):null;if(sessions.size>=MAX_SESSIONS&&!sessions.has(oldKey))return{status:503,error:'TEACHER_SESSION_LIMIT'};
  if(oldKey)sessions.delete(oldKey);const token=randomBytes(32).toString('hex');sessions.set(keyOf(token),{id,until:now+TTL});return{status:303,cookie:cookie(token,TTL/1000)};
 }
 function logout(request){if(!sameOrigin(request))return{status:403,error:'ORIGIN_REJECTED'};const token=tokenOf(request);if(token)sessions.delete(keyOf(token));return{status:303,cookie:cookie('',0)};}
 return{principal,login,logout,cookieName,enabled:teachers.size>0};
}
