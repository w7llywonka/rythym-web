// Vercel function: every /api/* request is rewritten here (see vercel.json) as /api?route=<path>.
import { createAuth, fromNode, sendNode } from './_lib/core.js';
import { storeFromEnv } from './_lib/store.js';

const store = storeFromEnv();
const handle = store ? createAuth(store) : null;

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const route = url.searchParams.get('route') ?? '';
  if (!handle) {
    return sendNode(res, {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: "Accounts aren't set up on this server yet. You can still play as a guest." }),
    });
  }
  sendNode(res, await handle(await fromNode(req, route, { trustProxy: true })));
}
