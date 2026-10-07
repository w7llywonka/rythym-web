import type { Grade, Judgment, Result, Stats } from './types.ts';

export const windows = { Perfect: 0.045, Great: 0.09, Good: 0.14 } as const;

const points: Record<Judgment, number> = { Perfect: 300, Great: 200, Good: 100, Miss: 0 };
const accuracyWeight: Record<Judgment, number> = { Perfect: 1, Great: 0.7, Good: 0.4, Miss: 0 };
const healthChange: Record<Judgment, number> = { Perfect: 3, Great: 2, Good: 1, Miss: -10 };

export function judge(deltaSeconds: number): Judgment {
  const distance = Math.abs(deltaSeconds);
  if (distance <= windows.Perfect) return 'Perfect';
  if (distance <= windows.Great) return 'Great';
  if (distance <= windows.Good) return 'Good';
  return 'Miss';
}

export function initialStats(): Stats {
  return {
    score: 0, accuracy: 100, combo: 0, maxCombo: 0, multiplier: 1, health: 100,
    counts: { Perfect: 0, Great: 0, Good: 0, Miss: 0 },
  };
}

export function applyJudgment(stats: Stats, judgment: Judgment): void {
  stats.counts[judgment] += 1;
  stats.combo = judgment === 'Miss' ? 0 : stats.combo + 1;
  stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
  // A threshold hit earns its new multiplier: the 10th hit earns ×2, the 25th ×3,
  // and the 50th ×4. A miss resets the multiplier before the next note.
  stats.multiplier = stats.combo >= 50 ? 4 : stats.combo >= 25 ? 3 : stats.combo >= 10 ? 2 : 1;
  stats.score += points[judgment] * stats.multiplier;
  const judged = Object.values(stats.counts).reduce((sum, count) => sum + count, 0);
  const weighted = (Object.keys(accuracyWeight) as Judgment[])
    .reduce((sum, key) => sum + stats.counts[key] * accuracyWeight[key], 0);
  stats.accuracy = (weighted / judged) * 100;
  stats.health = Math.max(0, Math.min(100, stats.health + healthChange[judgment]));
}

export function grade(stats: Stats, failed: boolean): Grade {
  if (failed) return 'F';
  const judged = Object.values(stats.counts).reduce((sum, count) => sum + count, 0);
  if (judged === 0) return 'D';
  if (stats.counts.Perfect === judged) return 'SS';
  if (stats.accuracy >= 95) return 'S';
  if (stats.accuracy >= 90) return 'A';
  if (stats.accuracy >= 80) return 'B';
  if (stats.accuracy >= 70) return 'C';
  return 'D';
}

export function resultFor(stats: Stats, songId: string, failed: boolean): Result {
  const judged = Object.values(stats.counts).reduce((sum, count) => sum + count, 0);
  return {
    ...stats,
    counts: { ...stats.counts },
    songId,
    grade: grade(stats, failed),
    failed,
    fullCombo: !failed && judged > 0 && stats.counts.Miss === 0,
    newBest: false,
  };
}
