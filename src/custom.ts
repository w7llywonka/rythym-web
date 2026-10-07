import type { Analysis, Song } from './types.ts';

const FFT_SIZE = 1024;
const ANALYSIS_RATE = 22050;
const TAU = Math.PI * 2;
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Progress = (text: string) => void;
export interface SampleAnalysis { analysis: Analysis; detectedBpm: number; warning?: string }
export interface ImportedSong extends SampleAnalysis { song: Song; buffer: AudioBuffer }

const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * i / (FFT_SIZE - 1)));
const reversed = Uint16Array.from({ length: FFT_SIZE }, (_, index) => {
  let value = index, reverse = 0;
  for (let i = 0; i < 10; i++) { reverse = (reverse << 1) | (value & 1); value >>>= 1; }
  return reverse;
});
const cosine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos(TAU * i / FFT_SIZE));
const sine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => -Math.sin(TAU * i / FFT_SIZE));

function fft(samples: Float32Array, start: number, real: Float64Array, imaginary: Float64Array) {
  imaginary.fill(0);
  for (let i = 0; i < FFT_SIZE; i++) real[reversed[i]] = samples[start + i] * hann[i];
  for (let length = 2; length <= FFT_SIZE; length *= 2) {
    const half = length / 2, stride = FFT_SIZE / length;
    for (let start = 0; start < FFT_SIZE; start += length) {
      for (let i = 0; i < half; i++) {
        const a = start + i, b = a + half, twiddle = i * stride;
        const re = real[b] * cosine[twiddle] - imaginary[b] * sine[twiddle];
        const im = real[b] * sine[twiddle] + imaginary[b] * cosine[twiddle];
        real[b] = real[a] - re; imaginary[b] = imaginary[a] - im;
        real[a] += re; imaginary[a] += im;
      }
    }
  }
}

function percentile(values: Float32Array, percentile: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort();
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
}

function resample(samples: Float32Array, rate: number): Float32Array {
  if (rate === ANALYSIS_RATE) return samples;
  const output = new Float32Array(Math.floor(samples.length * ANALYSIS_RATE / rate));
  const ratio = rate / ANALYSIS_RATE;
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio, left = Math.floor(position), fraction = position - left;
    output[i] = samples[left] * (1 - fraction) + (samples[Math.min(left + 1, samples.length - 1)] ?? 0) * fraction;
  }
  return output;
}

/** Analyze actual local PCM. FFT 1024 / ~10 ms hop, three onset bands.
 * Tempo: autocorrelation 67–214 BPM, then ±4% phase-fold refinement in 0.02 BPM
 * increments. Tempo estimation uses at most the first 120 seconds; chart band
 * strengths and grid fit use the entire track. Work yields between chunks.
 */
export async function analyzeSamples(input: Float32Array, inputRate: number, onProgress: Progress = () => {}): Promise<SampleAnalysis> {
  if (!Number.isFinite(inputRate) || inputRate < 8000 || input.length < FFT_SIZE) {
    throw new Error('This audio does not contain enough usable samples.');
  }
  const samples = resample(input, inputRate);
  const hop = Math.round(ANALYSIS_RATE * 0.01);
  const dt = hop / ANALYSIS_RATE;
  const frameCount = Math.floor((samples.length - FFT_SIZE) / hop) + 1;
  const bands = [new Float32Array(frameCount), new Float32Array(frameCount), new Float32Array(frameCount)];
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
  const previous = new Float64Array(FFT_SIZE / 2 + 1);
  const binBand = new Int8Array(FFT_SIZE / 2 + 1).fill(-1);
  const bandBins = [0, 0, 0];
  for (let bin = 0; bin < binBand.length; bin++) {
    const hz = bin * ANALYSIS_RATE / FFT_SIZE;
    const band = hz < 30 ? -1 : hz < 250 ? 0 : hz < 2500 ? 1 : 2;
    binBand[bin] = band;
    if (band >= 0) bandBins[band]++;
  }
  for (let frame = 0; frame < frameCount; frame++) {
    fft(samples, frame * hop, real, imaginary);
    for (let bin = 0; bin < previous.length; bin++) {
      const magnitude = Math.log1p(1000 * Math.hypot(real[bin], imaginary[bin]) / FFT_SIZE);
      const difference = Math.max(0, magnitude - previous[bin]);
      if (frame && binBand[bin] >= 0) bands[binBand[bin]][frame] += difference / bandBins[binBand[bin]];
      previous[bin] = magnitude;
    }
    if (frame % 128 === 0) {
      onProgress(`Finding the beats… ${Math.round(frame / frameCount * 100)}%`);
      await yieldToBrowser();
    }
  }
  for (const band of bands) {
    let previous = band[0];
    for (let i = 0; i < band.length; i++) {
      const current = band[i];
      band[i] = previous * 0.2 + current * 0.6 + (band[i + 1] ?? 0) * 0.2;
      previous = current;
    }
  }
  const combined = new Float32Array(frameCount);
  for (const band of bands) {
    const scale = Math.max(1e-7, percentile(band, 0.95));
    for (let i = 0; i < frameCount; i++) combined[i] += band[i] / scale;
  }
  let total = 0;
  for (const value of combined) total += value;
  if (total < 0.01) throw new Error('No audible beat was found. Please choose a music recording.');
  onProgress('Measuring tempo…');
  await yieldToBrowser();
  const tempoFrames = Math.min(frameCount, Math.round(120 / dt));
  let mean = 0;
  for (let i = 0; i < tempoFrames; i++) mean += combined[i] / tempoFrames;
  const centered = Float32Array.from(combined.subarray(0, tempoFrames), value => value - mean);
  const correlation = (lag: number) => {
    let sum = 0;
    for (let i = lag; i < tempoFrames; i++) sum += centered[i] * centered[i - lag];
    return sum / Math.max(1, tempoFrames - lag);
  };
  let bestLag = 0, bestCorrelation = -Infinity;
  for (let lag = Math.round(60 / 214 / dt); lag <= Math.round(60 / 67 / dt); lag++) {
    const score = correlation(lag) + 0.3 * correlation(lag * 2);
    if (score > bestCorrelation) { bestCorrelation = score; bestLag = lag; }
  }
  const initialBpm = 60 / (bestLag * dt);
  const fold = (bpm: number, limit = tempoFrames) => {
    const bins = new Float64Array(128);
    for (let i = 0; i < limit; i++) {
      const time = i * dt + FFT_SIZE / 2 / ANALYSIS_RATE;
      const phase = (time * bpm / 60) % 1;
      bins[Math.min(127, Math.floor(phase * 128))] += combined[i];
    }
    let peak = 0, maximum = -Infinity, average = 0;
    for (let i = 0; i < 128; i++) {
      const value = bins[i] + 0.7 * (bins[(i + 127) % 128] + bins[(i + 1) % 128])
        + 0.15 * (bins[(i + 126) % 128] + bins[(i + 2) % 128]);
      average += value / 128;
      if (value > maximum) { maximum = value; peak = i; }
    }
    return { score: maximum / Math.max(1e-7, average), peak };
  };
  let detectedBpm = initialBpm, bestFold = -Infinity, count = 0;
  for (let bpm = initialBpm * 0.96; bpm <= initialBpm * 1.04; bpm += 0.02) {
    const score = fold(bpm).score;
    if (score > bestFold) { bestFold = score; detectedBpm = bpm; }
    if (++count % 64 === 0) await yieldToBrowser();
  }
  detectedBpm = Math.round(detectedBpm * 100) / 100;
  // Half-time detection is common in fast electronic tracks. The imported
  // challenge uses a double-time grid below 105; the raw estimate is returned.
  const bpm = detectedBpm < 105 ? detectedBpm * 2 : detectedBpm;
  const phase = fold(bpm, frameCount).peak;
  const offset = (phase + 0.5) / 128 * 60 / bpm;
  const step = 60 / bpm / 4;
  const duration = samples.length / ANALYSIS_RATE;
  const gridLength = Math.max(1, Math.floor((duration - offset) / step));
  onProgress('Building your fast chart…');
  await yieldToBrowser();
  const strengths: string[] = [];
  for (const band of bands) {
    const positive = band.filter(value => value > 0);
    const reference = Math.max(1e-7, percentile(positive, 0.88));
    const encoded: string[] = [];
    for (let index = 0; index < gridLength; index++) {
      const time = offset + index * step;
      const first = Math.max(0, Math.floor((time - 0.027 - FFT_SIZE / 2 / ANALYSIS_RATE) / dt));
      const last = Math.min(frameCount - 1, Math.ceil((time + 0.038 - FFT_SIZE / 2 / ANALYSIS_RATE) / dt));
      let strength = 0;
      for (let frame = first; frame <= last; frame++) strength = Math.max(strength, band[frame]);
      const center = Math.round((time - FFT_SIZE / 2 / ANALYSIS_RATE) / dt);
      // Four-second loudness windows keep quieter sections playable.
      const local = band.subarray(Math.max(0, center - Math.round(2 / dt)), Math.min(frameCount, center + Math.round(2 / dt)));
      const sortedLocal = Float32Array.from(local).sort();
      const at = (q: number) => sortedLocal[Math.min(sortedLocal.length - 1, Math.floor((sortedLocal.length - 1) * q))] ?? 0;
      const localReference = at(0.92);
      // subtract the section's background level so steady texture (pads, hats, reverb) doesn't
      // read as hits, and only lift quiet sections partway
      const floor = at(0.6);
      const normalizer = Math.max(reference * 0.5, localReference * 0.9, 1e-7);
      const above = Math.max(0, strength - floor * 0.8);
      encoded.push(String(Math.min(9, Math.max(0, Math.round(above / normalizer * 6.5)))));
      if (index % 512 === 0) await yieldToBrowser();
    }
    strengths.push(encoded.join(''));
  }
  let onGrid = 0;
  for (let i = 0; i < combined.length; i++) {
    const time = i * dt + FFT_SIZE / 2 / ANALYSIS_RATE;
    const nearest = Math.round((time - offset) / step) * step + offset;
    // A narrower validation window keeps random/swinging onsets from passing
    // simply because a fast sixteenth grid covers most of the timeline.
    if (Math.abs(time - nearest) <= Math.min(0.025, step * 0.3)) onGrid += combined[i];
  }
  const gridFit = onGrid / total;
  const warning = gridFit < 0.68
    ? 'This recording has loose or changing timing. The generated chart may need a different BPM or offset.'
    : undefined;
  const analysis: Analysis = { bpm, offset, low: strengths[0], mid: strengths[1], high: strengths[2], gridFit };
  onProgress('Your custom challenge is ready.');
  return { analysis, detectedBpm, ...(warning ? { warning } : {}) };
}

/** Decode and chart a user-selected recording locally. Nothing is uploaded. */
export async function importSong(file: File, ctx: AudioContext, onProgress: Progress = () => {}): Promise<ImportedSong> {
  if (file.size <= 0) throw new Error('This file is empty. Please choose an audio recording.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose an audio file smaller than 40 MB.');
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm|mp4|aiff?|caf)$/i.test(file.name)) {
    throw new Error('Please choose an audio file such as MP3, WAV, M4A, or OGG.');
  }
  onProgress('Opening your recording…');
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
  let buffer: AudioBuffer;
  try { buffer = await ctx.decodeAudioData(bytes); }
  catch { throw new Error('Your browser could not read this recording. Try an MP3 or WAV file.'); }
  if (!Number.isFinite(buffer.duration) || buffer.duration < 10 || buffer.duration > 15 * 60) {
    throw new Error('Choose a recording between 10 seconds and 15 minutes long.');
  }
  // Analyze a low-rate mono copy; retain the original buffer for playback.
  const length = Math.floor(buffer.duration * ANALYSIS_RATE);
  const mono = new Float32Array(length);
  const ratio = buffer.sampleRate / ANALYSIS_RATE;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < length; i++) {
    const position = i * ratio, left = Math.floor(position), fraction = position - left;
    for (const channel of channels) mono[i] += (channel[left] * (1 - fraction) + (channel[Math.min(left + 1, channel.length - 1)] ?? 0) * fraction) / channels.length;
    if (i % (ANALYSIS_RATE * 8) === 0) await yieldToBrowser();
  }
  const result = await analyzeSamples(mono, ANALYSIS_RATE, onProgress);
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 100) || 'Custom challenge';
  const seed = new DataView(digest.buffer).getUint32(0, false) || 1;
  const song: Song = {
    id: `custom-${hash}`, title,
    artist: /waste[\s_-]*my[\s_-]*time/i.test(title) ? 'kevinhilfiger · your recording' : 'Your custom recording',
    genre: 'Custom challenge', bpm: result.analysis.bpm, duration: buffer.duration,
    difficulty: 'Hard', level: 10, color: '#FFD25A', color2: '#FF4FA0',
    audio: `local:custom-${hash}`, previewStart: Math.min(20, Math.max(0, buffer.duration / 3)),
    seed, analysis: result.analysis,
  };
  return { song, buffer, ...result };
}
