import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import R from '@dimforge/rapier3d-compat';
import {GameplayKeys, movementInput, canCaptureGameplayKey, isKeyboardUI} from '../src/simulation/keyboard.ts';
import {Boost, BoostInputLatch} from '../src/simulation/boost.ts';
import {FlowRun} from '../src/simulation/flow.ts';
import {PuzzleRun} from '../src/simulation/puzzle.ts';
import {flowCourses} from '../src/simulation/flow-course.ts';
import {tunnelCourses} from '../src/simulation/tunnel-course.ts';

const plainTarget={closest:()=>null};
const uiTarget={closest:()=>({})};
function event(code, extra={}) {
  return {code,repeat:false,target:plainTarget,defaultPrevented:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,
    preventDefault(){this.defaultPrevented=true;},...extra};
}
const bindings=[['KeyW','ArrowUp',{forward:1,right:0}],['KeyS','ArrowDown',{forward:-1,right:0}],['KeyA','ArrowLeft',{forward:0,right:-1}],['KeyD','ArrowRight',{forward:0,right:1}]];
test('each arrow is an exact WASD alias, including both-key and either-release order',()=>{
  for(const [wasd,arrow,expected] of bindings) for(const order of [[wasd,arrow],[arrow,wasd]]) {
    const keys=new GameplayKeys();
    for(const key of order){const e=event(key);assert.equal(keys.press(e),'held');assert.ok(e.defaultPrevented);assert.deepEqual(movementInput(keys),expected);}
    keys.delete(order[0]);assert.deepEqual(movementInput(keys),expected);
    keys.delete(order[1]);assert.deepEqual(movementInput(keys),{forward:0,right:0});
  }
});
test('opposing actions cancel across aliases; no double strength when both aliases are held',()=>{
  const keys=new GameplayKeys(['KeyW','ArrowUp','ArrowDown','KeyA','ArrowRight']);
  assert.deepEqual(movementInput(keys),{forward:0,right:0});
  keys.delete('ArrowDown');keys.delete('KeyA');keys.add('KeyD');
  assert.deepEqual(movementInput(keys),{forward:1,right:1});
});
test('repeat is consumed but cannot resurrect cleared movement or retrigger jump',()=>{
  const keys=new GameplayKeys();
  assert.equal(keys.press(event('Space')),'jump');
  assert.equal(keys.press(event('Space')),'held');
  assert.equal(keys.press(event('Space',{repeat:true})),'held');
  keys.press(event('ArrowUp'));keys.clear();
  const repeated=event('ArrowUp',{repeat:true});keys.press(repeated);
  assert.ok(repeated.defaultPrevented);assert.equal(keys.size,0);
  keys.press(event('ArrowUp'));assert.equal(movementInput(keys).forward,1);
  const unknown=event('Tab');assert.equal(keys.press(unknown),null);assert.equal(unknown.defaultPrevented,false);
});
test('inactive, UI, composition and browser shortcuts are not captured',()=>{
  assert.equal(canCaptureGameplayKey(event('ArrowDown'),false),false);
  for(const extra of [{target:uiTarget},{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true},{defaultPrevented:true}]) {
    assert.equal(canCaptureGameplayKey(event('ArrowDown',extra),true),false);
  }
  assert.equal(canCaptureGameplayKey(event('ArrowDown'),true),true);
  let selector='';isKeyboardUI({closest:s=>(selector=s,null)});
  for(const protectedType of ['input','textarea','select','button','contenteditable','textbox','slider','combobox']) assert.ok(selector.includes(protectedType));
});

// Executes the actual main.ts keyboard/blur/visibility/focus callbacks with mock
// event targets. This is DOM-adapter testing, not a browser or WebGL playthrough.
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
function harness() {
  const listeners=new Map(),canvas={},keys=new GameplayKeys(),boostKeys=new BoostInputLatch(),boost=new Boost();
  const document={pointerLockElement:canvas,hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),exitPointerLock(){this.pointerLockElement=null;}};
  const context={document,window:{addEventListener:(name,fn)=>listeners.set(name,fn)},renderer:{domElement:canvas},phase:'playing',keys,boostKeys,boost,flowRun:null,puzzleRun:null,jumpBuffer:0,yaw:0,GameplayKeys,movementInput,canCaptureGameplayKey,isKeyboardUI,cancelStart(){},music:{pause(){}},puzzleInput:()=>movementInput(keys)};
  context.pause=()=>{context.phase='paused';keys.clear();boostKeys.clear();context.jumpBuffer=0;};
  vm.runInNewContext(main.slice(main.indexOf("document.addEventListener('keydown'"),main.indexOf('function respawnPlayer()')),context);
  return {context,canvas,keys,fire:(name,e)=>listeners.get(name)(e)};
}
test('real key handlers capture arrows only in locked gameplay; release always clears physical keys',()=>{
  const h=harness();const down=event('ArrowDown');h.fire('keydown',down);assert.ok(down.defaultPrevented);assert.equal(movementInput(h.keys).forward,-1);
  h.context.phase='paused';h.fire('keyup',event('ArrowDown',{target:uiTarget}));assert.equal(h.keys.size,0);
  for(const phase of ['ready','starting','paused','finished']) {h.context.phase=phase;const e=event('ArrowDown');h.fire('keydown',e);assert.equal(e.defaultPrevented,false);assert.equal(h.keys.size,0);}
  h.context.phase='playing';h.context.document.pointerLockElement=null;const e=event('ArrowDown');h.fire('keydown',e);assert.equal(e.defaultPrevented,false);assert.equal(h.keys.size,0);
});
test('real key handler keeps UI and browser shortcut input untouched even while playing',()=>{
  const h=harness();
  for(const extra of [{target:uiTarget},{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true}]) {
    const e=event('ArrowDown',extra);h.fire('keydown',e);assert.equal(e.defaultPrevented,false);assert.equal(h.keys.size,0);
  }
});
test('real key handlers feed arrow directions to legacy boost and charged puzzle boost',()=>{
  const h=harness();h.fire('keydown',event('ArrowRight'));h.fire('keydown',event('ShiftLeft'));
  assert.ok(h.context.boost.direction.x>0.99);assert.ok(Math.abs(h.context.boost.direction.z)<1e-9);
  let released=null;h.context.puzzleRun={yaw:0,releaseBoost:(code,input)=>released={code,input}};
  h.fire('keyup',event('ShiftLeft',{ctrlKey:true}));assert.deepEqual(released,{code:'ShiftLeft',input:{forward:0,right:1}});
});
test('real blur, hidden-page and UI-focus handlers clear both aliases and pause',()=>{
  for(const name of ['blur','visibilitychange','focusin']) {
    const h=harness();h.fire('keydown',event('KeyW'));h.fire('keydown',event('ArrowUp'));
    if(name==='visibilitychange')h.context.document.hidden=true;
    h.fire(name,event('Tab',{target:uiTarget}));assert.equal(h.context.phase,'paused');assert.equal(h.keys.size,0);
    h.context.phase='playing';h.context.document.pointerLockElement=h.canvas;
    h.fire('keydown',event('ArrowUp',{repeat:true}));assert.equal(h.keys.size,0);
    h.fire('keydown',event('ArrowUp'));assert.equal(movementInput(h.keys).forward,1);
  }
});
test('unlock/reset/respawn/finish keep shared physical-key clearing; all movement consumers use aliases',()=>{
  assert.match(main,/pointerLockElement!==renderer.domElement\)\{pause\(\);return;/);
  for(const [start,end] of [['function reset()','function pause()'],['function pause()',"restart.addEventListener"],['function respawnPlayer()','function finish()'],['function finish()','function update(']]) {
    assert.ok(main.slice(main.indexOf(start),main.indexOf(end)).includes('keys.clear()'),start);
  }
  assert.ok(!/keys\.has\('Key[WASD]'\)/.test(main));
  assert.match(main,/renderer\.domElement\.focus\(\{preventScroll:true\}\)/);
});
test('Flow I/II and Relay Gardens receive identical movement/strafe/diagonal simulation from arrows or WASD',async()=>{
  await R.init();
  for(const make of [()=>new PuzzleRun(),...flowCourses.map(c=>()=>new FlowRun(c)),...tunnelCourses.map(c=>()=>new FlowRun(c))]) {
    const a=make(),b=make();
    try {
      for(let i=0;i<30;i++){a.step({forward:0,right:0});b.step({forward:0,right:0});}
      for(const [letters,arrows] of [[['KeyW'],['ArrowUp']],[['KeyS'],['ArrowDown']],[['KeyA'],['ArrowLeft']],[['KeyD'],['ArrowRight']],[['KeyW','KeyD'],['ArrowUp','ArrowRight']]]) {
        const ai=movementInput(new Set(letters)),bi=movementInput(new Set(arrows));
        const d=b.direction(bi);assert.ok(Math.abs(Math.hypot(d.x,d.z)-1)<1e-12,'normalized direction');
        for(let i=0;i<6;i++){a.step(ai);b.step(bi);assert.deepEqual(a.position,b.position);assert.equal(a.yaw,b.yaw);}
      }
    } finally {a.dispose();b.dispose();}
  }
});
