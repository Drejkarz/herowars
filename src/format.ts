// Pure formatters: turn extracted Unit lists into the /mystats, /beathero, /beattitan strings.

import { HERO_NAMES, TITAN_NAMES, hasName, nameFor } from './mapping.js';
import type { MemberDefence, Unit } from './types.js';

// Drop units whose id has no name mapping — better to silently omit than emit `?<id>`.
function knownUnits(units: Unit[]): Unit[] {
  return units.filter(u => hasName(u.id));
}

function fmtUnits(units: Unit[]): string {
  return knownUnits(units).map(u => `${nameFor(u.id)} : ${u.power}`).join(' ');
}

function unitNames(units: Unit[]): string {
  return knownUnits(units).map(u => nameFor(u.id)).join(' ');
}

function sumPower(units: Unit[]): number {
  return units.reduce((s, u) => s + (u.power || 0), 0);
}

export function padToFull(
  units: Unit[],
  nameMap: Readonly<Record<string, string>>,
  fillPower = 10000,
): Unit[] {
  const have = new Set(units.map(u => u.id));
  const padded = [...units];
  for (const id of Object.keys(nameMap)) {
    if (!have.has(id)) padded.push({ id, power: fillPower });
  }
  return padded;
}

export function formatOwnMystats(
  heroes: Unit[],
  titans: Unit[],
  userName: string,
): string {
  return formatMemberDefence(userName, { heroes, titans }, { pad: true });
}

export function formatBeathero(heroSlots: Unit[][]): string {
  if (!heroSlots.length) return '';
  const parts = heroSlots.map((team, i) => {
    const n = i + 1;
    return `team${n}power: ${sumPower(team)} team${n}heroes: ${unitNames(team)}`;
  });
  return `/beathero ${parts.join(' ')}`;
}

export function formatBeattitan(titanSlots: Unit[][]): string {
  if (!titanSlots.length) return '';
  const team = titanSlots[0];
  if (!team) return '';
  return `/beattitan defense-team-power: ${sumPower(team)} defense-titans: ${unitNames(team)}`;
}

export interface FormatMemberOptions {
  pad: boolean;
}

export function formatMemberDefence(
  memberName: string,
  team: MemberDefence | undefined,
  opts: FormatMemberOptions,
): string {
  let heroes = team?.heroes ?? [];
  let titans = team?.titans ?? [];
  if (opts.pad) {
    heroes = padToFull(heroes, HERO_NAMES);
    titans = padToFull(titans, TITAN_NAMES);
  }
  const units = [...heroes, ...titans];
  const body = units.length ? `hero-or-titan-name-and-power: ${fmtUnits(units)} ` : 'hero-or-titan-name-and-power: ';
  return `/mystats update ${body}user : ${memberName}`;
}

// Re-export the iterator helper symbol name `iter` mentioned in the brief, by aliasing
// the parser-side iterator. Keeping it here lets format consumers import it without
// pulling parser in.
export { iterTeamUnits as iter } from './parser.js';
