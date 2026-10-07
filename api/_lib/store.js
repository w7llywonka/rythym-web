// Key-value store for accounts and 1v1. Three backends with the same small interface:
// - redisStore: any Redis server (Railway Redis) over TCP
// - upstashStore: Upstash Redis over its REST API (works from Vercel functions)
// - memoryStore: local dev and tests
//
// Interface: get, mget, set(ex/nx), del, incr(window), sadd/srem/smembers,
// zadd/zrangebyscore/zremrangebyscore/zrem (sorted sets), rpush(ttl)/drain (lists).

const score = v => (v === '+inf' ? Infinity : v === '-inf' ? -Infinity : Number(v));

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
    async mget(...keys) { return keys.map(k => { const e = live(k); return e && typeof e.v === 'string' ? e.v : null; }); },
    async zadd(key, score, member) {
      const e = live(key) ?? { v: new Map(), exp: 0 };
      e.v.set(member, score);
      data.set(key, e);
    },
    async zrangebyscore(key, min, max) {
      const e = live(key);
      if (!e) return [];
      const lo = score(min), hi = score(max);
      return [...e.v].filter(([, sc]) => sc >= lo && sc <= hi).sort((a, b) => a[1] - b[1]).map(([m]) => m);
    },
    async zremrangebyscore(key, min, max) {
      const e = live(key);
      const lo = score(min), hi = score(max);
      if (e) for (const [m, sc] of e.v) if (sc >= lo && sc <= hi) e.v.delete(m);
    },
    async zrem(key, member) { live(key)?.v.delete(member); },
    async rpush(key, value, ttl) {
      const e = live(key) ?? { v: [], exp: 0 };
      e.v.push(String(value));
      e.exp = Date.now() + ttl * 1000;
      data.set(key, e);
    },
    async drain(key) {
      const e = live(key);
      data.delete(key);
      return e ? e.v : [];
    },
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
    async mget(...keys) { return keys.length ? cmd('MGET', ...keys) : []; },
    async zadd(key, score, member) { await cmd('ZADD', key, String(score), member); },
    async zrangebyscore(key, min, max) { return (await cmd('ZRANGEBYSCORE', key, String(min), String(max))) ?? []; },
    async zremrangebyscore(key, min, max) { await cmd('ZREMRANGEBYSCORE', key, String(min), String(max)); },
    async zrem(key, member) { await cmd('ZREM', key, member); },
    async rpush(key, value, ttl) { await pipeline(['RPUSH', key, String(value)], ['EXPIRE', key, String(ttl)]); },
    async drain(key) {
      const json = await send('/multi-exec', [['LRANGE', key, '0', '-1'], ['DEL', key]]);
      return json[0]?.result ?? [];
    },
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
    async mget(...keys) { return keys.length ? (await client()).mGet(keys) : []; },
    async zadd(key, score, member) { await (await client()).zAdd(key, { score, value: member }); },
    async zrangebyscore(key, min, max) { return (await client()).zRangeByScore(key, min, max); },
    async zremrangebyscore(key, min, max) { await (await client()).zRemRangeByScore(key, min, max); },
    async zrem(key, member) { await (await client()).zRem(key, member); },
    async rpush(key, value, ttl) { await (await client()).multi().rPush(key, String(value)).expire(key, ttl).exec(); },
    async drain(key) {
      const [items] = await (await client()).multi().lRange(key, 0, -1).del(key).exec();
      return items ?? [];
    },
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
