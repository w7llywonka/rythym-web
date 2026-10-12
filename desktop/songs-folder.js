// The Songs folder (Documents/Line Rush/Songs): audio files dropped in here are imported by the game
// the next time song select opens, like an osu! Songs folder. Files directly inside it and in its
// folders (an album folder dropped in as it is) are listed; a song in a folder is named "Album/song.mp3".
// Only real files are read: never a link, never anything outside the folder.
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm']);
export const MAX_SONG_BYTES = 40 * 1024 * 1024; // the most the game imports
export const MAX_LISTED = 500;

// one file or folder name: no separators, no "..", nothing hidden (Windows ":" would be a hidden stream)
const plain = name => typeof name === 'string' && name.length > 0 && name.length <= 255
  && !name.startsWith('.') && !/[\\/:\0]/.test(name);
const isAudio = name => plain(name) && AUDIO_EXTS.has(extname(name).toLowerCase());

/** "song.mp3" or "Album/song.mp3" as path parts, or null if the name isn't a song in the folder */
function songParts(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('/');
  return parts.length <= 2 && parts.every(plain) && isAudio(parts.at(-1)) ? parts : null;
}

/** @returns {Promise<{ name: string, size: number, mtime: number }[]>} oldest first */
export async function listSongs(dir) {
  await mkdir(dir, { recursive: true });
  const names = [];
  // Dirent types come from the folder listing itself, so links are neither files nor folders here
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && isAudio(entry.name)) names.push(entry.name);
    else if (entry.isDirectory() && plain(entry.name)) {
      const inner = await readdir(join(dir, entry.name), { withFileTypes: true }).catch(() => []);
      for (const f of inner) if (f.isFile() && isAudio(f.name)) names.push(`${entry.name}/${f.name}`);
    }
    if (names.length >= MAX_LISTED) break;
  }
  const out = [];
  for (const name of names.slice(0, MAX_LISTED)) {
    const info = await lstat(join(dir, ...name.split('/'))).catch(() => null);
    if (info?.isFile() && info.size > 0) out.push({ name, size: info.size, mtime: Math.round(info.mtimeMs) });
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
}

/** a song file's bytes, or null if the name isn't a real audio file in the folder (or is too big) */
export async function readSong(dir, name) {
  const parts = songParts(name);
  if (!parts) return null;
  if (parts.length === 2 && !(await lstat(join(dir, parts[0])).catch(() => null))?.isDirectory()) return null;
  const path = join(dir, ...parts);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.size > MAX_SONG_BYTES) return null;
  return readFile(path);
}
