import songData from './song-data.json' with { type: 'json' };
import type { Song } from './types';

const SAMPLE_RATE = 22050;
const LEAD_IN = 0.75;
const TAU = Math.PI * 2;
type Voice = 'pad' | 'kick' | 'snare' | 'hat' | 'bass' | 'pluck';
interface Recipe {
  id: string; bpm: number; bars: number; root: number; minor: boolean;
  melody: number[]; bass: number[]; kick: number[]; seed: number;
}
interface MusicalEvent { kind: Voice; time: number; duration: number; midi: number; gain: number; seed: number }
const recipes = new Map<string, Recipe>(songData.map(record => [record.recipe.id, record.recipe]));

/** The same arrangement as scripts/generate_music.py; all hits stay on the grid. */
function* arrangement(recipe: Recipe): Generator<MusicalEvent> {
  const beat = 60 / recipe.bpm;
  const step = beat / 4;
  const hard = recipe.bpm >= 138;
  const progression = [0, 5, recipe.minor ? 3 : 4, 7];
  const event = (kind: Voice, time: number, duration: number, midi: number, gain: number, seed: number): MusicalEvent =>
    ({ kind, time, duration, midi, gain, seed: seed >>> 0 });
  for (let bar = 0; bar < recipe.bars; bar++) {
    const chord = progression[Math.floor(bar / 2) % 4];
    const middle = Math.floor(recipe.bars / 2);
    const breakdown = bar >= middle && bar < middle + 2;
    const intro = bar < 2;
    const outro = bar === recipe.bars - 1;
    for (const tone of [0, recipe.minor ? 3 : 4, 7]) {
      yield event('pad', LEAD_IN + bar * 4 * beat, 3.7 * beat,
        recipe.root + 24 + chord + tone, hard ? 0.028 : 0.04, recipe.seed + bar);
    }
    for (let slot = 0; slot < 16; slot++) {
      const index = bar * 16 + slot;
      const time = LEAD_IN + index * step;
      const seed = (recipe.seed + index * 131) >>> 0;
      if (!breakdown && !(intro && bar === 0) && !(outro && slot >= 12)) {
        if (recipe.kick.includes(slot)) yield event('kick', time, 0.26, 0, 0.58, seed);
        if (slot === 4 || slot === 12) yield event('snare', time, 0.17, 0, 0.31, seed + 7);
        if (slot % (hard ? 1 : 2) === 0) {
          const gain = slot % 4 === 2 ? 0.075 : 0.048;
          yield event('hat', time, 0.055, 0, gain * (intro ? 0.6 : 1), seed + 17);
        }
        if (hard && bar % 4 === 3 && (slot === 13 || slot === 15)) {
          yield event('snare', time, 0.105, 0, 0.12, seed + 27);
        }
      } else if (breakdown && (slot === 2 || slot === 10)) {
        yield event('hat', time, 0.06, 0, 0.04, seed + 17);
      }
      const bass = recipe.bass[slot];
      if (bass >= 0 && !(breakdown && slot % 8 !== 0)) {
        yield event('bass', time, step * (hard ? 1.45 : 1.8),
          recipe.root + chord + bass, hard ? 0.19 : 0.16, seed);
      }
      const melody = recipe.melody[(slot + (bar % 8 >= 4 ? 8 : 0)) % 16];
      if (melody >= 0 && !(intro && slot % 4 !== 0) && !(outro && slot >= 8)) {
        yield event('pluck', time, step * (breakdown ? 2.7 : 1.65),
          recipe.root + 24 + chord + melody, hard ? 0.09 : 0.115, seed);
      }
    }
  }
}

function noise(index: number, seed: number): number {
  let x = (index + seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 2147483648 - 1;
}

function voiceSamples(event: MusicalEvent): Float64Array {
  const { kind, duration, midi, seed } = event;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const samples = new Float64Array(length);
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let signal: number;
    if (kind === 'kick') {
      const phase = TAU * (52 * t + 104 * 0.025 * (1 - Math.exp(-t / 0.025)));
      signal = Math.sin(phase) * Math.exp(-t / 0.07);
    } else if (kind === 'snare' || kind === 'hat') {
      const value = noise(i, seed);
      signal = kind === 'snare'
        ? (value * 0.75 + Math.sin(TAU * 185 * t) * 0.25) * Math.exp(-t / 0.035)
        : (value - previous * 0.82) * Math.exp(-t / 0.012);
      previous = value;
    } else {
      const phase = TAU * frequency * t;
      if (kind === 'bass') {
        signal = (Math.sin(phase) + 0.24 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase))
          * Math.min(t / 0.003, 1) * Math.exp(-t / (duration * 0.5));
      } else if (kind === 'pluck') {
        signal = (Math.sin(phase) + 0.38 * Math.sin(2 * phase) + 0.17 * Math.sin(3 * phase))
          * Math.min(t / 0.002, 1) * Math.exp(-t / (duration * 0.31));
      } else {
        signal = (Math.sin(phase) + 0.17 * Math.sin(2 * phase))
          * Math.min(t / 0.075, 1) * Math.min((duration - t) / 0.15, 1);
      }
    }
    samples[i] = signal * Math.min((duration - t) / 0.009, 1);
  }
  return samples;
}

/** Render the compact score to real audio. No network request or sample pack. */
export async function renderSong(song: Song, ctx: AudioContext): Promise<AudioBuffer> {
  const recipe = recipes.get(song.id);
  if (!recipe) throw new Error(`No original composition found for ${song.id}`);
  // Let the loading screen paint before starting the deterministic rendering.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const duration = LEAD_IN + recipe.bars * 4 * 60 / recipe.bpm + 0.5;
  const mix = new Float64Array(Math.ceil(duration * SAMPLE_RATE));
  const cache = new Map<string, Float64Array>();
  let rendered = 0;
  for (const event of arrangement(recipe)) {
    const noisy = event.kind === 'hat' || event.kind === 'snare';
    const key = `${event.kind}:${event.duration}:${event.midi}:${noisy ? event.seed : 0}`;
    let samples = cache.get(key);
    if (!samples) {
      samples = voiceSamples(event);
      if (!noisy) cache.set(key, samples);
    }
    const start = Math.round(event.time * SAMPLE_RATE);
    const length = Math.min(samples.length, mix.length - start);
    for (let i = 0; i < length; i++) mix[start + i] += samples[i] * event.gain;
    // Yield occasionally on small devices so the interface remains responsive.
    if (++rendered % 200 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const buffer = ctx.createBuffer(1, mix.length, SAMPLE_RATE);
  const pcm = buffer.getChannelData(0);
  const tail = Math.min(mix.length, Math.round(SAMPLE_RATE * 0.65));
  for (let i = 0; i < mix.length; i++) {
    const fade = i >= mix.length - tail ? (mix.length - 1 - i) / (tail - 1) : 1;
    pcm[i] = Math.tanh(mix[i] * 1.45) * 0.78 * fade;
  }
  return buffer;
}
