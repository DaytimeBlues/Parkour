/** Small DOM-only menu controller. Hides whole pages, never resets their fields. */
export function createMenuSteps(root: HTMLElement, names: readonly string[], initial: string) {
  const pages = names.map(name => {
    const page = root.querySelector<HTMLElement>(`[data-menu-page="${name}"]`);
    if (!page) throw new Error(`Missing menu page: ${name}`);
    return {name,page};
  });
  let current = initial;
  function show(name: string, focus = true) {
    if (!names.includes(name)) throw new Error(`Unknown menu page: ${name}`);
    current = name;
    root.dataset.menuScreen = name;
    for (const item of pages) {
      item.page.hidden = item.name !== name;
      item.page.setAttribute('aria-hidden', String(item.name !== name));
    }
    if (focus) pages.find(item => item.name === name)?.page.querySelector<HTMLElement>('[data-menu-focus]')?.focus({preventScroll:true});
  }
  show(initial,false);
  return {show,get current(){return current;}};
}
