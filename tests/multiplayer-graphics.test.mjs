import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {ARENA,createPlayer} from '../shared/multiplayer.mjs';
import {buildFortressArt,geometryBudget,GRAPHICS_BUDGET,ownerLabel,drawRadar} from '../src/multiplayer/scene.ts';
import {foxFactory} from '../src/multiplayer/avatar.ts';

const close=(a,b)=>assert.ok(Math.abs(a-b)<.00002,`${a} != ${b}`);
test('all fortress solid instances reproduce every authoritative box transform exactly once',()=>{
 const art=buildFortressArt(),found=new Set(),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
 for(const batch of art.root.children.filter(x=>x.name==='collision-geometry')){assert.ok(batch instanceof THREE.InstancedMesh);for(let i=0;i<batch.count;i++){const id=batch.userData.sourceIds[i];assert.equal(found.has(id),false);found.add(id);const source=ARENA.boxes.find(b=>b.id===id);assert.ok(source);batch.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);for(const [a,b] of[[position.x,source.x],[position.y,source.y],[position.z,source.z],[scale.x,source.w],[scale.y,source.h],[scale.z,source.d]])close(a,b);close(rotation.w,1);}}
 assert.equal(found.size,ARENA.boxes.length);assert.ok(art.root.children.filter(x=>x.name==='collision-geometry').length<=8);art.dispose();
});
test('static draw/triangle/material budgets include bounded instanced scenery, never an unbounded particle emitter',()=>{
 const art=buildFortressArt(),budget=geometryBudget(art.root);assert.ok(budget.drawCalls<=GRAPHICS_BUDGET.staticDrawCalls,JSON.stringify(budget));assert.ok(budget.triangles<=GRAPHICS_BUDGET.staticTriangles);assert.ok(budget.materials<=GRAPHICS_BUDGET.staticMaterials);const clouds=art.root.getObjectByName('clouds');assert.ok(clouds instanceof THREE.InstancedMesh);assert.equal(clouds.count,24);assert.equal(art.root.getObjectByName('updraft-rings').count,8);assert.ok(art.root.getObjectByName('flat-route-chevrons').count<=40);assert.equal(GRAPHICS_BUDGET.pixelRatio,1.5);assert.equal(art.labels.length,13);art.dispose();
});
test('zone circles depict exact capture radius; interior symbols identify zone separately from owner glyphs',()=>{
 const art=buildFortressArt();for(const z of ARENA.zones){const floor=art.root.getObjectByName(`zone-floor-${z.id}`),boundary=art.root.getObjectByName(`capture-boundary-${z.id}`);close(floor.position.x,z.x);close(floor.position.y,z.y+.035);close(floor.position.z,z.z);close(floor.scale.x,z.radius);close(floor.scale.z,z.radius);close(boundary.scale.x,z.radius);assert.ok(art.labels.find(l=>l.id===`zone-${z.id}`).title.includes(z.label));}
 art.update({zones:ARENA.zones.map((z,i)=>({id:z.id,owner:i%2?'blue':'red',progress:i%2?-2500:2500,contested:false}))},0,true);
 for(const[zid,z]of art.zones){const i=ARENA.zones.findIndex(d=>d.id===zid);assert.equal(z.red.visible,i%2===0);assert.equal(z.blue.visible,i%2!==0);assert.equal(z.arc.geometry.drawRange.count,33);assert.equal(z.red.geometry.type,'ShapeGeometry');assert.equal(z.blue.geometry.type,'PlaneGeometry');assert.equal(z.red.material.depthTest,true);assert.equal(z.blue.material.depthTest,true);}
 assert.equal(ownerLabel('red'),'▲ RED');assert.equal(ownerLabel('blue'),'■ BLUE');assert.equal(ownerLabel(null),'○ NEUTRAL');art.dispose();
});
test('contested pulse is subtle and stops under reduced motion; capture is bounded to authoritative progress',()=>{
 const art=buildFortressArt(),id=ARENA.zones[0].id,state={zones:[{id,owner:'red',progress:1250,contested:true}]};art.update(state,0,false);const z=art.zones.get(id),first=z.fill.opacity;art.update(state,.7,false);assert.notEqual(z.fill.opacity,first);assert.ok(z.fill.opacity>=.165&&z.fill.opacity<=.235);assert.equal(z.arc.geometry.drawRange.count,17);art.update(state,0,true);const fixed=z.fill.opacity;art.update(state,200,true);assert.equal(z.fill.opacity,fixed);art.dispose();
});
test('fox batches share assets, stay within seven draw meshes and crouch below tunnel clearance across poses',()=>{
 const factory=foxFactory(),red=factory.create('red'),blue=factory.create('blue'),r=geometryBudget(red.root),b=geometryBudget(blue.root);assert.equal(r.drawCalls,7);assert.equal(b.drawCalls,7);assert.ok(r.triangles<=GRAPHICS_BUDGET.foxTriangles);assert.equal(red.root.children[0].children[0].geometry,blue.root.children[0].children[0].geometry);assert.equal(red.root.children[2].geometry.parameters.radialSegments,3);assert.equal(blue.root.children[2].geometry.type,'BoxGeometry');
 for(let n=0;n<40;n++){red.pose(n*.17,7.2,true,false,true);red.root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(red.root.children[0]);assert.ok(bounds.max.y<.85,`height ${bounds.max.y}`);assert.ok(bounds.min.y>=-.02);assert.equal(red.root.children[2].visible,false);}
 red.pose(0,7,false,true,false);assert.equal(red.root.children[1].visible,true);assert.equal(red.root.children[1].material.side,THREE.DoubleSide);red.pose(0,7,false,false,false);assert.equal(red.root.children[1].visible,false);factory.dispose();
});
test('radar emits noncolour ownership labels and progress/contest feedback but no enemy-dependent draw output',()=>{
 const own={...createPlayer('red'),id:'own',nickname:'fox',active:true,connected:true},enemy={...createPlayer('blue'),id:'enemy',nickname:'hidden',active:true,connected:true};const room={players:[own],zones:ARENA.zones.map((z,i)=>({id:z.id,owner:i===0?'red':i===1?'blue':null,progress:i===0?1250:0,contested:i===1}))};
 const draw=room=>{const log=[],ctx=new Proxy({},{get(t,k){return k in t?t[k]:(...args)=>log.push([k,...args]);},set(t,k,v){t[k]=v;log.push([k,v]);return true;}});drawRadar({width:240,getContext:()=>ctx},room,own);return log;};const log=draw(room),texts=log.filter(x=>x[0]==='fillText').map(x=>x[1]);assert.ok(texts.includes('▲ RED ▲25%'));assert.ok(texts.includes('■ BLUE !'));assert.ok(texts.includes('○ NEUTRAL'));assert.deepEqual(log,draw({...room,players:[own,enemy]}));
});
test('scene disables heavy render features and keeps all label sprites depth-tested without per-runner names',()=>{
 const source=readFileSync(new URL('../src/multiplayer/scene.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/shadowMap\.enabled\s*=\s*true|EffectComposer|postprocessing|nickname/);assert.match(source,/depthTest:true,depthWrite:false/);assert.match(source,/prefers-reduced-motion/);assert.match(source,/Math\.min\(devicePixelRatio,GRAPHICS_BUDGET\.pixelRatio\)/);
});

test('neutral numerical ties have explicit paused feedback independent of owner-scoring contest state',async()=>{
 const {captureTied}=await import('../src/multiplayer/scene.ts');assert.equal(captureTied({owner:null,counts:{red:1,blue:1},contested:false}),true);assert.equal(captureTied({counts:{red:0,blue:0}}),false);assert.equal(captureTied({counts:{red:2,blue:1}}),false);const source=readFileSync(new URL('../src/multiplayer/scene.ts',import.meta.url),'utf8');assert.match(source,/TIED \/ PAUSED/);assert.match(source,/= TIED/);
});
