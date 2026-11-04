import * as THREE from 'three';
import {GliderPose,type GliderFrame} from './glider-pose.ts';
import {AppearanceAssets,wingAnimator} from './appearance-assets.ts';
import type {WingStyle} from '../simulation/appearance.ts';
/** Actual imported Blender wings frame the upper edges; movement/camera never change. */
export async function createWingView(camera:THREE.PerspectiveCamera,assets:AppearanceAssets,initial:WingStyle){
 const root=new THREE.Group();root.name='first-person-cosmetic-wings';let model=await assets.wing(initial),animation=wingAnimator(model),style=initial;model.root.scale.setScalar(.65);root.add(model.root);camera.add(root);const pose=new GliderPose();let disposed=false,generation=0,flightTime=0;
 function reset(){flightTime=0;pose.reset();root.visible=false;root.position.set(0,.85,-1.5);root.rotation.set(0,0,0);animation.setDeployment(0);}
 async function setStyle(next:WingStyle){const mine=++generation;if(disposed||next===style)return;const nextModel=await assets.wing(next);if(disposed||mine!==generation){nextModel.dispose();return;}const nextAnimation=wingAnimator(nextModel);animation.dispose();model=nextModel;animation=nextAnimation;style=next;model.root.scale.setScalar(.65);root.add(model.root);reset();}
 function update(frame:GliderFrame){if(!frame.flight||['ready','starting','finished'].includes(frame.phase))flightTime=0;pose.update(frame);root.visible=pose.visible;root.position.set(pose.sway,.85+pose.lift,-1.5);root.rotation.z=pose.bank;root.scale.x=Math.min(2,Math.max(.35,Number.isFinite(camera.aspect)?camera.aspect/1.65:1));if(frame.phase==='playing'&&!frame.reducedMotion&&pose.visible)flightTime+=Number.isFinite(frame.dt)?Math.max(0,Math.min(.1,frame.dt)):0;animation.setFlight(pose.deployment,flightTime,frame.reducedMotion);}
 reset();return{root,pose,reset,update,setStyle,dispose(){if(disposed)return;disposed=true;generation++;animation.dispose();root.removeFromParent();root.clear();}};
}
