import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { licensedSongs } from '../src/songs.ts';
import { soundtrack } from '../src/tracks.ts';

const ALLOWED = /^(CC0( 1\.0)?|Public Domain|CC BY (3\.0|4\.0))$/;

test('licensed tracks: allowed licenses only, files present, credited', () => {
  for (const s of licensedSongs) {
    assert.ok(s.credit, `${s.id} has a credit`);
    assert.match(s.credit!.license, ALLOWED, `${s.id} license "${s.credit!.license}"`);
    assert.doesNotMatch(s.credit!.license, /NC|ND|SA/);
    assert.match(s.credit!.sourceUrl, /^https:\/\//);
    assert.match(s.credit!.licenseUrl, /^https:\/\/creativecommons\.org\//);
    assert.match(s.audio, /^file:\/music\/[a-z0-9-]+\.mp3\?v=[0-9a-f]{10}$/, `${s.id} audio URL is versioned`);
    const file = new URL(`../public${s.audio.replace(/^file:/, '').split('?')[0]}`, import.meta.url);
    assert.ok(existsSync(file), `${s.id} audio file`);
    assert.ok(statSync(file).size > 100_000, `${s.id} audio is a real recording`);
    assert.ok(s.difficulty === 'Expert' || s.difficulty === 'Extreme', `${s.id} is Expert or Extreme`);
  }
  const credits = readFileSync(new URL('../MUSIC-LICENSE.md', import.meta.url), 'utf8');
  for (const s of licensedSongs) assert.ok(credits.includes(s.title) && credits.includes(s.artist), `${s.id} credited in MUSIC-LICENSE.md`);
});

test('licensed tracks chart well: both charts, "+" is harder, Extreme stays under about a minute', () => {
  const tracks = soundtrack().filter(t => t.song.credit);
  assert.equal(tracks.length, licensedSongs.length);
  for (const t of tracks) {
    assert.equal(t.grid?.length, t.low.length, `${t.id} grid rebuilt`);
    const [base, plus] = t.chartList.map(d => t.charts[d]);
    assert.ok(base && base.notes.length > 60, `${t.id} base chart`);
    assert.ok(plus && plus.notes.length > base.notes.length && plus.level > base.level, `${t.id} "+" chart is harder`);
    if (t.difficulty === 'Extreme') {
      assert.ok(t.chartStart !== undefined && t.chartEnd !== undefined, `${t.id} has a window`);
      assert.ok(t.chartEnd! - t.chartStart! <= 75, `${t.id} window ${t.chartEnd! - t.chartStart!}s`);
      for (const n of base.notes) assert.ok(n.time >= t.chartStart! - 0.01 && n.time <= t.chartEnd! + 0.01);
    }
  }
});
