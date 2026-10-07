import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChart, NEXT } from '../src/chart.ts';
import { songs } from '../src/songs.ts';
import { soundtrack } from '../src/tracks.ts';

test('ten original tracks: five Easy, five Hard, with aligned onset grids', () => {
  assert.equal(songs.length, 10);
  assert.equal(songs.filter(s => s.difficulty === 'Easy').length, 5);
  assert.equal(songs.filter(s => s.difficulty === 'Hard').length, 5);
  for (const s of songs) {
    assert.equal(s.analysis.low.length, s.analysis.mid.length);
    assert.equal(s.analysis.low.length, s.analysis.high.length);
  }
});

test('every track has its own chart and a harder "+" chart', () => {
  for (const t of soundtrack()) {
    assert.deepEqual(t.chartList, [t.difficulty, NEXT[t.difficulty]]);
    const base = t.charts[t.chartList[0]], plus = t.charts[t.chartList[1]];
    assert.ok(base && base.notes.length > 40, `${t.id} base chart`);
    assert.ok(plus && plus.notes.length > base.notes.length, `${t.id} + chart is denser`);
    assert.ok(plus.level > base.level, `${t.id} + chart is a higher level`);
  }
});

test('charts are deterministic, time-ordered and playable', () => {
  for (const t of soundtrack()) {
    for (const diff of t.chartList) {
      const notes = generateChart(t, diff);
      assert.deepEqual(notes, generateChart(t, diff));
      assert.ok(notes.some(n => n.lane === 1) && notes.some(n => n.lane === 2), `${t.id} uses both lanes`);
      const lastEnd: Record<number, number> = { 1: -Infinity, 2: -Infinity };
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (i) assert.ok(n.time >= notes[i - 1].time, 'sorted');
        assert.ok(n.time >= t.offset - 0.001 && n.time < t.length, `${t.id} note inside the song`);
        assert.ok(n.time > lastEnd[n.lane], `${t.id} ${diff}: no note under a hold at ${n.time.toFixed(2)}`);
        if (n.endTime !== undefined) {
          assert.ok(n.endTime > n.time + 0.25, 'hold has length');
          lastEnd[n.lane] = n.endTime;
        }
      }
    }
  }
});

test('Easy charts keep a comfortable gap between notes', () => {
  for (const t of soundtrack().filter(x => x.difficulty === 'Easy')) {
    const notes = t.charts.Easy!.notes.filter(n => !n.chord || n.lane === 1);
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].time - notes[i - 1].time >= 0.298, `${t.id} gap`);
  }
});
