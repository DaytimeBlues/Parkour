import * as THREE from 'three';
import {GliderPose,type GliderFrame} from './glider-pose.ts';
/** Original procedural viewmodel: no external assets, loader, animation rig or collider. */
export function createGlider(camera:THREE.PerspectiveCamera){
 const root=new THREE.Group();root.name='first-person-hang-glider';root.visible=false;camera.add(root);
 const canopy=new THREE.Group();canopy.name='overhead-canopy';root.add(canopy);
 const frame=new THREE.Group();frame.name='control-frame-and-hands';root.add(frame);
 const geometries=new Set<THREE.BufferGeometry>(),materials:THREE.MeshStandardMaterial[]=[];
 function material(color:number,metalness=0){const m=new THREE.MeshStandardMaterial({color,metalness,roughness:.58,side:THREE.FrontSide,transparent:true,opacity:0,depthTest:true,depthWrite:true,fog:false});materials.push(m);return m;}
 const cloth=material(0x36c6ca),clothGold=material(0xffd16a),spar=material(0x22384e,.4),grip=material(0x102232),glove=material(0xe5b567),sleeve=material(0x53798c),strap=material(0x253647);
 function mesh(parent:THREE.Group,geometry:THREE.BufferGeometry,mat:THREE.Material,name:string){geometries.add(geometry);const m=new THREE.Mesh(geometry,mat);m.name=name;m.renderOrder=1000;m.frustumCulled=false;parent.add(m);return m;}
 function bar(parent:THREE.Group,a:number[],b:number[],radius:number,mat:THREE.Material,name:string){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const m=mesh(parent,new THREE.CylinderGeometry(radius,radius,delta.length(),8),mat,name);m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;}
 function panel(points:number[],mat:THREE.Material,name:string){mat.side=THREE.DoubleSide;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.computeVertexNormals();return mesh(canopy,g,mat,name);}
 // The sail stays above the sightline; a swept trailing edge leaves the horizon open.
 for(const side of [-1,1]){
  panel([0,1.12,-1.95, side*1.65,.95,-1.8, side*1.25,.57,-1.15, 0,1.12,-1.95,side*1.25,.57,-1.15,0,.8,-1.02],cloth,`canopy-${side}`);
  // Derive the trim from the sail's A-C-D plane; offset its visible normal,
  // rather than a guessed quadrilateral that could intersect the cyan cloth.
  const a=new THREE.Vector3(0,1.12,-1.95),c=new THREE.Vector3(side*1.25,.57,-1.15),d=new THREE.Vector3(0,.8,-1.02);
  const normal=c.clone().sub(a).cross(d.clone().sub(a)).normalize();if(normal.dot(a)>0)normal.negate();normal.multiplyScalar(.006);
  const stripe=[a,a.clone().lerp(c,.14),d.clone().lerp(c,.14),d].map(v=>v.clone().add(normal));
  panel([0,1,2,0,2,3].flatMap(i=>stripe[i].toArray()),clothGold,`sail-stripe-${side}`);
  bar(canopy,[0,1.12,-1.95],[side*1.65,.95,-1.8],.025,spar,`leading-spar-${side}`);
  bar(canopy,[side*1.65,.95,-1.8],[side*1.25,.57,-1.15],.018,spar,`wing-tip-${side}`);
  bar(canopy,[side*1.25,.57,-1.15],[0,.8,-1.02],.018,spar,`trailing-rim-${side}`);
  bar(frame,[side*1.05,.6068,-1.1292],[side*.68,-.53,-.92],.018,spar,`side-support-${side}`);
  bar(frame,[side*.92,1.0252,-1.8664],[side*.62,-.55,-1.01],.007,strap,`suspension-line-${side}`);
  bar(frame,[side*.82,-.92,-.48],[side*.56,-.55,-.92],.075,sleeve,`forearm-${side}`);
  const hand=mesh(frame,new THREE.CapsuleGeometry(.071,.095,4,8),glove,`gripping-hand-${side}`);hand.position.set(side*.55,-.52,-.93);hand.rotation.z=Math.PI/2;
  for(let finger=0;finger<3;finger++){const f=mesh(frame,new THREE.TorusGeometry(.039,.012,5,8,Math.PI*1.45),glove,`wrapped-finger-${side}-${finger}`);f.position.set(side*.55+(finger-1)*.035,-.532,-.919);f.rotation.y=Math.PI/2;f.rotation.z=.2;}
  bar(frame,[side*.55,-.51,-.9],[side*.55,-.58,-.87],.023,glove,`thumb-${side}`);
  bar(frame,[side*.65,-.73,-.65],[side*.8,-.96,-.53],.024,strap,`harness-edge-${side}`);
 }
 bar(frame,[-.7,-.53,-.92],[.7,-.53,-.92],.023,spar,'low-control-bar');
 for(const side of [-1,1])bar(frame,[side*.45,-.53,-.92],[side*.64,-.53,-.92],.032,grip,`rubber-grip-${side}`);
 const pose=new GliderPose();
 function update(input:GliderFrame){pose.update(input);root.visible=pose.visible;const t=pose.deployment,ease=t*t*(3-2*t);root.rotation.set(-.055*(1-ease),0,pose.bank);root.position.set(pose.sway,pose.lift,0);root.scale.x=Math.min(2,Math.max(.35,Number.isFinite(camera.aspect)?camera.aspect/1.65:1));materials.forEach(m=>{m.opacity=t;});}
 function reset(){pose.reset();root.visible=false;root.rotation.set(0,0,0);root.position.set(0,0,0);materials.forEach(m=>{m.opacity=0;});}
 reset();return {root,pose,update,reset,dispose(){camera.remove(root);root.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
