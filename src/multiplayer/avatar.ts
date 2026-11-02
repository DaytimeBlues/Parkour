import * as THREE from 'three';
import type { Team } from './client';

/** Original foxes: five instanced body batches + one glider + one team marker.
 * Every instance uses this factory's shared geometries/materials. No textures,
 * skinning, shadows or imported assets. Positions remain purely presentational.
 */
export function foxFactory() {
  const box=new THREE.BoxGeometry(1,1,1),cone=new THREE.ConeGeometry(1,1,4),triangle=new THREE.ConeGeometry(1,1,3),wing=new THREE.BufferGeometry();
  wing.setAttribute('position',new THREE.Float32BufferAttribute([
    -1.35,0,.38, -.12,.12,-.75, -.12,0,.24,
    -.12,.12,-.75, .12,.12,-.75, -.12,0,.24,
    .12,.12,-.75, 1.35,0,.38, .12,0,.24,
    -.12,0,.24, .12,.12,-.75, .12,0,.24,
  ],3));wing.computeVertexNormals();
  const materials={red:new THREE.MeshLambertMaterial({color:0xef675d}),blue:new THREE.MeshLambertMaterial({color:0x50b8f5}),white:new THREE.MeshLambertMaterial({color:0xfff1df}),dark:new THREE.MeshLambertMaterial({color:0x14283a}),glider:new THREE.MeshLambertMaterial({color:0xffdf79,side:THREE.DoubleSide})};
  type Part={x:number;y:number;z:number;sx:number;sy:number;sz:number;rx?:number;rz?:number};
  const matrix=new THREE.Object3D(),instanceBuffers=new Set<THREE.InstancedMesh>();
  function set(mesh:THREE.InstancedMesh,index:number,p:Part){matrix.position.set(p.x,p.y,p.z);matrix.scale.set(p.sx,p.sy,p.sz);matrix.rotation.set(p.rx??0,0,p.rz??0);matrix.updateMatrix();mesh.setMatrixAt(index,matrix.matrix);}
  function batch(root:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,parts:Part[],name:string){const mesh=new THREE.InstancedMesh(geometry,material,parts.length);mesh.name=name;parts.forEach((p,i)=>set(mesh,i,p));mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;instanceBuffers.add(mesh);root.add(mesh);return mesh;}
  function create(team:Team){
    const root=new THREE.Group(),body=new THREE.Group();root.name=`fox-${team}`;body.name='fox-body';root.add(body);
    const torso:Part[]=[{x:0,y:.67,z:.02,sx:.52,sy:.48,sz:.85},{x:0,y:.99,z:-.37,sx:.49,sy:.43,sz:.43}];
    const white:Part[]=[{x:0,y:.61,z:-.405,sx:.31,sy:.27,sz:.025},{x:0,y:.94,z:-.601,sx:.38,sy:.12,sz:.025}];
    const dark:Part[]=[{x:-.19,y:1.07,z:-.602,sx:.06,sy:.07,sz:.03},{x:.19,y:1.07,z:-.602,sx:.06,sy:.07,sz:.03},{x:0,y:.93,z:-.88,sx:.105,sy:.085,sz:.08}];
    const legs: {side:number;end:number;index:number;foot:number}[]=[];
    for(const side of[-1,1])for(const end of[-1,1]){legs.push({side,end,index:torso.length,foot:dark.length});torso.push({x:side*.19,y:.29,z:end*.29,sx:.14,sy:.38,sz:.15});dark.push({x:side*.19,y:.07,z:end*.29-.025,sx:.16,sy:.12,sz:.21});}
    const ears:Part[]=[{x:-.19,y:1.39,z:-.35,sx:.2,sy:.38,sz:.24},{x:.19,y:1.39,z:-.35,sx:.2,sy:.38,sz:.24},{x:0,y:.78,z:.77,sx:.3,sy:.86,sz:.3,rx:Math.PI*.4}];
    const tips:Part[]=[{x:-.19,y:1.39,z:-.41,sx:.085,sy:.22,sz:.09},{x:.19,y:1.39,z:-.41,sx:.085,sy:.22,sz:.09},{x:0,y:.93,z:1.09,sx:.18,sy:.34,sz:.18,rx:Math.PI*.4},{x:0,y:.94,z:-.72,sx:.27,sy:.34,sz:.25,rx:-Math.PI/2}];
    const fur=batch(body,box,materials[team],torso,'team-fur'),bibs=batch(body,box,materials.white,white,'cream-bib'),details=batch(body,box,materials.dark,dark,'eyes-boots'),silhouette=batch(body,cone,materials[team],ears,'ears-tail'),cream=batch(body,cone,materials.white,tips,'ear-muzzle-tail-tips');
    const glider=new THREE.Mesh(wing,materials.glider);glider.name='glider';glider.position.y=1.65;root.add(glider);glider.visible=false;
    const badge=new THREE.Mesh(team==='red'?triangle:box,materials.dark);badge.name=team==='red'?'triangle-team-marker':'square-team-marker';badge.position.set(0,1.98,0);badge.scale.set(team==='red'?.25:.3,.3,.13);root.add(badge);
    // All ownership cues are physical depth-tested meshes, never screen-space names.
    return{root,dispose(){body.traverse(object=>{if(object instanceof THREE.InstancedMesh){object.dispose();instanceBuffers.delete(object);}});},pose(time:number,speed:number,grounded:boolean,gliding:boolean,sliding:boolean){
      glider.visible=gliding&&!sliding;body.scale.y=sliding?.5:1;body.rotation.x=gliding&&!sliding?-.12:0;badge.visible=!sliding;
      for(const leg of legs){const angle=grounded?Math.sin(time*12+(leg.side===leg.end?0:Math.PI))*Math.min(.58,speed*.085):gliding?.5:-.4;
        set(fur,leg.index,{...torso[leg.index],y:.48-Math.cos(angle)*.19,z:leg.end*.29-Math.sin(angle)*.19,rx:angle});
        set(details,leg.foot,{...dark[leg.foot],y:.48-Math.cos(angle)*.4,z:leg.end*.29-Math.sin(angle)*.4-.025,rx:angle});}
      const sway=Math.sin(time*3)*.1;set(silhouette,2,{...ears[2],rz:sway});set(cream,2,{...tips[2],rz:sway});
      for(const mesh of[fur,details,silhouette,cream]){mesh.instanceMatrix.needsUpdate=true;mesh.boundingBox=null;mesh.boundingSphere=null;}
    }};
  }
  return{create,dispose(){instanceBuffers.forEach(mesh=>mesh.dispose());instanceBuffers.clear();box.dispose();cone.dispose();triangle.dispose();wing.dispose();Object.values(materials).forEach(m=>m.dispose());}};
}
