import * as THREE from 'three';
import type {FlowCourse} from '../simulation/flow-course.ts';
import {tunnelBoxes,TUNNEL_TOP} from '../simulation/tunnel-course.ts';
/** Low service housings: physical shell, readable mouth, floor run-up and visible ramp exit. */
export function createTunnelScene(root:THREE.Group,course:FlowCourse){
 if(!course.tunnels?.length)return {dispose(){}};
 const textures:THREE.Texture[]=[];const labels:THREE.Sprite[]=[];
 const shell=new THREE.MeshStandardMaterial({color:0x355263,roughness:.7}),trim=new THREE.MeshStandardMaterial({color:0xffd16a,roughness:.6}),dark=new THREE.MeshStandardMaterial({color:0x182e40,roughness:.8}),cyan=new THREE.MeshBasicMaterial({color:0x50e3e1});
 const iconCanvas=document.createElement('canvas');iconCanvas.width=256;iconCanvas.height=96;const iconContext=iconCanvas.getContext('2d')!;iconContext.fillStyle='#10243c';iconContext.fillRect(0,0,256,96);iconContext.fillStyle='#ffe08a';iconContext.font='bold 72px system-ui';iconContext.textAlign='center';iconContext.fillText('C  ↓',128,76);const iconMap=new THREE.CanvasTexture(iconCanvas);iconMap.colorSpace=THREE.SRGBColorSpace;textures.push(iconMap);const iconMaterial=new THREE.MeshBasicMaterial({map:iconMap});
 function box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.name=name;m.position.set(x,y,z);root.add(m);return m;}
 function label(text:string,x:number,y:number,z:number){const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;const c=canvas.getContext('2d')!;c.fillStyle='#10243c';c.fillRect(0,0,768,192);c.strokeStyle='#50e3e1';c.lineWidth=8;c.strokeRect(4,4,760,184);c.fillStyle='#ffffff';c.font='bold 33px system-ui';c.textAlign='center';text.split('\n').forEach((line,i)=>c.fillText(line,384,66+i*59));const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;textures.push(map);const s=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:true}));s.name='service-tunnel-instructions';s.position.set(x,y,z);s.scale.set(7,1.75,1);root.add(s);labels.push(s);}
 for(const t of course.tunnels??[]){
  for(const b of tunnelBoxes(t)){const m=box(`${t.id}:${b.name}`,b.w,b.h,b.d,b.x,b.y,b.z,shell);m.userData.tunnelSolid={...b};}
  const duckIcon=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.42),iconMaterial);duckIcon.name=`${t.id}:fixed-duck-icon`;duckIcon.position.set(t.x,t.y+t.clearance+.3,t.front+.035);root.add(duckIcon);
  for(let row=0;row<3;row++)box(`${t.id}:front-vent-${row}`,t.w-.8,.065,.035,t.x,t.y+1.95+row*.2,t.front+.025,dark);
  // Inset ribs and roof vents form one service housing, not freestanding hurdles.
  for(let i=0;i<5;i++){const z=t.front-(t.front-t.back)*(i+.5)/5;box(`${t.id}:vent-${i}`,t.w-.5,.06,.10,t.x,t.y+TUNNEL_TOP+.03,z,dark);}
  for(const z of [t.front,t.back]){
   box(`${t.id}:mouth-top`,t.w,.13,.045,t.x,t.y+t.clearance+.08,z+(z===t.front?.025:-.025),trim);
   for(const side of [-1,1])box(`${t.id}:mouth-side`,.06,t.clearance,.045,t.x+side*(t.w/2+.03),t.y+t.clearance/2,z+(z===t.front?.025:-.025),trim);
  }
  // Floor markings are non-solid, shallow and wholly within the clear corridor.
  for(const z of [t.cueZ,t.cueZ+.45,(t.front+t.back)/2,t.back-.45])for(const side of [-1,1]){const m=box(`${t.id}:floor-chevron`,.08,.025,.62,t.x+side*.22,t.y+.115,z,cyan);m.rotation.y=side*Math.PI/4;}
  for(const side of [-1,1])box(`${t.id}:guide-cap`,.42,.06,t.front-t.wallBack,t.x+side*(t.w/2+.2),t.y+TUNNEL_TOP+.03,(t.front+t.wallBack)/2,dark);
  label(`${t.label}\nC AT CHEVRONS · +50 INSIDE · STAIRS BYPASS`,t.x,t.y+3.9,t.front+.25);
 }
 return {dispose(){textures.forEach(t=>t.dispose());labels.forEach(s=>s.material.dispose());/* Mesh resources owned by main clearScene. */}};
}
