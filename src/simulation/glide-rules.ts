/** New movement records never overwrite historical Flow bests or shared boards. */
export const MAPWIDE_GLIDE_RULES='mapwide-glide-v1';
export function glideCourseId(id:string){return /-flow-v[12]$/.test(id)?`${id}-glide-v1`:id;}
export function glideBestKey(id:string){return `skybound.${MAPWIDE_GLIDE_RULES}.best.${id}`;}
