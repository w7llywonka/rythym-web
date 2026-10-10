// /api/* from the desktop app, forwarded to the Line Rush server (the same API the website uses).
// The session cookie never reaches the page: the proxy keeps it (encrypted on disk by main.js) and adds
// it to each request, so the game code is exactly the website's. No Electron imports (tested in Node).
import http from 'node:http';
import https from 'node:https';

export const MAX_BODY = 1024 * 1024;
const OFFLINE = "Online play is off in this app. Set the server under APP on the home screen to log in, see leaderboards and play 1v1. You can still play as a guest.";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** "https://example.com/anything" -> "https://example.com"; http only for this computer (local testing) */
export function normalizeServer(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let url;
  try { url = new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** the name=value part and lifetime of a Set-Cookie header (null value = the server cleared it) */
export function parseSetCookie(header, now = Date.now()) {
  const [pair, ...attrs] = String(header).split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
  let expires = null;
  for (const attr of attrs) {
    const [k, v] = attr.split('=').map(s => s.trim());
    if (k.toLowerCase() === 'max-age' && /^-?\d+$/.test(v ?? '')) expires = now + Number(v) * 1000;
  }
  if (!value || (expires !== null && expires <= now)) return { name, cookie: null, expires: 0 };
  return { name, cookie: `${name}=${value}`, expires };
}

function send(target, { method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, { method, headers, timeout: timeoutMs }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > MAX_BODY * 4) req.destroy(new Error('response too large'));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * @param {{
 *   server: () => string,
 *   vault: { get(origin: string): { cookie: string, expires: number | null } | null, set(origin: string, value: { cookie: string, expires: number | null } | null): void },
 *   userAgent?: string, timeoutMs?: number, now?: () => number,
 * }} options
 */
export function createApiProxy({ server, vault, userAgent = 'LineRush-Desktop', timeoutMs = 15_000, now = Date.now }) {
  return async (request, url) => {
    const base = server();
    if (!base) return json(503, { error: OFFLINE });
    if (!['GET', 'POST', 'PUT'].includes(request.method)) return json(405, { error: 'Method not allowed.' });
    const body = request.method === 'GET' ? undefined : Buffer.from(await request.arrayBuffer());
    if (body && body.length > MAX_BODY) return json(413, { error: 'That request is too large.' });

    const target = new URL(url.pathname + url.search, base);
    const headers = { 'User-Agent': userAgent, Accept: 'application/json' };
    for (const name of ['x-linerush', 'content-type']) {
      const v = request.headers.get(name);
      if (v) headers[name] = v;
    }
    if (body) headers['Content-Length'] = String(body.length);
    let saved = vault.get(base);
    if (saved && saved.expires !== null && saved.expires <= now()) { vault.set(base, null); saved = null; }
    if (saved) headers.Cookie = saved.cookie;

    let res;
    try {
      res = await send(target, { method: request.method, headers, body, timeoutMs });
    } catch {
      return json(502, { error: "Can't reach the server. Check your connection." });
    }
    for (const header of [res.headers['set-cookie'] ?? []].flat()) {
      const c = parseSetCookie(header, now());
      if (c) vault.set(base, c.cookie ? { cookie: c.cookie, expires: c.expires } : null);
    }
    return new Response(res.status === 204 || res.status === 304 ? null : res.body, {
      status: res.status,
      headers: { 'Content-Type': String(res.headers['content-type'] ?? 'application/json'), 'Cache-Control': 'no-store' },
    });
  };
}
