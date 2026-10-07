import songData from './song-data.json' with { type: 'json' };
import type { Song } from './types';

/** Original tracks and their analysis of actual, deterministically rendered PCM. */
export const songs: Song[] = songData.map(record => record.song as Song);
