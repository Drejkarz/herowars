// Tab switching logic for the 5-tab layout.

export type TabName =
  | 'my-stats'
  | 'normal-allies'
  | 'normal-enemies'
  | 'champ-allies'
  | 'champ-enemies';

export const DEFAULT_TAB: TabName = 'normal-allies';

export function activateTab(name: TabName): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('nav.tabs button')) {
    btn.classList.toggle('active', btn.dataset.tabBtn === name);
  }
  for (const sec of document.querySelectorAll<HTMLElement>('section[data-tab]')) {
    sec.hidden = sec.dataset.tab !== name;
  }
}

export function wireTabs(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('nav.tabs button')) {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tabBtn as TabName | undefined;
      if (name) activateTab(name);
    });
  }
  activateTab(DEFAULT_TAB);
}
