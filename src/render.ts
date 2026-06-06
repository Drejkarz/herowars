// DOM render functions. Each returns a small summary used to populate the stats line.

import {
  CALL_HEROES,
  CALL_TITANS,
  extractClanMembers,
  extractDefenceTeams,
  extractEnemyDefence,
  extractGcAllyDefence,
  extractGcEnemyDefence,
  extractOwnChampDefence,
  extractOwnName,
  extractRoster,
  extractWarriors,
} from './parser.js';
import {
  formatBeathero,
  formatBeattitan,
  formatMemberDefence,
  formatOwnMystats,
} from './format.js';
import type { CallMap, EnemyDefence } from './types.js';

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function attachCopy(btn: HTMLButtonElement): void {
  btn.addEventListener('click', async () => {
    const targetId = btn.dataset.target;
    if (!targetId) return;
    const ta = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!ta) return;
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch {
      // Best-effort: still flash the button.
    }
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.classList.add('ok');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('ok');
    }, 1000);
  });
}

function wireCopyButtons(root: ParentNode): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>('button.copy')) {
    attachCopy(btn);
  }
}

export interface OwnRenderResult {
  heroes: number;
  titans: number;
}

export function renderOwn(callMap: CallMap): OwnRenderResult {
  const heroes = extractRoster(callMap, CALL_HEROES);
  const titans = extractRoster(callMap, CALL_TITANS);
  const ownName = extractOwnName(callMap) ?? 'me';
  const hasRoster = heroes.length > 0 || titans.length > 0;
  const text = formatOwnMystats(heroes, titans, ownName);
  const body = $('my-stats-body');
  if (!body) return { heroes: 0, titans: 0 };
  if (!hasRoster) {
    body.innerHTML = '<div class="empty-hint">No roster data found in this HAR.</div>';
    return { heroes: 0, titans: 0 };
  }
  body.innerHTML = `
    <div class="card">
      <textarea id="own-text"></textarea>
      <button class="copy" data-target="own-text">Copy</button>
    </div>
  `;
  const ta = document.getElementById('own-text') as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  wireCopyButtons(body);
  return { heroes: heroes.length, titans: titans.length };
}

export interface DefenceRenderResult {
  count: number;
  warriors: number;
}

export function renderAllies(
  callMap: CallMap,
  opts: { pad: boolean },
): DefenceRenderResult {
  const members = extractClanMembers(callMap);
  const teams = extractDefenceTeams(callMap);
  const warriors = extractWarriors(callMap);

  const allUids = new Set([...Object.keys(members), ...Object.keys(teams)]);
  const list = [...allUids]
    .map(uid => ({
      uid,
      name: members[uid] ?? `?uid=${uid}`,
      team: teams[uid] ?? { heroes: [], titans: [] },
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const container = $('defence-list');
  if (!container) return { count: 0, warriors: warriors.size };
  container.innerHTML = '';
  for (const m of list) {
    const text = formatMemberDefence(m.name, m.team, { pad: opts.pad });
    const card = document.createElement('div');
    card.className = 'card';
    const isActive = warriors.has(m.uid);
    card.dataset.active = isActive ? '1' : '0';
    const taId = `def-${m.uid}`;
    const badge = isActive ? `<span class="badge">Active in war</span>` : '';
    card.innerHTML = `
      <h3>${escapeHtml(m.name)}${badge}</h3>
      <textarea id="${taId}"></textarea>
      <button class="copy" data-target="${taId}">Copy</button>
    `;
    const ta = card.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta) ta.value = text;
    container.appendChild(card);
  }
  wireCopyButtons(container);
  const section = $('defence-section');
  if (section) section.hidden = list.length === 0;
  return { count: list.length, warriors: warriors.size };
}

function applyFilterToContainer(containerId: string, checkboxId: string, anyActive: boolean): void {
  const checkbox = document.getElementById(checkboxId) as HTMLInputElement | null;
  const on = !!checkbox?.checked && anyActive;
  const container = $(containerId);
  if (!container) return;
  for (const card of container.querySelectorAll<HTMLElement>('.card')) {
    card.hidden = on ? card.dataset.active !== '1' : false;
  }
}

export function applyActiveFilter(callMap: CallMap | null): void {
  if (!callMap) return;
  const warriors = extractWarriors(callMap);
  applyFilterToContainer('defence-list', 'active-only', warriors.size > 0);
}

// Renders a {uid: EnemyDefence} map into the given container as one card per user
// with /beathero + /beattitan textareas. Returns the rendered count.
function renderDefenceMap(
  container: HTMLElement,
  defenceByUid: Record<string, EnemyDefence>,
  idPrefix: string,
): number {
  const list = Object.entries(defenceByUid)
    .map(([uid, e]) => ({ uid, ...e }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  container.innerHTML = '';
  for (const e of list) {
    const heroesText = formatBeathero(e.heroSlots);
    const titansText = formatBeattitan(e.titanSlots);
    const card = document.createElement('div');
    card.className = 'card';
    const heroesId = `${idPrefix}-heroes-${e.uid}`;
    const titansId = `${idPrefix}-titans-${e.uid}`;
    let html = `<h3>${escapeHtml(e.name)}</h3>`;
    if (heroesText) {
      html += `<div class="card-row"><textarea id="${heroesId}"></textarea>` +
              `<button class="copy" data-target="${heroesId}">Copy</button></div>`;
    }
    if (titansText) {
      html += `<div class="card-row"><textarea id="${titansId}"></textarea>` +
              `<button class="copy" data-target="${titansId}">Copy</button></div>`;
    }
    card.innerHTML = html;
    if (heroesText) {
      const ta = card.querySelector(`#${heroesId}`) as HTMLTextAreaElement | null;
      if (ta) ta.value = heroesText;
    }
    if (titansText) {
      const ta = card.querySelector(`#${titansId}`) as HTMLTextAreaElement | null;
      if (ta) ta.value = titansText;
    }
    container.appendChild(card);
  }
  wireCopyButtons(container);
  return list.length;
}

export function renderEnemies(callMap: CallMap): number {
  const enemies = extractEnemyDefence(callMap);
  const container = $('enemy-defence-list');
  if (!container) return 0;
  const count = renderDefenceMap(container, enemies, 'enemy');
  const section = $('enemy-defence-section');
  if (section) section.hidden = count === 0;
  const empty = $('normal-enemies-empty');
  if (empty) empty.hidden = count > 0;
  return count;
}

// GC: Allies. Prefers the per-user data from clanWarChampInfo_getInfo (active GC war),
// renders one /mystats line per ally with all units (15 heroes + 5 titans) flattened.
// All clan members are rendered; participants get an "Active in war" badge and data-active="1".
// Falls back to the user's own champ-defence templates from teamGetAll when no GC war.
export function renderChampAllies(callMap: CallMap, opts: { pad: boolean }): number {
  const body = $('champ-allies-body');
  const banner = $('champ-allies-banner');
  if (!body) return 0;

  const gcAllies = extractGcAllyDefence(callMap);
  const gcUids = Object.keys(gcAllies);
  if (gcUids.length > 0) {
    if (banner) banner.hidden = true;
    const list = gcUids
      .map(uid => ({ uid, ...gcAllies[uid]! }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    body.innerHTML = '';
    for (const m of list) {
      const heroes = m.heroSlots.flat();
      const titans = (m.titanSlots[0] ?? []).slice();
      const text = formatMemberDefence(m.name, { heroes, titans }, { pad: opts.pad });
      const card = document.createElement('div');
      card.className = 'card';
      const taId = `gc-ally-${m.uid}`;
      card.innerHTML =
        `<h3>${escapeHtml(m.name)}</h3>` +
        `<textarea id="${taId}"></textarea>` +
        `<button class="copy" data-target="${taId}">Copy</button>`;
      const ta = card.querySelector('textarea') as HTMLTextAreaElement | null;
      if (ta) ta.value = text;
      body.appendChild(card);
    }
    wireCopyButtons(body);
    return list.length;
  }

  // Fallback: render the user's own champ templates as one /mystats line.
  const champ = extractOwnChampDefence(callMap);
  if (!champ) {
    if (banner) banner.hidden = true;
    body.innerHTML = `<div class="empty-hint">No GC defence data found.</div>`;
    return 0;
  }
  if (banner) {
    banner.hidden = false;
    banner.textContent =
      "GC war isn't active in this HAR — showing your own templates only. " +
      'Capture during an active championship for full clan data.';
  }
  const ownName = extractOwnName(callMap) ?? 'me';
  const heroes = champ.heroSlots.flat();
  const titans = (champ.titanSlots[0] ?? []).slice();
  const text = formatMemberDefence(ownName, { heroes, titans }, { pad: opts.pad });
  body.innerHTML =
    `<div class="card"><h3>${escapeHtml(ownName)}</h3>` +
    `<textarea id="champ-own"></textarea>` +
    `<button class="copy" data-target="champ-own">Copy</button></div>`;
  const ta = document.getElementById('champ-own') as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  wireCopyButtons(body);
  return 0;
}

// GC: Enemies. Renders per-user enemy GC defences from clanWarChampInfo_getInfo.
// Returns the rendered count.
export function renderChampEnemies(callMap: CallMap): number {
  const enemies = extractGcEnemyDefence(callMap);
  const list = $('champ-enemy-defence-list');
  const empty = $('champ-enemies-empty');
  if (!list) return 0;

  const count = renderDefenceMap(list, enemies, 'gc-enemy');
  const section = $('champ-enemy-defence-section');
  if (section) section.hidden = count === 0;
  if (empty) empty.hidden = count > 0;
  return count;
}
