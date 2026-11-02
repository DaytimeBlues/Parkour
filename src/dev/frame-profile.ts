/** CPU-side timings only. Render submission is not GPU completion time. */
export type FrameSample = { intervalMs:number; updateMs:number; renderSubmitMs:number; calls:number; triangles:number };
export function profilingEnabled(dev:boolean, search:string):boolean {
 return dev && new URLSearchParams(search).get('profile')==='1';
}
export class FrameProfile {
 private samples:FrameSample[]=[];
 private cursor=0;
 readonly capacity:number;
 constructor(capacity=600){this.capacity=capacity;if(!Number.isInteger(capacity)||capacity<1||capacity>3600)throw new RangeError('capacity must be 1–3600');}
 record(sample:FrameSample){if(Object.values(sample).some(v=>!Number.isFinite(v)||v<0))return;
  this.samples[this.cursor]={...sample};this.cursor=(this.cursor+1)%this.capacity;
 }
 reset(){this.samples=[];this.cursor=0;}
 snapshot(){const stats=(key:keyof FrameSample)=>{const a=this.samples.map(s=>s[key]).sort((a,b)=>a-b);return {median:a.length?a[Math.ceil(a.length*.5)-1]:null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null,max:a.length?a[a.length-1]:null};};
  return {count:this.samples.length,capacity:this.capacity,intervalMs:stats('intervalMs'),updateMs:stats('updateMs'),renderSubmitMs:stats('renderSubmitMs'),calls:stats('calls'),triangles:stats('triangles')};
 }
}
