import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {StartGate} from '../src/simulation/music.ts';
import {createMenuSteps} from '../src/ui/menu-steps.ts';
function fixture(names){
 const pages=new Map(names.map(name=>[name,{hidden:false,attrs:{},draft:{nickname:'Racing fox',code:'ABC123'},focusCount:0,setAttribute(k,v){this.attrs[k]=v;},querySelector(){return {focus:()=>this.focusCount++};}}]));
 const root={dataset:{},querySelector(selector){return pages.get(selector.match(/"([^"]+)"/)[1])??null;}};
 return {root,pages};
}
test('only one entry page is exposed on start and repeated navigation',()=>{
 const {root,pages}=fixture(['role','join','teacher']),flow=createMenuSteps(root,['role','join','teacher'],'role');
 for(const name of ['role','join','teacher','role','join','join']){
  flow.show(name);assert.equal(flow.current,name);assert.equal(root.dataset.menuScreen,name);
  for(const [key,page] of pages){assert.equal(page.hidden,key!==name);assert.equal(page.attrs['aria-hidden'],String(key!==name));}
 }
});
test('Back preserves nickname, code and teacher choices without DOM replacement',()=>{
 const {root,pages}=fixture(['role','join','teacher']),flow=createMenuSteps(root,['role','join','teacher'],'role');
 const input=pages.get('join').draft;flow.show('join');input.nickname='Rabbit';flow.show('role');flow.show('teacher');flow.show('role');flow.show('join');
 assert.equal(pages.get('join').draft,input);assert.deepEqual(input,{nickname:'Rabbit',code:'ABC123'});
});
test('initial setup does not steal focus; explicit navigation focuses the page target',()=>{
 const {root,pages}=fixture(['mode','solo']),flow=createMenuSteps(root,['mode','solo'],'mode');
 assert.equal(pages.get('mode').focusCount,0);flow.show('solo');assert.equal(pages.get('solo').focusCount,1);flow.show('mode');assert.equal(pages.get('mode').focusCount,1);
});
test('invalid destination does not blank a valid current page',()=>{
 const {root,pages}=fixture(['role','join']),flow=createMenuSteps(root,['role','join'],'join');
 assert.throws(()=>flow.show('missing'),/Unknown menu page/);assert.equal(flow.current,'join');assert.equal(pages.get('join').hidden,false);
});
test('missing expected page fails explicitly before changing visibility',()=>{
 const {root,pages}=fixture(['role']);assert.throws(()=>createMenuSteps(root,['role','join'],'role'),/Missing menu page/);assert.equal(pages.get('role').hidden,false);
});
test('normal entry contains two mode choices and three distinct multiplayer steps',()=>{
 const solo=readFileSync(new URL('../index.html',import.meta.url),'utf8'),multi=readFileSync(new URL('../multiplayer/index.html',import.meta.url),'utf8');
 assert.match(solo,/id="overlay" data-menu-screen="mode"/);assert.match(solo,/id="choose-solo"/);assert.match(solo,/href="\/game\/multiplayer\/"/);assert.match(solo,/id="solo-setup" data-menu-page="solo" hidden/);
 for(const page of ['role','join','teacher'])assert.equal((multi.match(new RegExp(`data-menu-page="${page}"`,'g'))??[]).length,1);
 for(const id of ['restore','join-form','teacher-setup','teacher-signin','teacher-create','create','code','nickname','duration'])assert.equal((multi.match(new RegExp(`id="${id}"`,'g'))??[]).length,1,id);
 assert.match(multi,/id="join-back"/);assert.match(multi,/id="teacher-back"/);assert.match(multi,/id="connection-details"/);
});

test('actual multiplayer Back callbacks invalidate pending views before changing pages',()=>{
 const source=readFileSync(new URL('../src/multiplayer/main.ts',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.startsWith("for(const id of ['join-back','teacher-back'])"));
 const buttons=new Map([['join-back',{}],['teacher-back',{}]]),events=[];
 vm.runInNewContext(line,{$:id=>buttons.get(id),beginView:code=>events.push(['invalidate',code]),entrySteps:{show:name=>events.push(['show',name])},say:message=>events.push(['notice',message])});
 for(const button of buttons.values()){events.length=0;button.onclick();assert.deepEqual(events.slice(0,2),[['invalidate',null],['show','role']]);}
});

test('actual Solo Back cleans pending Start before a late pointer-lock rejection',async()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),handlers={},start={disabled:false,addEventListener:(name,fn)=>handlers.start=fn},back={addEventListener:(name,fn)=>handlers.back=fn};
 let rejectLock;const startGate=new StartGate(),music={playing:false,play(){this.playing=true;return Promise.resolve();},pause(){this.playing=false;}},leaderboard={client:{awaitingSubmission:false},locked:false,lock(value){this.locked=value;}};
 const context={start,startGate,music,leaderboard,phase:'ready',playEpoch:0,needsRankedStart:false,legacyStart:false,renderer:{domElement:{requestPointerLock:()=>new Promise((_,reject)=>rejectLock=reject)}},document:{pointerLockElement:null,exitPointerLock(){}},fine:{textContent:''},menuSteps:{show:name=>context.page=name},$:id=>{assert.equal(id,'solo-back');return back;},pause(){},cancelStart(token){const cancelled=startGate.cancel(token);if(cancelled)start.disabled=false;return cancelled;}};
 vm.runInNewContext(source.slice(source.indexOf("start.addEventListener('click'"),source.indexOf("document.addEventListener('pointerlockchange'")),context);
 vm.runInNewContext(source.split('\n').find(line=>line.startsWith("$('solo-back').addEventListener")),context);
 handlers.start();assert.equal(music.playing,true);assert.equal(leaderboard.locked,true);assert.equal(start.disabled,true);
 handlers.back();assert.equal(music.playing,false);assert.equal(leaderboard.locked,false);assert.equal(start.disabled,false);assert.equal(context.page,'mode');assert.equal(startGate.accept(),false);assert.equal(context.playEpoch,2);
 rejectLock(new Error('late blocked pointer lock'));await Promise.resolve();await Promise.resolve();assert.equal(music.playing,false);assert.equal(leaderboard.locked,false);assert.equal(context.page,'mode');
});
