import {createRootbridgeCourse,ROOTBRIDGE_ID} from '../simulation/rootbridge-course.ts';
/** Explicit ephemeral URL opt-in, no storage/protocol/catalogue changes. */
export function rootbridgePreview(development:boolean,search:string){return development&&new URLSearchParams(search).get('coursePreview')==='woodland'?createRootbridgeCourse():undefined;}
export const rootbridgeBestKey=(id:string)=>`skybound.woodland-v1.practice.best.${id}`;
export const isRootbridgeId=(id:string)=>id===ROOTBRIDGE_ID;
