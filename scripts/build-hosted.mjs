import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),server=path.join(root,'server');
function run(args,cwd=root){const r=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);}
const manifest=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
if(!manifest.project_id||manifest.static||manifest.d1!=='DB')throw Error('Hosted build requires a verified Worker Site manifest with DB and no static field.');
mkdirSync(path.join(server,'.openai'),{recursive:true});
writeFileSync(path.join(server,'.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
run(['node_modules/typescript/bin/tsc','--noEmit']);
run(['node_modules/vite/bin/vite.js','build','--config','vite.hosted.config.ts']);
for(const [source,target] of [['.game-build','game'],['public/models','game/models'],['public/audio','audio'],['public/licenses','licenses']]){const dest=path.join(server,'public',target);rmSync(dest,{recursive:true,force:true});cpSync(path.join(root,source),dest,{recursive:true});}
run(['scripts/run-framework.mjs','build'],server);
rmSync('dist',{recursive:true,force:true});cpSync(path.join(server,'dist'),'dist',{recursive:true});
if(!existsSync('dist/server/index.js'))throw Error('Worker output missing');
console.log('Hosted Worker/game artifact prepared; this command does not publish.');
