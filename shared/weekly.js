// Weekly challenge rules, shared by the game (src/weekly.ts) and the server (api/_lib/online.js):
// the same song + modifiers for everyone, picked from the week number.

/** @typedef {{ style: string, rate: number, hidden?: boolean, mirror?: boolean, flashlight?: boolean, label: string }} WeeklyModsJs */

/** @type {WeeklyModsJs[]} */
export const WEEKLY_MODS = [
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
export function currentWeek(now = Date.now() / 1000) {
  const week = Math.floor((now - MONDAY_OFFSET) / WEEK);
  return { week, ends: (week + 1) * WEEK + MONDAY_OFFSET };
}

/**
 * This week's song (from the Hard / Expert soundtrack, by id order) and modifiers. A song with a
 * `weeklyFrom` week only joins the pool from that week on, so adding songs never changes a week in progress.
 * @template {{ id: string, difficulty: string, weeklyFrom?: number }} S
 * @param {number} week
 * @param {S[]} songs
 * @returns {{ song: S, mods: WeeklyModsJs } | null}
 */
export function pickWeekly(week, songs) {
  const pool = songs
    .filter(s => (s.difficulty === 'Hard' || s.difficulty === 'Expert') && (s.weeklyFrom ?? -Infinity) <= week)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!pool.length) return null;
  const mod = (n, m) => ((n % m) + m) % m;
  return { song: pool[mod(week * 7, pool.length)], mods: WEEKLY_MODS[mod(week, WEEKLY_MODS.length)] };
}
