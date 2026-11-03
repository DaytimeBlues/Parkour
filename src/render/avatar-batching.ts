import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

type Mesh = THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
/** Optional cache-time derivation for the accepted rigid woodland-v2 characters.
 * Merge only sibling meshes with identical shading except their linear base colour.
 * Animated pivots, socket, material roughness and original GLBs remain unchanged.
 * Unsupported assets fall back atomically. Never merge across an articulated joint.
 */
export function batchRigidAvatar(gltf:Pick<GLTF,'scene'|'animations'>):boolean {
 const avatar=gltf.scene.getObjectByName('Avatar'),body=avatar?.getObjectByName('Body'),socket=avatar?.getObjectByName('WingSocket');
 if(!avatar||!body||!socket||avatar.userData.revision!=='woodland-v2'||!['fox','rabbit'].includes(avatar.userData.species)||body.parent!==avatar||socket.parent!==avatar)return false;
 const allNames=new Map<string,number>();gltf.scene.traverse(o=>allNames.set(o.name,(allNames.get(o.name)??0)+1));
 if(['Avatar','WingSocket','Body','FrontLeft','FrontRight','BackLeft','BackRight','Tail'].some(name=>allNames.get(name)!==1)||avatar.children.length!==2)return false;
 const names=['Body','FrontLeft','FrontRight','BackLeft','BackRight','Tail'];
 const parents=names.map(name=>avatar.getObjectByName(name));
 if(parents.some(p=>!p)||parents.slice(1).some(p=>p!.parent!==body))return false;
 if(gltf.animations.length!==3||new Set(gltf.animations.map(c=>c.name)).size!==3||gltf.animations.some(c=>!['AvatarIdle','AvatarRun','AvatarGlide'].includes(c.name)||c.tracks.some(t=>! /^(Front|Back)(Left|Right)\.(position|quaternion|scale)$/.test(t.name))))return false;
 const meshes:Mesh[]=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o as Mesh);});
 if(meshes.length!==(avatar.userData.species==='fox'?16:19))return false;
 const signatures=new Map<Mesh,string>();
 for(const mesh of meshes){
  if(!parents.includes(mesh.parent!)||mesh.type!=='Mesh'||mesh.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||mesh.onAfterRender!==THREE.Object3D.prototype.onAfterRender||mesh.children.length||!mesh.visible||mesh.renderOrder!==0||mesh.layers.mask!==1||mesh.castShadow||mesh.receiveShadow||!mesh.frustumCulled||!mesh.matrixAutoUpdate)return false;
  const m=mesh.material,g=mesh.geometry;
  if(!(m instanceof THREE.MeshStandardMaterial)||m.type!=='MeshStandardMaterial'||m.clippingPlanes!==null||m.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||m.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey||m.vertexColors||m.transparent||m.opacity!==1||m.alphaTest!==0||Object.values(m).some(v=>v instanceof THREE.Texture))return false;
  const {uuid:_uuid,name:_name,color:_color,...settings}=m.toJSON();signatures.set(mesh,JSON.stringify(settings));
  if(Object.keys(g.attributes).sort().join(',')!=='normal,position'||Object.keys(g.morphAttributes).length||g.groups.length||g.drawRange.start!==0||g.drawRange.count!==Infinity)return false;
  const p=g.getAttribute('position'),n=g.getAttribute('normal');
  if(p.itemSize!==3||n.itemSize!==3||p.count!==n.count||p.normalized||n.normalized||(g.index?.count??p.count)%3)return false;
  const matrix=new THREE.Matrix4().compose(mesh.position,mesh.quaternion,mesh.scale);if(!matrix.elements.every(Number.isFinite)||matrix.determinant()<=0)return false;
  if(![m.color.r,m.color.g,m.color.b].every(Number.isFinite))return false;
  for(let i=0;i<p.count;i++)for(const a of [p,n])if(![a.getX(i),a.getY(i),a.getZ(i)].every(Number.isFinite))return false;
  if(g.index)for(let i=0;i<g.index.count;i++){const v=g.index.getX(i);if(!Number.isInteger(v)||v<0||v>=p.count)return false;}
 }
 const groups:Mesh[][]=[];
 for(const parent of parents){
  const byMaterial=new Map<string,Mesh[]>();
  for(const child of parent!.children)if(signatures.has(child as Mesh)){const key=signatures.get(child as Mesh)!,group=byMaterial.get(key)??[];group.push(child as Mesh);byMaterial.set(key,group);}
  groups.push(...[...byMaterial.values()].filter(group=>group.length>1));
 }
 if(meshes.length-groups.reduce((sum,group)=>sum+group.length-1,0)!==(avatar.userData.species==='fox'?13:9))return false;
 const derived:Mesh[]=[],derivedMaterials=new Map<string,THREE.MeshStandardMaterial>();
 try{
  for(const group of groups){
   const count=group.reduce((sum,m)=>sum+m.geometry.getAttribute('position').count,0),indexCount=group.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.getAttribute('position').count),0);
   const positions=new Float32Array(count*3),normals=new Float32Array(count*3),colours=new Float32Array(count*3),indices=count>65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
   const key=signatures.get(group[0])!;let material=derivedMaterials.get(key);
   if(!material){material=group[0].material.clone();material.color.setRGB(1,1,1);material.vertexColors=true;material.name='rigid-batched-linear-colours';derivedMaterials.set(key,material);}
   const geometry=new THREE.BufferGeometry(),mesh=new THREE.Mesh(geometry,material);derived.push(mesh);mesh.name=`${group[0].parent!.name}_RigidBatch`;
   let vertex=0,element=0;const v=new THREE.Vector3(),n=new THREE.Vector3(),matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
   for(const original of group){
    const g=original.geometry,p=g.getAttribute('position'),normal=g.getAttribute('normal'),index=g.index;
    matrix.compose(original.position,original.quaternion,original.scale);normalMatrix.getNormalMatrix(matrix);
    for(let i=0;i<p.count;i++){const offset=(vertex+i)*3;v.fromBufferAttribute(p,i).applyMatrix4(matrix);n.fromBufferAttribute(normal,i).applyNormalMatrix(normalMatrix);v.toArray(positions,offset);n.toArray(normals,offset);original.material.color.toArray(colours,offset);}
    for(let i=0;i<(index?.count??p.count);i++)indices[element++]=vertex+(index?index.getX(i):i);
    vertex+=p.count;
   }
   if(!positions.every(Number.isFinite)||!normals.every(Number.isFinite)||!colours.every(Number.isFinite))throw new Error('Non-finite derived avatar geometry');
   geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }
 }catch{for(const m of derived)m.geometry.dispose();for(const m of derivedMaterials.values())m.dispose();return false;}
 // Commit only once every group is ready. Preserve surviving child order and all
 // pivot identities. Resources still referenced by surviving meshes remain owned.
 groups.forEach((group,i)=>{const parent=group[0].parent!,index=parent.children.indexOf(group[0]);for(const m of group)parent.remove(m);parent.add(derived[i]);parent.children.splice(parent.children.indexOf(derived[i]),1);parent.children.splice(index,0,derived[i]);});
 const survivors=new Set<THREE.BufferGeometry|THREE.Material>();gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){survivors.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])survivors.add(m);}});
 const replaced=new Set(groups.flatMap(group=>group.flatMap(m=>[m.geometry,m.material])));for(const resource of replaced)if(!survivors.has(resource))resource.dispose();
 return true;
}
