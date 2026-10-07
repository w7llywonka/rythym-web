import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { comboMultiplier, currentSet, fmtTime, formatNumber, gradeFor, keyName, levelFromXp, setMultiplier, xpForLevel } from '../src/scoring.ts';
import { currentWeek, pickWeekly } from '../src/weekly.ts';

test('combo multiplier steps at 10 / 25 / 50', () => {
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50, 500].map(comboMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('grades', () => {
  assert.equal(gradeFor(100, true, [10, 0, 0, 0]), 'SS');
  assert.equal(gradeFor(99.9, true, [9, 1, 0, 0]), 'S');
  assert.equal(gradeFor(92, true, [5, 1, 1, 1]), 'A');
  assert.equal(gradeFor(85, true, [5, 1, 1, 1]), 'B');
  assert.equal(gradeFor(75, true, [5, 1, 1, 1]), 'C');
  assert.equal(gradeFor(50, true, [5, 1, 1, 1]), 'D');
  assert.equal(gradeFor(100, false, [10, 0, 0, 0]), 'F');
});

test('styles, speed and mods change the multiplier; autoplay and practice never save', () => {
  const s = { ...DEFAULT_SETTINGS };
  assert.deepEqual(setMultiplier(currentSet(s, false)), { mult: 1, unranked: false });
  assert.ok(setMultiplier(currentSet({ ...s, rate: 1.5 }, false)).mult > 1);
  assert.ok(setMultiplier(currentSet({ ...s, rate: 0.5 }, false)).mult < 1);
  assert.ok(setMultiplier(currentSet({ ...s, hidden: true }, false)).mult > 1);
  assert.equal(setMultiplier(currentSet(s, true)).unranked, true);
  assert.equal(setMultiplier(currentSet({ ...s, style: 'Practice' }, false)).unranked, true);
});

test('levels need 400 + 200 * level xp', () => {
  assert.equal(levelFromXp(0).level, 1);
  const need1 = xpForLevel(1);
  assert.equal(levelFromXp(need1 - 1).level, 1);
  assert.equal(levelFromXp(need1).level, 2);
  assert.equal(levelFromXp(need1 + xpForLevel(2)).level, 3);
});

test('formatting helpers', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(fmtTime(65), '1:05');
  assert.equal(keyName('KeyF'), 'F');
});

test('weekly challenge is the same for everyone in a week and rotates', () => {
  const now = Date.UTC(2026, 9, 7) / 1000;
  const a = currentWeek(now), b = currentWeek(now + 7 * 86400);
  assert.equal(b.week, a.week + 1);
  assert.ok(a.ends > now && a.ends <= now + 7 * 86400);
  const pool = [{ id: 'x', difficulty: 'Hard' }, { id: 'y', difficulty: 'Expert' }, { id: 'z', difficulty: 'Easy' }];
  assert.deepEqual(pickWeekly(a.week, pool), pickWeekly(a.week, [...pool].reverse()));
  assert.notEqual(pickWeekly(a.week, pool)!.song.id, 'z');
});
