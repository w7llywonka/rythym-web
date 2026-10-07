import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../api/_lib/core.js';
import { memoryStore } from '../api/_lib/store.js';

// Test-only accounts in an in-memory store.
const PASS = 'amber-signal-63-river';

function setup() {
  let clock = 1_800_000_000_000;
  const handle = createAuth(memoryStore(), { scrypt: { N: 1024, r: 8, p: 1 }, now: () => clock });
  let ip = 0;
  const player = async (username: string) => {
    let cookie = '';
    const addr = `10.0.0.${++ip}`;
    const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
      const res = await handle({
        method, path, query, ip: addr, secure: true,
        headers: { host: 'linerush.test', origin: 'https://linerush.test', 'x-linerush': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        rawBody: body === undefined ? '' : JSON.stringify(body),
      });
      const set = res.headers['Set-Cookie'];
      if (typeof set === 'string') cookie = set.includes('Max-Age=0') ? '' : set.split(';')[0];
      return { status: res.status, body: JSON.parse(res.body) };
    };
    assert.equal((await call('POST', 'auth/register', { username, password: PASS })).status, 201);
    return { call, poll: (q: Record<string, string> = {}) => call('GET', 'versus/poll', undefined, q) };
  };
  return { player, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

test('challenge, accept, live scores, reactions and a winner', async () => {
  const { player, tick, now } = setup();
  const alice = await player('alice_vs'), bob = await player('bob_vs');
  await alice.poll(); await bob.poll();

  // the lobby lists other online players, not yourself
  const lobby = await alice.poll({ lobby: '1' });
  assert.deepEqual(lobby.body.online, [{ name: 'bob_vs', busy: false }]);

  let r = await alice.call('POST', 'versus/challenge', { to: 'BOB_VS', songId: 'current', diff: 'Expert' });
  assert.equal(r.status, 200);
  assert.equal(r.body.to, 'bob_vs');
  // only one pending challenge per player
  const carol = await player('carol_vs');
  await carol.poll();
  assert.equal((await carol.call('POST', 'versus/challenge', { to: 'bob_vs', songId: 'current', diff: 'Hard' })).status, 409);

  r = await bob.poll();
  assert.equal(r.body.incoming.from, 'alice_vs');
  assert.equal(r.body.incoming.songId, 'current');

  r = await bob.call('POST', 'versus/respond', { from: 'alice_vs', accept: true });
  assert.equal(r.status, 200);
  const match = r.body.match;
  assert.equal(match.opponent, 'alice_vs');
  assert.equal(match.startAt, now() + 6000);

  // the challenger finds the match on their next poll
  r = await alice.poll();
  assert.equal(r.body.match.id, match.id);
  assert.equal(r.body.match.opponent, 'bob_vs');
  assert.ok(r.body.events.some((e: { type: string }) => e.type === 'start'));
  // both are busy now
  assert.deepEqual((await carol.poll({ lobby: '1' })).body.online.map((p: { busy: boolean }) => p.busy), [true, true]);

  tick(10_000);
  r = await alice.call('POST', 'versus/progress', { matchId: match.id, score: 12000, combo: 30, health: 80, accuracy: 97.5 });
  assert.equal(r.status, 200);
  r = await bob.call('POST', 'versus/progress', { matchId: match.id, score: 9000, combo: 4, health: 60, accuracy: 91 });
  assert.deepEqual(r.body.match.opp, { score: 12000, combo: 30, health: 80, accuracy: 97.5 });

  await bob.call('POST', 'versus/react', { matchId: match.id, i: 4 });
  await bob.call('POST', 'versus/react', { matchId: match.id, i: 1 }); // within 1 s: dropped
  r = await alice.poll();
  assert.deepEqual(r.body.events.filter((e: { type: string }) => e.type === 'react'), [{ type: 'react', i: 4 }]);

  tick(40_000);
  r = await alice.call('POST', 'versus/final', { matchId: match.id, score: 50000, cleared: true });
  assert.equal(r.body.match.result, null, 'waiting for the opponent');
  assert.equal(r.body.match.oppDone, null);
  r = await bob.call('POST', 'versus/final', { matchId: match.id, score: 42000, cleared: true });
  assert.deepEqual(r.body.match.result, { outcome: 'lose', reason: 'done', you: 42000, them: 50000 });
  r = await alice.poll({ match: match.id });
  assert.deepEqual(r.body.match.result, { outcome: 'win', reason: 'done', you: 50000, them: 42000 });
  // finals can't be rewritten
  await bob.call('POST', 'versus/final', { matchId: match.id, score: 99999 });
  assert.equal((await alice.poll({ match: match.id })).body.match.result.them, 42000);
  // and both are free again
  assert.equal((await alice.poll()).body.match, null);
});

test('declines, forfeits, timeouts and bad requests', async () => {
  const { player, tick } = setup();
  const a = await player('ann_vs'), b = await player('ben_vs');
  await a.poll(); await b.poll();

  // validation
  assert.equal((await a.call('POST', 'versus/challenge', { to: 'ben_vs', songId: 'custom-123', diff: 'Hard' })).status, 400);
  assert.equal((await a.call('POST', 'versus/challenge', { to: 'ben_vs', songId: 'afterglow', diff: 'Extreme' })).status, 400);
  assert.equal((await a.call('POST', 'versus/challenge', { to: 'ann_vs', songId: 'afterglow', diff: 'Easy' })).status, 400);
  assert.equal((await a.call('POST', 'versus/challenge', { to: 'nobody_here', songId: 'afterglow', diff: 'Easy' })).status, 404);

  // decline reaches the challenger
  await a.call('POST', 'versus/challenge', { to: 'ben_vs', songId: 'afterglow', diff: 'Easy' });
  await b.call('POST', 'versus/respond', { from: 'ann_vs', accept: false });
  assert.deepEqual((await a.poll()).body.events, [{ type: 'declined', by: 'ben_vs' }]);

  // challenges expire
  await a.call('POST', 'versus/challenge', { to: 'ben_vs', songId: 'afterglow', diff: 'Easy' });
  tick(21_000);
  await a.poll();
  assert.equal((await b.call('POST', 'versus/respond', { from: 'ann_vs', accept: true })).status, 410);

  // forfeit: the other player wins
  await a.call('POST', 'versus/challenge', { to: 'ben_vs', songId: 'afterglow', diff: 'Easy' });
  const id = (await b.call('POST', 'versus/respond', { from: 'ann_vs', accept: true })).body.match.id;
  await a.call('POST', 'versus/forfeit', { matchId: id });
  let r = await b.poll({ match: id });
  assert.equal(r.body.match.result.outcome, 'win');
  assert.equal(r.body.match.result.reason, 'forfeit');
  assert.ok(r.body.events.some((e: { type: string }) => e.type === 'forfeit'));

  // timeout: someone never reports back
  await a.poll(); await b.poll();
  await b.call('POST', 'versus/challenge', { to: 'ann_vs', songId: 'afterglow', diff: 'Easy' });
  const id2 = (await a.call('POST', 'versus/respond', { from: 'ben_vs', accept: true })).body.match.id;
  await a.call('POST', 'versus/final', { matchId: id2, score: 100 });
  tick(200_000);
  r = await a.poll({ match: id2 });
  assert.deepEqual(r.body.match.result, { outcome: 'win', reason: 'timeout', you: 100, them: 0 });

  // outsiders can't see or touch a match
  const c = await player('cat_vs');
  assert.equal((await c.call('POST', 'versus/progress', { matchId: id2, score: 5 })).status, 404);
  assert.equal((await c.poll({ match: id2 })).body.match, null);

  // players who stop polling drop off the lobby
  tick(30_000);
  await c.poll();
  assert.deepEqual((await c.poll({ lobby: '1' })).body.online, []);
});

test('guests can not use 1v1', async () => {
  const handle = createAuth(memoryStore(), { scrypt: { N: 1024, r: 8, p: 1 } });
  const res = await handle({ method: 'GET', path: 'versus/poll', ip: '1.1.1.1', secure: true, rawBody: '', headers: { host: 'x.test', 'x-linerush': '1' } });
  assert.equal(res.status, 401);
});
