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

type Store = ReturnType<typeof memoryStore>;
/** the store, plus a log of the store calls the server makes (round trips) */
function logged(store: Store) {
  const calls: string[] = [];
  const spy = new Proxy(store, {
    get(target, k) {
      const v = (target as Record<string | symbol, unknown>)[k];
      return typeof v === 'function' ? (...a: unknown[]) => { calls.push(String(k)); return v.apply(target, a); } : v;
    },
  });
  return { spy, calls };
}

function setup() {
  let clock = Date.UTC(2026, 9, 7, 12) as number;
  const now = () => clock;
  const store = memoryStore({ now });
  const { spy, calls } = logged(store);
  const handle = createAuth(spy, { scrypt: { N: 1024, r: 8, p: 1 }, now });
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
  return { player, guest: client(), tick: (ms: number) => { clock += ms; }, now, store, calls };
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

// ---- looks: title, tag and name color -------------------------------------------------------------

const RUN = { songId: 'current', diff: 'Hard', grade: 'A', fc: false };
type Entry = { name: string; title: string; tag: string; color: string };
const looksOf = (entries: Entry[]) => entries.map(e => [e.name, e.title, e.tag, e.color]);

test("looks: only tag and name color ids from the shared lists; absent fields are kept, '' clears", async () => {
  const { player, guest, store } = setup();
  const p = await player('dana_look');
  const look = async (body: object) => (await p('POST', 'profile/look', body)).body.look;
  assert.equal((await guest('POST', 'profile/look', { tag: 'veteran' })).status, 401);

  const r = await p('POST', 'profile/look', { title: 'Rookie', tag: 'veteran', color: 'gold' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, look: { title: 'Rookie', tag: 'veteran', color: 'gold' } });
  assert.deepEqual(await look({ tag: 'duelist' }), { title: 'Rookie', tag: 'duelist', color: 'gold' }, 'absent fields keep their value');
  assert.deepEqual(await look({ title: '' }), { title: '', tag: 'duelist', color: 'gold' }, "'' clears");
  assert.deepEqual(await look({}), { title: '', tag: 'duelist', color: 'gold' });
  assert.deepEqual(await look({ color: 'default' }), { title: '', tag: 'duelist', color: '' }, 'white is no color');

  // anything that isn't an id from the lists is stored (and sent) as nothing
  for (const bad of ['<img src=x onerror=alert(1)>', 'VETERAN', ' veteran', '__proto__', 'constructor', 'toString', 42, true, null, ['veteran'], { id: 'veteran' }]) {
    await look({ tag: 'king', color: 'sky' });
    assert.deepEqual(await look({ tag: bad, color: bad }), { title: '', tag: '', color: '' }, JSON.stringify(bad));
  }
  // titles are cleaned like before; nothing else from the request is kept
  assert.equal((await look({ title: '<script>alert("hi")</script>' })).title, 'scriptalerthiscript');
  assert.equal((await look({ title: 'x'.repeat(100) })).title.length, 24);
  await look({ title: 'Rookie', tag: 'og', color: 'aurora', name: 'admin', html: '<b>' });
  assert.deepEqual(JSON.parse((await store.get('look:dana_look'))!), { title: 'Rookie', tag: 'og', color: 'aurora' });
});

test("boards carry each player's title, tag and name color (the old title key is a fallback)", async () => {
  const { player, guest, tick, store } = setup();
  const amy = await player('amy_look'), bo = await player('bo_look'), cy = await player('cy_look');
  const board = async () => (await guest('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' })).body.entries as Entry[];

  // an up-to-date game sends the look with the score
  tick(4000);
  await amy('POST', 'scores/submit', { ...RUN, score: 7000, title: 'Rookie', tag: 'veteran', color: 'aurora' });
  // a game from before 1.1 only sends the title: the tag and color set in the Locker stay
  await bo('POST', 'profile/look', { tag: 'duelist', color: 'rose' });
  tick(4000);
  await bo('POST', 'scores/submit', { ...RUN, score: 6000, title: 'Grinder' });
  // cy's score and title are from before looks existed
  await store.zbest('lb:current:Hard', 5000, 'cy_look');
  await store.sadd('boards:cy_look', 'lb:current:Hard');
  await store.set('title:cy_look', 'Old Timer');

  assert.deepEqual(looksOf(await board()), [
    ['amy_look', 'Rookie', 'veteran', 'aurora'], ['bo_look', 'Grinder', 'duelist', 'rose'], ['cy_look', 'Old Timer', '', ''],
  ]);
  assert.deepEqual(Object.keys((await board())[0]), ['rank', 'name', 'title', 'tag', 'color', 'score']);

  // a score with no look at all keeps the old title in the new look; after that the look wins
  tick(4000);
  await cy('POST', 'scores/submit', { ...RUN, score: 5500 });
  assert.deepEqual(JSON.parse((await store.get('look:cy_look'))!), { title: 'Old Timer', tag: '', color: '' });
  await cy('POST', 'profile/look', { title: '' });
  assert.equal((await board())[2].title, '', 'a cleared title stays cleared');

  // ids that aren't in the lists are cleared, from scores too
  tick(4000);
  await amy('POST', 'scores/submit', { ...RUN, score: 100, title: 'Rookie', tag: 'hacker', color: '#FF0000' });
  assert.deepEqual(looksOf(await board())[0], ['amy_look', 'Rookie', '', '']);

  // whatever is in the store is checked again on the way out
  await store.set('look:bo_look', JSON.stringify({ title: '<b>Hi</b>', tag: '<script>', color: 'url(javascript:alert(1))', extra: 'x' }));
  await store.set('look:cy_look', 'not json');
  const [, bo2, cy2] = await board();
  assert.deepEqual([bo2.title, bo2.tag, bo2.color, 'extra' in bo2], ['bHib', '', '', false]);
  assert.equal(cy2.title, 'Old Timer', 'an unreadable look falls back to the old title');
});

test('the live feed shows the tag and name color a player had at that moment', async () => {
  const { player, guest, tick, store } = setup();
  const eve = await player('eve_look');
  await eve('POST', 'profile/look', { tag: 'king', color: 'royal' });
  tick(4000);
  const r = await eve('POST', 'scores/submit', { ...RUN, score: 3000, title: '' });
  assert.equal(r.body.chart.tookTop, true);
  await eve('POST', 'profile/look', { tag: '', color: 'sky' }); // later changes don't rewrite the feed

  // a line from before tags, one with junk in it, and ones that aren't usable at all
  await store.lpushCapped('feed', JSON.stringify({ kind: 'ss', user: 'old_timer', song: 'Afterglow', diff: 'HARD', at: 1 }), 20);
  await store.lpushCapped('feed', JSON.stringify({ kind: 'fc', user: 'x_look', song: 'y', diff: 'EXPERT', at: 2, tag: '<img>', color: 'url(x)', html: '<b>' }), 20);
  await store.lpushCapped('feed', '{oops', 20);
  await store.lpushCapped('feed', 'null', 20);

  const items = (await guest('GET', 'scores/feed')).body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map(i => [i.user, i.tag, i.color]), [['x_look', '', ''], ['old_timer', '', ''], ['eve_look', 'king', 'royal']]);
  for (const i of items) assert.deepEqual(Object.keys(i), ['kind', 'user', 'song', 'diff', 'at', 'tag', 'color']);
});

test('looks: changes are rate limited per player', async () => {
  const { player, tick } = setup();
  const fay = await player('fay_look'), gus = await player('gus_look');
  for (let i = 0; i < 30; i++) assert.equal((await fay('POST', 'profile/look', { tag: i % 2 ? 'veteran' : '' })).status, 200);
  const r = await fay('POST', 'profile/look', { tag: 'elite' });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /too often/);
  assert.equal((await gus('POST', 'profile/look', { tag: 'veteran' })).status, 200, 'other players are not affected');
  tick(601_000);
  const after = await fay('POST', 'profile/look', {});
  assert.equal(after.status, 200, 'the window ends');
  assert.equal(after.body.look.tag, 'veteran', 'the refused change was not saved');
});

test('deleting an account removes its look', async () => {
  const { player, guest, tick, store } = setup();
  const hal = await player('hal_look');
  await hal('POST', 'profile/look', { title: 'Rookie', tag: 'veteran', color: 'gold' });
  await store.set('title:hal_look', 'Rookie'); // an old title key too
  tick(4000);
  await hal('POST', 'scores/submit', { ...RUN, score: 900, title: 'Rookie' });
  assert.equal((await hal('POST', 'auth/delete', { password: PASS })).status, 200);
  assert.deepEqual(await store.mget('look:hal_look', 'title:hal_look'), [null, null]);

  // someone new with the same name starts plain
  const again = await player('hal_look');
  tick(4000);
  await again('POST', 'scores/submit', { ...RUN, score: 10 });
  const r = await guest('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' });
  assert.deepEqual(looksOf(r.body.entries), [['hal_look', '', '', '']]);
});

test('looks cost no extra store round trips', async () => {
  const { player, guest, tick, calls } = setup();
  const players = [await player('ia_look'), await player('jo_look'), await player('ki_look')];
  for (const [i, p] of players.entries()) {
    tick(4000);
    await p('POST', 'scores/submit', { ...RUN, score: 1000 * (i + 1), title: 'Rookie', tag: 'veteran', color: 'gold' });
  }
  calls.length = 0;
  await guest('GET', 'scores/board', undefined, { songId: 'current', diff: 'Hard' });
  assert.deepEqual(calls, ['ztop', 'mget'], 'one mget for every title, tag and color on the board');

  // a full look sent with a score is written without reading the old one; a partial one reads it once
  calls.length = 0;
  tick(4000);
  await players[0]('POST', 'scores/submit', { ...RUN, score: 5000, title: 'Rookie', tag: 'og', color: 'sky' });
  assert.ok(!calls.includes('mget'), calls.join());
  calls.length = 0;
  tick(4000);
  await players[0]('POST', 'scores/submit', { ...RUN, score: 6000, title: 'Rookie' });
  assert.equal(calls.filter(c => c === 'mget').length, 1, calls.join());
});
