import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJudgment, initialStats, resultFor } from '../src/scoring.ts';
import { loadBests, loadSettings, normaliseSettings, saveBest, saveSettings } from '../src/storage.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return data;
}

function clearResult(score: number, fullCombo = false) {
  const stats = initialStats();
  applyJudgment(stats, 'Perfect');
  if (!fullCombo) applyJudgment(stats, 'Miss');
  const result = resultFor(stats, 'test-song', false);
  result.score = score;
  return result;
}

test('settings default safely and accept a swapped key pair', () => {
  const expected = { keys: ['f', 'j'], scrollSpeed: 1, offsetMs: 0, volume: 0.7, effects: true };
  assert.deepEqual(normaliseSettings(null), expected);
  assert.deepEqual(normaliseSettings({ keys: ['J', 'F'] }).keys, ['j', 'f']);
  assert.deepEqual(normaliseSettings({ keys: [' ', 'j'] }).keys, [' ', 'j']);
  assert.deepEqual(normaliseSettings({ keys: ['ArrowLeft', 'ArrowRight'] }).keys, ['arrowleft', 'arrowright']);
  for (const keys of [['f', 'F'], ['Escape', 'j'], ['/', 'j'], ['\t', 'j'], ['f'], ['f', 'j', 'k']]) {
    assert.deepEqual(normaliseSettings({ keys }).keys, expected.keys);
  }
  const settings = normaliseSettings({ scrollSpeed: 99, offsetMs: -999, volume: -3, effects: false });
  assert.equal(settings.scrollSpeed, 3);
  assert.equal(settings.offsetMs, -300);
  assert.equal(normaliseSettings({ offsetMs: 17 }).offsetMs, 15);
  assert.equal(settings.volume, 0);
  assert.equal(settings.effects, false);
  assert.equal(normaliseSettings({ volume: Number.NaN }).volume, 0.7);
  assert.equal(normaliseSettings({ effects: 'false' }).effects, true);
  fakeStorage();
  saveSettings(normaliseSettings({ keys: ['d', 'k'], volume: 0.3 }));
  assert.deepEqual(loadSettings().keys, ['d', 'k']);
  assert.equal(loadSettings().volume, 0.3);
  saveSettings(normaliseSettings({ keys: ['ArrowLeft', 'Enter'] }));
  assert.deepEqual(loadSettings().keys, ['arrowleft', 'enter']);
});

test('corrupt saves and blocked storage never throw', () => {
  fakeStorage({ 'line-rush.settings.v1': '{broken', 'line-rush.bests.v1': '[]' });
  assert.deepEqual(loadSettings().keys, ['f', 'j']);
  assert.deepEqual(loadBests(), {});
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  assert.doesNotThrow(() => saveSettings(loadSettings()));
  assert.doesNotThrow(() => saveBest(clearResult(300)));
  assert.deepEqual(loadBests(), {});
  fakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { return null; }, setItem() { throw new Error('Quota exhausted'); },
  } });
  assert.doesNotThrow(() => saveBest(clearResult(300)));
});

test('loadBests keeps only independently validated clear score records', () => {
  const valid = { score: 900, accuracy: 92.5, maxCombo: 13, grade: 'A', fullCombo: false };
  fakeStorage({ 'line-rush.bests.v1': JSON.stringify({
    valid,
    negativeScore: { ...valid, score: -1 },
    decimalScore: { ...valid, score: 1.5 },
    inaccurate: { ...valid, accuracy: 101 },
    negativeCombo: { ...valid, maxCombo: -1 },
    failed: { ...valid, grade: 'F' },
    missing: { score: 900 },
    textCombo: { ...valid, fullCombo: 'true' },
    constructor: valid,
  }) });
  assert.deepEqual(loadBests(), { valid });
});

test('new highs store one run’s stats and retain full-combo history across runs', () => {
  fakeStorage();
  assert.equal(saveBest(clearResult(300, true)), true);
  const higher = clearResult(600);
  assert.equal(saveBest(higher), true);
  assert.equal(loadBests()['test-song'].score, 600);
  assert.equal(loadBests()['test-song'].accuracy, higher.accuracy);
  assert.equal(loadBests()['test-song'].fullCombo, true);
  assert.equal(saveBest(clearResult(500)), false);
  assert.equal(saveBest(clearResult(600)), false);
  assert.equal(loadBests()['test-song'].score, 600);
});

test('a lower score can earn the historical full combo badge but a failed high score is ignored', () => {
  fakeStorage();
  saveBest(clearResult(900));
  assert.equal(saveBest(clearResult(300, true)), false);
  assert.equal(loadBests()['test-song'].score, 900);
  assert.equal(loadBests()['test-song'].fullCombo, true);
  const failed = clearResult(9000);
  failed.failed = true;
  assert.equal(saveBest(failed), false);
  assert.equal(loadBests()['test-song'].score, 900);
});
