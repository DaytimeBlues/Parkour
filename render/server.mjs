import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleMultiplayer} from '../server/lib/multiplayer.mjs';
import {handleLeaderboard} from '../server/lib/leaderboard.mjs';
import {NodeDatabase} from './storage.mjs';
import {configuredOrigin,configuredTeachers,createTeacherAuth} from './auth.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const form=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Parkour teacher sign-in</title><style>body{font:18px system-ui;max-width:38rem;margin:3rem auto;padding:1rem;background:#111927;color:#fff}label,input,button{display:block;margin:.7rem 0}input,button{font:inherit;padding:.7rem;width:100%;box-sizing:border-box}a{color:#9ed5ff}</style><h1>Parkour test teacher access</h1><p>This is a disposable test service, not ChatGPT sign-in. Use the named teacher ID and private secret configured by this service's operator. Students only need a room code.</p><form method="post" action="/teacher/login"><label>Teacher ID<input name="teacher" autocomplete="username" maxlength="32" required></label><label>Private teacher secret<input name="secret" type="password" autocomplete="current-password" maxlength="1024" required></label><button>Sign in</button></form><form method="post" action="/teacher/logout"><button>Sign out on this browser</button></form><p>Rooms, scores and teacher sessions can disappear whenever this test service restarts.</p><a href="/game/">Solo courses</a> · <a href="/game/multiplayer/">Join a room</a></html>`;
function send(res,status,body='',extra={}){res.writeHead(status,{...headers,...extra});res.end(body);}
function error(res,status,code){send(res,status,JSON.stringify({error:code}),{'Content-Type':'application/json'});}
function body(req){return new Promise((resolve,reject)=>{let size=0,failed=false;const chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>12288){if(!failed){failed=true;reject(Object.assign(Error('body limit'),{status:413}));}return;}if(!failed)chunks.push(chunk);});req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks));});req.on('error',reject);req.on('aborted',()=>reject(Error('aborted')));});}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8'};
export function createHandler({origin,teachers=new Map(),db,publicDir=path.join(root,'.render-build'),clock=Date.now,timingClock=()=>performance.now()}){
 configuredOrigin(origin);const auth=createTeacherAuth({origin,teachers,clock});
 return async(req,res)=>{
  try{
   if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return error(res,400,'INVALID_TARGET');
   let pathname;try{pathname=decodeURIComponent(req.url.split('?')[0]);}catch{return error(res,400,'INVALID_TARGET');}
   if(pathname.includes('\0')||pathname.includes('\\')||pathname.split('/').some(part=>part==='..'||part.startsWith('.')))return error(res,400,'INVALID_TARGET');
   const url=new URL(req.url,origin);
   if(pathname==='/healthz'&&req.method==='GET')return send(res,200,'ok',{'Content-Type':'text/plain'});
   if(['/','/game','/game/multiplayer','/signin-with-chatgpt'].includes(pathname)&&req.method==='GET')return send(res,303,'',{Location:pathname==='/signin-with-chatgpt'?'/teacher':pathname==='/game/multiplayer'?'/game/multiplayer/':'/game/'});
   // no-referrer makes native form POSTs send Origin: null. Preserve the
   // same-origin header for CSRF checks, without disclosing cross-site referrers.
   if(pathname==='/teacher'&&req.method==='GET')return send(res,auth.enabled?200:503,auth.enabled?form:form.replace('<form method="post" action="/teacher/login">','<p><strong>Teacher access is disabled until the operator configures named teachers.</strong></p><form hidden method="post" action="/teacher/login">'),{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin'});
   if(pathname.startsWith('/api/')||pathname==='/teacher/login'||pathname==='/teacher/logout'){
    if(!['GET','POST'].includes(req.method))return error(res,405,'METHOD_NOT_ALLOWED');
    const bytes=req.method==='POST'?await body(req):undefined;
    const request=new Request(url,{method:req.method,headers:req.headers,...(bytes?{body:bytes}:{})});
    if(pathname.startsWith('/teacher/')){
     if(req.method!=='POST')return error(res,405,'METHOD_NOT_ALLOWED');
     if(pathname==='/teacher/login'&&(request.headers.get('content-type')??'').split(';')[0]!=='application/x-www-form-urlencoded')return error(res,415,'FORM_REQUIRED');
     const result=pathname==='/teacher/login'?auth.login(request,new URLSearchParams(bytes.toString('utf8'))):auth.logout(request);
     if(result.error)return error(res,result.status,result.error);
     return send(res,303,'',{'Set-Cookie':result.cookie,Location:pathname==='/teacher/login'?'/game/multiplayer/':'/teacher'});
    }
    const startedAt=timingClock();
    const response=pathname.startsWith('/api/multiplayer/')?await handleMultiplayer(request,db,{principal:auth.principal(request),now:clock()}):await handleLeaderboard(request,db,clock());
    const extra=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)extra['set-cookie']=cookies;
    const payload=Buffer.from(await response.arrayBuffer());
    // Aggregate application time only, from dispatch through serialization.
    // Excludes body upload, proxy/network transit and socket delivery. No IDs,
    // SQL details, credentials or cross-origin timing permission are exposed.
    const elapsed=timingClock()-startedAt;
    if(pathname==='/api/multiplayer/sync'&&response.ok&&Number.isFinite(elapsed)&&elapsed>=0)extra['Server-Timing']=`app;dur=${elapsed.toFixed(2)}`;
    return send(res,response.status,payload,extra);
   }
   if(!['GET','HEAD'].includes(req.method))return error(res,405,'METHOD_NOT_ALLOWED');
   if(!pathname.startsWith('/game/')&&!pathname.startsWith('/licenses/'))return error(res,404,'NOT_FOUND');
   if(pathname.endsWith('/'))pathname+='index.html';
   const base=await realpath(publicDir),candidate=await realpath(path.resolve(base,'.'+pathname));
   if(!candidate.startsWith(base+path.sep)||!(await stat(candidate)).isFile())return error(res,404,'NOT_FOUND');
   return send(res,200,req.method==='HEAD'?'':await readFile(candidate),{'Content-Type':mime[path.extname(candidate)]??'application/octet-stream'});
  }catch(e){if(res.headersSent){res.end();return;}if(e?.status===413)res.setHeader('Connection','close');error(res,e?.status===413?413:e?.code==='ENOENT'?404:503,e?.status===413?'BODY_TOO_LARGE':e?.code==='ENOENT'?'NOT_FOUND':'SERVICE_UNAVAILABLE');}
 };
}
export function start(env=process.env){
 const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
 const origin=configuredOrigin(env.PUBLIC_ORIGIN??env.RENDER_EXTERNAL_URL),teachers=configuredTeachers(env.PARKOUR_TEACHERS_JSON);
 const db=new NodeDatabase(env.PARKOUR_DB_PATH??':memory:');const server=createServer({maxHeaderSize:16384,headersTimeout:10000,requestTimeout:15000},createHandler({origin,teachers,db}));
 server.on('close',()=>db.close());server.listen(port,'0.0.0.0',()=>console.log(`Parkour disposable test service listening on port ${port}; teacher access ${teachers.size?'configured':'disabled'}.`));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start();
