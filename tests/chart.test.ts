import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChart } from '../src/chart.ts';
import { songs } from '../src/songs.ts';

test('ten original tracks have balanced difficulty and measured grid alignment', () => {
  assert.equal(songs.length, 10);
  assert.equal(songs.filter(song => song.difficulty === 'Easy').length, 5);
  assert.equal(songs.filter(song => song.difficulty === 'Hard').length, 5);
  for (const song of songs) {
    assert.ok(song.duration > 40 && song.duration < 65);
    assert.ok(song.analysis.gridFit > 0.85, `${song.id} grid fit`);
    assert.equal(song.analysis.bpm, song.bpm);
    assert.ok(song.analysis.offset >= 0.5);
    assert.equal(song.analysis.low.length, song.analysis.mid.length);
    assert.equal(song.analysis.low.length, song.analysis.high.length);
  }
});

test('charts are repeatable, ordered, playable, and grounded in measured onsets', () => {
  for (const song of songs) {
    const chart = generateChart(song);
    assert.deepEqual(chart, generateChart(song));
    assert.ok(chart.length > 80 && chart.length < 280, `${song.id} count ${chart.length}`);
    assert.ok(chart.some(note => note.lane === 0));
    assert.ok(chart.some(note => note.lane === 1));
    assert.ok(chart.some(note => note.chord), `${song.id} has gold chords`);
    for (let i = 0; i < chart.length; i++) {
      const note = chart[i];
      assert.ok(note.time >= song.analysis.offset && note.time < song.duration - 0.5);
      if (i) assert.ok(note.time >= chart[i - 1].time);
      const grid = Math.round((note.time - song.analysis.offset) / (60 / song.analysis.bpm / 4));
      assert.ok(Math.max(Number(song.analysis.low[grid]), Number(song.analysis.mid[grid]), Number(song.analysis.high[grid])) >= 2);
      if (i && note.time === chart[i - 1].time) {
        assert.ok(note.chord && chart[i - 1].chord);
        assert.notEqual(note.lane, chart[i - 1].lane);
      }
      if (i && note.time > chart[i - 1].time && note.time - chart[i - 1].time < 0.14 && !chart[i - 1].chord) {
        assert.notEqual(note.lane, chart[i - 1].lane, `${song.id} rapid notes alternate`);
      }
    }
  }
});
