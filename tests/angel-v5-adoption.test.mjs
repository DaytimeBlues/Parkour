/** Public runtime subset: exact current-consumer test and native-free shipping contracts. Editable-native preservation and historical private lab checks remain separate. */
/** Real current-loader/consumer integration. Node/Three CPU evidence, not browser pixels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AppearanceAssets,CURRENT_ANGEL_ASSET,wingAnimator,avatarAnimator} from '../src/render/appearance-assets.ts';
import {createWingView} from '../src/render/wing-view.ts';
import {appearanceFactory} from '../src/multiplayer/remote-avatar.ts';
import {appearanceCode,appearanceFromCode} from '../shared/appearance.mjs';
const NEW='d65a87e6625f96c5a15011ef13f88fa2fb432ccc6247118a97a80e93380cabaf',OLD='93ae41490a60e1b10efd832f7cb80002479240f0b173cf0a2e699ee7112ee0ce';
const hash=b=>createHash('sha256').update(b).digest('hex');
const data=name=>readFileSync(new URL(`../public/models/appearance/${name}`,import.meta.url));
const parse=b=>new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const revision=root=>root.getObjectByName('Wings').userData.revision;
function store(reads){return new AppearanceAssets('/game/',{loadAsync:async url=>{const b=data(basename(url));reads.push({url,hash:hash(b)});return parse(b);}});}

test('current logical Angel really reaches first-person, actual menu assembly and remote consumers through one versioned template',async()=>{
 const reads=[],assets=store(reads),camera=new THREE.PerspectiveCamera(75,16/9,.1,300),rig=await createWingView(camera,assets,'angel');
 const source=readFileSync(new URL('../src/appearance-menu.ts',import.meta.url),'utf8'),fn=source.slice(source.indexOf(' async function updatePreview('),source.indexOf('\n function open('));
 const context=vm.createContext({generation:0,disposed:false,selection:{preview:()=>({character:'fox',wing:'angel'})},radios:[],toggle:{checked:true},preview:{setAttribute(){}},confirm:{disabled:false},feedback:{textContent:''},dialog:{open:true},assets,animation:null,bodyAnimation:null,avatar:null,wings:null,previewTime:0,motionChoice:{value:'AvatarGlide'},motion:{matches:true},openness:1,scene:new THREE.Scene(),renderer:null,wingAnimator,avatarAnimator,describe:()=> 'Fox Angel',requestRender(){}});
 const factory=appearanceFactory(assets),remote=factory.create('red',{character:'rabbit',wing:'angel'});
 try{
  assert.equal(CURRENT_ANGEL_ASSET,'wings-angel-woodland-v5');assert.equal(revision(rig.root),'woodland-angel-v5');
  rig.update({phase:'playing',flight:true,gliding:true,dt:1/30,lateralSpeed:0,verticalSpeed:-2,reducedMotion:false});assert.equal(rig.root.visible,true);
  vm.runInContext(stripTypeScriptTypes(fn),context);await context.updatePreview();assert.equal(revision(context.avatar.root),'woodland-angel-v5');assert.equal(context.confirm.disabled,false);assert.match(context.feedback.textContent,/Preview ready/);
  await remote.ready;remote.pose(1,7.2,false,true,false);assert.equal(revision(remote.root),'woodland-angel-v5');assert.equal(remote.root.getObjectByName('WingSocket').children[0].visible,true);
  const angelReads=reads.filter(r=>r.url.includes('wings-angel'));assert.deepEqual(angelReads,[{url:'/game/models/appearance/wings-angel-woodland-v5.glb',hash:NEW}]);
  await rig.setStyle('dragon');await rig.setStyle('angel');assert.equal(revision(rig.root),'woodland-angel-v5');assert.equal(reads.filter(r=>r.url.includes('wings-angel')).length,1);
  remote.pose(2,0,true,false,false);assert.equal(remote.root.getObjectByName('WingSocket').children[0].visible,false);
  context.dialog.open=false;const prior=context.avatar;await context.updatePreview();assert.equal(context.avatar,prior,'closed menu cannot attach a late clone');
 }finally{rig.dispose();context.animation?.dispose();context.bodyAnimation?.dispose();context.avatar?.dispose();await factory.dispose();}
});

test('old/current shipping GLB identity, visible controls, codec and physical contracts remain exact',async()=>{
 assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/<b>HOLD SPACE<\/b> GLIDE \(AIRBORNE\)/);
 assert.equal(hash(data('wings-angel.glb')),OLD);assert.equal(hash(data('wings-angel-woodland-v5.glb')),NEW);
 for(let code=0;code<12;code++)assert.equal(appearanceCode(appearanceFromCode(code)),code);
 const a=await parse(data('wings-angel.glb')),b=await parse(data('wings-angel-woodland-v5.glb')),clips=g=>g.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.map(t=>[t.name,t.ValueTypeName,t.getInterpolation(),[...t.times],[...t.values]])}));assert.deepEqual(clips(b),clips(a));
 for(const name of ['Wings','WingLeft','WingRight'])for(const prop of ['position','quaternion','scale'])assert.deepEqual(b.scene.getObjectByName(name)[prop].toArray(),a.scene.getObjectByName(name)[prop].toArray());
 let triangles=0,meshes=0;const materials=new Set();b.scene.traverse(o=>{if(!o.isMesh)return;meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;materials.add(o.material);assert.equal(o.material.transparent,false);assert.equal(o.material.opacity,1);assert.ok(!Object.values(o.material).some(v=>v?.isTexture));});assert.equal(triangles,1124);assert.equal(meshes,6);assert.equal(materials.size,3);
});
