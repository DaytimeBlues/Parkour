/** Fixed-step horizontal burst. Physics/collision remains the controller's responsibility. */
export const BOOST_SPEED = 14.4;
export const BOOST_TICKS = 15;
export const BOOST_COOLDOWN_TICKS = 48;
export const BOOST_GROUND_TICKS = 6;
export type Direction = {x:number; z:number};
export class Boost {
  charged=true; remaining=0; cooldown=0; groundTicks=0; private activeThisTick=false; direction:Direction={x:0,z:-1};
  reset(){this.charged=true;this.remaining=0;this.cooldown=0;this.groundTicks=0;this.activeThisTick=false;this.direction={x:0,z:-1};}
  activate(x:number,z:number):boolean {
    if(!this.charged || this.remaining>0)return false;
    const length=Math.hypot(x,z);if(!Number.isFinite(length)||length<1e-8)return false;
    this.direction={x:x/length,z:z/length};this.charged=false;this.remaining=BOOST_TICKS;this.cooldown=BOOST_COOLDOWN_TICKS;this.groundTicks=0;return true;
  }
  /** Called exactly once per simulation tick, never while paused. */
  step():Direction|null {
    this.activeThisTick=this.remaining>0;
    const motion=this.activeThisTick?{...this.direction}:null;
    if(this.activeThisTick)this.remaining--;
    if(this.cooldown>0)this.cooldown--;
    return motion;
  }
  /** Recharge uses this tick's actual post-movement ground result. */
  finishStep(grounded:boolean):void {
    if(!this.activeThisTick && grounded)this.groundTicks++;else this.groundTicks=0;
    if(!this.charged && !this.activeThisTick && this.cooldown===0 && grounded && this.groundTicks>=BOOST_GROUND_TICKS)this.charged=true;
  }
  label(grounded:boolean):string {return this.remaining>0?'BOOST ACTIVE':this.charged?'BOOST READY':this.cooldown>0?'BOOST COOLING':grounded?'BOOST RECHARGING':'LAND TO RECHARGE';}
}

/** Aliases share one latch: all must be released before another press. */
export class BoostInputLatch {
  private held = new Set<string>();
  press(code:string, repeat:boolean):boolean {if(repeat)return false;const first=this.held.size===0;this.held.add(code);return first;}
  release(code:string){this.held.delete(code);}
  clear(){this.held.clear();}
}
