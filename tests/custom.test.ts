import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSamples, importSong } from '../src/custom.ts';
import { trackFromImport } from '../src/tracks.ts';
import { songs } from '../src/songs.ts';

function fixture(bpm = 174, duration = 14): Float32Array {
  const rate = 22050, samples = new Float32Array(duration * rate), step = 60 / bpm / 4;
  for (let hit = 0; 0.6 + hit * step < duration - 0.3; hit++) {
    const start = Math.round((0.6 + hit * step) * rate);
    for (let i = 0; i < rate * 0.14 && start + i < samples.length; i++) {
      const t = i / rate;
      if (hit % 4 === 0) samples[start + i] += Math.sin(2 * Math.PI * (55 * t + 2.2 * (1 - Math.exp(-t / 0.025)))) * Math.exp(-t / 0.035) * 0.6;
      if (hit % 8 === 4) samples[start + i] += Math.sin(i * 161.75) * Math.exp(-t / 0.02) * 0.25;
      samples[start + i] += Math.sin(i * 243.82) * Math.exp(-t / 0.005) * 0.07;
    }
  }
  return samples;
}

test('custom audio FFT finds a fast straight beat and quantizes real band onsets', async () => {
  const progress: string[] = [];
  const result = await analyzeSamples(fixture(), 22050, text => progress.push(text));
  assert.ok(Math.abs(result.analysis.bpm - 174) < 1, `Detected ${result.detectedBpm}, playable ${result.analysis.bpm}`);
  assert.ok(result.analysis.gridFit > 0.75, `Grid fit ${result.analysis.gridFit}`);
  assert.equal(result.analysis.low.length, result.analysis.mid.length);
  assert.equal(result.analysis.low.length, result.analysis.high.length);
  assert.match(result.analysis.low, /^[0-9]+$/);
  assert.ok(result.analysis.low.includes('9'));
  assert.ok(progress.some(text => text.includes('Finding the beats')));
  assert.equal(progress.at(-1), 'Your custom challenge is ready.');
});

test('silent and invalid recordings produce useful errors', async () => {
  await assert.rejects(analyzeSamples(new Float32Array(22050 * 10), 22050), /No audible beat/);
  await assert.rejects(analyzeSamples(new Float32Array(512), 22050), /enough usable samples/);
  const unusedContext = {} as AudioContext;
  await assert.rejects(importSong({ size: 0 } as File, unusedContext), /empty/);
  await assert.rejects(importSong({ size: 41 * 1024 * 1024 } as File, unusedContext), /40 MB/);
  await assert.rejects(importSong(new File(['text'], 'document.txt', { type: 'text/plain' }), unusedContext), /audio file/);
});

test('import is local, retains playback PCM, and creates a stable hard chart identity', async () => {
  const pcm = fixture();
  const buffer = {
    duration: pcm.length / 22050, sampleRate: 22050, numberOfChannels: 1,
    getChannelData: () => pcm,
  } as unknown as AudioBuffer;
  let decoded = 0;
  const context = { async decodeAudioData() { decoded++; return buffer; } } as unknown as AudioContext;
  const file = new File(['same local bytes'], 'Waste My Time.mp3', { type: 'audio/mpeg' });
  const first = await importSong(file, context);
  const second = await importSong(file, context);
  assert.equal(decoded, 2);
  assert.equal(first.buffer, buffer);
  assert.equal(first.song.id, second.song.id);
  assert.equal(first.song.seed, second.song.seed);
  assert.equal(first.song.title, 'Waste My Time');
  assert.match(first.song.artist, /kevinhilfiger/);
  assert.equal(first.song.difficulty, 'Hard');
  assert.equal(first.song.level, 10);
  assert.match(first.song.audio, /^local:custom-/);
  const track = trackFromImport(first.song);
  assert.ok(track.custom);
  assert.ok((track.charts[track.difficulty]?.notes.length ?? 0) > 40);
});

test('imports are tiered by tempo and charted over the whole song', () => {
  const base = songs.find(song => song.id === 'hyperlane')!;
  const tierAt = (bpm: number) => trackFromImport({ ...base, analysis: { ...base.analysis, bpm } }).difficulty;
  assert.equal(tierAt(90), 'Easy');
  assert.equal(tierAt(115), 'Hard');
  assert.equal(tierAt(140), 'Expert'); // energetic rap / EDM tempos are Expert
  assert.equal(tierAt(175), 'Extreme');
  // repeat the onset grid to make a long (5 minute) recording
  const a = base.analysis, times = 6;
  const long = { ...base, duration: base.duration * times, analysis: { ...a, low: a.low.repeat(times), mid: a.mid.repeat(times), high: a.high.repeat(times) } };
  const t = trackFromImport(long);
  assert.equal(t.chartStart, undefined);
  assert.equal(t.chartEnd, undefined);
  assert.equal(t.displayLength, long.duration);
  const notes = t.charts[t.difficulty]!.notes;
  assert.ok(notes[notes.length - 1].time > long.duration - 15, 'notes run to the end of the song');
});

// ---- beat-tracked import analysis --------------------------------------------------------------
const RATE = 22050;
function drums(opts: { bpm0: number; bpm1?: number; duration: number; pattern: 'four' | 'hiphop' | 'dnb' | 'break' | 'dembow' | 'funk'; pad?: boolean; hats?: number }) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const { bpm0, bpm1 = bpm0, duration, pattern } = opts;
  const out = new Float32Array(Math.round(duration * RATE));
  const beats: number[] = [], pads: number[] = [];
  let t = 0.8, i = 0;
  while (t < duration - 0.5) {
    beats.push(t);
    const beat = 60 / (bpm0 + (bpm1 - bpm0) * (t / duration));
    for (let q = 0; q < 4; q++) {
      const at = t + q * beat / 4, s = 4 * i + q, start = Math.round(at * RATE);
      const p = s % 16;
      const kick = pattern === 'four' ? q === 0 : pattern === 'dembow' ? q === 0 : pattern === 'funk' ? [0, 3, 10].includes(p) : (p === 0 || p === 10);
      const snare = pattern === 'four' ? (q === 0 && i % 2 === 1) : pattern === 'dembow' ? [3, 6, 11, 14].includes(p) : (p === 4 || p === 12);
      for (let k = 0; k < RATE * 0.25 && start + k < out.length; k++) {
        const x = k / RATE;
        let v = 0;
        if (kick) v += Math.sin(2 * Math.PI * (50 * x + 3 * (1 - Math.exp(-x / 0.03)))) * Math.exp(-x / 0.08) * 0.7;
        if (snare && x < 0.2) v += rand() * 0.5 * Math.exp(-x / 0.05) + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x / 0.04) * 0.3;
        if (pattern !== 'break') {
          if (x < 0.04) v += rand() * Math.exp(-x / 0.008) * (opts.hats ?? 0.12);
          if (pattern === 'funk' && [7, 9, 15].includes(p) && x < 0.1) v += rand() * 0.15 * Math.exp(-x / 0.03); // ghost snares
        } else {
          // jungle-style break: heavy backbeat, ghost snares, open hats, and nothing on the 16ths
          if (snare && x < 0.2) v += rand() * 0.4 * Math.exp(-x / 0.06);
          if ((s % 16 === 6 || s % 16 === 14) && x < 0.1) v += rand() * 0.2 * Math.exp(-x / 0.03);
          if (q % 2 === 0 && x < 0.12) v += rand() * (x < 0.04 ? 0.12 * Math.exp(-x / 0.008) : 0) + rand() * 0.15 * Math.exp(-x / 0.04);
        }
        out[start + k] += v;
      }
    }
    if (opts.pad && i % 8 === 0) {
      pads.push(t);
      const start = Math.round(t * RATE);
      for (let k = 0; k < RATE * beat * 2 && start + k < out.length; k++) out[start + k] += Math.sin(2 * Math.PI * 440 * k / RATE) * 0.25 * Math.min(1, k / 200);
    }
    t += beat;
    i++;
  }
  return { out, beats, pads };
}
const nearestIndex = (grid: number[], t: number) => grid.reduce((best, g, j) => (Math.abs(g - t) < Math.abs(grid[best] - t) ? j : best), 0);

test('the beat tracker follows tempo drift to within a few milliseconds', async () => {
  const { out, beats } = drums({ bpm0: 118, bpm1: 130, duration: 50, pattern: 'four' });
  const a = (await analyzeSamples(out, RATE)).analysis;
  const errors = beats.map(b => Math.abs(a.grid![nearestIndex(a.grid!, b)] - b)).sort((x, y) => x - y);
  assert.ok(errors[Math.floor(errors.length * 0.95)] < 0.008, `p95 ${errors[Math.floor(errors.length * 0.95)]}`);
  // every real beat sits on a beat step of the grid (multiple of 4 from the downbeat)
  assert.ok(beats.every(b => (nearestIndex(a.grid!, b) - a.downbeat!) % 4 === 0));
});

test('tempo is read the way people count it: 90 stays 90, DnB is 174', async () => {
  const hiphop = (await analyzeSamples(drums({ bpm0: 90, duration: 30, pattern: 'hiphop' }).out, RATE)).analysis;
  assert.ok(Math.abs(hiphop.bpm - 90) < 2, `hip-hop read as ${hiphop.bpm}`);
  const dnb = (await analyzeSamples(drums({ bpm0: 174, duration: 30, pattern: 'dnb' }).out, RATE)).analysis;
  assert.ok(Math.abs(dnb.bpm - 174) < 2, `DnB read as ${dnb.bpm}`);
});

test('fast breakbeats are not read at half speed, slow grooves stay slow', async () => {
  // real recordings that fit their half tempo just as well (both CC0, shipped in public/music)
  const decode = (await import('audio-decode')).default;
  for (const [file, bpm] of [['final-hour.mp3', 170], ['hard-boss-battle.mp3', 200]] as const) {
    const audio = await decode(readFileSync(new URL(`../public/music/${file}`, import.meta.url)));
    const a = (await analyzeSamples(audio.getChannelData(0), audio.sampleRate)).analysis;
    assert.ok(Math.abs(a.bpm - bpm) / bpm < 0.03, `${file} read as ${a.bpm}, not ${bpm}`);
  }
  // slow grooves with strong off-beats and busy 16ths are still slow
  for (const [pattern, hats] of [['dembow', 0.12], ['funk', 0.2], ['break', 0.12], ['hiphop', 0.12]] as const) {
    const a = (await analyzeSamples(drums({ bpm0: 95, duration: 30, pattern, hats }).out, RATE)).analysis;
    assert.ok(Math.abs(a.bpm - 95) < 2, `95 BPM ${pattern} read as ${a.bpm}`);
  }
});

test('the tempo can be set by hand when a song is ambiguous', async () => {
  const { out } = drums({ bpm0: 90, duration: 30, pattern: 'hiphop' });
  const doubled = (await analyzeSamples(out, RATE, undefined, { bpm: 180 })).analysis;
  assert.ok(Math.abs(doubled.bpm - 180) < 2, `read as ${doubled.bpm}`);
  assert.ok(Math.abs(doubled.grid![8] - doubled.grid![0] - 60 / 180 * 2) < 0.01, '16th grid at the new tempo');
});

test('held sounds are measured, short hits are not', async () => {
  const { out, pads, beats } = drums({ bpm0: 100, duration: 30, pattern: 'four', pad: true });
  const a = (await analyzeSamples(out, RATE)).analysis;
  const held = (t: number) => parseInt(a.sustain![nearestIndex(a.grid!, t)], 36);
  // the two-beat pad (8 steps) is measured as held for most of its length
  for (const t of pads.slice(0, -1)) assert.ok(held(t) >= 6, `pad at ${t.toFixed(2)} held ${held(t)}`);
  // plain kicks with no pad don't ring
  const kicksOnly = beats.filter(b => !pads.some(p => Math.abs(p - b) < 0.05) && !pads.some(p => b > p && b < p + 1.3));
  assert.ok(kicksOnly.filter(b => held(b) >= 4).length <= kicksOnly.length * 0.1);
});

test('imports repeat their patterns when the music repeats', async () => {
  const { out } = drums({ bpm0: 128, duration: 40, pattern: 'hiphop' });
  const song = { ...songs[0], id: 'custom-test', duration: 40, analysis: (await analyzeSamples(out, RATE)).analysis };
  const t = trackFromImport(song);
  const chart = t.charts[t.difficulty]!.notes;
  const grid = t.grid!, down = t.downbeat!;
  const bars = new Map<number, string>();
  for (const n of chart) {
    if (n.endTime !== undefined) continue;
    const j = nearestIndex(grid, n.time);
    const bar = Math.floor((j - down) / 16);
    bars.set(bar, (bars.get(bar) ?? '') + `${(j - down) % 16}:${n.chord ? 'C' : n.lane} `);
  }
  // the drum bar is identical throughout, so (ignoring the first and last bar) the lines should be too
  const patterns = [...bars].sort((x, y) => x[0] - y[0]).slice(1, -1).map(([, p]) => p);
  const most = Math.max(...[...new Set(patterns)].map(p => patterns.filter(q => q === p).length));
  assert.ok(most >= patterns.length * 0.7, `${new Set(patterns).size} different patterns over ${patterns.length} bars`);
});
