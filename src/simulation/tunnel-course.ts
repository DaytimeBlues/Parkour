import {flowCourses,type FlowCourse,type FlowTunnel} from './flow-course.ts';
export const TUNNEL_RULES='flow-v2';
export const TUNNEL_TOP=2.8;
export type TunnelBox={name:string;x:number;y:number;z:number;w:number;h:number;d:number};
/** One exact set of solid volumes for Rapier and Three. Decoration stays outside the aperture. */
export function tunnelBoxes(t:FlowTunnel):TunnelBox[]{
 const boxes: TunnelBox[]=[{name:'low-roof',x:t.x,y:t.y+(t.clearance+TUNNEL_TOP)/2,z:(t.front+t.back)/2,w:t.w+.8,h:TUNNEL_TOP-t.clearance,d:t.front-t.back}];
 for(const side of [-1,1])boxes.push({name:`side-wall-${side}`,x:t.x+side*(t.w/2+.2),y:t.y+TUNNEL_TOP/2,z:(t.front+t.wallBack)/2,w:.4,h:TUNNEL_TOP,d:t.front-t.wallBack});
 return boxes;
}
/** Versioned geometry. The original Flow objects remain untouched and selectable. */
export const tunnelCourses:FlowCourse[]=flowCourses.map((legacy,index)=>{
 const c=structuredClone(legacy);c.id=legacy.id.replace(/-flow-v1$/,'-flow-v2');c.name=legacy.name.replace(' · Flow',' · Flow II');c.subtitle=`${String(index+1).padStart(2,'0')} · SLIDE SHORTCUTS / GLIDE`;
 c.arches=[];c.tunnels=[0,2,4].map((stage,i)=>{const r=c.ramps[stage],back=-stage*34-3.9,front=back+[3,3.8,4.6][i];return {id:`service-${stage}`,stage,x:r.x,y:r.y,front,back,wallBack:-stage*34-8.5,w:r.w,clearance:1.18,cueZ:front+.8,label:['LEARN · DUCK FOR THE FAST RAMP','PRACTISE · SLIDE THROUGH THE DUCT','COMBINE · SLIDE → RAMP → GLIDE'][i]};});
 return c;
});
