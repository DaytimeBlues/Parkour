import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {batchRigidAvatar} from '../src/render/avatar-batching.ts';
import {AppearanceAssets} from '../src/render/appearance-assets.ts';
import {appearanceFactory} from '../src/multiplayer/remote-avatar.ts';
async function load(name){const b=readFileSync(new URL(name.startsWith('avatar-')?`./fixtures/appearance-v2/${name}.glb`:`../public/models/appearance/${name}.glb`,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
function meshes(root){const a=[];root.traverse(o=>{if(o.isMesh)a.push(o);});return a;}
function resources(root){return new Set(meshes(root).flatMap(m=>[m.geometry,m.material]));}
function dispose(g){resources(g.scene).forEach(r=>r.dispose());}
function geometry(root){return meshes(root).reduce((a,m)=>({draws:a.draws+1,triangles:a.triangles+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,vertices:a.vertices+m.geometry.attributes.position.count}),{draws:0,triangles:0,vertices:0});}
function surface(root){root.updateMatrixWorld(true);const points=[];for(const m of meshes(root)){const p=m.geometry.attributes.position,n=m.geometry.attributes.normal,color=m.geometry.attributes.color,index=m.geometry.index,nmat=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);for(let i=0;i<(index?.count??p.count);i++){const j=index?index.getX(i):i,v=new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(m.matrixWorld),normal=new THREE.Vector3().fromBufferAttribute(n,j).applyNormalMatrix(nmat),c=m.material.color.clone();if(m.material.vertexColors)c.multiply(new THREE.Color().setRGB(color.getX(j),color.getY(j),color.getZ(j)));points.push([...v.toArray(),...normal.toArray(),...c.toArray(),m.material.roughness,m.material.metalness,m.material.side,m.material.opacity,...m.material.emissive.toArray()]);}}const triangles=[];for(let i=0;i<points.length;i+=3)triangles.push(points.slice(i,i+3));const key=t=>t.flat().map(x=>Math.round(x*1e5));return triangles.sort((a,b)=>{const x=key(a),y=key(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}).flat();}
function sameSurface(a,b){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)for(let j=0;j<a[i].length;j++)assert.ok(Math.abs(a[i][j]-b[i][j])<2e-6,`vertex${i} component${j}: ${a[i][j]} != ${b[i][j]}`);}

test('rigid avatar batching preserves geometry, indexed vertices, shading and every animated pose',async()=>{
 for(const name of ['avatar-fox','avatar-rabbit']){
  const original=await load(name),derived=await load(name),before=geometry(original.scene),pivots=['Body','FrontLeft','FrontRight','BackLeft','BackRight','Tail','WingSocket'].map(n=>derived.scene.getObjectByName(n)),clips=derived.animations.map(c=>THREE.AnimationClip.toJSON(c));
  assert.equal(batchRigidAvatar(derived),true);const after=geometry(derived.scene);assert.equal(after.draws,name==='avatar-fox'?13:9);assert.equal(after.triangles,before.triangles);assert.equal(after.vertices,before.vertices);assert.equal(new Set(meshes(derived.scene).map(m=>m.material)).size,5);assert.deepEqual(derived.animations.map(c=>THREE.AnimationClip.toJSON(c)),clips);
  for(const p of pivots)assert.equal(derived.scene.getObjectByName(p.name),p);for(const m of meshes(derived.scene))assert.equal(m.geometry.groups.length,0);
  for(let clip=0;clip<3;clip++)for(const phase of [0,.25,.5,.75,1]){const mixers=[original,derived].map(g=>new THREE.AnimationMixer(g.scene));for(const[i,g]of [original,derived].entries()){const a=mixers[i].clipAction(g.animations[clip]);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();a.paused=true;a.time=phase*g.animations[clip].duration;mixers[i].update(0);}sameSurface(surface(original.scene),surface(derived.scene));mixers.forEach(m=>{m.stopAllAction();m.uncacheRoot(m.getRoot());});}
  assert.equal(batchRigidAvatar(derived),false);dispose(original);dispose(derived);
 }
});

test('unsupported changes retain the original hierarchy and resources atomically',async()=>{
 const cases=[g=>{g.scene.add(Object.assign(new THREE.Group(),{name:'FrontLeft'}));},g=>{g.animations[1].name=g.animations[0].name;},g=>{meshes(g.scene)[0].material.roughness=.11;},g=>{g.scene.getObjectByName('Avatar').userData.revision='future';},g=>{meshes(g.scene)[0].material.map=new THREE.Texture();},g=>{meshes(g.scene)[0].material.transparent=true;},g=>{meshes(g.scene)[0].material.vertexColors=true;},g=>{meshes(g.scene)[0].material.clippingPlanes=[];},g=>{meshes(g.scene)[0].material.onBeforeCompile=()=>{};},g=>{meshes(g.scene)[0].material.customProgramCacheKey=()=>'';},g=>{meshes(g.scene)[0].onBeforeRender=()=>{};},g=>{meshes(g.scene)[0].onAfterRender=()=>{};},g=>{meshes(g.scene)[0].scale.x=-1;},g=>{meshes(g.scene)[0].visible=false;},g=>{meshes(g.scene)[0].renderOrder=1;},g=>{meshes(g.scene)[0].castShadow=true;},g=>{meshes(g.scene)[0].geometry.attributes.position.setX(0,NaN);},g=>{meshes(g.scene)[0].geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(6),2));},g=>{g.animations[0].tracks[0].name=meshes(g.scene)[0].name+'.quaternion';},g=>{g.scene.getObjectByName('WingSocket').add(meshes(g.scene)[0]);}];
 for(const mutate of cases){const g=await load('avatar-rabbit');mutate(g);const before=meshes(g.scene),parents=before.map(m=>m.parent);let released=0;resources(g.scene).forEach(r=>r.addEventListener('dispose',()=>released++));assert.equal(batchRigidAvatar(g),false);assert.deepEqual(meshes(g.scene),before);assert.deepEqual(before.map(m=>m.parent),parents);assert.equal(released,0);dispose(g);}
 for(const wing of ['angel','devil','parakeet','elephant','glow','dragon']){const b=readFileSync(new URL(`../public/models/appearance/wings-${wing}.glb`,import.meta.url));const g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');assert.equal(batchRigidAvatar(g),false);dispose(g);}
});

test('overflow during preparation leaves original meshes and resources intact',async()=>{const g=await load('avatar-rabbit');meshes(g.scene)[0].position.x=1e100;const before=meshes(g.scene);let disposed=0;resources(g.scene).forEach(r=>r.addEventListener('dispose',()=>disposed++));assert.equal(batchRigidAvatar(g),false);assert.deepEqual(meshes(g.scene),before);assert.equal(disposed,0);dispose(g);});

test('cache opt-in derives once, preserves shared survivors, leaves solo unchanged and disposes exactly once',async()=>{
 for(const name of ['avatar-fox','avatar-rabbit']){let reads=0,original;const counts=new Map(),watch=r=>r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)??0)+1));const assets=new AppearanceAssets('/',{loadAsync:async()=>{reads++;const g=await load(name);original=resources(g.scene);original.forEach(watch);return g;}},{batchAvatars:true});
 const[a,b]=await Promise.all([assets.character(name.slice(7)),assets.character(name.slice(7))]);assert.equal(reads,1);const retained=resources(a.root);for(const r of retained){if(!original.has(r))watch(r);assert.equal(counts.get(r)??0,0);}for(const r of original)assert.equal(counts.get(r)??0,retained.has(r)?0:1);
 assert.equal(meshes(a.root)[0].geometry,meshes(b.root)[0].geometry);a.dispose();b.dispose();for(const r of retained)assert.equal(counts.get(r)??0,0);await assets.dispose();await assets.dispose();for(const r of new Set([...original,...retained]))assert.equal(counts.get(r),1);
 const solo=new AppearanceAssets('/',{loadAsync:()=>load(name)});const unbatched=await solo.character(name.slice(7));assert.equal(meshes(unbatched.root).length,name==='avatar-fox'?16:19);unbatched.dispose();await solo.dispose();}
});

test('legacy eight-avatar derivation remains bounded without losing triangles, sockets or crouch',async()=>{
 const assets=new AppearanceAssets('/',{loadAsync:url=>load(basename(url,'.glb'))},{batchParakeet:true,batchAvatars:true}),factory=appearanceFactory(assets);let maxDraws=0;
 try{for(const character of ['fox','rabbit'])for(const wing of ['angel','devil','parakeet','elephant','glow','dragon'])for(const team of ['red','blue']){const a=factory.create(team,{character,wing});await a.ready;assert.equal(a.root.userData.assetState,'ready');a.pose(.4,5,false,true,false);const cost=geometry(a.root);assert.equal(cost.draws,(character==='fox'?14:10)+(wing==='parakeet'?2:6));maxDraws=Math.max(maxDraws,cost.draws);assert.ok(cost.triangles<=4670);assert.ok(a.root.getObjectByName('WingSocket').getObjectByName('Wings'));a.pose(.8,4,true,false,true);const box=new THREE.Box3();a.root.updateMatrixWorld(true);a.root.children[0].traverseVisible(o=>{if(o.isMesh)box.union(new THREE.Box3().setFromObject(o,true));});assert.ok(box.max.y<=.85);assert.equal(a.root.getObjectByName('WingSocket').children[0].visible,false);a.dispose();}
 assert.equal(maxDraws*8,160);const roster=Array.from({length:8},()=>factory.create('red',{character:'fox',wing:'dragon'}));await Promise.all(roster.map(a=>a.ready));assert.equal(roster.reduce((sum,a)=>sum+geometry(a.root).draws,0),160);roster.forEach(a=>a.dispose());
 }finally{await factory.dispose();}
});

test('disposing during a pending avatar load never derives late data',async()=>{
 const g=await load('avatar-rabbit'),before=meshes(g.scene),counts=new Map();resources(g.scene).forEach(r=>r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)??0)+1)));let resolve;const assets=new AppearanceAssets('/',{loadAsync:()=>new Promise(r=>resolve=r)},{batchAvatars:true}),pending=assets.character('rabbit'),rejected=assert.rejects(pending,/disposed/),closing=assets.dispose();resolve(g);await rejected;await closing;assert.deepEqual(meshes(g.scene),before);assert.ok([...counts.values()].every(n=>n===1));
});
