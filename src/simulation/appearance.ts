import {validAppearance} from '../../shared/appearance.mjs';
export {validAppearance} from '../../shared/appearance.mjs';
/** Cosmetic identity only: never sent as movement, collider or scoring input. */
export const WING_STYLES = [
 {id:'angel',name:'Angel',detail:'Layered ivory feathers · gold shoulders'},
 {id:'devil',name:'Devil',detail:'Crimson bat membranes · dark fingers'},
 {id:'parakeet',name:'Rainbow parakeet',detail:'Six bright feather colours · green shoulders'},
 {id:'elephant',name:'Little elephant',detail:'Soft rounded ears · rosy inner lobes'},
 {id:'glow',name:'Glow',detail:'Luminous crystal petals · no flashing'},
 {id:'dragon',name:'Dragon',detail:'Wide emerald membranes · copper wing bones'},
] as const;
export type WingStyle=typeof WING_STYLES[number]['id'];
export type CharacterKind='fox'|'rabbit';
export type Appearance={character:CharacterKind;wing:WingStyle};
export const APPEARANCE_KEY='skybound:appearance:v1';
export const DEFAULT_APPEARANCE:Readonly<Appearance>=Object.freeze({character:'fox',wing:'angel'});
export function loadAppearance(storage:Pick<Storage,'getItem'>):Appearance {try{return validAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY)??'null'));}catch{return {...DEFAULT_APPEARANCE};}}
export function saveAppearance(storage:Pick<Storage,'setItem'>,value:Appearance):boolean {try{storage.setItem(APPEARANCE_KEY,JSON.stringify(validAppearance(value)));return true;}catch{return false;}}
/** Draft changes are isolated until confirm; cancel never mutates applied identity. */
export class AppearanceSelection {
 private applied:Appearance;private draft:Appearance;
 constructor(initial:Appearance){this.applied=validAppearance(initial);this.draft={...this.applied};}
 current(){return {...this.applied};}preview(){return {...this.draft};}
 begin(){this.draft={...this.applied};return this.preview();}
 choose(value:Appearance){this.draft=validAppearance(value);return this.preview();}
 confirm(){this.applied={...this.draft};return this.current();}
 cancel(){return this.begin();}
}

/** Pointer-lock requests leave phase ready briefly: menus must also respect the existing start gate. */
export function canOpenAppearance(phase:string,startPending:boolean,pointerLocked:boolean):boolean {
 return !startPending&&!pointerLocked&&(phase==='ready'||phase==='paused'||phase==='finished');
}
