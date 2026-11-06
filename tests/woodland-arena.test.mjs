/** Structural scene/ownership tests, never a browser/GPU performance claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ARENA} from '../shared/multiplayer.mjs';
import {buildFortressArt,geometryBudget,GRAPHICS_BUDGET} from '../src/multiplayer/scene.ts';
import {woodlandArena,woodlandPreviewEnabled} from '../src/render/woodland-arena.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00002,`${a} != ${b}`);

test('woodland scene selection requires exact development-only ephemeral opt-in',()=>{
 for(const dev of [false,true])for(const value of ['','woodland','Woodland','woodland/'])assert.equal(woodlandPreviewEnabled(dev,`?visualPreview=${value}`),dev&&value==='woodland');
 assert.equal(woodlandPreviewEnabled(true,'?appearancePreview=woodland-face'),false);
});

test('woodland solids preserve every shared box, extent and orientation exactly once without simulation writes',()=>{
 const before=JSON.stringify(ARENA),art=woodlandArena(buildFortressArt()),batches=art.root.children.filter(o=>o.name==='collision-geometry'),seen=new Set();assert.equal(batches.length,1);
 const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 for(const mesh of batches)for(let i=0;i<mesh.count;i++){const id=mesh.userData.sourceIds[i],b=ARENA.boxes.find(x=>x.id===id);assert.ok(b);assert.equal(seen.has(id),false);seen.add(id);mesh.getMatrixAt(i,m);m.decompose(p,q,s);for(const[a,c]of[[p.x,b.x],[p.y,b.y],[p.z,b.z],[s.x,b.w],[s.y,b.h],[s.z,b.d]])near(a,c);near(q.w,1);near(q.x,0);near(q.y,0);near(q.z,0);assert.equal(mesh.userData.decorativeOnly,false);}
 assert.equal(seen.size,ARENA.boxes.length);assert.equal(JSON.stringify(ARENA),before);art.dispose();
});

test('woodland structural budget includes all instances and remains inside unchanged ceilings',()=>{
 const art=woodlandArena(buildFortressArt()),b=geometryBudget(art.root);assert.deepEqual([b.drawCalls,b.triangles,b.materials],[54,11671,33]);
 assert.ok(b.drawCalls<=GRAPHICS_BUDGET.staticDrawCalls&&b.triangles<=GRAPHICS_BUDGET.staticTriangles&&b.materials<=GRAPHICS_BUDGET.staticMaterials);
 assert.equal(art.root.getObjectByName('woodland-backdrop-trunks').count,16);assert.equal(art.root.getObjectByName('woodland-backdrop-crowns').count,48);assert.equal(art.root.getObjectByName('clouds').count,24);
 art.root.traverse(o=>{if(o.isMesh){for(const attr of Object.values(o.geometry.attributes))assert.ok(Array.from(attr.array).every(Number.isFinite));if(o.isInstancedMesh){assert.ok(Array.from(o.instanceMatrix.array).every(Number.isFinite));if(o.instanceColor)assert.ok(Array.from(o.instanceColor.array).every(Number.isFinite));}}});art.dispose();
});

test('all backdrop vegetation/islets are beyond arena bounds; floor inlays remain flat decoration',()=>{
 const art=woodlandArena(buildFortressArt()),matrix=new THREE.Matrix4(),box=new THREE.Box3();
 for(const name of ['woodland-backdrop-trunks','woodland-backdrop-branches','woodland-backdrop-crowns','woodland-backdrop-rocks']){const mesh=art.root.getObjectByName(name);assert.equal(mesh.userData.decorativeOnly,true);mesh.geometry.computeBoundingBox();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);assert.ok(box.max.x<ARENA.bounds.minX-4||box.min.x>ARENA.bounds.maxX+4||box.max.z<ARENA.bounds.minZ-4||box.min.z>ARENA.bounds.maxZ+4,`${name}/${i}`);}}
 const patches=art.root.getObjectByName('woodland-flat-moss-inlays');assert.equal(patches.material.polygonOffset,true);assert.ok(patches.material.polygonOffsetFactor<0&&patches.material.polygonOffsetUnits<0);
 const vertices=patches.geometry.attributes.position,index=patches.geometry.index.array,triangle=new THREE.Triangle(),closest=new THREE.Vector3();
 for(let i=0;i<patches.count;i++){patches.getMatrixAt(i,matrix);const pos=new THREE.Vector3().setFromMatrixPosition(matrix);near(pos.y,.004);
  for(let j=0;j<index.length;j+=3){triangle.a.fromBufferAttribute(vertices,index[j]).applyMatrix4(matrix);triangle.b.fromBufferAttribute(vertices,index[j+1]).applyMatrix4(matrix);triangle.c.fromBufferAttribute(vertices,index[j+2]).applyMatrix4(matrix);assert.ok(triangle.getArea()>0);
   for(const region of [...ARENA.zones,...ARENA.pads]){triangle.closestPointToPoint(new THREE.Vector3(region.x,.004,region.z),closest);assert.ok(Math.hypot(closest.x-region.x,closest.z-region.z)>region.radius+.5,`moss patch ${i} overlaps ${region.id}`);}
  }
 }
 art.dispose();
});

test('woodland keeps team ownership, zone identity, progress and neutral/reduced-motion semantics',()=>{
 const art=woodlandArena(buildFortressArt()),id=ARENA.zones[0].id;assert.equal(art.labels.length,13);assert.ok(art.labels.filter(x=>x.id.startsWith('spawn-')).every(x=>x.detail==='FOLLOW THE GREEN ROUTE'));
 art.update({zones:[{id,owner:'red',progress:2500,contested:true}]},.4,true);let z=art.zones.get(id);assert.equal(z.red.visible,true);assert.equal(z.blue.visible,false);assert.equal(z.arc.geometry.drawRange.count,33);near(z.fill.opacity,.2);
 art.update({zones:[{id,owner:'blue',progress:-1250,contested:false}]},.4,true);assert.equal(z.red.visible,false);assert.equal(z.blue.visible,true);assert.equal(z.arc.geometry.drawRange.count,17);art.dispose();
});

test('woodland owns new and inherited resources and disposes them exactly once even after repeated closure',()=>{
 const base=buildFortressArt(),resources=new Set(),counts=new Map();base.root.traverse(o=>{if(o.isMesh||o.isLine){resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);if(o.isInstancedMesh)resources.add(o);}});
 const watch=o=>{if(!counts.has(o)){counts.set(o,0);o.addEventListener('dispose',()=>counts.set(o,counts.get(o)+1));}};resources.forEach(watch);
 const art=woodlandArena(base);art.root.traverse(o=>{if(o.isMesh||o.isLine){resources.add(o.geometry);watch(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){resources.add(m);watch(m);}if(o.isInstancedMesh){resources.add(o);watch(o);}}});
 assert.throws(()=>woodlandArena(art),/already applied/);art.dispose();art.dispose();for(const resource of resources)assert.equal(counts.get(resource),1,resource.type??resource.name);assert.equal(art.root.children.length,0);
 const fresh=buildFortressArt();assert.deepEqual([geometryBudget(fresh.root).drawCalls,geometryBudget(fresh.root).triangles,geometryBudget(fresh.root).materials],[55,8193,38]);assert.ok(fresh.labels.filter(x=>x.id.startsWith('spawn-')).every(x=>x.detail==='FOLLOW THE GOLD ROUTE'));fresh.dispose();
});
