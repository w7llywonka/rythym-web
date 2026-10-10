// The desktop app's own origin, app://line-rush/: the built game from dist/ (bundled with the app, so
// it starts instantly and plays offline) and /api/*, which is forwarded to the online server.
// No Electron imports here, so it runs under plain Node in the tests.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const SCHEME = 'app';
export const HOST = 'line-rush';
export const ORIGIN = `${SCHEME}://${HOST}`;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
};

// the same policy as the website (vercel.json); 'self' is app://line-rush, which includes /api
export const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * @param {{ dist: string, api: (request: Request, url: URL) => Promise<Response> }} options
 * @returns {(request: Request) => Promise<Response>}
 */
export function createAppHandler({ dist, api }) {
  const root = resolve(dist);
  const file = async path => new Response(await readFile(path), {
    headers: { ...HEADERS, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' },
  });
  return async request => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/api/')) return api(request, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    // anything outside dist/ is refused, unknown paths get the app
    let path = '';
    try { path = resolve(root, '.' + normalize(decodeURIComponent(url.pathname))); } catch { /* bad escape */ }
    if (path && path.startsWith(root + sep)) {
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) return file(path);
    }
    return file(join(root, 'index.html'));
  };
}
