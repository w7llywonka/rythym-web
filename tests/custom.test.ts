import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(tierAt(100), 'Easy');
  assert.equal(tierAt(130), 'Hard');
  assert.equal(tierAt(160), 'Expert');
  assert.equal(tierAt(180), 'Extreme');
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
