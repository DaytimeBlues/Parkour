import * as THREE from 'three';
import {tokenPosition,type TokenRun} from '../simulation/tokens.ts';
/** Real thick 3D coins. Still (including reduced-motion), non-solid, never camera billboards. */
function faceTexture(value:10|50){
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Coin canvas unavailable');
 ctx.clearRect(0,0,128,128);ctx.fillStyle='#17263d';ctx.font='900 60px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(value),64,68);
 const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export function createTokenScene(parent:THREE.Group,run:TokenRun){
 const root=new THREE.Group();root.name='collectible-3d-coins';parent.add(root);
 const materials={10:new THREE.MeshStandardMaterial({color:0xffd460,metalness:.55,roughness:.3}),50:new THREE.MeshStandardMaterial({color:0xffa73b,metalness:.6,roughness:.28})};
 const rim=new THREE.MeshStandardMaterial({color:0x513418,metalness:.35,roughness:.4});
 const faces={10:new THREE.MeshBasicMaterial({map:faceTexture(10),transparent:true,depthWrite:false}),50:new THREE.MeshBasicMaterial({map:faceTexture(50),transparent:true,depthWrite:false})};
 const geometries:THREE.BufferGeometry[]=[];
 const coins=run.tokens.map(token=>{
  const coin=new THREE.Group(),radius=token.value===50?.44:.36,segments=token.value===50?4:24;
  const discGeometry=new THREE.CylinderGeometry(radius,radius,.14,segments);discGeometry.rotateX(Math.PI/2);geometries.push(discGeometry);
  coin.add(new THREE.Mesh(discGeometry,materials[token.value]));
  for(const side of [-1,1]){const borderGeometry=new THREE.TorusGeometry(radius*.88,.025,6,token.value===50?4:24);geometries.push(borderGeometry);const border=new THREE.Mesh(borderGeometry,rim);border.position.z=side*.075;coin.add(border);
   const faceGeometry=new THREE.PlaneGeometry(radius*1.55,radius*1.55);geometries.push(faceGeometry);const face=new THREE.Mesh(faceGeometry,faces[token.value]);face.position.z=side*.086;face.rotation.y=side<0?Math.PI:0;coin.add(face);}
  root.add(coin);return coin;
 });
 function update(seconds:number){run.tokens.forEach((token,i)=>{const at=tokenPosition(token,seconds);coins[i].visible=!run.collected.has(token.id);coins[i].position.set(at.x,at.y,at.z);});}
 update(0);return {update,dispose(){parent.remove(root);root.clear();geometries.forEach(g=>g.dispose());Object.values(materials).forEach(m=>m.dispose());rim.dispose();Object.values(faces).forEach(m=>{m.map?.dispose();m.dispose();});}};
}
