import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSamples, importSong } from '../src/custom.ts';
import { trackFromImport, trackFromSong } from '../src/tracks.ts';
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

// ---- the vocal layer ----------------------------------------------------------------------------
/** a sung line: notes with harmonics, two formants and vibrato, in a rhythm that doesn't repeat each bar */
function voice(opts: { bpm: number; duration: number; from: number; seed?: number }) {
  let seed = opts.seed ?? 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const out = new Float32Array(Math.round(opts.duration * RATE));
  const step = 60 / opts.bpm / 4;
  const scale = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
  const notes: { t: number; midi: number }[] = [];
  let s = Math.round((opts.from - 0.8) / step), deg = 4;
  while (0.8 + s * step < opts.duration - 1.5) {
    const len = [2, 3, 4, 6][Math.floor(rnd() * 4)];
    deg = Math.min(scale.length - 1, Math.max(0, deg + [-2, -1, 1, 2][Math.floor(rnd() * 4)]));
    const t = 0.8 + s * step, midi = scale[deg];
    notes.push({ t, midi });
    const f0 = 440 * 2 ** ((midi - 69) / 12), dur = len * step * 0.9;
    let phase = 0;
    for (let k = 0, start = Math.round(t * RATE); k < dur * RATE && start + k < out.length; k++) {
      const x = k / RATE;
      const vib = x > 0.15 ? 2 ** (0.25 * Math.sin(2 * Math.PI * 5.5 * x) / 12) : 1;
      phase += 2 * Math.PI * f0 * vib / RATE;
      const env = Math.min(1, x / 0.015) * (0.75 + 0.25 * Math.exp(-x / 0.08)) * Math.min(1, (dur - x) / 0.03);
      let v = 0;
      for (let h = 1; h <= 14; h++) {
        const hz = h * f0;
        if (hz > 5000) break;
        const formant = 1 + 3 * Math.exp(-(((hz - 700) / 250) ** 2)) + 2 * Math.exp(-(((hz - 2600) / 400) ** 2));
        v += Math.sin(h * phase) * formant / h;
      }
      out[start + k] += v * env * 0.12;
    }
    s += len + (rnd() < 0.3 ? 1 : 0); // a rest now and then, so bars differ
  }
  return { out, notes };
}

test('the vocal layer finds sung notes over a beat, with their pitch, and not the drums', async () => {
  const bpm = 100, duration = 48;
  const beat = drums({ bpm0: bpm, duration, pattern: 'hiphop' });
  const sung = voice({ bpm, duration, from: 0.8 + 4 * 2.4 });
  const mix = beat.out.map((v, i) => v + sung.out[i]);
  const a = (await analyzeSamples(mix, RATE)).analysis;
  assert.ok(a.vocal && a.pitch, 'vocal layer stored');
  assert.equal(a.vocal.length, a.low.length);
  const at = (t: number) => nearestIndex(a.grid!, t);
  const found = sung.notes.filter(n => +a.vocal![at(n.t)] >= 5);
  assert.ok(found.length >= sung.notes.length * 0.6, `${found.length} of ${sung.notes.length} sung notes found`);
  // the first four bars are drums only: nothing strong there
  const intro = [...a.vocal.slice(0, at(sung.notes[0].t) - 2)].filter(d => +d >= 5).length;
  assert.ok(intro <= 2, `${intro} strong vocal steps in the drum intro`);
  // pitch: right note (or octave) for most found notes
  const pitched = found.filter(n => {
    const code = a.pitch!.charCodeAt(at(n.t));
    return code >= 64 && (code - 64 + 40 - n.midi) % 12 === 0;
  });
  assert.ok(pitched.length >= found.length * 0.6, `${pitched.length} of ${found.length} found notes pitched right`);
});

test('Extreme charts of a sung song follow the voice, moving with the melody', async () => {
  const bpm = 100, duration = 48;
  const beat = drums({ bpm0: bpm, duration, pattern: 'hiphop' });
  const sung = voice({ bpm, duration, from: 0.8 + 4 * 2.4, seed: 5 });
  const mix = beat.out.map((v, i) => v + sung.out[i]);
  const song = { ...songs[0], id: 'custom-sung', duration, analysis: (await analyzeSamples(mix, RATE)).analysis };
  const t = trackFromSong({ ...song, difficulty: 'Extreme' }, { difficulty: 'Extreme', custom: true });
  const notes = t.charts.Extreme!.notes;
  const onNote = (time: number) => notes.find(n => Math.abs(n.time - time) < 0.03);
  const charted = sung.notes.filter(n => onNote(n.t));
  assert.ok(charted.length >= sung.notes.length * 0.6, `${charted.length} of ${sung.notes.length} sung notes charted`);
  // consecutive charted sung notes: up the scale -> Button 2, down -> Button 1
  let agree = 0, moves = 0;
  for (let i = 1; i < sung.notes.length; i++) {
    const prev = sung.notes[i - 1], cur = sung.notes[i];
    const n = onNote(cur.t);
    if (!n || n.chord || !onNote(prev.t) || cur.midi === prev.midi) continue;
    moves++;
    if (n.lane === (cur.midi > prev.midi ? 2 : 1)) agree++;
  }
  assert.ok(moves >= 10 && agree >= moves * 0.65, `${agree} of ${moves} melody moves on the matching button`);
});

test('the vocal layer favours the centre: a hard-panned line is not the voice', async () => {
  const bpm = 100, duration = 48;
  const beat = drums({ bpm0: bpm, duration, pattern: 'hiphop' });
  const centre = voice({ bpm, duration, from: 0.8 + 4 * 2.4, seed: 3 });
  const left = voice({ bpm, duration, from: 0.8 + 4 * 2.4, seed: 99 });
  // drums and voice in the middle, the other line only in the left channel
  const L = beat.out.map((v, i) => v + centre.out[i] + left.out[i]), R = beat.out.map((v, i) => v + centre.out[i]);
  const mono = L.map((v, i) => (v + R[i]) / 2), side = L.map((v, i) => (v - R[i]) / 2);
  const a = (await analyzeSamples(mono, RATE, undefined, { side })).analysis;
  const strong = (ts: { t: number }[]) => ts.filter(n => +a.vocal![nearestIndex(a.grid!, n.t)] >= 5).length / ts.length;
  const leftOnly = left.notes.filter(n => !centre.notes.some(c => Math.abs(c.t - n.t) < 0.2));
  assert.ok(strong(centre.notes) >= 0.5, `centre voice: ${strong(centre.notes)}`);
  assert.ok(strong(leftOnly) <= strong(centre.notes) / 2, `panned line: ${strong(leftOnly)} vs centre ${strong(centre.notes)}`);
});

test('stereo imports give the vocal layer both channels', async () => {
  const bpm = 100, duration = 30;
  const beat = drums({ bpm0: bpm, duration, pattern: 'hiphop' });
  const sung = voice({ bpm, duration, from: 0.8 + 4 * 2.4 });
  const left = beat.out.map((v, i) => v + sung.out[i]), right = Float32Array.from(left);
  const buffer = {
    duration, sampleRate: RATE, numberOfChannels: 2,
    getChannelData: (c: number) => (c === 0 ? left : right),
  } as unknown as AudioBuffer;
  const context = { async decodeAudioData() { return buffer; } } as unknown as AudioContext;
  const imported = await importSong(new File(['stereo bytes'], 'Sung.wav', { type: 'audio/wav' }), context);
  const a = imported.song.analysis;
  assert.ok(a.vocal && [...a.vocal].some(d => +d >= 5), 'the centred voice is found');
  assert.equal(a.pitch?.length, a.low.length);
});
