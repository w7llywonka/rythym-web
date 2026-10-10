import { gridFromBeats, roundBeats } from './beatgrid.ts';
import type { Analysis, Song } from './types.ts';

const FFT_SIZE = 1024;
const ANALYSIS_RATE = 22050;
const HOP = 220; // ~10 ms
const DT = HOP / ANALYSIS_RATE;
const FRAME_CENTER = FFT_SIZE / 2 / ANALYSIS_RATE;
const ONSET_SHIFT = 0.003; // calibrated against synthetic hits at known times (tests/custom.test.ts)
const BAND_EDGES = [30, 160, 1200, 5000, 11025]; // kick | body | presence | air
const SUSTAIN_DROP = Math.log(2.8); // a held sound ends once it is ~9 dB below its attack
const TOP = 5; // strongest mid-range bins kept per frame for following held notes
// the vocal / lead-melody layer looks at 120 Hz - 4 kHz (sung fundamentals up to the main formants)
const VOCAL_LO = Math.round(120 * FFT_SIZE / ANALYSIS_RATE), VOCAL_HI = Math.round(4000 * FFT_SIZE / ANALYSIS_RATE);
const VOCAL_BINS = VOCAL_HI - VOCAL_LO + 1;
const BIN_HZ = ANALYSIS_RATE / FFT_SIZE;
const VOCAL_PRESENT = 0.2; // share of the band a sung onset holds (below: weaker)
const TAU = Math.PI * 2;
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));
type Progress = (text: string) => void;
export interface SampleAnalysis { analysis: Analysis; detectedBpm: number; warning?: string }
export interface AnalyzeOptions {
  /** chart at this tempo instead of detecting it */
  bpm?: number;
  /** the stereo difference (L - R) / 2, same rate as the input: lets the vocal layer favour the centre */
  side?: Float32Array;
  /** for evaluation tools: the vocal onsets found, in seconds */
  debug?: (d: { vocalOnsets: { t: number; digit: number }[] }) => void;
}
export interface ImportedSong extends SampleAnalysis { song: Song; buffer: AudioBuffer }

const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * i / (FFT_SIZE - 1)));
const reversed = Uint16Array.from({ length: FFT_SIZE }, (_, index) => {
  let value = index, reverse = 0;
  for (let i = 0; i < 10; i++) { reverse = (reverse << 1) | (value & 1); value >>>= 1; }
  return reverse;
});
const cosine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos(TAU * i / FFT_SIZE));
const sine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => -Math.sin(TAU * i / FFT_SIZE));

/** windowed FFT of `samples` from `start`; with `second`, both at once (one as the real, one as the imaginary input) */
function fft(samples: Float32Array, start: number, real: Float64Array, imaginary: Float64Array, second?: Float32Array) {
  for (let i = 0; i < FFT_SIZE; i++) {
    real[reversed[i]] = samples[start + i] * hann[i];
    imaginary[reversed[i]] = second ? second[start + i] * hann[i] : 0;
  }
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

/** Analyze actual local PCM into a beat-tracked onset grid.
 *
 * 1. STFT (1024 / ~10 ms hop) -> spectral flux in four bands: kick (30-160 Hz), body (160-1200),
 *    presence (1.2-5 kHz) and air (5-11 kHz), plus tonal energy for detecting held sounds.
 * 2. Tempo: autocorrelation of the onset envelope, weighted by a musical prior around 115 BPM so
 *    half / double time are resolved the way people count it.
 * 3. Beats: dynamic-programming beat tracker (Ellis 2007) that follows tempo drift, then each beat
 *    is split into four 16th-note steps. The downbeat is the beat phase with the most kick.
 * 4. Onsets are peak-picked per band and each lands on exactly one step, with strength 0-9
 *    (lightly compensated for quiet sections). Held sounds (808s, vocals, leads) give each step
 *    a sustain length, and every step gets the section's energy.
 * 5. Vocals: the centre of the stereo mix (where lead vocals sit) in 120 Hz-4 kHz, minus what
 *    repeats from bar to bar (the backing: REPET on the beat grid), minus what's percussive (median
 *    filtering, Fitzgerald 2010). Onsets of what's left are sung syllables and notes (SuperFlux, so
 *    vibrato doesn't count as a new note); each gets a strength, a pitch and how long it's held.
 *    Measured on a cappellas mixed over beats, this finds about twice as many sung syllables (over
 *    chance) as following the drum bands did.
 */
export async function analyzeSamples(input: Float32Array, inputRate: number, onProgress: Progress = () => {}, opts: AnalyzeOptions = {}): Promise<SampleAnalysis> {
  if (!Number.isFinite(inputRate) || inputRate < 8000 || input.length < FFT_SIZE) {
    throw new Error('This audio does not contain enough usable samples.');
  }
  const samples = resample(input, inputRate);
  const side = opts.side && opts.side.length === input.length ? resample(opts.side, inputRate) : null;
  const duration = samples.length / ANALYSIS_RATE;
  const frameCount = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
  const frameTime = (f: number) => f * DT + FRAME_CENTER + ONSET_SHIFT;

  // ---- 1. spectral flux per band + tonal energy -------------------------------------------
  const flux = BAND_EDGES.slice(1).map(() => new Float32Array(frameCount));
  // strongest bins per frame: 1 in the bass (808s), TOP in 160-2500 Hz (vocals, leads, pads)
  const lowBin = new Uint16Array(frameCount), lowMag = new Float32Array(frameCount);
  const midBins = new Uint16Array(frameCount * TOP), midMags = new Float32Array(frameCount * TOP);
  const lowRange = [Math.ceil(30 * FFT_SIZE / ANALYSIS_RATE), Math.floor(160 * FFT_SIZE / ANALYSIS_RATE)];
  const midRange = [lowRange[1] + 1, Math.floor(2500 * FFT_SIZE / ANALYSIS_RATE)];
  const rms = new Float32Array(frameCount);
  const binBand = new Int8Array(FFT_SIZE / 2 + 1).fill(-1);
  const bandBins = new Array(flux.length).fill(0);
  for (let bin = 0; bin < binBand.length; bin++) {
    const hz = bin * ANALYSIS_RATE / FFT_SIZE;
    for (let b = 0; b < flux.length; b++) if (hz >= BAND_EDGES[b] && hz < BAND_EDGES[b + 1]) { binBand[bin] = b; bandBins[b]++; }
  }
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
  const packedReal = new Float64Array(FFT_SIZE), packedImaginary = new Float64Array(FFT_SIZE);
  // the vocal band, weighted towards the centre of the stereo image (magnitude, frames x bins)
  const vocalSpec = new Float32Array(frameCount * VOCAL_BINS);
  const bins = FFT_SIZE / 2 + 1;
  // compare against the frame two hops back: sharper attacks, less smearing from slow swells
  const history = [new Float64Array(bins), new Float64Array(bins)];
  for (let frame = 0; frame < frameCount; frame++) {
    if (side) {
      // mid and side in one transform, then pulled apart: X[k] = (Z[k] + Z*[N-k]) / 2, Y[k] = (Z[k] - Z*[N-k]) / 2i
      fft(samples, frame * HOP, packedReal, packedImaginary, side);
      for (let bin = 0; bin < bins; bin++) {
        const n = (FFT_SIZE - bin) % FFT_SIZE;
        real[bin] = (packedReal[bin] + packedReal[n]) / 2;
        imaginary[bin] = (packedImaginary[bin] - packedImaginary[n]) / 2;
      }
    } else fft(samples, frame * HOP, real, imaginary);
    for (let k = 0; k < VOCAL_BINS; k++) {
      const bin = VOCAL_LO + k, n = FFT_SIZE - bin;
      const mid2 = real[bin] ** 2 + imaginary[bin] ** 2;
      // centre-ness: 1 where left and right agree (mid >> side), 0 for wide or one-sided sounds
      let centre = 1;
      if (side) {
        const side2 = ((packedImaginary[bin] + packedImaginary[n]) ** 2 + (packedReal[bin] - packedReal[n]) ** 2) / 4;
        centre = Math.max(0, (mid2 - side2) / (mid2 + side2 + 1e-12));
      }
      vocalSpec[frame * VOCAL_BINS + k] = 1000 * Math.sqrt(mid2) / FFT_SIZE * centre;
    }
    const back = history[frame % 2];
    let lb = 0, lm = -Infinity;
    const top = new Array(TOP).fill(-Infinity), topBin = new Array(TOP).fill(0);
    for (let bin = 0; bin < bins; bin++) {
      const linear = Math.sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) / FFT_SIZE;
      const magnitude = Math.log1p(1000 * linear);
      const b = binBand[bin];
      if (b >= 0) {
        if (frame >= 2) flux[b][frame] += Math.max(0, magnitude - back[bin]) / bandBins[b];
      }
      if (bin >= lowRange[0] && bin <= lowRange[1]) { if (magnitude > lm) { lm = magnitude; lb = bin; } }
      else if (bin >= midRange[0] && bin <= midRange[1] && magnitude > top[TOP - 1]) {
        let k = TOP - 1;
        while (k > 0 && magnitude > top[k - 1]) { top[k] = top[k - 1]; topBin[k] = topBin[k - 1]; k--; }
        top[k] = magnitude; topBin[k] = bin;
      }
      back[bin] = magnitude;
    }
    lowBin[frame] = lb; lowMag[frame] = lm;
    for (let k = 0; k < TOP; k++) { midBins[frame * TOP + k] = topBin[k]; midMags[frame * TOP + k] = top[k]; }
    let energy = 0;
    for (let i = frame * HOP; i < frame * HOP + HOP && i < samples.length; i++) energy += samples[i] * samples[i];
    rms[frame] = Math.sqrt(energy / HOP);
    if (frame % 256 === 0) {
      onProgress(`Finding the beats… ${Math.round(frame / frameCount * 100)}%`);
      await yieldToBrowser();
    }
  }
  const bandScale = flux.map(band => Math.max(1e-7, percentile(band, 0.95)));
  flux.forEach((band, b) => { for (let i = 0; i < band.length; i++) band[i] /= bandScale[b]; });

  // onset envelope: weighted band sum, minus its local average, half-wave rectified
  const weights = [1, 1, 0.8, 0.6];
  const raw = new Float32Array(frameCount);
  for (let b = 0; b < flux.length; b++) for (let i = 0; i < frameCount; i++) raw[i] += flux[b][i] * weights[b];
  let total = 0;
  for (const value of raw) total += value;
  if (!(total > 0.01) || percentile(rms, 0.9) < 1e-4) throw new Error('No audible beat was found. Please choose a music recording.');
  const odf = subtractLocalMean(raw, Math.round(0.4 / DT));

  // ---- 2. tempo ---------------------------------------------------------------------------
  onProgress('Measuring tempo…');
  await yieldToBrowser();
  // several candidate tempos (autocorrelation peaks + their double / half) are each beat-tracked
  // and scored by how much of the song's onset energy their 16th grid explains, times a prior.
  // This settles half / double time and doesn't get fooled by triplet hi-hats.
  const odfPeaks = pickPeaks(odf);
  let best = { score: -Infinity, bpm: 0, beats: [] as number[] };
  for (const candidate of opts.bpm ? [] : tempoCandidates(odf)) {
    const beatsTried = trackBeats(odf, 60 / candidate / DT);
    const fit = sixteenthFit(odfPeaks, beatsTried);
    const score = fit ** 4 * tempoPrior(candidate);
    if (score > best.score) best = { score, bpm: candidate, beats: beatsTried };
    await yieldToBrowser();
  }
  // half-time check: fast breakbeat / DnB / hardcore often fits the half tempo just as well (its 16th
  // grid is the real 8ths). Read at half speed it has a telltale shape: the off-beats hit almost as
  // hard as the beats, the 16ths in between are busy, kicks land on those 16ths and snares on the
  // off-beats (the real backbeat). Slow grooves (hip-hop, funk, R&B, reggaeton) keep their kicks on
  // the beats and 8ths, so they stay slow. Ambiguous songs can be fixed by hand (`opts.bpm`).
  if (opts.bpm) {
    best = { score: 0, bpm: opts.bpm, beats: trackBeats(odf, 60 / opts.bpm / DT) };
  } else if (best.bpm * 2 <= 210) {
    const band = (bands: number[]) => {
      const x = new Float32Array(frameCount);
      for (const b of bands) for (let i = 0; i < frameCount; i++) x[i] += flux[b][i];
      return x;
    };
    const all = subdivisionStrength(odf, best.beats);
    const kick = subdivisionStrength(band([0]), best.beats), snare = subdivisionStrength(band([1, 2]), best.beats);
    if (all.half >= 0.6 && all.quarter >= 0.5 && kick.quarter >= 0.6 && snare.half >= 0.6) {
      best = { score: best.score, bpm: best.bpm * 2, beats: trackBeats(odf, 60 / (best.bpm * 2) / DT) };
    }
  }

  // ---- 3. beats -> 16th-note grid ---------------------------------------------------------
  onProgress('Following the beat…');
  await yieldToBrowser();
  const beatFrames = best.beats;
  let beats = beatFrames.map(frameTime);
  // trim beats in leading / trailing silence, then extend at the tempo so the grid covers the song
  const loud = percentile(rms, 0.95);
  const firstSound = frameTime(Math.max(0, rms.findIndex(v => v > loud * 0.05)));
  let lastSoundFrame = frameCount - 1;
  while (lastSoundFrame > 0 && rms[lastSoundFrame] <= loud * 0.05) lastSoundFrame--;
  const lastSound = frameTime(lastSoundFrame);
  beats = beats.filter(t => t >= firstSound - 0.2 && t <= lastSound + 0.2);
  if (beats.length < 4) throw new Error('No steady beat was found. Please choose a music recording.');
  const lead = median(diffs(beats.slice(0, 9))), tail = median(diffs(beats.slice(-9)));
  while (beats[0] - lead > Math.max(0.05, firstSound - lead)) beats.unshift(beats[0] - lead);
  while (beats[beats.length - 1] + tail < duration - 0.05) beats.push(beats[beats.length - 1] + tail);
  const intervals = diffs(beats);
  // tempo = slope of the tracked beats (a median of frame-quantized gaps would be biased)
  const tracked = beatFrames.map(frameTime).filter(t => t >= firstSound - 0.2 && t <= lastSound + 0.2);
  const bpm = Math.round(6000 * (tracked.length - 1) / Math.max(1e-6, tracked[tracked.length - 1] - tracked[0])) / 100;

  // downbeat: the beat phase (mod 4) where the kick lands hardest
  const phaseScore = [0, 0, 0, 0];
  beats.forEach((t, i) => {
    const f = Math.round((t - FRAME_CENTER - ONSET_SHIFT) / DT);
    let peak = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(frameCount - 1, f + 2); k++) peak = Math.max(peak, flux[0][k]);
    phaseScore[i % 4] += peak;
  });
  const downbeatBeat = phaseScore.indexOf(Math.max(...phaseScore));

  // beat boundaries (plus where the last beat ends) are what gets stored; the grid is rebuilt from them
  const bounds = roundBeats([...beats, beats[beats.length - 1] + tail]);
  const grid = gridFromBeats(bounds);
  while (grid.length && grid[grid.length - 1] > duration - 0.05) grid.pop();
  const steps = grid.length;
  const stepLength = (j: number) => (grid[j + 1] ?? grid[j] + (grid[j] - grid[j - 1])) - grid[j];
  const nearestStep = (t: number) => {
    let lo = 0, hi = steps - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (grid[mid] <= t) lo = mid; else hi = mid; }
    return Math.abs(grid[lo] - t) <= Math.abs(grid[hi] - t) ? lo : hi;
  };

  // ---- 4. onsets onto the grid ------------------------------------------------------------
  onProgress('Placing the notes…');
  await yieldToBrowser();
  const level = movingAverage(odf, Math.round(4 / DT));
  const typical = Math.max(1e-6, median(Array.from(level.filter((_, i) => rms[i] > loud * 0.05))));
  const stepDigits = [new Uint8Array(steps), new Uint8Array(steps), new Uint8Array(steps)]; // low, mid, high
  const stepFrame = [new Int32Array(steps).fill(-1), new Int32Array(steps).fill(-1), new Int32Array(steps).fill(-1)];
  const bandToChart = [0, 1, 1, 2];
  let onGrid = 0, onsetTotal = 0;
  for (let b = 0; b < flux.length; b++) {
    const peaks = pickPeaks(flux[b]);
    const ref = Math.max(1e-6, percentile(Float32Array.from(peaks.map(p => p.strength)), 0.9));
    for (const p of peaks) {
      // quiet sections are lifted a little so they stay playable, loud ones toned down a little
      const comp = Math.min(1.5, Math.max(0.75, (typical / Math.max(1e-6, level[p.frame])) ** 0.3));
      const digit = strengthDigit(p.strength * comp / ref);
      if (digit < 2) continue;
      const t = frameTime(p.frame + p.offset);
      const j = nearestStep(t);
      const off = Math.abs(grid[j] - t);
      onsetTotal += p.strength;
      if (off <= Math.min(0.025, stepLength(j) * 0.3)) onGrid += p.strength;
      if (off > stepLength(j) * 0.45) continue;
      const c = bandToChart[b];
      if (digit > stepDigits[c][j]) { stepDigits[c][j] = digit; stepFrame[c][j] = p.frame; }
    }
    await yieldToBrowser();
  }
  const gridFit = onsetTotal > 0 ? onGrid / onsetTotal : 0;

  // vocals: onsets of the tonal centre layer (sung syllables / notes) onto the grid, with pitch
  onProgress('Following the vocals…');
  await yieldToBrowser();
  // take out what repeats every bar (the backing), then what's percussive; onsets of what's left
  const foreground = await withoutRepeats(vocalSpec, frameCount, beats.map(t => (t - FRAME_CENTER - ONSET_SHIFT) / DT));
  const harmonic = await harmonicPart(foreground, frameCount, VOCAL_BINS);
  const vocalOdf = superFlux(harmonic, frameCount, VOCAL_BINS);
  const vocalScale = Math.max(1e-7, percentile(vocalOdf, 0.95));
  for (let i = 0; i < frameCount; i++) vocalOdf[i] /= vocalScale;
  // loudness of the tonal layer per frame (for holds), and its typical level (to judge quiet sections)
  // and its share of everything in the band: a drum loop leaves almost nothing behind, a voice a lot
  const vocalLevel = new Float32Array(frameCount), vocalShare = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0, all = 0;
    for (let k = 0; k < VOCAL_BINS; k++) {
      sum += harmonic[f * VOCAL_BINS + k];
      all += vocalSpec[f * VOCAL_BINS + k];
    }
    vocalLevel[f] = Math.log(1e-6 + sum);
    vocalShare[f] = all > 0 ? sum / all : 0;
  }
  const vocalDigits = new Uint8Array(steps), vocalFrame = new Int32Array(steps).fill(-1);
  const vocalPeaks = pickPeaks(vocalOdf);
  const vocalRef = Math.max(1e-6, percentile(Float32Array.from(vocalPeaks.map(p => p.strength)), 0.9));
  const vocalAvg = movingAverage(vocalOdf, Math.round(4 / DT));
  const vocalTypical = Math.max(1e-6, median(Array.from(vocalAvg.filter((_, i) => rms[i] > loud * 0.05))));
  const vocalOnsets: { t: number; digit: number }[] = [];
  for (const p of vocalPeaks) {
    const comp = Math.min(1.5, Math.max(0.75, (vocalTypical / Math.max(1e-6, vocalAvg[p.frame])) ** 0.3));
    let share = 0;
    for (let k = p.frame; k <= Math.min(frameCount - 1, p.frame + 5); k++) share = Math.max(share, vocalShare[k]);
    const present = Math.min(1, share / VOCAL_PRESENT);
    const digit = strengthDigit(p.strength * comp * present / vocalRef);
    if (digit < 2) continue;
    const t = frameTime(p.frame + p.offset);
    vocalOnsets.push({ t, digit });
    const j = nearestStep(t);
    if (Math.abs(grid[j] - t) > stepLength(j) * 0.5) continue;
    if (digit > vocalDigits[j]) { vocalDigits[j] = digit; vocalFrame[j] = p.frame; }
  }
  opts.debug?.({ vocalOnsets });
  // pitch of each vocal step (MIDI note, '.' = none) and how long it's sung
  const pitchChars: string[] = new Array(steps).fill('.');
  const vocalHeld = new Float32Array(steps);
  let nextVocal = -1;
  for (let j = steps - 1; j >= 0; j--) {
    const f0 = vocalFrame[j];
    if (f0 < 0) continue;
    const midi = pitchAt(harmonic, f0, frameCount);
    if (midi) pitchChars[j] = String.fromCharCode(64 + midi - PITCH_MIN);
    // held while the tonal layer stays within ~9 dB of the note's start, until the next sung note
    const end = nextVocal >= 0 ? nextVocal : frameCount;
    let ref = -Infinity;
    for (let k = f0 + 1; k <= Math.min(end - 1, f0 + 4); k++) ref = Math.max(ref, vocalLevel[k]);
    let last = f0, gap = 0;
    for (let f = f0 + 1; f < end && gap <= 6; f++) {
      if (vocalLevel[f] >= ref - SUSTAIN_DROP) { last = f; gap = 0; } else gap++;
    }
    vocalHeld[j] = (last - f0) * DT;
    if (vocalDigits[j] >= 3) nextVocal = f0;
  }

  // held sounds: follow the pitch that rings out after a hit (808 note, sung or synth note) while it
  // stays within ~9 dB of its attack, letting it drift a bin per frame (glides, vibrato, reverb smear);
  // drums on top don't cut it off, a re-attack of the same pitch does
  const sustainChars: string[] = new Array(steps).fill('0');
  const ringFrom = (f0: number, mid: boolean) => {
    // the tone right after the attack transient
    let refBin = 0, refMag = -Infinity;
    for (let k = f0 + 1; k <= Math.min(frameCount - 1, f0 + 4); k++) {
      const m = mid ? midMags[k * TOP] : lowMag[k];
      if (m > refMag) { refMag = m; refBin = mid ? midBins[k * TOP] : lowBin[k]; }
    }
    if (!(refMag > 0.5)) return 0;
    let f = f0 + 1, last = f0, gap = 0, prev = refMag, bin = refBin;
    for (; f < frameCount && gap <= 6; f++) {
      let m = -Infinity, at = bin;
      if (mid) {
        for (let k = 0; k < TOP; k++) {
          const b = midBins[f * TOP + k];
          if (Math.abs(b - bin) <= 1 && midMags[f * TOP + k] > m) { m = midMags[f * TOP + k]; at = b; }
        }
      } else if (Math.abs(lowBin[f] - bin) <= 1) { m = lowMag[f]; at = lowBin[f]; }
      if (m >= refMag - SUSTAIN_DROP) {
        if (f > f0 + 6 && m > prev + 0.45) break; // the same pitch hit again: a new note
        last = f; gap = 0; prev = m; bin = at;
      } else gap++;
    }
    return (last - f0) * DT;
  };
  for (let j = 0; j < steps; j++) {
    let held = 0;
    if (stepFrame[0][j] >= 0 && stepDigits[0][j] >= 4) held = Math.max(held, ringFrom(stepFrame[0][j], false));
    if (stepFrame[1][j] >= 0 && stepDigits[1][j] >= 3) held = Math.max(held, ringFrom(stepFrame[1][j], true));
    if (vocalDigits[j] >= 3) held = Math.max(held, vocalHeld[j]);
    sustainChars[j] = Math.min(35, Math.floor(held / stepLength(j) + 0.25)).toString(36);
    if (j % 2048 === 0) await yieldToBrowser();
  }

  // section energy per beat (loudness rank 0-9)
  const beatLoud = beats.map((t, i) => {
    const a = Math.max(0, Math.round((t - FRAME_CENTER) / DT)), z = Math.min(frameCount, Math.round(((beats[i + 1] ?? t + tail) - FRAME_CENTER) / DT));
    let sum = 0;
    for (let k = a; k < z; k++) sum += rms[k] * rms[k];
    return Math.sqrt(sum / Math.max(1, z - a));
  });
  const sortedLoud = [...beatLoud].sort((a, b) => a - b);
  const rank = (v: number) => {
    let lo = 0, hi = sortedLoud.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedLoud[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / Math.max(1, sortedLoud.length - 1);
  };
  const energyChars = grid.map((_, j) => String(Math.min(9, Math.floor(rank(beatLoud[Math.floor(j / 4)] ?? 0) * 9.99))));

  const tempoSpread = stdDev(intervals) / Math.max(1e-6, median(intervals));
  const warning = gridFit < 0.55 || tempoSpread > 0.08
    ? 'This recording has loose or changing timing, so some notes may feel off the beat.'
    : undefined;
  const analysis: Analysis = {
    bpm, offset: grid[0],
    low: Array.from(stepDigits[0]).join(''), mid: Array.from(stepDigits[1]).join(''), high: Array.from(stepDigits[2]).join(''),
    gridFit, grid, beats: bounds, downbeat: downbeatBeat * 4,
    sustain: sustainChars.join(''), energy: energyChars.join(''),
    vocal: Array.from(vocalDigits).join(''), pitch: pitchChars.join(''),
  };
  onProgress('Your custom challenge is ready.');
  return { analysis, detectedBpm: bpm, ...(warning ? { warning } : {}) };
}

// ---- helpers ------------------------------------------------------------------------------
/** onset strength (relative to the band's 90th percentile) -> 0-9. Up to "5" the scale is strict
 * so medium hits don't become lines (tuned on real songs: most notes land on real onsets);
 * above that it spreads out so the biggest hits reach 9 (chords and holds key off those). */
function strengthDigit(x: number) {
  const knee = 5 / 6.8;
  const d = x <= knee ? 6.8 * x : 5 + (x - knee) / (1 - knee) * 4;
  return Math.max(0, Math.min(9, Math.round(d)));
}
const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);
function median(xs: ArrayLike<number>) {
  const s = Array.from(xs).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
function stdDev(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
}
function movingAverage(x: Float32Array, radius: number) {
  const out = new Float32Array(x.length);
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - radius), z = Math.min(x.length, i + radius + 1);
    out[i] = (prefix[z] - prefix[a]) / (z - a);
  }
  return out;
}
function subtractLocalMean(x: Float32Array, radius: number) {
  const mean = movingAverage(x, radius);
  return x.map((v, i) => Math.max(0, v - mean[i]));
}

const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.85) ** 2);

/** tempo candidates: the strongest autocorrelation peaks (60-200 BPM), plus double and half of each */
function tempoCandidates(odf: Float32Array): number[] {
  // skip intros: use up to ~3 minutes starting 10% in
  const span = Math.min(odf.length, Math.round(180 / DT));
  const start = Math.max(0, Math.min(Math.round(odf.length * 0.1), odf.length - span));
  const x = odf.subarray(start, start + span);
  let mean = 0;
  for (const v of x) mean += v / x.length;
  const c = Float32Array.from(x, v => v - mean);
  const minLag = Math.floor(60 / 200 / DT), maxLag = Math.ceil(60 / 60 / DT);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag < ac.length; lag++) {
    let sum = 0;
    for (let i = lag; i < c.length; i++) sum += c[i] * c[i - lag];
    ac[lag] = sum / Math.max(1, c.length - lag);
  }
  const scored = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) scored[lag] = ac[lag] + 0.5 * ac[lag * 2];
  const peaks: { lag: number; v: number }[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (scored[lag] > scored[lag - 1] && scored[lag] >= scored[lag + 1] && scored[lag] > 0) {
      const a = scored[lag - 1], b = scored[lag], cc = scored[lag + 1], denom = a - 2 * b + cc;
      peaks.push({ lag: lag + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - cc) / denom)) : 0), v: b });
    }
  }
  peaks.sort((p, q) => q.v - p.v);
  const out: number[] = [];
  const add = (bpm: number) => {
    if (bpm >= 60 && bpm <= 200 && !out.some(o => Math.abs(o - bpm) / bpm < 0.02)) out.push(bpm);
  };
  for (const p of peaks.slice(0, 4)) {
    const bpm = 60 / (p.lag * DT);
    add(bpm); add(bpm * 2); add(bpm / 2);
  }
  if (!out.length) out.push(115);
  return out;
}

/** share of onset energy within 20% of a 16th step of this beat grid (relative, so faster grids get no free pass) */
function sixteenthFit(peaks: { frame: number; offset: number; strength: number }[], beats: number[]) {
  if (beats.length < 2) return 0;
  let on = 0, total = 0, i = 0;
  for (const p of peaks) {
    const f = p.frame + p.offset;
    total += p.strength;
    while (i + 2 < beats.length && beats[i + 1] <= f) i++;
    const span = (beats[i + 1] - beats[i]) / 4;
    if (f < beats[0] - span * 2 || f > beats[beats.length - 1] + span * 2) continue;
    const q = (f - beats[i]) / span;
    if (Math.abs(q - Math.round(q)) <= 0.2) on += p.strength;
  }
  return total > 0 ? on / total : 0;
}

/** how hard the off-beats (half) and the 16ths in between (quarter) hit in an onset signal, relative to the beats */
function subdivisionStrength(x: Float32Array, beats: number[]) {
  const at = (frame: number) => {
    const f = Math.round(frame);
    let m = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(x.length - 1, f + 2); k++) m = Math.max(m, x[k]);
    return m;
  };
  let onBeat = 0, half = 0, quarter = 0;
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i], span = beats[i + 1] - a;
    onBeat += at(a);
    half += at(a + span / 2);
    quarter += (at(a + span / 4) + at(a + span * 3 / 4)) / 2;
  }
  return onBeat > 0 ? { half: half / onBeat, quarter: quarter / onBeat } : { half: 0, quarter: 0 };
}

/**
 * The tonal (harmonic) part of a magnitude spectrogram, by median filtering: along time a held note is
 * steady and a drum hit is an outlier, along frequency it's the other way round (Fitzgerald 2010).
 * Soft (Wiener) mask, 9-frame / 9-bin medians.
 */
async function harmonicPart(spec: Float32Array, frames: number, nb: number): Promise<Float32Array> {
  const out = new Float32Array(spec.length);
  const row = (f: number) => (f < 0 ? 0 : f >= frames ? frames - 1 : f) * nb;
  const bin = (base: number, k: number) => spec[base + (k < 0 ? 0 : k >= nb ? nb - 1 : k)];
  for (let f = 0; f < frames; f++) {
    // along time: the same bin over 9 frames; along frequency: 9 bins of this frame
    const r0 = row(f - 4), r1 = row(f - 3), r2 = row(f - 2), r3 = row(f - 1), r4 = f * nb, r5 = row(f + 1), r6 = row(f + 2), r7 = row(f + 3), r8 = row(f + 4);
    for (let k = 0; k < nb; k++) {
      const h = median9(spec[r0 + k], spec[r1 + k], spec[r2 + k], spec[r3 + k], spec[r4 + k], spec[r5 + k], spec[r6 + k], spec[r7 + k], spec[r8 + k]);
      const i = r4 + k;
      const p = k >= 4 && k < nb - 4
        ? median9(spec[i - 4], spec[i - 3], spec[i - 2], spec[i - 1], spec[i], spec[i + 1], spec[i + 2], spec[i + 3], spec[i + 4])
        : median9(bin(r4, k - 4), bin(r4, k - 3), bin(r4, k - 2), bin(r4, k - 1), spec[i], bin(r4, k + 1), bin(r4, k + 2), bin(r4, k + 3), bin(r4, k + 4));
      out[i] = spec[i] * (h * h) / (h * h + p * p + 1e-12);
    }
    if (f % 1024 === 0) await yieldToBrowser();
  }
  return out;
}

/** median of nine values (Paeth's 19-comparison network) */
function median9(p0: number, p1: number, p2: number, p3: number, p4: number, p5: number, p6: number, p7: number, p8: number) {
  let t: number;
  if (p1 > p2) { t = p1; p1 = p2; p2 = t; } if (p4 > p5) { t = p4; p4 = p5; p5 = t; } if (p7 > p8) { t = p7; p7 = p8; p8 = t; }
  if (p0 > p1) { t = p0; p0 = p1; p1 = t; } if (p3 > p4) { t = p3; p3 = p4; p4 = t; } if (p6 > p7) { t = p6; p6 = p7; p7 = t; }
  if (p1 > p2) { t = p1; p1 = p2; p2 = t; } if (p4 > p5) { t = p4; p4 = p5; p5 = t; } if (p7 > p8) { t = p7; p7 = p8; p8 = t; }
  if (p0 > p3) p3 = p0; if (p5 > p8) p5 = p8; if (p4 > p7) { t = p4; p4 = p7; p7 = t; }
  if (p3 > p6) p6 = p3; if (p1 > p4) p4 = p1; if (p2 > p5) p2 = p5;
  if (p4 > p7) p4 = p7; if (p4 > p2) { t = p4; p4 = p2; p2 = t; } if (p6 > p4) p4 = p6;
  return p4 > p2 ? p2 : p4;
}

/**
 * What doesn't repeat from bar to bar (REPET, Rafii & Pardo 2013, beat-synchronous): the backing
 * (loops, drum patterns, chord cycles) is estimated at each frame as the median of the same spot in
 * the bars around it and taken out; the lead vocal, which doesn't repeat like that, is what's left.
 */
async function withoutRepeats(spec: Float32Array, frames: number, beatFrames: number[]): Promise<Float32Array> {
  const out = new Float32Array(spec.length);
  // the same spot 1-4 bars (of 4 beats) before and after
  const offsets: number[] = [];
  for (let n = 1; n <= 4; n++) offsets.push(-n * 4, n * 4);
  const vals = new Float32Array(offsets.length + 1);
  const pos = new Int32Array(offsets.length + 1);
  let b = 0;
  for (let f = 0; f < frames; f++) {
    while (b + 2 < beatFrames.length && beatFrames[b + 1] <= f) b++;
    const span = beatFrames[b + 1] - beatFrames[b];
    const phase = span > 0 ? (f - beatFrames[b]) / span : 0;
    let n = 0;
    pos[n++] = f;
    for (const o of offsets) {
      const j = b + o;
      if (j < 0 || j + 1 >= beatFrames.length) continue;
      const g = Math.round(beatFrames[j] + phase * (beatFrames[j + 1] - beatFrames[j]));
      if (g >= 0 && g < frames) pos[n++] = g;
    }
    for (let k = 0; k < VOCAL_BINS; k++) {
      for (let i = 0; i < n; i++) {
        const v = spec[pos[i] * VOCAL_BINS + k];
        let x = i;
        while (x > 0 && vals[x - 1] > v) { vals[x] = vals[x - 1]; x--; }
        vals[x] = v;
      }
      const background = n >= 3 ? vals[n >> 1] : 0;
      const own = spec[f * VOCAL_BINS + k];
      out[f * VOCAL_BINS + k] = own > background ? own - background : 0;
    }
    if (f % 1024 === 0) await yieldToBrowser();
  }
  return out;
}

/** SuperFlux onset signal (Böck & Widmer 2013): rises against the max of nearby bins two frames back,
 * so a wavering pitch (vibrato, slides) isn't mistaken for a new note. Formant range weighted most. */
function superFlux(linear: Float32Array, frames: number, nb: number) {
  const out = new Float32Array(frames);
  const spec = linear.map(Math.log1p);
  const weight = Float32Array.from({ length: nb }, (_, k) => {
    const hz = (VOCAL_LO + k) * BIN_HZ;
    return hz < 200 || hz > 3500 ? 0.5 : 1;
  });
  for (let f = 2; f < frames; f++) {
    let sum = 0;
    for (let k = 0; k < nb; k++) {
      let ref = 0;
      for (let d = Math.max(0, k - 2); d <= Math.min(nb - 1, k + 2); d++) ref = Math.max(ref, spec[(f - 2) * nb + d]);
      sum += weight[k] * Math.max(0, spec[f * nb + k] - ref);
    }
    out[f] = sum / nb;
  }
  return out;
}

const PITCH_MIN = 40, PITCH_MAX = 84; // E2-C6: sung range

/** strength of the best harmonic series (f0 + 7 overtones) across candidate pitches at frame f */
function salience(spec: Float32Array, f: number) {
  let best = 0, bestMidi = 0, total = 0;
  for (let k = 0; k < VOCAL_BINS; k++) total += spec[f * VOCAL_BINS + k];
  const mean = total / VOCAL_BINS;
  for (let midi = PITCH_MIN; midi <= PITCH_MAX; midi++) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    let sum = 0, weight = 1;
    for (let h = 1; h <= 8; h++, weight *= 0.85) {
      const x = h * hz / BIN_HZ - VOCAL_LO;
      if (x < 0) continue;
      if (x >= VOCAL_BINS - 1) break;
      const a = Math.floor(x), frac = x - a;
      sum += weight * (spec[f * VOCAL_BINS + a] * (1 - frac) + spec[f * VOCAL_BINS + a + 1] * frac);
    }
    if (sum > best) { best = sum; bestMidi = midi; }
  }
  return { midi: bestMidi, ratio: mean > 0 ? best / (mean * 4.4) : 0 };
}

/** the sung pitch just after an onset (the most common best pitch over 20-70 ms), or 0 */
function pitchAt(spec: Float32Array, f0: number, frames: number) {
  const votes = new Map<number, number>();
  for (let f = f0 + 2; f <= Math.min(frames - 1, f0 + 7); f++) {
    const s = salience(spec, f);
    if (s.ratio > 1.2) votes.set(s.midi, (votes.get(s.midi) ?? 0) + s.ratio);
  }
  let best = 0, at = 0;
  for (const [midi, v] of votes) if (v > best) { best = v; at = midi; }
  return at;
}

/** dynamic-programming beat tracker (Ellis 2007, as in librosa): follows tempo drift */
function trackBeats(odf: Float32Array, period: number): number[] {
  const n = odf.length;
  const sd = stdDev(Array.from(odf)) || 1;
  // smooth the onset envelope with a narrow gaussian (sigma = period / 32)
  const sigma = Math.max(1, period / 32), radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) { const j = i + k; if (j >= 0 && j < n) sum += odf[j] * kernel[k + radius]; }
    local[i] = sum / sd;
  }
  const tightness = 100;
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2);
  const penalty = new Float64Array(hi + 1);
  for (let d = lo; d <= hi; d++) penalty[d] = -tightness * Math.log(d / period) ** 2;
  const score = new Float64Array(n), backlink = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = -Infinity, arg = -1;
    for (let d = lo; d <= hi && t - d >= 0; d++) {
      const v = score[t - d] + penalty[d];
      if (v > best) { best = v; arg = t - d; }
    }
    score[t] = local[t] + (arg >= 0 ? best : 0);
    backlink[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // last beat: the latest strong local maximum of the cumulative score
  const maxima: number[] = [];
  for (let t = 1; t < n - 1; t++) if (score[t] > score[t - 1] && score[t] >= score[t + 1]) maxima.push(t);
  const threshold = 0.5 * median(maxima.map(t => score[t]));
  let last = maxima.length ? maxima[maxima.length - 1] : n - 1;
  for (let i = maxima.length - 1; i >= 0; i--) if (score[maxima[i]] >= threshold) { last = maxima[i]; break; }
  const beats: number[] = [];
  for (let t = last; t >= 0; t = backlink[t]) {
    // sub-frame position from the onset peak around the beat (parabolic)
    const a = local[t - 1] ?? local[t], b = local[t], c = local[t + 1] ?? local[t];
    const denom = a - 2 * b + c;
    beats.push(t + (denom < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom)) : 0));
  }
  return beats.reverse();
}

/** local-maximum peaks above an adaptive threshold; offset is a sub-frame (parabolic) correction */
function pickPeaks(x: Float32Array) {
  const mean = movingAverage(x, 15);
  const sq = movingAverage(x.map(v => v * v), 15);
  const peaks: { frame: number; offset: number; strength: number }[] = [];
  for (let i = 3; i < x.length - 3; i++) {
    const v = x[i];
    if (v < x[i - 1] || v < x[i + 1] || v < x[i - 2] || v < x[i + 2] || v < x[i - 3] || v < x[i + 3]) continue;
    const sd = Math.sqrt(Math.max(0, sq[i] - mean[i] * mean[i]));
    const threshold = mean[i] + 0.5 * sd + 0.06;
    if (v <= threshold) continue;
    const a = x[i - 1], c = x[i + 1], denom = a - 2 * v + c;
    peaks.push({ frame: i, offset: denom !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom)) : 0, strength: v - mean[i] });
    i += 2;
  }
  return peaks;
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
  const result = await analyzeSamples(await monoForAnalysis(buffer), ANALYSIS_RATE, onProgress, { side: await sideForAnalysis(buffer) });
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

/** chart an import again at a tempo the player picked (half or double of what was detected) */
export async function retimeImport(song: Song, buffer: AudioBuffer, bpm: number, onProgress: Progress = () => {}): Promise<Song> {
  const { analysis } = await analyzeSamples(await monoForAnalysis(buffer), ANALYSIS_RATE, onProgress, { bpm, side: await sideForAnalysis(buffer) });
  return { ...song, bpm: analysis.bpm, analysis };
}

/** the stereo difference (L - R) / 2 at the analysis rate, or undefined for mono recordings */
async function sideForAnalysis(buffer: AudioBuffer) {
  if (buffer.numberOfChannels < 2) return undefined;
  const length = Math.floor(buffer.duration * ANALYSIS_RATE);
  const out = new Float32Array(length);
  const ratio = buffer.sampleRate / ANALYSIS_RATE;
  const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
  const at = (ch: Float32Array, p: number) => {
    const a = Math.floor(p), frac = p - a;
    return ch[a] * (1 - frac) + (ch[Math.min(a + 1, ch.length - 1)] ?? 0) * frac;
  };
  for (let i = 0; i < length; i++) {
    out[i] = (at(l, i * ratio) - at(r, i * ratio)) / 2;
    if (i % (ANALYSIS_RATE * 8) === 0) await yieldToBrowser();
  }
  return out;
}

/** a mono copy at the analysis rate */
async function monoForAnalysis(buffer: AudioBuffer) {
  const length = Math.floor(buffer.duration * ANALYSIS_RATE);
  const mono = new Float32Array(length);
  const ratio = buffer.sampleRate / ANALYSIS_RATE;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < length; i++) {
    const position = i * ratio, left = Math.floor(position), fraction = position - left;
    for (const channel of channels) mono[i] += (channel[left] * (1 - fraction) + (channel[Math.min(left + 1, channel.length - 1)] ?? 0) * fraction) / channels.length;
    if (i % (ANALYSIS_RATE * 8) === 0) await yieldToBrowser();
  }
  return mono;
}
