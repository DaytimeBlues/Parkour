import RAPIER from '@dimforge/rapier3d-compat';
import { STEP, SPEED, JUMP, GRAVITY, HALF, RADIUS } from './physics.ts';
import { puzzlePlatforms, puzzlePortals, puzzleRelays, type Vec3, type Portal } from './puzzle-course.ts';
export const CHARGE_TICKS=39, CHARGE_MIN_BURST=6, CHARGE_MAX_BURST=21, CHARGE_SPEED=14.4;
export type Flat={x:number;z:number};
/** New-course-only hold/release mechanic. The original four courses keep their tap boost. */
export class ChargeBoost {
 state:'ready'|'charging'|'burst'|'cooldown'='ready';ticks=0;remaining=0;cooldown=0;groundTicks=0;direction:Flat={x:0,z:-1};
 private aliases=new Set<string>();
 press(code:string,grounded:boolean,repeat=false){if(repeat||this.aliases.has(code))return;const first=this.aliases.size===0;this.aliases.add(code);if(first&&grounded&&this.state==='ready'){this.state='charging';this.ticks=0;}}
 release(code:string,direction:Flat){if(!this.aliases.delete(code)||this.aliases.size)return false;if(this.state!=='charging')return false;const n=Math.hypot(direction.x,direction.z);if(!Number.isFinite(n)||n<1e-8){this.cancelHold();return false;}this.direction={x:direction.x/n,z:direction.z/n};this.remaining=Math.round(CHARGE_MIN_BURST+(CHARGE_MAX_BURST-CHARGE_MIN_BURST)*this.ticks/CHARGE_TICKS);this.state='burst';this.cooldown=48;this.groundTicks=0;return true;}
 cancelHold(){this.aliases.clear();if(this.state==='charging'){this.state='ready';this.ticks=0;}}
 reset(){this.cancelHold();this.state='ready';this.ticks=0;this.remaining=0;this.cooldown=0;this.groundTicks=0;this.direction={x:0,z:-1};}
 step():Flat|null {if(this.state==='charging')this.ticks=Math.min(CHARGE_TICKS,this.ticks+1);if(this.cooldown>0)this.cooldown--;if(this.state==='burst'&&this.remaining>0){this.remaining--;return {...this.direction};}if(this.state==='burst')this.state='cooldown';return null;}
 finishStep(grounded:boolean){if(this.state==='cooldown'&&grounded)this.groundTicks++;else this.groundTicks=0;if(this.state==='cooldown'&&!this.cooldown&&this.groundTicks>=6){this.state='ready';this.ticks=0;}}
 rotate(angle:number){this.direction=rotateFlat(this.direction,angle);}
 label(grounded:boolean){return this.state==='charging'?`CHARGE ${Math.round(100*this.ticks/CHARGE_TICKS)}% · RELEASE`:this.state==='burst'?'CHARGED BOOST':this.state==='ready'?(grounded?'HOLD SHIFT / E TO CHARGE':'LAND TO CHARGE'):this.cooldown?'BOOST COOLING':'LAND TO RECHARGE';}
}
export function rotateFlat(v:Flat,a:number):Flat {return {x:Math.cos(a)*v.x-Math.sin(a)*v.z,z:Math.sin(a)*v.x+Math.cos(a)*v.z};}
export function portalAngle(p:Portal){return Math.atan2(p.exitNormal.z,p.exitNormal.x)-Math.atan2(-p.entryNormal.z,-p.entryNormal.x);}
/** Swept front-to-back crossing; centre must fit the capsule within the aperture. */
export function portalCrossing(p:Portal,from:Vec3,to:Vec3):boolean {
 const a=(from.x-p.entry.x)*p.entryNormal.x+(from.z-p.entry.z)*p.entryNormal.z;
 const b=(to.x-p.entry.x)*p.entryNormal.x+(to.z-p.entry.z)*p.entryNormal.z;
 if(a<=0||b>0||a===b)return false;
 const t=a/(a-b),x=from.x+(to.x-from.x)*t-p.entry.x,z=from.z+(to.z-from.z)*t-p.entry.z,y=from.y+(to.y-from.y)*t-p.entry.y;
 return Math.abs(-x*p.entryNormal.z+z*p.entryNormal.x)<=p.width/2-RADIUS&&y>=HALF+RADIUS-.08&&y<=p.height-HALF-RADIUS;
}
export type PuzzleInput={forward:number;right:number;jump?:boolean};
/** Shared browser/simulation controller: tests supply ordinary movement inputs, not teleports. */
export class PuzzleRun {
 readonly world:RAPIER.World;readonly body:RAPIER.RigidBody;readonly collider:RAPIER.Collider;readonly controller:RAPIER.KinematicCharacterController;
 private gates=new Map<number,RAPIER.Collider>();readonly boost=new ChargeBoost();relays=new Set<number>();checkpoint=0;falls=0;penalty=0;finished=false;yaw=0;grounded=false;vy=0;coyote=0;jumpBuffer=0;portalGuard=0;portalCount=0;lastEvent='Follow the gold arrows. The left stairs are the safe route.';
 constructor(){this.world=new RAPIER.World({x:0,y:-GRAVITY,z:0});for(const p of puzzlePlatforms)this.world.createCollider(RAPIER.ColliderDesc.cuboid(p.w/2,.325,p.d/2).setTranslation(p.x,p.y-.325,p.z));this.body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,1.5,2));this.collider=this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF,RADIUS),this.body);this.controller=this.world.createCharacterController(.03);this.controller.setMaxSlopeClimbAngle(Math.PI/4);this.controller.setMinSlopeSlideAngle(Math.PI/3);this.resetGates();this.world.step();}
 private resetGates(){for(const gate of this.gates.values())this.world.removeCollider(gate,true);this.gates.clear();for(const p of puzzlePortals){const alongZ=!!p.entryNormal.z;const gate=this.world.createCollider(RAPIER.ColliderDesc.cuboid(alongZ?p.width/2:.1,p.height/2,alongZ?.1:p.width/2).setTranslation(p.entry.x,p.entry.y+p.height/2,p.entry.z));this.gates.set(p.relay,gate);}}
 get position(){return this.body.translation();}
 direction(input:PuzzleInput):Flat {let f=input.forward,r=input.right,n=Math.hypot(f,r);if(n){f/=n;r/=n;}else f=1;return {x:Math.cos(this.yaw)*r-Math.sin(this.yaw)*f,z:-Math.sin(this.yaw)*r-Math.cos(this.yaw)*f};}
 pressBoost(code:string,repeat=false){this.boost.press(code,this.grounded,repeat);}
 releaseBoost(code:string,input:PuzzleInput){return this.boost.release(code,this.direction(input));}
 pause(){this.boost.cancelHold();this.jumpBuffer=0;}
 private place(p:Vec3){this.body.setTranslation(p,true);this.body.setNextKinematicTranslation(p);this.vy=0;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.world.step();}
 reset(){this.relays.clear();this.resetGates();this.checkpoint=0;this.falls=0;this.penalty=0;this.finished=false;this.yaw=0;this.portalGuard=0;this.portalCount=0;this.boost.reset();this.lastEvent='Follow the gold arrows. The left stairs are the safe route.';this.place({x:0,y:1.5,z:2});}
 respawn(){const p=puzzlePlatforms.find(p=>p.checkpoint===this.checkpoint)??puzzlePlatforms[0];this.boost.reset();this.portalGuard=12;this.falls++;this.penalty+=3;this.yaw=this.checkpoint===2?-Math.PI/2:0;this.place({x:p.x,y:p.y+1.5,z:p.z});this.lastEvent='Checkpoint restored · +3 seconds. Activated relays stay on.';}
 step(input:PuzzleInput){if(this.finished)return;if(input.jump)this.jumpBuffer=.14;this.coyote=this.grounded?.12:Math.max(0,this.coyote-STEP);this.jumpBuffer=Math.max(0,this.jumpBuffer-STEP);if(this.jumpBuffer>0&&this.coyote>0){this.vy=JUMP;this.jumpBuffer=0;this.coyote=0;this.grounded=false;}this.vy-=GRAVITY*STEP;
 const d=this.direction(input),moving=!!(input.forward||input.right),burst=this.boost.step(),speed=burst?CHARGE_SPEED:moving?SPEED:0,dir=burst??d,prior=this.position;
 this.controller.computeColliderMovement(this.collider,{x:dir.x*speed*STEP,y:this.vy*STEP,z:dir.z*speed*STEP});const m=this.controller.computedMovement();this.body.setNextKinematicTranslation({x:prior.x+m.x,y:prior.y+m.y,z:prior.z+m.z});this.grounded=this.controller.computedGrounded();this.boost.finishStep(this.grounded);if(this.grounded&&this.vy<0)this.vy=0;else if(m.y<this.vy*STEP-.01&&this.vy>0)this.vy=0;this.world.step();let q=this.position;
 if(this.portalGuard>0)this.portalGuard--;else for(const portal of puzzlePortals){if(!this.relays.has(portal.relay)&&Math.hypot(q.x-portal.entry.x,q.z-portal.entry.z)<2.4&&Math.abs(q.y-portal.entry.y)<3.6)this.lastEvent=`Relay ${portal.relay} required: step on its matching floor pad.`;if(!portalCrossing(portal,prior,q))continue;if(!this.relays.has(portal.relay)){this.lastEvent=`Relay ${portal.relay} required: step on its glowing floor pad.`;continue;}const a=portalAngle(portal),clearance=RADIUS+1.1;const destination={x:portal.exit.x+portal.exitNormal.x*clearance,y:portal.exit.y+(q.y-portal.entry.y),z:portal.exit.z+portal.exitNormal.z*clearance};if(this.world.intersectionWithShape(destination,{x:0,y:0,z:0,w:1},new RAPIER.Capsule(HALF,RADIUS),undefined,undefined,this.collider)){this.lastEvent='Warp exit is blocked. Stay on this pad and retry when clear.';continue;}this.yaw-=a;this.boost.rotate(a);const carriedVy=this.vy;this.place(destination);this.vy=carriedVy;this.portalGuard=20;this.portalCount++;this.lastEvent='Linked warp crossed. Follow the gold route from this balcony.';q=this.position;break;}
 for(const relay of puzzleRelays)if(this.grounded&&Math.hypot(q.x-relay.x,q.z-relay.z)<relay.radius&&Math.abs(q.y-(relay.y+HALF+RADIUS+.03))<.2&&!this.relays.has(relay.id)){this.relays.add(relay.id);const gate=this.gates.get(relay.id);if(gate){this.world.removeCollider(gate,true);this.gates.delete(relay.id);}this.lastEvent=`Relay ${relay.id} connected · matching portal OPEN.`;}
 for(const p of puzzlePlatforms){if(this.grounded&&Math.abs(q.x-p.x)<p.w/2-.2&&Math.abs(q.z-p.z)<p.d/2-.2&&Math.abs(q.y-(p.y+HALF+RADIUS+.03))<.2){if(p.checkpoint&&p.checkpoint>this.checkpoint)this.checkpoint=p.checkpoint;if(p.goal&&this.checkpoint===4&&this.relays.size===2){this.finished=true;this.lastEvent='Relay Gardens complete.';this.boost.reset();}}}
 const cp=puzzlePlatforms.find(p=>p.checkpoint===this.checkpoint)??puzzlePlatforms[0];if(q.y<cp.y-10)this.respawn();
 }
 dispose(){this.world.free();}
}
