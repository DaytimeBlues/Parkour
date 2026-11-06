import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTeamGroundRings} from '../src/render/team-ground-ring.ts';

test('team rings have an outlined horizontal circle, a colour-independent glyph and one draw',()=>{
 const rings=createTeamGroundRings();
 try{for(const team of ['red','blue',null]){
  const marker=rings.create(team),g=marker.geometry;
  assert.equal(marker.userData.team,team);assert.equal(marker.userData.shape,team==='red'?'triangle':team==='blue'?'square':'circle');
  assert.equal(marker.position.y,.025);assert.equal(marker.material.depthTest,true);assert.equal(marker.material.depthWrite,true);assert.equal(marker.material.transparent,false);
  assert.equal(marker.material.vertexColors,true);assert.equal(g.groups.length,0);assert.ok(!Array.isArray(marker.material));
  const p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color;assert.equal(c.count,p.count);
  for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getY(i))<1e-6);assert.ok(n.getY(i)>.999);assert.ok(Number.isFinite(c.getX(i)));}
  assert.ok((g.index?.count??p.count)/3<=200);
  marker.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(.62,2,0),new THREE.Vector3(0,-1,0));assert.ok(ray.intersectObject(marker).length>0);
  assert.ok(g.boundingSphere.radius<1);
 }}finally{rings.dispose();}
});

test('ring resources are shared, identity colours differ and teardown releases each resource once',()=>{
 const rings=createTeamGroundRings(),a=rings.create('red'),b=rings.create('red'),blue=rings.create('blue'),neutral=rings.create(null);
 assert.equal(a.geometry,b.geometry);assert.equal(a.material,blue.material);assert.notDeepEqual([...a.geometry.attributes.color.array],[...blue.geometry.attributes.color.array]);
 const counts=new Map();for(const resource of [a.geometry,blue.geometry,neutral.geometry,a.material]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 a.removeFromParent();assert.ok([...counts.values()].every(v=>v===0));rings.dispose();rings.dispose();assert.ok([...counts.values()].every(v=>v===1));assert.throws(()=>rings.create('red'),/disposed/);
});

test('actual menu open/cleanup creates fresh preview resources and disposes them before each renderer',async()=>{
 const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module'),vm=await import('node:vm');
 const source=readFileSync(new URL('../src/appearance-menu.ts',import.meta.url),'utf8');
 const open=source.slice(source.indexOf(' function open(){'),source.indexOf(' function close(){'));
 const cleanup=source.slice(source.indexOf(' function cleanPreview(){'),source.indexOf(' async function updatePreview(){'));
 let released=0,renderers=0;const resources=new Set();
 class Renderer{constructor(){renderers++;this.domElement={};}setPixelRatio(){}setSize(){}dispose(){assert.equal(released,renderers*4,'all three geometries and material released before renderer');}forceContextLoss(){}}
 const context=vm.createContext({THREE:{...THREE,WebGLRenderer:Renderer},createTeamGroundRings(){const factory=createTeamGroundRings();for(const team of ['red','blue',null]){const mesh=factory.create(team);for(const resource of [mesh.geometry,mesh.material])if(!resources.has(resource)){resources.add(resource);resource.addEventListener('dispose',()=>released++);}}return factory;},
  teamRings:null,renderer:null,scene:null,camera:null,avatar:null,wings:null,animation:null,bodyAnimation:null,raf:0,last:0,generation:0,disposed:false,devicePixelRatio:1,previewTime:0,openness:0,
  selection:{begin(){}},setApplying(){},canOpen:()=>true,dialog:{open:false,showModal(){this.open=true;},querySelector(){return null;}},feedback:{},toggle:{},motionChoice:{},preview:{append(){},replaceChildren(){}},cancelAnimationFrame(){},updatePreview(){}});
 vm.runInContext(stripTypeScriptTypes(cleanup+open),context);
 for(let i=0;i<20;i++){
  context.open();assert.ok(context.scene.getObjectByName('neutral-team-marker'));context.cleanPreview();assert.equal(context.teamRings,null);assert.equal(context.scene,null);assert.equal(context.renderer,null);context.cleanPreview();context.dialog.open=false;
 }
 assert.equal(renderers,20);assert.equal(resources.size,80);assert.equal(released,80);
});
