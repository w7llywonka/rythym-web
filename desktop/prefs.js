// App-only preferences (the game's own settings stay in the game save): window, frame rate, Discord,
// which server to use. Kept as JSON in the app's data folder.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { normalizeServer } from './api-proxy.js';

export function defaultPrefs(config = {}) {
  return {
    fullscreen: false,
    unlockFps: false,
    discord: true,
    server: normalizeServer(config.server ?? '') || '',
    bounds: null,
  };
}

const isInt = v => Number.isInteger(v) && Math.abs(v) < 100_000;

export function sanitizePrefs(raw, config = {}) {
  const out = defaultPrefs(config);
  if (typeof raw !== 'object' || raw === null) return out;
  for (const key of ['fullscreen', 'unlockFps', 'discord']) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if (typeof raw.server === 'string') {
    const s = normalizeServer(raw.server);
    if (s !== null) out.server = s;
  }
  const b = raw.bounds;
  if (b && isInt(b.x) && isInt(b.y) && isInt(b.width) && isInt(b.height) && b.width >= 400 && b.height >= 300) {
    out.bounds = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: b.maximized === true };
  }
  return out;
}

export function loadPrefs(path, config) {
  try { return sanitizePrefs(JSON.parse(readFileSync(path, 'utf8')), config); } catch { return defaultPrefs(config); }
}

export function savePrefs(path, prefs) {
  try {
    // write then rename, so a crash mid-write never leaves a broken file
    writeFileSync(`${path}.tmp`, JSON.stringify(prefs, null, 2));
    renameSync(`${path}.tmp`, path);
  } catch { /* read-only disk: keep going with what's in memory */ }
}
