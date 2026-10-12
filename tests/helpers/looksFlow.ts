// Tags and name colors end to end, against any store (memory, Redis or Upstash): tests/stores.test.ts
// runs it on all three and checks they agree. Uses the real clock, so each player submits once.
import { createAuth } from '../../api/_lib/core.js';

const PASS = 'linen-orbit-72-maple';

type Store = { mget: (...keys: string[]) => Promise<(string | null)[]>; set: (k: string, v: string) => Promise<boolean> };
type Res = { status: number; body: any };

export async function looksFlow(store: Store) {
  const handle = createAuth(store, { scrypt: { N: 1024, r: 8, p: 1 } });
  let ip = 0;
  const player = async (username: string) => {
    let cookie = '';
    const addr = `10.7.0.${++ip}`;
    const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Res> => {
      const res = await handle({
        method, path, query, ip: addr, secure: true,
        headers: { host: 'linerush.test', 'x-linerush': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        rawBody: body === undefined ? '' : JSON.stringify(body),
      });
      const set = res.headers['Set-Cookie'];
      if (typeof set === 'string') cookie = set.includes('Max-Age=0') ? '' : set.split(';')[0];
      return { status: res.status, body: JSON.parse(res.body) };
    };
    const r = await call('POST', 'auth/register', { username, password: PASS });
    if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.body)}`);
    return call;
  };
  const run = { songId: 'current', diff: 'Hard', grade: 'A', fc: false };

  const alice = await player('alice'), bob = await player('bob'), carol = await player('carol');
  const looks = [
    (await alice('POST', 'profile/look', { title: 'Rookie', tag: 'veteran', color: 'gold' })).body,
    (await bob('POST', 'profile/look', { tag: '<script>', color: 'aurora' })).body,
  ];
  await store.set('title:carol', 'Old Timer'); // from before looks

  const submits = [
    (await alice('POST', 'scores/submit', { ...run, score: 5000, title: 'Rookie', tag: 'veteran', color: 'gold' })).status,
    (await bob('POST', 'scores/submit', { ...run, score: 6000, title: 'Grinder' })).status, // old game: title only
    (await carol('POST', 'scores/submit', { ...run, score: 4000 })).status, // no look at all
  ];
  const board = (await alice('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' })).body;
  const feed = (await carol('GET', 'scores/feed')).body.items.map(({ at, ...item }: { at: number }) => item);

  await alice('GET', 'versus/poll'); await bob('GET', 'versus/poll');
  const lobby = (await carol('GET', 'versus/poll', undefined, { lobby: '1' })).body.online;
  await alice('POST', 'versus/challenge', { to: 'bob', songId: 'current', diff: 'Expert' });
  const { from, tag, color } = (await bob('GET', 'versus/poll')).body.incoming;
  const match = (await bob('POST', 'versus/respond', { from: 'alice', accept: true })).body.match;
  const aliceSees = (await alice('GET', 'versus/poll')).body.match.opponentLook;

  const deleted = (await carol('POST', 'auth/delete', { password: PASS })).status;
  return {
    looks, submits, board, feed, lobby,
    incoming: { from, tag, color }, bobSees: match.opponentLook, aliceSees,
    afterDelete: { deleted, keys: await store.mget('look:carol', 'title:carol'), othersKept: await store.mget('look:alice') },
  };
}

/** what every store should give */
export const EXPECTED = {
  looks: [
    { ok: true, look: { title: 'Rookie', tag: 'veteran', color: 'gold' } },
    { ok: true, look: { title: '', tag: '', color: 'aurora' } },
  ],
  submits: [200, 200, 200],
  board: {
    entries: [
      { rank: 1, name: 'bob', title: 'Grinder', tag: '', color: 'aurora', score: 6000 },
      { rank: 2, name: 'alice', title: 'Rookie', tag: 'veteran', color: 'gold', score: 5000 },
      { rank: 3, name: 'carol', title: 'Old Timer', tag: '', color: '', score: 4000 },
    ],
    mine: { score: 5000, rank: 2 },
  },
  feed: [
    { kind: 'top', user: 'bob', song: 'Voltage Current', diff: 'HARD', tag: '', color: 'aurora' },
    { kind: 'top', user: 'alice', song: 'Voltage Current', diff: 'HARD', tag: 'veteran', color: 'gold' },
  ],
  lobby: [
    { name: 'bob', busy: false, tag: '', color: 'aurora' },
    { name: 'alice', busy: false, tag: 'veteran', color: 'gold' },
  ],
  incoming: { from: 'alice', tag: 'veteran', color: 'gold' },
  bobSees: { title: 'Rookie', tag: 'veteran', color: 'gold' },
  aliceSees: { title: 'Grinder', tag: '', color: 'aurora' },
  afterDelete: { deleted: 200, keys: [null, null], othersKept: [JSON.stringify({ title: 'Rookie', tag: 'veteran', color: 'gold' })] },
};
