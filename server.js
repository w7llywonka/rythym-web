// Production server for hosts that run Node (Railway, Render, a VPS...): serves the built game from
// dist/ and the account API at /api/*. Run `npm run build` first, then `npm start`.
// Security headers come from vercel.json so both deployments send the same ones.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, fromNode, sendNode } from './api/_lib/core.js';
import { storeFromEnv } from './api/_lib/store.js';

const here = fileURLToPath(new URL('.', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function securityHeaders() {
  try {
    const config = JSON.parse(readFileSync(join(here, 'vercel.json'), 'utf8'));
    const all = config.headers?.find(h => h.source === '/(.*)');
    return Object.fromEntries((all?.headers ?? []).map(h => [h.key, h.value]));
  } catch {
    return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
  }
}

/**
 * @param {{ dist?: string, store?: object | null, trustProxy?: boolean }} options
 */
export function createApp({ dist = join(here, 'dist'), store = storeFromEnv(), trustProxy = true } = {}) {
  const root = resolve(dist);
  const headers = securityHeaders();
  const handle = store ? createAuth(store) : null;

  async function serveFile(res, path, cache) {
    const body = await readFile(path);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(body);
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname.startsWith('/api/')) {
        if (!handle) {
          return sendNode(res, {
            status: 503,
            headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            body: JSON.stringify({ error: "Accounts aren't set up on this server yet. You can still play as a guest." }),
          });
        }
        const out = await handle(await fromNode(req, url.pathname.slice(5), { trustProxy }));
        return sendNode(res, { ...out, headers: { ...headers, ...out.headers } });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
        return res.end();
      }
      // static files; anything outside dist/ is refused, unknown paths get the app
      let path;
      try { path = resolve(root, '.' + normalize(decodeURIComponent(url.pathname))); } catch { path = ''; }
      if (path && (path === root || path.startsWith(root + sep))) {
        const info = await stat(path).catch(() => null);
        if (info?.isFile()) {
          const hashed = path.startsWith(join(root, 'assets') + sep);
          return await serveFile(res, path, hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
        }
      }
      return await serveFile(res, join(root, 'index.html'), 'no-cache');
    } catch (err) {
      console.error('[server]', err);
      if (!res.headersSent) res.writeHead(500, { ...headers, 'Content-Type': 'text/plain' });
      res.end('Something went wrong.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const store = storeFromEnv();
  createApp({ store }).listen(port, () => {
    console.log(`Line Rush on port ${port} (accounts: ${store ? store.kind : 'off - set REDIS_URL to turn them on'})`);
  });
}
