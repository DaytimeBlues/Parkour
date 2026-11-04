import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {batchParakeetWings} from './parakeet-batching.ts';
import {batchRigidAvatar} from './avatar-batching.ts';
import type {CharacterKind,WingStyle} from '../simulation/appearance.ts';
import {AvatarMotion,type AvatarMotionFrame,type AvatarClipName} from './avatar-motion.ts';
export type AppearanceModel={root:THREE.Object3D;animations:THREE.AnimationClip[];dispose:()=>void};
/** Templates own GPU resources; clones own transforms/mixers only. One application-lifetime cache. */
export class AppearanceAssets{
 private pending=new Map<string,Promise<GLTF>>();private disposed=false;
 private readonly base:string;private readonly loader:Pick<GLTFLoader,'loadAsync'>;private readonly options:{batchParakeet?:boolean;batchAvatars?:boolean};
 constructor(base:string,loader:Pick<GLTFLoader,'loadAsync'>=new GLTFLoader(),options:{batchParakeet?:boolean;batchAvatars?:boolean}={}){this.base=base;this.loader=loader;this.options=options;}
 private async model(name:string):Promise<AppearanceModel>{
  if(this.disposed)throw new Error('Appearance assets disposed');let task=this.pending.get(name);
  if(!task){task=this.loader.loadAsync(`${this.base}models/appearance/${name}.glb`).then(gltf=>{if(this.disposed){disposeTemplates([gltf]);throw new Error('Appearance assets disposed');}if(this.options.batchParakeet&&name==='wings-parakeet')batchParakeetWings(gltf);if(this.options.batchAvatars&&name.startsWith('avatar-'))batchRigidAvatar(gltf);return gltf;});this.pending.set(name,task);task.catch(()=>{if(this.pending.get(name)===task)this.pending.delete(name);});}
  const gltf=await task;if(this.disposed)throw new Error('Appearance assets disposed');const root=clone(gltf.scene);let released=false;
  return{root,animations:gltf.animations,dispose(){if(released)return;released=true;root.removeFromParent();}};
 }
 async character(kind:CharacterKind){const model=await this.model(`avatar-${kind}`);if(!model.root.getObjectByName('WingSocket')||!model.animations.some(c=>c.name==='AvatarIdle')){model.dispose();throw new Error(`${kind}: avatar socket/rest animation missing`);}return model;}
 async wing(style:WingStyle){const model=await this.model(`wings-${style}`);if(!model.animations.some(clip=>clip.name==='WingOpen')){model.dispose();throw new Error(`${style}: WingOpen animation missing`);}return model;}
 async dispose(){if(this.disposed)return;this.disposed=true;const ready=await Promise.allSettled([...this.pending.values()]);disposeTemplates(ready.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));this.pending.clear();}
}
function disposeTemplates(templates:GLTF[]){const geometry=new Set<THREE.BufferGeometry>(),material=new Set<THREE.Material>(),texture=new Set<THREE.Texture>();for(const t of templates)t.scene.traverse(o=>{if(o instanceof THREE.Mesh){geometry.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:[o.material])){material.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)texture.add(value);}}});geometry.forEach(g=>g.dispose());material.forEach(m=>m.dispose());texture.forEach(t=>t.dispose());}
/** Authored deployment and optional looping glide. No root motion/gameplay writes. */
export function wingAnimator(model:AppearanceModel){
 const clip=model.animations.find(c=>c.name==='WingOpen');if(!clip||clip.duration<=0)throw new Error('WingOpen animation invalid');
 let disposed=false;
 const mixer=new THREE.AnimationMixer(model.root),open=mixer.clipAction(clip),glideClip=model.animations.find(c=>c.name==='WingGlide'&&c.duration>0),glide=glideClip?mixer.clipAction(glideClip):undefined;
 for(const action of [open,glide])if(action){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;action.setEffectiveWeight(action===open?1:0);}
 function apply(value:number,time:number,flight:boolean,reducedMotion:boolean){
  if(disposed)return;
  const deployment=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
  const blend=flight&&!reducedMotion&&glide?Math.max(0,Math.min(1,(deployment-.85)/.15)):0;
  open.setEffectiveWeight(1-blend);open.time=deployment*clip!.duration;
  if(glide&&glideClip){glide.setEffectiveWeight(blend);glide.time=Number.isFinite(time)?((time%glideClip.duration)+glideClip.duration)%glideClip.duration:0;}
  mixer.update(0);
 }
 return{setDeployment(value:number){apply(value,0,false,true);},setFlight(value:number,time:number,reducedMotion=false){apply(value,time,true,reducedMotion);},dispose(){if(disposed)return;disposed=true;mixer.stopAllAction();mixer.uncacheRoot(model.root);model.dispose();}};
}

/** Deterministic authored clip sampling shared by previews and remote avatars. */
export function avatarAnimator(model:AppearanceModel){
 const mixer=new THREE.AnimationMixer(model.root),motion=new AvatarMotion();let current='',disposed=false;
 const find=(name:AvatarClipName)=>model.animations.find(c=>c.name===name)??model.animations.find(c=>c.name==='AvatarIdle');
 function apply(name:AvatarClipName,time:number){
  if(disposed)return;
  const clip=find(name);if(!clip)throw new Error('AvatarIdle missing');
  if(current!==clip.name){mixer.stopAllAction();const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;current=clip.name;}
  mixer.clipAction(clip).time=Math.max(0,Math.min(clip.duration,Number.isFinite(time)?time:0));mixer.update(0);
 }
 return{setGliding(gliding:boolean){apply(gliding?'AvatarGlide':'AvatarIdle',0);},preview(name:AvatarClipName,time:number,reducedMotion=false){const clip=find(name);const duration=clip?.duration??0,clock=Number.isFinite(time)?Math.max(0,time):0;const oneShot=name==='AvatarJump'||name==='AvatarLand',phase=reducedMotion||duration<=0?0:oneShot?Math.min(duration,clock%(duration+.7)):clock%duration;apply(name,phase);return{name,time:phase};},sample(frame:AvatarMotionFrame){const pose=motion.sample(frame,name=>find(name)?.duration??0);apply(pose.name,pose.time);return pose;},reset(){motion.reset();apply('AvatarIdle',0);},dispose(){if(disposed)return;disposed=true;mixer.stopAllAction();mixer.uncacheRoot(model.root);model.dispose();}};
}
