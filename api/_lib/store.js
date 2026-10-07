// Key-value store for accounts. Production uses Upstash Redis over its REST API (works from Vercel
// functions with no extra packages). Local dev and tests use an in-memory store.

export function memoryStore() {
  const data = new Map(); // key -> { v, exp }
  const live = key => {
    const e = data.get(key);
    if (!e) return undefined;
    if (e.exp && e.exp <= Date.now()) { data.delete(key); return undefined; }
    return e;
  };
  return {
    kind: 'memory',
    async get(key) { const e = live(key); return e && typeof e.v === 'string' ? e.v : null; },
    async set(key, value, { ex, nx } = {}) {
      if (nx && live(key)) return false;
      data.set(key, { v: String(value), exp: ex ? Date.now() + ex * 1000 : 0 });
      return true;
    },
    async del(...keys) { for (const k of keys) data.delete(k); },
    async incr(key, windowSeconds) {
      const e = live(key);
      if (!e) { data.set(key, { v: '1', exp: Date.now() + windowSeconds * 1000 }); return 1; }
      e.v = String(Number(e.v) + 1);
      return Number(e.v);
    },
    async sadd(key, member) {
      const e = live(key) ?? { v: new Set(), exp: 0 };
      e.v.add(member);
      data.set(key, e);
    },
    async srem(key, member) { live(key)?.v.delete(member); },
    async smembers(key) { const e = live(key); return e ? [...e.v] : []; },
  };
}

export function upstashStore(url, token) {
  const base = url.replace(/\/+$/, '');
  async function send(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error(`store error ${res.status}`);
    return json;
  }
  async function cmd(...args) {
    const json = await send('', args);
    if (json.error) throw new Error('store error');
    return json.result;
  }
  async function pipeline(...cmds) {
    const json = await send('/pipeline', cmds);
    return json.map(r => { if (r.error) throw new Error('store error'); return r.result; });
  }
  return {
    kind: 'upstash',
    get: key => cmd('GET', key),
    async set(key, value, { ex, nx } = {}) {
      const args = ['SET', key, String(value)];
      if (ex) args.push('EX', String(ex));
      if (nx) args.push('NX');
      return (await cmd(...args)) === 'OK';
    },
    async del(...keys) { if (keys.length) await cmd('DEL', ...keys); },
    async incr(key, windowSeconds) {
      const [count] = await pipeline(['INCR', key], ['EXPIRE', key, String(windowSeconds), 'NX']);
      return Number(count);
    },
    async sadd(key, member) { await cmd('SADD', key, member); },
    async srem(key, member) { await cmd('SREM', key, member); },
    async smembers(key) { return (await cmd('SMEMBERS', key)) ?? []; },
  };
}

/** Any regular Redis server by URL (redis:// or rediss://), e.g. Railway's Redis service. */
export function redisStore(url) {
  let ready = null;
  // one shared connection, opened on first use and reused across requests
  const client = () => {
    ready ??= import('redis').then(async ({ createClient }) => {
      const c = createClient({ url, socket: { reconnectStrategy: tries => Math.min(tries * 200, 3000) } });
      c.on('error', err => console.error('[redis]', err.message));
      await c.connect();
      return c;
    }).catch(err => { ready = null; throw err; });
    return ready;
  };
  return {
    kind: 'redis',
    async get(key) { return (await client()).get(key); },
    async set(key, value, { ex, nx } = {}) {
      const opts = {};
      if (ex) opts.EX = ex;
      if (nx) opts.NX = true;
      return (await (await client()).set(key, String(value), opts)) === 'OK';
    },
    async del(...keys) { if (keys.length) await (await client()).del(keys); },
    async incr(key, windowSeconds) {
      const c = await client();
      const count = await c.incr(key);
      if (count === 1) await c.expire(key, windowSeconds);
      return count;
    },
    async sadd(key, member) { await (await client()).sAdd(key, member); },
    async srem(key, member) { await (await client()).sRem(key, member); },
    async smembers(key) { return (await client()).sMembers(key); },
  };
}

/**
 * Picks the account store from environment variables, or null if none is configured:
 * - REDIS_URL / REDIS_PRIVATE_URL / REDIS_PUBLIC_URL (Railway Redis, or any Redis server)
 * - UPSTASH_REDIS_REST_URL + _TOKEN, or KV_REST_API_URL + _TOKEN (Upstash / Vercel marketplace)
 */
export function storeFromEnv(env = process.env) {
  const redisUrl = env.REDIS_URL || env.REDIS_PRIVATE_URL || env.REDIS_PUBLIC_URL;
  if (redisUrl) return redisStore(redisUrl);
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? upstashStore(url, token) : null;
}
