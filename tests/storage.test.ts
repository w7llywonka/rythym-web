import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYS, DEFAULT_SETTINGS } from '../src/config.ts';
import { load, sanitize, save, STORAGE_KEY } from '../src/storage.ts';

const memory = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('missing or broken saves fall back to defaults', () => {
  for (const raw of [null, undefined, 5, 'x', [], { settings: 'nope', bests: [], profile: null }]) {
    const d = sanitize(raw);
    assert.deepEqual(d.settings.keys, DEFAULT_KEYS);
    assert.deepEqual(d.bests, {});
    assert.deepEqual(d.recent, []);
    assert.equal(d.profile.xp, 0);
  }
  assert.equal(load(memory({ [STORAGE_KEY]: '{not json' })).profile.xp, 0);
  assert.equal(load(null).settings.scrollSpeed, DEFAULT_SETTINGS.scrollSpeed);
});

test('values are clamped and junk is dropped', () => {
  const d = sanitize({
    settings: { scrollSpeed: 99, offset: -9999, musicVolume: 3, keys: ['KeyA', 'KeyA', 'KeyR'], style: 'Cheat', rate: 7 },
    bests: { ok: { score: 100, accuracy: 99, combo: 5, grade: 'S', fc: true }, bad: { score: 'lots' } },
    recent: [{ id: 'afterglow', chart: 'Easy' }, { id: 5 }],
    profile: { xp: -5 },
  });
  assert.ok(d.settings.scrollSpeed <= 3);
  assert.ok(d.settings.offset >= -300);
  assert.ok(d.settings.musicVolume <= 1);
  assert.equal(new Set(d.settings.keys).size, 3, 'duplicate keys are reset');
  assert.equal(d.settings.style, 'Classic');
  assert.equal(d.settings.rate, 1);
  assert.deepEqual(Object.keys(d.bests), ['ok']);
  assert.equal(d.recent.length, 1);
  assert.equal(d.profile.xp, 0);
});

test('save + load round trip', () => {
  const store = memory();
  const d = sanitize(null);
  d.profile.xp = 1234;
  d.bests.afterglow = { score: 5000, accuracy: 97.5, combo: 40, grade: 'S', fc: false };
  d.settings.keys = ['KeyD', 'KeyK', 'KeyR'];
  assert.equal(save(d, store), true);
  assert.deepEqual(load(store), d);
});

test('look settings accept hex colors only and clamp line thickness', () => {
  const d = sanitize({ settings: { laneColors: ['#00ff00', 'red'], chordColor: 'javascript:alert(1)', noteStyle: 'Weird', noteSize: 99 } });
  assert.deepEqual(d.settings.laneColors, ['#00FF00', DEFAULT_SETTINGS.laneColors[1]]);
  assert.equal(d.settings.chordColor, DEFAULT_SETTINGS.chordColor);
  assert.equal(d.settings.noteStyle, 'Glow');
  assert.ok(d.settings.noteSize <= 32);
});

test('imported songs never go to the account: their progress stays on this computer', async () => {
  const { withoutImports, saveImportProgress, withImportProgress } = await import('../src/storage.ts');
  const d = sanitize(null);
  d.bests.afterglow = { score: 100, accuracy: 90, combo: 5, grade: 'A', fc: false };
  d.bests['custom-abc'] = { score: 999, accuracy: 99, combo: 50, grade: 'S', fc: true };
  d.bests['custom-abc+'] = { score: 500, accuracy: 95, combo: 30, grade: 'S', fc: false };
  d.recent = [{ id: 'custom-abc', chart: 'Expert' }, { id: 'afterglow', chart: 'Easy' }];

  const server = withoutImports(d);
  assert.deepEqual(Object.keys(server.bests), ['afterglow']);
  assert.deepEqual(server.recent.map(e => e.id), ['afterglow']);
  assert.ok(!JSON.stringify(server).includes('custom-'));

  const store = memory();
  saveImportProgress(d, store);
  const back = withImportProgress(server, store);
  assert.equal(back.bests['custom-abc'].score, 999);
  assert.equal(back.bests['custom-abc+'].score, 500);
  assert.deepEqual(back.recent.map(e => e.id).sort(), ['afterglow', 'custom-abc']);
  // nothing local: unchanged
  assert.deepEqual(withImportProgress(server, memory()), server);
});
