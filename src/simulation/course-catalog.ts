import {courses as classicCourses} from './courses.ts';
import {puzzleCourse} from './puzzle-course.ts';
import {flowCourses} from './flow-course.ts';
import {tunnelCourses} from './tunnel-course.ts';
import {rankingRules} from './ranking.ts';
export const courses=[...classicCourses,puzzleCourse,...tunnelCourses,...flowCourses];
export type CourseSet='tunnels'|'flow-v1'|'legacy';
export const courseSets:[CourseSet,string][]=[['tunnels','FLOW II · SLIDE SHORTCUTS'],['flow-v1','FLOW I · EARLIER ROUTES & RECORDS'],['legacy','LEGACY · TOWERS & RELAYS']];
export const courseSetFor=(id:string):CourseSet=>id.endsWith('-flow-v2')?'tunnels':id.endsWith('-flow-v1')?'flow-v1':'legacy';
// Preserve every old device key, including the historical Relay Gardens prefix.
export const bestKey=(id:string)=>`skybound.${/-flow-v[12]$/.test(id)?rankingRules(id):'vertical-v1'}.best.${id}`;
