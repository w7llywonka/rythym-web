// Weekly challenge: the rules live in shared/weekly.js so the server checks the exact same thing.
import { WEEKLY_MODS as MODS, currentWeek, pickWeekly as pick } from '../shared/weekly.js';
import type { StyleName } from './types.ts';

export interface WeeklyMods { style: StyleName; rate: number; hidden?: boolean; mirror?: boolean; flashlight?: boolean; label: string }

export const WEEKLY_MODS = MODS as WeeklyMods[];
export { currentWeek };

export function pickWeekly<S extends { id: string; difficulty: string }>(week: number, songs: S[]): { song: S; mods: WeeklyMods } | null {
  return pick(week, songs) as { song: S; mods: WeeklyMods } | null;
}
