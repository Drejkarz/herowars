// Types for HWA API shapes and internal models.

// HAR-level RPC structures.
export interface RpcCall {
  ident?: string;
  name?: string;
}

export interface RpcEntry {
  ident?: string;
  result?: { response?: unknown };
}

// Map of call name -> response body (the response shape varies per call).
export type CallMap = Map<string, unknown>;

// heroGetAll / titanGetAll: { [unitId: string]: { power: number, ... } }
export type RosterResponse = Record<string, { power?: number } | undefined>;

// user_getClanInfo
export interface ClanInfoResponse {
  clanData?: {
    clan?: {
      members?: Record<string, { name?: string } | undefined>;
    };
  };
}

// Inside a defence team in clanWarGetWarlordInfo.defence.teams[uid]
export interface DefenceTeamData {
  clanDefence_heroes?: unknown;
  clanDefence_titans?: unknown;
  champClanDefence_heroes?: unknown;
  champClanDefence_titans?: unknown;
}

export interface EnemySlotUnit {
  power?: number;
}

// GW uses an inline user object; GC uses a bare uid string.
export type SlotUser = string | { id?: number | string; name?: string } | undefined;

export interface EnemySlot {
  team?: Array<Record<string, EnemySlotUnit | undefined>>;
  user?: SlotUser;
  status?: string;
  slotId?: number;
}

export interface WarInfo {
  enemySlots?: Record<string, EnemySlot | undefined>;
  mode?: string;
  day?: number;
}

export interface WarlordResponse {
  warInfo?: WarInfo;
  defence?: {
    teams?: Record<string, DefenceTeamData | undefined>;
    warriors?: Record<string, unknown>;
    slots?: unknown;
  };
}

// clanWarChampInfo_getInfo (active GC war): 40 slots per side =
// 20 users × (1 heroes slot with team.length === 3 + 1 titans slot with team.length === 1).
export interface GcSlot {
  team?: Array<Record<string, EnemySlotUnit | undefined>>;
  user?: SlotUser;
  status?: string;
  slotId?: number;
}

export interface ChampInfoResponse {
  warInfo?: {
    ourSlots?: Record<string, GcSlot | undefined>;
    enemySlots?: Record<string, GcSlot | undefined>;
    enemyClanMembers?: Record<string, { id?: string | number; name?: string } | undefined>;
    mode?: string;
  };
}

// teamGetAll
export interface TeamGetAllResponse {
  clanDefence_heroes?: unknown;
  clanDefence_titans?: unknown;
  champClanDefence_heroes?: number[][];
  champClanDefence_titans?: number[];
}

// Internal models.
export interface Unit {
  id: string;
  power: number;
}

export interface MemberDefence {
  heroes: Unit[];
  titans: Unit[];
}

export interface EnemyDefence {
  name: string;
  heroSlots: Unit[][];
  titanSlots: Unit[][];
}

export interface OwnChampDefence {
  heroSlots: Unit[][];
  titanSlots: Unit[][];
}

// Type guards.
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
