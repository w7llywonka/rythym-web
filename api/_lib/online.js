// Line Rush online boards (port of the Roblox LineRushOnline script): per-chart leaderboards, the
// weekly challenge board (its #1 is King of the Hill) and a live feed of big plays.
//
//   lb:{song}:{diff}     sorted set: username -> best score on that chart
//   wk:{week}            sorted set: username -> best weekly-challenge score (kept 5 weeks)
//   look:{user}          what a player wears online: { title, tag, color } (kept 400 days)
//   title:{user}         the old title-only key, read when there's no look yet (no longer written)
//   boards:{user}        set of boards a player is on (so deleting an account removes them)
//   feed                 newest-first list of big plays (structured, the client renders it safely)
import { DIFF_LABEL, RANK, SONGS, chartExists, maxScore } from './catalog.js';
import { currentWeek, pickWeekly } from '../../shared/weekly.js';
import { cleanNameColor, cleanTag } from '../../shared/cosmetics.js';

const TOP = 10;
const FEED_KEEP = 20;
const FEED_SHOW = 8;
const WEEK_TTL = 35 * 86400;
const LOOK_TTL = 400 * 86400;

const chartKey = (songId, diff) => `lb:${songId}:${diff}`;
const weekKey = week => `wk:${week}`;
const cleanTitle = t => (typeof t === 'string' ? t.replace(/[^\w !'&.-]/g, '').slice(0, 24) : '');

// ---- looks: tags and name colors are ids from shared/cosmetics.js, anything else becomes '' ----------
const CLEAN = { title: cleanTitle, tag: cleanTag, color: cleanNameColor };
const LOOK_FIELDS = Object.keys(CLEAN);

/** @returns {{ title: string, tag: string, color: string }} */
export const cleanLook = l => ({ title: cleanTitle(l?.title), tag: cleanTag(l?.tag), color: cleanNameColor(l?.color) });
/** the two keys to mget for a player's look (lowercase name): the look, then the old title */
export const lookKeys = lower => [`look:${lower}`, `title:${lower}`];
/** a stored look (checked again on the way out), or the old title alone */
export function parseLook(raw, legacyTitle) {
  let l = null;
  try { l = raw ? JSON.parse(raw) : null; } catch { /* unreadable: treat as missing */ }
  return cleanLook(l && typeof l === 'object' ? l : { title: legacyTitle });
}
/** looks for many players (lowercase names) in one round trip */
export async function readLooks(store, lowers) {
  const flat = await store.mget(...lowers.flatMap(lookKeys));
  return lowers.map((_, i) => parseLook(flat[2 * i], flat[2 * i + 1]));
}
/**
 * Saves what a request asks for: a field that's absent keeps its stored value, '' (or anything that
 * isn't allowed) clears it. Only reads the stored look when it needs it.
 */
export async function saveLook(store, lower, body) {
  const given = LOOK_FIELDS.filter(f => Object.hasOwn(body, f));
  let look = cleanLook(null);
  if (given.length < LOOK_FIELDS.length) [look] = await readLooks(store, [lower]);
  for (const f of given) look[f] = CLEAN[f](body[f]);
  await store.set(`look:${lower}`, JSON.stringify(look), { ex: LOOK_TTL });
  return look;
}

/** a stored feed line as sent to players (lines from before tags have none) */
function feedItem(raw) {
  let i = null;
  try { i = JSON.parse(raw); } catch { return null; }
  if (!i || typeof i !== 'object') return null;
  return { kind: i.kind, user: i.user, song: i.song, diff: i.diff, at: i.at, tag: cleanTag(i.tag), color: cleanNameColor(i.color) };
}

/**
 * @param {object} store
 * @param {{ now: () => number, limit: Function, requireSession: Function, optionalSession: Function, HttpError: any }} h
 */
export function onlineRoutes(store, { now, limit, requireSession, optionalSession, HttpError }) {
  async function board(key, session) {
    const top = await store.ztop(key, TOP);
    const looks = await readLooks(store, top.map(e => e.member.toLowerCase()));
    const entries = top.map((e, i) => ({ rank: i + 1, name: e.member, ...looks[i], score: e.score }));
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
        const look = await saveLook(store, lower, req.body);

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
          const item = { kind: message, user: name, song: song.title, diff: DIFF_LABEL[diff], at: now(), tag: look.tag, color: look.color };
          await store.lpushCapped('feed', JSON.stringify(item), FEED_KEEP);
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
        const items = (await store.lrange('feed', FEED_SHOW)).map(feedItem).filter(Boolean);
        return { body: { items } };
      },

      // what you wear on the boards, the feed and in 1v1
      'POST profile/look': async req => {
        const s = await requireSession(req);
        const lower = s.user.username.toLowerCase();
        await limit(`look:${lower}`, 30, 600, 'Changing your look too often. Try again in a few minutes.');
        return { body: { ok: true, look: await saveLook(store, lower, req.body) } };
      },
    },

    /** take a deleted account off every board */
    async forget(name) {
      const lower = name.toLowerCase();
      for (const key of await store.smembers(`boards:${lower}`)) await store.zrem(key, name);
      await store.del(`boards:${lower}`, ...lookKeys(lower));
    },
  };
}
