# HWA /mystats Helper Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single static `index.html` that ingests a Hero Wars Alliance `.har` file and emits ready-to-paste `/mystats update …` commands for the user's own roster and for every clan-mate's defence team.

**Architecture:** One self-contained `index.html` at repo root with embedded `<style>` and `<script>`. Mapping JSON inlined as `const`. Pure functions for parsing/formatting at the top of the script, DOM wiring at the bottom. No build step, no dependencies — drop-in for GitHub Pages.

**Tech Stack:** HTML5, vanilla JS (ES2020+), CSS. Browser APIs: `FileReader`, drag-and-drop events, `navigator.clipboard`.

**Reference inputs (already in working dir):**
- Sample HAR: `www.hero-wars-alliance.com.har`
- Sample extracted payload: `HWA.json` (the JSON-RPC array — same shape as what's inside the HAR responses)
- ID→name mapping: `hwa mapping.json`
- Existing python reference: `hwa_clan_defence.py` (mirrors the per-member defence logic we need)

**HAR shape (verified against the sample):** the HAR contains many `POST https://api.hero-wars-alliance.com/api/rpc` entries. Each request body is `{calls: [{name, args, ident}]}`, each response body is `{results: [{ident, result: {response}}], date}`. The `ident` field is a **per-request, client-generated correlation id** — different in every HAR/session — used only to pair `results[i]` to `calls[j]`. The stable lookup key is the call **`name`**.

**Call names we read (stable across HARs):**
- `heroGetAll` → `{heroId: {power, …}, …}` (own heroes)
- `titanGetAll` → `{titanId: {power, …}, …}` (own titans)
- `user_getClanInfo` → `clanData.clan.members[uid].name`
- `clanWarGetWarlordInfo` → `defence.teams[uid].clanDefence_heroes.units[id].power` (and `.clanDefence_titans.units[id].power`)

**Capture caveat:** `clanWarGetWarlordInfo` is only requested when the user opens the clan war / defence screen. If a HAR is captured without visiting that screen, the defence section will be empty.

**Output format conventions (locked):**
- Own roster: `/mystats update <Name> : <Power> <Name> : <Power> …` heroes first, then titans, single line.
- Per-member defence: `/mystats update <Name> : <Power> … user:@<MemberName>`.
- Unknown unit ids render as `?<id>` (do not crash, do not drop).
- Clan-member cards sorted alphabetically (case-insensitive) by member name. Empty teams still render.
- "Pad with :10000" checkbox affects defence outputs only. When on, append every mapping hero id missing from the team as `Name : 10000`, then same for titans, before the `user:@…` suffix.

---

### Task 1: Scaffold `index.html` skeleton

**Files:**
- Create: `index.html`

**Step 1: Write the file**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>HWA /mystats helper</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { margin-top: 0; }
  #drop { border: 2px dashed #888; border-radius: 8px; padding: 2rem; text-align: center; cursor: pointer; }
  #drop.drag { background: #eef; border-color: #44a; }
  #status { margin: 0.75rem 0; font-family: ui-monospace, monospace; }
  #status.error { color: #b00; }
  #stats { margin: 0.25rem 0 1rem; color: #555; font-size: 0.9rem; }
  .card { border: 1px solid #ccc; border-radius: 6px; padding: 0.75rem; margin: 0.75rem 0; }
  .card h3 { margin: 0 0 0.5rem; font-size: 1rem; }
  textarea { width: 100%; min-height: 4rem; font-family: ui-monospace, monospace; font-size: 0.85rem; }
  button.copy { margin-top: 0.4rem; padding: 0.3rem 0.8rem; cursor: pointer; }
  button.copy.ok { background: #cfc; }
  label.toggle { display: block; margin: 0.5rem 0 1rem; }
</style>
</head>
<body>
<h1>HWA /mystats helper</h1>

<div id="drop">
  Drop a <code>.har</code> file here, or <input type="file" id="file" accept=".har,application/json">
</div>

<div id="status">No file loaded.</div>
<div id="stats"></div>

<label class="toggle"><input type="checkbox" id="pad"> Pad missing units with <code>:10000</code> in clan defence outputs</label>

<section id="own-section" hidden>
  <h2>Your /mystats</h2>
  <div class="card">
    <textarea id="own-text" readonly></textarea>
    <button class="copy" data-target="own-text">Copy</button>
  </div>
</section>

<section id="defence-section" hidden>
  <h2>Clan defence</h2>
  <div id="defence-list"></div>
</section>

<script>
// === MAPPING (filled in Task 2) ===
const HERO_NAMES = {};
const TITAN_NAMES = {};

// === PARSING / FORMATTING (filled in Tasks 3-8) ===

// === DOM WIRING (filled in Tasks 9-10) ===
</script>
</body>
</html>
```

**Step 2: Verify**

Open `index.html` in a browser. Expected: page renders with header, drop zone, "No file loaded.", checkbox, and no output sections (they're `hidden`).

**Step 3: Commit (only if a git repo exists; otherwise skip)**

```bash
git add index.html && git commit -m "feat: scaffold mystats helper page"
```

---

### Task 2: Inline the mapping JSON

**Files:**
- Modify: `index.html` (the `HERO_NAMES` / `TITAN_NAMES` consts)

**Step 1: Read the mapping**

Read `hwa mapping.json` — it has shape `{"heroes": {"1": "Aurora", …}, "titans": {"4000": "Sigurd", …}}`.

**Step 2: Replace the placeholder consts**

Replace `const HERO_NAMES = {};` with the contents of `mapping.heroes`, and `const TITAN_NAMES = {};` with `mapping.titans`. Inline literally — do not fetch.

**Step 3: Verify**

In the browser DevTools console after reload: `Object.keys(HERO_NAMES).length` should match the number of heroes in the JSON (~80), `TITAN_NAMES['4000']` should be `'Sigurd'`.

**Step 4: Commit**

```bash
git add index.html && git commit -m "feat: inline hwa id->name mapping"
```

---

### Task 3: HAR parser — build a `name → response` map

**Files:**
- Modify: `index.html` script block

**Step 1: Add the parser**

Insert under the `// === PARSING / FORMATTING ===` marker:

```js
// Walks all /api/rpc entries in a HAR and returns Map<callName, responseBody>.
// The `ident` field in HAR is a per-request nonce, so we cross-reference each
// response item against the corresponding request's ident->name map.
function buildCallMap(harText) {
  const har = JSON.parse(harText);
  const entries = har?.log?.entries || [];
  const map = new Map();
  let rpcEntries = 0;

  for (const e of entries) {
    const url = e?.request?.url || '';
    if (!url.includes('/api/rpc')) continue;
    const reqText = e?.request?.postData?.text;
    const resText = e?.response?.content?.text;
    if (!reqText || !resText) continue;

    let req, res;
    try { req = JSON.parse(reqText); res = JSON.parse(resText); } catch { continue; }

    const calls = Array.isArray(req?.calls) ? req.calls : null;
    const results = Array.isArray(res?.results) ? res.results : null;
    if (!calls || !results) continue;
    rpcEntries++;

    const identToName = {};
    for (const c of calls) if (c?.ident && c?.name) identToName[c.ident] = c.name;
    for (const r of results) {
      const name = identToName[r?.ident];
      if (name) map.set(name, r?.result?.response ?? null);
    }
  }
  return { map, rpcEntries };
}
```

**Step 2: Verify in console**

Temporarily expose it: add `window.buildCallMap = buildCallMap;` at the bottom of the script. Reload `index.html` in a browser, open DevTools, then:

```js
fetch('www.hero-wars-alliance.com.har').then(r=>r.text()).then(t => {
  const { map, rpcEntries } = buildCallMap(t);
  console.log('rpc entries:', rpcEntries, 'unique names:', map.size);
  console.log('heroGetAll sample id:', Object.keys(map.get('heroGetAll') || {})[0]);
  console.log('clanWarGetWarlordInfo top keys:', Object.keys(map.get('clanWarGetWarlordInfo') || {}));
  console.log('user_getClanInfo members count:',
    Object.keys(map.get('user_getClanInfo')?.clanData?.clan?.members || {}).length);
});
```

Expected: `rpc entries: ~11`, `unique names: ~120`, `heroGetAll` sample id is a numeric string, `clanWarGetWarlordInfo` keys include `warInfo` and `defence`, members count is `30`. Remove the `window.` line afterwards.

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: HAR parser builds call-name -> response map"
```

---

### Task 4: Extractors keyed by call name

**Files:**
- Modify: `index.html` script block

**Step 1: Add extractor functions**

```js
const CALL_HEROES   = 'heroGetAll';
const CALL_TITANS   = 'titanGetAll';
const CALL_CLAN     = 'user_getClanInfo';
const CALL_WARLORD  = 'clanWarGetWarlordInfo';

// Returns [{id: '1', power: 33406}, ...] or [] if absent.
function extractRoster(callMap, callName) {
  const resp = callMap.get(callName);
  if (!resp || typeof resp !== 'object') return [];
  return Object.entries(resp)
    .filter(([, v]) => v && typeof v.power === 'number')
    .map(([id, v]) => ({ id, power: v.power }));
}

// Returns {uid: name}
function extractClanMembers(callMap) {
  const resp = callMap.get(CALL_CLAN);
  const members = resp?.clanData?.clan?.members || {};
  const out = {};
  for (const [uid, m] of Object.entries(members)) out[uid] = m?.name ?? `?uid=${uid}`;
  return out;
}

// Returns {uid: {heroes: [{id, power}], titans: [{id, power}]}}
function extractDefenceTeams(callMap) {
  const resp = callMap.get(CALL_WARLORD);
  const teams = resp?.defence?.teams || {};
  const out = {};
  for (const [uid, t] of Object.entries(teams)) {
    const heroes = Object.entries(t?.clanDefence_heroes?.units || {})
      .map(([id, u]) => ({ id, power: u.power }));
    const titans = Object.entries(t?.clanDefence_titans?.units || {})
      .map(([id, u]) => ({ id, power: u.power }));
    out[uid] = { heroes, titans };
  }
  return out;
}
```

**Step 2: Verify in console (with the sample HAR)**

After temporarily exposing the extractors, run:

```js
fetch('www.hero-wars-alliance.com.har').then(r=>r.text()).then(t => {
  const { map } = buildCallMap(t);
  console.log('heroes:', extractRoster(map, CALL_HEROES).length);
  console.log('titans:', extractRoster(map, CALL_TITANS).length);
  console.log('members:', Object.keys(extractClanMembers(map)).length);
  console.log('defence teams:', Object.keys(extractDefenceTeams(map)).length);
});
```

Expected: heroes ≈ 80, titans ≈ 26, members ≈ 30, defence teams ≈ 30 (matching the captured HAR).

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: extractors keyed by call name (idents are not stable)"
```

---

### Task 5: Formatting helpers

**Files:**
- Modify: `index.html` script block

**Step 1: Add formatters**

```js
function nameFor(id) {
  return HERO_NAMES[id] ?? TITAN_NAMES[id] ?? `?${id}`;
}

function fmtUnits(units) {
  return units.map(u => `${nameFor(u.id)} : ${u.power}`).join(' ');
}

function formatOwnMystats(heroes, titans) {
  const parts = [...heroes, ...titans];
  if (!parts.length) return '';
  return `/mystats update ${fmtUnits(parts)}`;
}

function padToFull(units, nameMap, fillPower = 10000) {
  const have = new Set(units.map(u => u.id));
  const padded = [...units];
  for (const id of Object.keys(nameMap)) {
    if (!have.has(id)) padded.push({ id, power: fillPower });
  }
  return padded;
}

function formatMemberDefence(memberName, team, { pad }) {
  let heroes = team?.heroes || [];
  let titans = team?.titans || [];
  if (pad) {
    heroes = padToFull(heroes, HERO_NAMES);
    titans = padToFull(titans, TITAN_NAMES);
  }
  const units = [...heroes, ...titans];
  const body = units.length ? fmtUnits(units) + ' ' : '';
  return `/mystats update ${body}user:@${memberName}`;
}
```

**Step 2: Verify in console**

```js
formatOwnMystats([{id:'1',power:33406},{id:'2',power:20442}], [{id:'4000',power:93413}])
// → "/mystats update Aurora : 33406 Galahad : 20442 Sigurd : 93413"

formatMemberDefence('Bob', {heroes:[{id:'1',power:5000}], titans:[]}, {pad:false})
// → "/mystats update Aurora : 5000 user:@Bob"

formatMemberDefence('Bob', {heroes:[], titans:[]}, {pad:false})
// → "/mystats update user:@Bob"
```

All three should match exactly.

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: output formatters for mystats and defence"
```

---

### Task 6: DOM rendering — own roster section

**Files:**
- Modify: `index.html` script block

**Step 1: Add `renderOwn(rpc)` and a tiny copy helper**

Under `// === DOM WIRING ===`:

```js
function $(id) { return document.getElementById(id); }

function attachCopy(btn) {
  btn.addEventListener('click', async () => {
    const ta = $(btn.dataset.target);
    if (!ta) return;
    await navigator.clipboard.writeText(ta.value);
    const orig = btn.textContent;
    btn.textContent = 'Copied ✓';
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1000);
  });
}

function renderOwn(callMap) {
  const heroes = extractRoster(callMap, CALL_HEROES);
  const titans = extractRoster(callMap, CALL_TITANS);
  const text = formatOwnMystats(heroes, titans);
  const section = $('own-section');
  if (!text) { section.hidden = true; return { heroes: 0, titans: 0 }; }
  $('own-text').value = text;
  section.hidden = false;
  return { heroes: heroes.length, titans: titans.length };
}

// Wire the static copy button now
document.querySelectorAll('button.copy').forEach(attachCopy);
```

**Step 2: Verify**

Not visible yet (no file loader), but no console errors on reload. Confirm via console: after running the Task 3 fetch, call `renderOwn(map)` — should populate the textarea and unhide the section.

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: render own /mystats section"
```

---

### Task 7: DOM rendering — per-member defence cards

**Files:**
- Modify: `index.html` script block

**Step 1: Add `renderDefence(rpc, opts)`**

```js
function renderDefence(callMap, { pad }) {
  const members = extractClanMembers(callMap);
  const teams = extractDefenceTeams(callMap);

  // Member set: union of clan members and uids that have a team
  const allUids = new Set([...Object.keys(members), ...Object.keys(teams)]);
  const list = [...allUids].map(uid => ({
    uid,
    name: members[uid] ?? `?uid=${uid}`,
    team: teams[uid] ?? { heroes: [], titans: [] },
  }));
  list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const container = $('defence-list');
  container.innerHTML = '';
  for (const m of list) {
    const text = formatMemberDefence(m.name, m.team, { pad });
    const card = document.createElement('div');
    card.className = 'card';
    const taId = `def-${m.uid}`;
    card.innerHTML = `
      <h3>${escapeHtml(m.name)}</h3>
      <textarea id="${taId}" readonly></textarea>
      <button class="copy" data-target="${taId}">Copy</button>
    `;
    card.querySelector('textarea').value = text;
    container.appendChild(card);
  }
  container.querySelectorAll('button.copy').forEach(attachCopy);
  $('defence-section').hidden = list.length === 0;
  return list.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
```

**Step 2: Verify**

Console: `renderDefence(map, {pad:false})`. Defence section should appear with one card per member, sorted A→Z, each textarea containing a `/mystats update … user:@Name` line.

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: render clan defence per-member cards"
```

---

### Task 8: File-loading wiring (drag-drop + picker) + status/stats line + checkbox

**Files:**
- Modify: `index.html` script block

**Step 1: Add the orchestrator and event wiring**

```js
let lastMap = null;

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

function setStats({ heroes, titans, teams }) {
  $('stats').textContent =
    `Heroes: ${heroes} · Titans: ${titans} · Defence teams: ${teams}`;
}

function renderAll() {
  if (!lastMap) return;
  const own = renderOwn(lastMap);
  const teamsCount = renderDefence(lastMap, { pad: $('pad').checked });
  setStats({ heroes: own.heroes, titans: own.titans, teams: teamsCount });

  // Helpful hints when key calls are missing
  const missing = [];
  if (!lastMap.has(CALL_HEROES) && !lastMap.has(CALL_TITANS)) missing.push('your roster (heroGetAll/titanGetAll)');
  if (!lastMap.has(CALL_WARLORD)) missing.push('clan defence — re-capture HAR with the clan war screen open');
  if (missing.length) {
    const cur = $('status').textContent;
    setStatus(`${cur} · Missing: ${missing.join('; ')}`);
  }
}

async function handleFile(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    const text = await file.text();
    const { map, rpcEntries } = buildCallMap(text);
    if (rpcEntries === 0) {
      lastMap = null;
      setStatus(`Could not find HWA API calls in ${file.name}`, true);
      $('own-section').hidden = true;
      $('defence-section').hidden = true;
      $('stats').textContent = '';
      return;
    }
    lastMap = map;
    setStatus(`Loaded ${file.name} (${rpcEntries} rpc entries, ${map.size} unique calls)`);
    renderAll();
  } catch (err) {
    lastMap = null;
    setStatus(`Failed to parse ${file.name}: ${err.message}`, true);
  }
}

// File picker
$('file').addEventListener('change', e => handleFile(e.target.files[0]));

// Drag-and-drop on the drop zone
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev =>
  drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev =>
  drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
});
// Click anywhere on the drop zone (except on the input) opens the picker
drop.addEventListener('click', e => {
  if (e.target.id !== 'file') $('file').click();
});

// Pad checkbox re-renders defence section
$('pad').addEventListener('change', renderAll);
```

**Step 2: Verify (manual, full flow)**

1. Open `index.html` in a browser.
2. Drag `www.hero-wars-alliance.com.har` onto the drop zone. Status shows `Loaded www.hero-wars-alliance.com.har`. Stats line shows non-zero counts.
3. "Your /mystats" textarea contains `/mystats update Aurora : <num> Galahad : <num> …` with both heroes and titans.
4. Clan defence section shows ≥1 card per member, sorted A→Z. Each ends with `user:@<MemberName>`.
5. Tick the pad checkbox. Every defence textarea now lists *every* hero and titan from the mapping; ones not in the original team show `:10000`.
6. Untick — outputs revert.
7. Click any Copy button — paste into a text editor: matches the textarea verbatim. Button briefly shows `Copied ✓`.
8. Drag a non-HAR file (e.g. `hwa mapping.json`) — status turns red with `Could not find HWA API calls in hwa mapping.json`. Sections hide.
9. Drag the HAR again — recovers, sections reappear.
10. Click the file-picker label — native file dialog opens.

If any of those fail, fix before committing.

**Step 3: Commit**

```bash
git add index.html && git commit -m "feat: wire file loader, drag-drop, status, stats, pad toggle"
```

---

### Task 9: Final polish pass

**Files:**
- Modify: `index.html`

**Step 1: Sanity items**

- Sort the rendered own-roster output is implicit (object iteration order). If the order looks weird in the browser, sort heroes/titans in `renderOwn` by `parseInt(id)` before formatting — but only if needed; YAGNI by default.
- Confirm `<title>` and `<h1>` are sensible.
- No `console.log` left in the code.

**Step 2: Verify**

Reload, repeat the Task 8 verification steps once more. Open DevTools console — no errors, no warnings other than possibly the clipboard permission prompt on first copy.

**Step 3: Commit (if any changes)**

```bash
git add index.html && git commit -m "chore: polish mystats helper page"
```

---

### Task 10 (optional): Initialize git + GitHub Pages

Skip if the directory is already a repo or the user wants to handle this themselves.

**Step 1:** `git init && git add index.html docs/ && git commit -m "init: hwa /mystats helper"`
**Step 2:** Create a GitHub repo, `git remote add origin …`, `git push -u origin main`.
**Step 3:** In repo Settings → Pages → Build from branch `main` / root. Done.

---

## Notes for the executor

- **Idents in the HAR are NOT stable.** They are per-request nonces generated by the client to correlate batched calls with their results. Always look up data by call **name**, never by ident. (The reference python script `hwa_clan_defence.py` hard-codes idents because it was derived from one HAR snapshot — do not copy that approach.)
- **No automated tests exist for this page** — verification is manual against `www.hero-wars-alliance.com.har` per Task 8 step 2. Don't add a test framework; the design rejected it.
- **Mapping is inlined intentionally** — single-file deploy. Don't refactor it back to a `fetch('mapping.json')`.
- **Don't introduce build tooling** (Vite, npm, TS). The user explicitly chose single-file.
- If a unit id appears in the data but not in `HERO_NAMES`/`TITAN_NAMES`, render `?<id>`. Don't crash, don't filter it out, don't fetch new mappings — just surface it so the user can update `hwa mapping.json` later.
- `clanWarGetWarlordInfo` is only present in the HAR if the user opened the clan war/defence screen during recording. Show a helpful hint, don't show an error.
- **Out of scope for v1: enemy clan defence** (regular 1x heroes/1x titans, championship 3x heroes/1x titans). Sample HAR was captured with no active war so the enemy-defence call name isn't yet known. Do not speculate on call names; revisit once an active-war HAR is captured. The championship hero shape is an array of three teams (per `teamGetAll.champClanDefence_heroes`), which the extractor will need to handle.
