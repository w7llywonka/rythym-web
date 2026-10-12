// What the player has unlocked. It's worked out from their progress every time (the rules are in
// shared/cosmetics.js), so it can never get out of step with the save. The Locker, the results screen,
// the tutorial and the settings all ask here; tags and name colors are also what the server shows.
import {
  HIT_EFFECTS, NAME_COLORS, NOTE_SKINS, TAGS, THEMES, isUnlocked,
  type NameColorDef, type TagDef, type ThemeDef, type UnlockRule, type UnlockStats,
} from '../../shared/cosmetics.js';
import type { Look } from '../api.ts';
import { ACHIEVEMENTS } from '../config.ts';
import { levelFromXp } from '../scoring.ts';
import type { HitEffect, NoteStyle, Profile, Settings } from '../types.ts';
import { queueToast } from './shell.ts';
import { S } from './state.ts';

export type UnlockCategory = 'title' | 'tag' | 'color' | 'skin' | 'effect' | 'theme';

export interface Unlockable {
  /** "tag:veteran": what the save's `seen` list and the toasts use */
  key: string; category: UnlockCategory; id: string; label: string; desc: string; unlock: UnlockRule;
  /** tags and name colors: how they're drawn */
  color?: string; gradient?: string;
  /** themes: the two glow colors */
  colors?: [string, string];
}

export const CATEGORY_LABEL: Record<UnlockCategory, string> = {
  title: 'TITLE', tag: 'TAG', color: 'NAME COLOR', skin: 'LINE SKIN', effect: 'HIT EFFECT', theme: 'THEME',
};

export const today = () => Math.floor(Date.now() / 86400000);

export function unlockStats(p: Profile = S.data.profile): UnlockStats {
  return {
    level: levelFromXp(p.xp).level, plays: p.plays, streak: p.bestStreak, fcs: p.fcs, ss: p.ss,
    vsWins: p.vsWins, imports: p.imports, kings: p.kings, tops: p.tops, tutorialDone: p.tutorialDone,
    since: p.since, achievements: p.achievements,
  };
}

let catalog: Unlockable[] | null = null;
/** everything that can be unlocked, in Locker order */
export function allUnlockables(): Unlockable[] {
  catalog ??= [
    ...ACHIEVEMENTS.map(a => ({
      key: `title:${a.id}`, category: 'title' as const, id: a.title, label: a.title, desc: a.desc,
      unlock: { kind: 'achievement', id: a.id, name: a.name } as UnlockRule,
    })),
    ...TAGS.map(t => ({ key: `tag:${t.id}`, category: 'tag' as const, id: t.id, label: t.label, desc: t.desc, unlock: t.unlock, color: t.color })),
    ...NAME_COLORS.map(c => ({ key: `color:${c.id}`, category: 'color' as const, id: c.id, label: c.label, desc: 'Your name online and in the menus', unlock: c.unlock, color: c.color, gradient: c.gradient })),
    ...NOTE_SKINS.map(s => ({ key: `skin:${s.id}`, category: 'skin' as const, id: s.id, label: s.label, desc: s.desc, unlock: s.unlock })),
    ...HIT_EFFECTS.map(e => ({ key: `effect:${e.id}`, category: 'effect' as const, id: e.id, label: e.label, desc: e.desc, unlock: e.unlock })),
    ...THEMES.map(t => ({ key: `theme:${t.id}`, category: 'theme' as const, id: t.id, label: t.label, desc: 'The glow behind the menus', unlock: t.unlock, colors: t.colors })),
  ];
  return catalog;
}

export function isUnlockedKey(key: string, stats: UnlockStats = unlockStats()): boolean {
  const item = allUnlockables().find(u => u.key === key);
  return !!item && isUnlocked(item.unlock, stats);
}

export function unlockedKeys(stats: UnlockStats = unlockStats()): Set<string> {
  return new Set(allUnlockables().filter(u => isUnlocked(u.unlock, stats)).map(u => u.key));
}

/**
 * Toasts what's new since `before` (take unlockedKeys() before adding progress, call this after).
 * Titles are left out: the achievement toast already names them.
 */
export function announceNewUnlocks(before: Set<string>): Unlockable[] {
  const fresh = allUnlockables().filter(u => u.category !== 'title' && !before.has(u.key) && isUnlockedKey(u.key));
  if (fresh.length > 3) queueToast(`${fresh.length} NEW UNLOCKS! See the Locker in your profile.`);
  else for (const u of fresh) queueToast(`UNLOCKED ${CATEGORY_LABEL[u.category]}: ${u.category === 'tag' ? `[${u.label}]` : u.label}`);
  return fresh;
}

// ---- what's actually worn / used: the chosen one if it's unlocked, otherwise the default ----------
export function wornTag(p: Profile = S.data.profile): TagDef | null {
  const t = TAGS.find(x => x.id === p.tag);
  return t && isUnlocked(t.unlock, unlockStats(p)) ? t : null;
}

export function wornNameColor(p: Profile = S.data.profile): NameColorDef {
  const c = NAME_COLORS.find(x => x.id === p.nameColor);
  return c && isUnlocked(c.unlock, unlockStats(p)) ? c : NAME_COLORS[0];
}

export function activeNoteStyle(s: Settings = S.data.settings): NoteStyle {
  const skin = NOTE_SKINS.find(x => x.id === s.noteStyle);
  return skin && isUnlocked(skin.unlock, unlockStats()) ? s.noteStyle : 'Glow';
}

export function activeHitEffect(s: Settings = S.data.settings): HitEffect {
  const fx = HIT_EFFECTS.find(x => x.id === s.hitEffect);
  return fx && isUnlocked(fx.unlock, unlockStats()) ? s.hitEffect : 'Ring';
}

export function activeTheme(s: Settings = S.data.settings): ThemeDef {
  const t = THEMES.find(x => x.id === s.theme);
  return t && isUnlocked(t.unlock, unlockStats()) ? t : THEMES[0];
}

/** what the server shows next to your name */
export function lookForServer(p: Profile = S.data.profile): Look {
  const color = wornNameColor(p);
  return { title: p.title, tag: wornTag(p)?.id ?? '', color: color.id === 'default' ? '' : color.id };
}
