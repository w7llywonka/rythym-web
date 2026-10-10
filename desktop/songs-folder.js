// The Songs folder (Documents/Line Rush/Songs): audio files dropped in here are imported by the game
// the next time song select opens, like an osu! Songs folder. Only plain audio files directly inside
// the folder are listed or read; names that try to leave the folder are refused.
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm']);
export const MAX_SONG_BYTES = 200 * 1024 * 1024;

const okName = name => typeof name === 'string' && name.length > 0 && name.length <= 255
  && basename(name) === name && !name.startsWith('.') && AUDIO_EXTS.has(extname(name).toLowerCase());

/** @returns {Promise<{ name: string, size: number, mtime: number }[]>} oldest first */
export async function listSongs(dir) {
  await mkdir(dir, { recursive: true });
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !okName(entry.name)) continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (info && info.size > 0 && info.size <= MAX_SONG_BYTES) out.push({ name: entry.name, size: info.size, mtime: Math.round(info.mtimeMs) });
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
}

/** a song file's bytes, or null if the name isn't an audio file in the folder */
export async function readSong(dir, name) {
  if (!okName(name)) return null;
  const path = join(dir, name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size > MAX_SONG_BYTES) return null;
  return readFile(path);
}
