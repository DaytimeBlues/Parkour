import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {AppearanceAssets,avatarAnimator} from '../src/render/appearance-assets.ts';

// Synthetic skinning/lifetime fixture, not a proposed animal or visual-quality proof.
function fixture({socket=true,extraMesh=false}={}){
 const scene=new THREE.Group(),bone=new THREE.Bone();bone.name='RootBone';scene.add(bone);
 if(socket){const socket=new THREE.Group();socket.name='WingSocket';bone.add(socket);}
 const geometry=new THREE.BoxGeometry(1,1,1),count=geometry.attributes.position.count;
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
 const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),material=new THREE.MeshStandardMaterial({map:texture}),skeleton=new THREE.Skeleton([bone]);
 const skin=new THREE.SkinnedMesh(geometry,material);skin.name='Skin';scene.add(skin);skin.bind(skeleton);
 if(extraMesh){const second=new THREE.SkinnedMesh(geometry,material);second.name='SkinExtra';scene.add(second);second.bind(skeleton);}
 return{scene,animations:[new THREE.AnimationClip('AvatarIdle',1,[new THREE.NumberKeyframeTrack('RootBone.position[x]',[0,1],[0,.5])])],skin,geometry,material,texture,skeleton};
}
function watch(resource){let count=0;resource.addEventListener('dispose',()=>count++);return()=>count;}

test('skinned clones retain independent bones and animation; removal releases only their bone textures',async()=>{
 const f=fixture(),assets=new AppearanceAssets('/',{loadAsync:async()=>f}),a=await assets.character('fox'),b=await assets.character('fox');
 const sa=a.root.getObjectByName('Skin').skeleton,sb=b.root.getObjectByName('Skin').skeleton;
 assert.notEqual(sa,sb);assert.notEqual(sa,f.skeleton);assert.notEqual(sa.bones[0],sb.bones[0]);assert.equal(a.root.getObjectByName('Skin').geometry,b.root.getObjectByName('Skin').geometry);
 sa.computeBoneTexture();sb.computeBoneTexture();const ad=watch(sa.boneTexture),bd=watch(sb.boneTexture),gd=watch(f.geometry),md=watch(f.material),td=watch(f.texture);
 const animation=avatarAnimator(a);animation.preview('AvatarIdle',.5,false);assert.ok(sa.bones[0].position.x>0);assert.equal(sb.bones[0].position.x,0);
 animation.dispose();a.dispose();assert.equal(ad(),1);assert.equal(sa.boneTexture,null);assert.equal(bd(),0);assert.ok(sb.boneTexture);assert.deepEqual([gd(),md(),td()],[0,0,0]);
 b.dispose();b.dispose();assert.equal(bd(),1);assert.equal(sb.boneTexture,null);assert.deepEqual([gd(),md(),td()],[0,0,0]);
 await assets.dispose();await assets.dispose();assert.deepEqual([gd(),md(),td()],[1,1,1]);
});

test('template skeletons shared by meshes dispose once and outlive independently disposed clones',async()=>{
 const f=fixture({extraMesh:true});f.skeleton.computeBoneTexture();const skeletonDisposed=watch(f.skeleton.boneTexture),assets=new AppearanceAssets('/',{loadAsync:async()=>f}),a=await assets.character('fox');
 const skins=[];a.root.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});assert.equal(skins.length,2);
 const counts=skins.map(s=>{s.skeleton.computeBoneTexture();return watch(s.skeleton.boneTexture);});
 a.dispose();assert.deepEqual(counts.map(f=>f()),[1,1]);assert.equal(skeletonDisposed(),0);
 await assets.dispose();await assets.dispose();assert.equal(skeletonDisposed(),1);assert.equal(f.skeleton.boneTexture,null);
});

test('fresh unrendered skins and rejected missing-socket assets clean up safely',async()=>{
 const f=fixture(),assets=new AppearanceAssets('/',{loadAsync:async()=>f}),a=await assets.character('fox');assert.equal(a.root.getObjectByName('Skin').skeleton.boneTexture,null);a.dispose();await assets.dispose();
 const invalid=fixture({socket:false});invalid.skeleton.computeBoneTexture();const released=watch(invalid.skeleton.boneTexture),bad=new AppearanceAssets('/',{loadAsync:async()=>invalid});await assert.rejects(bad.character('fox'),/socket/);await bad.dispose();assert.equal(released(),1);
});

test('late skinned template after cache disposal releases every template resource',async()=>{
 const f=fixture();f.skeleton.computeBoneTexture();const counts=[f.skeleton.boneTexture,f.geometry,f.material,f.texture].map(watch);let resolve;
 const assets=new AppearanceAssets('/',{loadAsync:()=>new Promise(r=>resolve=r)}),pending=assets.character('fox'),rejected=assert.rejects(pending,/disposed/),closing=assets.dispose();resolve(f);await rejected;await closing;assert.deepEqual(counts.map(f=>f()),[1,1,1,1]);
});

test('repeated skinned selection cycles release each clone texture while retaining one shared template',async()=>{
 const f=fixture();let loads=0,freed=0;const assets=new AppearanceAssets('/',{loadAsync:async()=>{loads++;return f;}}),shared=[f.geometry,f.material,f.texture].map(watch);
 for(let cycle=0;cycle<20;cycle++){
  const a=await assets.character('rabbit'),skin=a.root.getObjectByName('Skin');skin.skeleton.computeBoneTexture();skin.skeleton.boneTexture.addEventListener('dispose',()=>freed++);a.dispose();a.dispose();assert.equal(freed,cycle+1);assert.deepEqual(shared.map(f=>f()),[0,0,0]);
 }
 assert.equal(loads,1);await assets.dispose();assert.deepEqual(shared.map(f=>f()),[1,1,1]);
});
