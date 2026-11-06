import * as THREE from 'three';
import {AppearanceAssets, wingAnimator, avatarAnimator, type AppearanceModel} from '../render/appearance-assets.ts';
import {validAppearance, type Appearance} from '../../shared/appearance.mjs';
import type {Team} from './client.ts';
import {createTeamGroundRings} from '../render/team-ground-ring.ts';

export const REMOTE_AVATAR_BUDGET=Object.freeze({entries:32,templates:8,drawCallsPerAvatar:36,batchedDrawCallsPerAvatar:26,optimizedDrawCallsPerAvatar:24,trianglesPerAvatar:5600});

/** Cosmetic-only clones. Templates share resources; entries own transforms/mixers.
 * Structural cap: 32 entries, eight cached assets, <=36 raw draws; <=26 with wing batching, <=24 with articulated woodland characters.
 * Articulated characters cost <=5,600 triangles including their team marker.
 * This cap is NOT an FPS/school-device acceptance claim.
 */
export function appearanceFactory(assets:AppearanceAssets, onError:()=>void=()=>{}) {
  const entries=new Set<ReturnType<typeof create>>();
  const teamRings=createTeamGroundRings();
  let disposed=false;
  function create(team:Team, value:unknown) {
    if(disposed||entries.size>=REMOTE_AVATAR_BUDGET.entries)throw new Error('Remote avatar capacity exceeded');
    const appearance:Appearance=validAppearance(value),root=new THREE.Group(),body=new THREE.Group();
    root.name=`remote-${appearance.character}-${appearance.wing}`;root.userData.appearance={...appearance};root.userData.assetState='loading';root.add(body);
    const badge=teamRings.create(team);root.add(badge);
    let released=false,character:AppearanceModel|undefined,wing:AppearanceModel|undefined,bodyAnimation:ReturnType<typeof avatarAnimator>|undefined,wingAnimation:ReturnType<typeof wingAnimator>|undefined;
    let posed=false,crouchScale=.35,poseState={time:0,speed:0,grounded:true,gliding:false,sliding:false,reducedMotion:false,paused:false};
    function pose(time:number,speed:number,grounded:boolean,gliding:boolean,sliding:boolean,reducedMotion=false,paused=false){
      poseState={time,speed,grounded,gliding,sliding,reducedMotion,paused};
      if(!character||!bodyAnimation||!wingAnimation||!wing)return;
      const sampled=bodyAnimation.sample(poseState);if(paused&&posed)return;
      posed=true;body.scale.y=sliding?crouchScale:1;root.userData.animation={...sampled};
      wing.root.visible=gliding&&!sliding;wingAnimation.setFlight(gliding&&!sliding?1:0,sampled.time,reducedMotion);
    }
    function dispose(){if(released)return;released=true;entries.delete(entry);bodyAnimation?.dispose();wingAnimation?.dispose();if(!wingAnimation)wing?.dispose();if(!bodyAnimation)character?.dispose();root.removeFromParent();root.clear();}
    const entry={root,appearance,pose,dispose,ready:Promise.resolve()};entries.add(entry);
    entry.ready=(async()=>{
      // Sequential acquisition means a wing failure still releases the character.
      try{
        const loaded=await assets.character(appearance.character);if(released){loaded.dispose();return;}character=loaded;
        const wings=await assets.wing(appearance.wing);if(released){wings.dispose();return;}wing=wings;
        bodyAnimation=avatarAnimator(character);bodyAnimation.setGliding(false);
        const bounds=new THREE.Box3().setFromObject(character.root,true);crouchScale=Math.min(1,.82/Math.max(.01,bounds.max.y));
        character.root.getObjectByName('WingSocket')!.add(wing.root);wingAnimation=wingAnimator(wing);body.add(character.root);root.userData.assetState='ready';
        pose(poseState.time,poseState.speed,poseState.grounded,poseState.gliding,poseState.sliding,poseState.reducedMotion,poseState.paused);
      }catch{if(released)return;bodyAnimation?.dispose();wingAnimation?.dispose();if(!wingAnimation)wing?.dispose();if(!bodyAnimation)character?.dispose();character=undefined;wing=undefined;bodyAnimation=undefined;wingAnimation=undefined;root.userData.assetState='error';onError();}
    })();
    return entry;
  }
  return{create,get size(){return entries.size;},async dispose(){if(disposed)return;disposed=true;for(const entry of [...entries])entry.dispose();teamRings.dispose();await assets.dispose();}};
}
