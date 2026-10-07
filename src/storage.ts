// Saves Line Rush settings, bests, recent songs and profile in this browser (localStorage).
// Everything loaded is sanitized the same way the Roblox server does before trusting it.
import { DEFAULT_SETTINGS, HIT_SOUNDS, MODES, RATES, STYLES } from './config.ts';
import { NOTE_SIZE, NOTE_STYLES } from './look.ts';
import type { Bests, Diff, Profile, RecentEntry, SaveData, Settings } from './types.ts';

export const STORAGE_KEY = 'lineRush.save.v2';

export function defaultProfile(): Profile {
  return {
    xp: 0, plays: 0, notesHit: 0, fcs: 0, ss: 0, playSeconds: 0,
    streak: 0, bestStreak: 0, lastDay: 0, title: '', achievements: {}, packs: {}, weekly: {},
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keyOk = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9]{1,24}$/.test(k);

export function sanitizeSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  const out: Settings = { ...DEFAULT_SETTINGS, keys: [...DEFAULT_SETTINGS.keys], laneColors: [...DEFAULT_SETTINGS.laneColors] };
  if (Array.isArray(s.keys) && keyOk(s.keys[0]) && keyOk(s.keys[1]) && s.keys[0] !== s.keys[1]) {
    const third = keyOk(s.keys[2]) && s.keys[2] !== s.keys[0] && s.keys[2] !== s.keys[1] ? s.keys[2] : DEFAULT_SETTINGS.keys[2];
    out.keys = [s.keys[0], s.keys[1], third];
  }
  out.scrollSpeed = num(s.scrollSpeed, 0.5, 3, 1);
  out.offset = Math.round(num(s.offset, -300, 300, 0));
  out.musicVolume = num(s.musicVolume, 0, 1, 0.8);
  out.effects = s.effects !== false;
  out.centerHud = s.centerHud === true;
  out.hitZone = s.hitZone !== false;
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : fallback);
  if (Array.isArray(s.laneColors)) {
    out.laneColors = [hex(s.laneColors[0], DEFAULT_SETTINGS.laneColors[0]), hex(s.laneColors[1], DEFAULT_SETTINGS.laneColors[1])];
  }
  out.chordColor = hex(s.chordColor, DEFAULT_SETTINGS.chordColor);
  out.noteStyle = NOTE_STYLES.includes(s.noteStyle as never) ? (s.noteStyle as Settings['noteStyle']) : DEFAULT_SETTINGS.noteStyle;
  out.noteSize = Math.round(num(s.noteSize, NOTE_SIZE.min, NOTE_SIZE.max, DEFAULT_SETTINGS.noteSize) / 2) * 2;
  out.hitSound = HIT_SOUNDS.includes(s.hitSound as never) ? (s.hitSound as Settings['hitSound']) : 'TICK';
  out.style = typeof s.style === 'string' && s.style in STYLES ? (s.style as Settings['style']) : 'Classic';
  out.rate = RATES.includes(s.rate as number) ? (s.rate as number) : 1;
  for (const mod of ['hidden', 'sudden', 'flashlight', 'mirror', 'random', 'wave', 'mines'] as const) out[mod] = s[mod] === true;
  return out;
}

function sanitizeBests(raw: unknown): Bests {
  const out: Bests = {};
  if (!isObj(raw)) return out;
  let count = 0;
  for (const [id, b] of Object.entries(raw)) {
    if (id.length > 64 || !isObj(b) || typeof b.score !== 'number') continue;
    if (++count > 200) break;
    out[id] = {
      score: Math.floor(num(b.score, 0, 1e9, 0)),
      accuracy: num(b.accuracy, 0, 100, 0),
      combo: Math.floor(num(b.combo, 0, 1e6, 0)),
      grade: typeof b.grade === 'string' && ['SS', 'S', 'A', 'B', 'C', 'D', 'F'].includes(b.grade) ? (b.grade as never) : 'D',
      fc: b.fc === true,
    };
  }
  return out;
}

function sanitizeRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentEntry[] = [];
  for (const e of raw.slice(0, 10)) {
    if (isObj(e) && typeof e.id === 'string' && e.id.length <= 64 && typeof e.chart === 'string' && e.chart in MODES) {
      out.push({ id: e.id, chart: e.chart as Diff });
    }
  }
  return out;
}

function sanitizeProfile(raw: unknown): Profile {
  const p = isObj(raw) ? raw : {};
  const out = defaultProfile();
  out.xp = Math.floor(num(p.xp, 0, 1e9, 0));
  out.plays = Math.floor(num(p.plays, 0, 1e7, 0));
  out.notesHit = Math.floor(num(p.notesHit, 0, 1e9, 0));
  out.fcs = Math.floor(num(p.fcs, 0, 1e7, 0));
  out.ss = Math.floor(num(p.ss, 0, 1e7, 0));
  out.playSeconds = Math.floor(num(p.playSeconds, 0, 1e9, 0));
  out.streak = Math.floor(num(p.streak, 0, 1e5, 0));
  out.bestStreak = Math.floor(num(p.bestStreak, 0, 1e5, 0));
  out.lastDay = Math.floor(num(p.lastDay, 0, 1e7, 0));
  out.title = typeof p.title === 'string' && p.title.length <= 24 ? p.title : '';
  for (const field of ['achievements', 'packs'] as const) {
    const src = p[field];
    if (isObj(src)) for (const [id, v] of Object.entries(src)) if (id.length <= 32 && v === true) out[field][id] = true;
  }
  if (isObj(p.weekly)) {
    for (const [week, score] of Object.entries(p.weekly)) {
      if (/^\d{1,6}$/.test(week)) out.weekly[week] = Math.floor(num(score, 0, 1e9, 0));
    }
  }
  return out;
}

export function sanitize(raw: unknown): SaveData {
  const d = isObj(raw) ? raw : {};
  return {
    settings: sanitizeSettings(d.settings),
    bests: sanitizeBests(d.bests),
    recent: sanitizeRecent(d.recent),
    profile: sanitizeProfile(d.profile),
  };
}

// reading localStorage itself can throw (blocked site data, sandboxed frames)
function browserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function load(storage: Pick<Storage, 'getItem'> | null = browserStorage()): SaveData {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return sanitize(null);
  }
}

export function save(data: SaveData, storage: Pick<Storage, 'setItem'> | null = browserStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// ---- imported songs stay on this computer ---------------------------------------------------
// Bests and Recent entries for imported songs ("custom-...") are never sent to the account; they're
// kept in their own localStorage entry and merged back in.
export const IMPORT_PROGRESS_KEY = 'lineRush.importProgress';
export const isImportId = (id: string) => id.startsWith('custom-');

/** the save without anything about imported songs (what goes to the server) */
export function withoutImports(data: SaveData): SaveData {
  return {
    ...data,
    bests: Object.fromEntries(Object.entries(data.bests).filter(([id]) => !isImportId(id))),
    recent: data.recent.filter(e => !isImportId(e.id)),
  };
}

export function saveImportProgress(data: SaveData, storage: Pick<Storage, 'setItem'> | null = browserStorage()) {
  const bests = Object.fromEntries(Object.entries(data.bests).filter(([id]) => isImportId(id)));
  const recent = data.recent.filter(e => isImportId(e.id));
  try { storage?.setItem(IMPORT_PROGRESS_KEY, JSON.stringify({ bests, recent })); } catch { /* storage full or blocked */ }
}

/** put this computer's imported-song progress back into a save (after loading it from the account) */
export function withImportProgress(data: SaveData, storage: Pick<Storage, 'getItem'> | null = browserStorage()): SaveData {
  let raw: unknown = null;
  try { raw = JSON.parse(storage?.getItem(IMPORT_PROGRESS_KEY) ?? 'null'); } catch { /* broken entry */ }
  const local = sanitize(raw && typeof raw === 'object' ? { bests: (raw as SaveData).bests, recent: (raw as SaveData).recent } : null);
  const bests = { ...data.bests };
  for (const [id, b] of Object.entries(local.bests)) if (isImportId(id)) bests[id] = b;
  const recent = [...data.recent, ...local.recent.filter(e => isImportId(e.id) && !data.recent.some(r => r.id === e.id))];
  return { ...data, bests, recent };
}
