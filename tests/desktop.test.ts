// The desktop app's main-process pieces (desktop/*.js), run under plain Node: serving the game,
// the /api proxy and its login cookie, Discord status, the Songs folder and app preferences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, fromNode, sendNode } from '../api/_lib/core.js';
import { memoryStore } from '../api/_lib/store.js';
import { createApiProxy, normalizeServer, parseSetCookie } from '../desktop/api-proxy.js';
import { createPresence, decode, encode, ipcPaths, toActivity } from '../desktop/discord.js';
import { sanitizePrefs } from '../desktop/prefs.js';
import { createAppHandler, ORIGIN } from '../desktop/protocol.js';
import { listSongs, readSong } from '../desktop/songs-folder.js';

const tmp = () => mkdtemp(join(tmpdir(), 'linerush-desktop-'));

function memoryVault() {
  const data = new Map<string, { cookie: string; expires: number | null }>();
  return { data, get: (o: string) => data.get(o) ?? null, set: (o: string, v: { cookie: string; expires: number | null } | null) => { if (v) data.set(o, v); else data.delete(o); } };
}

async function startServer() {
  const handle = createAuth(memoryStore(), { scrypt: { N: 1024, r: 8, p: 1 } });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    sendNode(res, await handle(await fromNode(req, url.pathname.slice(5), { trustProxy: false })));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

const apiCall = (handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown, header = true) =>
  handler(new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: { ...(header ? { 'X-LineRush': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));

test('the app origin serves the game from web/, never files outside it, and routes /api', async () => {
  const dist = await tmp();
  await mkdir(join(dist, 'music'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Line Rush</title>');
  await writeFile(join(dist, 'music', 'song.mp3'), Buffer.from([1, 2, 3]));
  const handler = createAppHandler({ dist, api: async () => new Response('api') });

  let r = await handler(new Request(`${ORIGIN}/`));
  assert.match(await r.text(), /Line Rush/);
  assert.ok(r.headers.get('content-security-policy')?.includes("connect-src 'self'"));
  r = await handler(new Request(`${ORIGIN}/music/song.mp3`));
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  for (const path of ['/..%2fpackage.json', '/%2e%2e/main.js', '/some/route', '/%E0%A4%A']) {
    r = await handler(new Request(`${ORIGIN}${path}`));
    assert.match(await r.text(), /<title>Line Rush/, path);
  }
  assert.equal(await (await handler(new Request(`${ORIGIN}/api/auth/me`))).text(), 'api');
  assert.equal((await handler(new Request('app://elsewhere/'))).status, 404);
  assert.equal((await handler(new Request(`${ORIGIN}/`, { method: 'POST', body: 'x' }))).status, 405);
});

test('server addresses: https anywhere, http only on this computer', () => {
  assert.equal(normalizeServer('line-rush.example.com'), 'https://line-rush.example.com');
  assert.equal(normalizeServer('https://line-rush.example.com/play?x=1'), 'https://line-rush.example.com');
  assert.equal(normalizeServer('http://localhost:5173/'), 'http://localhost:5173');
  assert.equal(normalizeServer(''), '');
  assert.equal(normalizeServer('http://line-rush.example.com'), null);
  assert.equal(normalizeServer('https://user:pw@example.com'), null);
  assert.equal(normalizeServer('ftp://example.com'), null);
});

test('Set-Cookie: keeps name=value and lifetime, notices a cleared cookie', () => {
  assert.deepEqual(parseSetCookie('__Host-lr_session=abc; Max-Age=60; Path=/; HttpOnly; Secure', 1000), { name: '__Host-lr_session', cookie: '__Host-lr_session=abc', expires: 61_000 });
  assert.deepEqual(parseSetCookie('lr_session=; Max-Age=0; Path=/', 1000), { name: 'lr_session', cookie: null, expires: 0 });
  assert.equal(parseSetCookie('garbage'), null);
});

test('the API proxy logs in against the real server and keeps the cookie away from the page', async () => {
  const server = await startServer();
  try {
    const vault = memoryVault();
    let target = '';
    const proxy = createApiProxy({ server: () => target, vault });
    const handler = createAppHandler({ dist: await tmp(), api: proxy });

    // no server set: the game sees "accounts offline" and plays as a guest
    let r = await apiCall(handler, 'GET', 'auth/me');
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /Online play is off/);

    target = server.base;
    r = await apiCall(handler, 'GET', 'auth/me');
    assert.equal(r.status, 401);

    r = await apiCall(handler, 'POST', 'auth/register', { username: 'desk_player', password: 'a long enough passphrase' });
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal(r.headers.get('set-cookie'), null, 'the page never sees the session cookie');
    assert.match(vault.get(server.base)?.cookie ?? '', /^lr_session=/);

    r = await apiCall(handler, 'GET', 'auth/me');
    assert.equal((await r.json()).user.username, 'desk_player');

    // the server's CSRF guard still applies to whatever the page sends
    r = await apiCall(handler, 'GET', 'auth/me', undefined, false);
    assert.equal(r.status, 403);

    r = await apiCall(handler, 'POST', 'auth/logout', {});
    assert.equal(r.status, 200);
    assert.equal(vault.get(server.base), null, 'logging out forgets the cookie');
    assert.equal((await apiCall(handler, 'GET', 'auth/me')).status, 401);
  } finally {
    await server.close();
  }
});

test('the API proxy drops expired cookies and reports an unreachable server', async () => {
  const vault = memoryVault();
  vault.set('http://127.0.0.1:9', { cookie: 'lr_session=old', expires: 5 });
  const proxy = createApiProxy({ server: () => 'http://127.0.0.1:9', vault, timeoutMs: 2000, now: () => 10 });
  const r = await proxy(new Request(`${ORIGIN}/api/auth/me`, { headers: { 'X-LineRush': '1' } }), new URL(`${ORIGIN}/api/auth/me`));
  assert.equal(r.status, 502);
  assert.equal(vault.get('http://127.0.0.1:9'), null);
});

test('Discord: frames round-trip and the status reaches a Discord socket', async () => {
  const frames: [number, unknown][] = [];
  const rest = decode(Buffer.concat([encode(1, { a: 1 }), encode(3, { b: 2 }), encode(0, { c: 3 }).subarray(0, 5)]), (op, msg) => frames.push([op, msg]));
  assert.deepEqual(frames, [[1, { a: 1 }], [3, { b: 2 }]]);
  assert.equal(rest.length, 5);
  assert.equal(ipcPaths('win32')[0], '\\\\?\\pipe\\discord-ipc-0');
  assert.ok(ipcPaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' }).includes('/run/user/1000/discord-ipc-0'));

  const a = toActivity({ details: 'Psychic [EXPERT]', state: 'Classic', endsAt: Date.now() + 60_000 }, 1);
  assert.equal(a?.details, 'Psychic [EXPERT]');
  assert.ok(a?.timestamps && 'end' in a.timestamps);
  assert.deepEqual(toActivity({ details: 'In the menus' }, 123)?.timestamps, { start: 123 });

  // a fake Discord on a unix socket: answers the handshake, then records SET_ACTIVITY
  const dir = await tmp();
  const path = join(dir, 'discord-ipc-0');
  const got: { op: number; msg: any }[] = [];
  const fake = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', c => {
      buf = decode(Buffer.concat([buf, c]), (op, msg) => {
        got.push({ op, msg });
        if (op === 0) sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY' }));
      });
    });
  });
  await new Promise<void>(r => fake.listen(path, r));
  const presence = createPresence({ clientId: '123', paths: [join(dir, 'missing'), path], minInterval: 50, retryMs: 100 });
  try {
    presence.set({ details: 'Picking a song' });
    presence.setEnabled(true);
    const until = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 20)); };
    await until(() => got.some(g => g.msg?.cmd === 'SET_ACTIVITY'));
    assert.deepEqual(got[0], { op: 0, msg: { v: 1, client_id: '123' } });
    assert.equal(got.find(g => g.msg?.cmd === 'SET_ACTIVITY')?.msg.args.activity.details, 'Picking a song');
    // the same status twice is sent once; a new one follows after the rate limit
    presence.set({ details: 'Picking a song' });
    presence.set({ details: 'Psychic [EXPERT]', state: 'Classic' });
    await until(() => got.filter(g => g.msg?.cmd === 'SET_ACTIVITY').length >= 2);
    const sets = got.filter(g => g.msg?.cmd === 'SET_ACTIVITY');
    assert.equal(sets.length, 2);
    assert.equal(sets[1].msg.args.activity.state, 'Classic');
  } finally {
    presence.destroy();
    await new Promise(r => fake.close(r));
  }
});

test('Songs folder: lists audio files only, reads nothing outside the folder', async () => {
  const dir = join(await tmp(), 'Songs');
  const songs = await listSongs(dir); // makes the folder
  assert.deepEqual(songs, []);
  await writeFile(join(dir, 'beat.mp3'), Buffer.from([1, 2, 3, 4]));
  await writeFile(join(dir, 'notes.txt'), 'hi');
  await writeFile(join(dir, '.hidden.mp3'), 'x');
  await writeFile(join(dir, 'empty.wav'), '');
  await mkdir(join(dir, 'folder.mp3'));
  const list = await listSongs(dir);
  assert.deepEqual(list.map(s => s.name), ['beat.mp3']);
  assert.equal(list[0].size, 4);
  assert.deepEqual([...(await readSong(dir, 'beat.mp3'))!], [1, 2, 3, 4]);
  for (const bad of ['../beat.mp3', 'notes.txt', '/etc/passwd.mp3', 'sub/beat.mp3', '..\\beat.mp3', 'nope.mp3', 42 as never]) {
    assert.equal(await readSong(dir, bad), null, String(bad));
  }
});

test('app preferences: defaults, sanitized values, server from the build config', () => {
  assert.deepEqual(sanitizePrefs(null, { server: 'line-rush.example.com' }), {
    fullscreen: false, unlockFps: false, discord: true, server: 'https://line-rush.example.com', bounds: null,
  });
  const p = sanitizePrefs({ fullscreen: true, unlockFps: 'yes', server: 'http://evil.example.com', bounds: { x: 10, y: 20, width: 1280, height: 720, maximized: true } });
  assert.equal(p.fullscreen, true);
  assert.equal(p.unlockFps, false);
  assert.equal(p.server, '', 'an insecure server is ignored');
  assert.deepEqual(p.bounds, { x: 10, y: 20, width: 1280, height: 720, maximized: true });
  assert.equal(sanitizePrefs({ bounds: { x: 0, y: 0, width: 10, height: 10 } }).bounds, null);
  assert.equal(sanitizePrefs({ server: '' }, { server: 'https://a.example.com' }).server, '', 'clearing the server is kept');
});
