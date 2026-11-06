import * as THREE from 'three';
import {ARENA} from '../../shared/multiplayer.mjs';
import type {buildFortressArt} from '../multiplayer/scene.ts';
type ArenaArt=ReturnType<typeof buildFortressArt>;
type Instance={x:number;y:number;z:number;sx:number;sy:number;sz:number;color:number;rx?:number;ry?:number;rz?:number};

/** Explicit local artwork opt-in, never a saved setting or release default. */
export function woodlandPreviewEnabled(development:boolean,search:string){
 return development&&new URLSearchParams(search).get('visualPreview')==='woodland';
}

/** Takes ownership of a fresh base art graph. Shared simulation is read-only.
 * Every traversable solid remains an exact ARENA box; foliage is decoration.
 * This structural prototype does not establish WebGL/FPS/device acceptance. */
export function woodlandArena(base:ArenaArt):ArenaArt{
 const root=base.root;
 if(root.userData.woodlandPreview)throw new Error('Woodland artwork already applied');
 root.userData.woodlandPreview=true;root.userData.stage='UNACCEPTED_DEVELOPMENT_WOODLAND_ART';root.name='woodland-arena-candidate';
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();let disposed=false;
 const own=<T extends THREE.BufferGeometry>(geometry:T)=>{geometries.add(geometry);return geometry;};
 const material=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true});materials.add(material);
 const dummy=new THREE.Object3D(),color=new THREE.Color();
 function batch(name:string,geometry:THREE.BufferGeometry,entries:Instance[],surface:THREE.Material=material){
  const mesh=new THREE.InstancedMesh(geometry,surface,entries.length);mesh.name=name;mesh.userData.decorativeOnly=true;
  entries.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.sx,p.sy,p.sz);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,color.setHex(p.color));});
  mesh.computeBoundingBox();mesh.computeBoundingSphere();root.add(mesh);return mesh;
 }
 // Retain every exact centre/extent; collapse old colour batches into one draw.
 const old=root.children.filter(o=>o.name==='collision-geometry') as THREE.InstancedMesh[];
 if(!old.length)throw new Error('Authoritative collision-art instances missing');
 const cube=old[0].geometry,position=cube.attributes.position,normals=cube.attributes.normal,colors=[];
 for(let i=0;i<position.count;i++){
  const light=normals.getY(i)>.9?1:normals.getY(i)<-.9?.48:.73;
  colors.push(light,light*(normals.getY(i)>.9?1:.95),light*(normals.getY(i)>.9?1:.86));
 }
 cube.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 for(const mesh of old){root.remove(mesh);mesh.dispose();}
 const stone=batch('collision-geometry',cube,ARENA.boxes.map(b=>({x:b.x,y:b.y,z:b.z,sx:b.w,sy:b.h,sz:b.d,color:b.id.includes('stair')?0xc6ab78:b.id==='fortress-deck'?0xd7cbae:0xcab58d})));
 stone.userData.decorativeOnly=false;stone.userData.sourceIds=ARENA.boxes.map(b=>b.id);

 const edges=root.getObjectByName('exact-box-edges') as THREE.LineSegments;
 if(edges){(edges.material as THREE.LineBasicMaterial).color.setHex(0x45523d);(edges.material as THREE.LineBasicMaterial).opacity=.3;}
 const underside=root.getObjectByName('underside-rocks') as THREE.InstancedMesh;
 if(underside)(underside.material as THREE.MeshLambertMaterial).color.setHex(0x58614c);
 const clouds=root.getObjectByName('clouds') as THREE.InstancedMesh;
 if(clouds)clouds.geometry=own(new THREE.SphereGeometry(1,6,4));
 const route=root.getObjectByName('flat-route-chevrons') as THREE.InstancedMesh;
 if(route)(route.material as THREE.MeshBasicMaterial).color.setHex(0x315c38);
 for(const label of base.labels)if(label.id.startsWith('spawn-'))label.detail='FOLLOW THE GREEN ROUTE';
 for(const zone of ARENA.zones){
  const border=root.getObjectByName(`capture-boundary-${zone.id}`) as THREE.Mesh;
  if(border)(border.material as THREE.MeshBasicMaterial).color.setHex(0x354b32);
  const emblem=root.getObjectByName(`zone-symbol-${zone.shape}`) as THREE.Mesh;
  if(emblem)(emblem.material as THREE.MeshLambertMaterial).color.setHex(0x43603d);
 }

 // Flat colour inlays are paint-like surface detail, not extra solid geometry.
 const inlays:Instance[]=[];
 for(let x=-54;x<=54;x+=18)for(let z=-38;z<=38;z+=19){
  const px=x+Math.sin(x*.7+z)*2,pz=z+Math.cos(z*.4+x)*2;
  if([...ARENA.zones,...ARENA.pads].some(p=>Math.hypot(px-p.x,pz-p.z)<p.radius+7))continue;
  if(ARENA.boxes.some(b=>b.id!=='fortress-deck'&&Math.abs(px-b.x)<b.w/2+5&&Math.abs(pz-b.z)<b.d/2+5))continue;
  inlays.push({x:px,y:.004,z:pz,sx:3.4+(Math.abs(x+z)%4),sy:1,sz:2.8+(Math.abs(x-z)%3),ry:x+z,color:[0x829a54,0x95a960,0xa6b873][inlays.length%3]});
 }
 const contour=Array.from({length:24},(_,i)=>{const a=i/24*Math.PI*2,r=1+.13*Math.sin(a*3)+.08*Math.sin(a*5)+.05*Math.cos(a*7);return new THREE.Vector2(Math.cos(a)*r,Math.sin(a)*r);});
 const patch=own(new THREE.ShapeGeometry(new THREE.Shape(contour)));patch.rotateX(-Math.PI/2);
 const moss=new THREE.MeshLambertMaterial({color:0xffffff,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});materials.add(moss);
 batch('woodland-flat-moss-inlays',patch,inlays,moss);

 // Backdrop vegetation is well outside reachable horizontal bounds. It does
 // not add a misleading landing surface or change the authoritative arena.
 const trees=([-1,1].flatMap(side=>[-42,-14,14,42].map(z=>({x:side*82,z})))
  .concat([-1,1].flatMap(side=>[-52,-18,18,52].map(x=>({x,z:side*68})))));
 const stems:Instance[]=[],branches:Instance[]=[],crowns:Instance[]=[],islands:Instance[]=[];
 trees.forEach((p,i)=>{
  const height=22+i%4,baseY=-10;
  stems.push({x:p.x,y:baseY+height/2,z:p.z,sx:6,sy:height,sz:6,ry:i*.8,color:0x795338});
  islands.push({x:p.x,y:-18,z:p.z,sx:7,sy:16,sz:6,ry:i*.7,color:0x686e58});
  for(let side of [-1,1])branches.push({x:p.x+side*1.7,y:baseY+height*.83,z:p.z+.3,sx:2,sy:6.2,sz:2,rz:side*-.62,ry:i*.4,color:0x795338});
  for(let j=0;j<3;j++)crowns.push({x:p.x+Math.sin(j*2.1+i)*4,y:baseY+height+(j===1?2.2:0),z:p.z+Math.cos(j*2.1+i)*3,sx:5+(i+j)%3*.5,sy:4.1+j*.38,sz:4.3+(i+j)%2*.7,color:[0x899f41,0xa1b74c,0x708d39][(i+j)%3],ry:i*.57+j});
 });
 const trunk=own(new THREE.CylinderGeometry(.32,.66,1,7,1));
 // Four original taper rings add a gentle S bend rather than pole silhouettes.
 const barkPositions:number[]=[],barkIndices:number[]=[],rings=[[0,-.5,0,.66],[.08,-.18,-.03,.52],[-.05,.2,.04,.40],[.07,.5,.06,.32]],N=7;
 for(const[x,y,z,r]of rings)for(let i=0;i<N;i++){const a=i/N*Math.PI*2;barkPositions.push(x+Math.cos(a)*r,y,z+Math.sin(a)*r);}
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<N;i++){const a=j*N+i,b=j*N+(i+1)%N,c=(j+1)*N+(i+1)%N,d=(j+1)*N+i;barkIndices.push(a,d,b,b,d,c);}
 for(let i=1;i<N-1;i++)barkIndices.push(0,i,i+1,(rings.length-1)*N,(rings.length-1)*N+i+1,(rings.length-1)*N+i);
 const curvedTrunk=own(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(barkPositions,3)));curvedTrunk.setIndex(barkIndices);curvedTrunk.computeVertexNormals();
 batch('woodland-backdrop-trunks',curvedTrunk,stems);batch('woodland-backdrop-branches',trunk,branches);
 const leaf=own(new THREE.DodecahedronGeometry(1,0)),leafColors:number[]=[];
 for(let i=0;i<leaf.attributes.position.count;i++){const shade=.8+.2*(leaf.attributes.position.getY(i)+1)/2;leafColors.push(shade,shade,shade);}
 leaf.setAttribute('color',new THREE.Float32BufferAttribute(leafColors,3));batch('woodland-backdrop-crowns',leaf,crowns);
 batch('woodland-backdrop-rocks',own(new THREE.IcosahedronGeometry(1,0)),islands);
 root.userData.collisionContract='EXACT_SHARED_ARENA_BOXES_NO_NEW_SOLIDS';
 return{...base,update(...args){if(!disposed)base.update(...args);},dispose(){if(disposed)return;disposed=true;base.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.clear();}};
}
