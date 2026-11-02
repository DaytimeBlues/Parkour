import * as THREE from 'three';
/** Plane image points along local -Z. Rotate it toward the next platform. */
export function markerYaw(dx:number,dz:number):number{return Math.atan2(-dx,-dz);}
function texture(draw:(ctx:CanvasRenderingContext2D)=>void):THREE.CanvasTexture{
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Marker canvas unavailable');draw(ctx);const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;
}
export function createMarkerMaterials(){
 const arrow=texture(ctx=>{ctx.clearRect(0,0,256,256);ctx.lineJoin='round';ctx.lineWidth=12;ctx.strokeStyle='#14283b';ctx.fillStyle='#ffe781';ctx.beginPath();ctx.moveTo(128,24);ctx.lineTo(216,120);ctx.lineTo(167,120);ctx.lineTo(167,224);ctx.lineTo(89,224);ctx.lineTo(89,120);ctx.lineTo(40,120);ctx.closePath();ctx.stroke();ctx.fill();});
 const badge=(finish:boolean)=>texture(ctx=>{ctx.clearRect(0,0,256,256);ctx.fillStyle='#10243c';ctx.strokeStyle='#ffe781';ctx.lineWidth=10;ctx.beginPath();ctx.roundRect(18,48,220,160,26);ctx.fill();ctx.stroke();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffe781';ctx.font='bold 31px sans-serif';ctx.fillText(finish?'FINISH':'CHECKPOINT',128,103);ctx.fillStyle='#ffffff';ctx.font='bold 50px sans-serif';ctx.fillText(finish?'★':'✓',128,158);});
 const checkpoint=badge(false),finish=badge(true);
 return {arrow:new THREE.MeshBasicMaterial({map:arrow,transparent:true,alphaTest:.01,depthTest:true,depthWrite:false,side:THREE.DoubleSide}),checkpoint:new THREE.SpriteMaterial({map:checkpoint,transparent:true,alphaTest:.01,depthTest:true,depthWrite:false}),finish:new THREE.SpriteMaterial({map:finish,transparent:true,alphaTest:.01,depthTest:true,depthWrite:false}),dispose(){arrow.dispose();checkpoint.dispose();finish.dispose();this.arrow.dispose();this.checkpoint.dispose();this.finish.dispose();}};
}
