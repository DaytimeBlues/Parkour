import {forgetMatchingSeat, membershipNotice} from './membership.ts';
import {createMenuSteps} from '../ui/menu-steps';
import {loadAppearance} from '../simulation/appearance.ts';
import {validAppearance} from '../../shared/appearance.mjs';
import './style.css';
import { ARENA, STEP, ROOM_CAPACITY } from '../../shared/multiplayer.mjs';
import { GameplayKeys, movementInput, canCaptureGameplayKey, isKeyboardUI } from '../simulation/keyboard';
import { api, joinRoom, MultiplayerClient, ViewGate, type Room, type Seat, type Runner, type InputFrame } from './client';
import { createFortress, drawRadar } from './scene';
import { createPumpDriver } from './pump';

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const lobby=$('lobby'),entry=$('entry'),roomPanel=$('room-panel'),notice=$('notice'),graphicsError=$('graphics-error'),hud=$('hud'),play=$<HTMLButtonElement>('play'),reconnect=$<HTMLButtonElement>('reconnect'),radar=$<HTMLCanvasElement>('radar');
const entrySteps=createMenuSteps(entry,['role','join','teacher'],'role');
$('choose-join').onclick=()=>entrySteps.show('join');
$('choose-teacher').onclick=()=>{entrySteps.show('teacher');void loadTeacherRooms();};
for(const id of ['join-back','teacher-back'])$(id).onclick=()=>{beginView(null);entrySteps.show('role');say('Choose how to join multiplayer.');};
const STORAGE='skybound-fortress-seat-v1', JOIN_DRAFT='skybound-fortress-join-v1';
let graphics:ReturnType<typeof createFortress>|null=null,client:MultiplayerClient|null=null,room:Room|null=null,teacher=false,signedIn=false,teacherBusy=false,rosterKey='',yaw=0,pitch=0,jump=false,last=performance.now(),acc=0,previousEpoch=-1,lastHud=0,graphicsAvailable=false,disposed=false,raf=0,appearanceWarning='';
const keys=new GameplayKeys(),view=new ViewGate();
function say(message:string){notice.textContent=message;}
function readable(error:unknown){const text=error instanceof Error?error.message:'Request failed';const explanations:Record<string,string>={ROOM_NOT_FOUND:'Room not found. Check the code with your teacher.',ROOM_LOCKED:'This room is locked. Ask your teacher to unlock joining.',ROOM_FULL:`New joins are limited to ${ROOM_CAPACITY} reserved seats. Reconnect with your saved seat, or ask your teacher to remove an unused seat.`,TEACHER_REQUIRED:'Sign in to use teacher controls.',FORBIDDEN:'Only this room’s signed-in owner can control it.',SEAT_REVOKED:'This seat was removed. Ask your teacher before joining again.',ROOM_ENDED:'This match has ended.',RATE_LIMITED:'Requests are arriving too quickly. Wait a moment and retry.',ROOM_BUSY:'The room is busy. Retry in a moment.',INVALID_CODE:'Enter the six-character room code from your teacher.',INVALID_NICKNAME:'Use 1–24 letters, numbers, spaces, underscores or hyphens.',TEACHER_SIGN_IN_REQUIRED:'Sign in to create a room.',ROOM_EXPIRED:'This room has expired. Ask your teacher for a new room code.'};return explanations[text]??text.replaceAll('_',' ');}
function savedSeat():Seat|null{try{const value=JSON.parse(sessionStorage.getItem(STORAGE)||'null');return value&&typeof value.code==='string'&&typeof value.seatToken==='string'&&typeof value.playerId==='string'?value:null;}catch{return null;}}
function joinIntent(code:string,nickname:string){let prior;try{prior=JSON.parse(sessionStorage.getItem(JOIN_DRAFT)||'null');}catch{}if(prior?.code===code&&prior?.nickname===nickname&&/^[a-f0-9]{64}$/.test(prior.joinKey))return {joinKey:prior.joinKey as string,appearance:validAppearance(prior.appearance)};let appearance;try{appearance=loadAppearance(localStorage);}catch{appearance=validAppearance(null);}const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');try{sessionStorage.setItem(JOIN_DRAFT,JSON.stringify({code,nickname,joinKey:key,appearance}));}catch{throw new Error('This browser must allow tab storage to join safely. Enable session storage and retry.');}return {joinKey:key,appearance};}
function saveSeat(seat:Seat){try{sessionStorage.setItem(STORAGE,JSON.stringify(seat));}catch{say('Joined, but this browser could not save the reconnect token. Keep this tab open.');}}
function locked(){return graphicsAvailable&&!!graphics&&document.pointerLockElement===graphics.canvas;}
function clearInput(){keys.clear();jump=false;}
function release(){clearInput();if(document.pointerLockElement)document.exitPointerLock();}
function beginView(code:string|null){const ticket=view.begin(code);release();graphics?.clear();appearanceWarning='';client?.dispose();client=null;teacher=false;teacherBusy=false;room=null;previousEpoch=-1;entry.hidden=false;roomPanel.hidden=true;hud.hidden=true;$('membership-panel').hidden=true;lobby.hidden=false;$('score').hidden=true;$('menu-button').hidden=true;return ticket;}
function format(ms:number){const seconds=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function own(){return client?.predicted??null;}
const symbols:Record<string,string>={circle:'●',square:'■',diamond:'◆',triangle:'▲',pentagon:'⬟'};
function displayRoom(value:Room){
  if(client?.membershipIssue){displayMembershipIssue();return;}
  if(room&&room.code===value.code&&(value.epoch<room.epoch||value.epoch===room.epoch&&((value.snapshotMs??value.serverTime)<(room.snapshotMs??room.serverTime)||value.version<room.version)))return;
  room=value;entry.hidden=true;roomPanel.hidden=false;$('score').hidden=false;$('menu-button').hidden=false;
  if(previousEpoch!==room.epoch){previousEpoch=room.epoch;clearInput();if(client?.predicted)yaw=client.predicted.yaw;}
  if(room.status!=='running')release();
  graphics?.snapshot(room,client?.seat.playerId??'');
  $('room-code').textContent=room.code;$('room-status').textContent=room.status;
  $('red-score').textContent=String(Math.floor(room.scores.red));$('blue-score').textContent=String(Math.floor(room.scores.blue));$('clock').textContent=format(room.remainingMs);
  const self=room.players.find(p=>p.id===client?.seat.playerId),teamName=self?.team==='red'?'▲ RED':'■ BLUE';
  $('room-instructions').textContent=room.status==='ended'?`Match ended. ${room.winner==='tie'?'It’s a tie.':room.winner?`${room.winner.toUpperCase()} wins!`:'Final scores above.'}`:room.status==='paused'?'Match paused. Wait for your teacher to resume.':room.status==='lobby'?(teacher?'Share this code. Start when both teams have joined.':'You’re in. Wait for your teacher to start the match.'):teacher?'Match running. Manage the room below.':`${teamName} team. Capture flag zones with your teammates.`;
  $('teacher-actions').hidden=!teacher;
  for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))){const action=button.dataset.action!;button.hidden=action==='start'?room.status!=='lobby':action==='pause'?room.status!=='running':action==='resume'?room.status!=='paused':room.status==='ended';button.disabled=teacherBusy;}
  const lock=$<HTMLButtonElement>('lock');lock.textContent=room.locked?'Unlock joining':'Lock joining';lock.disabled=room.status==='ended'||teacherBusy;
  play.hidden=!client||room.status!=='running'||!client.predicted;play.disabled=!graphicsAvailable||!!client?.needsReconnect||!!client?.recovering;
  play.textContent=locked()?'Playing':'Enter fortress';reconnect.hidden=!client?.needsReconnect;
  $('player-count').textContent=room.players.length>ROOM_CAPACITY?`${room.players.length} legacy seats · new joins closed`:`${room.players.length} / ${ROOM_CAPACITY} reserved seats`;
  const newKey=JSON.stringify(room.players.map(p=>[p.id,p.nickname,p.team,p.connected]))+teacher+room.status;
  if(newKey!==rosterKey){rosterKey=newKey;const roster=$('roster');roster.replaceChildren();for(const p of room.players){const row=document.createElement('div');row.className='runner';const name=document.createElement('span');name.className=p.team;name.textContent=`${p.team==='red'?'▲':'■'} ${p.nickname}${p.id===client?.seat.playerId?' (you)':''}`;const state=document.createElement('small');state.textContent=p.connected===false?'Reconnecting…':`${p.team==='red'?'Red':'Blue'} team`;name.append(state);row.append(name);if(teacher&&room.status!=='ended'){const remove=document.createElement('button');remove.className='quiet';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${p.nickname}`);remove.onclick=()=>void control('remove',{playerId:p.id});row.append(remove);}roster.append(row);}if(!room.players.length)roster.textContent='Share the room code. Players will appear here.';}
  const zones=$('zone-list');zones.replaceChildren();for(const definition of ARENA.zones){const z=room.zones.find(z=>z.id===definition.id);if(!z)continue;const zone=document.createElement('div');zone.className='zone';const heading=document.createElement('strong');heading.textContent=`${symbols[definition.shape]} ${definition.label}`;const state=document.createElement('small');state.textContent=z.owner?`${z.owner.toUpperCase()} owns`:'NEUTRAL';state.className=z.owner??'';const counts=(z as unknown as {counts?:{red:number;blue:number};contested?:boolean});if(counts.counts)state.textContent+=` · ${counts.counts.red}▲ / ${counts.counts.blue}■`;if(counts.counts&&counts.counts.red>0&&counts.counts.red===counts.counts.blue)state.textContent+=' · Tied';else if(counts.contested)state.textContent+=' · Contested';const progress=document.createElement('progress');progress.max=5000;progress.value=Math.abs(z.progress);progress.setAttribute('aria-label',`${definition.label} capture ${Math.round(Math.abs(z.progress)/50)} percent toward ${z.progress>=0?'red':'blue'}`);zone.append(heading,state,progress);zones.append(zone);}
  updateConnectionDetails();
  updateConnectionMessage();if(client?.needsReconnect&&!client.recovering){release();say(client.message);}
  hud.hidden=!locked();lobby.hidden=locked();
}
function displayMembershipIssue(){
  if(!client?.membershipIssue)return;
  release();graphics?.clear();room=null;rosterKey='';
  try{forgetMatchingSeat(sessionStorage,STORAGE,client.seat);}catch{} // Storage may be disabled.
  const detail=membershipNotice(client.membershipIssue);
  $('membership-title').textContent=detail.title;$('membership-message').textContent=detail.message;
  entry.hidden=true;roomPanel.hidden=true;$('membership-panel').hidden=false;lobby.hidden=false;hud.hidden=true;
  $('score').hidden=true;$('menu-button').hidden=true;play.hidden=true;reconnect.hidden=true;
  $('roster').replaceChildren();$('zone-list').replaceChildren();$('player-count').textContent='';
  $('restore').hidden=true;say(detail.message);updateConnectionMessage();updateConnectionDetails();
}
$('membership-back').onclick=()=>{beginView(null);entrySteps.show('role');say('Ask your teacher for a room code before joining again.');};
function updateConnectionMessage(){
 const message=[client?.message,appearanceWarning].filter(Boolean).join(' · '),target=$('connection');
 if(target.textContent!==message)target.textContent=message;
}
function updateConnectionDetails(){
 const target=$('connection-details');
 if(client?.membershipIssue){target.textContent='This runner connection has ended. No movement or reconnect requests will be sent.';return;}
 if(!client){target.textContent=teacher?'Teacher room view. No runner connection is active.':'No runner connection.';return;}
 const age=Math.max(0,Math.floor((performance.now()-client.lastGood)/1000));
 const state=client.recovering?'Reconnecting automatically':client.needsReconnect?'Reconnect needed':client.predictionHeld?'Waiting for the server':'Connected';
 target.textContent=`${state}. Last accepted update ${age}s ago. ${client.busy?'Request in progress.':'No request waiting.'} Queued movement: ${client.pending.length}. Accepted batch: ${client.ack}. ${client.message}`;
}
function useClient(seat:Seat,value?:Room){
  client?.dispose();teacher=false;const next=new MultiplayerClient(seat,fetch,()=>performance.now(),()=>{if(client!==next||view.capture().code!==seat.code)return;if(next.membershipIssue)displayMembershipIssue();else if(next.room)displayRoom(next.room);});client=next;previousEpoch=-1;
  if(value)client.accept(value,value.players.find(p=>p.id===seat.playerId)?.seq??0,true);
  saveSeat(seat);network.wake();
}
async function loadTeacherRooms(){if(!signedIn)return;const ticket=view.capture();try{const data=await api<{rooms:{code:string;status:string}[]}>('rooms');if(!view.accepts(ticket))return;const target=$('owned-rooms');target.replaceChildren();for(const item of data.rooms){const b=document.createElement('button');b.className='quiet';b.textContent=`${item.code} · ${item.status}`;b.onclick=async()=>{const selected=beginView(item.code);try{const result=await api<{room:Room}>('state',{code:item.code});if(!view.accepts(selected,result.room.code))return;teacher=true;displayRoom(result.room);say('Teacher view. Share the code, not your sign-in.');}catch(e){if(view.accepts(selected))say(readable(e));}};target.append(b);}}catch(e){if(view.accepts(ticket))say(readable(e));}}
async function control(action:string,fields:Record<string,unknown>={}){
 if(!teacher||!room||teacherBusy)return;
 const ticket=view.capture(),code=room.code,body={code,action,revision:room.controlRevision??0,operationId:crypto.randomUUID(),...fields};
 teacherBusy=true;displayRoom(room);
 try{
  let result:{room:Room};
  try{result=await api<{room:Room}>('control',body);}catch(error){
   // An uncertain transport/503 acknowledgment may be retried once using the
   // SAME opaque operation ID and original revision, never a new intent.
   if(error instanceof Error&&(!('status' in error)||(error as Error&{status:number}).status>=500))result=await api<{room:Room}>('control',body);else throw error;
  }
  if(!view.accepts(ticket,result.room.code))return;
  displayRoom(result.room);say(action==='remove'?'Runner removed. Their previous seat token no longer grants access.':`Room ${action==='lock'?(fields.locked?'locked':'unlocked'):action==='end'?'ended':action==='start'?'started':action==='resume'?'resumed':'paused'}.`);
 }catch(e){
  if(view.accepts(ticket)){
   if(e instanceof Error&&e.message==='STALE_CONTROL'){
    try{const fresh=await api<{room:Room}>('state',{code});if(view.accepts(ticket,fresh.room.code)){displayRoom(fresh.room);say('Teacher controls changed in another request. View refreshed; choose your action again.');}}catch(error){if(view.accepts(ticket))say(readable(error));}
   }else say(readable(e));
  }
 }finally{if(view.accepts(ticket)){teacherBusy=false;if(room)displayRoom(room);}}
}
$('join-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('join-form').querySelector('button')!;const code=$<HTMLInputElement>('code').value.trim().toUpperCase(),nickname=$<HTMLInputElement>('nickname').value.trim(),ticket=beginView(code);button.disabled=true;button.textContent='Joining…';say('Connecting to your room…');try{const result=await joinRoom<{seatToken:string;playerId:string;room:Room}>({code,nickname,...joinIntent(code,nickname)});if(!view.accepts(ticket,result.room.code))return;useClient({code:result.room.code,seatToken:result.seatToken,playerId:result.playerId},result.room);say('Joined. Your nickname is visible to this room.');}catch(e){if(view.accepts(ticket))say(readable(e));}finally{button.disabled=false;button.textContent='Join room';}});
$('create').onclick=async()=>{const button=$<HTMLButtonElement>('create'),ticket=beginView(null);button.disabled=true;try{const result=await api<{code:string;room:Room}>('rooms',{durationSeconds:Number($<HTMLSelectElement>('duration').value)});if(!view.bind(ticket,result.room.code))return;teacher=true;displayRoom(result.room);say('Room created. Share its code with your runners; your teacher authority stays private.');}catch(e){if(view.accepts(ticket))say(readable(e));}finally{button.disabled=false;}};
for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]')))button.onclick=()=>void control(button.dataset.action!);
$('lock').onclick=()=>void control('lock',{locked:!room?.locked});
play.onclick=async()=>{if(!graphicsAvailable||!graphics||!client||client.needsReconnect||client.recovering||room?.status!=='running')return;try{await graphics.canvas.requestPointerLock();graphics.canvas.focus({preventScroll:true});}catch{say('Mouse capture was blocked. Click Enter Fortress again in this game tab.');}};
$('menu-button').onclick=release;
$('leave').onclick=()=>{beginView(null);entrySteps.show('role');$('restore').hidden=!savedSeat();say('Left this view. A saved runner seat can reconnect from this tab.');void loadTeacherRooms();};
reconnect.onclick=async()=>{if(!client)return;const current=client,ticket=view.begin(current.seat.code);reconnect.disabled=true;try{await current.reconnect();if(view.accepts(ticket)&&client===current){network.wake();say(current.needsReconnect||current.recovering?current.message:'Reconnected to the current server state. Enter the fortress when ready.');}}catch(e){if(view.accepts(ticket))say(current.membershipIssue?current.message:readable(e));}finally{if(view.accepts(ticket))reconnect.disabled=false;}};
$('restore').onclick=async()=>{const seat=savedSeat();if(!seat)return;const ticket=beginView(seat.code);useClient(seat);const current=client!;try{await current.reconnect();if(view.accepts(ticket)&&client===current)say(current.needsReconnect||current.recovering?current.message:'Saved seat reconnected.');}catch(e){if(view.accepts(ticket))say(current.membershipIssue?current.message:readable(e));}};
document.addEventListener('pointerlockchange',()=>{clearInput();lobby.hidden=locked();hud.hidden=!locked();if(locked())graphics?.canvas.focus({preventScroll:true});});
document.addEventListener('pointerlockerror',()=>say('Mouse capture failed. Click Enter Fortress to retry.'));
document.addEventListener('mousemove',event=>{if(!locked()||room?.status!=='running')return;yaw=Math.atan2(Math.sin(yaw-event.movementX*.0023),Math.cos(yaw-event.movementX*.0023));pitch=Math.max(-1.35,Math.min(1.35,pitch-event.movementY*.0023));});
document.addEventListener('keydown',event=>{if(!canCaptureGameplayKey(event,locked()&&room?.status==='running'))return;const result=keys.press(event);if(result==='jump')jump=true;});
document.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden){release();client?.suspend();}else network.wake();});document.addEventListener('focusin',event=>{if(locked()&&isKeyboardUI(event.target))release();});
try{graphics=createFortress($('world'),()=>{appearanceWarning='A runner appearance could not load. Team markers remain visible; reload to retry.';say(appearanceWarning);});graphicsAvailable=true;graphics.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();graphicsAvailable=false;release();graphicsError.hidden=false;graphicsError.textContent='Graphics connection lost. Reload this page to restore 3D; your saved seat can reconnect.';play.disabled=true;});}catch(error){graphicsError.hidden=false;graphicsError.textContent='3D play is unavailable in this browser. Use a desktop browser with hardware acceleration enabled. You can still manage rooms here.';}
function frame(now:number){if(disposed)return;raf=requestAnimationFrame(frame);const elapsed=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if(client&&room?.status==='running'&&!document.hidden&&locked()){acc+=elapsed;while(acc>=STEP){const move=locked()?movementInput(keys):{forward:0,right:0};const input:InputFrame={...move,yaw,jump:locked()&&jump,glide:locked()&&keys.has('Space'),slide:locked()&&keys.has('KeyC')};client.predict(input);jump=false;acc-=STEP;}}else acc=0;
  if(graphicsAvailable)graphics?.render(now,own(),yaw,pitch);
  if(room&&now-lastHud>100){lastHud=now;updateConnectionDetails();drawRadar(radar,room,own());updateConnectionMessage();}
}
raf=requestAnimationFrame(frame);
const network=createPumpDriver(()=>client,()=>!document.hidden);
const teacherPoll=setInterval(async()=>{if(!teacher||!room||room.status==='ended'||teacherBusy||document.hidden)return;const ticket=view.capture(),code=room.code;teacherBusy=true;try{const result=await api<{room:Room}>('state',{code});if(view.accepts(ticket,result.room.code)&&teacher&&room?.code===code&&result.room.version>=room.version)displayRoom(result.room);}catch(e){if(view.accepts(ticket))say(readable(e));}finally{if(view.accepts(ticket)){teacherBusy=false;if(room)displayRoom(room);}}},500);
$('restore').hidden=!savedSeat();
void api<{signedIn:boolean}>('me').then(result=>{signedIn=result.signedIn;$('teacher-signin').hidden=signedIn;$('teacher-create').hidden=!signedIn;if(signedIn)void loadTeacherRooms();}).catch(()=>say('Multiplayer service unavailable. Solo courses remain available.'));
window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);graphicsAvailable=false;release();network.stop();clearInterval(teacherPoll);client?.dispose();graphics?.dispose();});
// BFCache can restore DOM after pagehide disposed networking/render resources.
// Reload is the safe lifecycle boundary; saved tab credentials enable reconnect.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
