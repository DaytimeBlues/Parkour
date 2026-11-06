import * as THREE from 'three';
import {tokenPosition,type TokenRun,type Token} from '../simulation/tokens.ts';
import {tokenFaceTexture} from './tokens.ts';
/** Same real thick coins/values, low-sided instanced preview presentation only.
 * Collected instances compact out; no zero-scale normals or hidden far objects.
 */
export function createRootbridgeTokens(parent:THREE.Group,run:TokenRun,options:{faceTextures?:boolean}={}){
 const root=new THREE.Group();root.name='rootbridge-batched-real-coins';parent.add(root);
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),instances=new Set<THREE.InstancedMesh>();let disposed=false,lastCollected=-1;
 const moving=run.tokens.some(t=>!!t.platform.move),sets:{value:10|50;tokens:Token[];disc:THREE.InstancedMesh;rim:THREE.InstancedMesh;face:THREE.InstancedMesh}[]=[];
 const rimMaterial=new THREE.MeshStandardMaterial({color:0x77552d,roughness:.65});materials.add(rimMaterial);
 const make=(g:THREE.BufferGeometry,m:THREE.Material,count:number)=>{geometries.add(g);materials.add(m);const mesh=new THREE.InstancedMesh(g,m,count);instances.add(mesh);root.add(mesh);return mesh;};
 for(const value of [10,50] as const){const tokens=run.tokens.filter(t=>t.value===value),segments=value===10?12:4,radius=value===10?.36:.44;
  const map=options.faceTextures===false||typeof document==='undefined'?undefined:tokenFaceTexture(value);if(map)textures.add(map);
  const disc=make(new THREE.CylinderGeometry(radius,radius,.14,segments).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:value===10?0xf3ca68:0xe8a34c,metalness:.35,roughness:.55}),tokens.length);
  const rim=make(new THREE.TorusGeometry(radius*.88,.025,4,segments),rimMaterial,tokens.length*2);
  const face=make(new THREE.PlaneGeometry(radius*1.55,radius*1.55),new THREE.MeshBasicMaterial({...(map?{map}:{}),color:map?0xffffff:0x674c2a,transparent:!!map,depthWrite:false}),tokens.length*2);
  // In native/headless QA no canvas texture exists: omit numeral planes rather
  // than invent an opaque replacement face. Live DOM uses the real texture.
  face.visible=!!map;
  disc.name=`rootbridge-${value}-coin-discs`;rim.name=`rootbridge-${value}-coin-rims`;face.name=`rootbridge-${value}-coin-values`;
  sets.push({value,tokens,disc,rim,face});
 }
 const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
 function update(seconds:number){if(disposed||(!moving&&lastCollected===run.collected.size))return;lastCollected=run.collected.size;
  for(const set of sets){let i=0;for(const token of set.tokens){if(run.collected.has(token.id))continue;const p=tokenPosition(token,seconds);position.set(p.x,p.y,p.z);rotation.identity();matrix.compose(position,rotation,scale);set.disc.setMatrixAt(i,matrix);
    for(const [j,side] of [-1,1].entries()){position.set(p.x,p.y,p.z+side*.075);rotation.identity();matrix.compose(position,rotation,scale);set.rim.setMatrixAt(i*2+j,matrix);position.z=p.z+side*.086;rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),side<0?Math.PI:0);matrix.compose(position,rotation,scale);set.face.setMatrixAt(i*2+j,matrix);}i++;}
   set.disc.count=i;set.rim.count=set.face.count=i*2;for(const mesh of [set.disc,set.rim,set.face]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}
  }
 }
 update(0);
 return{root,update,dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const i of instances)i.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();root.clear();}};
}
