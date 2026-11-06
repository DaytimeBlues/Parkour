import type {FlowCourse,FlowPlatform,FlowSolid} from './flow-course.ts';
/** Development practice layout. Never added to the shipping catalogue here. */
export const ROOTBRIDGE_ID='rootbridge-hollow-woodland-v1';
export function createRootbridgeCourse():FlowCourse{
 const platforms:FlowPlatform[]=[
  {id:'pad-0',x:0,y:0,z:0,w:14,d:12},
  {id:'teach',x:-2,y:.6,z:-8.5,w:6,d:5},
  {id:'pad-1',x:0,y:1.2,z:-15,w:14,d:10,checkpoint:1},
  {id:'bend-1',x:5,y:1.8,z:-21,w:6,d:5},
  {id:'bend-2',x:5,y:2.4,z:-26,w:6,d:5},
  {id:'pad-2',x:0,y:2.4,z:-31,w:14,d:10,checkpoint:2},
  {id:'root-gallery',x:0,y:2.4,z:-39,w:12,d:8},
  {id:'pad-3',x:0,y:2.4,z:-47,w:16,d:12,checkpoint:3},
  {id:'stone-1',x:7,y:2.4+5/6,z:-53.5,w:5.2,d:5.5},
  {id:'stone-2',x:7,y:2.4+10/6,z:-59,w:5.2,d:5.5},
  {id:'stone-3',x:7,y:4.9,z:-64.5,w:6,d:6.2},
  {id:'stone-4',x:7,y:2.4+20/6,z:-70,w:5.2,d:5.5},
  {id:'stone-5',x:7,y:2.4+25/6,z:-74,w:5.8,d:5.5},
  {id:'pad-4',x:0,y:7.4,z:-81,w:16,d:12,checkpoint:4},
  {id:'final-stone',x:-3,y:8,z:-89,w:6,d:5.5},
  {id:'finish',x:0,y:8.6,z:-96,w:16,d:10,goal:true},
  {id:'catch',x:-2,y:1.8,z:-65,w:10,d:22},
 ];
 const safeRoutes=[['pad-0','teach','pad-1'],['pad-1','bend-1','bend-2','pad-2'],['pad-2','root-gallery','pad-3'],['pad-3','stone-1','stone-2','stone-3','stone-4','stone-5','pad-4'],['pad-4','final-stone','finish']];
 for(const route of safeRoutes)for(let i=0;i<route.length-1;i++)platforms.find(p=>p.id===route[i])!.next=route[i+1];
 // Grounded stone masses use the SAME solids for rendering and collision.
 // Do not draw solid cliffs beneath 0.65m-only slabs that players fall through.
 // Root gallery/catch stay open underneath as visibly distinct boardwalks.
 for(const p of platforms)if(!['root-gallery','catch'].includes(p.id))p.cornerCut=Math.min(.6,Math.min(p.w,p.d)*.1);
 const floor=-4,solids:FlowSolid[]=platforms.filter(p=>!['root-gallery','catch'].includes(p.id)).map(p=>({id:`foundation-${p.id}`,x:p.x,y:(floor+p.y-.65)/2,z:p.z,w:p.w,h:p.y-.65-floor,d:p.d,cornerCut:p.cornerCut}));
 solids.push({id:'goal-left',x:-3.4,y:10.15,z:-99,w:.8,h:3.1,d:1},{id:'goal-right',x:3.4,y:10.15,z:-99,w:.8,h:3.1,d:1});
 for(let i=0;i<=10;i++){const angle=i*Math.PI/10;solids.push({id:`goal-arch-${i}`,x:3.4*Math.cos(angle),y:11.7+3.4*Math.sin(angle),z:-99,w:1.1,h:.75,d:1,rotationZ:angle-Math.PI/2});}
 const tokenOffsets=Object.fromEntries(platforms.filter(p=>!p.goal&&p.id!=='catch').map(p=>[p.id,{x:p.w>8?1.6:1.15,z:-1.4}]));

 return{id:ROOTBRIDGE_ID,name:'Rootbridge Hollow',subtitle:'DEV PRACTICE · CONNECTED WOODLAND',flow:true,sky:0xb5dce8,fog:0xc5e2dc,ground:0xc2b18d,rock:0x827762,edge:0x789a4e,light:0xffedc8,platforms,safeRoutes,solids,tokenOffsets,
  introduction:'LEAF MARKS · tap SPACE for short rising hops. The low root passage has a wide walking bypass.',
  checkpointHints:{1:'TURN RIGHT · repeat the short hop onto the broad terrace',2:'ROOT GALLERY · C under the left root, or walk the clear right lane',3:'CHOOSE YOUR LINE · gold stairs right; C under the left root, then hold SPACE AFTER launch',4:'FINAL STONES · follow the leaf marks to the stone arch'},
  ramps:[{id:'root-launch-3',x:-3.2,y:2.4,z:-55,w:3.8,d:6,rise:1.5,checkpoint:3}],
  arches:[{x:-3.2,y:2.4,z:-39,w:3.8,d:2.4,clearance:1.18},{x:-3.2,y:2.4,z:-49.5,w:3.8,d:2.4,clearance:1.18}],
 };
}
