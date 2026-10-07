// Builds note charts from a song's analysed onset grid.
// Each song stores three strings (low / mid / high) with one digit (0-9) per 16th note step,
// saying how strong the kick/bass, snare/mids and hats/highs hit on that step. Step i (0-based) is at
// offset + i * (60 / bpm / 4) seconds into the track.
//
// Notes follow the music: kick-heavy hits go to Button 1, snare/hat hits go to Button 2.
import type { ChartNote, Diff, Lane } from './types.ts';

export interface Profile {
  targetNps: number; minGap: number; beatBonus: number; eighthBonus: number; sixteenths: boolean;
  minStrength: number; loose16?: boolean; maxRun: number; alternateBelow?: number; chordGap?: number; chordThreshold?: number; offbeatChords?: boolean;
}

export const PROFILES: Record<Diff, Profile> = {
  Easy: { targetNps: 1.5, minStrength: 6, minGap: 0.3, beatBonus: 3, eighthBonus: 0.5, sixteenths: false, maxRun: 2 },
  Hard: { targetNps: 4.2, minStrength: 5, minGap: 0.1, beatBonus: 1.5, eighthBonus: 0.7, sixteenths: true, maxRun: 3, chordGap: 1.2 },
  Expert: {
    targetNps: 5.6, minStrength: 5, minGap: 0.085, beatBonus: 1.2, eighthBonus: 0.65, sixteenths: true, loose16: true,
    maxRun: 3, alternateBelow: 0.11, chordGap: 0.8, chordThreshold: 6,
  },
  Extreme: {
    targetNps: 7.2, minStrength: 4, minGap: 0.065, beatBonus: 1, eighthBonus: 0.6, sixteenths: true, loose16: true,
    maxRun: 4, alternateBelow: 0.09, chordGap: 0.45, chordThreshold: 6, offbeatChords: true,
  },
  Insane: {
    targetNps: 10, minStrength: 4, minGap: 0.055, beatBonus: 0.5, eighthBonus: 0.4, sixteenths: true, loose16: true,
    maxRun: 5, alternateBelow: 0.075, chordGap: 0.25, chordThreshold: 5, offbeatChords: true,
  },
};

// hold note settings per chart difficulty: chance per strong note, length range and spacing in beats
export const HOLDS: Record<Diff, { chance: number; minLen: number; maxLen: number; spacing: number; overlap: boolean }> = {
  Easy: { chance: 0.3, minLen: 1, maxLen: 2, spacing: 4, overlap: false },
  Hard: { chance: 0.22, minLen: 1, maxLen: 2, spacing: 3, overlap: true },
  Expert: { chance: 0.2, minLen: 1, maxLen: 2, spacing: 3, overlap: true },
  Extreme: { chance: 0.13, minLen: 1, maxLen: 1.75, spacing: 3, overlap: true },
  Insane: { chance: 0.11, minLen: 1, maxLen: 1.5, spacing: 3, overlap: true },
};

// each song can also be played one step harder than its own tier
export const NEXT: Partial<Record<Diff, Diff>> = { Easy: 'Hard', Hard: 'Expert', Expert: 'Extreme', Extreme: 'Insane' };

export interface ChartSource {
  seed: number; bpm: number; offset: number; low: string; mid: string; high: string;
  chartStart?: number; chartEnd?: number;
  /** beat-tracked imports: exact step times, first downbeat step, held length per step, energy per step */
  grid?: number[]; downbeat?: number; sustain?: string; energy?: string;
}

/** Small deterministic PRNG (mulberry32) standing in for Roblox's Random. */
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 1; }
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) { return min + Math.floor(this.next() * (max - min + 1)); }
  number(min = 0, max = 1) { return min + this.next() * (max - min); }
}

interface Step {
  index: number; t: number; L: number; M: number; H: number; strength: number; score: number; allowed: boolean;
  /** position in the bar: 0 = downbeat, multiples of 4 = beats, even = 8ths, odd = 16ths */
  pos: number; held: number;
}

const digit = (s: string, i: number) => {
  const code = s.charCodeAt(i);
  return Number.isNaN(code) ? 0 : code - 48;
};

function buildSteps(song: ChartSource, profile: Profile): Step[] {
  const s16 = 60 / song.bpm / 4;
  // tiny tie-breaker so equally strong steps don't all make the cut or all miss it together:
  // fuller hits (more bands active) first, then a seeded jitter
  const tie = new Rng((song.seed + 104729) % 2147483647);
  const n = song.low.length;
  const steps: Step[] = [];
  const down = song.downbeat ?? 0;
  for (let j = 0; j < n; j++) {
    const L = digit(song.low, j), M = digit(song.mid, j), H = digit(song.high, j);
    const strength = Math.max(L, M, H * 0.8);
    const pos = (((j - down) % 16) + 16) % 16;
    let bonus = 0, allowed = true;
    if (pos % 4 === 0) bonus = profile.beatBonus + (pos === 0 && song.grid ? 0.3 : 0);
    else if (pos % 2 === 0) bonus = profile.eighthBonus;
    else allowed = profile.sixteenths;
    // density follows the music: louder sections get more lines, breakdowns fewer
    const energy = song.energy ? (digit(song.energy, j) - 4.5) * 0.28 : 0;
    const held = song.sustain ? parseInt(song.sustain[j] ?? '0', 36) || 0 : 0;
    steps.push({
      index: j, t: song.grid ? song.grid[j] : song.offset + j * s16, L, M, H, strength,
      score: strength + bonus + energy + ((L + M + H) / 27) * 0.04 + tie.next() * 0.01, allowed, pos, held,
    });
  }
  // off-beat 16ths only count when they're a clear peak of their own
  for (let i = 0; i < n; i++) {
    const st = steps[i];
    if (st.pos % 2 === 1 && st.allowed && !profile.loose16) {
      const prev = steps[i - 1], next = steps[i + 1];
      if ((prev && prev.strength >= st.strength) || (next && next.strength >= st.strength)) st.allowed = false;
    }
  }
  return steps;
}

// so a 16th at ~178 BPM (0.0843s) still counts as an 0.085s gap
const GAP_SLACK = 0.0015;

function pick(steps: Step[], profile: Profile, threshold: number): Step[] {
  const chosen: Step[] = [];
  for (const st of steps) {
    // only clear hits get charted: quiet ghost notes and hat noise never become lines,
    // and off-beat 16ths have to be a notch stronger than that
    const floor = profile.minStrength + (st.pos % 2 === 1 ? 1 : 0);
    if (st.allowed && st.strength >= floor && st.score >= threshold) {
      const last = chosen[chosen.length - 1];
      if (!last || st.t - last.t >= profile.minGap - GAP_SLACK) {
        chosen.push(st);
      } else if (st.score > last.score + 1) {
        // a much stronger hit right after a weak one: keep the strong one instead
        const before = chosen[chosen.length - 2];
        if (!before || st.t - before.t >= profile.minGap - GAP_SLACK) chosen[chosen.length - 1] = st;
      }
    }
  }
  return chosen;
}

/** Returns a time-sorted list of notes. Deterministic for a given song + difficulty. */
export function generateChart(song: ChartSource, difficulty: Diff): ChartNote[] {
  let profile = PROFILES[difficulty];
  // imports: Expert and up also take hits a notch softer, so the "+" chart is really denser
  // (real recordings have fewer max-strength hits than the synthesized soundtrack)
  if (song.grid && (difficulty === 'Expert' || difficulty === 'Extreme' || difficulty === 'Insane')) {
    profile = { ...profile, minStrength: profile.minStrength - 1 };
  }
  const rng = new Rng(song.seed % 2147483647);
  let steps = buildSteps(song, profile);

  // optional section of the track to chart (used to cut full songs down to short runs)
  if (song.chartStart !== undefined || song.chartEnd !== undefined) {
    const from = song.chartStart ?? 0, to = song.chartEnd ?? Infinity;
    steps = steps.filter(st => st.t >= from && st.t <= to);
  }

  // active part of the song (ignores silent intro/outro)
  let first: number | undefined, last = 0;
  for (const st of steps) {
    if (st.strength >= 5) {
      first ??= st.t;
      last = st.t;
    }
  }
  if (first === undefined) return [];

  // find the threshold that gives the target density
  const target = profile.targetNps * (last - first);
  let lo = 0, hi = 20;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (pick(steps, profile, mid).length > target) lo = mid; else hi = mid;
  }
  // the count can jump past the target (e.g. every beat equally strong): prefer fewer notes,
  // and only take the busier side when the sparser one falls well short
  const under = pick(steps, profile, hi), over = pick(steps, profile, lo);
  const chosen = under.length < target * 0.8 && over.length - target < target - under.length ? over : under;

  let notes: ChartNote[] = [];
  const stepOf = new Map<ChartNote, Step>();
  let prevLane = 0, run = 0, prevT = -Infinity, lastChordT = -Infinity;
  for (const st of chosen) {
    const gap = st.t - prevT;
    const top = Math.max(st.M, st.H);
    let lane: Lane;
    if (st.L >= top + 2) lane = 1;
    else if (top >= st.L + 2) lane = 2;
    else lane = rng.int(1, 2) as Lane;
    // keep fast passages flowing instead of long one-lane jacks
    if (lane === prevLane && (run >= profile.maxRun || gap < (profile.alternateBelow ?? 0.14))) lane = (3 - lane) as Lane;

    const chordAt = profile.chordThreshold ?? 7;
    const isChord = profile.chordGap !== undefined
      && (st.pos % 4 === 0 || (!!profile.offbeatChords && st.pos % 2 === 0))
      && st.L >= chordAt && top >= chordAt
      && gap >= (profile.offbeatChords ? 0.12 : 0.2)
      && st.t - lastChordT >= profile.chordGap;

    if (isChord) {
      const a: ChartNote = { time: st.t, lane: 1, chord: true, strength: st.strength };
      const b: ChartNote = { time: st.t, lane: 2, chord: true, strength: st.strength };
      notes.push(a, b);
      stepOf.set(a, st); stepOf.set(b, st);
      lastChordT = st.t;
      prevLane = 0; run = 0;
    } else {
      const note: ChartNote = { time: st.t, lane, chord: false, strength: st.strength };
      notes.push(note);
      stepOf.set(note, st);
      run = lane === prevLane ? run + 1 : 1;
      prevLane = lane;
    }
    prevT = st.t;
  }

  // imports: when a bar of music repeats, its lines repeat too (same rhythm -> same pattern),
  // which is what makes hand-made charts feel intentional
  if (song.grid) {
    const down = song.downbeat ?? 0;
    const bars = new Map<number, ChartNote[]>();
    for (const note of notes) {
      const st = stepOf.get(note)!;
      const bar = Math.floor((st.index - down) / 16);
      const list = bars.get(bar) ?? [];
      list.push(note);
      bars.set(bar, list);
    }
    const seen = new Map<string, Lane[]>();
    for (const [, list] of [...bars].sort((x, y) => x[0] - y[0])) {
      const sig = list.map(note => {
        const st = stepOf.get(note)!;
        const top = Math.max(st.M, st.H);
        const voice = note.chord ? 'C' : st.L >= top + 2 ? 'K' : top >= st.L + 2 ? 'S' : 'X';
        return `${st.pos}${voice}`;
      }).join(',');
      const lanes = seen.get(sig);
      if (lanes) list.forEach((note, i) => { if (!note.chord) note.lane = lanes[i]; });
      else seen.set(sig, list.map(note => note.lane));
    }
  }

  // hold notes: a strong hit followed by room in its lane becomes a line you hold down
  const hold = HOLDS[difficulty];
  const beat = 60 / song.bpm;
  const s16 = beat / 4;
  // very fast songs get proportionally longer holds so they stay holdable
  const beatScale = Math.max(1, 0.45 / beat);
  const hrng = new Rng((song.seed + difficulty.length * 7919) % 2147483647);
  const removed = new Set<ChartNote>();
  const busyUntil: Record<number, number> = { 1: -Infinity, 2: -Infinity };
  let lastHoldStart = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (removed.has(n) || n.chord || n.time <= busyUntil[n.lane]) continue;
    let tailEnd: number;
    const st = stepOf.get(n);
    if (song.sustain && song.grid && st) {
      // a line becomes a hold only where a sound actually rings out (808, sung or synth note)
      // held at least 1.5 beats (6 steps): tuned on real songs so synth-heavy tracks don't turn into all holds
      if ((n.strength ?? 0) < 5 || st.held < 6 || n.time - lastHoldStart < hold.spacing * beat) continue;
      const lenSteps = Math.min(st.held, Math.round(hold.maxLen * beatScale * 4) + 2);
      const endStep = Math.min(song.grid.length - 1, st.index + lenSteps);
      tailEnd = song.grid[endStep] - (song.grid[endStep] - song.grid[endStep - 1]) * 0.25;
      if (tailEnd - n.time < Math.max(0.3, hold.minLen * beat * 0.75)) continue;
    } else {
      if ((n.strength ?? 0) < 6) continue;
      if (n.time - lastHoldStart < hold.spacing * beat || hrng.next() >= hold.chance) continue;
      const beats = hrng.number(hold.minLen, hold.maxLen) * beatScale;
      const len = Math.max(2, Math.round(beats * beat / s16)) * s16;
      if (len < 0.3) continue;
      tailEnd = n.time + len;
    }
    // clear the lane under the hold (and the other lane too where overlap isn't allowed)
    let ok = true;
    const victims: ChartNote[] = [];
    for (let j = i + 1; j < notes.length; j++) {
      const m = notes[j];
      if (m.time > tailEnd + 0.25 * beat) break;
      if (!removed.has(m) && m.time > n.time + 0.001 && (m.lane === n.lane || !hold.overlap || m.chord)) {
        if (m.endTime !== undefined) { ok = false; break; }
        victims.push(m);
      }
    }
    if (!ok) continue;
    for (const m of victims) {
      removed.add(m);
      // a chord partner in the other lane becomes a plain note
      if (m.chord) for (const o of notes) if (o !== m && o.chord && Math.abs(o.time - m.time) < 0.001) o.chord = false;
    }
    n.endTime = tailEnd;
    busyUntil[n.lane] = tailEnd + 0.25 * beat;
    lastHoldStart = n.time;
  }
  notes = notes.filter(n => !removed.has(n));
  return notes;
}
