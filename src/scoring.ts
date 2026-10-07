// Rules shared by gameplay, results and menus: grades, multipliers, XP, formatting.
import { MOD_INFO, MOD_ORDER, RATE_MULT, STYLES } from './config.ts';
import type { Grade, PlaySet, Settings } from './types.ts';

export function comboMultiplier(combo: number): number {
  if (combo >= 50) return 4;
  if (combo >= 25) return 3;
  if (combo >= 10) return 2;
  return 1;
}

/** counts = [perfect, great, good, miss] */
export function gradeFor(acc: number, cleared: boolean, counts: number[]): Grade {
  if (!cleared) return 'F';
  if (counts[1] + counts[2] + counts[3] === 0) return 'SS';
  if (acc >= 95) return 'S';
  if (acc >= 90) return 'A';
  if (acc >= 80) return 'B';
  if (acc >= 70) return 'C';
  return 'D';
}

export function currentSet(settings: Settings, autoplay: boolean): PlaySet {
  return {
    style: settings.style, rate: settings.rate,
    hidden: settings.hidden, sudden: settings.sudden, flashlight: settings.flashlight, mirror: settings.mirror,
    random: settings.random, wave: settings.wave, mines: settings.mines, auto: autoplay,
  };
}

/** Score multiplier for a play set, plus whether the run counts for personal bests. */
export function setMultiplier(set: PlaySet): { mult: number; unranked: boolean } {
  const style = STYLES[set.style];
  let mult = style.mult * (RATE_MULT[set.rate] ?? 1);
  for (const name of MOD_ORDER) {
    const info = MOD_INFO[name];
    if (set[info.key]) mult *= info.mult;
  }
  return { mult, unranked: !!(style.unranked || set.auto) };
}

export const rateText = (rate: number) => `${rate.toFixed(2)}x`;

export function setSummary(set: PlaySet): string {
  const parts = [STYLES[set.style].label];
  if (set.rate !== 1) parts.push(rateText(set.rate));
  for (const name of MOD_ORDER) {
    const info = MOD_INFO[name];
    if (set[info.key]) parts.push(info.label);
  }
  return parts.join('  ·  ');
}

export const xpForLevel = (level: number) => 400 + level * 200;

export function levelFromXp(xp: number): { level: number; rest: number; need: number } {
  let level = 1, rest = xp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, rest, need: xpForLevel(level) };
}

export function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function fmtTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'SPACE', Enter: 'ENTER', Backspace: 'BKSP', CapsLock: 'CAPS',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Semicolon: ';', Comma: ',', Period: '.', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`',
};

/** KeyboardEvent.code -> short label shown on buttons ("KeyF" -> "F"). */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

export function gradeColor(g: string, T: Record<string, string>): string {
  if (g === 'SS' || g === 'S') return T.gold;
  if (g === 'A') return T.green;
  if (g === 'B') return T.cyan;
  if (g === 'C') return T.purple;
  if (g === 'F') return T.red;
  return T.muted;
}
