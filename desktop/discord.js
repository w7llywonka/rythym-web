// Discord Rich Presence ("Playing Line Rush: Psychic [EXPERT]") over Discord's local IPC socket.
// No dependency: each message is an 8-byte header (opcode, length, little-endian) plus JSON.
// Nothing happens unless Discord is running; it reconnects quietly when Discord starts later.
import net from 'node:net';
import { join } from 'node:path';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

export function encode(op, payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

/** splits a byte stream into messages; returns the leftover bytes */
export function decode(buffer, onMessage) {
  while (buffer.length >= 8) {
    const op = buffer.readInt32LE(0), len = buffer.readInt32LE(4);
    if (buffer.length < 8 + len) break;
    let data = null;
    try { data = JSON.parse(buffer.subarray(8, 8 + len).toString('utf8')); } catch { /* ignore a bad frame */ }
    onMessage(op, data);
    buffer = buffer.subarray(8 + len);
  }
  return buffer;
}

/** where Discord listens: a named pipe on Windows, a socket in the temp / runtime dir elsewhere */
export function ipcPaths(platform = process.platform, env = process.env) {
  const out = [];
  if (platform === 'win32') {
    for (let i = 0; i < 10; i++) out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return out;
  }
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  // the regular app, then the Flatpak and Snap builds
  for (const sub of ['', 'app/com.discordapp.Discord', 'snap.discord']) {
    for (let i = 0; i < 10; i++) out.push(join(base, sub, `discord-ipc-${i}`));
  }
  return out;
}

const clip = (s, max = 128) => {
  const t = String(s ?? '').trim();
  if (t.length < 2) return t ? `${t} ` : undefined; // Discord wants 2-128 characters
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** what the game reports -> a Discord activity */
export function toActivity(a, startedAt) {
  if (!a) return null;
  const activity = {
    details: clip(a.details), state: clip(a.state),
    assets: { large_image: 'logo', large_text: 'Line Rush' },
    instance: false,
  };
  if (typeof a.endsAt === 'number' && a.endsAt > Date.now()) activity.timestamps = { end: Math.round(a.endsAt) };
  else activity.timestamps = { start: startedAt };
  return activity;
}

/**
 * @param {{ clientId: string, connect?: (path: string) => import('node:net').Socket, paths?: string[],
 *           minInterval?: number, retryMs?: number }} options
 */
export function createPresence({ clientId, connect = path => net.createConnection(path), paths = ipcPaths(), minInterval = 4000, retryMs = 20_000 }) {
  let enabled = false, socket = null, ready = false, wanted = null, sent = undefined;
  let lastSend = 0, flushTimer = null, retryTimer = null, nonce = 0;
  const startedAt = Date.now();

  function cleanup() {
    ready = false;
    sent = undefined;
    if (socket) { socket.removeAllListeners(); socket.destroy(); socket = null; }
  }

  function scheduleRetry() {
    if (!enabled || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; tryConnect(0); }, retryMs);
    retryTimer.unref?.();
  }

  function tryConnect(i) {
    if (!enabled || socket) return;
    if (i >= paths.length) return scheduleRetry();
    const s = connect(paths[i]);
    let opened = false, pending = Buffer.alloc(0);
    socket = s;
    s.on('connect', () => {
      opened = true;
      s.write(encode(OP.HANDSHAKE, { v: 1, client_id: clientId }));
    });
    s.on('data', chunk => {
      pending = decode(Buffer.concat([pending, chunk]), (op, msg) => {
        if (op === OP.PING) s.write(encode(OP.PONG, msg ?? {}));
        else if (op === OP.CLOSE) s.destroy();
        else if (op === OP.FRAME && msg?.evt === 'READY') { ready = true; flush(); }
      });
    });
    s.on('error', () => {});
    s.on('close', () => {
      if (socket !== s) return;
      cleanup();
      // this pipe wasn't there: try the next one; a dropped connection waits and starts over
      if (!opened) tryConnect(i + 1); else scheduleRetry();
    });
  }

  function flush() {
    if (!ready || !socket) return;
    const key = JSON.stringify(wanted);
    if (key === sent) return;
    const wait = lastSend + minInterval - Date.now();
    if (wait > 0) {
      if (!flushTimer) { flushTimer = setTimeout(() => { flushTimer = null; flush(); }, wait); flushTimer.unref?.(); }
      return;
    }
    lastSend = Date.now();
    sent = key;
    socket.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: toActivity(wanted, startedAt) }, nonce: String(++nonce) }));
  }

  return {
    /** what to show (null clears it) */
    set(activity) { wanted = activity ?? null; flush(); },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on && !!clientId;
      if (enabled) tryConnect(0);
      else {
        clearTimeout(retryTimer); retryTimer = null;
        clearTimeout(flushTimer); flushTimer = null;
        cleanup();
      }
    },
    get connected() { return ready; },
    destroy() { this.setEnabled(false); },
  };
}
