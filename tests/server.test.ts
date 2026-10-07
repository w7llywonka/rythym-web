import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryStore } from '../api/_lib/store.js';
import { createApp } from '../server.js';

async function start(store: object | null) {
  const dist = await mkdtemp(join(tmpdir(), 'linerush-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Line Rush</title>');
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const server = createApp({ dist, store, trustProxy: false });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

test('serves the app, hashed assets and security headers; never files outside dist', async () => {
  const app = await start(null);
  try {
    let r = await fetch(`${app.base}/`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Line Rush/);
    assert.ok(r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.equal(r.headers.get('x-frame-options'), 'DENY');

    r = await fetch(`${app.base}/assets/app-abc123.js`, { headers: { 'accept-encoding': 'br, gzip' } });
    assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(r.headers.get('content-encoding'), 'br', 'text files are compressed');
    assert.equal(await r.text(), 'console.log(1)');
    assert.match(r.headers.get('cache-control') ?? '', /immutable/);

    for (const path of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/server.js', '/some/route']) {
      r = await fetch(`${app.base}${path}`);
      assert.match(await r.text(), /<title>Line Rush/, path);
    }

    r = await fetch(`${app.base}/api/auth/me`, { headers: { 'X-LineRush': '1' } });
    assert.equal(r.status, 503, 'no store configured');
  } finally {
    await app.close();
  }
});

test('the account API works through the server', async () => {
  const app = await start(memoryStore());
  try {
    const h = { 'X-LineRush': '1', 'Content-Type': 'application/json' };
    let r = await fetch(`${app.base}/api/auth/me`, { headers: h });
    assert.equal(r.status, 401);
    r = await fetch(`${app.base}/api/auth/register`, { method: 'POST', headers: h, body: JSON.stringify({ username: 'server_tester', password: 'quiet-harbor-27-lamp' }) });
    assert.equal(r.status, 201);
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    assert.match(cookie, /^lr_session=/);
    r = await fetch(`${app.base}/api/auth/me`, { headers: { ...h, cookie } });
    assert.equal((await r.json()).user.username, 'server_tester');
  } finally {
    await app.close();
  }
});
