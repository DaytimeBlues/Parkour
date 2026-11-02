import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
const dir=process.argv[2];const report=[];
for(const filename of fs.readdirSync(dir).filter(x=>x.endsWith('.glb'))){
 const bytes=fs.readFileSync(dir+'/'+filename);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 let meshes=0,triangles=0,vertices=0;const mats=new Set();gltf.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;vertices+=o.geometry.attributes.position.count;for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m.name);}});
 const anim=gltf.animations.map(a=>({name:a.name,duration:a.duration,tracks:a.tracks.length,finite:a.tracks.every(t=>[...t.times,...t.values].every(Number.isFinite))}));
 let bounds={};if(filename.startsWith('wings')){if(!gltf.scene.getObjectByName('Wings')||!gltf.scene.getObjectByName('WingLeft')||!gltf.scene.getObjectByName('WingRight'))throw Error('hierarchy');const clip=THREE.AnimationClip.findByName(gltf.animations,'WingOpen');if(!clip)throw Error('missing WingOpen');const mix=new THREE.AnimationMixer(gltf.scene);mix.clipAction(clip).play();mix.setTime(clip.duration-.000001);gltf.scene.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(gltf.scene,true);bounds.open={min:b.min.toArray(),max:b.max.toArray()};mix.setTime(0);gltf.scene.updateMatrixWorld(true);const f=new THREE.Box3().setFromObject(gltf.scene,true);bounds.folded={min:f.min.toArray(),max:f.max.toArray()};}else{const idle=THREE.AnimationClip.findByName(gltf.animations,'AvatarIdle');if(idle){const mix=new THREE.AnimationMixer(gltf.scene);mix.clipAction(idle).play();mix.setTime(0);gltf.scene.updateMatrixWorld(true);}const b=new THREE.Box3().setFromObject(gltf.scene,true);bounds={min:b.min.toArray(),max:b.max.toArray()};}
 report.push({filename,bytes:bytes.length,meshes,triangles,vertices,materials:[...mats],animations:anim,bounds});
}
console.log(JSON.stringify({loader:'Three '+THREE.REVISION+' GLTFLoader actual parse + animation sampling',assets:report},null,2));
