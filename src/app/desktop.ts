// The Line Rush app (desktop) on top of the website: the APP panel (fullscreen, frame rate, Discord
// status, server, Songs folder, updates), the status shown on Discord, and songs picked up from the
// Songs folder. On the website the same button is a GET THE APP link instead.
import appConfig from '../../desktop/app-config.json';
import { MODES, STYLES } from '../config.ts';
import { MAX_IMPORT_BYTES } from '../custom.ts';
import { $, show, txt } from '../ui.ts';
import { game } from './services.ts';
import { saveNow } from './save.ts';
import { importFile } from './select.ts';
import { closeModal, onClick, openModal, setToggle, showToast } from './shell.ts';
import { S } from './state.ts';

interface DesktopInfo {
  version: string; platform: string; fullscreen: boolean; unlockFps: boolean; unlockFpsActive: boolean;
  discord: boolean; discordAvailable: boolean; server: string; songsDir: string;
  updates: boolean;
  update: { state: 'none' | 'available' | 'downloading' | 'ready'; version: string; percent: number };
}
interface SongFile { name: string; size: number; mtime: number }
type DesktopEvent =
  | { type: 'screenshot'; path: string } | { type: 'fullscreen'; on: boolean } | { type: 'songs-changed' }
  | { type: 'update'; update: DesktopInfo['update'] } | { type: 'closing' };
interface Activity { playing: boolean; details: string; state?: string; endsAt?: number }

/** what preload.cjs exposes; undefined on the website */
interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  setPref(key: string, value: unknown): Promise<{ ok: boolean; error?: string; info?: DesktopInfo }>;
  relaunch(): Promise<void>;
  openFolder(which: 'songs' | 'screenshots'): Promise<void>;
  listSongs(): Promise<SongFile[]>;
  readSong(name: string): Promise<Uint8Array | null>;
  checkUpdates(): Promise<'off' | 'busy' | 'latest' | 'found' | 'error'>;
  installUpdate(): Promise<void>;
  readyToClose(): Promise<void>;
  activity(a: Activity): void;
  onEvent(fn: (e: DesktopEvent) => void): () => void;
}

export const desktop = (window as unknown as { lineRushDesktop?: DesktopBridge }).lineRushDesktop;
export const isDesktop = !!desktop;

let info: DesktopInfo | null = null;

// ---- the APP panel ----------------------------------------------------------------------------
function refreshPanel() {
  if (!info) return;
  setToggle($('app.fullscreen.toggle'), info.fullscreen);
  setToggle($('app.fps.toggle'), info.unlockFps);
  txt($('app.fps.hint'), info.unlockFps !== info.unlockFpsActive
    ? 'Changes when the app restarts.'
    : 'Turns off V-Sync for less input lag. Restarts the app.');
  setToggle($('app.discord.toggle'), info.discordAvailable && info.discord);
  txt($('app.discord.hint'), info.discordAvailable
    ? "Shows the song you're playing on your Discord profile."
    : "This build has no Discord app ID (see the README).");
  const input = $('app.server.input') as HTMLInputElement;
  if (document.activeElement !== input) input.value = info.server;
  txt($('app.servermsg'), info.server ? `Online: ${info.server}` : 'No server set: you play offline as a guest.');
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform] ?? info.platform;
  txt($('app.version'), `Line Rush ${info.version}  ·  ${os}`);
  const u = info.update;
  show($('app.update'), u.state !== 'none');
  show($('app.check'), info.updates && u.state === 'none');
  txt($('app.update'), u.state === 'ready' ? 'RESTART TO UPDATE'
    : u.state === 'downloading' ? `DOWNLOADING ${u.version}  ${u.percent}%` : `GET ${u.version}`);
}

let checking = false;
async function checkForUpdates() {
  if (checking) return;
  checking = true;
  txt($('app.check'), 'CHECKING...');
  const result = await desktop!.checkUpdates().catch(() => 'error' as const);
  checking = false;
  txt($('app.check'), 'CHECK FOR UPDATES');
  if (result === 'latest') showToast(`You have the latest version (${info?.version ?? ''}).`);
  else if (result === 'error') showToast("Couldn't check for updates. Check your connection.");
  else if (result === 'off') showToast('This build of the app doesn\'t update itself.');
  // 'found' and 'busy' are shown by the update itself
}

async function openPanel() {
  info = await desktop!.info();
  openModal($('app'));
  refreshPanel();
}

async function setPref(key: string, value: unknown) {
  const res = await desktop!.setPref(key, value);
  if (!res.ok) { showToast(res.error ?? "Couldn't change that."); return null; }
  info = res.info ?? info;
  refreshPanel();
  return info;
}

async function saveServer() {
  const input = $('app.server.input') as HTMLInputElement;
  const before = info?.server;
  input.blur();
  const after = await setPref('server', input.value);
  if (!after || after.server === before) return;
  // start over against the new server (its own login, boards and 1v1)
  showToast(after.server ? 'Server saved. Connecting...' : 'Server removed. Playing offline.');
  await saveNow();
  setTimeout(() => location.reload(), 700);
}

// ---- Discord status + keeping the screen awake -------------------------------------------------
const title = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

function currentActivity(): Activity {
  const r = game.run;
  if (S.screen === 'game' && r) {
    const vs = r.opts?.versus;
    const style = STYLES[r.set.style];
    const left = (r.chartEnd - game.songTime(r)) / r.rate;
    const running = r.ready && !r.paused && !r.ended;
    return {
      playing: running,
      details: `${r.track.title} [${MODES[r.chartDiff].label}]`,
      state: vs ? `1v1 vs ${vs.opponent}` : r.paused ? 'Paused'
        : `${title(style.label)}${r.rate !== 1 ? ` · ${r.rate}x` : ''}`,
      endsAt: running && !r.practice && left > 0 ? Date.now() + left * 1000 : undefined,
    };
  }
  const res = S.lastResult;
  if (S.screen === 'results' && res) {
    return { playing: false, details: `${res.title} [${MODES[res.diff].label}]`, state: `${res.grade} · ${res.accuracy.toFixed(2)}%` };
  }
  return { playing: false, details: S.screen === 'select' ? 'Picking a song' : 'In the menus' };
}

let sent: Activity | null = null;
function reportActivity() {
  const a = currentActivity();
  const drift = Math.abs((a.endsAt ?? 0) - (sent?.endsAt ?? 0));
  if (sent && a.playing === sent.playing && a.details === sent.details && a.state === sent.state && drift < 3000) return;
  sent = a;
  desktop!.activity(a);
}

// ---- the Songs folder ---------------------------------------------------------------------------
// files already brought in (name + size + date), so each is imported once, and a song removed in the
// game isn't added back
const SEEN_KEY = 'lineRush.desktop.songsFolder';
function seen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
let syncing = false, again = false;

async function syncSongsFolder() {
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    const files = await desktop!.listSongs();
    const known = seen();
    for (const f of files) {
      if (S.screen !== 'select') break; // never chart a song in the middle of a run; next visit picks it up
      const key = `${f.name}|${f.size}|${f.mtime}`;
      if (known[key]) continue;
      known[key] = Date.now();
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(known)); } catch { /* storage full */ }
      const fileName = f.name.slice(f.name.lastIndexOf('/') + 1); // "Album/song.mp3" -> "song.mp3"
      if (f.size > MAX_IMPORT_BYTES) { showToast(`${fileName} is over 40 MB, so it wasn't added.`); continue; }
      const bytes = await desktop!.readSong(f.name);
      if (bytes) await importFile(new File([bytes as Uint8Array<ArrayBuffer>], fileName));
    }
  } catch { /* folder unreadable: nothing to add */ }
  syncing = false;
  if (again) { again = false; void syncSongsFolder(); }
}

// ---- events from the app ------------------------------------------------------------------------
function onEvent(e: DesktopEvent) {
  if (e.type === 'screenshot') showToast('Screenshot saved in Pictures / Line Rush');
  else if (e.type === 'songs-changed') { if (S.screen === 'select') void syncSongsFolder(); }
  else if (e.type === 'fullscreen') { if (info) { info.fullscreen = e.on; refreshPanel(); } }
  else if (e.type === 'update') {
    const before = info?.update.state;
    if (info) { info.update = e.update; refreshPanel(); }
    if (e.update.state === before) return; // download progress: the APP panel shows it
    if (e.update.state === 'ready') showToast(`Update ${e.update.version} is ready. Restart the game to install it.`);
    else if (e.update.state === 'available') showToast(`Line Rush ${e.update.version} is out! Get it under APP.`);
    else if (e.update.state === 'downloading') showToast(`Downloading Line Rush ${e.update.version} in the background...`);
  } else if (e.type === 'closing') {
    // the window is closing: write the save first (the website can only hope a beacon gets out)
    void saveNow().catch(() => {}).finally(() => void desktop!.readyToClose());
  }
}

export function initDesktop() {
  const btn = $('home.app');
  show(btn, true);
  if (!desktop) {
    onClick('home.app', () => window.open(appConfig.releases, '_blank', 'noopener,noreferrer'));
    return;
  }
  txt(btn, 'APP');
  btn.style.width = '84px';
  document.documentElement.classList.add('desktop');

  onClick('home.app', () => void openPanel());
  onClick('app.close', closeModal);
  onClick('app.fullscreen.toggle', () => void setPref('fullscreen', !info?.fullscreen));
  onClick('app.fps.toggle', async () => {
    const next = await setPref('unlockFps', !info?.unlockFps);
    if (next && next.unlockFps !== next.unlockFpsActive) {
      showToast('Restarting with the new frame rate...');
      await saveNow();
      setTimeout(() => void desktop.relaunch(), 800);
    }
  });
  onClick('app.discord.toggle', () => {
    if (!info?.discordAvailable) return showToast("Discord status isn't set up in this build.");
    void setPref('discord', !info.discord);
  });
  onClick('app.server.save', () => void saveServer());
  ($('app.server.input') as HTMLInputElement).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void saveServer(); }
  });
  onClick('app.songs', () => void desktop.openFolder('songs'));
  onClick('app.shots', () => void desktop.openFolder('screenshots'));
  onClick('app.update', () => {
    const u = info?.update;
    if (u?.state === 'ready') {
      showToast('Saving and restarting to update...');
      void desktop.installUpdate();
    } else if (u?.state === 'downloading') showToast(`Still downloading (${u.percent}%). It's ready in a moment.`);
    else window.open(appConfig.releases, '_blank', 'noopener,noreferrer');
  });
  onClick('app.check', () => void checkForUpdates());

  desktop.onEvent(onEvent);
  void desktop.info().then(i => { info = i; });

  // status + the Songs folder follow the screen the player is on
  let lastScreen = S.screen;
  setInterval(() => {
    reportActivity();
    if (S.screen !== lastScreen) {
      lastScreen = S.screen;
      if (S.screen === 'select') void syncSongsFolder();
    }
  }, 1000);
  reportActivity();
}
