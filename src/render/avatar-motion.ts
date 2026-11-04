/** Cosmetic-only clock and authored clip selection. Never changes game state. */
export type AvatarMotionFrame={time:number;speed:number;grounded:boolean;gliding:boolean;sliding:boolean;reducedMotion?:boolean;paused?:boolean};
export type AvatarClipName='AvatarIdle'|'AvatarRun'|'AvatarJump'|'AvatarGlide'|'AvatarLand';
export class AvatarMotion{
 private last:number|undefined;private grounded:boolean|undefined;private age=0;private phase=0;private name:AvatarClipName='AvatarIdle';private landing=false;
 reset(){this.last=undefined;this.grounded=undefined;this.age=0;this.phase=0;this.name='AvatarIdle';this.landing=false;}
 sample(frame:AvatarMotionFrame,duration:(name:AvatarClipName)=>number){
  const time=Number.isFinite(frame.time)?frame.time:this.last??0;
  const dt=this.last===undefined?0:Math.max(0,Math.min(.1,time-this.last));this.last=time;
  if(frame.paused&&this.grounded!==undefined)return{name:this.name,time:this.phase};
  if(this.grounded===false&&frame.grounded&&!frame.sliding)this.landing=true;
  if(!frame.grounded||frame.sliding)this.landing=false;
  const speed=Number.isFinite(frame.speed)?Math.max(0,frame.speed):0;
  let name:AvatarClipName=frame.sliding?'AvatarIdle':frame.gliding&&!frame.grounded?'AvatarGlide':!frame.grounded?'AvatarJump':this.landing?'AvatarLand':speed>.1?'AvatarRun':'AvatarIdle';
  if(name!==this.name){this.name=name;this.age=0;}else if(!frame.reducedMotion||name==='AvatarLand')this.age+=dt*(name==='AvatarRun'?Math.min(2,speed/5):1);
  const length=(n:AvatarClipName)=>{const value=duration(n);return Number.isFinite(value)&&value>0?value:0;};
  if(name==='AvatarLand'&&this.age>=length(name)){this.landing=false;this.name=name=speed>.1?'AvatarRun':'AvatarIdle';this.age=0;}
  const seconds=length(name);
  this.phase=frame.reducedMotion||frame.sliding?0:name==='AvatarJump'||name==='AvatarLand'?Math.min(this.age,seconds):seconds>0?this.age%seconds:0;
  this.grounded=frame.grounded;return{name,time:this.phase};
 }
}
