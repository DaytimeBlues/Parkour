import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {createHandler,start} from '../server.mjs';import {NodeDatabase} from '../storage.mjs';import {configuredOrigin,configuredTeachers,createTeacherAuth} from '../auth.mjs';
import {decodeRoom} from '../../shared/multiplayer-wire.mjs';
const secrets={alpha:'a'.repeat(48),beta:'b'.repeat(48)}; // Synthetic tests, never deployment credentials.
const teachers=()=>configuredTeachers(JSON.stringify(secrets));
async function fixture(t,options={}){
 let handler;const server=createServer({maxHeaderSize:16384},(req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`,db=new NodeDatabase();let now=1000;const dir=mkdtempSync(path.join(tmpdir(),'parkour-test-'));mkdirSync(path.join(dir,'game'));writeFileSync(path.join(dir,'game','index.html'),'fixture');
 handler=createHandler({origin,teachers:options.disabled?new Map():teachers(),db,clock:()=>now,publicDir:dir,timingClock:options.timingClock});t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});
 const call=(route,body,cookie,seat,extra={})=>fetch(origin+route,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json','X-Skybound-Wire':'3',...(cookie?{Cookie:cookie}:{}),...(seat?{'X-Skybound-Seat':seat}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=async(id='alpha')=>{const response=await fetch(origin+'/teacher/login',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({teacher:id,secret:secrets[id]})});assert.equal(response.status,303);return response.headers.get('set-cookie').split(';')[0];};
 return{origin,db,dir,call,login,setNow:v=>{now=v;}};
}
test('origin and named-teacher configuration fail closed',()=>{
 for(const bad of [undefined,'','https://example.test/','https://example.test/path','https://u:p@example.test','https://example.test?q=1','http://example.test','ftp://example.test'])assert.throws(()=>configuredOrigin(bad));
 for(const good of ['https://example.test','http://localhost:3000','http://127.0.0.1:3000'])assert.equal(configuredOrigin(good),good);
 assert.equal(configuredTeachers('').size,0);for(const bad of ['[]','null','{"A":"short"}',JSON.stringify({alpha:secrets.alpha,beta:secrets.alpha}),JSON.stringify(Object.fromEntries(Array.from({length:17},(_,i)=>['id'+i,String(i).padStart(32,'0')])))] )assert.throws(()=>configuredTeachers(bad));
 assert.throws(()=>start({PORT:'0',PUBLIC_ORIGIN:'https://example.test'}));assert.throws(()=>start({PORT:'3000'}));
});
test('unconfigured teacher access and spoofed Sites identity fail closed',async t=>{
 const f=await fixture(t,{disabled:true});assert.equal((await f.call('/teacher')).status,503);
 const r=await f.call('/api/multiplayer/rooms',{},null,null,{'X-ChatGPT-User-Id':'fake','X-Sites-User-Id':'fake','oai-authenticated-user-id':'fake','oai-authenticated-email':'fake@example.test'});assert.equal(r.status,401);
 assert.equal((await f.call('/api/multiplayer/me')).status,200);assert.equal((await(await f.call('/api/multiplayer/me')).json()).signedIn,false);
});
test('actual HTTP teacher isolation, eight seats, ninth refusal, reconnect and revocation',async t=>{
 const f=await fixture(t),a=await f.login(),b=await f.login('beta');const room=await(await f.call('/api/multiplayer/rooms',{durationSeconds:300},a)).json();assert.ok(room.code);
 assert.equal((await(await f.call('/api/multiplayer/rooms',undefined,b)).json()).rooms.length,0);
 assert.equal((await f.call('/api/multiplayer/state',{code:room.code},b)).status,403);
 assert.equal((await f.call('/api/multiplayer/control',{code:room.code,action:'start',revision:0,operationId:crypto.randomUUID()},b)).status,403);
 const seats=[];for(let i=0;i<8;i++){const r=await f.call('/api/multiplayer/join',{code:room.code,nickname:`Runner ${i}`,joinKey:String(i+1).padStart(64,'0'),appearance:{character:i%2?'rabbit':'fox',wing:'angel'}});assert.equal(r.status,200);seats.push(await r.json());}
 assert.equal((await f.call('/api/multiplayer/join',{code:room.code,nickname:'Ninth',joinKey:'f'.repeat(64)})).status,409);
 assert.equal((await f.call('/api/multiplayer/control',{code:room.code,action:'start',revision:0,operationId:crypto.randomUUID()},a)).status,200);
 f.setNow(1200);const old=seats[0];const reconnect=await(await f.call('/api/multiplayer/reconnect',{code:room.code},null,old.seatToken)).json();assert.equal(reconnect.playerId,old.playerId);assert.equal(decodeRoom(reconnect.room).players.length,8);f.setNow(1400);const synced=await(await f.call('/api/multiplayer/sync',{code:room.code,epoch:decodeRoom(reconnect.room).epoch,sequence:reconnect.ack+1,frames:[]},null,old.seatToken)).json();assert.equal(synced.ack,reconnect.ack+1);assert.equal(synced.playerId,old.playerId);
 assert.equal((await f.call('/api/multiplayer/control',{code:room.code,action:'remove',revision:1,operationId:crypto.randomUUID(),playerId:old.playerId},a)).status,200);
 assert.equal((await f.call('/api/multiplayer/reconnect',{code:room.code},null,old.seatToken)).status,403);
 assert.equal((await f.call('/api/multiplayer/join',{code:room.code,nickname:'Runner 0',joinKey:'1'.padStart(64,'0'),appearance:{character:'fox',wing:'angel'}})).status,403);
 assert.equal((await f.call('/api/multiplayer/join',{code:room.code,nickname:'Replacement',joinKey:'e'.repeat(64)})).status,200);
});
test('teacher form enforces own origin, exact fields, logout and fixed redirects',async t=>{
 const f=await fixture(t);for(const origin of ['', 'null','https://other.test']){const r=await fetch(f.origin+'/teacher/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({teacher:'alpha',secret:secrets.alpha})});assert.equal(r.status,403);}
 const c=await f.login();assert.equal((await(await f.call('/api/multiplayer/me',undefined,c)).json()).signedIn,true);
 const logout=await fetch(f.origin+'/teacher/logout',{method:'POST',redirect:'manual',headers:{Origin:f.origin,Cookie:c}});assert.equal(logout.status,303);assert.equal(logout.headers.get('location'),'/teacher');assert.equal((await(await f.call('/api/multiplayer/me',undefined,c)).json()).signedIn,false);
 const redirect=await fetch(f.origin+'/signin-with-chatgpt?return_to=https://evil.test',{redirect:'manual'});assert.equal(redirect.headers.get('location'),'/teacher');
});
test('teacher form preserves same-origin POST origin without cross-site referrer disclosure',async t=>{
 const f=await fixture(t),page=await f.call('/teacher');
 assert.equal(page.headers.get('referrer-policy'),'same-origin');
 assert.equal((await f.call('/game/')).headers.get('referrer-policy'),'no-referrer');
 for(const origin of ['', 'null', 'https://other.test']){
  for(const route of ['/teacher/login','/teacher/logout']){
   const r=await fetch(f.origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({teacher:'alpha',secret:secrets.alpha})});
   assert.equal(r.status,403);assert.equal((await r.json()).error,'ORIGIN_REJECTED');
  }
 }
 const c=await f.login();assert.equal((await(await f.call('/api/multiplayer/me',undefined,c)).json()).signedIn,true);
 const logout=await fetch(f.origin+'/teacher/logout',{method:'POST',redirect:'manual',headers:{Origin:f.origin,Cookie:c}});
 assert.equal(logout.status,303);assert.equal((await(await f.call('/api/multiplayer/me',undefined,c)).json()).signedIn,false);
});
test('sessions use secure bounded rotating credentials; expiry and duplicates rejected',()=>{
 let now=0;const origin='https://test.example',auth=createTeacherAuth({origin,teachers:teachers(),clock:()=>now});
 const request=cookie=>new Request(origin+'/teacher/login',{method:'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})}}),form=()=>new URLSearchParams({teacher:'alpha',secret:secrets.alpha});
 const first=auth.login(request(),form());assert.match(first.cookie,/__Host-parkour_teacher=/);for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(first.cookie.includes(flag));const c1=first.cookie.split(';')[0];assert.ok(auth.principal(request(c1)));assert.equal(auth.principal(request(c1+'; '+c1)),null);
 const second=auth.login(request(c1),form());assert.equal(auth.principal(request(c1)),null);const c2=second.cookie.split(';')[0];assert.ok(auth.principal(request(c2)));now=6*60*60*1000;assert.equal(auth.principal(request(c2)),null);
 const cookies=[];for(let i=0;i<32;i++){now+=60001;const r=auth.login(request(),form());assert.equal(r.status,303);cookies.push(r.cookie.split(';')[0]);}
 now+=60001;assert.equal(auth.login(request(),form()).status,503);assert.equal(auth.login(request(cookies[0]),form()).status,303);assert.equal(auth.principal(request(cookies[0])),null);
});
test('login attempts globally bounded and invalid forms do not authenticate',()=>{
 const origin='https://test.example',a=createTeacherAuth({origin,teachers:teachers()});const request=new Request(origin+'/teacher/login',{method:'POST',headers:{Origin:origin}});
 assert.equal(a.login(request,new URLSearchParams('teacher=alpha&secret=x&extra=y')).status,400);
 for(let i=0;i<9;i++)assert.equal(a.login(request,new URLSearchParams({teacher:'alpha',secret:'wrong'})).status,403);
 assert.equal(a.login(request,new URLSearchParams({teacher:'alpha',secret:secrets.alpha})).status,429);
});
test('static containment, body limits, missing music and private-source denial',async t=>{
 const f=await fixture(t);symlinkSync('/etc/hosts',path.join(f.dir,'game','escape.txt'));
 assert.equal((await f.call('/game/')).status,200);for(const route of ['/game/escape.txt','/.git/config','/render/auth.mjs','/audio/example.mp4','/game/%2e%2e%2fpackage.json'])assert.notEqual((await f.call(route)).status,200);
 assert.equal((await f.call('/api/multiplayer/join',{payload:'x'.repeat(13000)})).status,413);
});
test('SQLite real batch rollback, migrations, file reopen and memory restart semantics',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'parkour-db-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'state.sqlite');let db=new NodeDatabase(file);
 db.sqlite.exec('CREATE TABLE probe(value TEXT)');await assert.rejects(db.batch([db.prepare('INSERT INTO probe(value) VALUES(?)').bind('rollback'),db.prepare('INSERT INTO missing_table(value) VALUES(?)').bind('fail')]));assert.equal(db.sqlite.prepare('SELECT count(*) n FROM probe').get().n,0);
 await db.prepare('INSERT INTO probe(value) VALUES(?)').bind('retained').run();const n=db.sqlite.prepare('SELECT count(*) n FROM render_migrations').get().n;db.close();db=new NodeDatabase(file);assert.equal(db.sqlite.prepare('SELECT value FROM probe').get().value,'retained');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM render_migrations').get().n,n);db.close();
 db=new NodeDatabase();db.sqlite.exec('CREATE TABLE transient(value TEXT)');db.close();db=new NodeDatabase();assert.equal(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='transient'").get(),undefined);db.close();
});

test('batch rejects foreign or arbitrary statements before any effects',async()=>{const a=new NodeDatabase(),b=new NodeDatabase();try{a.sqlite.exec('CREATE TABLE probe(value TEXT)');b.sqlite.exec('CREATE TABLE probe(value TEXT)');await assert.rejects(a.batch([a.prepare('INSERT INTO probe(value) VALUES(?)').bind('local'),b.prepare('INSERT INTO probe(value) VALUES(?)').bind('foreign')]));await assert.rejects(a.batch([{execute(){throw Error('must not execute');}}]));for(const db of[a,b])assert.equal(db.sqlite.prepare('SELECT count(*) n FROM probe').get().n,0);}finally{a.close();b.close();}});

test('cross-site origin metadata, unauthorized logout/control and leaderboard cookies remain isolated',async t=>{
 const f=await fixture(t),cookie=await f.login();const login=await fetch(f.origin+'/teacher/login',{method:'POST',headers:{Origin:f.origin,'Sec-Fetch-Site':'cross-site','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({teacher:'alpha',secret:secrets.alpha})});assert.equal(login.status,403);
 const logout=await fetch(f.origin+'/teacher/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie}});assert.equal(logout.status,403);assert.equal((await(await f.call('/api/multiplayer/me',undefined,cookie)).json()).signedIn,true);
 const room=await(await f.call('/api/multiplayer/rooms',{},cookie)).json();const control={code:room.code,action:'start',revision:0,operationId:crypto.randomUUID()};assert.equal((await f.call('/api/multiplayer/control',control)).status,401);assert.equal((await f.call('/api/multiplayer/control',control,cookie,null,{Origin:''})).status,403);
 const first=await f.call('/api/session',{});assert.equal(first.status,200);const boardCookie=first.headers.get('set-cookie');assert.ok(boardCookie.includes('HttpOnly'));const identity=await first.json();const next=await(await f.call('/api/session',{},boardCookie.split(';')[0])).json();assert.equal(next.alias,identity.alias);assert.equal((await(await f.call('/api/multiplayer/me',undefined,boardCookie.split(';')[0])).json()).signedIn,false);
});


test('sync response reports only aggregate app duration, not account or seat data',async t=>{
 let tick=0;const f=await fixture(t,{timingClock:()=>{const value=tick;tick+=12.375;return value;}}),cookie=await f.login();
 const created=await(await f.call('/api/multiplayer/rooms',{durationSeconds:300},cookie)).json();
 const seat=await(await f.call('/api/multiplayer/join',{code:created.code,nickname:'Timing fixture',joinKey:'c'.repeat(64)})).json();
 const baseline=await(await f.call('/api/multiplayer/state',{code:created.code},null,seat.seatToken)).json();
 const reply=await f.call('/api/multiplayer/sync',{code:created.code,epoch:decodeRoom(baseline.room).epoch,sequence:1,frames:[]},null,seat.seatToken);
 assert.equal(reply.status,200);assert.equal(reply.headers.get('server-timing'),'app;dur=12.38');
 assert.equal(reply.headers.get('timing-allow-origin'),null);assert.match(reply.headers.get('cache-control'),/(?:^|,\s*)no-store(?:,|$)/);
 const body=await reply.json();assert.equal(body.ack,1);assert.equal(body.playerId,seat.playerId);
 for(const route of ['/teacher','/healthz','/game/','/api/multiplayer/me'])assert.equal((await f.call(route)).headers.get('server-timing'),null);
 const denied=await f.call('/api/multiplayer/sync',{code:created.code,epoch:1,sequence:2,frames:[]});
 assert.equal(denied.status,401);assert.equal(denied.headers.get('server-timing'),null);
});

for(const invalid of [NaN,Infinity,-1])test(`invalid diagnostic duration ${invalid} cannot break sync`,async t=>{
 let tick=0;const f=await fixture(t,{timingClock:()=>tick++%2===0?0:invalid}),cookie=await f.login();
 const room=await(await f.call('/api/multiplayer/rooms',{durationSeconds:300},cookie)).json();
 const seat=await(await f.call('/api/multiplayer/join',{code:room.code,nickname:'Timing fixture',joinKey:'d'.repeat(64)})).json();
 const baseline=await(await f.call('/api/multiplayer/state',{code:room.code},null,seat.seatToken)).json();
 const reply=await f.call('/api/multiplayer/sync',{code:room.code,epoch:decodeRoom(baseline.room).epoch,sequence:1,frames:[]},null,seat.seatToken);
 assert.equal(reply.status,200);assert.equal((await reply.json()).ack,1);assert.equal(reply.headers.get('server-timing'),null);
});
