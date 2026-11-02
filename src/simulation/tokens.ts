import { platformX, type Course, type Platform } from './courses.ts';

export type Token = { id:string; platform:Platform; offsetX:number; offsetZ:number; value:10|50; height?:number; aperture?:{x:number;minZ:number;maxZ:number;halfWidth:number;minCenterY:number;maxCenterY:number} };
export type Position = {x:number;y:number;z:number};
export type RunPhase = 'ready'|'starting'|'playing'|'paused'|'finished';
export const TOKEN_HEIGHT=1.35, TOKEN_RADIUS=.62, TOKEN_VERTICAL_REACH=.95;

/** Stable per-course IDs. Coins are non-solid and sit over existing safe surfaces. */
export function courseTokens(course:Course):Token[]{
 const tokens:Token[]=[];
 course.platforms.forEach((platform,index)=>{
  const named=platform as Platform&{id?:string};
  // The recovery ledges are not a reward for falling; the intentional quick line is.
  // Finish triggers on entering its platform, so don't leave a coin beyond that boundary.
  if(platform.goal||named.id==='catch'||named.id==='catch-step')return;
  const shortcut=named.id==='garden-shortcut';
  tokens.push({id:`${course.id}:${index}:route`,platform,offsetX:0,offsetZ:index===0?-1.8:0,value:shortcut?50:10});
  // Optional side detours cost time and ask the player to approach an outer edge.
  // They never add jumps, collision or a requirement to complete the speed route.
  if(platform.checkpoint){tokens.push({id:`${course.id}:${index}:bonus`,platform,offsetX:(index%2?1:-1)*(platform.w/2-.75),offsetZ:platform.d/2-.85,value:50});}
 });
 // Flow II's service-tunnel reward stays below its roof, inset from every wall.
 const tunnels=(course as Course&{tunnels?:{id:string;x:number;y:number;front:number;back:number;w:number}[]}).tunnels??[];
 for(const t of tunnels){tokens.push({id:`${course.id}:${t.id}:bonus`,platform:{x:t.x,y:t.y,z:(t.front+t.back)/2,w:t.w,d:t.front-t.back},offsetX:0,offsetZ:0,value:50,height:.62,aperture:{x:t.x,minZ:t.back+.35,maxZ:t.front-.35,halfWidth:t.w/2-.35,minCenterY:t.y+.4,maxCenterY:t.y+.8}});}
 return tokens;
}

export function tokenPosition(token:Token,physicsSeconds:number):Position{
 return {x:platformX(token.platform,physicsSeconds)+token.offsetX,y:token.platform.y+(token.height??TOKEN_HEIGHT),z:token.platform.z+token.offsetZ};
}

/** Local run score only: never included in the shared server-timed leaderboard. */
export class TokenRun{
 readonly tokens:Token[];
 readonly collected=new Set<string>();
 score=0;
 constructor(course:Course){this.tokens=courseTokens(course);}
 get total(){return this.tokens.length;}
 get availablePoints(){return this.tokens.reduce((sum,token)=>sum+token.value,0);}
 reset(){this.collected.clear();this.score=0;}
 collect(position:Position,physicsSeconds:number,phase:RunPhase):Token[]{
  if(phase!=='playing'||![position.x,position.y,position.z,physicsSeconds].every(Number.isFinite))return [];
  const picked:Token[]=[];
  for(const token of this.tokens){
   if(this.collected.has(token.id))continue;
   const gate=token.aperture;if(gate&&(Math.abs(position.x-gate.x)>gate.halfWidth||position.z<gate.minZ||position.z>gate.maxZ||position.y<gate.minCenterY||position.y>gate.maxCenterY))continue;
   const at=tokenPosition(token,physicsSeconds);
   // Test only the real post-physics position, never a swept line across a warp/respawn.
   if(Math.hypot(position.x-at.x,position.z-at.z)<=TOKEN_RADIUS&&Math.abs(position.y-at.y)<=TOKEN_VERTICAL_REACH){
    this.collected.add(token.id);this.score+=token.value;picked.push(token);
   }
  }
  return picked;
 }
}
