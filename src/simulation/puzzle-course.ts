import type { Course, Platform } from './courses.ts';
export type PuzzlePlatform=Platform & {id:string;next?:string;label?:string};
export type Vec3={x:number;y:number;z:number};
export type Portal={id:string;entry:Vec3;entryNormal:{x:number;z:number};exit:Vec3;exitNormal:{x:number;z:number};relay:number;width:number;height:number};
export const puzzlePlatforms:PuzzlePlatform[]=[
 {id:'garden',x:0,y:0,z:0,w:10,d:10,next:'garden-step-1',label:'01  LAUNCH GARDEN\nHOLD SHIFT / E · RELEASE TO BOOST'},
 {id:'garden-step-1',x:-7,y:.7,z:-5,w:5,d:5,next:'garden-step-2'},
 {id:'garden-step-2',x:-7,y:1.4,z:-11,w:5,d:5,next:'relay-1'},
 {id:'relay-1',x:0,y:2.1,z:-15,w:9,d:8,checkpoint:1,label:'STEP ON THE CYAN RELAY\nTHEN ENTER THE LINKED RING'},
 {id:'balcony',x:20,y:8,z:-17,w:10,d:8,checkpoint:2,next:'atrium-step-1',label:'02  RELAY ATRIUM\nFOLLOW THE STAIRS TO THE SECOND RELAY'},
 {id:'atrium-step-1',x:27,y:8.7,z:-17,w:5,d:5,next:'atrium-step-2'},
 {id:'atrium-step-2',x:31,y:9.4,z:-23,w:5,d:5,next:'atrium-step-3'},
 {id:'atrium-step-3',x:27,y:10.1,z:-29,w:5,d:5,next:'relay-2'},
 {id:'relay-2',x:20,y:10.8,z:-29,w:9,d:8,checkpoint:3,label:'AMBER RELAY → SKYBRIDGE\nTHE RING TURNS YOU TOWARD THE SUMMIT'},
 {id:'skybridge',x:-6,y:18,z:-31,w:10,d:9,checkpoint:4,next:'summit-step-1',label:'03  SKYBRIDGE\nSAFE STAIRS LEFT · CHARGE SHORTCUT AHEAD'},
 {id:'summit-step-1',x:-13,y:18.4,z:-35,w:5,d:5,next:'summit-step-2'},
 {id:'summit-step-2',x:-13,y:18.8,z:-41,w:5,d:5,next:'summit'},
 {id:'summit',x:-6,y:19.1,z:-44,w:8,d:8,goal:true,label:'SUMMIT · FINISH'},
 {id:'garden-shortcut',x:0,y:.7,z:-9.5,w:4,d:4,next:'relay-1',label:'QUICK LINE'},
 {id:'catch',x:-6,y:16.5,z:-38,w:8,d:5,next:'catch-step',label:'RECOVERY LEDGE\nSTAIRS BACK TO SKYBRIDGE'},
 {id:'catch-step',x:-12,y:17.2,z:-32,w:5,d:5,next:'skybridge'}
];
export const puzzlePortals:Portal[]=[
 {id:'cyan',entry:{x:0,y:2.1,z:-17},entryNormal:{x:0,z:1},exit:{x:18,y:8,z:-17},exitNormal:{x:1,z:0},relay:1,width:3,height:3.6},
 {id:'amber',entry:{x:18,y:10.8,z:-29},entryNormal:{x:1,z:0},exit:{x:-6,y:18,z:-29},exitNormal:{x:0,z:-1},relay:2,width:3,height:3.6}
];
export const puzzleRelays=[{id:1,x:0,y:2.1,z:-14,radius:1.25},{id:2,x:21,y:10.8,z:-29,radius:1.25}];
export const puzzleCourse:Course={id:'relay-gardens-v1',name:'Relay Gardens',subtitle:'05 · CHARGE & PORTAL PUZZLES',sky:0x9aceda,fog:0xc1dde3,ground:0xe1e6dc,rock:0x2f4e64,edge:0x50d8d0,light:0xf5fbff,platforms:puzzlePlatforms};
