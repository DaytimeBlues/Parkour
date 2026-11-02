import * as THREE from 'three';
import {rampVertices,type FlowCourse} from '../simulation/flow-course.ts';
import {createTunnelScene} from './tunnels.ts';
export function createFlowScene(parent:THREE.Group,course:FlowCourse){
 const root=new THREE.Group();root.name='flow-ramps-and-slide-arches';parent.add(root);
 const tunnels=createTunnelScene(root,course);
 const textures:THREE.Texture[]=[];
 function label(text:string,x:number,y:number,z:number){const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;const c=canvas.getContext('2d')!;c.fillStyle='#10243c';c.fillRect(0,0,768,192);c.strokeStyle='#ffdf77';c.lineWidth=8;c.strokeRect(4,4,760,184);c.fillStyle='#fff3cc';c.font='bold 36px system-ui';c.textAlign='center';text.split('\n').forEach((line,i)=>c.fillText(line,384,66+i*59,720));const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;textures.push(map);const s=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:true}));s.position.set(x,y,z);s.scale.set(7.5,1.875,1);root.add(s);}
 for(const r of course.ramps){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(rampVertices(r),3));g.setIndex([0,1,3,0,3,2,4,6,7,4,7,5,0,4,5,0,5,1,2,3,7,2,7,6,0,2,6,0,6,4,1,5,7,1,7,3]);g.computeVertexNormals();const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x27cbd4,roughness:.55,side:THREE.DoubleSide}));mesh.position.set(r.x,r.y,r.z);root.add(mesh);
  // The stripe sits on the exact wedge plane. Clear geometry, not a fake horizontal ramp.
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.2,.035,r.d-.3),new THREE.MeshBasicMaterial({color:0x10243c}));stripe.position.set(r.x,r.y+r.rise/2+.03,r.z);stripe.rotation.x=Math.atan(r.rise/r.d);root.add(stripe);
  label('RAMP → HOLD SPACE TO GLIDE\nWASD / ARROWS · RELEASE SPACE TO DIVE',r.x,r.y+3.8,r.z-2);
 }
 for(const a of course.arches){const material=new THREE.MeshStandardMaterial({color:0xd89152,roughness:.7});const roof=new THREE.Mesh(new THREE.BoxGeometry(a.w+.4,.6,a.d),material);roof.position.set(a.x,a.y+a.clearance+.3,a.z);root.add(roof);for(const side of [-1,1]){const post=new THREE.Mesh(new THREE.BoxGeometry(.4,a.clearance,a.d),material);post.position.set(a.x+side*(a.w/2+.2),a.y+a.clearance/2,a.z);root.add(post);}label('C · SLIDE UNDER\nGOLD STAIRS = SAFE ROUTE',a.x,a.y+3.8,a.z);}
 const start=course.platforms[0],safe=course.platforms.find(p=>p.id===start.next)!;label(`SAFE STAIRS ${safe.x<0?'←':'→'}   /   CYAN RAMP = FAST\nBOTH ROUTES REJOIN EVERY CHECKPOINT`,0,5,2);
 return {dispose(){textures.forEach(t=>t.dispose());tunnels.dispose();root.traverse(o=>{if(o instanceof THREE.Sprite&&o.name!=='service-tunnel-instructions')o.material.dispose();});/* Mesh resources are owned by main clearScene. */}};
}
