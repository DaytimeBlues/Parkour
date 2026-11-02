export type CharacterKind = 'fox' | 'rabbit';
export type WingStyle = 'angel' | 'devil' | 'parakeet' | 'elephant' | 'glow' | 'dragon';
export type Appearance = {character: CharacterKind; wing: WingStyle};
export const CHARACTER_IDS: readonly CharacterKind[];
export const WING_IDS: readonly WingStyle[];
export function validAppearance(value: unknown): Appearance;
export function isAppearance(value: unknown): value is Appearance;
export function appearanceCode(value: unknown): number;
export function appearanceFromCode(code: unknown): Appearance;
