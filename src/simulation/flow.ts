import RAPIER from '@dimforge/rapier3d-compat';
import {STEP,SPEED,JUMP,GRAVITY,HALF,RADIUS} from './physics.ts';
import {rampVertices,type FlowCourse,type FlowRamp} from './flow-course.ts';
import {tunnelBoxes} from './tunnel-course.ts';
export const LOW_HALF=.18,SLIDE_TICKS=36,SLIDE_SPEED=10.5,RAMP_SPEED=12,GLIDE_TICKS=144,GLIDE_GRAVITY=7,LAUNCH_VY=9;
export type FlowInput={forward:number;right:number;jump?:boolean;glide?:boolean;slide?:boolean};
/** Flow-only controller, used unchanged by browser and deterministic input tests. */
export class FlowRun{
 readonly course:FlowCourse;readonly world:RAPIER.World;readonly body:RAPIER.RigidBody;readonly collider:RAPIER.Collider;readonly controller:RAPIER.KinematicCharacterController;
 yaw=0;vy=0;grounded=false;checkpoint=0;falls=0;penalty=0;finished=false;coyote=0;jumpBuffer=0;low=false;slideRemaining=0;glideRemaining=0;launches=0;gliding=false;lastEvent='';
 private slideHeld=false;private slideDir={x:0,z:-1};private flightVelocity={x:0,z:0};private ramp:FlowRamp|null=null;private usedRamp:string|null=null;
 constructor(course:FlowCourse){this.course=course;this.lastEvent=this.introduction();this.world=new RAPIER.World({x:0,y:-GRAVITY,z:0});
  for(const p of course.platforms)this.world.createCollider(RAPIER.ColliderDesc.cuboid(p.w/2,.325,p.d/2).setTranslation(p.x,p.y-.325,p.z));
  for(const r of course.ramps){const shape=RAPIER.ColliderDesc.convexHull(rampVertices(r));if(!shape)throw Error('Invalid ramp hull');this.world.createCollider(shape.setTranslation(r.x,r.y,r.z));}
  for(const a of course.arches){this.world.createCollider(RAPIER.ColliderDesc.cuboid(a.w/2+.2,.3,a.d/2).setTranslation(a.x,a.y+a.clearance+.3,a.z));for(const side of [-1,1])this.world.createCollider(RAPIER.ColliderDesc.cuboid(.2,a.clearance/2,a.d/2).setTranslation(a.x+side*(a.w/2+.2),a.y+a.clearance/2,a.z));}
  for(const t of course.tunnels??[])for(const b of tunnelBoxes(t))this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.w/2,b.h/2,b.d/2).setTranslation(b.x,b.y,b.z));
  this.body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,1.5,2));this.collider=this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF,RADIUS),this.body);this.controller=this.world.createCharacterController(.03);this.controller.setMaxSlopeClimbAngle(Math.PI/4);this.controller.setMinSlopeSlideAngle(Math.PI/3);this.world.step();
 }
 private introduction(){return this.course.tunnels?.length?'Choose gold stairs, or C at the chevrons: duck through the service tunnel to the fast ramp.':'Choose the gold stairs, or C-slide through the arch to the cyan ramp.';}
 get position(){return this.body.translation();}get eye(){return this.low?.32:.65;}get half(){return this.low?LOW_HALF:HALF;}
 direction(input:FlowInput){let f=input.forward,r=input.right,n=Math.hypot(f,r);if(n){f/=n;r/=n;}return {x:Math.cos(this.yaw)*r-Math.sin(this.yaw)*f,z:-Math.sin(this.yaw)*r-Math.cos(this.yaw)*f};}
 private posture(low:boolean){if(low===this.low)return true;const p=this.position,dy=(low?LOW_HALF:HALF)-this.half,next={x:p.x,y:p.y+dy,z:p.z};if(!low&&this.world.intersectionWithShape(next,{x:0,y:0,z:0,w:1},new RAPIER.Capsule(HALF,RADIUS),RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,this.collider,this.body)){this.lastEvent='LOW CEILING · stay low until clear';return false;}this.collider.setHalfHeight(low?LOW_HALF:HALF);this.body.setTranslation(next,true);this.body.setNextKinematicTranslation(next);this.low=low;return true;}
 pause(){this.slideHeld=false;this.jumpBuffer=0;/* Budgets freeze because step is not called. No forced stand or synthetic jump. */}
 private place(x:number,y:number,z:number){this.collider.setHalfHeight(HALF);this.low=false;this.body.setTranslation({x,y,z},true);this.body.setNextKinematicTranslation({x,y,z});this.vy=0;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.slideRemaining=0;this.glideRemaining=0;this.gliding=false;this.flightVelocity={x:0,z:0};this.ramp=null;this.usedRamp=null;this.slideHeld=false;this.yaw=0;this.world.step();}
 reset(){this.checkpoint=0;this.falls=0;this.penalty=0;this.finished=false;this.launches=0;this.lastEvent=this.introduction();this.place(0,1.5,2);}
 respawn(){const p=this.course.platforms.find(p=>p.checkpoint===this.checkpoint)??this.course.platforms[0];this.falls++;this.penalty+=3;this.place(p.x,p.y+1.5,p.z+2);this.lastEvent='Checkpoint restored · +3 seconds. Coins stay collected.';}
 step(input:FlowInput){if(this.finished)return;
  const moving=!!(input.forward||input.right),d=this.direction(input),slidePress=!!input.slide&&!this.slideHeld;this.slideHeld=!!input.slide;
  if(slidePress&&this.grounded&&moving&&!this.glideRemaining&&this.slideRemaining===0){this.slideRemaining=SLIDE_TICKS;this.slideDir=d;this.lastEvent='SLIDE · release C to stand when clear';}
  this.posture(!!input.slide||this.slideRemaining>0);
  if(input.jump)this.jumpBuffer=.14;this.coyote=this.grounded?.12:Math.max(0,this.coyote-STEP);this.jumpBuffer=Math.max(0,this.jumpBuffer-STEP);
  if(this.jumpBuffer>0&&this.coyote>0&&!this.low&&!this.ramp){this.vy=JUMP;this.jumpBuffer=0;this.coyote=0;this.grounded=false;}
  const prior=this.position;let speed=this.low?3.8:SPEED,dx=d.x*speed,dz=d.z*speed;
  if(this.slideRemaining>0){dx=this.slideDir.x*SLIDE_SPEED;dz=this.slideDir.z*SLIDE_SPEED;this.slideRemaining--;}
  const onRamp=this.course.ramps.find(r=>r.checkpoint===this.checkpoint&&Math.abs(prior.x-r.x)<r.w/2-RADIUS*.3&&prior.z<=r.z+r.d/2+.15&&prior.z>=r.z-r.d/2-.2&&Math.abs(prior.y-this.half-RADIUS-(r.y+(r.z+r.d/2-prior.z)/r.d*r.rise))<.3);
  if(onRamp&&this.grounded&&dz<-.1&&onRamp.id!==this.usedRamp&&(this.ramp===onRamp||prior.z>onRamp.z)){this.ramp=onRamp;dx=d.x*4;dz=-RAMP_SPEED;this.lastEvent='RAMP BOOST · hold SPACE after takeoff to glide';}
  if(this.ramp&&!this.glideRemaining){const r=this.ramp;if(this.grounded&&dz<-.1&&onRamp===r&&prior.z<=r.z-r.d/2+.45&&Math.abs(prior.x-r.x)<r.w/2){this.vy=LAUNCH_VY;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.glideRemaining=GLIDE_TICKS;this.flightVelocity={x:0,z:-RAMP_SPEED};this.usedRamp=r.id;this.launches++;this.ramp=null;this.slideRemaining=0;this.lastEvent='AIRBORNE · hold SPACE to glide; WASD / ARROWS steer; release SPACE to dive';}else if(!onRamp&&!this.grounded){this.ramp=null;}}
  this.gliding=this.glideRemaining>0&&!!input.glide&&!this.grounded;
  if(this.glideRemaining>0){this.glideRemaining--;const target=moving?{x:d.x*RAMP_SPEED,z:d.z*RAMP_SPEED}:this.flightVelocity;const turn=this.gliding?5:2;this.flightVelocity.x+=(target.x-this.flightVelocity.x)*turn*STEP;this.flightVelocity.z+=(target.z-this.flightVelocity.z)*turn*STEP;dx=this.flightVelocity.x;dz=this.flightVelocity.z;}
  this.vy-=(this.gliding?GLIDE_GRAVITY:GRAVITY)*STEP;
  this.controller.computeColliderMovement(this.collider,{x:dx*STEP,y:this.vy*STEP,z:dz*STEP});const m=this.controller.computedMovement(),p=this.position;this.body.setNextKinematicTranslation({x:p.x+m.x,y:p.y+m.y,z:p.z+m.z});this.grounded=this.controller.computedGrounded();if(this.grounded&&this.vy<0){this.vy=0;if(this.glideRemaining||this.gliding){this.glideRemaining=0;this.gliding=false;this.flightVelocity={x:0,z:0};this.lastEvent='LANDED · choose your next route';}}else if(m.y<this.vy*STEP-.01&&this.vy>0)this.vy=0;this.world.step();
  const q=this.position;
  for(const p of this.course.platforms)if(this.grounded&&Math.abs(q.x-p.x)<p.w/2-.2&&Math.abs(q.z-p.z)<p.d/2-.2&&Math.abs(q.y-(p.y+this.half+RADIUS+.03))<.2){if(!this.glideRemaining&&!this.ramp)this.usedRamp=null;if(p.checkpoint===this.checkpoint+1){this.checkpoint=p.checkpoint;this.usedRamp=null;this.lastEvent=`CHECKPOINT ${this.checkpoint} · stairs and ramps both count`;}if(p.goal&&this.checkpoint===4){this.finished=true;this.glideRemaining=0;this.slideRemaining=0;this.lastEvent='Flow course complete.';}}
  const cp=this.course.platforms.find(p=>p.checkpoint===this.checkpoint)??this.course.platforms[0];if(q.y<cp.y-10)this.respawn();
 }
 label(){return this.gliding?`GLIDE ${Math.ceil(this.glideRemaining/60)}s · WASD / ARROWS STEER`:this.glideRemaining?'HOLD SPACE TO GLIDE':this.slideRemaining?'SLIDING':this.low?'CROUCHED · RELEASE C TO STAND':'C SLIDE · RAMPS LAUNCH · HOLD SPACE GLIDE';}
 dispose(){this.world.free();}
}
