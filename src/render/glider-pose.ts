import type {RunPhase} from '../simulation/tokens.ts';
export type GliderFrame={phase:RunPhase;flight:boolean;gliding:boolean;dt:number;lateralSpeed:number;verticalSpeed:number;reducedMotion:boolean};
/** Presentation only. Never feeds motion, input, score or camera orientation back into the game. */
export class GliderPose{
 deployment=0;bank=0;sway=0;lift=0;visible=false;
 reset(){this.deployment=0;this.bank=0;this.sway=0;this.lift=0;this.visible=false;}
 update(frame:GliderFrame){
  if(!frame.flight||frame.phase==='ready'||frame.phase==='starting'||frame.phase==='finished'){this.reset();return;}
  if(frame.phase==='paused'){this.visible=false;return;}
  const dt=Number.isFinite(frame.dt)?Math.min(.1,Math.max(0,frame.dt)):0;
  if(frame.reducedMotion){this.deployment=frame.gliding?1:0;this.bank=0;this.sway=0;this.lift=0;this.visible=frame.gliding;return;}
  this.deployment=Math.max(0,Math.min(1,this.deployment+(frame.gliding?dt/.22:-dt/.16)));
  const lateral=Number.isFinite(frame.lateralSpeed)?Math.max(-1,Math.min(1,frame.lateralSpeed/12)):0;
  const vertical=Number.isFinite(frame.verticalSpeed)?Math.max(-1,Math.min(1,frame.verticalSpeed/12)):0;
  const blend=1-Math.exp(-8*dt);
  this.bank+=(-lateral*.045-this.bank)*blend;this.sway+=(-lateral*.018-this.sway)*blend;this.lift+=(vertical*.025-this.lift)*blend;
  this.visible=this.deployment>0;
  if(!this.visible){this.bank=0;this.sway=0;this.lift=0;}
 }
}
