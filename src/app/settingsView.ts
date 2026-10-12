// What the Settings and Customize panels show, as plain functions over the settings (no DOM), so
// the game, the panels and the tests all agree.
import { describeRule, type UnlockRule } from '../../shared/cosmetics.js';
import { DEFAULT_KEYS, DEFAULT_SETTINGS, T } from '../config.ts';
import type { Settings } from '../types.ts';

export type SettingsTab = 'controls' | 'audio' | 'visuals' | 'hud';
export const SETTINGS_TABS: { id: SettingsTab; label: string; color: string }[] = [
  { id: 'controls', label: 'CONTROLS', color: T.cyan },
  { id: 'audio', label: 'AUDIO', color: T.pink },
  { id: 'visuals', label: 'VISUALS', color: T.purple },
  { id: 'hud', label: 'HUD', color: T.gold },
];

/** the item `dir` steps away in a list, wrapping around (an unknown current counts as the first) */
export function cycle<V>(list: readonly V[], current: V, dir: number): V {
  const i = Math.max(0, list.indexOf(current));
  return list[(((i + dir) % list.length) + list.length) % list.length];
}

/** steps a 0..1 setting by tenths, kept in range */
export const stepTenth = (v: number, dir: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Math.round((v + dir * 0.1) * 10) / 10));

export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const dimText = (d: number) => (d <= 0 ? 'OFF' : percent(d));

/** RESET DEFAULTS: everything back to how it started, except the play style and modifiers (the Style panel's) */
export function resetSettings(s: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS, keys: [...DEFAULT_KEYS], laneColors: [...DEFAULT_SETTINGS.laneColors],
    style: s.style, rate: s.rate, hidden: s.hidden, sudden: s.sudden, flashlight: s.flashlight,
    mirror: s.mirror, random: s.random, wave: s.wave, mines: s.mines,
  };
}

/** how judgments show in a run (and in the HUD preview): the word, the "EARLY 12ms" line and their sizes */
export function hudLook(s: Pick<Settings, 'judgeStyle' | 'showTiming'>) {
  const minimal = s.judgeStyle === 'Minimal';
  return {
    judge: s.judgeStyle !== 'Off',
    timing: s.judgeStyle !== 'Off' && s.showTiming,
    /** judgment word in px: in the playfield (center combo on) / on the right */
    size: minimal ? { center: 20, side: 18 } : { center: 38, side: 30 },
    timingSize: minimal ? { center: 12, side: 11 } : { center: 14, side: 13 },
    /** how much the word pops when it appears */
    pop: minimal ? 1.1 : 1.3,
  };
}

/** the FPS counter's color: fine, getting low, too low */
export const fpsColor = (fps: number) => (fps >= 50 ? T.muted : fps >= 30 ? T.gold : T.red);

/** the line under an unlockable choice: what it is, or how to get it ("Sparks  ·  Reach level 10") */
export const choiceHint = (item: { label: string; desc: string; unlock: UnlockRule }, unlocked: boolean) =>
  unlocked ? item.desc : `${item.label}  ·  ${describeRule(item.unlock)}`;

/** the line style you leave Customize with: the skin on screen if it's unlocked, else the one you had */
export const keptSkin = <V>(shown: V, unlocked: boolean, had: V): V => (unlocked ? shown : had);

/** the line under Customize's line style: how many skins you have, or, on a locked one, which one you're using */
export const skinHint = (unlocked: boolean, inUse: string, count: number, total: number) =>
  unlocked ? `${count} of ${total} skins unlocked` : `Locked  ·  In use: ${inUse}`;

/** a small padlock for locked choices (fixed markup, safe for innerHTML) */
export const LOCK_ICON = '<svg class="lockicon" width="9" height="11" viewBox="0 0 9 11" aria-hidden="true">'
  + '<path d="M2 5V3.4a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  + '<rect x=".5" y="4.6" width="8" height="6" rx="1.4" fill="currentColor"/></svg>';
