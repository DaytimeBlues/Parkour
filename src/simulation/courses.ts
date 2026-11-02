export type Platform = { x:number; y:number; z:number; w:number; d:number; checkpoint?:number; goal?:boolean; move?:{amplitude:number;period:number;phase:number} };
export type Course = { id:string; name:string; subtitle:string; sky:number; fog:number; ground:number; rock:number; edge:number; light:number; platforms:Platform[] };
type Section={offsets:number[]; spacing:number[]; widths:number[]; moverIndices:number[]};
// Six designed segments, not random. Each has a recognizable rhythm and a checkpoint at its end.
const sections:Section[]=[
 {offsets:[0,1.1,2.2,1.1,0,-1.1,-2.2,-1.1],spacing:[6.5,6.6,6.7,6.6,6.5,6.6,6.7,6.6],widths:[3.5,3.4,3.3,3.4,3.2,3.3,3.2,5.6],moverIndices:[]},
 {offsets:[0,-1.2,-2.4,-1.2,0,1.2,2.4,1.2],spacing:[6.8,6.7,6.8,6.7,6.8,6.7,6.8,6.6],widths:[3.2,3.1,3,3.1,3,3.1,3,5.6],moverIndices:[3]},
 {offsets:[1.5,1.3,0,-1.3,0,1.3,0,-1.3],spacing:[6.7,6.9,6.7,6.9,6.7,6.9,6.7,6.6],widths:[3,3.2,3,3.2,3,3.1,3,5.6],moverIndices:[2,6]},
 {offsets:[0,1.4,2.8,1.4,0,-1.4,-2.8,-1.4],spacing:[6.8,6.8,6.9,6.8,6.8,6.9,6.8,6.6],widths:[3,2.9,3,2.9,3,2.9,3,5.6],moverIndices:[4]},
 {offsets:[0,-1.3,0,1.3,0,-1.3,0,1.3],spacing:[6.9,6.8,6.9,6.8,6.9,6.8,6.9,6.6],widths:[2.9,3,2.9,3,2.9,3,2.9,5.6],moverIndices:[1,5]},
 {offsets:[0,1.2,2.4,1.2,0,-1.2,0,0],spacing:[6.9,6.9,6.8,6.9,6.8,6.9,6.8,6.6],widths:[2.9,2.8,2.9,2.8,2.9,2.8,3,8],moverIndices:[2,5]}
];
function climb(courseIndex:number):Platform[]{
 const route:Platform[]=[{x:0,y:0,z:0,w:9,d:9}];let y=0,z=0;
 sections.forEach((section,si)=>{section.offsets.forEach((offset,j)=>{
   const rise=si===0?(j%2===0?.7:.75):((j+courseIndex+si)%3===0?.95:.8);
   const spacing=rise>.9?6.1:section.spacing[j]-.15+courseIndex*.025;
   y=Math.round((y+rise)*100)/100;z=Math.round((z+(si%2===0?-spacing:spacing))*100)/100;
   const checkpoint=si<5&&j===7?si+1:undefined,goal=si===5&&j===7;
   const difficultyNarrow=courseIndex===0?0:courseIndex===1?.12:courseIndex===2?.2:.25;
   const width=checkpoint||goal?section.widths[j]:Math.max(2.55,section.widths[j]-difficultyNarrow);
   const p:Platform={x:(si*4.5+offset*(1+.12*courseIndex))*(courseIndex%2===1?-1:1),y,z,w:width,d:width,checkpoint,goal};
   // Gentle oscillation requires timing but does not require boost; checkpoint platforms stay still.
   if(!checkpoint&&!goal&&section.moverIndices.includes(j)&&courseIndex>=2)p.move={amplitude:courseIndex===2?.4:.55,period:4.2+(j%2)*.7,phase:(si+j)*.7};
   route.push(p);
 });});return route;
}
export const courses:Course[] = [
 {id:'daybreak',name:'Daybreak Ascent',subtitle:'01 · LONG CLIMB',sky:0xa1dcef,fog:0xa1dcef,ground:0x78b899,rock:0x8bafad,edge:0xc2e3ce,light:0xe7f8ff,platforms:climb(0)},
 {id:'sundown',name:'Sundown Spire',subtitle:'02 · PRECISION',sky:0xeaa780,fog:0xeaa780,ground:0xb97b74,rock:0x966e83,edge:0xffdfae,light:0xffd9b1,platforms:climb(1)},
 {id:'storm',name:'Stormline Tower',subtitle:'03 · MOVING LEDGES',sky:0x506379,fog:0x506379,ground:0x638e91,rock:0x536578,edge:0xd2eee2,light:0xcfe9f3,platforms:climb(2)},
 {id:'aurora',name:'Aurora Summit',subtitle:'04 · THE FINALE',sky:0x142946,fog:0x142946,ground:0x4e8d8c,rock:0x3b526b,edge:0xafffe1,light:0xc6e1ff,platforms:climb(3)}
];
export function platformX(p:Platform, seconds:number):number {return p.x+(p.move ? p.move.amplitude*Math.sin(seconds*Math.PI*2/p.move.period+p.move.phase) : 0);}
export function validBest(value:unknown):number|null {return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<86400?value:null;}
