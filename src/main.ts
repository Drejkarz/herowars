// Entry: imports CSS, wires DOM, glues parser + renderers together.

import './styles.css';
import { buildCallMap, CALL_HEROES, CALL_TITANS, CALL_WARLORD } from './parser.js';
import {
  applyActiveFilter,
  renderAllies,
  renderChampAllies,
  renderChampEnemies,
  renderEnemies,
  renderOwn,
} from './render.js';
import { wireTabs } from './tabs.js';
import type { CallMap } from './types.js';

let lastMap: CallMap | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setStatus(msg: string, isError = false): void {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

interface StatsLine {
  heroes: number;
  titans: number;
  gwAllies: number;
  gwEnemies: number;
  gcAllies: number;
  gcEnemies: number;
  warriors: number;
}

function setStats({
  heroes,
  titans,
  gwAllies,
  gwEnemies,
  gcAllies,
  gcEnemies,
  warriors,
}: StatsLine): void {
  const segments: string[] = [];
  if (heroes > 0) segments.push(`Heroes: ${heroes}`);
  if (titans > 0) segments.push(`Titans: ${titans}`);
  if (gwAllies > 0) segments.push(`GW allies: ${gwAllies}`);
  if (gwEnemies > 0) segments.push(`GW enemies: ${gwEnemies}`);
  if (gcAllies > 0) segments.push(`GC allies: ${gcAllies}`);
  if (gcEnemies > 0) segments.push(`GC enemies: ${gcEnemies}`);
  if (warriors > 0) segments.push(`Warriors: ${warriors}`);
  const stats = $('stats');
  if (stats) stats.textContent = segments.join(' · ');
}

function renderAll(): void {
  if (!lastMap) return;
  const padCheckbox = document.getElementById('pad') as HTMLInputElement | null;
  const padGcCheckbox = document.getElementById('pad-gc') as HTMLInputElement | null;
  const own = renderOwn(lastMap);
  const allies = renderAllies(lastMap, { pad: !!padCheckbox?.checked });
  const gwEnemies = renderEnemies(lastMap);
  const gcAllies = renderChampAllies(lastMap, { pad: !!padGcCheckbox?.checked });
  const gcEnemies = renderChampEnemies(lastMap);

  const normalEmpty = $('normal-allies-empty');
  if (normalEmpty) normalEmpty.hidden = allies.count > 0;

  setStats({
    heroes: own.heroes,
    titans: own.titans,
    gwAllies: allies.count,
    gwEnemies,
    gcAllies,
    gcEnemies,
    warriors: allies.warriors,
  });

  applyActiveFilter(lastMap);

  const missing: string[] = [];
  if (!lastMap.has(CALL_HEROES) && !lastMap.has(CALL_TITANS)) {
    missing.push('your roster (heroGetAll/titanGetAll)');
  }
  if (!lastMap.has(CALL_WARLORD)) {
    missing.push('clan defence — re-capture HAR with the clan war screen open');
  }
  if (missing.length) {
    const el = $('status');
    const cur = el?.textContent ?? '';
    setStatus(`${cur} · Missing: ${missing.join('; ')}`);
  }
}

function clearAll(): void {
  const myStats = $('my-stats-body');
  if (myStats) myStats.innerHTML = '<div class="empty-hint">Load a HAR to see this tab.</div>';
  const def = $('defence-list');
  if (def) def.innerHTML = '';
  const enemyDef = $('enemy-defence-list');
  if (enemyDef) enemyDef.innerHTML = '';
  const defSec = $('defence-section');
  if (defSec) defSec.hidden = true;
  const enemyDefSec = $('enemy-defence-section');
  if (enemyDefSec) enemyDefSec.hidden = true;
  const champBody = $('champ-allies-body');
  if (champBody) champBody.innerHTML = '<div class="empty-hint">Load a HAR to see this tab.</div>';
  const champBanner = $('champ-allies-banner');
  if (champBanner) champBanner.hidden = true;
  const champEnemyList = $('champ-enemy-defence-list');
  if (champEnemyList) champEnemyList.innerHTML = '';
  const champEnemySection = $('champ-enemy-defence-section');
  if (champEnemySection) champEnemySection.hidden = true;
  const normalAlliesEmpty = $('normal-allies-empty');
  if (normalAlliesEmpty) normalAlliesEmpty.hidden = false;
  const normalEnemiesEmpty = $('normal-enemies-empty');
  if (normalEnemiesEmpty) normalEnemiesEmpty.hidden = false;
  const champEnemiesEmpty = $('champ-enemies-empty');
  if (champEnemiesEmpty) champEnemiesEmpty.hidden = false;
  const stats = $('stats');
  if (stats) stats.textContent = '';
}

async function handleFile(file: File | null | undefined): Promise<void> {
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    const text = await file.text();
    const { map, rpcEntries } = buildCallMap(text);
    if (rpcEntries === 0) {
      lastMap = null;
      setStatus(`Could not find HWA API calls in ${file.name}`, true);
      clearAll();
      return;
    }
    lastMap = map;
    setStatus(`Loaded ${file.name} (${rpcEntries} rpc entries, ${map.size} unique calls)`);
    renderAll();
  } catch (err) {
    lastMap = null;
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed to parse ${file.name}: ${message}`, true);
  }
}

function wireFileInput(): void {
  const fileInput = document.getElementById('file') as HTMLInputElement | null;
  fileInput?.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    handleFile(target.files?.[0]);
  });
}

function wireDropZone(): void {
  const drop = $('drop');
  if (!drop) return;
  for (const ev of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('drag');
    });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('drag');
    });
  }
  drop.addEventListener('drop', e => {
    const dragEvent = e as DragEvent;
    const f = dragEvent.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  drop.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (target.id === 'file') return;
    if (target.tagName === 'LABEL') return;
    (document.getElementById('file') as HTMLInputElement | null)?.click();
  });
}

function wireControls(): void {
  document.getElementById('pad')?.addEventListener('change', renderAll);
  document.getElementById('pad-gc')?.addEventListener('change', renderAll);
  document.getElementById('active-only')?.addEventListener('change', () => {
    applyActiveFilter(lastMap);
  });
}

function init(): void {
  wireTabs();
  wireFileInput();
  wireDropZone();
  wireControls();
}

init();
