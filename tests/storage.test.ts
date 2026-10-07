import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYS, DEFAULT_SETTINGS, K } from '../src/config.ts';
import {
  dropImportProgress, IMPORT_PROGRESS_KEY, load, sanitize, save, saveImportProgress, STORAGE_KEY, withImportProgress, withoutImports,
} from '../src/storage.ts';
import type { Best, Diff } from '../src/types.ts';

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

test('imported songs never go to the account: their progress stays on this computer', () => {
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

const best = (score: number): Best => ({ score, accuracy: 95, combo: 10, grade: 'S', fc: false });
const recentOf = (...ids: string[]) => ids.map(id => ({ id, chart: 'Easy' as Diff }));

test('import bests earned while signed in survive logging out and reloading', () => {
  const store = memory();
  // guest save on this computer, from before logging in
  const guest = sanitize(null);
  guest.bests.afterglow = best(100);
  save(guest, store);
  // signed in: set a best on an import, then the save flushes
  const account = withImportProgress(sanitize(null), store);
  account.bests['custom-abc'] = best(999);
  account.recent = recentOf('custom-abc');
  saveImportProgress(account, store);
  // logged out (or the session expired), then reloaded: every load merges, so the next flush keeps it
  for (let i = 0; i < 2; i++) {
    const loaded = withImportProgress(load(store), store);
    assert.equal(loaded.bests['custom-abc']?.score, 999);
    assert.equal(loaded.bests.afterglow?.score, 100);
    saveImportProgress(loaded, store);
    save(loaded, store);
  }
});

test('the import progress entry is the only source for imports once written', () => {
  const store = memory();
  // an older guest save that still has an import's scores in it
  const guest = sanitize(null);
  guest.bests['custom-old'] = best(700);
  guest.bests['custom-old+'] = best(800);
  guest.recent = recentOf('custom-old', 'afterglow');
  save(guest, store);

  // never written: the save's own import entries are kept this once
  const first = withImportProgress(load(store), store);
  assert.equal(first.bests['custom-old']?.score, 700);
  assert.deepEqual(first.recent.map(e => e.id), ['custom-old', 'afterglow']);
  saveImportProgress(first, store);

  // REMOVE IMPORT, saved: neither the guest save nor an old account save brings it back
  const removed = dropImportProgress(first, 'custom-old');
  saveImportProgress(removed, store);
  for (const base of [load(store), guest]) {
    const merged = withImportProgress(base, store);
    assert.equal(merged.bests['custom-old'], undefined);
    assert.equal(merged.bests['custom-old+'], undefined);
    assert.deepEqual(merged.recent.map(e => e.id), ['afterglow']);
  }
  // an empty entry still counts as written
  const blank = memory({ [IMPORT_PROGRESS_KEY]: JSON.stringify({ bests: {}, recent: [] }) });
  assert.equal(withImportProgress(guest, blank).bests['custom-old'], undefined);
});

test('merged Recent keeps this computer order and never grows past the limit', () => {
  const store = memory();
  // played here, newest first: an import, then two built-in songs
  const here = sanitize(null);
  here.recent = recentOf('custom-new', 'afterglow', 'gone');
  saveImportProgress(here, store);
  // the account (or guest save) has its own list; "gone" isn't in it any more
  const base = sanitize(null);
  base.recent = recentOf('s1', 'afterglow', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9');
  const merged = withImportProgress(base, store);
  assert.deepEqual(merged.recent.map(e => e.id), ['custom-new', 'afterglow', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  assert.equal(merged.recent.length, K.MAX_RECENT);

  // a full list of imports here and a full base: still capped
  const many = sanitize(null);
  many.recent = Array.from({ length: K.MAX_RECENT }, (_, i) => ({ id: `custom-${i}`, chart: 'Hard' as Diff }));
  saveImportProgress(many, store);
  const full = withImportProgress(base, store);
  assert.equal(full.recent.length, K.MAX_RECENT);
  assert.ok(full.recent.every(e => e.id.startsWith('custom-')));
  // and the account never sees any of it
  assert.deepEqual(withoutImports(full).recent, []);
});

test('dropImportProgress forgets one import: both charts\' bests and its Recent entries', () => {
  const d = sanitize(null);
  d.bests['custom-a'] = best(1);
  d.bests['custom-a+'] = best(2);
  d.bests['custom-b'] = best(3);
  d.bests.afterglow = best(4);
  d.recent = recentOf('custom-a', 'afterglow', 'custom-b');
  const out = dropImportProgress(d, 'custom-a');
  assert.deepEqual(Object.keys(out.bests).sort(), ['afterglow', 'custom-b']);
  assert.deepEqual(out.recent.map(e => e.id), ['afterglow', 'custom-b']);
  // the original isn't changed
  assert.equal(d.bests['custom-a+']?.score, 2);
  assert.equal(d.recent.length, 3);
});
