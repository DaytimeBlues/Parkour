import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {batchParakeetWings} from './parakeet-batching.ts';
import type {CharacterKind,WingStyle} from '../simulation/appearance.ts';
export type AppearanceModel={root:THREE.Object3D;animations:THREE.AnimationClip[];dispose:()=>void};
/** Templates own GPU resources; clones own transforms/mixers only. One application-lifetime cache. */
export class AppearanceAssets{
 private pending=new Map<string,Promise<GLTF>>();private disposed=false;
 private readonly base:string;private readonly loader:Pick<GLTFLoader,'loadAsync'>;private readonly options:{batchParakeet?:boolean};
 constructor(base:string,loader:Pick<GLTFLoader,'loadAsync'>=new GLTFLoader(),options:{batchParakeet?:boolean}={}){this.base=base;this.loader=loader;this.options=options;}
 private async model(name:string):Promise<AppearanceModel>{
  if(this.disposed)throw new Error('Appearance assets disposed');let task=this.pending.get(name);
  if(!task){task=this.loader.loadAsync(`${this.base}models/appearance/${name}.glb`).then(gltf=>{if(this.disposed){disposeTemplates([gltf]);throw new Error('Appearance assets disposed');}if(this.options.batchParakeet&&name==='wings-parakeet')batchParakeetWings(gltf);return gltf;});this.pending.set(name,task);task.catch(()=>{if(this.pending.get(name)===task)this.pending.delete(name);});}
  const gltf=await task;if(this.disposed)throw new Error('Appearance assets disposed');const root=clone(gltf.scene);let released=false;
  return{root,animations:gltf.animations,dispose(){if(released)return;released=true;root.removeFromParent();}};
 }
 async character(kind:CharacterKind){const model=await this.model(`avatar-${kind}`);if(!model.root.getObjectByName('WingSocket')||!model.animations.some(c=>c.name==='AvatarIdle')){model.dispose();throw new Error(`${kind}: avatar socket/rest animation missing`);}return model;}
 async wing(style:WingStyle){const model=await this.model(`wings-${style}`);if(!model.animations.some(clip=>clip.name==='WingOpen')){model.dispose();throw new Error(`${style}: WingOpen animation missing`);}return model;}
 async dispose(){if(this.disposed)return;this.disposed=true;const ready=await Promise.allSettled([...this.pending.values()]);disposeTemplates(ready.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));this.pending.clear();}
}
function disposeTemplates(templates:GLTF[]){const geometry=new Set<THREE.BufferGeometry>(),material=new Set<THREE.Material>(),texture=new Set<THREE.Texture>();for(const t of templates)t.scene.traverse(o=>{if(o instanceof THREE.Mesh){geometry.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:[o.material])){material.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)texture.add(value);}}});geometry.forEach(g=>g.dispose());material.forEach(m=>m.dispose());texture.forEach(t=>t.dispose());}
/** Samples the authored Blender deployment; no root motion or gameplay writes. */
export function wingAnimator(model:AppearanceModel){const clip=model.animations.find(c=>c.name==='WingOpen');if(!clip||clip.duration<=0)throw new Error('WingOpen animation invalid');const mixer=new THREE.AnimationMixer(model.root),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;
 return{setDeployment(value:number){action.time=Math.max(0,Math.min(1,Number.isFinite(value)?value:0))*clip.duration;mixer.update(0);},dispose(){mixer.stopAllAction();mixer.uncacheRoot(model.root);model.dispose();}};
}

/** Explicit authored rest/glide poses prevent saved Blender/NLA frame state leaking into previews. */
export function avatarAnimator(model:AppearanceModel){const mixer=new THREE.AnimationMixer(model.root);let current='';
 return{setGliding(gliding:boolean){const name=gliding?'AvatarGlide':'AvatarIdle';if(current===name)return;const clip=model.animations.find(c=>c.name===name);if(!clip)throw new Error(`${name} missing`);mixer.stopAllAction();const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;action.time=0;mixer.update(0);current=name;},dispose(){mixer.stopAllAction();mixer.uncacheRoot(model.root);model.dispose();}};
}
