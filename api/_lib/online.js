// Line Rush online boards (port of the Roblox LineRushOnline script): per-chart leaderboards, the
// weekly challenge board (its #1 is King of the Hill) and a live feed of big plays.
//
//   lb:{song}:{diff}     sorted set: username -> best score on that chart
//   wk:{week}            sorted set: username -> best weekly-challenge score (kept 5 weeks)
//   title:{user}         the title a player wears on the boards
//   boards:{user}        set of boards a player is on (so deleting an account removes them)
//   feed                 newest-first list of big plays (structured, the client renders it safely)
import { DIFF_LABEL, RANK, SONGS, chartExists, maxScore } from './catalog.js';
import { currentWeek, pickWeekly } from '../../shared/weekly.js';

const TOP = 10;
const FEED_KEEP = 20;
const FEED_SHOW = 8;
const WEEK_TTL = 35 * 86400;

const chartKey = (songId, diff) => `lb:${songId}:${diff}`;
const weekKey = week => `wk:${week}`;
const cleanTitle = t => (typeof t === 'string' ? t.replace(/[^\w !'&.-]/g, '').slice(0, 24) : '');

/**
 * @param {object} store
 * @param {{ now: () => number, limit: Function, requireSession: Function, optionalSession: Function, HttpError: any }} h
 */
export function onlineRoutes(store, { now, limit, requireSession, optionalSession, HttpError }) {
  async function board(key, session) {
    const top = await store.ztop(key, TOP);
    const titles = await store.mget(...top.map(e => `title:${e.member.toLowerCase()}`));
    const entries = top.map((e, i) => ({ rank: i + 1, name: e.member, title: titles[i] ?? '', score: e.score }));
    const mine = session ? await store.zrankOf(key, session.user.username) : null;
    return { entries, mine };
  }

  async function submit(key, name, lower, score, ttl) {
    const [before] = await store.ztop(key, 1);
    const improved = await store.zbest(key, score, name, ttl);
    if (improved) await store.sadd(`boards:${lower}`, key);
    const mine = await store.zrankOf(key, name);
    return { improved, tookTop: improved && (!before || (score > before.score && before.member !== name)), rank: mine?.rank ?? null, best: mine?.score ?? score };
  }

  return {
    routes: {
      'POST scores/submit': async req => {
        const s = await requireSession(req);
        const name = s.user.username, lower = name.toLowerCase();
        await limit(`submit:${lower}`, 40, 600, 'Too many scores at once. Try again in a minute.');
        const { songId, diff, grade, fc, weekly, style, rate } = req.body;
        if (!chartExists(songId, diff)) throw new HttpError(400, 'Only Line Rush songs have leaderboards.');
        const score = Math.floor(Number(req.body.score));
        if (!Number.isFinite(score) || score < 0 || score > maxScore(songId, diff)) throw new HttpError(400, 'That score is not possible on this chart.');
        if (!(await store.set(`cooldown:submit:${lower}`, '1', { ex: 3, nx: true }))) throw new HttpError(429, 'Slow down a little.');
        await store.set(`title:${lower}`, cleanTitle(req.body.title), { ex: 400 * 86400 });

        const song = SONGS.get(songId);
        const chart = await submit(chartKey(songId, diff), name, lower, score);
        let message = null;
        if (chart.tookTop) message = 'top';
        else if (grade === 'SS' && RANK[diff] >= 2) message = 'ss';
        else if (fc === true && RANK[diff] >= 3) message = 'fc';
        else if (RANK[diff] >= 5) message = 'clear';

        // weekly challenge: must be this week's song, its own chart, and this week's modifiers
        let week = null;
        const { week: thisWeek } = currentWeek(now() / 1000);
        const pick = pickWeekly(thisWeek, [...SONGS.values()]);
        if (weekly === thisWeek && pick && pick.song.id === songId && diff === pick.song.difficulty
          && style === pick.mods.style && Number(rate) === pick.mods.rate) {
          week = await submit(weekKey(thisWeek), name, lower, score, WEEK_TTL);
          if (week.tookTop) message = 'king';
        }

        // one feed line per player per 15 s
        if (message && await store.set(`cooldown:feed:${lower}`, '1', { ex: 15, nx: true })) {
          await store.lpushCapped('feed', JSON.stringify({ kind: message, user: name, song: song.title, diff: DIFF_LABEL[diff], at: now() }), FEED_KEEP);
        }
        return { body: { ok: true, chart, weekly: week } };
      },

      'GET scores/board': async req => {
        const s = await optionalSession(req);
        const { songId, diff } = req.query;
        if (req.query.weekly === '1') {
          const { week, ends } = currentWeek(now() / 1000);
          return { body: { week, ends: ends * 1000, ...(await board(weekKey(week), s)) } };
        }
        if (!chartExists(songId, diff)) throw new HttpError(404, 'Only Line Rush songs have leaderboards.');
        return { body: await board(chartKey(songId, diff), s) };
      },

      'GET scores/feed': async () => {
        const items = (await store.lrange('feed', FEED_SHOW)).map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(Boolean);
        return { body: { items } };
      },
    },

    /** take a deleted account off every board */
    async forget(name) {
      const lower = name.toLowerCase();
      for (const key of await store.smembers(`boards:${lower}`)) await store.zrem(key, name);
      await store.del(`boards:${lower}`, `title:${lower}`);
    },
  };
}
