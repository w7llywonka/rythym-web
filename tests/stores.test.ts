// The same tags / name colors flow on all three store backends: memory, a real Redis server (redisStore)
// and Upstash's REST API (upstashStore, here against a small stand-in for Upstash in front of that Redis).
// The Redis runs need `redis-server` on this computer and are skipped without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { Worker } from 'node:worker_threads';
import { createClient } from 'redis';
import { memoryStore, upstashStore } from '../api/_lib/store.js';
import { EXPECTED, looksFlow } from './helpers/looksFlow.ts';

const noRedis = spawnSync('redis-server', ['--version']).status !== 0 && 'redis-server is not installed';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('looks: memory store', async () => {
  assert.deepEqual(await looksFlow(memoryStore()), EXPECTED);
});

/** a throwaway Redis on a free port */
async function startRedis() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise(r => probe.close(r));
  const proc = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; ; i++) {
    const up = await new Promise<boolean>(r => { const s = connect(port, '127.0.0.1', () => { s.end(); r(true); }).on('error', () => r(false)); });
    if (up) break;
    if (i > 50) { proc.kill(); throw new Error('redis-server did not start'); }
    await sleep(100);
  }
  return { url: `redis://127.0.0.1:${port}`, stop: () => proc.kill() };
}

/** Upstash's REST API (POST /, /pipeline, /multi-exec with a bearer token) in front of a Redis */
async function upstashShim(redisUrl: string, token: string) {
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = (status: number, json: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
    const one = async (cmd: string[]) => { try { return { result: await redis.sendCommand(cmd) }; } catch (e) { return { error: String(e) }; } };
    const body = JSON.parse(raw) as string[] | string[][];
    if (req.url === '/pipeline') {
      const out = [];
      for (const cmd of body as string[][]) out.push(await one(cmd));
      return send(200, out);
    }
    if (req.url === '/multi-exec') {
      const multi = redis.multi();
      for (const cmd of body as string[][]) multi.addCommand(cmd);
      return send(200, (await multi.exec()).map(result => ({ result })));
    }
    send(200, await one(body as string[]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    flush: () => redis.flushDb(),
    async stop() { server.closeAllConnections(); server.close(); await redis.quit(); },
  };
}

test('looks: Redis and Upstash stores give the same answers', { skip: noRedis }, async () => {
  const redis = await startRedis();
  const shim = await upstashShim(redis.url, 'test-token');
  try {
    // redisStore keeps its connection open for good, so it runs in a worker that's thrown away after
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { redisStore } = await import(workerData.store);
        const { looksFlow } = await import(workerData.flow);
        parentPort.postMessage({ result: await looksFlow(redisStore(workerData.url)) });
      })().catch(e => parentPort.postMessage({ error: String(e && e.stack || e) }));
    `, {
      eval: true,
      workerData: { url: redis.url, store: new URL('../api/_lib/store.js', import.meta.url).href, flow: new URL('./helpers/looksFlow.ts', import.meta.url).href },
    });
    const [fromRedis] = await once(worker, 'message');
    await worker.terminate();
    assert.equal(fromRedis.error, undefined);
    assert.deepEqual(fromRedis.result, EXPECTED, 'redisStore');

    await shim.flush();
    assert.deepEqual(await looksFlow(upstashStore(shim.url, 'test-token')), EXPECTED, 'upstashStore');
  } finally {
    await shim.stop();
    redis.stop();
  }
});
