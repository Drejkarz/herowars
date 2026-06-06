// Parser: walks HAR entries, indexes /api/rpc responses by their call name (not ident),
// and extracts strongly-shaped roster / clan / war / champ data.

import {
  type CallMap,
  type ChampInfoResponse,
  type ClanInfoResponse,
  type EnemyDefence,
  type EnemyMeta,
  type GcSlot,
  type MemberDefence,
  type OwnChampDefence,
  type RosterResponse,
  type RpcCall,
  type RpcEntry,
  type SlotUser,
  type TeamGetAllResponse,
  type Unit,
  type WarlordResponse,
  isObject,
} from './types.js';

export const CALL_HEROES = 'heroGetAll';
export const CALL_TITANS = 'titanGetAll';
export const CALL_CLAN = 'user_getClanInfo';
export const CALL_WARLORD = 'clanWarGetWarlordInfo';
export const CALL_TEAMS = 'teamGetAll';
export const CALL_CHAMP_INFO = 'clanWarChampInfo_getInfo';
export const CALL_USER_INFO = 'userGetInfo';

// Returns the logged-in user's display name from userGetInfo, or null if absent.
export function extractOwnName(callMap: CallMap): string | null {
  const resp = callMap.get(CALL_USER_INFO);
  if (!isObject(resp)) return null;
  return typeof resp.name === 'string' ? resp.name : null;
}

export interface BuildCallMapResult {
  map: CallMap;
  rpcEntries: number;
}

// Walks all /api/rpc entries in a HAR and returns Map<callName, responseBody>.
// Cross-references each response item against the request's ident->name map (idents
// are per-request nonces and not stable identifiers).
export function buildCallMap(harText: string): BuildCallMapResult {
  const har: unknown = JSON.parse(harText);
  const entries: unknown[] = isObject(har) && isObject(har.log) && Array.isArray(har.log.entries)
    ? (har.log.entries as unknown[])
    : [];
  const map: CallMap = new Map();
  let rpcEntries = 0;

  for (const e of entries) {
    if (!isObject(e)) continue;
    const request = isObject(e.request) ? e.request : null;
    const response = isObject(e.response) ? e.response : null;
    const url = typeof request?.url === 'string' ? request.url : '';
    if (!url.includes('/api/rpc')) continue;

    const postData = isObject(request?.postData) ? request.postData : null;
    const content = isObject(response?.content) ? response.content : null;
    const reqText = typeof postData?.text === 'string' ? postData.text : null;
    const resText = typeof content?.text === 'string' ? content.text : null;
    if (!reqText || !resText) continue;

    let req: unknown;
    let res: unknown;
    try {
      req = JSON.parse(reqText);
      res = JSON.parse(resText);
    } catch {
      continue;
    }

    const calls: RpcCall[] | null =
      isObject(req) && Array.isArray(req.calls) ? (req.calls as RpcCall[]) : null;
    const results: RpcEntry[] | null =
      isObject(res) && Array.isArray(res.results) ? (res.results as RpcEntry[]) : null;
    if (!calls || !results) continue;
    rpcEntries++;

    const identToName: Record<string, string> = {};
    for (const c of calls) {
      if (c?.ident && c?.name) identToName[c.ident] = c.name;
    }
    for (const r of results) {
      const name = r?.ident ? identToName[r.ident] : undefined;
      if (name) {
        map.set(name, r?.result?.response ?? null);
      }
    }
  }

  return { map, rpcEntries };
}

// Returns [{id, power}, ...] for heroGetAll / titanGetAll. Empty if absent or malformed.
export function extractRoster(callMap: CallMap, callName: string): Unit[] {
  const resp = callMap.get(callName);
  if (!isObject(resp)) return [];
  const out: Unit[] = [];
  for (const [id, v] of Object.entries(resp as RosterResponse)) {
    if (v && typeof v.power === 'number') out.push({ id, power: v.power });
  }
  return out;
}

export function extractClanMembers(callMap: CallMap): Record<string, string> {
  const resp = callMap.get(CALL_CLAN) as ClanInfoResponse | undefined;
  const members = resp?.clanData?.clan?.members ?? {};
  const out: Record<string, string> = {};
  for (const [uid, m] of Object.entries(members)) {
    out[uid] = m?.name ?? `?uid=${uid}`;
  }
  return out;
}

// Walks any of the shapes a defence-team payload might take and yields {id, power} per unit.
// Handles {units: {<id>: {power}}}, [{units: {...}}, ...] (champ: array of teams), and a bare
// {<id>: {power}} map.
export function* iterTeamUnits(node: unknown): Generator<Unit> {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const sub of node) yield* iterTeamUnits(sub);
    return;
  }
  if (!isObject(node)) return;
  const units = (node as Record<string, unknown>).units;
  if (units && typeof units === 'object') {
    yield* iterTeamUnits(units);
    return;
  }
  for (const [id, u] of Object.entries(node)) {
    if (
      isObject(u) &&
      typeof u.power === 'number' &&
      /^\d+$/.test(id)
    ) {
      yield { id, power: u.power };
    }
  }
}

// Reads both regular (clanDefence_*) and championship (champClanDefence_*) keys per uid.
// Champ heroes is an array of 3 teams; all are flattened into a single hero list per
// member to match the /mystats format.
export function extractDefenceTeams(callMap: CallMap): Record<string, MemberDefence> {
  const resp = callMap.get(CALL_WARLORD) as WarlordResponse | undefined;
  const teams = resp?.defence?.teams ?? {};
  const out: Record<string, MemberDefence> = {};
  for (const [uid, t] of Object.entries(teams)) {
    if (!t) continue;
    const heroes: Unit[] = [
      ...iterTeamUnits(t.clanDefence_heroes),
      ...iterTeamUnits(t.champClanDefence_heroes),
    ];
    const titans: Unit[] = [
      ...iterTeamUnits(t.clanDefence_titans),
      ...iterTeamUnits(t.champClanDefence_titans),
    ];
    out[uid] = { heroes, titans };
  }
  return out;
}

// Normalizes the per-slot `user` field. GW provides an inline {id, name} object; GC
// provides a bare uid string. Returns the uid (always) and an inline name when present.
export function normalizeSlotUser(user: SlotUser): { uid: string; inlineName?: string } {
  if (typeof user === 'string') return { uid: user };
  if (user && typeof user === 'object') {
    const uid = String(user.id ?? '');
    const inlineName = typeof user.name === 'string' ? user.name : undefined;
    return { uid, inlineName };
  }
  return { uid: '' };
}

// Reads `{unitId: {power}}` into Unit[]. Skips entries without a numeric power.
function readUnits(teamObj: Record<string, { power?: number } | undefined>): Unit[] {
  const units: Unit[] = [];
  for (const [id, u] of Object.entries(teamObj)) {
    if (u && typeof u.power === 'number') units.push({ id, power: u.power });
  }
  return units;
}

// Iterates `slot.team` and pushes each non-empty team into the correct bucket. Hero
// teams typically have IDs < 4000; titan teams have IDs >= 4000. GW slots have
// team.length === 1; GC heroes slots have team.length === 3; GC titans slots have
// team.length === 1.
function pushSlotTeams(
  slot: { team?: Array<Record<string, { power?: number } | undefined>> },
  bucket: { heroSlots: Unit[][]; titanSlots: Unit[][] },
): void {
  const teams = Array.isArray(slot.team) ? slot.team : [];
  for (const teamObj of teams) {
    if (!teamObj || typeof teamObj !== 'object') continue;
    const units = readUnits(teamObj);
    if (!units.length) continue;
    const isTitanTeam = units.every(u => Number(u.id) >= 4000);
    (isTitanTeam ? bucket.titanSlots : bucket.heroSlots).push(units);
  }
}

// Returns {enemyUid: {name, heroSlots, titanSlots}} for the GW (clanWarGetWarlordInfo)
// enemySlots map. Walks every team entry, so this is correct whether a slot has 1 team
// (the GW case) or 3 (the GC case — though GC enemies live elsewhere, see
// extractGcEnemyDefence).
export function extractEnemyDefence(callMap: CallMap): Record<string, EnemyDefence> {
  const resp = callMap.get(CALL_WARLORD) as WarlordResponse | undefined;
  const slots = resp?.warInfo?.enemySlots ?? {};
  const out: Record<string, EnemyDefence> = {};
  const entries = Object.entries(slots)
    .map(([sid, s]) => ({ sid: Number(sid), s }))
    .sort((a, b) => a.sid - b.sid);

  for (const { s } of entries) {
    if (!s) continue;
    const { uid, inlineName } = normalizeSlotUser(s.user);
    if (!uid) continue;
    const name = inlineName ?? `?uid=${uid}`;
    if (!out[uid]) out[uid] = { name, heroSlots: [], titanSlots: [] };
    pushSlotTeams(s, out[uid]);
  }
  return out;
}

// Iterates GC slots (clanWarChampInfo_getInfo.warInfo.[ourSlots|enemySlots]) and groups
// teams per user. nameLookup resolves the bare uid string to a clan-member name.
function extractGcSlots(
  slots: Record<string, GcSlot | undefined>,
  nameLookup: (uid: string) => string,
): Record<string, EnemyDefence> {
  const out: Record<string, EnemyDefence> = {};
  const entries = Object.entries(slots)
    .map(([sid, s]) => ({ sid: Number(sid), s }))
    .sort((a, b) => a.sid - b.sid);

  for (const { s } of entries) {
    if (!s) continue;
    const { uid } = normalizeSlotUser(s.user);
    if (!uid) continue;
    if (!out[uid]) out[uid] = { name: nameLookup(uid), heroSlots: [], titanSlots: [] };
    pushSlotTeams(s, out[uid]);
  }
  return out;
}

// Returns {uid: {name, heroSlots(len 3), titanSlots(len 1)}} for the active GC war's
// enemy side. Uses enemyClanMembers from the same response for name lookups.
export function extractGcEnemyDefence(callMap: CallMap): Record<string, EnemyDefence> {
  const resp = callMap.get(CALL_CHAMP_INFO) as ChampInfoResponse | undefined;
  const slots = resp?.warInfo?.enemySlots;
  if (!slots) return {};
  const members = resp?.warInfo?.enemyClanMembers ?? {};
  const nameLookup = (uid: string): string => members[uid]?.name ?? `?uid=${uid}`;
  return extractGcSlots(slots, nameLookup);
}

// Returns {uid: {name, heroSlots(len 3), titanSlots(len 1)}} for the active GC war's
// ally side. Uses user_getClanInfo for name lookups via extractClanMembers.
export function extractGcAllyDefence(callMap: CallMap): Record<string, EnemyDefence> {
  const resp = callMap.get(CALL_CHAMP_INFO) as ChampInfoResponse | undefined;
  const slots = resp?.warInfo?.ourSlots;
  if (!slots) return {};
  const members = extractClanMembers(callMap);
  const nameLookup = (uid: string): string => members[uid] ?? `?uid=${uid}`;
  return extractGcSlots(slots, nameLookup);
}

// Pulls enemy clan name + war/season timing out of the GW (clanWarGetWarlordInfo) response.
// Returns null when no GW data is present.
export function extractGwEnemyMeta(callMap: CallMap): EnemyMeta | null {
  const resp = callMap.get(CALL_WARLORD) as WarlordResponse | undefined;
  const wi = resp?.warInfo;
  if (!wi || !wi.enemyClan) return null;
  const labelParts: string[] = [];
  if (typeof wi.season === 'number') labelParts.push(`season ${wi.season}`);
  if (typeof wi.day === 'number') labelParts.push(`day ${wi.day}`);
  return {
    clanName: wi.enemyClan.title ?? null,
    clanId: wi.enemyClan.id ?? null,
    serverId: wi.enemyClan.serverId ?? null,
    membersCount: wi.enemyClan.membersCount ?? null,
    dateTs: typeof wi.endTime === 'number' ? wi.endTime : null,
    dateLabel: labelParts.length ? `GW ${labelParts.join(' · ')}` : 'GW',
  };
}

// Pulls enemy clan name + GC day timestamp from clanWarChampInfo_getInfo.
// Returns null when no GC war data is present.
export function extractGcEnemyMeta(callMap: CallMap): EnemyMeta | null {
  const resp = callMap.get(CALL_CHAMP_INFO) as ChampInfoResponse | undefined;
  const wi = resp?.warInfo;
  if (!wi || !wi.enemyClan) return null;
  const dayTs = resp?.seasonStatus?.current?.dayTs;
  return {
    clanName: wi.enemyClan.title ?? null,
    clanId: wi.enemyClan.id ?? null,
    serverId: wi.enemyClan.serverId ?? null,
    membersCount: wi.enemyClan.membersCount ?? null,
    dateTs: typeof dayTs === 'number' ? dayTs : null,
    dateLabel: 'GC day',
  };
}

// Set<uid> of clan members participating in the current war.
export function extractWarriors(callMap: CallMap): Set<string> {
  const resp = callMap.get(CALL_WARLORD) as WarlordResponse | undefined;
  const w = resp?.defence?.warriors ?? {};
  return new Set(Object.keys(w));
}

// The user's own champ defence templates from teamGetAll, with powers cross-referenced
// from heroGetAll / titanGetAll. Returns null when teamGetAll is absent or contains no
// champ templates.
export function extractOwnChampDefence(callMap: CallMap): OwnChampDefence | null {
  const tg = callMap.get(CALL_TEAMS) as TeamGetAllResponse | undefined;
  if (!tg) return null;
  const heroIdTeams = Array.isArray(tg.champClanDefence_heroes) ? tg.champClanDefence_heroes : [];
  const titanIds = Array.isArray(tg.champClanDefence_titans) ? tg.champClanDefence_titans : [];
  const heroes = (callMap.get(CALL_HEROES) as RosterResponse | undefined) ?? {};
  const titans = (callMap.get(CALL_TITANS) as RosterResponse | undefined) ?? {};

  const heroSlots: Unit[][] = heroIdTeams
    .map(team =>
      (Array.isArray(team) ? team : []).map(id => ({
        id: String(id),
        power: heroes[String(id)]?.power ?? 0,
      })),
    )
    .filter(team => team.length > 0);

  const titanSlots: Unit[][] = titanIds.length
    ? [titanIds.map(id => ({ id: String(id), power: titans[String(id)]?.power ?? 0 }))]
    : [];

  if (!heroSlots.length && !titanSlots.length) return null;
  return { heroSlots, titanSlots };
}
