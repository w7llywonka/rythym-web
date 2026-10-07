import type { Best, Bests, Grade, Result, Settings } from './types.ts';

const settingsKey = 'line-rush.settings.v1';
const bestsKey = 'line-rush.bests.v1';
const clearGrades: Grade[] = ['SS', 'S', 'A', 'B', 'C', 'D'];

function defaults(): Settings {
  return { keys: ['f', 'j'], scrollSpeed: 1, offsetMs: 0, volume: 0.7, effects: true };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

function key(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  const named = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'enter', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'capslock', 'numlock', 'scrolllock', 'pause', 'clear', 'contextmenu'];
  const printable = normalized.length === 1 && normalized.charCodeAt(0) >= 32 && normalized.charCodeAt(0) !== 127;
  return normalized !== '/' && (printable || named.includes(normalized) || /^f([1-9]|1\d|2[0-4])$/.test(normalized)) ? normalized : null;
}

export function isBindableKey(value: unknown): value is string { return key(value) !== null; }

export function normaliseSettings(value: unknown): Settings {
  const result = defaults();
  if (!object(value)) return result;
  if (Array.isArray(value.keys) && value.keys.length === 2) {
    const left = key(value.keys[0]);
    const right = key(value.keys[1]);
    if (left && right && left !== right) result.keys = [left, right];
  }
  result.scrollSpeed = bounded(value.scrollSpeed, result.scrollSpeed, 0.5, 3);
  result.offsetMs = Math.round(bounded(value.offsetMs, result.offsetMs, -300, 300) / 5) * 5;
  result.volume = bounded(value.volume, result.volume, 0, 1);
  if (typeof value.effects === 'boolean') result.effects = value.effects;
  return result;
}

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Browsers may block storage, and old or manually edited saves may be invalid.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exhaustion or disabled storage must never interrupt a song.
  }
}

export function loadSettings(): Settings {
  return normaliseSettings(read(settingsKey));
}

export function saveSettings(settings: Settings): void {
  write(settingsKey, normaliseSettings(settings));
}

function validBest(value: unknown): value is Best {
  if (!object(value)) return false;
  return typeof value.score === 'number' && Number.isSafeInteger(value.score) && value.score >= 0
    && typeof value.accuracy === 'number' && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 100
    && typeof value.maxCombo === 'number' && Number.isSafeInteger(value.maxCombo) && value.maxCombo >= 0
    && typeof value.grade === 'string' && clearGrades.includes(value.grade as Grade)
    && typeof value.fullCombo === 'boolean';
}

function record(value: Best): Best {
  return { score: value.score, accuracy: value.accuracy, maxCombo: value.maxCombo, grade: value.grade, fullCombo: value.fullCombo };
}

function validSongId(value: string): boolean {
  return value.length > 0 && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

export function loadBests(): Bests {
  const stored = read(bestsKey);
  const result: Bests = {};
  if (!object(stored)) return result;
  for (const [songId, value] of Object.entries(stored)) {
    if (validSongId(songId) && validBest(value)) result[songId] = record(value);
  }
  return result;
}

export function saveBest(result: Result): boolean {
  if (result.failed || !validSongId(result.songId) || !validBest(result)) return false;
  const bests = loadBests();
  const previous = bests[result.songId];
  const newBest = !previous || result.score > previous.score;
  const fullCombo = result.fullCombo || Boolean(previous?.fullCombo);
  if (newBest) bests[result.songId] = { ...record(result), fullCombo };
  else if (fullCombo && !previous.fullCombo) bests[result.songId] = { ...previous, fullCombo };
  else return false;
  write(bestsKey, bests);
  return newBest;
}
