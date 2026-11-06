import {createMenuSteps} from './ui/menu-steps';
import { FrameProfile, profilingEnabled } from './dev/frame-profile';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { activeFrameSeconds, physicsFrameSeconds } from './simulation/timing';
import { platformX, validBest, type Platform } from './simulation/courses';
import { Boost, BoostInputLatch, BOOST_SPEED } from './simulation/boost';
import { MusicPlayer, StartGate } from './simulation/music';
import { STEP, SPEED, JUMP, GRAVITY, HALF, RADIUS, EYE } from './simulation/physics';
import { createMarkerMaterials, markerYaw } from './render/markers';
import { puzzlePlatforms, puzzlePortals } from './simulation/puzzle-course';
import { PuzzleRun, type PuzzleInput } from './simulation/puzzle';
import { createPuzzleScene } from './render/puzzle-scene';
import { createLeaderboardUI } from './leaderboard-ui';
import { TokenRun } from './simulation/tokens';
import { createTokenScene } from './render/tokens';
import {type FlowCourse} from './simulation/flow-course';
import {FlowRun} from './simulation/flow';
import {glideCourseId,glideBestKey} from './simulation/glide-rules';
import {createFlowScene} from './render/flow-scene';
import {courses as shippingCourses,courseSets as shippingCourseSets,courseSetFor as shippingCourseSetFor,bestKey,type CourseSet} from './simulation/course-catalog';
import {createWingView} from './render/wing-view';
import {AppearanceAssets} from './render/appearance-assets';
import {skinPreviewOptions,showSkinPreviewNotice} from './render/skin-preview.ts';
import {loadAppearance,canOpenAppearance} from './simulation/appearance';
import {createAppearanceMenu} from './appearance-menu';
import {GameplayKeys, movementInput, canCaptureGameplayKey, isKeyboardUI} from './simulation/keyboard';
import {rootbridgePreview} from './dev/rootbridge-preview.ts';
import {createRootbridgeScene} from './render/rootbridge-scene.ts';
import {createRootbridgeTokens} from './render/rootbridge-tokens.ts';
const DEVELOPMENT=(import.meta as ImportMeta & {env:{DEV:boolean}}).env.DEV;
const woodlandPreview=DEVELOPMENT?rootbridgePreview(true,location.search):undefined;
const courses=woodlandPreview?[...shippingCourses,woodlandPreview]:shippingCourses;
type PreviewCourseSet=CourseSet|'woodland';
const courseSets:[PreviewCourseSet,string][]=[...shippingCourseSets,...(woodlandPreview?[['woodland','WOODLAND · DEV PRACTICE'] as [PreviewCourseSet,string]]:[])];
const courseSetFor=(id:string):PreviewCourseSet=>DEVELOPMENT&&woodlandPreview?.id===id?'woodland':shippingCourseSetFor(id);
const isWoodlandSelected=()=>DEVELOPMENT&&woodlandPreview!==undefined&&courses[selected]===woodlandPreview;
let flowRun:FlowRun|null=null,flowArt:ReturnType<typeof createFlowScene>|null=null;
let courseSet:PreviewCourseSet=woodlandPreview?'woodland':'tunnels';

const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const game=$<HTMLDivElement>('game'), overlay=$<HTMLDivElement>('overlay'), hud=$<HTMLDivElement>('hud'), start=$<HTMLButtonElement>('start'), picker=$<HTMLDivElement>('course-picker');
const menuSteps=createMenuSteps(overlay,['mode','solo'],'mode');
$('choose-solo').addEventListener('click',()=>menuSteps.show('solo'));
const boostStatus=$<HTMLSpanElement>('boost-status');
const tokenScore=$<HTMLOutputElement>('token-score'),tokenFeedback=$<HTMLSpanElement>('token-feedback'),restart=$<HTMLButtonElement>('restart');
let tokenRun:TokenRun,tokenArt:ReturnType<typeof createTokenScene>|null=null;
function updateTokenHUD(){tokenScore.textContent=`${tokenRun.score} POINTS · ${tokenRun.collected.size} / ${tokenRun.total}`;}
function collectTokens(){const picked=tokenRun.collect(body.translation(),simulationTime,phase);if(picked.length){updateTokenHUD();tokenFeedback.textContent=`+${picked.reduce((n,t)=>n+t.value,0)} · ${picked.some(t=>t.value===50)?'BONUS TOKEN':'TOKEN'}`;}}

const objective=document.createElement('div');objective.className='puzzle-objective';objective.hidden=true;hud.appendChild(objective);
let puzzleRun:PuzzleRun|null=null,puzzleArt:ReturnType<typeof createPuzzleScene>|null=null;
const puzzleInput=():PuzzleInput=>movementInput(keys);
function courseDescription(){if(isWoodlandSelected())return 'Rootbridge Hollow · development practice. Follow leaf marks and short SPACE hops through four checkpoints. C ducks under the left roots; the right walking lane and gold stairs are safe bypasses. Hold SPACE anywhere airborne to glide; release to dive. The left ramp adds a launch boost. Missed flight has a lower catch boardwalk and return leaves. Falls add 3 seconds. This layout has separate device-only times and no shared ranking. ';if(courseSetFor(courses[selected].id)==='tunnels')return 'C-slide through the marked service tunnels to reach the fast ramps and collect a low 50-point coin. Time C at the floor chevrons; crouch early if you prefer. Gold stairs bypass every tunnel. Hold SPACE anywhere airborne to glide; steer with WASD or arrow keys. Ramps add a finite launch boost. Map-wide glide has separate records. Flow I and Legacy remain available. ';if(selected>=5)return 'Real 3D coins: 10-point discs, 50-point diamonds. Choose the gold stairs or the faster cyan ramps at every checkpoint. C slides under low arches. Hold SPACE anywhere airborne to glide, WASD or arrow keys to steer, release SPACE to dive. Ramps add a finite launch boost. Map-wide glide has separate records; historical records remain stored. ';return 'Collect floating 10-point circles and 50-point bonus diamonds. Token points are local, separate from speed times. '+(selected===4?'Climb three connected chambers. Step on both coloured relays to open their linked warps. Hold Shift/E while grounded, then release to boost. Follow the gold stairs for the safe route; charged shortcuts save time.':'Follow the gold arrows up the tower. Falls add 3 seconds. Tap Shift/E for a committed burst: aim first, then land to recharge.');}
const musicTrack=$<HTMLSpanElement>('music-track'), musicMute=$<HTMLButtonElement>('music-mute'), musicNext=$<HTMLButtonElement>('music-next'), musicVolume=$<HTMLInputElement>('music-volume');
const startGate=new StartGate();
let legacyStart=false;
function cancelStart(token?:number){const pending=startGate.cancel(token);if(pending)start.disabled=false;return pending;}
const music=new MusicPlayer(new Audio(),()=>{musicTrack.textContent=`${music.track.title} · ${music.status==='blocked'?'blocked—press Start to retry':music.status==='error'?'unavailable—skip track':music.status}`;musicMute.textContent=music.muted?'UNMUTE':'MUTE';musicMute.setAttribute('aria-pressed',String(music.muted));});
musicMute.addEventListener('click',()=>music.setMuted(!music.muted));musicNext.addEventListener('click',()=>music.next());musicVolume.addEventListener('input',()=>music.setVolume(Number(musicVolume.value)));
const timer=$<HTMLDivElement>('timer'), cpText=$<HTMLSpanElement>('checkpoint'), courseName=$<HTMLSpanElement>('course-name'), description=$<HTMLParagraphElement>('description'), fine=$<HTMLParagraphElement>('fine'), error=$<HTMLDivElement>('error');

const format=(s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${String(Math.floor(s*100)%100).padStart(2,'0')}`;
const keyFor=(id:string)=>DEVELOPMENT&&woodlandPreview?.id===id?glideBestKey(id):glideCourseId(id)!==id?glideBestKey(id):bestKey(id);
function getBest(id:string):number|null {try {const raw=localStorage.getItem(keyFor(id));return raw===null?null:validBest(Number(raw));}catch{return null;}}
function saveBest(id:string,time:number):boolean {const best=getBest(id);if(best!==null&&best<=time)return false;try{localStorage.setItem(keyFor(id),String(time));return true;}catch{return false;}}
let renderer:THREE.WebGLRenderer;
try {renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});} catch {error.hidden=false;error.textContent='This game needs WebGL. Try a browser with hardware acceleration enabled.';overlay.hidden=true;throw new Error('WebGL unavailable');}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;game.appendChild(renderer.domElement);renderer.domElement.tabIndex=-1;
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,300);camera.rotation.order='YXZ';scene.add(camera);const baselinePixelRatio=renderer.getPixelRatio(),baselineToneMapping=renderer.toneMapping,baselineExposure=renderer.toneMappingExposure;
const appearance=loadAppearance({getItem:key=>localStorage.getItem(key)});
const appearanceEnv=(import.meta as ImportMeta & {env:{BASE_URL:string;DEV:boolean}}).env;
const skinPreview=skinPreviewOptions(appearanceEnv.BASE_URL,appearanceEnv.DEV,location.search);
if(appearanceEnv.DEV)showSkinPreviewNotice(skinPreview.characterAssetBase!==undefined||woodlandPreview!==undefined);
const appearanceAssets=new AppearanceAssets(appearanceEnv.BASE_URL,undefined,{...skinPreview,...(woodlandPreview?{batchParakeet:true}:{})});
let glider:Awaited<ReturnType<typeof createWingView>>;
try{glider=await createWingView(camera,appearanceAssets,appearance.wing);}catch{error.hidden=false;error.textContent='Wings could not load. Reload to retry; no run has started.';start.disabled=true;throw new Error('Appearance assets unavailable');}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let glideLateralSpeed=0;
const hemi=new THREE.HemisphereLight(0xe7f8ff,0x657591,2), sun=new THREE.DirectionalLight(0xfff4dc,2);sun.position.set(-20,35,10);scene.add(hemi,sun);
const courseGroup=new THREE.Group();scene.add(courseGroup);let activeSky:Sky|null=null;const markers=createMarkerMaterials();
const mat=(c:number)=>new THREE.MeshStandardMaterial({color:c,roughness:.85});
function addBox(group:THREE.Group,w:number,h:number,d:number,material:THREE.Material,x:number,y:number,z:number){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);group.add(m);return m;}
type Moving={platform:Platform; visual:THREE.Group; body:RAPIER.RigidBody; x:number};
await RAPIER.init();
let world:RAPIER.World,body:RAPIER.RigidBody,collider:RAPIER.Collider,controller:RAPIER.KinematicCharacterController, moving:Moving[]=[];
let rider:Moving|null=null,riderOffset=0;
let arrows:{root:THREE.Group;from:Platform;to:Platform}[]=[];
let selected=woodlandPreview?courses.length-1:5,phase:'ready'|'starting'|'playing'|'paused'|'finished'='ready',yaw=0,pitch=0,vy=0,elapsed=0,checkpoint=0,falls=0,grounded=false,coyote=0,jumpBuffer=0,last=performance.now(),acc=0,simulationTime=0;const keys=new GameplayKeys(),boostKeys=new BoostInputLatch(),boost=new Boost();
const appearanceMenu=createAppearanceMenu(start.parentElement!,appearance,appearanceAssets,async value=>{await glider.setStyle(value.wing);Object.assign(appearance,value);},()=>canOpenAppearance(phase,startGate.isPending,document.pointerLockElement!==null));
const leaderboard=createLeaderboardUI(overlay,()=>isWoodlandSelected()?null:glideCourseId(courses[selected].id));let rankedStart:Promise<boolean>|null=null,playEpoch=0,needsRankedStart=false;
$('solo-back').addEventListener('click',()=>{pause();cancelStart();music.pause();leaderboard.lock(false);playEpoch++;if(document.pointerLockElement===renderer.domElement)document.exitPointerLock();menuSteps.show('mode');});
function clearScene(){courseGroup.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else if(o.material!==markers.arrow)o.material.dispose();}});courseGroup.clear();}
function buildCourse(){
 glider.reset();glideLateralSpeed=0;
 tokenArt?.dispose();tokenArt=null;if(world)world.free();flowRun=null;flowArt?.dispose();flowArt=null;puzzleRun=null;puzzleArt?.dispose();puzzleArt=null;clearScene();activeSky=null;const course=courses[selected];scene.background=new THREE.Color(course.sky);scene.fog=new THREE.Fog(course.fog,45,145);hemi.color.setHex(course.light);hemi.intensity=selected===3?1.6:2;sun.intensity=selected===3?.9:2;renderer.shadowMap.enabled=selected===4;renderer.shadowMap.type=THREE.PCFSoftShadowMap;sun.castShadow=selected===4;if(selected===4){sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;sun.shadow.camera.far=110;sun.shadow.bias=-.0004;}
 renderer.setPixelRatio(isWoodlandSelected()?Math.min(devicePixelRatio,1.5):baselinePixelRatio);renderer.toneMapping=isWoodlandSelected()?THREE.ACESFilmicToneMapping:baselineToneMapping;renderer.toneMappingExposure=isWoodlandSelected()?.95:baselineExposure;
 if(isWoodlandSelected()){
  const preview=course as FlowCourse;flowRun=new FlowRun(preview);world=flowRun.world;body=flowRun.body;collider=flowRun.collider;controller=flowRun.controller;moving=[];arrows=[];rider=null;
  flowArt=createRootbridgeScene(courseGroup,preview);tokenRun=new TokenRun(preview);tokenArt=createRootbridgeTokens(courseGroup,tokenRun);return;
 }
 // Sky addon is part of the installed MIT-licensed Three.js package. Geometry remains unobscured by fog nearby.
 if(selected<2){const sky=new Sky();activeSky=sky;sky.scale.setScalar(200);sky.material.uniforms.turbidity.value=selected===1?8:4;sky.material.uniforms.rayleigh.value=selected===1?1.8:2.5;sky.material.uniforms.mieCoefficient.value=.005;sky.material.uniforms.mieDirectionalG.value=.8;sky.material.uniforms.sunPosition.value.set(-10,selected===1?3:30,-55);courseGroup.add(sky);}
 if(selected===3){const verts:number[]=[];for(let i=0;i<180;i++)verts.push(((i*43)%180)-90,20+(i*17)%55,-((i*37)%150));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));courseGroup.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xdafaff,size:.25})));for(let i=0;i<3;i++){const ribbon=new THREE.Mesh(new THREE.TorusGeometry(34+i*4,.15,5,64,Math.PI),new THREE.MeshBasicMaterial({color:[0x81f7c2,0x70cddf,0x9ea9ee][i],transparent:true,opacity:.5}));ribbon.rotation.set(.45,.1,.2);ribbon.position.set(0,32+i*2,-65);courseGroup.add(ribbon);}}
 const ground=mat(course.ground),rock=mat(course.rock),edge=mat(course.edge);world=new RAPIER.World({x:0,y:-GRAVITY,z:0});moving=[];arrows=[];rider=null;
 course.platforms.forEach((p,i)=>{const group=new THREE.Group();const x=platformX(p,0);group.position.set(x,p.y,p.z);courseGroup.add(group);addBox(group,p.w,.65,p.d,ground,0,-.325,0);addBox(group,p.w-.2,.1,p.d-.2,edge,0,.05,0);const bottom=new THREE.Mesh(new THREE.ConeGeometry(Math.min(p.w,p.d)*.55,3,5),rock);bottom.position.y=-1.8;bottom.rotation.y=i;group.add(bottom);
  if(!p.goal){const pp=selected===4?puzzlePlatforms[i]:null;const portal=selected===4&&pp?.id.startsWith('relay-')?puzzlePortals[Number(pp.id.slice(-1))-1]:null;const next=selected>=5?course.platforms.find(v=>(v as {id?:string}).id===(p as {next?:string}).next)??p:selected===4?(portal?{...p,x:portal.entry.x,z:portal.entry.z}:puzzlePlatforms.find(v=>v.id===pp?.next)??p):course.platforms[i+1];const arrow=new THREE.Mesh(new THREE.PlaneGeometry(1.35,1.35),markers.arrow);arrow.rotation.x=-Math.PI/2;const arrowRoot=new THREE.Group();arrowRoot.position.y=.18;arrowRoot.rotation.y=markerYaw(next.x-p.x,next.z-p.z);arrowRoot.add(arrow);group.add(arrowRoot);arrows.push({root:arrowRoot,from:p,to:next});}
  if(p.checkpoint||p.goal){const badge=new THREE.Sprite(p.goal?markers.finish:markers.checkpoint);badge.position.set(p.goal?0:-p.w/2+.85,1.7,p.goal?0:.65);badge.scale.set(2,2,1);group.add(badge);}
  // Small scenery is well away from jump paths and is not collision geometry.
  if(i===0){for(const side of [-1,1]){const tree=new THREE.Mesh(new THREE.ConeGeometry(.5,1.5,5),rock);tree.position.set(side*(p.w/2-.8),.75,2.8);group.add(tree);}}
  if(p.move){const rb=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x,p.y-.325,p.z));world.createCollider(RAPIER.ColliderDesc.cuboid(p.w/2,.325,p.d/2),rb);moving.push({platform:p,visual:group,body:rb,x});}else world.createCollider(RAPIER.ColliderDesc.cuboid(p.w/2,.325,p.d/2).setTranslation(x,p.y-.325,p.z));
 });
 for(let i=0;i<24;i++){const cloud=new THREE.Mesh(new THREE.SphereGeometry(1.6+(i%3),8,5),new THREE.MeshBasicMaterial({color:selected===2?0x96a4ae:0xffffff,transparent:true,opacity:.35}));cloud.position.set(((i*37)%90)-45,-9-(i%4)*2,-((i*29)%100));cloud.scale.set(2,.35,1);courseGroup.add(cloud);}
 body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,1.5,2));collider=world.createCollider(RAPIER.ColliderDesc.capsule(HALF,RADIUS),body);controller=world.createCharacterController(.03);controller.setMaxSlopeClimbAngle(Math.PI/4);controller.setMinSlopeSlideAngle(Math.PI/3);
 if(selected===4){world.free();puzzleRun=new PuzzleRun();world=puzzleRun.world;body=puzzleRun.body;collider=puzzleRun.collider;controller=puzzleRun.controller;puzzleArt=createPuzzleScene(courseGroup);}
 if(selected>=5){world.free();flowRun=new FlowRun(course as FlowCourse);world=flowRun.world;body=flowRun.body;collider=flowRun.collider;controller=flowRun.controller;flowArt=createFlowScene(courseGroup,course as FlowCourse);}
 tokenRun=new TokenRun(course);tokenArt=createTokenScene(courseGroup,tokenRun);
}
function selectCourse(i:number){if(i===selected)return true;if(leaderboard.client.awaitingSubmission){fine.textContent='Your shared finish is still syncing. Retry sync, or explicitly discard the shared submission first.';return false;}selected=i;phase='ready';buildCourse();reset();start.innerHTML='START RUN <span>↗</span>';description.textContent=courseDescription();fine.textContent='Desktop keyboard and mouse required. Timer pauses while paused.';return true;}
function drawPicker(){picker.replaceChildren();courses.forEach((c,i)=>{if(courseSetFor(c.id)!==courseSet)return;const b=document.createElement('button');b.className='course-button';b.type='button';b.setAttribute('aria-pressed',String(i===selected));const title=document.createElement('strong');title.textContent=c.name.toUpperCase();const subtitle=document.createElement('small');const best=getBest(c.id);subtitle.textContent=`${c.subtitle} · ${best===null?'NO BEST YET':`BEST ${format(best)}`}`;b.append(title,subtitle);b.addEventListener('click',()=>{if(selectCourse(i))drawPicker();});picker.append(b);});for(const [set,b] of setButtons)b.setAttribute('aria-pressed',String(set===courseSet));}
const setButtons=new Map<PreviewCourseSet,HTMLButtonElement>();const setNav=document.createElement('nav');setNav.className='course-sets';setNav.setAttribute('aria-label','Course versions and records');picker.before(setNav);for(const [set,label] of courseSets){const b=document.createElement('button');b.type='button';b.className='restart-run';b.textContent=label;setButtons.set(set,b);setNav.append(b);b.addEventListener('click',()=>{if(set===courseSet)return;const i=courses.findIndex(c=>courseSetFor(c.id)===set);if(selectCourse(i)){courseSet=set;drawPicker();}});}
function checkpointPositions(){const a=[{x:0,y:1.5,z:2}];for(const p of courses[selected].platforms)if(p.checkpoint)a[p.checkpoint]={x:p.x,y:p.y+1.5,z:p.z};return a;}
function reset(){glider.reset();glideLateralSpeed=0;cancelStart();tokenRun.reset();tokenArt?.update(0);updateTokenHUD();tokenFeedback.textContent='10 = circle · 50 = diamond';restart.hidden=true;if(document.pointerLockElement===renderer.domElement)document.exitPointerLock();phase='ready';playEpoch++;rankedStart=null;leaderboard.reset();leaderboard.lock(false);puzzleRun?.reset();flowRun?.reset();objective.hidden=!puzzleRun&&!flowRun;$<HTMLDivElement>('hud').querySelector<HTMLElement>('.hint')!.textContent=flowRun?'WASD / ARROWS move · SPACE jump / hold to glide · C slide · ESC pause':puzzleRun?'WASD / ARROWS move · SPACE jump · HOLD SHIFT / E, RELEASE boost · ESC pause':'WASD / ARROWS move · SPACE jump · SHIFT boost · ESC pause';const p=checkpointPositions()[0];body.setTranslation(p,true);body.setNextKinematicTranslation(p);yaw=0;pitch=0;vy=0;elapsed=0;checkpoint=0;falls=0;grounded=false;coyote=0;jumpBuffer=0;simulationTime=0;rider=null;keys.clear();boostKeys.clear();boost.reset();cpText.textContent=`CHECKPOINT 0 / ${courses[selected].platforms.filter(p=>p.checkpoint).length}`;courseName.textContent=courses[selected].name.toUpperCase();}
function pause(){if(phase!=='playing'&&phase!=='starting')return;restart.hidden=false;start.disabled=false;phase='paused';cancelStart();keys.clear();boostKeys.clear();jumpBuffer=0;music.pause();puzzleRun?.pause();flowRun?.pause();overlay.hidden=false;picker.hidden=false;drawPicker();start.innerHTML='RESUME RUN <span>↗</span>';description.textContent=flowRun?'Paused. Slide/ramp boost timers and local time are frozen. Resume clears held controls; hold SPACE again to glide while airborne.':puzzleRun?`Paused. ${puzzleRun.lastEvent} Charging is cancelled; an active burst resumes unchanged.`:boost.remaining>0?'Paused mid-boost: your committed burst resumes when you continue.':'Take a breath. Your timer is paused. Choose another course to start it from the beginning.';fine.textContent='Click resume to capture your mouse again.';}
restart.addEventListener('click',()=>{if(leaderboard.client.awaitingSubmission){fine.textContent='Finish sync or discard the pending shared submission before restarting.';return;}reset();overlay.hidden=false;picker.hidden=false;start.innerHTML='START RUN <span>↗</span>';description.textContent=courseDescription();fine.textContent='New run ready. Token points, checkpoints and time reset.';});
start.addEventListener('click',()=>{
 if(leaderboard.client.awaitingSubmission){fine.textContent='Your shared finish is still syncing. Retry sync, or explicitly discard the shared submission first.';return;}
 if(phase==='finished')reset();const token=startGate.begin();if(token===null)return;needsRankedStart=phase==='ready';start.disabled=true;playEpoch++;
 leaderboard.lock(true);void music.play();
 try{const promise=renderer.domElement.requestPointerLock();legacyStart=!(promise&&typeof promise.catch==='function');if(promise&&typeof promise.catch==='function')promise.catch(()=>{if(!cancelStart(token))return;music.pause();leaderboard.lock(false);fine.textContent='Mouse capture was blocked. Click this game window and try again.';});}catch{if(!cancelStart(token))return;music.pause();leaderboard.lock(false);fine.textContent='Mouse capture was blocked. Click this game window and try again.';}
});
document.addEventListener('pointerlockchange',async()=>{
 if(document.pointerLockElement!==renderer.domElement){pause();return;}
 if(!startGate.accept()){document.exitPointerLock();music.pause();return;}
 if(needsRankedStart){rankedStart=leaderboard.client.begin(glideCourseId(courses[selected].id),leaderboard.enabled());needsRankedStart=false;}
 const attempt=playEpoch,wait=rankedStart;phase='starting';start.disabled=true;
 if(leaderboard.client.state==='starting'){description.textContent='Preparing the shared server clock…';fine.textContent='Your ranked clock includes pauses and network delay. Practice is available offline.';}
 const ready=wait?await wait:true;if(attempt!==playEpoch)return;rankedStart=null;start.disabled=false;
 if(!ready){phase='ready';music.pause();document.exitPointerLock();overlay.hidden=false;leaderboard.lock(false);description.textContent=courseDescription();fine.textContent='Shared ranking could not start. Retry, or uncheck ranked mode for practice.';return;}
 if(document.pointerLockElement!==renderer.domElement){phase='paused';overlay.hidden=false;start.innerHTML='RESUME RUN <span>↗</span>';return;}
 phase='playing';overlay.hidden=true;hud.hidden=false;renderer.domElement.focus({preventScroll:true});last=performance.now();acc=0;
});
document.addEventListener('pointerlockerror',()=>{if(!legacyStart||!cancelStart())return;music.pause();leaderboard.lock(false);fine.textContent='Mouse capture was blocked. Click this game window and try again.';});
document.addEventListener('mousemove',e=>{if(phase==='playing'&&document.pointerLockElement===renderer.domElement){yaw-=e.movementX*.0023;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.0023));}});
document.addEventListener('keydown',e=>{if(!canCaptureGameplayKey(e,phase==='playing'&&document.pointerLockElement===renderer.domElement))return;const movement=keys.press(e);if(movement){if(movement==='jump')jumpBuffer=.14;}else if(['ShiftLeft','ShiftRight','KeyE'].includes(e.code)){e.preventDefault();if(phase==='playing'&&!e.repeat){if(flowRun){return;}if(puzzleRun){puzzleRun.pressBoost(e.code,e.repeat);}else if(boostKeys.press(e.code,e.repeat)){let {forward:f,right:r}=movementInput(keys);const n=Math.hypot(f,r);if(n){f/=n;r/=n;}else f=1;boost.activate(Math.cos(yaw)*r-Math.sin(yaw)*f,-Math.sin(yaw)*r-Math.cos(yaw)*f);}}}});document.addEventListener('keyup',e=>{keys.delete(e.code);boostKeys.release(e.code);if(phase==='playing'&&puzzleRun){puzzleRun.yaw=yaw;puzzleRun.releaseBoost(e.code,puzzleInput());}});window.addEventListener('blur',()=>{keys.clear();cancelStart();music.pause();if(phase==='playing'||phase==='starting'){document.exitPointerLock();pause();}});document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelStart();music.pause();if(phase==='playing'||phase==='starting'){document.exitPointerLock();pause();}}});
document.addEventListener('focusin',e=>{if(phase==='playing'&&isKeyboardUI(e.target)){document.exitPointerLock();pause();}});
function respawnPlayer(){keys.clear();boostKeys.clear();boost.reset();rider=null;const p=checkpointPositions()[checkpoint];body.setTranslation(p,true);body.setNextKinematicTranslation(p);vy=0;grounded=false;coyote=0;jumpBuffer=0;falls++;elapsed+=3;}
function finish(){phase='finished';restart.hidden=true;leaderboard.lock(false);keys.clear();boostKeys.clear();boost.reset();music.pause();document.exitPointerLock();overlay.hidden=false;const best=saveBest(courses[selected].id,elapsed);drawPicker();description.textContent=`${courses[selected].name} complete · local time ${format(elapsed)} · ${falls} ${falls===1?'fall':'falls'} · ${tokenRun.score} token points (${tokenRun.collected.size}/${tokenRun.total}).`;fine.textContent=best?'New personal best on this device!':'Try again to beat your best.';start.innerHTML='RUN AGAIN <span>↗</span>';}
function update(dt:number){
 if(flowRun){const glidePrior=flowRun.position;flowRun.yaw=yaw;const priorFalls=flowRun.falls,penalty=flowRun.penalty;flowRun.step({...puzzleInput(),jump:jumpBuffer>0,glide:keys.has('Space'),slide:keys.has('KeyC')});jumpBuffer=0;simulationTime+=dt;elapsed+=flowRun.penalty-penalty;yaw=flowRun.yaw;grounded=flowRun.grounded;checkpoint=flowRun.checkpoint;falls=flowRun.falls;if(falls>priorFalls){keys.clear();boostKeys.clear();glider.reset();glideLateralSpeed=0;}else{const q=flowRun.position;glideLateralSpeed=((q.x-glidePrior.x)*Math.cos(yaw)-(q.z-glidePrior.z)*Math.sin(yaw))/dt;collectTokens();}cpText.textContent=`CHECKPOINT ${checkpoint} / 4`;objective.textContent=flowRun.lastEvent;if(flowRun.finished)finish();return;}

 if(puzzleRun){puzzleRun.yaw=yaw;const penalty=puzzleRun.penalty,priorFalls=puzzleRun.falls;puzzleRun.step({...puzzleInput(),jump:jumpBuffer>0});jumpBuffer=0;if(puzzleRun.falls>priorFalls){keys.clear();boostKeys.clear();}elapsed+=puzzleRun.penalty-penalty;yaw=puzzleRun.yaw;grounded=puzzleRun.grounded;checkpoint=puzzleRun.checkpoint;falls=puzzleRun.falls;cpText.textContent=`CHECKPOINT ${checkpoint} / 4 · RELAYS ${puzzleRun.relays.size} / 2`;objective.textContent=puzzleRun.lastEvent;if(puzzleRun.falls===priorFalls)collectTokens();if(puzzleRun.finished)finish();return;}
 const prior=body.translation();let support:Moving|null=null;for(const item of moving){const p=item.platform;if(grounded&&Math.abs(prior.x-item.x)<p.w/2-RADIUS*.3&&Math.abs(prior.z-p.z)<p.d/2-RADIUS*.3&&Math.abs(prior.y-(p.y+HALF+RADIUS+.03))<.18){support=item;break;}}if(support!==rider){rider=support;if(rider)riderOffset=prior.x-rider.x;}simulationTime+=dt;for(const item of moving){const next=platformX(item.platform,simulationTime);item.x=next;item.visual.position.x=next;item.body.setNextKinematicTranslation({x:next,y:item.platform.y-.325,z:item.platform.z});}for(const a of arrows)a.root.rotation.y=markerYaw(platformX(a.to,simulationTime)-platformX(a.from,simulationTime),a.to.z-a.from.z);
 coyote=grounded?.12:Math.max(0,coyote-dt);jumpBuffer=Math.max(0,jumpBuffer-dt);if(jumpBuffer>0&&coyote>0){vy=JUMP;jumpBuffer=0;coyote=0;grounded=false;}vy-=GRAVITY*dt;let {forward:f,right:r}=movementInput(keys);const length=Math.hypot(f,r);if(length){f/=length;r/=length;}let dx=(Math.cos(yaw)*r-Math.sin(yaw)*f)*SPEED*dt;let dz=(-Math.sin(yaw)*r-Math.cos(yaw)*f)*SPEED*dt;const burst=boost.step();if(burst){dx=burst.x*BOOST_SPEED*dt;dz=burst.z*BOOST_SPEED*dt;}if(rider&&grounded){riderOffset+=dx;dx=rider.x+riderOffset-prior.x;}else if(!grounded)rider=null;controller.computeColliderMovement(collider,{x:dx,y:vy*dt,z:dz});const m=controller.computedMovement(),p=body.translation();body.setNextKinematicTranslation({x:p.x+m.x,y:p.y+m.y,z:p.z+m.z});grounded=controller.computedGrounded();boost.finishStep(grounded);if(grounded&&vy<0)vy=0;else if(m.y<vy*dt-.01&&vy>0)vy=0;world.step();const q=body.translation();if(q.y<checkpointPositions()[checkpoint].y-12){respawnPlayer();return;}
 collectTokens();
 for(const platform of courses[selected].platforms){const x=platformX(platform,simulationTime);if(Math.abs(q.x-x)<platform.w/2-.2&&Math.abs(q.z-platform.z)<platform.d/2-.2&&Math.abs(q.y-(platform.y+HALF+RADIUS))<.5){if(platform.checkpoint&&platform.checkpoint>checkpoint){checkpoint=platform.checkpoint;cpText.textContent=`CHECKPOINT ${checkpoint} / ${courses[selected].platforms.filter(p=>p.checkpoint).length}`;}if(platform.goal){finish();return;}}}
}
// Explicit opt-in; no profile global, storage, or per-frame samples in production.
const profile=(import.meta as ImportMeta & {env:{DEV:boolean}}).env.DEV&&profilingEnabled(true,location.search)?new FrameProfile():null;
let profileLast:number|null=null;
if(profile)Object.defineProperty(window,'__skyboundProfile',{configurable:true,value:Object.freeze({
 reset:()=>{profile.reset();profileLast=null;},
 snapshot:()=>({metrics:profile.snapshot(),state:{course:courses[selected].id,phase,checkpoint,falls,grounded,elapsed,simulationTime,appearance:{...appearance},position:{...body.translation()},yaw,pitch,pointerLocked:document.pointerLockElement===renderer.domElement},environment:{width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio(),three:THREE.REVISION,visibility:document.visibilityState},timing:'CPU-side only; renderSubmitMs is not GPU time'})
})});
if(profile)document.addEventListener('visibilitychange',()=>{profileLast=null;});
function frame(now:number){requestAnimationFrame(frame);const profileStart=profile?performance.now():0;const interval=profileLast===null?null:now-profileLast;profileLast=now;const frameElapsed=activeFrameSeconds(phase==='playing',now,last);last=now;if(phase==='playing'){elapsed+=frameElapsed;acc+=physicsFrameSeconds(frameElapsed);while(acc>=STEP){update(STEP);leaderboard.client.observe(checkpoint,falls,puzzleRun?.relays);if((phase as string)==='finished')leaderboard.client.finish();acc-=STEP;if(phase!=='playing')break;}}const p=body.translation();camera.position.set(p.x,p.y+(flowRun?flowRun.eye:EYE),p.z);camera.rotation.set(pitch,yaw,0);if(activeSky)activeSky.position.copy(camera.position);timer.textContent=format(elapsed);boostStatus.textContent=flowRun?flowRun.label():puzzleRun?puzzleRun.boost.label(puzzleRun.grounded):boost.label(grounded);if(puzzleRun&&puzzleArt)puzzleArt.update(puzzleRun,elapsed);tokenArt?.update(simulationTime);glider.update({phase,flight:!!flowRun&&!flowRun.grounded,gliding:!!flowRun?.gliding,dt:physicsFrameSeconds(frameElapsed),lateralSpeed:glideLateralSpeed,verticalSpeed:flowRun?.vy??0,reducedMotion:reducedMotion.matches});const renderStart=profile?performance.now():0;renderer.render(scene,camera);if(profile&&interval!==null&&!document.hidden)profile.record({intervalMs:interval,updateMs:renderStart-profileStart,renderSubmitMs:performance.now()-renderStart,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}buildCourse();reset();drawPicker();description.textContent=courseDescription();requestAnimationFrame(frame);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();error.hidden=false;error.textContent='Graphics connection was lost. Reload this page to try again.';});

window.addEventListener('pagehide',e=>{if(!e.persisted){markers.dispose();glider.dispose();appearanceMenu.dispose();void appearanceAssets.dispose();}});
