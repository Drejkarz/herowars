# HWA /mystats helper — static page design

**Date:** 2026-05-10
**Goal:** A static, GitHub-Pages-hostable page that turns a Hero Wars Alliance `.har` capture into ready-to-paste `/mystats update …` commands for (a) the user's own roster and (b) every clan-mate's defence team.

## Non-goals

- No backend, no API calls, no auth.
- No build step, no framework. Single self-contained HTML file.
- Not handling anything other than the four idents listed below.

## Inputs

- A `.har` file (typically `www.hero-wars-alliance.com.har`).
- The page accepts it via drag-and-drop **and** a click-to-browse picker.

## Output sections (in order on the page)

1. **File status line:** `Loaded <filename>` or red `Could not find HWA payload in this .har`.
2. **Stats line:** `Heroes: X · Titans: Y · Defence teams: Z · Enemy teams: E` (Enemy segment hidden when 0).
3. **Global checkboxes:**
   - `Pad missing units with :10000 in clan defence outputs` — applies only to the friendly clan defence section; never to own roster or enemy section.
   - `Show only active war participants` — when on, hides clan-defence cards whose member uid is NOT in `defence.warriors`. Default OFF. Has no effect on the enemy section (every enemy card is already an active participant).
4. **Your /mystats:** read-only textarea + Copy button.
   - Format: `/mystats update Aurora : 33406 Galahad : 20442 … Sigurd : 93413 …` (heroes first, then titans; single line; user roster is **not** padded).
5. **Clan defence — one card per member, sorted alphabetically by member name:**
   - Read-only textarea + Copy button.
   - Format: `/mystats update Aurora : 12345 … Sigurd : 50000 … user:@<MemberName>`
   - When the pad checkbox is on: every hero id from the mapping that isn't already in the team is appended as `Name : 10000`, then same for titans (after the team's actual units, before `user:@…`).
   - Members with no defence team set → render an empty card (`/mystats update user:@Name`, padded if checkbox is on).
   - **Active-war badge:** if the member's uid is in `clanWarGetWarlordInfo.defence.warriors`, the card header shows a small `Active in war` badge next to the name.
   - **Active-only filter:** when the "Show only active war participants" checkbox is on, cards for non-active members are hidden (DOM stays, just `hidden = true`, so toggling is instant). When `defence.warriors` is missing entirely (no active war), the filter is a no-op (everything stays visible).
6. **Enemy clan defence — only rendered during an active war:**
   - Source: `clanWarGetWarlordInfo.warInfo.enemySlots`. Each slot has `team[0]` = `{unitId: {power, …}}` and `user.name`. A unit id `>= 4000` is a titan; below `4000` is a hero.
   - One card per enemy user, sorted A→Z by enemy name. Each card has up to two textareas + Copy buttons:
     - **Heroes textarea (`/beathero`)**: emitted when the enemy has at least one hero team. The format lists each hero team in order:
       `/beathero team1power: <sum-of-team1-hero-powers> team1heroes: <Name> <Name> <Name> <Name> <Name>` then `team2power: …` then `team3power: …` etc. Regular war = exactly one team (one slot). Championship war = three teams (three slots). Hero teams are ordered by ascending `slotId`. Names separated by single spaces. Unknown ids render as `?<id>`.
     - **Titans textarea (`/beattitan`)**: emitted when the enemy has a titan team:
       `/beattitan defense-team-power: <sum-of-titan-powers> defense-titans: <Name> <Name> <Name> <Name> <Name>`
   - If a slot type is absent for that enemy, that textarea/button is omitted (don't render an empty one).
   - Pad checkbox does NOT apply here (the `/beathero` and `/beattitan` formats have no slot for "missing names").
   - When `warInfo.enemySlots` is missing/empty (no active war captured), the section is hidden.
   - **Championship caveat:** the design supports 1..N hero slots per enemy by iterating all hero slots in `enemySlots` for that user. If championship data uses a different RPC field path (e.g. `champEnemySlots`), the page won't pick it up automatically. Confirmed working for regular war (`mode: ghostBridge`) per `HWA.json`. Revisit once a championship-mode HAR is captured.

## Parsing

The HAR contains many `POST https://api.hero-wars-alliance.com/api/rpc` entries. Each is a batched JSON-RPC call:

- **Request body:** `{"calls": [{"name": "heroGetAll", "args": {…}, "ident": "<32-hex>"}, …]}`
- **Response body:** `{"results": [{"ident": "<32-hex>", "result": {"response": …}}, …], "date": …}`

The `ident` field is a **per-request, client-generated correlation id** — different in every HAR/session. It only pairs a single response item to its corresponding call within one batch. **It is NOT a stable identifier and must not be hard-coded.**

The stable identifier is the call `name`. For each `/api/rpc` entry:
1. Parse request body, build `identToName = {ident: name}` from `calls[]`.
2. Parse response body, for each `results[i]` look up `identToName[results[i].ident]` to get the call name.
3. Store `nameToResponse[name] = results[i].result.response` (last write wins if a call appears in multiple entries — typically not an issue).

Then read the data we need by call name:

- `heroGetAll` → `{heroId: {power, …}, …}` (own heroes)
- `titanGetAll` → `{titanId: {power, …}, …}` (own titans)
- `user_getClanInfo` → `.clanData.clan.members[uid].name`
- `clanWarGetWarlordInfo` → `.defence.teams[uid].clanDefence_heroes.units[id].power` and `.clanDefence_titans.units[id].power`

Names come from `hwa mapping.json`, inlined into the HTML as `const HERO_NAMES` / `const TITAN_NAMES`. Unknown unit ids render as `?<id>` (don't crash, don't drop).

**Capture caveat:** `clanWarGetWarlordInfo` is only sent when the user opens the clan war / defence screen. If the HAR was captured without visiting that screen, the defence section will be empty — show a status message explaining this.

## File layout

- `index.html` at repo root (single file, embedded `<style>` and `<script>`, mapping inlined).
- Optional: drop the existing `hwa_clan_defence.py` and sample files alongside; not used at runtime.

## Copy behaviour

- `navigator.clipboard.writeText(text)`; on success the button label flashes `Copied ✓` for ~1s, then reverts.

## Error handling

- HAR parse fails (file isn't valid JSON / not a HAR) → red banner.
- HAR loads but no `/api/rpc` calls found → red banner `Could not find HWA API calls in this .har`.
- `heroGetAll`/`titanGetAll` missing → hide the "Your /mystats" section, no banner.
- `clanWarGetWarlordInfo` missing → hide the defence section and add a hint to the status line: `No clan defence data — re-capture HAR with clan war screen open`.
- `user_getClanInfo` missing but defence teams present → fall back to `?uid=<n>` for the member name (and append a small hint).

## Open / deferred

- No tests planned for this page (it's a one-screen tool; manual verification with the sample HAR is enough).
- Future: if more tools get added here, revisit moving to Vite + TS.
- **Enemy clan defence (regular 1+1)** is now in scope (see section 6 above). Source: `clanWarGetWarlordInfo.warInfo.enemySlots` — confirmed against `HWA.json` (active war, mode `ghostBridge`, 40 enemy slots = 20 users × heroes/titans).
- **Championship enemy defence (3 hero teams + 1 titan team)** is still deferred. Mode is `ghostBridge` in available data; championship would be captured under a different mode and likely a different call (`clanWarChampInfo_*`). Revisit once a HAR is recorded during a championship war.
