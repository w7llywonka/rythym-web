// Line Rush 1v1 (port of the Roblox LineRushVersus script): challenge someone who's online, both play
// the same chart from the same server moment, live score relay + quick reactions, highest score wins.
//
// Everything lives in Redis with expiry times, so nothing needs cleaning up by hand:
//   online                  sorted set of usernames, scored by their last heartbeat (ms)
//   vs:invite:{user}        the one pending challenge for a player (20 s)
//   vs:busy:{user}          the match a player is in
//   vs:match:{id}           who / what / when (never changes after it's created)
//   vs:prog:{id}:{user}     latest live score of each player
//   vs:final:{id}:{user}    final score (written once)
//   vs:forfeit:{id}         who gave up
//   vs:inbox:{user}         small events: declined, reactions, opponent finished...
import { randomBytes } from 'node:crypto';
import { SONGS, chartExists } from './catalog.js';

const ONLINE_MS = 25_000; // a player counts as online if they've polled in this window
const INVITE_SECONDS = 20;
const START_DELAY_MS = 6_000; // accept -> first beat
const REACTIONS = 4;

const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
const clampNum = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/**
 * @param {object} store
 * @param {{ now: () => number, limit: Function, requireSession: Function, HttpError: any }} h
 */
export function versusRoutes(store, { now, limit, requireSession, HttpError }) {
  const me = s => ({ name: s.user.username, lower: s.user.username.toLowerCase() });
  const push = (lower, event) => store.rpush(`vs:inbox:${lower}`, JSON.stringify(event), 60);

  async function isOnline(name) {
    const recent = await store.zrangebyscore('online', now() - ONLINE_MS, '+inf');
    return recent.find(n => n.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async function getMatch(id, lower) {
    if (typeof id !== 'string' || !/^[\w-]{6,40}$/.test(id)) return null;
    const m = parse(await store.get(`vs:match:${id}`));
    if (!m || (m.al !== lower && m.bl !== lower)) return null;
    return m;
  }

  /** the match from one player's point of view, including the result once there is one */
  async function view(m, lower) {
    const other = m.al === lower ? m.bl : m.al;
    const [oppProg, myFinal, oppFinal, forfeit] = await store.mget(
      `vs:prog:${m.id}:${other}`, `vs:final:${m.id}:${lower}`, `vs:final:${m.id}:${other}`, `vs:forfeit:${m.id}`);
    const mine = parse(myFinal), theirs = parse(oppFinal);
    let result = null;
    const settle = (outcome, reason) => ({ outcome, reason, you: mine?.score ?? 0, them: theirs?.score ?? 0 });
    if (forfeit) result = settle(forfeit === lower ? 'lose' : 'win', 'forfeit');
    else if (mine && theirs) result = settle(mine.score === theirs.score ? 'draw' : mine.score > theirs.score ? 'win' : 'lose', 'done');
    else if (now() > m.endBy) {
      // safety net: someone never reported back
      const a = mine?.score ?? -1, b = theirs?.score ?? -1;
      result = settle(a === b ? 'draw' : a > b ? 'win' : 'lose', 'timeout');
    }
    if (result) await release(m);
    return {
      id: m.id, songId: m.songId, diff: m.diff, startAt: m.startAt, endBy: m.endBy,
      opponent: m.al === lower ? m.b : m.a,
      opp: parse(oppProg), oppDone: theirs ? theirs.score : null, result,
    };
  }

  /** free both players once a match is settled */
  async function release(m) {
    const [ba, bb] = await store.mget(`vs:busy:${m.al}`, `vs:busy:${m.bl}`);
    const keys = [];
    if (ba === m.id) keys.push(`vs:busy:${m.al}`);
    if (bb === m.id) keys.push(`vs:busy:${m.bl}`);
    if (keys.length) await store.del(...keys);
  }

  async function poll(s, query = {}) {
    const { name, lower } = me(s);
    const t = now();
    await store.zadd('online', t, name);
    await store.zremrangebyscore('online', 0, t - 120_000);
    const [inviteRaw, busy] = await store.mget(`vs:invite:${lower}`, `vs:busy:${lower}`);
    let invite = parse(inviteRaw);
    if (invite && t - invite.at > INVITE_SECONDS * 1000) invite = null;
    const out = {
      now: t,
      incoming: invite ? { from: invite.from, songId: invite.songId, diff: invite.diff, expiresIn: Math.max(0, invite.at + INVITE_SECONDS * 1000 - t) } : null,
      match: null,
      events: (await store.drain(`vs:inbox:${lower}`)).map(parse).filter(Boolean),
      online: undefined,
    };
    const matchId = typeof query.match === 'string' && query.match ? query.match : busy;
    const m = matchId ? await getMatch(matchId, lower) : null;
    if (m) out.match = await view(m, lower);
    if (query.lobby === '1') {
      const names = (await store.zrangebyscore('online', t - ONLINE_MS, '+inf')).filter(n => n.toLowerCase() !== lower).slice(-50).reverse();
      const busyFlags = await store.mget(...names.map(n => `vs:busy:${n.toLowerCase()}`));
      out.online = names.map((n, i) => ({ name: n, busy: !!busyFlags[i] }));
    }
    return out;
  }

  return {
    'GET versus/poll': async req => {
      const s = await requireSession(req);
      await limit(`vspoll:${s.user.username.toLowerCase()}`, 400, 60, 'Slow down a little.');
      return { body: await poll(s, req.query) };
    },

    'POST versus/challenge': async req => {
      const s = await requireSession(req);
      const { name, lower } = me(s);
      await limit(`vschal:${lower}`, 12, 60, 'Too many challenges. Wait a minute.');
      const { to, songId, diff } = req.body;
      if (!chartExists(songId, diff)) throw new HttpError(400, 'Pick one of the Line Rush songs first (imported songs only exist on your computer).');
      if (typeof to !== 'string' || to.length > 20) throw new HttpError(400, "That player isn't online anymore.");
      const target = await isOnline(to);
      if (!target) throw new HttpError(404, "That player isn't online anymore.");
      const tl = target.toLowerCase();
      if (tl === lower) throw new HttpError(400, "You can't challenge yourself.");
      const [b1, b2] = await store.mget(`vs:busy:${lower}`, `vs:busy:${tl}`);
      if (b1 || b2) throw new HttpError(409, 'Someone is already in a battle.');
      const invite = { from: name, fromLower: lower, songId, diff, at: now() };
      if (!(await store.set(`vs:invite:${tl}`, JSON.stringify(invite), { ex: INVITE_SECONDS, nx: true }))) {
        throw new HttpError(409, `${target} already has a challenge waiting.`);
      }
      return { body: { ok: true, to: target } };
    },

    'POST versus/respond': async req => {
      const s = await requireSession(req);
      const { name, lower } = me(s);
      const invite = parse(await store.get(`vs:invite:${lower}`));
      if (!invite || typeof req.body.from !== 'string' || invite.fromLower !== req.body.from.toLowerCase()) {
        throw new HttpError(410, 'That challenge expired.');
      }
      await store.del(`vs:invite:${lower}`);
      if (now() - invite.at > INVITE_SECONDS * 1000) throw new HttpError(410, 'That challenge expired.');
      if (req.body.accept !== true) {
        await push(invite.fromLower, { type: 'declined', by: name });
        return { body: { ok: true } };
      }
      const [b1, b2] = await store.mget(`vs:busy:${lower}`, `vs:busy:${invite.fromLower}`);
      if (b1 || b2) throw new HttpError(409, 'Someone is already in a battle.');
      const song = SONGS.get(invite.songId);
      const startAt = now() + START_DELAY_MS;
      const endBy = startAt + Math.ceil(((song?.duration ?? 120) + 30) * 1000);
      const ttl = Math.ceil((endBy - now()) / 1000) + 600;
      const m = {
        id: randomBytes(12).toString('base64url'),
        a: invite.from, al: invite.fromLower, b: name, bl: lower,
        songId: invite.songId, diff: invite.diff, startAt, endBy,
      };
      await store.set(`vs:match:${m.id}`, JSON.stringify(m), { ex: ttl });
      await store.set(`vs:busy:${m.al}`, m.id, { ex: ttl });
      await store.set(`vs:busy:${m.bl}`, m.id, { ex: ttl });
      await push(m.al, { type: 'start', matchId: m.id });
      return { body: { ok: true, now: now(), match: await view(m, lower) } };
    },

    'POST versus/progress': async req => {
      const s = await requireSession(req);
      const { lower } = me(s);
      await limit(`vspoll:${lower}`, 400, 60, 'Slow down a little.');
      const m = await getMatch(req.body.matchId, lower);
      if (!m) throw new HttpError(404, 'That battle is over.');
      const b = req.body;
      const prog = { score: clampInt(b.score, 1e8), combo: clampInt(b.combo, 1e6), health: clampNum(b.health, 100), accuracy: clampNum(b.accuracy, 100) };
      await store.set(`vs:prog:${m.id}:${lower}`, JSON.stringify(prog), { ex: 900 });
      return { body: await poll(s, { match: m.id }) };
    },

    'POST versus/react': async req => {
      const s = await requireSession(req);
      const { lower } = me(s);
      const m = await getMatch(req.body.matchId, lower);
      const i = Math.floor(Number(req.body.i));
      if (!m || !(i >= 1 && i <= REACTIONS)) throw new HttpError(400, 'Invalid reaction.');
      if (await store.set(`cooldown:react:${lower}`, '1', { ex: 1, nx: true })) {
        await push(m.al === lower ? m.bl : m.al, { type: 'react', i });
      }
      return { body: { ok: true } };
    },

    'POST versus/final': async req => {
      const s = await requireSession(req);
      const { lower } = me(s);
      const m = await getMatch(req.body.matchId, lower);
      if (!m) throw new HttpError(404, 'That battle is over.');
      const final = { score: clampInt(req.body.score, 1e8), cleared: req.body.cleared === true };
      if (await store.set(`vs:final:${m.id}:${lower}`, JSON.stringify(final), { ex: 900, nx: true })) {
        await push(m.al === lower ? m.bl : m.al, { type: 'opponentDone', score: final.score });
      }
      return { body: { ok: true, match: await view(m, lower) } };
    },

    'POST versus/forfeit': async req => {
      const s = await requireSession(req);
      const { lower } = me(s);
      const m = await getMatch(req.body.matchId, lower);
      if (!m) return { body: { ok: true } };
      const v = await view(m, lower);
      if (!v.result && await store.set(`vs:forfeit:${m.id}`, lower, { ex: 900, nx: true })) {
        await push(m.al === lower ? m.bl : m.al, { type: 'forfeit' });
        await release(m);
      }
      return { body: { ok: true } };
    },
  };
}
