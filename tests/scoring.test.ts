import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJudgment, grade, initialStats, judge, resultFor, windows } from '../src/scoring.ts';

test('timing windows include their boundaries and treat early and late hits equally', () => {
  for (const sign of [-1, 1]) {
    assert.equal(judge(sign * windows.Perfect), 'Perfect');
    assert.equal(judge(sign * (windows.Perfect + 0.000001)), 'Great');
    assert.equal(judge(sign * windows.Great), 'Great');
    assert.equal(judge(sign * (windows.Great + 0.000001)), 'Good');
    assert.equal(judge(sign * windows.Good), 'Good');
    assert.equal(judge(sign * (windows.Good + 0.000001)), 'Miss');
  }
  assert.equal(judge(Number.NaN), 'Miss');
  assert.equal(judge(Number.POSITIVE_INFINITY), 'Miss');
});

test('combo threshold notes receive the new multiplier and misses reset it', () => {
  const stats = initialStats();
  for (let hit = 1; hit <= 50; hit++) {
    const before = stats.score;
    applyJudgment(stats, 'Perfect');
    const expectedMultiplier = hit >= 50 ? 4 : hit >= 25 ? 3 : hit >= 10 ? 2 : 1;
    assert.equal(stats.multiplier, expectedMultiplier);
    assert.equal(stats.score - before, 300 * expectedMultiplier);
  }
  assert.equal(stats.combo, 50);
  assert.equal(stats.maxCombo, 50);
  const score = stats.score;
  applyJudgment(stats, 'Miss');
  assert.equal(stats.score, score);
  assert.equal(stats.combo, 0);
  assert.equal(stats.multiplier, 1);
  assert.equal(stats.maxCombo, 50);
  applyJudgment(stats, 'Great');
  assert.equal(stats.score, score + 200);
});

test('accuracy averages every judgment and health is bounded', () => {
  const stats = initialStats();
  applyJudgment(stats, 'Miss');
  assert.equal(stats.health, 90);
  applyJudgment(stats, 'Good');
  assert.equal(stats.health, 91);
  applyJudgment(stats, 'Great');
  assert.equal(stats.health, 93);
  applyJudgment(stats, 'Perfect');
  assert.equal(stats.health, 96);
  assert.ok(Math.abs(stats.accuracy - 52.5) < 0.000001);
  assert.equal(stats.score, 600);
  for (let hit = 0; hit < 5; hit++) applyJudgment(stats, 'Perfect');
  assert.equal(stats.health, 100);
  for (let miss = 0; miss < 15; miss++) applyJudgment(stats, 'Miss');
  assert.equal(stats.health, 0);
});

test('SS requires a played all-perfect run, grades use accuracy, and a failed run is F', () => {
  const stats = initialStats();
  assert.equal(grade(stats, false), 'D');
  applyJudgment(stats, 'Perfect');
  assert.equal(grade(stats, false), 'SS');
  assert.equal(grade(stats, true), 'F');
  applyJudgment(stats, 'Great');
  for (const [accuracy, expected] of [[95, 'S'], [90, 'A'], [80, 'B'], [70, 'C'], [69.99, 'D']] as const) {
    stats.accuracy = accuracy;
    assert.equal(grade(stats, false), expected);
  }
});

test('results snapshot counts and full combo includes Great and Good but excludes misses and failures', () => {
  const stats = initialStats();
  assert.equal(resultFor(stats, 'song', false).fullCombo, false);
  applyJudgment(stats, 'Good');
  applyJudgment(stats, 'Great');
  const result = resultFor(stats, 'song', false);
  assert.equal(result.fullCombo, true);
  assert.equal(result.newBest, false);
  assert.equal(result.songId, 'song');
  assert.equal(resultFor(stats, 'song', true).fullCombo, false);
  applyJudgment(stats, 'Miss');
  assert.equal(result.counts.Miss, 0);
  assert.equal(resultFor(stats, 'song', false).fullCombo, false);
});
