import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {batchParakeetWings} from '../src/render/parakeet-batching.ts';
import {AppearanceAssets} from '../src/render/appearance-assets.ts';
import {appearanceFactory} from '../src/multiplayer/remote-avatar.ts';
import {geometryBudget} from '../src/multiplayer/scene.ts';
async function load(name='wings-parakeet'){const b=readFileSync(new URL(`../public/models/appearance/${name}.glb`,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
function meshes(root){const a=[];root.traverse(o=>{if(o.isMesh)a.push(o);});return a;}
function surface(root){root.updateMatrixWorld(true);const result=[];for(const m of meshes(root)){const p=m.geometry.getAttribute('position'),normal=m.geometry.getAttribute('normal'),color=m.geometry.getAttribute('color'),index=m.geometry.index;const nmat=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);for(let i=0;i<(index?.count??p.count);i++){const j=index?index.getX(i):i;const v=new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(m.matrixWorld),n=new THREE.Vector3().fromBufferAttribute(normal,j).applyNormalMatrix(nmat);const c=m.material.color.clone();if(m.material.vertexColors)c.multiply(new THREE.Color().setRGB(color.getX(j),color.getY(j),color.getZ(j)));result.push([...v.toArray(),...n.toArray(),...c.toArray()]);}}return result;}
function sameSurface(a,b){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)for(let j=0;j<9;j++)assert.ok(Math.abs(a[i][j]-b[i][j])<2e-6,`vertex${i} component${j}: ${a[i][j]} != ${b[i][j]}`);}
function dispose(g){const geo=new Set(),mat=new Set();for(const m of meshes(g.scene)){geo.add(m.geometry);mat.add(m.material);}geo.forEach(g=>g.dispose());mat.forEach(m=>m.dispose());}

test('parakeet-only batching preserves every ordered triangle, normal, linear colour and animated pivot across all authored clips',async()=>{
 const original=await load(),derived=await load(),pivots=['WingLeft','WingRight'].map(n=>derived.scene.getObjectByName(n)),clips=derived.animations.map(c=>THREE.AnimationClip.toJSON(c));
 const before=geometryBudget(original.scene);assert.equal(before.drawCalls,16);assert.equal(batchParakeetWings(derived),true);assert.equal(geometryBudget(derived.scene).drawCalls,2);assert.equal(geometryBudget(derived.scene).triangles,before.triangles);assert.deepEqual(derived.animations.map(c=>THREE.AnimationClip.toJSON(c)),clips);
 for(const [i,name]of ['WingLeft','WingRight'].entries()){assert.equal(derived.scene.getObjectByName(name),pivots[i]);assert.equal(pivots[i].children.length,1);assert.equal(pivots[i].children[0].geometry.groups.length,0);}
 for(const m of meshes(derived.scene)){assert.ok(m.material.vertexColors);assert.deepEqual(m.material.color.toArray(),[1,1,1]);assert.equal(m.material.side,THREE.DoubleSide);assert.equal(m.material.transparent,false);assert.equal(m.material.depthWrite,true);assert.equal(m.material.roughness,meshes(original.scene)[0].material.roughness);assert.equal(m.material.metalness,0);}
 for(let clip=0;clip<original.animations.length;clip++)for(const phase of [0,.25,.5,.75,1]){const mixers=[original,derived].map(g=>new THREE.AnimationMixer(g.scene));for(const[i,g]of [original,derived].entries()){const a=mixers[i].clipAction(g.animations[clip]);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();a.paused=true;a.time=phase*g.animations[clip].duration;mixers[i].update(0);}sameSurface(surface(original.scene),surface(derived.scene));mixers.forEach(m=>{m.stopAllAction();m.uncacheRoot(m.getRoot());});}
 assert.equal(batchParakeetWings(derived),false);dispose(original);dispose(derived);
});

test('unsupported material/geometry/animation/rig changes fall back atomically without disposing or replacing original assets',async()=>{
 const cases=[g=>{meshes(g.scene)[1].material.clippingPlanes=[new THREE.Plane(new THREE.Vector3(1,0,0),0)];},g=>{meshes(g.scene)[1].material.onBeforeCompile=()=>{};},g=>{meshes(g.scene)[1].material.customProgramCacheKey=()=>"custom";},g=>{meshes(g.scene)[1].onBeforeRender=()=>{};},g=>{meshes(g.scene)[1].onAfterRender=()=>{};},g=>{meshes(g.scene)[9].material.roughness=.1;},g=>{meshes(g.scene)[0].material.map=new THREE.Texture();},g=>{meshes(g.scene)[0].material.vertexColors=true;},g=>{meshes(g.scene)[0].material.transparent=true;},g=>{meshes(g.scene)[0].geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(meshes(g.scene)[0].geometry.getAttribute('position').count*2),2));},g=>{meshes(g.scene)[0].scale.x=-1;},g=>{meshes(g.scene)[0].visible=false;},g=>{g.animations[0].tracks[0].name='WingLeft_Feather_0.quaternion';},g=>{g.scene.getObjectByName('WingRight').remove(meshes(g.scene).at(-1));},g=>{g.scene.getObjectByName('Wings').userData.style='glow';}];
 for(const change of cases){const g=await load();change(g);const before=meshes(g.scene),parents=before.map(m=>m.parent),clips=g.animations.map(c=>THREE.AnimationClip.toJSON(c));let releases=0;const resources=new Set(before.flatMap(m=>[m.geometry,m.material]));resources.forEach(r=>r.addEventListener('dispose',()=>releases++));assert.equal(batchParakeetWings(g),false);assert.deepEqual(meshes(g.scene),before);assert.deepEqual(before.map(m=>m.parent),parents);assert.deepEqual(g.animations.map(c=>THREE.AnimationClip.toJSON(c)),clips);assert.equal(releases,0);dispose(g);}
 for(const name of ['avatar-fox','avatar-rabbit','wings-glow','wings-angel','wings-devil','wings-dragon','wings-elephant']){const g=await load(name);assert.equal(batchParakeetWings(g),false);dispose(g);}
});

test('multiplayer opt-in derives once before clones, solo stays original, and all replaced/derived resources dispose once',async()=>{
 let reads=0,g,oldResources;const counts=new Map();const loader={loadAsync:async()=>{reads++;g=await load();oldResources=new Set(meshes(g.scene).flatMap(m=>[m.geometry,m.material]));oldResources.forEach(r=>r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)??0)+1)));return g;}};
 const assets=new AppearanceAssets('/',loader,{batchParakeet:true});const[a,b]=await Promise.all([assets.wing('parakeet'),assets.wing('parakeet')]);assert.equal(reads,1);assert.equal(meshes(a.root).length,2);assert.notEqual(meshes(a.root)[0],meshes(b.root)[0]);assert.equal(meshes(a.root)[0].geometry,meshes(b.root)[0].geometry);assert.equal(meshes(a.root)[0].material,meshes(b.root)[0].material);
 const derived=new Set(meshes(a.root).flatMap(m=>[m.geometry,m.material]));assert.equal(derived.size,3);derived.forEach(r=>r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)??0)+1)));a.dispose();b.dispose();assert.ok([...oldResources].every(r=>counts.get(r)===1));assert.ok([...derived].every(r=>!counts.has(r)));await assets.dispose();await assets.dispose();assert.ok([...oldResources,...derived].every(r=>counts.get(r)===1));
 const solo=new AppearanceAssets('/',{loadAsync:()=>load()});const original=await solo.wing('parakeet');assert.equal(meshes(original.root).length,16);original.dispose();await solo.dispose();
});

test('actual opt-in avatars preserve sockets/deployment/crouch and reduce roster structural ceiling without changing triangles',async()=>{
 const assets=new AppearanceAssets('/',{loadAsync:url=>load(basename(url,'.glb'))},{batchParakeet:true}),factory=appearanceFactory(assets);
 try{for(const character of ['fox','rabbit'])for(const wing of ['angel','devil','parakeet','elephant','glow','dragon']){const a=factory.create('red',{character,wing});await a.ready;assert.equal(a.root.userData.assetState,'ready');assert.ok(a.root.getObjectByName('WingSocket').getObjectByName('Wings'));a.pose(1,5,false,true,false);const b=geometryBudget(a.root);assert.equal(b.drawCalls,(character==='fox'?16:15)+(wing==='parakeet'?2:4));assert.ok(b.triangles<=1468);a.pose(1,4,true,false,true);const box=new THREE.Box3();a.root.updateMatrixWorld(true);a.root.children[0].traverseVisible(o=>{if(o.isMesh)box.union(new THREE.Box3().setFromObject(o,true));});assert.ok(box.max.y<=.85);assert.equal(a.root.getObjectByName('WingSocket').children[0].visible,false);a.pose(0,0,false,true,false);assert.equal(a.root.getObjectByName('WingSocket').children[0].visible,true);a.dispose();}
 const roster=Array.from({length:32},()=>factory.create('red',{character:'fox',wing:'parakeet'}));await Promise.all(roster.map(a=>a.ready));let calls=0;for(const a of roster){a.pose(1,4,false,true,false);calls+=geometryBudget(a.root).drawCalls;}assert.equal(calls,576);for(const a of roster)a.dispose();
 }finally{await factory.dispose();}
});

test('disposal while opt-in template is loading releases originals once and never derives or mounts late meshes',async()=>{
 let release;const loaded=await load(),original=meshes(loaded.scene),resources=new Set(original.flatMap(m=>[m.geometry,m.material])),counts=new Map();resources.forEach(r=>r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)??0)+1)));
 const assets=new AppearanceAssets('/',{loadAsync:()=>new Promise(resolve=>release=resolve)},{batchParakeet:true});const task=assets.wing('parakeet'),rejected=assert.rejects(task,/disposed/);const closing=assets.dispose();release(loaded);await rejected;await closing;await assets.dispose();assert.deepEqual(meshes(loaded.scene),original);assert.ok([...resources].every(r=>counts.get(r)===1));
});
