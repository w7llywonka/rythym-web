// Turns soundtrack / imported songs into playable tracks with generated charts.
import { generateChart, NEXT } from './chart.ts';
import { LEVEL_BONUS } from './config.ts';
import { songs } from './songs.ts';
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
    song, charts: {}, chartList: [], level: 1, ...overrides,
  };
  buildCharts(track);
  return track;
}

/** Imported recordings land in a tier by tempo and are charted from start to finish. */
export function trackFromImport(song: Song): Track {
  const bpm = song.analysis.bpm;
  const tier: Tier = bpm < 115 ? 'Easy' : bpm < 145 ? 'Hard' : bpm < 170 ? 'Expert' : 'Extreme';
  return trackFromSong({ ...song, difficulty: tier }, { difficulty: tier, custom: true });
}

export function soundtrack(): Track[] {
  return songs.map(song => trackFromSong(song));
}
