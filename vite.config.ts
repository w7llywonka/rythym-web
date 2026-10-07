import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JS module shared with the Vercel function
import { createAuth, fromNode, sendNode } from './api/_lib/core.js';
// @ts-expect-error plain JS module shared with the Vercel function
import { memoryStore, storeFromEnv } from './api/_lib/store.js';

// `npm run dev` serves the account API too. Accounts live in memory (they reset when you restart),
// unless UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set.
function accountsApi(): Plugin {
  const handle = createAuth(storeFromEnv() ?? memoryStore());
  const middleware = async (req: any, res: any, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/')) return next();
    sendNode(res, await handle(await fromNode(req, url.pathname.slice(5), { trustProxy: false })));
  };
  return {
    name: 'line-rush-accounts',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({ plugins: [accountsApi()] });
