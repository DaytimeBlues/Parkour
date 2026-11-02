import {courses, type Course, type Platform} from './courses.ts';
import {puzzleCourse} from './puzzle-course.ts';
export const FLOW_RULES='flow-v1';
export type FlowPlatform=Platform&{id:string;next?:string;label?:string};
export type FlowRamp={id:string;x:number;y:number;z:number;w:number;d:number;rise:number;checkpoint:number};
export type FlowArch={x:number;y:number;z:number;w:number;d:number;clearance:number};
export type FlowTunnel={id:string;stage:number;x:number;y:number;front:number;back:number;wallBack:number;w:number;clearance:number;cueZ:number;label:string};
export type FlowCourse=Omit<Course,'platforms'>&{flow:true;platforms:FlowPlatform[];ramps:FlowRamp[];arches:FlowArch[];safeRoutes:string[][];tunnels?:FlowTunnel[]};
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
