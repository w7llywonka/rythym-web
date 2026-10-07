// Weekly challenge: same song + modifiers for everyone, picked from the week number.
import type { StyleName } from './types.ts';

export interface WeeklyMods { style: StyleName; rate: number; hidden?: boolean; mirror?: boolean; flashlight?: boolean; label: string }

export const WEEKLY_MODS: WeeklyMods[] = [
  { style: 'Hardcore', rate: 1, label: 'HARDCORE' },
  { style: 'Classic', rate: 1.25, label: '1.25x SPEED' },
  { style: 'Classic', rate: 1, hidden: true, label: 'HIDDEN' },
  { style: 'SuddenDeath', rate: 1, label: 'SUDDEN DEATH' },
  { style: 'Classic', rate: 1.25, mirror: true, label: '1.25x  ·  MIRROR' },
  { style: 'Classic', rate: 1, flashlight: true, label: 'FLASHLIGHT' },
  { style: 'Hardcore', rate: 1.25, label: 'HARDCORE  ·  1.25x' },
];

const WEEK = 604800;
const MONDAY_OFFSET = 345600; // unix time 0 was a Thursday; weeks start Monday 00:00 UTC

/** Week number and the unix time (seconds) it ends. */
export function currentWeek(now = Date.now() / 1000): { week: number; ends: number } {
  const week = Math.floor((now - MONDAY_OFFSET) / WEEK);
  return { week, ends: (week + 1) * WEEK + MONDAY_OFFSET };
}

export function pickWeekly<S extends { id: string; difficulty: string }>(week: number, songs: S[]): { song: S; mods: WeeklyMods } | null {
  const pool = songs.filter(s => s.difficulty === 'Hard' || s.difficulty === 'Expert').sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!pool.length) return null;
  return { song: pool[(((week * 7) % pool.length) + pool.length) % pool.length], mods: WEEKLY_MODS[((week % WEEKLY_MODS.length) + WEEKLY_MODS.length) % WEEKLY_MODS.length] };
}
