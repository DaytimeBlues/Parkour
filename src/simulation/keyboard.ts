// Track physical keys, not actions: releasing W must not release a held ArrowUp.
const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

export function movementInput(keys: ReadonlySet<string>) {
  return {
    forward: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
    right: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
  };
}

export function isKeyboardUI(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return !!element?.closest?.('input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="button"], [role="listbox"], [role="menu"]');
}

export function canCaptureGameplayKey(event: KeyboardEvent, active: boolean): boolean {
  return active && !event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !isKeyboardUI(event.target);
}

export class GameplayKeys extends Set<string> {
  // Caller owns the active-gameplay/focus gate. Repeats stay consumed during play,
  // but do not resurrect keys cleared by pause, a fall, or a restart.
  press(event: KeyboardEvent): 'jump' | 'held' | null {
    if (!movementCodes.has(event.code) && event.code !== 'Space' && event.code !== 'KeyC') return null;
    event.preventDefault();
    if (event.repeat) return 'held';
    const jump = event.code === 'Space' && !this.has(event.code);
    this.add(event.code);
    return jump ? 'jump' : 'held';
  }
}
