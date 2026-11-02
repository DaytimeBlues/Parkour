/** Bounded cosmetic identifiers only. Never movement, collision, scoring or authority. */
export const CHARACTER_IDS = Object.freeze(['fox', 'rabbit']);
export const WING_IDS = Object.freeze(['angel', 'devil', 'parakeet', 'elephant', 'glow', 'dragon']);
export function validAppearance(value) {
  return { character: CHARACTER_IDS.includes(value?.character) ? value.character : 'fox', wing: WING_IDS.includes(value?.wing) ? value.wing : 'angel' };
}
export function isAppearance(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && Object.hasOwn(value, 'character') && Object.hasOwn(value, 'wing') && CHARACTER_IDS.includes(value.character) && WING_IDS.includes(value.wing);
}
export function appearanceCode(value) { const a = validAppearance(value); return CHARACTER_IDS.indexOf(a.character) * WING_IDS.length + WING_IDS.indexOf(a.wing); }
export function appearanceFromCode(code) { return Number.isInteger(code) && code >= 0 && code < 12 ? { character: CHARACTER_IDS[Math.floor(code / 6)], wing: WING_IDS[code % 6] } : validAppearance(null); }
