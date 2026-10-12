// Unlockable cosmetics, shared by the game (src/app/unlocks.ts, the Locker) and the server
// (api/_lib/online.js, which only accepts titles, tag ids and name color ids from these lists).
//
// Every unlock is a rule over the player's progress, worked out from the save each time (nothing to
// keep in sync): reach a level, keep a streak, win 1v1s, finish the tutorial, earn an achievement...
// Tags and name colors show online (leaderboards, live feed, 1v1); the rest only change your own game.

/**
 * @typedef {{ kind: 'always' } | { kind: 'tutorial' } | { kind: 'before', day: number, label: string }
 *   | { kind: 'achievement', id: string, name: string }
 *   | { kind: 'level' | 'plays' | 'streak' | 'fcs' | 'ss' | 'vsWins' | 'imports' | 'kings' | 'tops', n: number }} UnlockRule
 * @typedef {{ level: number, plays: number, streak: number, fcs: number, ss: number, vsWins: number, imports: number,
 *   kings: number, tops: number, tutorialDone: boolean, since: number, achievements: Record<string, true> }} UnlockStats
 * @typedef {{ id: string, label: string, color: string, desc: string, unlock: UnlockRule }} TagDef
 * @typedef {{ id: string, label: string, color: string, gradient?: string, unlock: UnlockRule }} NameColorDef
 * @typedef {{ id: string, label: string, desc: string, unlock: UnlockRule }} CosmeticDef
 * @typedef {{ id: string, label: string, colors: [string, string], unlock: UnlockRule }} ThemeDef
 */

/** the titles achievements give (src/config.ts ACHIEVEMENTS): the only titles shown online */
export const TITLES = [
  'Rookie', 'Combo Starter', 'Flawless', 'Hard Hitter', 'Expert', 'Extremist', 'Insane', 'Untouchable', 'Centurion',
  'Unbreakable', 'Nightcore', 'Collector', 'Iron Will', 'Ghost', 'Night Vision', 'Minesweeper', 'Sharpshooter',
  'Speed Demon', 'Endless', 'Challenger', 'Selector', 'Godlike',
];

const ALWAYS = /** @type {UnlockRule} */ ({ kind: 'always' });
const level = n => /** @type {UnlockRule} */ ({ kind: 'level', n });
const ach = (id, name) => /** @type {UnlockRule} */ ({ kind: 'achievement', id, name });

/** short badges next to your name: [VETERAN] */
/** @type {TagDef[]} */
export const TAGS = [
  { id: 'graduate', label: 'GRADUATE', color: '#2BD4FF', desc: 'Finished the tutorial', unlock: { kind: 'tutorial' } },
  { id: 'rookie', label: 'ROOKIE', color: '#4ADE80', desc: 'Cleared a first song', unlock: ach('first_clear', 'First Clear') },
  { id: 'og', label: 'OG', color: '#F5C451', desc: 'Played Line Rush in 2026', unlock: { kind: 'before', day: 20819, label: 'Play Line Rush in 2026' } },
  { id: 'regular', label: 'REGULAR', color: '#8A8A97', desc: '50 songs played', unlock: { kind: 'plays', n: 50 } },
  { id: 'grinder', label: 'GRINDER', color: '#FF8A3D', desc: '500 songs played', unlock: { kind: 'plays', n: 500 } },
  { id: 'veteran', label: 'VETERAN', color: '#A78BFA', desc: 'Reached level 10', unlock: level(10) },
  { id: 'elite', label: 'ELITE', color: '#FF5CA8', desc: 'Reached level 25', unlock: level(25) },
  { id: 'legend', label: 'LEGEND', color: '#F5C451', desc: 'Reached level 50', unlock: level(50) },
  { id: 'onfire', label: 'ON FIRE', color: '#FF8A3D', desc: 'A 7-day streak', unlock: { kind: 'streak', n: 7 } },
  { id: 'devoted', label: 'DEVOTED', color: '#FF6B7A', desc: 'A 30-day streak', unlock: { kind: 'streak', n: 30 } },
  { id: 'combo', label: 'COMBO', color: '#2BD4FF', desc: 'A 500 combo', unlock: ach('combo_500', 'Unbreakable') },
  { id: 'fcmachine', label: 'FC MACHINE', color: '#F5C451', desc: '25 full combos', unlock: { kind: 'fcs', n: 25 } },
  { id: 'flawless', label: 'FLAWLESS', color: '#F4F4F6', desc: '5 SS ranks', unlock: { kind: 'ss', n: 5 } },
  { id: 'insane', label: 'INSANE', color: '#FF2850', desc: 'Cleared an Insane chart', unlock: ach('clear_insane', 'Insane') },
  { id: 'nightcore', label: 'NIGHTCORE', color: '#A78BFA', desc: 'Cleared at 1.5x speed', unlock: ach('nightcore', 'Nightcore') },
  { id: 'duelist', label: 'DUELIST', color: '#FF5CA8', desc: 'Won a 1v1', unlock: { kind: 'vsWins', n: 1 } },
  { id: 'champion', label: 'CHAMPION', color: '#F5C451', desc: 'Won 10 1v1s', unlock: { kind: 'vsWins', n: 10 } },
  { id: 'dj', label: 'DJ', color: '#4ADE80', desc: 'Imported 3 songs', unlock: { kind: 'imports', n: 3 } },
  { id: 'top1', label: '#1', color: '#F5C451', desc: 'Took #1 on a leaderboard', unlock: { kind: 'tops', n: 1 } },
  { id: 'king', label: 'KING', color: '#F5C451', desc: 'Was King of the Hill', unlock: { kind: 'kings', n: 1 } },
];

/** the color your name shows in */
/** @type {NameColorDef[]} */
export const NAME_COLORS = [
  { id: 'default', label: 'White', color: '#F4F4F6', unlock: ALWAYS },
  { id: 'mint', label: 'Mint', color: '#4ADE80', unlock: level(3) },
  { id: 'sky', label: 'Sky', color: '#2BD4FF', unlock: level(5) },
  { id: 'rose', label: 'Rose', color: '#FF5CA8', unlock: level(8) },
  { id: 'ice', label: 'Ice', color: '#A5F3FC', unlock: { kind: 'streak', n: 7 } },
  { id: 'gold', label: 'Gold', color: '#F5C451', unlock: level(15) },
  { id: 'violet', label: 'Violet', color: '#A78BFA', unlock: level(20) },
  { id: 'crimson', label: 'Crimson', color: '#FF2850', unlock: ach('clear_insane', 'Insane') },
  { id: 'sunset', label: 'Sunset', color: '#FF8A3D', gradient: 'linear-gradient(90deg, #FF8A3D, #FF5CA8)', unlock: level(30) },
  { id: 'aurora', label: 'Aurora', color: '#2BD4FF', gradient: 'linear-gradient(90deg, #2BD4FF, #A78BFA, #FF5CA8)', unlock: level(40) },
  { id: 'royal', label: 'Royal', color: '#F5C451', gradient: 'linear-gradient(90deg, #F5C451, #A78BFA)', unlock: { kind: 'kings', n: 1 } },
];

/** line styles beyond the four free ones (Glow, Flat, Outline, Classic) */
/** @type {CosmeticDef[]} */
export const NOTE_SKINS = [
  { id: 'Glow', label: 'Glow', desc: 'Soft gradient with a glow', unlock: ALWAYS },
  { id: 'Flat', label: 'Flat', desc: 'Solid color, nothing else', unlock: ALWAYS },
  { id: 'Outline', label: 'Outline', desc: 'Bright edge', unlock: ALWAYS },
  { id: 'Classic', label: 'Classic', desc: 'The Roblox look', unlock: ALWAYS },
  { id: 'Neon', label: 'Neon', desc: 'A hot white core in a colored tube', unlock: level(5) },
  { id: 'Pixel', label: 'Pixel', desc: 'Chunky 8-bit blocks', unlock: level(8) },
  { id: 'Chrome', label: 'Chrome', desc: 'Polished metal with your color', unlock: level(12) },
  { id: 'Ghost', label: 'Ghost', desc: 'See-through, with a bright edge', unlock: ach('hidden_clear', 'Ghost') },
  { id: 'Ember', label: 'Ember', desc: 'Glowing hot from the inside', unlock: ach('sudden_clear', 'One Life') },
  { id: 'Prism', label: 'Prism', desc: 'Shifting rainbow', unlock: level(20) },
];

/** what a hit looks like on the button */
/** @type {CosmeticDef[]} */
export const HIT_EFFECTS = [
  { id: 'Ring', label: 'Ring', desc: 'A ring that grows and fades', unlock: ALWAYS },
  { id: 'None', label: 'None', desc: 'Nothing: just the lines', unlock: ALWAYS },
  { id: 'Burst', label: 'Burst', desc: 'A quick flash of light', unlock: level(4) },
  { id: 'Sparks', label: 'Sparks', desc: 'Sparks fly off the button', unlock: level(10) },
  { id: 'Stars', label: 'Stars', desc: 'Little stars on every Perfect', unlock: ach('ss_any', 'Flawless') },
  { id: 'Shockwave', label: 'Shockwave', desc: 'A wave across the whole lane', unlock: ach('combo_500', 'Unbreakable') },
];

/** the colors of the menus' background glow */
/** @type {ThemeDef[]} */
export const THEMES = [
  { id: 'default', label: 'Line Rush', colors: ['#2BD4FF', '#FF5CA8'], unlock: ALWAYS },
  { id: 'mono', label: 'Mono', colors: ['#F4F4F6', '#52525C'], unlock: ALWAYS },
  { id: 'forest', label: 'Forest', colors: ['#4ADE80', '#00BEAA'], unlock: { kind: 'streak', n: 3 } },
  { id: 'sunset', label: 'Sunset', colors: ['#FF8A3D', '#FF5CA8'], unlock: level(6) },
  { id: 'ocean', label: 'Ocean', colors: ['#2B6BFF', '#2BD4FF'], unlock: level(12) },
  { id: 'galaxy', label: 'Galaxy', colors: ['#A78BFA', '#2B6BFF'], unlock: level(18) },
  { id: 'royal', label: 'Royal', colors: ['#F5C451', '#A78BFA'], unlock: { kind: 'kings', n: 1 } },
];

/**
 * @param {UnlockRule} rule
 * @param {UnlockStats} s
 */
export function isUnlocked(rule, s) {
  switch (rule.kind) {
    case 'always': return true;
    case 'tutorial': return s.tutorialDone;
    case 'before': return s.since > 0 && s.since < rule.day;
    case 'achievement': return s.achievements[rule.id] === true;
    case 'level': return s.level >= rule.n;
    case 'plays': return s.plays >= rule.n;
    case 'streak': return s.streak >= rule.n;
    case 'fcs': return s.fcs >= rule.n;
    case 'ss': return s.ss >= rule.n;
    case 'vsWins': return s.vsWins >= rule.n;
    case 'imports': return s.imports >= rule.n;
    case 'kings': return s.kings >= rule.n;
    case 'tops': return s.tops >= rule.n;
    default: return false;
  }
}

/** "Reach level 10" */
/** @param {UnlockRule} rule */
export function describeRule(rule) {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  switch (rule.kind) {
    case 'always': return 'Free';
    case 'tutorial': return 'Finish the tutorial';
    case 'before': return rule.label;
    case 'achievement': return `Achievement: ${rule.name}`;
    case 'level': return `Reach level ${rule.n}`;
    case 'plays': return `Play ${plural(rule.n, 'song', 'songs')}`;
    case 'streak': return `Play ${rule.n} days in a row`;
    case 'fcs': return `Get ${plural(rule.n, 'full combo', 'full combos')}`;
    case 'ss': return `Get ${plural(rule.n, 'SS rank', 'SS ranks')}`;
    case 'vsWins': return `Win ${plural(rule.n, '1v1', '1v1s')}`;
    case 'imports': return `Import ${plural(rule.n, 'song', 'songs')}`;
    case 'kings': return 'Become King of the Hill';
    case 'tops': return 'Take #1 on any leaderboard';
    default: return '';
  }
}

/** a title the server accepts: exactly one from TITLES ('' = no title) */
export const cleanTitle = t => (typeof t === 'string' && TITLES.includes(t) ? t : '');
/** a tag id the server accepts ('' = no tag) */
export const cleanTag = id => (typeof id === 'string' && TAGS.some(t => t.id === id) ? id : '');
/** a name color id the server accepts ('' = default) */
export const cleanNameColor = id => (typeof id === 'string' && id !== 'default' && NAME_COLORS.some(c => c.id === id) ? id : '');
