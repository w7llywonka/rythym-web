import test from 'node:test';
import assert from 'node:assert/strict';
import { SongPrep, latestStart, type PrepState } from '../src/app/vsPrep.ts';

// a load we settle by hand
function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('1v1 song prep: loading, then ready (and only then can you accept)', async () => {
  const prep = new SongPrep();
  const seen: PrepState[] = [];
  const load = deferred();
  let loads = 0;
  const start = () => prep.want('ann:afterglow:Hard', () => { loads++; return load.promise; }, s => seen.push(s));
  start();
  assert.equal(prep.state, 'loading');
  assert.equal(prep.ready('ann:afterglow:Hard'), false);
  // every poll asks again while the pop-up is up: still one download
  start(); start();
  assert.equal(loads, 1);
  load.resolve();
  await flush();
  assert.deepEqual(seen, ['ready']);
  assert.equal(prep.ready('ann:afterglow:Hard'), true);
  assert.equal(prep.ready('ann:afterglow:Easy'), false, 'ready for this challenge only');
  start();
  assert.equal(loads, 1, 'a ready song is not loaded again');
});

test('1v1 song prep: a failed load is reported, and retried if the same challenge comes back', async () => {
  const prep = new SongPrep();
  const seen: PrepState[] = [];
  const first = deferred(), second = deferred();
  const loads = [first, second];
  let n = 0;
  const start = () => prep.want('ben:current:Expert', () => loads[n++].promise, s => seen.push(s));
  start();
  first.reject(new Error('audio 503'));
  await flush();
  assert.deepEqual(seen, ['failed']);
  assert.equal(prep.ready('ben:current:Expert'), false);
  start();
  assert.equal(n, 2);
  assert.equal(prep.state, 'loading');
  second.resolve();
  await flush();
  assert.deepEqual(seen, ['failed', 'ready']);
});

test('1v1 song prep: a load for an older challenge is ignored', async () => {
  const prep = new SongPrep();
  const seen: string[] = [];
  const old = deferred(), next = deferred();
  prep.want('ann:afterglow:Hard', () => old.promise, s => seen.push(`old ${s}`));
  prep.want('cat:daybreak:Easy', () => next.promise, s => seen.push(`new ${s}`));
  old.reject(new Error('gone'));
  old.resolve();
  await flush();
  assert.deepEqual(seen, []);
  assert.equal(prep.state, 'loading');
  next.resolve();
  await flush();
  assert.deepEqual(seen, ['new ready']);
  assert.equal(prep.ready('ann:afterglow:Hard'), false);
  assert.equal(prep.ready('cat:daybreak:Easy'), true);
});

test('1v1: the last moment a run can start and still count', () => {
  // the server's deadline is the start + song length + 30 s
  const startAt = 1_800_000_000_000;
  const endBy = startAt + (120 + 30) * 1000;
  // a full-length chart: about 25 s of slack, minus time to finish and report
  assert.equal(latestStart(endBy, 120), startAt + 25_000);
  // a chart on a 60 s stretch of the song leaves much more
  assert.equal(latestStart(endBy, 60), startAt + 85_000);
  assert.ok(latestStart(endBy, 120.4) < startAt + 25_000);
});
