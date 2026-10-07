// Line Rush accounts: username + password, nothing else.
//
// - Passwords are hashed with scrypt (128 MiB, per-user random salt) and compared in constant time.
//   Unknown usernames still cost one hash so response times don't reveal which names exist.
// - Sessions are 256-bit random tokens in an HttpOnly, Secure, SameSite=Strict cookie. Only the
//   SHA-256 of a token is stored, so a leaked database can't be used to log in.
// - Every request must send `X-LineRush: 1` (a custom header cross-site pages can't add without a
//   CORS preflight we never answer), JSON bodies, and a same-origin Origin when one is sent.
// - Rate limits per IP and per account slow down password guessing.
// - Changing your password logs out every other device.

import { randomBytes, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { onlineRoutes } from './online.js';
import { versusRoutes } from './versus.js';

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 86400;
const MAX_BODY = 128 * 1024;
const MAX_SAVE = 100 * 1024;
const DEFAULT_SCRYPT = { N: 131072, r: 8, p: 1 };

const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'support', 'help', 'mod', 'moderator', 'staff',
  'official', 'linerush', 'line_rush', 'guest', 'null', 'undefined', 'api', 'you', 'me', 'owner', 'dev', 'developer']);
const COMMON = new Set(['1234567890', '0123456789', '12345678910', '123456789a', 'a123456789', '1q2w3e4r5t', 'qwertyuiop',
  'password123', 'password12', 'password1!', 'password!!', 'passw0rd123', 'iloveyou12', 'iloveyou123', 'qwerty1234',
  'qwerty12345', 'asdfghjkl1', 'asdfghjkl;', 'zxcvbnm123', '1qaz2wsx3edc', 'abcdefghij', 'abc1234567', 'letmein123',
  'welcome123', 'football12', 'baseball12', 'superman12', 'starwars12', 'princess12', 'sunshine12', 'basketball',
  'qazwsxedcrfv', 'monkey1234', 'dragon1234', 'trustno1234', 'whatever12', 'computer12', 'michael123', 'jennifer12',
  'linerush123', 'linerush12', 'rhythmgame', 'passwordpassword', 'changeme123', 'administrator', 'qwertyuiop123',
  '9876543210', '1111111111', '0000000000', '1234512345', '1234567890a', 'aaaaaaaaaa', 'aa12345678']);

const scrypt = (password, salt, { N, r, p }) => new Promise((resolve, reject) =>
  scryptCb(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
const sha256 = s => createHash('sha256').update(s).digest('hex');

export function checkUsername(name) {
  if (typeof name !== 'string' || !USERNAME.test(name)) return 'Usernames are 3-20 letters, numbers or _.';
  if (RESERVED.has(name.toLowerCase())) return 'That username is reserved. Pick another one.';
  return null;
}

export function checkPassword(password, username) {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < 10) return 'Passwords need at least 10 characters.';
  if (password.length > 128) return 'Passwords can be at most 128 characters.';
  const lower = password.toLowerCase();
  if (username && lower.includes(String(username).toLowerCase())) return "Your password can't contain your username.";
  if (/^(.)\1+$/.test(password) || COMMON.has(lower)) return 'That password is too easy to guess. Pick another one.';
  return null;
}

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

/**
 * Create the request handler.
 * @param {object} store  see store.js
 * @param {object} [options] { scrypt: {N,r,p}, now: () => ms }
 */
export function createAuth(store, options = {}) {
  const params = options.scrypt ?? DEFAULT_SCRYPT;
  const now = options.now ?? Date.now;
  const dummySalt = randomBytes(16);

  async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password.normalize('NFKC'), salt, params);
    return { salt: salt.toString('base64'), hash: key.toString('base64'), N: params.N, r: params.r, p: params.p };
  }
  async function verifyPassword(password, user) {
    if (typeof password !== 'string' || password.length > 128) password = '';
    if (!user || !password) {
      await scrypt(String(password).normalize('NFKC'), dummySalt, params); // same cost as a real check
      return false;
    }
    const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(user.salt, 'base64'), user);
    const want = Buffer.from(user.hash, 'base64');
    return key.length === want.length && timingSafeEqual(key, want);
  }

  async function limit(key, max, windowSeconds, message) {
    const count = await store.incr(`rl:${key}`, windowSeconds);
    if (count > max) throw new HttpError(429, message ?? 'Too many attempts. Wait a few minutes and try again.', { 'Retry-After': String(windowSeconds) });
  }

  const getUser = async lower => {
    const raw = await store.get(`user:${lower}`);
    return raw ? JSON.parse(raw) : null;
  };
  const publicUser = u => ({ username: u.username, createdAt: u.createdAt });

  async function createSession(lower) {
    const token = randomBytes(32).toString('base64url');
    const id = sha256(token);
    await store.set(`session:${id}`, JSON.stringify({ u: lower, at: now() }), { ex: SESSION_SECONDS });
    await store.sadd(`usersessions:${lower}`, id);
    return token;
  }
  async function revokeAll(lower) {
    const ids = await store.smembers(`usersessions:${lower}`);
    await store.del(...ids.map(id => `session:${id}`), `usersessions:${lower}`);
  }
  async function currentSession(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 64) return null;
    const id = sha256(token);
    const raw = await store.get(`session:${id}`);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const user = await getUser(s.u);
    if (!user) { await store.del(`session:${id}`); return null; }
    return { id, user };
  }
  async function requireSession(req) {
    const s = await currentSession(req.token);
    if (!s) throw new HttpError(401, 'You are logged out. Log in again.');
    return s;
  }

  const optionalSession = req => currentSession(req.token);
  const online = onlineRoutes(store, { now, limit, requireSession, optionalSession, HttpError });

  const routes = {
    'POST auth/register': async req => {
      const { username, password } = req.body;
      await limit(`reg:${req.ip}`, 5, 3600, 'Too many new accounts from your network. Try again later.');
      const uErr = checkUsername(username);
      if (uErr) throw new HttpError(400, uErr);
      const pErr = checkPassword(password, username);
      if (pErr) throw new HttpError(400, pErr);
      const lower = username.toLowerCase();
      const user = { username, createdAt: now(), ...(await hashPassword(password)) };
      if (!(await store.set(`user:${lower}`, JSON.stringify(user), { nx: true }))) throw new HttpError(409, 'That username is taken.');
      return { status: 201, body: { user: publicUser(user) }, session: await createSession(lower) };
    },

    'POST auth/login': async req => {
      const { username, password } = req.body;
      await limit(`login:${req.ip}`, 20, 900);
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 20 || password.length > 128) {
        throw new HttpError(401, 'Wrong username or password.');
      }
      const lower = username.toLowerCase();
      const failKey = `rl:fail:${lower}`;
      if (Number(await store.get(failKey)) >= 8) {
        throw new HttpError(429, 'Too many wrong passwords for this account. Wait 15 minutes and try again.', { 'Retry-After': '900' });
      }
      const user = USERNAME.test(username) ? await getUser(lower) : null;
      if (!(await verifyPassword(password, user))) {
        await store.incr(failKey, 900);
        throw new HttpError(401, 'Wrong username or password.');
      }
      await store.del(failKey);
      return { body: { user: publicUser(user) }, session: await createSession(lower) };
    },

    'POST auth/logout': async req => {
      const s = await currentSession(req.token);
      if (s) {
        await store.del(`session:${s.id}`);
        await store.srem(`usersessions:${s.user.username.toLowerCase()}`, s.id);
      }
      return { body: { ok: true }, session: null };
    },

    'POST auth/logout-all': async req => {
      const s = await requireSession(req);
      await revokeAll(s.user.username.toLowerCase());
      return { body: { ok: true }, session: null };
    },

    'GET auth/me': async req => {
      const s = await requireSession(req);
      return { body: { user: publicUser(s.user) } };
    },

    'POST auth/password': async req => {
      const s = await requireSession(req);
      const lower = s.user.username.toLowerCase();
      await limit(`pw:${lower}`, 10, 900);
      const { current, next } = req.body;
      if (!(await verifyPassword(current, s.user))) throw new HttpError(403, 'Your current password is wrong.');
      const pErr = checkPassword(next, s.user.username);
      if (pErr) throw new HttpError(400, pErr);
      const user = { ...s.user, ...(await hashPassword(next)), passwordChangedAt: now() };
      await store.set(`user:${lower}`, JSON.stringify(user));
      await revokeAll(lower); // every device, including this one, then a fresh session here
      return { body: { ok: true }, session: await createSession(lower) };
    },

    'POST auth/delete': async req => {
      const s = await requireSession(req);
      const lower = s.user.username.toLowerCase();
      await limit(`pw:${lower}`, 10, 900);
      if (!(await verifyPassword(req.body.password, s.user))) throw new HttpError(403, 'That password is wrong.');
      await revokeAll(lower);
      await store.del(`user:${lower}`, `save:${lower}`);
      await store.zrem('online', s.user.username);
      await online.forget(s.user.username);
      return { body: { ok: true }, session: null };
    },

    'GET save': async req => {
      const s = await requireSession(req);
      const raw = await store.get(`save:${s.user.username.toLowerCase()}`);
      const saved = raw ? JSON.parse(raw) : null;
      return { body: { data: saved?.data ?? null, updatedAt: saved?.updatedAt ?? null } };
    },

    'PUT save': async req => {
      const s = await requireSession(req);
      const lower = s.user.username.toLowerCase();
      await limit(`save:${lower}`, 60, 600, 'Saving too often. Your progress will sync in a moment.');
      const data = req.body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Invalid save.');
      const updatedAt = now();
      const raw = JSON.stringify({ data, updatedAt });
      if (raw.length > MAX_SAVE) throw new HttpError(413, 'Save is too large.');
      await store.set(`save:${lower}`, raw);
      return { body: { ok: true, updatedAt } };
    },
  };

  Object.assign(routes, online.routes, versusRoutes(store, { now, limit, requireSession, HttpError }));

  /**
   * @param {{method:string, path:string, query?:Record<string,string>, headers:Record<string,string|undefined>, rawBody:string, ip:string, secure:boolean}} req
   * @returns {Promise<{status:number, headers:Record<string,string|string[]>, body:string}>}
   */
  return async function handle(req) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const cookieName = req.secure ? '__Host-lr_session' : 'lr_session';
    const reply = (status, body, extra) => ({ status, headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    try {
      const h = req.headers;
      if (h['x-linerush'] !== '1') throw new HttpError(403, 'Forbidden.');
      const site = h['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Forbidden.');
      if (h.origin) {
        let originHost = '';
        try { originHost = new URL(h.origin).host; } catch { /* bad origin */ }
        if (!originHost || originHost !== h.host) throw new HttpError(403, 'Forbidden.');
      }
      const route = routes[`${req.method} ${req.path.replace(/^\/+|\/+$/g, '')}`];
      if (!route) throw new HttpError(404, 'Not found.');

      req.body = {};
      if (req.method !== 'GET') {
        if (!String(h['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
        if (req.rawBody.length > MAX_BODY) throw new HttpError(413, 'Request is too large.');
        try { req.body = JSON.parse(req.rawBody || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Invalid JSON.');
      }
      req.token = parseCookies(h.cookie)[cookieName];
      req.query = req.query ?? {};

      const out = await route(req);
      const extra = {};
      if (out.session !== undefined) {
        const flags = `Path=/; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`;
        extra['Set-Cookie'] = out.session
          ? `${cookieName}=${out.session}; Max-Age=${SESSION_SECONDS}; ${flags}`
          : `${cookieName}=; Max-Age=0; ${flags}`;
      }
      return reply(out.status ?? 200, out.body, extra);
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message }, e.extra);
      console.error('[auth]', e);
      return reply(500, { error: 'Something went wrong on our end. Try again.' });
    }
  };
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Turn a Node IncomingMessage into the handler's request shape. */
export async function fromNode(req, path, { trustProxy }) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  let size = 0;
  const chunks = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY + 1) break;
      chunks.push(chunk);
    }
  }
  const forwarded = trustProxy ? String(headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  const ip = forwarded || headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const host = String(headers.host ?? '');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const secure = trustProxy ? !local : false;
  const query = Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
  delete query.route;
  return { method: req.method, path, query, headers, rawBody: Buffer.concat(chunks).toString('utf8'), ip, secure };
}

export function sendNode(res, out) {
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
