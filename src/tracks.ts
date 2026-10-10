// Turns soundtrack / imported songs into playable tracks with generated charts.
import { generateChart, NEXT } from './chart.ts';
import { LEVEL_BONUS } from './config.ts';
import { licensedSongs, songs } from './songs.ts';
import type { Chart, Diff, Song, Tier, Track } from './types.ts';

export function buildCharts(track: Track): void {
  track.charts = {};
  track.chartList = [track.difficulty, NEXT[track.difficulty]].filter(Boolean) as Diff[];
  for (const diff of track.chartList) {
    const notes = generateChart(track, diff);
    if (!notes.length) continue;
    const holds = notes.filter(n => n.endTime !== undefined).length;
    const last = notes[notes.length - 1];
    const nps = notes.length / Math.max(1, last.time - notes[0].time);
    const chart: Chart = {
      diff, notes, endTime: last.endTime ?? last.time, nps, holds, objects: notes.length + holds,
      level: Math.min(30, Math.max(1, Math.round(nps * 2) + LEVEL_BONUS[diff])),
    };
    track.charts[diff] = chart;
  }
  track.level = track.charts[track.difficulty]?.level ?? 1;
}

export function trackFromSong(song: Song, overrides: Partial<Track> = {}): Track {
  const a = song.analysis;
  const track: Track = {
    id: song.id, title: song.title, artist: song.artist, genre: song.genre, seed: song.seed,
    difficulty: song.difficulty, bpm: a.bpm, displayBpm: Math.round(a.bpm), offset: a.offset,
    length: song.duration, displayLength: song.duration, previewStart: song.previewStart,
    color1: song.color, color2: song.color2, low: a.low, mid: a.mid, high: a.high,
    grid: a.grid, downbeat: a.downbeat, sustain: a.sustain, energy: a.energy, vocal: a.vocal, pitch: a.pitch,
    ...(song.weeklyFrom !== undefined ? { weeklyFrom: song.weeklyFrom } : {}),
    song, charts: {}, chartList: [], level: 1, ...overrides,
  };
  buildCharts(track);
  return track;
}

/** Imported recordings land in a tier by tempo and are charted from start to finish. */
export function trackFromImport(song: Song): Track {
  const bpm = song.analysis.bpm;
  // most energetic rap / drill / EDM sits at 130-160 BPM: that's Expert, not Hard
  const tier: Tier = bpm < 100 ? 'Easy' : bpm < 128 ? 'Hard' : bpm < 165 ? 'Expert' : 'Extreme';
  return trackFromSong({ ...song, difficulty: tier }, { difficulty: tier, custom: true });
}

/** licensed Extreme tracks are charted on their busiest stretch (chosen offline, stored as `window`) */
function windowed(song: Song): Partial<Track> {
  const w = song.window;
  if (!w) return {};
  return { chartStart: w.start, chartEnd: w.end, displayLength: w.end - w.start, previewStart: w.start + Math.min(20, (w.end - w.start) * 0.3) };
}

/** every built-in song: the original soundtrack plus the licensed tracks */
export function soundtrack(): Track[] {
  return [...songs, ...licensedSongs].map(song => trackFromSong(song, windowed(song)));
}
