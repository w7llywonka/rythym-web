import type { Lane, Note, Song } from './types';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Derive deterministic two-lane charts from analyzed low/mid/high onsets. */
export function generateChart(song: Song): Note[] {
  const { analysis } = song;
  const random = seededRandom(song.seed);
  const step = 60 / analysis.bpm / 4;
  const hard = song.difficulty === 'Hard';
  const custom = song.audio.startsWith('local:');
  const candidates = Array.from({ length: analysis.low.length }, (_, index) => {
    const low = Number(analysis.low[index]);
    const mid = Number(analysis.mid[index]);
    const high = Number(analysis.high[index]);
    const right = Math.max(mid, high * 0.84);
    const strength = Math.max(low, right);
    const score = strength + Math.min(low, right) * 0.48 + (index % 4 === 0 ? 0.8 : 0) + random() * 0.45;
    const lane: Lane = Math.abs(low - right) < 1.35 ? (random() < 0.5 ? 0 : 1) : (low > right ? 0 : 1);
    return { index, low, right, strength, score, lane };
  }).filter(candidate => candidate.strength >= 2 &&
    analysis.offset + candidate.index * step < song.duration - 0.5);

  // The chosen threshold targets a playable density while sparse sections stay
  // sparse. Strong simultaneous kick and snare onsets can create gold chords.
  const target = Math.min(candidates.length, Math.round((song.duration - analysis.offset) * (custom ? 5.8 : hard ? 3.8 : 2.0)));
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Set(ranked.slice(0, target).map(candidate => candidate.index));
  const notes: Note[] = [];
  let lastTime = -Infinity;
  let lastLane: Lane = 1;
  for (const candidate of candidates) {
    if (!selected.has(candidate.index)) continue;
    const time = analysis.offset + candidate.index * step;
    let lane = candidate.lane;
    const fast = time - lastTime < 0.14;
    if (fast) lane = lastLane === 0 ? 1 : 0;
    const chord = !fast && candidate.low >= (custom ? 5 : 6) && candidate.right >= (custom ? 5 : 6) &&
      Math.abs(candidate.low - candidate.right) <= 2.2 &&
      candidate.index % (custom ? 2 : hard ? 4 : 8) === 0;
    notes.push({ time, lane, chord });
    if (chord) notes.push({ time, lane: lane === 0 ? 1 : 0, chord: true });
    lastTime = time;
    lastLane = lane;
  }
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}
