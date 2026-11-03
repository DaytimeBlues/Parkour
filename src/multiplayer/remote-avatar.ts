import * as THREE from 'three';
import {AppearanceAssets, wingAnimator, type AppearanceModel} from '../render/appearance-assets.ts';
import {validAppearance, type Appearance} from '../../shared/appearance.mjs';
import type {Team} from './client.ts';

export const REMOTE_AVATAR_BUDGET=Object.freeze({entries:32,templates:8,drawCallsPerAvatar:36,batchedDrawCallsPerAvatar:26,optimizedDrawCallsPerAvatar:20,trianglesPerAvatar:4670});

/** Cosmetic-only clones. Templates share resources; entries own transforms/mixers.
 * Structural cap: 32 entries, eight cached assets, <=36 raw draws; <=26 with wing batching, <=20 with accepted rigid-avatar batching.
 * Refined rigid characters cost <=4,670 triangles including their team marker.
 * This cap is NOT an FPS/school-device acceptance claim.
 */
export function appearanceFactory(assets:AppearanceAssets, onError:()=>void=()=>{}) {
  const entries=new Set<ReturnType<typeof create>>();
  const markerGeometry={red:new THREE.ConeGeometry(1,1,3),blue:new THREE.BoxGeometry(1,1,1)};
  const markerMaterial={red:new THREE.MeshLambertMaterial({color:0xef675d}),blue:new THREE.MeshLambertMaterial({color:0x50b8f5})};
  let disposed=false;
  function create(team:Team, value:unknown) {
    if(disposed||entries.size>=REMOTE_AVATAR_BUDGET.entries)throw new Error('Remote avatar capacity exceeded');
    const appearance:Appearance=validAppearance(value),root=new THREE.Group(),body=new THREE.Group();
    root.name=`remote-${appearance.character}-${appearance.wing}`;root.userData.appearance={...appearance};root.userData.assetState='loading';root.add(body);
    const badge=new THREE.Mesh(markerGeometry[team],markerMaterial[team]);badge.name=team==='red'?'triangle-team-marker':'square-team-marker';badge.position.y=2.3;badge.scale.set(.3,.3,.15);root.add(badge);
    let released=false,character:AppearanceModel|undefined,wing:AppearanceModel|undefined,mixer:THREE.AnimationMixer|undefined,wingAnimation:ReturnType<typeof wingAnimator>|undefined;
    let crouchScale=.35,priorClip='',poseState={time:0,speed:0,grounded:true,gliding:false,sliding:false};
    function pose(time:number,speed:number,grounded:boolean,gliding:boolean,sliding:boolean){
      poseState={time,speed,grounded,gliding,sliding};body.scale.y=sliding?crouchScale:1;badge.visible=!sliding;
      if(!character||!mixer||!wingAnimation||!wing)return;
      const name=gliding&&!sliding?'AvatarGlide':grounded&&speed>.1&&!sliding?'AvatarRun':'AvatarIdle';
      const clip=character.animations.find(c=>c.name===name)??character.animations.find(c=>c.name==='AvatarIdle')!;
      if(priorClip!==clip.name){mixer.stopAllAction();mixer.clipAction(clip).play();priorClip=clip.name;}
      const action=mixer.clipAction(clip);action.paused=true;action.time=clip.name==='AvatarRun'&&clip.duration>0?(time*Math.min(2,speed/5))%clip.duration:0;mixer.update(0);
      wing.root.visible=gliding&&!sliding;wingAnimation.setDeployment(gliding&&!sliding?1:0);
    }
    function dispose(){if(released)return;released=true;entries.delete(entry);mixer?.stopAllAction();if(character)mixer?.uncacheRoot(character.root);wingAnimation?.dispose();if(!wingAnimation)wing?.dispose();character?.dispose();root.removeFromParent();root.clear();}
    const entry={root,appearance,pose,dispose,ready:Promise.resolve()};entries.add(entry);
    entry.ready=(async()=>{
      // Sequential acquisition means a wing failure still releases the character.
      try{
        const loaded=await assets.character(appearance.character);if(released){loaded.dispose();return;}character=loaded;
        const wings=await assets.wing(appearance.wing);if(released){wings.dispose();return;}wing=wings;
        mixer=new THREE.AnimationMixer(character.root);const idle=character.animations.find(c=>c.name==='AvatarIdle')!;const action=mixer.clipAction(idle);action.play();action.paused=true;action.time=0;mixer.update(0);
        const bounds=new THREE.Box3().setFromObject(character.root,true);crouchScale=Math.min(1,.82/Math.max(.01,bounds.max.y));
        character.root.getObjectByName('WingSocket')!.add(wing.root);wingAnimation=wingAnimator(wing);body.add(character.root);root.userData.assetState='ready';
        pose(poseState.time,poseState.speed,poseState.grounded,poseState.gliding,poseState.sliding);
      }catch{if(released)return;mixer?.stopAllAction();if(character)mixer?.uncacheRoot(character.root);wingAnimation?.dispose();if(!wingAnimation)wing?.dispose();character?.dispose();character=undefined;wing=undefined;mixer=undefined;wingAnimation=undefined;root.userData.assetState='error';onError();}
    })();
    return entry;
  }
  return{create,get size(){return entries.size;},async dispose(){if(disposed)return;disposed=true;for(const entry of [...entries])entry.dispose();Object.values(markerGeometry).forEach(g=>g.dispose());Object.values(markerMaterial).forEach(m=>m.dispose());await assets.dispose();}};
}
