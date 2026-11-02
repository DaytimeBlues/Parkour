export type Track={id:string;title:string;url:string};
export const tracks:Track[]=[
 {id:'cryo-vector',title:'Cryo Vector',url:'/audio/cryo-vector.mp4'},
 {id:'glass-cathedral',title:'Glass Cathedral',url:'/audio/glass-cathedral.mp4'},
 {id:'pale-signal',title:'Pale Signal',url:'/audio/pale-signal.mp4'},
 {id:'armoury-afterlight',title:'Armoury Afterlight',url:'/audio/armoury-afterlight.mp4'},
 {id:'prism-furnace',title:'Prism Furnace',url:'/audio/prism-furnace.mp4'}
];
export interface AudioPort {src:string;preload:string;volume:number;muted:boolean;currentTime:number;play():Promise<void>;pause():void;addEventListener(type:string,handler:()=>void):void;}
export type MusicStatus='ready'|'playing'|'paused'|'blocked'|'error';
export class MusicPlayer {
 index=0;status:MusicStatus='ready';private loaded=false;private requested=false;private epoch=0;
 private audio:AudioPort; private notify:()=>void;
 constructor(audio:AudioPort,notify:()=>void){this.audio=audio;this.notify=notify;audio.preload='none';audio.volume=.2;audio.addEventListener('ended',()=>{if(!this.requested)return;this.index=(this.index+1)%tracks.length;this.loaded=false;void this.play();});audio.addEventListener('error',()=>{this.requested=false;this.status='error';this.notify();});}
 get track(){return tracks[this.index];}
 get muted(){return this.audio.muted;}
 get volume(){return this.audio.volume;}
 setMuted(value:boolean){this.audio.muted=value;this.notify();}
 setVolume(value:number){if(Number.isFinite(value))this.audio.volume=Math.max(0,Math.min(1,value));this.notify();}
 async play(){this.requested=true;const epoch=++this.epoch;if(!this.loaded){this.audio.src=this.track.url;this.loaded=true;}try{await this.audio.play();if(epoch!==this.epoch)return;this.status='playing';}catch{if(epoch!==this.epoch)return;this.requested=false;this.status='blocked';}this.notify();}
 pause(){this.requested=false;this.epoch++;this.audio.pause();this.status='paused';this.notify();}
 next(){const wasPlaying=this.requested;this.audio.pause();this.epoch++;this.index=(this.index+1)%tracks.length;this.loaded=false;this.status='ready';this.notify();if(wasPlaying)void this.play();}
}
/** Prevent late pointer-lock completion from starting a run after focus loss. */
export class StartGate {
 private pending:number|null=null; private serial=0;
 get isPending():boolean {return this.pending!==null;}
 begin():number|null {if(this.pending!==null)return null;this.pending=++this.serial;return this.pending;}
 cancel(token?:number):boolean {if(this.pending===null||(token!==undefined&&token!==this.pending))return false;this.pending=null;return true;}
 accept():boolean {if(this.pending===null)return false;this.pending=null;return true;}
}
