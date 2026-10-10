// Line Rush desktop app (Electron). The game is the website's build (dist/), served from the app's
// own origin app://line-rush/ so it loads instantly and plays offline. On top of the website it adds:
//  - real fullscreen (F11 / Alt+Enter) where Escape still pauses instead of leaving fullscreen
//  - an unlocked frame rate (no V-Sync) for lower input-to-screen lag
//  - Discord status showing the song you're playing
//  - a Songs folder: audio files dropped in there are imported automatically
//  - screenshots with F12, music that starts without a click, no sleep while playing
//  - logins kept in the OS keychain (safeStorage), automatic updates
import { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, protocol, safeStorage, screen, session, shell } from 'electron';
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import updater from 'electron-updater';
import { createApiProxy, normalizeServer } from './api-proxy.js';
import { createPresence } from './discord.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { createAppHandler, HOST, ORIGIN, SCHEME } from './protocol.js';
import { listSongs, readSong } from './songs-folder.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'app-config.json'), 'utf8'));
// for testing against another server: LINE_RUSH_SERVER=http://localhost:5173 npm run app
if (process.env.LINE_RUSH_SERVER) config.server = process.env.LINE_RUSH_SERVER;
if (process.env.LINE_RUSH_DISCORD_ID) config.discordClientId = process.env.LINE_RUSH_DISCORD_ID;

if (!app.requestSingleInstanceLock()) app.exit(0);

const prefsPath = join(app.getPath('userData'), 'prefs.json');
const prefs = loadPrefs(prefsPath, config);
const savePrefsNow = () => savePrefs(prefsPath, prefs);
const songsDir = join(app.getPath('documents'), 'Line Rush', 'Songs');
const shotsDir = join(app.getPath('pictures'), 'Line Rush');

// frame rate: Chromium normally waits for V-Sync; unlocked, frames show the moment they're drawn
if (prefs.unlockFps) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
// it's a game: the menu music may start without a click first
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

// ---- the login session: kept by the app (encrypted with the OS keychain), never by the page ----
const vaultPath = join(app.getPath('userData'), 'session.json');
let vaultData = {};
try { vaultData = JSON.parse(readFileSync(vaultPath, 'utf8')) ?? {}; } catch { /* first run */ }
const vault = {
  get(origin) {
    const v = vaultData[origin];
    if (!v || typeof v.data !== 'string') return null;
    try {
      const bytes = Buffer.from(v.data, 'base64');
      const cookie = v.enc ? safeStorage.decryptString(bytes) : bytes.toString('utf8');
      return { cookie, expires: typeof v.expires === 'number' ? v.expires : null };
    } catch { return null; }
  },
  set(origin, value) {
    if (!value) delete vaultData[origin];
    else {
      const enc = safeStorage.isEncryptionAvailable();
      const bytes = enc ? safeStorage.encryptString(value.cookie) : Buffer.from(value.cookie, 'utf8');
      vaultData[origin] = { data: bytes.toString('base64'), enc, expires: value.expires };
    }
    try { writeFileSync(vaultPath, JSON.stringify(vaultData), { mode: 0o600 }); } catch { /* keep it in memory */ }
  },
};

const presence = createPresence({ clientId: config.discordClientId });
let win = null;
let sleepBlocker = null;
let update = { state: 'none', version: '' };

function send(event) {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:event', event);
}

// ---- window ----
function visibleBounds(b) {
  if (!b) return null;
  // only reuse the saved spot if it's still on a connected screen
  const onScreen = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100;
  });
  return onScreen ? b : null;
}

function toggleFullscreen(on = !win.isFullScreen()) {
  win.setFullScreen(on);
}

async function screenshot() {
  if (!win) return null;
  const image = await win.webContents.capturePage();
  mkdirSync(shotsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '-');
  const path = join(shotsDir, `Line Rush ${stamp}.png`);
  await writeFile(path, image.toPNG());
  send({ type: 'screenshot', path });
  return path;
}

function createWindow() {
  const bounds = visibleBounds(prefs.bounds);
  win = new BrowserWindow({
    width: bounds?.width ?? 1280, height: bounds?.height ?? 760,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 800, minHeight: 480,
    backgroundColor: '#000000',
    title: 'Line Rush',
    icon: join(here, 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    fullscreen: prefs.fullscreen,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // keep the game clock, 1v1 updates and music going when the window is in the background
      backgroundThrottling: false,
    },
  });
  if (bounds?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // game keys the browser can't offer: fullscreen and screenshots, handled before the page sees them
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const fullscreenKey = input.code === 'F11' || (input.code === 'Enter' && input.alt) || (input.code === 'KeyF' && input.meta && input.control);
    if (fullscreenKey) { event.preventDefault(); toggleFullscreen(); }
    else if (input.code === 'F12') { event.preventDefault(); void screenshot(); }
    else if (!app.isPackaged && input.code === 'KeyI' && input.shift && (input.control || input.meta)) win.webContents.toggleDevTools();
  });

  const remember = () => {
    if (win.isFullScreen() || win.isMinimized()) return;
    prefs.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  };
  win.on('resize', remember);
  win.on('move', remember);
  for (const [evt, on] of [['enter-full-screen', true], ['leave-full-screen', false]]) {
    win.on(evt, () => { prefs.fullscreen = on; savePrefsNow(); send({ type: 'fullscreen', on }); });
  }
  // closing: the game writes its save first (up to 3 s), so a logged-in player's last run isn't lost
  let closing = false;
  win.on('close', event => {
    remember();
    savePrefsNow();
    if (closing) return;
    event.preventDefault();
    closing = true;
    const done = () => { clearTimeout(timer); ipcMain.removeHandler('desktop:ready-to-close'); if (win && !win.isDestroyed()) win.destroy(); };
    const timer = setTimeout(done, 3000);
    ipcMain.removeHandler('desktop:ready-to-close');
    handle('desktop:ready-to-close', done);
    send({ type: 'closing' });
  });
  win.on('closed', () => { win = null; });

  // links (credits, releases) open in the real browser; the game itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });

  void win.loadURL(`${ORIGIN}/`);
}

// ---- messages from the game ----
const fromGame = event => {
  try { return new URL(event.senderFrame?.url ?? '').host === HOST; } catch { return false; }
};
const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
  if (!fromGame(event)) throw new Error('not allowed');
  return fn(...args);
});

function info() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    fullscreen: win?.isFullScreen() ?? prefs.fullscreen,
    unlockFps: prefs.unlockFps,
    unlockFpsActive: app.commandLine.hasSwitch('disable-gpu-vsync'),
    discord: prefs.discord,
    discordAvailable: !!config.discordClientId,
    server: prefs.server,
    songsDir,
    update,
  };
}

function setPref(key, value) {
  if (key === 'fullscreen' && typeof value === 'boolean') toggleFullscreen(value);
  else if (key === 'unlockFps' && typeof value === 'boolean') prefs.unlockFps = value;
  else if (key === 'discord' && typeof value === 'boolean') {
    prefs.discord = value;
    presence.setEnabled(value);
  } else if (key === 'server' && typeof value === 'string') {
    const server = normalizeServer(value);
    if (server === null) return { ok: false, error: 'Use the https:// address of a Line Rush server.' };
    prefs.server = server;
  } else return { ok: false, error: 'Unknown setting.' };
  savePrefsNow();
  return { ok: true, info: info() };
}

function registerIpc() {
  handle('desktop:info', info);
  handle('desktop:set-pref', setPref);
  handle('desktop:relaunch', () => { app.relaunch(); app.quit(); });
  handle('desktop:screenshot', screenshot);
  handle('desktop:open-folder', async which => {
    const dir = which === 'screenshots' ? shotsDir : songsDir;
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });
  handle('desktop:list-songs', () => listSongs(songsDir));
  handle('desktop:read-song', async name => {
    const bytes = await readSong(songsDir, name);
    return bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  });
  handle('desktop:install-update', () => {
    if (update.state === 'ready') updater.autoUpdater.quitAndInstall();
  });
  // what's on screen: drives Discord status and keeps the display awake during a song
  ipcMain.on('desktop:activity', (event, a) => {
    if (!fromGame(event) || typeof a !== 'object' || a === null) return;
    const playing = a.playing === true;
    if (playing && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!playing && sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
    presence.set({
      details: typeof a.details === 'string' ? a.details.slice(0, 128) : 'In the menus',
      state: typeof a.state === 'string' ? a.state.slice(0, 128) : undefined,
      endsAt: typeof a.endsAt === 'number' && Number.isFinite(a.endsAt) ? a.endsAt : undefined,
    });
  });
}

// new files in the Songs folder are picked up while the game runs
function watchSongs() {
  try {
    mkdirSync(songsDir, { recursive: true });
    let timer = null;
    watch(songsDir, () => {
      clearTimeout(timer);
      timer = setTimeout(() => send({ type: 'songs-changed' }), 1500); // wait for copies to finish
    }).on('error', () => {});
  } catch { /* no Documents folder: the button still makes one */ }
}

// updates come from GitHub Releases. Windows / Linux install on quit; macOS builds aren't signed,
// so there the game only says a new version is out and links to it.
function checkUpdates() {
  if (!app.isPackaged || process.env.LINE_RUSH_NO_UPDATES) return;
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => { update = { state: 'available', version: i.version }; send({ type: 'update', update }); });
  autoUpdater.on('update-downloaded', i => { update = { state: 'ready', version: i.version }; send({ type: 'update', update }); });
  autoUpdater.on('error', () => {});
  void autoUpdater.checkForUpdates().catch(() => {});
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  const dist = join(here, 'web');
  const api = createApiProxy({
    server: () => prefs.server,
    vault,
    userAgent: `LineRush-Desktop/${app.getVersion()} (${process.platform})`,
  });
  protocol.handle(SCHEME, createAppHandler({ dist, api }));
  // the game asks for nothing (no camera, mic, location, notifications...)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false));

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null); // no Ctrl+R / Ctrl+W to lose a run by accident
  }

  registerIpc();
  createWindow();
  presence.setEnabled(prefs.discord);
  watchSongs();
  checkUpdates();

  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  presence.destroy();
  app.quit();
});
