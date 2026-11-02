import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createServer} from 'node:http';import {once} from 'node:events';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const hash=b=>createHash('sha256').update(b).digest('hex');
test('actual configured start entrypoint serves built same-origin game and exact model, no music or implicit teacher access',async t=>{
 const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));assert.equal(pkg.scripts['start:render'],'node render/server.mjs');
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['render/server.mjs'],{cwd:new URL('../../',import.meta.url),env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,PARKOUR_TEACHERS_JSON:'',PARKOUR_DB_PATH:':memory:',npm_config_cache:new URL('../../../npm-cache',import.meta.url).pathname},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);t.after(()=>child.kill('SIGTERM'));
 let healthy=false;for(let i=0;i<50;i++){try{if((await fetch(origin+'/healthz')).ok){healthy=true;break;}}catch{}if(child.exitCode!==null)break;await sleep(100);}assert.ok(healthy,'start command health');
 for(const file of ['index.html','multiplayer/index.html','models/appearance/avatar-fox.glb']){const response=await fetch(origin+'/game/'+file);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(readFileSync(new URL('../../.render-build/game/'+file,import.meta.url))));}
 const html=await(await fetch(origin+'/game/multiplayer/')).text();assert.ok(html.includes('Teacher test sign-in'));assert.ok(!html.includes('Sign in with ChatGPT'));const js=html.match(/src="(\/game\/assets\/[^\"]+\.js)"/)[1];assert.equal((await fetch(origin+js)).status,200);
 assert.equal((await fetch(origin+'/teacher')).status,503);assert.equal((await fetch(origin+'/audio/armoury-afterlight.mp4')).status,404);assert.ok(!output.includes('secret='));
 child.kill('SIGTERM');await once(child,'exit');
});
