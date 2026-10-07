import type { Diff, HitSound, ModKey, Settings, StyleName, Tier } from './types.ts';

// neutral near-black surfaces + hairlines; color is kept for meaning (lanes, tiers, grades)
export const T = {
  bg0: '#08080A', bg1: '#0E0E12', bg2: '#15151B', bg3: '#1D1D25',
  line: '#25252E', text: '#F4F4F6', muted: '#8A8A97', dim: '#52525C',
  cyan: '#2BD4FF', pink: '#FF5CA8', gold: '#F5C451', green: '#4ADE80',
  red: '#FF6B7A', purple: '#A78BFA',
};

export const K = {
  LEAD_IN: 3, // real seconds of countdown before the music starts
  PREVIEW_LENGTH: 30,
  MAX_TICKS: 24,
  MAX_RECENT: 10,
  MINE_WINDOW: 0.06,
  MINE_DAMAGE: 10,
  TAB_WIDTH: 110,
};

export interface Mode {
  label: string; color: string; color2: string; fall: number; tailTol: number;
  windows: [number, number, number]; missDamage: number; heal: [number, number, number]; ghostPenalty: number;
}

// per chart difficulty: fall time (real seconds, before scroll speed), timing windows, health rules
export const MODES: Record<Diff, Mode> = {
  Easy: { label: 'EASY', color: T.green, color2: '#00BEAA', fall: 1.7, tailTol: 0.16, windows: [0.055, 0.1, 0.15], missDamage: 5, heal: [3, 2, 1], ghostPenalty: 0 },
  Hard: { label: 'HARD', color: T.red, color2: T.pink, fall: 0.9, tailTol: 0.12, windows: [0.038, 0.07, 0.1], missDamage: 9, heal: [1.5, 1, 0.3], ghostPenalty: 3 },
  Expert: { label: 'EXPERT', color: '#FF8C00', color2: T.red, fall: 0.75, tailTol: 0.1, windows: [0.034, 0.062, 0.09], missDamage: 10, heal: [1.2, 0.6, 0.1], ghostPenalty: 4 },
  Extreme: { label: 'EXTREME', color: T.purple, color2: T.pink, fall: 0.62, tailTol: 0.09, windows: [0.03, 0.055, 0.08], missDamage: 12, heal: [1, 0.4, 0], ghostPenalty: 5 },
  Insane: { label: 'INSANE', color: '#FF2850', color2: T.purple, fall: 0.5, tailTol: 0.08, windows: [0.026, 0.048, 0.07], missDamage: 14, heal: [0.8, 0.2, 0], ghostPenalty: 6 },
};

export type Tab = Tier | 'Recent';
export const TAB_ORDER: Tab[] = ['Easy', 'Hard', 'Expert', 'Extreme', 'Recent'];
export const TAB_INFO: Record<Tab, { color: string; color2: string; hint: string }> = {
  Easy: { color: MODES.Easy.color, color2: MODES.Easy.color2, hint: 'Chill tempo  ·  forgiving timing' },
  Hard: { color: MODES.Hard.color, color2: MODES.Hard.color2, hint: 'Fast songs  ·  tight timing  ·  chords' },
  Expert: { color: MODES.Expert.color, color2: MODES.Expert.color2, hint: 'Dense streams  ·  the step before Extreme' },
  Extreme: { color: MODES.Extreme.color, color2: MODES.Extreme.color2, hint: 'Under a minute  ·  max speed  ·  no mercy' },
  Recent: { color: T.cyan, color2: T.purple, hint: 'The songs you played last' },
};
export const LEVEL_BONUS: Record<Diff, number> = { Easy: 0, Hard: 2, Expert: 3, Extreme: 5, Insane: 7 };
export const RANK: Record<Diff, number> = { Easy: 1, Hard: 2, Expert: 3, Extreme: 4, Insane: 5 };
export const DIFF_XP: Record<Diff, number> = { Easy: 1, Hard: 1.5, Expert: 2, Extreme: 2.5, Insane: 3 };

export interface Style {
  label: string; mult: number; windowScale?: number; noHeal?: boolean; damageScale?: number; ghostMin?: number;
  suddenDeath?: boolean; noFail?: boolean; noGhost?: boolean; unranked?: boolean; practice?: boolean;
}
// play styles (rule presets)
export const STYLES: Record<StyleName, Style> = {
  Classic: { label: 'CLASSIC', mult: 1 },
  Hardcore: { label: 'HARDCORE', mult: 1.2, windowScale: 0.8, noHeal: true, damageScale: 1.6, ghostMin: 3 },
  SuddenDeath: { label: 'SUDDEN DEATH', mult: 1.3, suddenDeath: true },
  Playground: { label: 'PLAYGROUND', mult: 1, noFail: true, noGhost: true, unranked: true },
  Practice: { label: 'PRACTICE', mult: 1, noFail: true, noGhost: true, unranked: true, practice: true },
};
export const STYLE_ORDER: StyleName[] = ['Classic', 'Hardcore', 'SuddenDeath', 'Playground', 'Practice'];
export const STYLE_CARDS: Record<StyleName, [string, string]> = {
  Classic: ['CLASSIC', 'Normal rules. Misses drain health, hits heal.'],
  Hardcore: ['HARDCORE', 'Tighter timing, no healing, misses hurt more.'],
  SuddenDeath: ['SUDDEN DEATH', 'Miss one line and the run is over.'],
  Playground: ['PLAYGROUND', "Can't fail. Practice anything. Not saved."],
  Practice: ['PRACTICE', 'Loop a section you choose. Not saved.'],
};
export const RATES = [0.5, 0.75, 1, 1.25, 1.5];
export const RATE_MULT: Record<number, number> = { 0.5: 0.3, 0.75: 0.5, 1: 1, 1.25: 1.15, 1.5: 1.3 };

// modifiers (toggles in the style panel)
export type ModName = 'Hidden' | 'Sudden' | 'Flashlight' | 'Mirror' | 'Random' | 'Wave' | 'Mines' | 'Autoplay';
export const MOD_ORDER: ModName[] = ['Hidden', 'Sudden', 'Flashlight', 'Mirror', 'Random', 'Wave', 'Mines', 'Autoplay'];
export const MOD_INFO: Record<ModName, { key: ModKey; mult: number; label: string; hint: string }> = {
  Hidden: { key: 'hidden', mult: 1.06, label: 'HIDDEN', hint: 'Lines vanish early' },
  Sudden: { key: 'sudden', mult: 1.06, label: 'SUDDEN', hint: 'Lines appear late' },
  Flashlight: { key: 'flashlight', mult: 1.12, label: 'FLASHLIGHT', hint: 'Only see near buttons' },
  Mirror: { key: 'mirror', mult: 1, label: 'MIRROR', hint: 'Swap the lanes' },
  Random: { key: 'random', mult: 1, label: 'RANDOM', hint: 'Shuffle the lanes' },
  Wave: { key: 'wave', mult: 1.04, label: 'WAVE', hint: 'Lines wobble' },
  Mines: { key: 'mines', mult: 1.06, label: 'MINES', hint: "Don't hit the red ones" },
  Autoplay: { key: 'auto', mult: 1, label: 'AUTO', hint: 'Watch a perfect run' },
};

export interface Judgment { name: string; key: string; color: string; score: number; acc: number }
export const JUDGMENTS: Judgment[] = [
  { name: 'PERFECT', key: 'Perfect', color: T.gold, score: 300, acc: 100 },
  { name: 'GREAT', key: 'Great', color: T.cyan, score: 200, acc: 70 },
  { name: 'GOOD', key: 'Good', color: T.green, score: 100, acc: 40 },
];
export const MISS = { name: 'MISS', color: T.red };
export const MINE_HIT = { name: 'MINE!', color: T.red };

export const HIT_SOUNDS: HitSound[] = ['OFF', 'TICK', 'MANIA', 'KICK', 'CLAP'];

export interface Pack { id: string; name: string; songs: string[] }
export const PACKS: Pack[] = [
  { id: 'sunset', name: 'SUNSET PACK', songs: ['afterglow', 'glasshouse', 'orbit'] },
  { id: 'arcade', name: 'ARCADE PACK', songs: ['prism', 'daybreak', 'current'] },
  { id: 'overdrive', name: 'OVERDRIVE PACK', songs: ['undertow', 'hyperlane', 'redline', 'zenith'] },
];

export interface AchievementContext {
  cleared: boolean; grade: string; fc: boolean; rank: number; style: StyleName; rate: number; maxCombo: number; packComplete: boolean;
}
export interface Achievement { id: string; name: string; desc: string; title: string; check: (c: AchievementContext) => boolean }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_clear', name: 'First Clear', desc: 'Clear any song', title: 'Rookie', check: c => c.cleared },
  { id: 'fc_any', name: 'Full Combo', desc: 'Full combo any song', title: 'Combo Starter', check: c => c.fc },
  { id: 'ss_any', name: 'Flawless', desc: 'Get an SS rank', title: 'Flawless', check: c => c.grade === 'SS' },
  { id: 'clear_hard', name: 'Hard Hitter', desc: 'Clear a Hard chart', title: 'Hard Hitter', check: c => c.cleared && c.rank >= 2 },
  { id: 'clear_expert', name: 'Expert', desc: 'Clear an Expert chart', title: 'Expert', check: c => c.cleared && c.rank >= 3 },
  { id: 'clear_extreme', name: 'Extremist', desc: 'Clear an Extreme chart', title: 'Extremist', check: c => c.cleared && c.rank >= 4 },
  { id: 'clear_insane', name: 'Insane', desc: 'Clear an Insane chart', title: 'Insane', check: c => c.cleared && c.rank >= 5 },
  { id: 'sudden_clear', name: 'One Life', desc: 'Clear on Sudden Death', title: 'Untouchable', check: c => c.cleared && c.style === 'SuddenDeath' },
  { id: 'combo_100', name: 'Centurion', desc: 'Reach a 100 combo', title: 'Centurion', check: c => c.maxCombo >= 100 },
  { id: 'combo_500', name: 'Unbreakable', desc: 'Reach a 500 combo', title: 'Unbreakable', check: c => c.maxCombo >= 500 },
  { id: 'nightcore', name: 'Nightcore', desc: 'Clear at 1.5x speed', title: 'Nightcore', check: c => c.cleared && c.rate >= 1.5 },
  { id: 'collector', name: 'Collector', desc: 'Complete a song pack', title: 'Collector', check: c => c.packComplete },
];

export const DEFAULT_KEYS: [string, string, string] = ['KeyF', 'KeyJ', 'KeyR'];
export const DEFAULT_SETTINGS: Settings = {
  keys: [...DEFAULT_KEYS],
  scrollSpeed: 1, offset: 0, musicVolume: 0.8, effects: true, centerHud: false, hitZone: true, hitSound: 'TICK',
  laneColors: [T.cyan, T.pink], chordColor: T.gold, noteStyle: 'Glow', noteSize: 22,
  style: 'Classic', rate: 1,
  hidden: false, sudden: false, flashlight: false, mirror: false, random: false, wave: false, mines: false,
};
// keys that can't be bound (browser/menu keys)
export const BLOCKED_KEYS = new Set(['Escape', 'Slash', 'Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);
export const STAR_COLORS = ['#CD7F32', '#CDD2DC', T.gold, T.cyan];
export const SWATCHES = ['#2BD4FF', '#FF5CA8', '#F5C451', '#4ADE80', '#A78BFA', '#FF8A3D', '#FF6B7A', '#F4F4F6'];
export const KEY_LABELS = ['Button 1', 'Button 2', 'Restart'];
