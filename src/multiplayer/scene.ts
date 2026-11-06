import * as THREE from 'three';
import { ARENA, PLAYER, STALE_MS } from '../../shared/multiplayer.mjs';
import { appearanceFactory } from './remote-avatar.ts';
import { AppearanceAssets } from '../render/appearance-assets.ts';
import {skinPreviewOptions,showSkinPreviewNotice} from '../render/skin-preview.ts';
import { appearanceCode } from '../../shared/appearance.mjs';
import {woodlandArena,woodlandPreviewEnabled} from '../render/woodland-arena.ts';
import type { Room, Runner } from './client';

const colors={red:0xef675d,blue:0x50b8f5,neutral:0xffdf79};
const shapes:Record<string,string>={circle:'●',square:'■',diamond:'◆',triangle:'▲',pentagon:'⬟'};
type Sample={time:number;player:Runner};
type Label={id:string;title:string;detail:string;x:number;y:number;z:number};
export const GRAPHICS_BUDGET=Object.freeze({pixelRatio:1.5,cloudInstances:24,staticDrawCalls:72,staticTriangles:12000,staticMaterials:40,foxDrawCalls:7,foxTriangles:420});
export const ownerLabel=(owner:string|null|undefined)=>owner==='red'?'▲ RED':owner==='blue'?'■ BLUE':'○ NEUTRAL';
export function captureTied(state:unknown){const c=(state as {counts?:{red:number;blue:number}}|undefined)?.counts;return !!c&&c.red>0&&c.red===c.blue;}

/** Structural budget, not a GPU/FPS measurement. Instanced triangles count per instance. */
export function geometryBudget(root:THREE.Object3D){let drawCalls=0,triangles=0,instances=0,meshes=0;const geometries=new Set(),materials=new Set();root.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line){meshes++;const materialList=Array.isArray(object.material)?object.material:[object.material];materialList.forEach(m=>materials.add(m));geometries.add(object.geometry);drawCalls+=materialList.length;const count=object instanceof THREE.InstancedMesh?object.count:1;instances+=count;if(object instanceof THREE.Mesh)triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*count;}});return{drawCalls,triangles,instances,meshes,geometries:geometries.size,materials:materials.size};}

/** Headless-testable world art. Every solid traversable box is an exact ARENA instance. */
export function buildFortressArt(){
  const root=new THREE.Group();root.name='skyfortress-art';const geos=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>(),palette=new Map<number,THREE.MeshLambertMaterial>(),labels:Label[]=[];
  const geo=<T extends THREE.BufferGeometry>(g:T)=>{geos.add(g);return g;};const mat=<T extends THREE.Material>(m:T)=>{mats.add(m);return m;};const color=(c:number)=>{if(!palette.has(c))palette.set(c,mat(new THREE.MeshLambertMaterial({color:c})));return palette.get(c)!;};
  const cube=geo(new THREE.BoxGeometry(1,1,1)),dummy=new THREE.Object3D();
  function instances(name:string,g:THREE.BufferGeometry,m:THREE.Material,entries:{x:number;y:number;z:number;sx:number;sy:number;sz:number;rx?:number;ry?:number;rz?:number;id?:string}[]){const mesh=new THREE.InstancedMesh(g,m,entries.length);mesh.name=name;mesh.userData.sourceIds=entries.map(e=>e.id);entries.forEach((e,i)=>{dummy.position.set(e.x,e.y,e.z);dummy.scale.set(e.sx,e.sy,e.sz);dummy.rotation.set(e.rx??0,e.ry??0,e.rz??0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});mesh.computeBoundingBox();mesh.computeBoundingSphere();root.add(mesh);return mesh;}
  const groups=new Map<number,typeof ARENA.boxes>();for(const b of ARENA.boxes){const c=b.color??0x8393a8;if(!groups.has(c))groups.set(c,[]);groups.get(c)!.push(b);}for(const[c,boxes]of groups)instances('collision-geometry',cube,color(c),boxes.map(b=>({id:b.id,x:b.x,y:b.y,z:b.z,sx:b.w,sy:b.h,sz:b.d})));
  const edgePositions:number[]=[];for(const b of ARENA.boxes.filter(b=>!b.id.includes('stair'))){const e=new THREE.EdgesGeometry(cube);const v=e.attributes.position;for(let i=0;i<v.count;i++)edgePositions.push(b.x+v.getX(i)*b.w,b.y+v.getY(i)*b.h,b.z+v.getZ(i)*b.d);e.dispose();}const outlines=new THREE.LineSegments(geo(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3))),mat(new THREE.LineBasicMaterial({color:0x536982,transparent:true,opacity:.48})));outlines.name='exact-box-edges';root.add(outlines);
  // Faceted underside is below the lowest walkable deck: scenery, never a false route.
  instances('underside-rocks',geo(new THREE.ConeGeometry(1,1,5)),color(0x526984),[[-48,-32],[48,-32],[-48,32],[48,32],[0,0]].map(([x,z])=>({x,y:-13,z,sx:13,sy:20,sz:13,rz:Math.PI})));
  instances('clouds',geo(new THREE.SphereGeometry(1,8,5)),mat(new THREE.MeshBasicMaterial({color:0xf5fbff,transparent:true,opacity:.4,depthWrite:false})),Array.from({length:GRAPHICS_BUDGET.cloudInstances},(_,i)=>({x:(i*43)%230-115,y:-21-i%4*3,z:(i*61)%220-110,sx:9+i%5,sy:1.8,sz:5+i%3})));
  const grid:number[]=[];for(let x=-64;x<=64;x+=16)grid.push(x,.016,-48,x,.016,48);for(let z=-48;z<=48;z+=16)grid.push(-64,.016,z,64,.016,z);root.add(new THREE.LineSegments(geo(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(grid,3))),mat(new THREE.LineBasicMaterial({color:0xc4d3df,transparent:true,opacity:.27}))));
  const arrow=geo(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-.42,0,.42,0,0,-.5,.42,0,.42],3)));arrow.computeVertexNormals();const routes:{x:number;y:number;z:number;sx:number;sy:number;sz:number;ry:number}[]=[];
  for(const route of[[[-55,35],[-22,35],[-20,30]],[[55,35],[20,35],[15,13]],[[20,35],[9,42]],[[-22,35],[-15,13]]])for(let j=1;j<route.length;j++){const a=route[j-1],b=route[j],dx=b[0]-a[0],dz=b[1]-a[1],n=Math.floor(Math.hypot(dx,dz)/4);for(let k=1;k<=n;k++){const t=k/(n+1);routes.push({x:a[0]+dx*t,y:.025,z:a[1]+dz*t,sx:1.3,sy:1,sz:1.3,ry:Math.atan2(-dx,-dz)});}}instances('flat-route-chevrons',arrow,mat(new THREE.MeshBasicMaterial({color:0xffe3a0,side:THREE.DoubleSide})),routes);
  const circle=geo(new THREE.CylinderGeometry(1,1,.035,40)),ring=geo(new THREE.TorusGeometry(1,.012,3,48)),padDisc=geo(new THREE.CylinderGeometry(1,1,.06,24));
  for(const kind of['launch','updraft'])instances(`${kind}-pad-surfaces`,padDisc,color(kind==='updraft'?0x50ccc6:0xeec16e),ARENA.pads.filter(p=>p.kind===kind).map(p=>({id:p.id,x:p.x,y:p.y+.035,z:p.z,sx:p.radius,sy:1,sz:p.radius})));
  instances('updraft-rings',ring,mat(new THREE.MeshBasicMaterial({color:0xb3fff1,transparent:true,opacity:.65})),ARENA.pads.filter(p=>p.kind==='updraft').flatMap(p=>[2.5,6,9.5,13].map(h=>({x:p.x,y:p.y+h,z:p.z,sx:p.radius,sy:p.radius,sz:p.radius,rx:Math.PI/2}))));
  for(const p of ARENA.pads)labels.push({id:p.id,title:p.kind==='updraft'?'↑ UPDRAFT':'↗ LAUNCH',detail:p.kind==='updraft'?'HOLD SPACE TO RISE':'HOLD SPACE TO GLIDE',x:p.x,y:p.y+2.7,z:p.z});
  for(const[team,p]of Object.entries(ARENA.spawns))labels.push({id:`spawn-${team}`,title:team==='red'?'▲ RED TEAM':'■ BLUE TEAM',detail:'FOLLOW THE GOLD ROUTE',x:p.x,y:3,z:p.z});
  labels.push({id:'west-tunnel',title:'WEST SERVICE TUNNEL',detail:'C · CROUCH THROUGH',x:-31,y:3.8,z:0},{id:'east-tunnel',title:'EAST SERVICE TUNNEL',detail:'C · CROUCH THROUGH',x:31,y:3.8,z:0});
  type ZoneArt={fill:THREE.MeshBasicMaterial;flag:THREE.MeshLambertMaterial;arc:THREE.Line;red:THREE.Mesh;blue:THREE.Mesh;progress:number;contested:boolean};const zones=new Map<string,ZoneArt>();
  const ownerTriangle=geo(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0,.3),new THREE.Vector2(-.3,-.25),new THREE.Vector2(.3,-.25)]))),ownerSquare=geo(new THREE.PlaneGeometry(.52,.52));
  for(const z of ARENA.zones){
    const fill=mat(new THREE.MeshBasicMaterial({color:colors.neutral,transparent:true,opacity:.2,depthWrite:false}));const disk=new THREE.Mesh(circle,fill);disk.name=`zone-floor-${z.id}`;disk.position.set(z.x,z.y+.035,z.z);disk.scale.set(z.radius,1,z.radius);root.add(disk);
    const border=new THREE.Mesh(ring,mat(new THREE.MeshBasicMaterial({color:0xf1f7fc})));border.name=`capture-boundary-${z.id}`;border.position.set(z.x,z.y+.07,z.z);border.rotation.x=Math.PI/2;border.scale.setScalar(z.radius);root.add(border);
    // Shape identifies the zone; the separate triangle/square ownership glyph identifies the owner.
    const polygon=geo(new THREE.CylinderGeometry(.8,.8,.05,z.shape==='circle'?24:z.shape==='triangle'?3:z.shape==='pentagon'?5:4));const emblem=new THREE.Mesh(polygon,color(0xe9f2f8));emblem.position.set(z.x,z.y+.08,z.z);if(z.shape==='square')emblem.rotation.y=Math.PI/4;emblem.name=`zone-symbol-${z.shape}`;root.add(emblem);
    const pole=new THREE.Mesh(cube,color(0x334b66));pole.position.set(z.x+z.radius+.7,z.y+2,z.z);pole.scale.set(.1,4,.1);root.add(pole);const flag=mat(new THREE.MeshLambertMaterial({color:colors.neutral,side:THREE.DoubleSide}));const banner=new THREE.Mesh(geo(new THREE.PlaneGeometry(2.2,1.2)),flag);banner.position.set(pole.position.x+1.1,z.y+3.25,z.z);root.add(banner);
    const symbolMaterial=color(0x10213b);const red=new THREE.Mesh(ownerTriangle,symbolMaterial),blue=new THREE.Mesh(ownerSquare,symbolMaterial);red.position.set(banner.position.x,z.y+3.25,z.z+.012);blue.position.copy(red.position);red.visible=blue.visible=false;red.name='owner-triangle';blue.name='owner-square';root.add(red,blue);
    const points=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2;return new THREE.Vector3(z.x+Math.sin(a)*(z.radius+.17),z.y+.095,z.z-Math.cos(a)*(z.radius+.17));});const arc=new THREE.Line(geo(new THREE.BufferGeometry().setFromPoints(points)),mat(new THREE.LineBasicMaterial({color:colors.red})));arc.name=`capture-progress-${z.id}`;arc.geometry.setDrawRange(0,0);arc.visible=false;root.add(arc);
    labels.push({id:`zone-${z.id}`,title:`${shapes[z.shape]} ${z.label}`,detail:'○ NEUTRAL',x:z.x,y:z.y+5.5,z:z.z});zones.set(z.id,{fill,flag,arc,red,blue,progress:0,contested:false});
  }
  function update(room:Pick<Room,'zones'>,time:number,reducedMotion:boolean){for(const state of room.zones){const z=zones.get(state.id);if(!z)continue;z.fill.color.setHex(state.owner?colors[state.owner]:colors.neutral);z.flag.color.copy(z.fill.color);z.red.visible=state.owner==='red';z.blue.visible=state.owner==='blue';z.progress=Math.abs(state.progress);z.contested=!!(state as typeof state&{contested?:boolean}).contested;(z.arc.material as THREE.LineBasicMaterial).color.setHex(state.progress>=0?colors.red:colors.blue);z.arc.visible=z.progress>0;z.arc.geometry.setDrawRange(0,z.progress>0?Math.max(2,Math.floor(z.progress/5000*64)+1):0);z.fill.opacity=z.contested&&!reducedMotion?.2+Math.sin(time*2)*.035:.2;}}
  function dispose(){root.traverse(object=>{if(object instanceof THREE.InstancedMesh)object.dispose();});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());}
  return{root,labels,zones,update,dispose};
}

export function createFortress(host:HTMLElement,onAssetError:()=>void=()=>{}){
  const appearanceEnv=(import.meta as ImportMeta & {env:{BASE_URL:string;DEV:boolean}}).env;
  const woodlandPreview=woodlandPreviewEnabled(appearanceEnv.DEV,location.search);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,GRAPHICS_BUDGET.pixelRatio));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;host.append(renderer.domElement);renderer.domElement.tabIndex=-1;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x9ec3d3);scene.fog=new THREE.Fog(0x9ec3d3,145,300);const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.08,320);camera.rotation.order='YXZ';camera.position.set(0,48,83);camera.lookAt(0,3,0);
  const hemisphere=new THREE.HemisphereLight(0xf5f8ff,0x41516f,2.35);scene.add(hemisphere);const sun=new THREE.DirectionalLight(0xffe8c1,2.4);sun.position.set(-55,80,30);scene.add(sun);let art=buildFortressArt();
  if(appearanceEnv.DEV&&woodlandPreview){art=woodlandArena(art);scene.background=new THREE.Color(0xb8d3bb);scene.fog=new THREE.Fog(0xb8d3bb,135,290);hemisphere.color.setHex(0xfff4db);hemisphere.groundColor.setHex(0x354832);hemisphere.intensity=1.9;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;}
  scene.add(art.root);const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const labelTextures:THREE.Texture[]=[],labelMaterials:THREE.Material[]=[],labelUpdates=new Map<string,(title:string,detail:string)=>void>();
  for(const item of art.labels){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=128;const ctx=canvas.getContext('2d')!;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;labelTextures.push(texture);const material=new THREE.SpriteMaterial({map:texture,depthTest:true,depthWrite:false});labelMaterials.push(material);const sprite=new THREE.Sprite(material);sprite.name=`label-${item.id}`;sprite.position.set(item.x,item.y,item.z);sprite.scale.set(8.5,1.7,1);scene.add(sprite);let prior='';const update=(title:string,detail:string)=>{const key=title+detail;if(key===prior)return;prior=key;ctx.clearRect(0,0,640,128);ctx.fillStyle='#10213bf2';ctx.fillRect(0,0,640,128);ctx.strokeStyle='#bad9e5';ctx.lineWidth=3;ctx.strokeRect(2,2,636,124);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.font='bold 28px system-ui';ctx.fillText(title,320,42,610);ctx.fillStyle='#ffe6a0';ctx.font='bold 23px system-ui';ctx.fillText(detail,320,89,610);texture.needsUpdate=true;};update(item.title,item.detail);labelUpdates.set(item.id,update);}
  const skinPreview=skinPreviewOptions(appearanceEnv.BASE_URL,appearanceEnv.DEV,location.search);if(appearanceEnv.DEV)showSkinPreviewNotice(skinPreview.characterAssetBase!==undefined||woodlandPreview);
  const factory=appearanceFactory(new AppearanceAssets(appearanceEnv.BASE_URL,undefined,{batchParakeet:true,batchAvatars:true,...skinPreview}),onAssetError), avatars=new Map<string,ReturnType<typeof factory.create>>(), samples=new Map<string,Sample[]>();let received=0,serverTime=0,current:Room|null=null,localId='';
  function snapshot(room:Room,id:string){current=room;localId=id;received=performance.now();serverTime=room.serverTime;
    art.update(room,0,true);for(const z of room.zones){const definition=ARENA.zones.find(d=>d.id===z.id)!;const contested=!!(z as typeof z&{contested?:boolean}).contested;const progress=Math.round(Math.abs(z.progress)/50);labelUpdates.get(`zone-${z.id}`)?.(`${shapes[definition.shape]} ${definition.label}`,`${ownerLabel(z.owner)}${captureTied(z)?' · TIED / PAUSED':contested?' · CONTESTED':progress>0&&progress<100?` · ${z.progress>=0?'▲':'■'} ${progress}%`:''}`);}
    const ids=new Set(room.players.filter(p=>p.id!==id).map(p=>p.id));for(const [id,avatar] of avatars)if(!ids.has(id)){scene.remove(avatar.root);avatar.dispose();avatars.delete(id);samples.delete(id);}
    for(const p of room.players){if(p.id===id)continue;let a=avatars.get(p.id);if(a&&appearanceCode(a.appearance)!==appearanceCode(p.appearance)){a.dispose();avatars.delete(p.id);a=undefined;}if(!a){a=factory.create(p.team,p.appearance);avatars.set(p.id,a);scene.add(a.root);}let history=samples.get(p.id);if(!history){history=[];samples.set(p.id,history);}if(!history.length||room.serverTime>history.at(-1)!.time)history.push({time:room.serverTime,player:{...p}});while(history.length>10)history.shift();}
  }
  function render(now:number,own:Runner|null,yaw:number,pitch:number){
    if(own){camera.position.set(own.x,own.y+(own.sliding?PLAYER.slideEye:PLAYER.eye),own.z);camera.rotation.set(pitch,yaw,0);}else{camera.position.set(0,48,83);camera.lookAt(0,3,0);}
    const target=serverTime+(now-received)-200;
    for(const [id,avatar]of avatars){const history=samples.get(id)!;const last=history.at(-1)!;avatar.root.visible=last.player.connected!==false&&now-received<STALE_MS&&current?.status!=='lobby';if(!avatar.root.visible)continue;
      let a=history[0],b=a;for(let i=1;i<history.length;i++){b=history[i];if(b.time>=target)break;a=b;}
      const t=b.time>a.time?Math.max(0,Math.min(1,(target-a.time)/(b.time-a.time))):0;const p=b.player;
      avatar.root.position.set(THREE.MathUtils.lerp(a.player.x,p.x,t),THREE.MathUtils.lerp(a.player.y,p.y,t),THREE.MathUtils.lerp(a.player.z,p.z,t));
      const angle=Math.atan2(Math.sin(p.yaw-a.player.yaw),Math.cos(p.yaw-a.player.yaw));avatar.root.rotation.y=a.player.yaw+angle*t;
      // Discrete animation state follows the rendered interpolation timeline, not a future sample.
      const motion=t<1?a.player:p;avatar.pose(now/1000,Math.hypot(THREE.MathUtils.lerp(a.player.vx,p.vx,t),THREE.MathUtils.lerp(a.player.vz,p.vz,t)),motion.grounded,motion.gliding,motion.sliding,reducedMotion.matches,current?.status==='paused');
    }
    if(current)art.update(current,now/1000,reducedMotion.matches);renderer.render(scene,camera);
  }
  const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};window.addEventListener('resize',resize);
  function clear(){for(const avatar of avatars.values())avatar.dispose();avatars.clear();samples.clear();current=null;}
  function dispose(){window.removeEventListener('resize',resize);clear();void factory.dispose();art.dispose();labelTextures.forEach(t=>t.dispose());labelMaterials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  return {canvas:renderer.domElement,snapshot,render,clear,dispose};
}

export function drawRadar(canvas:HTMLCanvasElement,room:Room,own:Runner|null){
  if(canvas.width<320){canvas.width=320;canvas.height=320;}const ctx=canvas.getContext('2d');if(!ctx)return;const size=canvas.width;ctx.clearRect(0,0,size,size);ctx.fillStyle='#0d2338';ctx.fillRect(0,0,size,size);const b=ARENA.bounds,scale=Math.min((size-36)/(b.maxX-b.minX),(size-70)/(b.maxZ-b.minZ));const xy=(x:number,z:number)=>[size/2+x*scale,size/2+z*scale] as const;
  ctx.strokeStyle='#799bb4';ctx.lineWidth=1.5;ctx.strokeRect(size/2+b.minX*scale,size/2+b.minZ*scale,(b.maxX-b.minX)*scale,(b.maxZ-b.minZ)*scale);
  ctx.fillStyle='#29445b';ctx.strokeStyle='#3d5b71';ctx.lineWidth=1;for(const block of ARENA.boxes){if(block.id==='fortress-deck'||block.id.includes('stair'))continue;const[x,y]=xy(block.x-block.w/2,block.z-block.d/2);ctx.fillRect(x,y,block.w*scale,block.d*scale);ctx.strokeRect(x,y,block.w*scale,block.d*scale);}
  for(const pad of ARENA.pads){const[x,y]=xy(pad.x,pad.z);ctx.fillStyle='#8de4d6';ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.fillText(pad.kind==='updraft'?'↑':'↗',x,y+4);}
  for(const z of ARENA.zones){const state=room.zones.find(s=>s.id===z.id),[x,y]=xy(z.x,z.z);const c=state?.owner==='red'?'#ffacaa':state?.owner==='blue'?'#98ddff':'#ffe7a3';ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,z.radius*scale,0,Math.PI*2);ctx.stroke();
    const progress=Math.abs(state?.progress??0)/5000;if(progress>0&&progress<1){ctx.strokeStyle=(state?.progress??0)>=0?'#ffacaa':'#98ddff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,z.radius*scale+3,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();}
    ctx.fillStyle=c;ctx.beginPath();const sides=z.shape==='circle'?0:z.shape==='triangle'?3:z.shape==='pentagon'?5:4;if(!sides)ctx.arc(x,y,5,0,Math.PI*2);else for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2-Math.PI/2+(z.shape==='square'?Math.PI/4:0);const px=x+6*Math.cos(a),py=y+6*Math.sin(a);if(!i)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.fill();
    const contested=!!(state as typeof state&{contested?:boolean})?.contested;const label=z.label.replace(' COURT','').replace(' TOWER','');ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillStyle='#071827';ctx.fillRect(x-40,y+13,80,26);ctx.fillStyle='#f2f8ff';ctx.fillText(label,x,y+23);ctx.fillStyle=c;ctx.font='bold 9px system-ui';ctx.fillText(`${ownerLabel(state?.owner)}${captureTied(state)?' = TIED':contested?' !':progress>0&&progress<1?` ${(state?.progress??0)>=0?'▲':'■'}${Math.round(progress*100)}%`:''}`,x,y+35);
  }
  // Enemy coordinates deliberately never enter radar drawing or labels.
  if(own)for(const p of room.players){if(p.team!==own.team||p.connected===false)continue;const q=p.id===own.id?own:p,[x,y]=xy(q.x,q.z);ctx.fillStyle=p.team==='red'?'#ffacaa':'#98ddff';ctx.strokeStyle='#fff';ctx.lineWidth=p.id===own.id?2.5:1;ctx.beginPath();if(p.team==='red'){ctx.moveTo(x,y-5);ctx.lineTo(x-4,y+3);ctx.lineTo(x+4,y+3);ctx.closePath();}else ctx.rect(x-3.5,y-3.5,7,7);ctx.fill();ctx.stroke();if(p.id===own.id){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.sin(q.yaw)*12,y-Math.cos(q.yaw)*12);ctx.stroke();}}
  ctx.fillStyle='#e5f1f8';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('N ↑',size/2,16);ctx.font='10px system-ui';ctx.fillText(own?`${own.team==='red'?'▲ RED':'■ BLUE'} TEAMMATES · ! CONTESTED`:'ZONES ONLY · ! CONTESTED',size/2,size-10);
}
