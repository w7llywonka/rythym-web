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
