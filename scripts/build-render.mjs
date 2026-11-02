import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync} from 'node:fs';
function run(args){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
run(['node_modules/typescript/bin/tsc','--noEmit']);run(['node_modules/vite/bin/vite.js','build','--config','vite.hosted.config.ts']);
rmSync('.render-build',{recursive:true,force:true});mkdirSync('.render-build',{recursive:true});cpSync('.game-build','.render-build/game',{recursive:true});cpSync('public/models','.render-build/game/models',{recursive:true});cpSync('public/licenses','.render-build/licenses',{recursive:true});
const file='.render-build/game/multiplayer/index.html';let html=readFileSync(file,'utf8');html=html.replace('href="/signin-with-chatgpt?return_to=/game/multiplayer/"','href="/teacher"').replace('Sign in with ChatGPT','Teacher test sign-in');html=html.replace('<body>','<body><div style="position:relative;z-index:50;padding:6px;text-align:center;background:#152334;color:white;font:14px system-ui">Disposable test service · rooms and scores reset on restart · <a style="color:#9ed5ff" href="/teacher">Teacher sign-in / sign-out</a></div>');writeFileSync(file,html);
console.log('Built same-origin Render test service assets. Music intentionally omitted; no deployment performed.');
