import { gridFromBeats } from './beatgrid.ts';
import licensedData from './licensed-data.json' with { type: 'json' };
import songData from './song-data.json' with { type: 'json' };
import type { Song } from './types';

/** Original tracks and their analysis of actual, deterministically rendered PCM. */
export const songs: Song[] = songData.map(record => record.song as Song);

/**
 * Licensed tracks by other artists (CC0 / CC BY, see MUSIC-LICENSE.md), analysed offline from their
 * audio files by `npm run tracks`. Only beat boundaries are stored; the grid is rebuilt here.
 */
export const licensedSongs: Song[] = (licensedData as unknown as { song: Song }[]).map(({ song }) => ({
  ...song,
  analysis: { ...song.analysis, grid: gridFromBeats(song.analysis.beats ?? [], song.analysis.low.length) },
}));
