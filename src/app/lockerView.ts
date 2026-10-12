// What the Locker shows for each unlockable: equipped / unlocked / locked, whether it's NEW, and how
// close a locked one is ("7 / 10"). Pure functions over the catalog and the save, so the tests can load it.
import { isUnlocked, type UnlockRule, type UnlockStats } from '../../shared/cosmetics.js';
import type { UnlockCategory, Unlockable } from './unlocks.ts';

/** `guest`: the hint for players who aren't logged in (what they wear only shows online with an account) */
export interface LockerTab { cat: UnlockCategory; label: string; accent: string; hint: string; guest?: string }
export const LOCKER_TABS: LockerTab[] = [
  { cat: 'title', label: 'TITLES', accent: '#F5C451', hint: 'Earned with achievements. Shown with your name on the leaderboards.', guest: 'Earned with achievements. Log in to show yours on the leaderboards.' },
  { cat: 'tag', label: 'TAGS', accent: '#2BD4FF', hint: 'A badge next to your name on leaderboards, the live feed and in 1v1.', guest: 'A badge next to your name. Log in to show it on leaderboards and in 1v1.' },
  { cat: 'color', label: 'NAME COLORS', accent: '#FF5CA8', hint: 'The color of your name, online and in the menus.', guest: 'The color of your name in the menus. Log in to show it online too.' },
  { cat: 'skin', label: 'LINE SKINS', accent: '#4ADE80', hint: 'How the falling lines look. They use your Button 1 / Button 2 colors.' },
  { cat: 'effect', label: 'HIT EFFECTS', accent: '#A78BFA', hint: 'What a hit looks like on the button.' },
  { cat: 'theme', label: 'THEMES', accent: '#FF8A3D', hint: 'The colors of the glow behind the menus.' },
];

export type CardState = 'equipped' | 'unlocked' | 'locked';

export function cardState(unlocked: boolean, equipped: boolean): CardState {
  return !unlocked ? 'locked' : equipped ? 'equipped' : 'unlocked';
}

/** unlocked but not looked at yet. Free things are never new (everyone starts with them). */
export function isNew(u: Unlockable, unlocked: boolean, seen: Record<string, true>): boolean {
  return unlocked && u.unlock.kind !== 'always' && seen[u.key] !== true;
}

const COUNTED = { level: 'level', plays: 'plays', streak: 'streak', fcs: 'fcs', ss: 'ss', vsWins: 'vsWins', imports: 'imports', kings: 'kings', tops: 'tops' } as const;

/** how far along a counted rule is (level 7 of 10); null for yes/no rules (achievements, the tutorial, "win a 1v1") */
export function ruleProgress(rule: UnlockRule, s: UnlockStats): { have: number; need: number } | null {
  if (!(rule.kind in COUNTED) || !('n' in rule) || rule.n <= 1) return null;
  const have = s[COUNTED[rule.kind as keyof typeof COUNTED]];
  return { have: Math.min(have, rule.n), need: rule.n };
}

export interface Counts { unlocked: number; total: number; fresh: number }

/** unlocked / total / new, overall and per Locker tab */
export function lockerCounts(items: Unlockable[], stats: UnlockStats, seen: Record<string, true>) {
  const blank = (): Counts => ({ unlocked: 0, total: 0, fresh: 0 });
  const all = blank();
  const byCat = Object.fromEntries(LOCKER_TABS.map(t => [t.cat, blank()])) as Record<UnlockCategory, Counts>;
  for (const u of items) {
    const on = isUnlocked(u.unlock, stats);
    for (const c of [all, byCat[u.category]]) {
      c.total++;
      if (on) c.unlocked++;
      if (isNew(u, on, seen)) c.fresh++;
    }
  }
  return { all, byCat };
}

/** the keys to mark seen once a tab has been shown (only unlocked, not-free ones are worth keeping) */
export function keysToMarkSeen(items: Unlockable[], cat: UnlockCategory, stats: UnlockStats, seen: Record<string, true>): string[] {
  return items.filter(u => u.category === cat && isNew(u, isUnlocked(u.unlock, stats), seen)).map(u => u.key);
}

/** which tab the Locker opens on: the first with something new, else the last one looked at */
export function startTab(byCat: Record<UnlockCategory, Counts>, last: UnlockCategory): UnlockCategory {
  return LOCKER_TABS.find(t => byCat[t.cat].fresh > 0)?.cat ?? last;
}

export const UNLOCK_NOUN: Record<UnlockCategory, string> = {
  title: 'title', tag: 'tag', color: 'name color', skin: 'line skin', effect: 'hit effect', theme: 'theme',
};

/** "VETERAN tag, Sky name color and 2 more" in pieces (items and the words between), for the results screen */
export function unlockParts<U extends Pick<Unlockable, 'category' | 'label'>>(items: U[], max = 2): (U | string)[] {
  const named = items.slice(0, max);
  const more = items.length - named.length;
  const out: (U | string)[] = [];
  named.forEach((u, i) => {
    if (i) out.push(!more && i === named.length - 1 ? ' and ' : ', ');
    out.push(u);
  });
  if (more) out.push(` and ${more} more`);
  return out;
}

export const unlockSummary = (items: Pick<Unlockable, 'category' | 'label'>[], max = 2) =>
  unlockParts(items, max).map(p => (typeof p === 'string' ? p : `${p.label} ${UNLOCK_NOUN[p.category]}`)).join('');
