import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

/** Narrow, opt-in derivation of the accepted parakeet template, before cloning.
 * Never flatten articulated pivots. Unsupported future assets retain their original
 * meshes. Original GLB/Blender files and all other appearance styles are untouched.
 */
export function batchParakeetWings(gltf:Pick<GLTF,'scene'|'animations'>):boolean {
  const wings=gltf.scene.getObjectByName('Wings');
  if(wings?.userData.style!=='parakeet'||wings.children.length!==2)return false;
  const pivots=['WingLeft','WingRight'].map(name=>wings.children.find(o=>o.name===name));
  if(pivots.some(p=>!p||p.children.length!==8))return false;
  if(gltf.animations.some(c=>c.tracks.some(t=>!/^Wing(Left|Right)\.(position|quaternion|scale)$/.test(t.name))))return false;
  const meshes=pivots.flatMap(p=>p!.children);
  let sceneMeshes=0;gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)sceneMeshes++;});
  if(sceneMeshes!==16)return false; // No unseen users of resources we will replace.
  let signature:string|undefined;
  for(const object of meshes){
    if(!(object instanceof THREE.Mesh)||object.type!=='Mesh'||object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||object.onAfterRender!==THREE.Object3D.prototype.onAfterRender||object.children.length||!object.visible||object.renderOrder!==0||object.layers.mask!==1||object.castShadow||object.receiveShadow||!object.frustumCulled||!object.matrixAutoUpdate)return false;
    const m=object.material,g=object.geometry;
    if(!(m instanceof THREE.MeshStandardMaterial)||m.type!=='MeshStandardMaterial'||m.clippingPlanes!==null||m.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||m.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey||m.vertexColors||m.transparent||m.opacity!==1||m.alphaTest!==0||Object.values(m).some(v=>v instanceof THREE.Texture))return false;
    const {uuid:_uuid,name:_name,color:_color,...settings}=m.toJSON();
    const key=JSON.stringify(settings);if(signature!==undefined&&key!==signature)return false;signature=key;
    if(Object.keys(g.attributes).sort().join(',')!=='normal,position'||Object.keys(g.morphAttributes).length||g.groups.length||g.drawRange.start!==0||g.drawRange.count!==Infinity)return false;
    const position=g.getAttribute('position'),normal=g.getAttribute('normal');
    if(position.itemSize!==3||normal.itemSize!==3||position.count!==normal.count||position.normalized||normal.normalized||(g.index?.count??position.count)%3)return false;
    const matrix=new THREE.Matrix4().compose(object.position,object.quaternion,object.scale);if(!matrix.elements.every(Number.isFinite)||matrix.determinant()<=0)return false;
    if(![m.color.r,m.color.g,m.color.b].every(Number.isFinite))return false;
    for(let i=0;i<position.count;i++)for(const a of [position,normal])if(![a.getX(i),a.getY(i),a.getZ(i)].every(Number.isFinite))return false;
    if(g.index)for(let i=0;i<g.index.count;i++){const n=g.index.getX(i);if(!Number.isInteger(n)||n<0||n>=position.count)return false;}
  }
  const old=meshes as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>[];
  const material=old[0].material.clone();material.color.setRGB(1,1,1);material.vertexColors=true;material.name='parakeet-batched-linear-colours';
  const derived:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>[]=[];
  try{
    for(const pivot of pivots){
      const children=pivot!.children as typeof old;
      const count=children.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.getAttribute('position').count),0);
      const positions=new Float32Array(count*3),normals=new Float32Array(count*3),colours=new Float32Array(count*3);
      let offset=0;const v=new THREE.Vector3(),n=new THREE.Vector3(),normalMatrix=new THREE.Matrix3(),matrix=new THREE.Matrix4();
      for(const mesh of children){
        const g=mesh.geometry,p=g.getAttribute('position'),normal=g.getAttribute('normal'),index=g.index;
        matrix.compose(mesh.position,mesh.quaternion,mesh.scale);normalMatrix.getNormalMatrix(matrix);
        for(let i=0;i<(index?.count??p.count);i++){
          const j=index?index.getX(i):i;v.fromBufferAttribute(p,j).applyMatrix4(matrix);n.fromBufferAttribute(normal,j).applyNormalMatrix(normalMatrix);
          v.toArray(positions,offset);n.toArray(normals,offset);mesh.material.color.toArray(colours,offset);offset+=3;
        }
      }
      const geometry=new THREE.BufferGeometry(),mesh=new THREE.Mesh(geometry,material);mesh.name=`${pivot!.name}_ParakeetBatch`;derived.push(mesh);
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
    }
  }catch{derived.forEach(m=>m.geometry.dispose());material.dispose();return false;}
  // Both sides prepared before touching the live template. One material shared
  // by both derived geometries; the template cache owns their eventual disposal.
  pivots.forEach((pivot,i)=>{for(const mesh of [...pivot!.children])pivot!.remove(mesh);pivot!.add(derived[i]);});
  new Set(old.map(m=>m.geometry)).forEach(g=>g.dispose());new Set(old.map(m=>m.material)).forEach(m=>m.dispose());
  return true;
}
