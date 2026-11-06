import {courses, type Course, type Platform} from './courses.ts';
import {puzzleCourse} from './puzzle-course.ts';
export const FLOW_RULES='flow-v1';
export type FlowPlatform=Platform&{id:string;next?:string;label?:string;cornerCut?:number;rotationZ?:number};
export type FlowRamp={id:string;x:number;y:number;z:number;w:number;d:number;rise:number;checkpoint:number};
export type FlowArch={x:number;y:number;z:number;w:number;d:number;clearance:number};
export type FlowTunnel={id:string;stage:number;x:number;y:number;front:number;back:number;wallBack:number;w:number;clearance:number;cueZ:number;label:string};
export type FlowSolid={id:string;x:number;y:number;z:number;w:number;h:number;d:number;cornerCut?:number;rotationZ?:number};
export type FlowCourse=Omit<Course,'platforms'>&{flow:true;platforms:FlowPlatform[];ramps:FlowRamp[];arches:FlowArch[];safeRoutes:string[][];tunnels?:FlowTunnel[];solids?:FlowSolid[];introduction?:string;checkpointHints?:Record<number,string>;tokenOffsets?:Record<string,{x:number;z:number}>};
/** Authored stage rhythm, deterministic variations; both branches join every required checkpoint. */
export function makeFlowCourse(theme:Course,index:number):FlowCourse{
 const platforms:FlowPlatform[]=[{id:'pad-0',x:0,y:0,z:0,w:16,d:12,label:'STAIRS = SAFE  /  RAMP = FAST'}],ramps:FlowRamp[]=[],arches:FlowArch[]=[],safeRoutes:string[][]=[];
 for(let stage=0;stage<5;stage++){
  const y=stage*5,z=-stage*34,side=(index+stage)%2?1:-1,lane=side*(8+(index%2)*.3),rampX=-side*3.2;
  const ids=[`pad-${stage}`];
  for(let step=1;step<=5;step++){
   const id=`s${stage}-${step}`,w=4.5+((index+step)%3)*.4,d=4.2+((stage+step+index)%3)*.65;
   platforms.push({id,x:lane+(step===3?side*.6:0),y:y+step*5/6,z:z-step*5.5,w,d});ids.push(id);
  }
  const target=`pad-${stage+1}`;ids.push(target);safeRoutes.push(ids);
  for(let i=0;i<ids.length-1;i++)platforms.find(p=>p.id===ids[i])!.next=ids[i+1];
  platforms.push({id:target,x:0,y:y+5,z:z-34,w:16-(index%3)*.5,d:12,checkpoint:stage<4?stage+1:undefined,goal:stage===4,label:stage===4?'FINISH · BOTH ROUTES COUNT':`CHECKPOINT ${stage+1} · CHOOSE YOUR LINE`});
  ramps.push({id:`ramp-${stage}`,x:rampX,y,z:z-8,w:3.8,d:6,rise:1.5,checkpoint:stage});
  if(stage%2===0)arches.push({x:rampX,y,z:z-2.5,w:3.8,d:2.4,clearance:1.18});
 }
 return {...theme,id:`${theme.id}-flow-v1`,name:`${theme.name} · Flow`,subtitle:`${String(index+1).padStart(2,'0')} · SLIDE / RAMP / GLIDE`,flow:true,platforms,ramps,arches,safeRoutes};
}
export const flowCourses=[...courses,puzzleCourse].map(makeFlowCourse);
/** Shared exact convex wedge vertices for collision and visible ramp geometry. */
export function rampVertices(r:FlowRamp):Float32Array{
 const a=r.w/2,b=r.d/2;
 return new Float32Array([-a,-.3,b,a,-.3,b,-a,-.3,-b,a,-.3,-b,-a,0,b,a,0,b,-a,r.rise,-b,a,r.rise,-b]);
}

/** Exact structural boxes shared by Rapier and optional course renderers. */
export function flowArchSolids(a:FlowArch,id:string):FlowSolid[]{return[
 {id:`${id}-roof`,x:a.x,y:a.y+a.clearance+.3,z:a.z,w:a.w+.4,h:.6,d:a.d},
 ...[-1,1].map((side,i)=>({id:`${id}-post-${i}`,x:a.x+side*(a.w/2+.2),y:a.y+a.clearance/2,z:a.z,w:.4,h:a.clearance,d:a.d})),
];}

/** Clipped stone footprint, optional only. Legacy definitions remain cuboids. */
export function flowSolidOutline(w:number,d:number,cornerCut=0,inset=0):[number,number][]{
 const x=w/2-inset,z=d/2-inset,c=Math.max(0,Math.min(cornerCut-(2-Math.SQRT2)*inset,x*.4,z*.4));
 return c>0?[[-x+c,-z],[x-c,-z],[x,-z+c],[x,z-c],[x-c,z],[-x+c,z],[-x,z-c],[-x,-z+c]]:[[-x,-z],[x,-z],[x,z],[-x,z]];
}
export function flowSolidVertices(b:FlowSolid):Float32Array{
 const lower=flowSolidOutline(b.w,b.d,b.cornerCut),upper=flowSolidOutline(b.w,b.d,b.cornerCut);
 return new Float32Array([...lower.flatMap(([x,z])=>[x,-b.h/2,z]),...upper.flatMap(([x,z])=>[x,b.h/2,z])]);
}
export function flowSolidIndices(sides:number):number[]{
 const result:number[]=[];for(let i=1;i<sides-1;i++)result.push(0,i,i+1,sides,sides+i+1,sides+i);
 for(let i=0;i<sides;i++){const j=(i+1)%sides;result.push(i,sides+i,j,j,sides+i,sides+j);}return result;
}
