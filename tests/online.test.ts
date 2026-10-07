import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuth } from '../api/_lib/core.js';
import { memoryStore } from '../api/_lib/store.js';
import { currentWeek, pickWeekly } from '../shared/weekly.js';
import { soundtrack } from '../src/tracks.ts';
import { chartObjects } from '../scripts/chart-objects.ts';

// Test-only accounts in an in-memory store.
const PASS = 'velvet-harbor-58-comet';

function setup() {
  let clock = Date.UTC(2026, 9, 7, 12) as number;
  const now = () => clock;
  const handle = createAuth(memoryStore({ now }), { scrypt: { N: 1024, r: 8, p: 1 }, now });
  let ip = 0;
  const client = (cookie = '') => {
    const addr = `10.2.0.${++ip}`;
    return async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
      const res = await handle({
        method, path, query, ip: addr, secure: true,
        headers: { host: 'linerush.test', 'x-linerush': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        rawBody: body === undefined ? '' : JSON.stringify(body),
      });
      const set = res.headers['Set-Cookie'];
      if (typeof set === 'string') cookie = set.includes('Max-Age=0') ? '' : set.split(';')[0];
      return { status: res.status, body: JSON.parse(res.body) };
    };
  };
  const player = async (username: string) => {
    const call = client();
    assert.equal((await call('POST', 'auth/register', { username, password: PASS })).status, 201);
    return call;
  };
  return { player, guest: client(), tick: (ms: number) => { clock += ms; }, now };
}

test('shared/chart-objects.json matches the chart generator (run `npm run charts` if not)', () => {
  const onDisk = JSON.parse(readFileSync(new URL('../shared/chart-objects.json', import.meta.url), 'utf8'));
  assert.deepEqual(onDisk, chartObjects());
});

test('leaderboards keep each player\'s best, rank them and show titles', async () => {
  const { player, guest, tick } = setup();
  const alice = await player('alice_lb'), bob = await player('bob_lb');
  const submit = async (call: typeof alice, score: number, extra = {}) => {
    tick(4000);
    return call('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score, grade: 'A', fc: false, title: 'Rookie', ...extra });
  };
  let r = await submit(alice, 5000);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.chart.improved, r.body.chart.rank], [true, 1]);
  await submit(bob, 7000);
  r = await submit(alice, 6000);
  assert.deepEqual([r.body.chart.improved, r.body.chart.rank, r.body.chart.best], [true, 2, 6000]);
  r = await submit(alice, 4000);
  assert.deepEqual([r.body.chart.improved, r.body.chart.best], [false, 6000]);

  r = await alice('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' });
  assert.deepEqual(r.body.entries.map((e: { name: string; score: number; rank: number }) => [e.rank, e.name, e.score]), [[1, 'bob_lb', 7000], [2, 'alice_lb', 6000]]);
  assert.equal(r.body.entries[0].title, 'Rookie');
  assert.deepEqual(r.body.mine, { score: 6000, rank: 2 });
  // guests can read boards (without a "mine")
  r = await guest('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mine, null);
});

test('scores are validated', async () => {
  const { player, guest, tick } = setup();
  const p = await player('carl_lb');
  const objects = JSON.parse(readFileSync(new URL('../shared/chart-objects.json', import.meta.url), 'utf8')).current.charts.Hard;
  tick(4000);
  assert.equal((await p('POST', 'scores/submit', { songId: 'custom-abc', diff: 'Hard', score: 10 })).status, 400);
  assert.equal((await p('POST', 'scores/submit', { songId: 'current', diff: 'Easy', score: 10 })).status, 400, 'chart that does not exist');
  assert.equal((await p('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score: objects * 300 * 4 * 3 })).status, 400, 'impossible score');
  assert.equal((await p('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score: -5 })).status, 400);
  assert.equal((await p('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score: 900 })).status, 200);
  assert.equal((await p('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score: 950 })).status, 429, 'one score per 3 s');
  assert.equal((await guest('POST', 'scores/submit', { songId: 'current', diff: 'Hard', score: 10 })).status, 401);
});

test('adding songs never changes the weekly challenge of a week in progress', () => {
  const originals = soundtrack().filter(t => !t.song.credit);
  // the week the licensed songs were added keeps its song; from the next week they're in the pool
  assert.equal(pickWeekly(2961, soundtrack())!.song.id, pickWeekly(2961, originals)!.song.id);
  const later = Array.from({ length: 40 }, (_, i) => pickWeekly(2962 + i, soundtrack())!.song);
  assert.ok(later.some(s => s.song.credit), 'licensed Expert songs show up in later weeks');
  // the server's catalog knows the same weeks
  const objects = JSON.parse(readFileSync(new URL('../shared/chart-objects.json', import.meta.url), 'utf8'));
  for (const t of soundtrack()) assert.equal(objects[t.id].weeklyFrom, t.weeklyFrom);
});

test('the live feed and King of the Hill', async () => {
  const { player, guest, tick, now } = setup();
  const a = await player('ann_lb'), b = await player('ben_lb');
  const { week } = currentWeek(now() / 1000);
  const pick = pickWeekly(week, soundtrack())!; // the same catalog the server uses
  const weeklyRun = { songId: pick.song.id, diff: pick.song.difficulty, weekly: week, style: pick.mods.style, rate: pick.mods.rate, grade: 'A', fc: false };

  tick(20_000);
  let r = await a('POST', 'scores/submit', { ...weeklyRun, score: 3000 });
  assert.equal(r.body.weekly.rank, 1);
  tick(20_000);
  r = await b('POST', 'scores/submit', { ...weeklyRun, score: 4000 });
  assert.equal(r.body.weekly.tookTop, true);
  // wrong modifiers don't count for the weekly board
  tick(20_000);
  r = await a('POST', 'scores/submit', { ...weeklyRun, style: 'Playground', score: 9000 });
  assert.equal(r.body.weekly, null);

  r = await guest('GET', 'scores/board', undefined, { weekly: '1' });
  assert.equal(r.body.week, week);
  assert.deepEqual(r.body.entries.map((e: { name: string }) => e.name), ['ben_lb', 'ann_lb']);

  r = await guest('GET', 'scores/feed');
  const kinds = r.body.items.map((i: { kind: string; user: string }) => `${i.user}:${i.kind}`);
  assert.equal(kinds[0], 'ann_lb:top', 'ann took #1 on the chart with 9000');
  assert.ok(kinds.includes('ben_lb:king'));
  assert.ok(r.body.items.every((i: { song: string }) => i.song === pick.song.title));

  // deleting an account takes it off every board
  assert.equal((await b('POST', 'auth/delete', { password: PASS })).status, 200);
  r = await guest('GET', 'scores/board', undefined, { weekly: '1' });
  assert.deepEqual(r.body.entries.map((e: { name: string }) => e.name), ['ann_lb']);
});
