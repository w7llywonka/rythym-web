// 1v1 (port of the Roblox versus client): lobby of online players, challenge pop-up, shared start,
// live opponent panel, reactions on keys 1-4, result banner. Talks to /api/versus/* by polling.
import { api, type VsMatch, type VsPoll } from '../api.ts';
import { ease, fade, pop, tween } from '../anim.ts';
import { MODES, T } from '../config.ts';
import type { Run } from '../game.ts';
import { formatNumber } from '../scoring.ts';
import type { Diff, PlaySet } from '../types.ts';
import { $, html, show, txt } from '../ui.ts';
import { openAuth, signedOut } from './accounts.ts';
import { quitToSongs, startRun } from './play.ts';
import { game } from './services.ts';
import { closeModal, escapeHtml, isOpen, onClick, openModal, queueToast, showToast } from './shell.ts';
import { S, chartFor } from './state.ts';

const REACTIONS = ['🔥', '😂', '😤', 'GG'];
export const VS_REACT_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4 };
const VS_SET: PlaySet = { style: 'Classic', rate: 1, hidden: false, sudden: false, flashlight: false, mirror: false, random: false, wave: false, mines: false, auto: false };

const vs = {
  offset: 0, // server clock - local clock (ms)
  timer: undefined as number | undefined,
  busy: false,
  lastReact: 0,
  onResults: false,
  /** the last challenge answered here, so a poll that's in flight can't bring the pop-up back */
  answered: '',
  incoming: null as { from: string; songId: string; diff: string; expiresAt: number } | null,
  current: null as { matchId: string; opponent: string; oppScore: number; result: VsMatch['result'] } | null,
};
const serverNow = () => Date.now() + vs.offset;
export const vsActive = () => vs.current !== null;

function lobbyTrack() {
  const t = S.selectedSong[S.tab] ?? S.selectedSong.Easy;
  return t ? { t, diff: chartFor(t).diff } : null;
}

function renderLobby(online?: { name: string; busy: boolean }[]) {
  const pick = lobbyTrack();
  txt($('versus.song.value'), pick ? `${pick.t.title}  ·  ${MODES[pick.diff].label}` : '-');
  const list = $('versus.list');
  const guest = !S.account;
  show($('versus.login'), guest && !S.accountsOffline);
  show(list, !guest);
  if (S.accountsOffline) return txt($('versus.status'), "1v1 needs the online server, which isn't set up here.");
  if (guest) return txt($('versus.status'), 'Log in to battle other players.');
  if (!online) return;
  const frag = document.createDocumentFragment();
  for (const p of online) {
    const row = document.createElement('div');
    row.className = 'vsrow';
    const name = document.createElement('span');
    name.textContent = p.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vsbtn';
    btn.textContent = p.busy ? 'IN A BATTLE' : 'CHALLENGE';
    btn.disabled = p.busy;
    btn.addEventListener('click', () => void challenge(p.name));
    row.append(name, btn);
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
  const status = $('versus.status');
  if (!online.length) txt(status, 'Nobody else is online right now. Send a friend linerush.world!');
  else if (status.dataset.sticky !== '1') txt(status, '');
}

async function challenge(name: string) {
  const pick = lobbyTrack();
  const status = $('versus.status');
  status.dataset.sticky = '1';
  if (!pick) return txt(status, 'Pick a song in Song Select first.');
  if (pick.t.custom) return txt(status, 'Imported songs only exist on your computer. Pick a Line Rush song for 1v1.');
  txt(status, 'Sending challenge...');
  const res = await api.vsChallenge(name, pick.t.id, pick.diff);
  txt(status, res.ok ? `Challenge sent to ${res.data!.to}. Waiting for them to accept...` : res.error ?? 'Something went wrong.');
}

function showPopup() {
  const inc = vs.incoming;
  const box = $('challenge');
  if (!inc) { show(box, false); return; }
  const t = S.tracksById.get(inc.songId);
  html($('challenge.text'), `<b>${escapeHtml(inc.from)}</b> wants to battle on <b>${escapeHtml(t?.title ?? '?')}</b> [${MODES[inc.diff as Diff]?.label ?? ''}]`);
  if (box.hidden) {
    show(box, true);
    tween(box, 'slide', -150, 20, 0.3, v => { box.style.top = `${v}px`; }, ease.back);
  }
}

async function respond(accept: boolean) {
  const inc = vs.incoming;
  vs.incoming = null;
  showPopup();
  if (!inc) return;
  vs.answered = `${inc.from}:${inc.songId}:${inc.diff}`;
  const res = await api.vsRespond(inc.from, accept);
  if (!res.ok) return showToast(res.error ?? 'That challenge expired.');
  if (accept && res.data?.match) begin(res.data.match);
}

function begin(m: VsMatch) {
  const t = S.tracksById.get(m.songId);
  if (!t) { void api.vsForfeit(m.id); return showToast("Couldn't load that song."); }
  vs.incoming = null;
  showPopup();
  vs.current = { matchId: m.id, opponent: m.opponent, oppScore: 0, result: null };
  txt($('game.left.versus.opponent'), m.opponent);
  txt($('game.left.versus.score'), '0');
  for (const part of ['combo', 'lead', 'sent', 'bubble']) txt($(`game.left.versus.${part}`), '');
  $('game.left.versus.health.fill').style.width = '100%';
  if (S.modal) closeModal();
  if (game.run) game.stop();
  showToast(`1v1 vs ${m.opponent}. Get ready!`);
  void startRun(t, m.diff as Diff, false, {
    set: VS_SET,
    versus: { matchId: m.id, opponent: m.opponent, leadIn: () => (m.startAt - serverNow()) / 1000 },
  });
}

function apply(d: VsPoll, sentAt: number) {
  // keep a smoothed estimate of the server clock (both players start on its timeline)
  const sample = d.now - (sentAt + Date.now()) / 2;
  vs.offset = vs.offset === 0 ? sample : vs.offset * 0.8 + sample * 0.2;
  const inc = d.incoming;
  if (inc && !vs.current && `${inc.from}:${inc.songId}:${inc.diff}` !== vs.answered) {
    vs.incoming = { from: inc.from, songId: inc.songId, diff: inc.diff, expiresAt: Date.now() + inc.expiresIn };
  } else if (!inc) {
    vs.incoming = null;
    vs.answered = '';
  }
  showPopup();
  for (const e of d.events) {
    if (e.type === 'declined') {
      $('versus.status').dataset.sticky = '1';
      txt($('versus.status'), `${e.by} declined.`);
      showToast(`${e.by} declined your challenge`);
    } else if (e.type === 'react') bubble(e.i);
    else if (e.type === 'opponentDone') { txt($('game.left.versus.combo'), 'finished'); txt($('game.left.versus.score'), formatNumber(e.score)); }
    else if (e.type === 'forfeit' && vs.current) showToast(`${vs.current.opponent} left the battle. You win!`);
  }
  const m = d.match;
  if (m && !vs.current && !m.result && serverNow() < m.endBy) begin(m);
  if (m && vs.current && m.id === vs.current.matchId) {
    if (m.opp) {
      vs.current.oppScore = m.oppDone ?? m.opp.score;
      txt($('game.left.versus.score'), formatNumber(vs.current.oppScore));
      if (m.oppDone === null) txt($('game.left.versus.combo'), m.opp.combo >= 3 ? `${m.opp.combo} combo` : '');
      const hp = Math.min(1, Math.max(0, m.opp.health / 100));
      const fill = $('game.left.versus.health.fill');
      fill.style.width = `${hp * 100}%`;
      fill.style.backgroundColor = hp > 0.5 ? T.green : hp > 0.25 ? T.gold : T.red;
    }
    if (m.result && !vs.current.result) {
      vs.current.result = m.result;
      if (S.screen === 'results' && vs.onResults) vsBanner();
      if (m.result.outcome === 'win') queueToast(`1V1 WIN vs ${vs.current.opponent}!`);
      else if (S.screen !== 'results' && !game.run) showToast(m.result.outcome === 'lose' ? `1v1: ${vs.current.opponent} won` : '1v1: draw');
      if (S.screen !== 'results' && !game.run) vs.current = null;
    }
  }
  if (isOpen('versus')) renderLobby(d.online);
}

async function tick() {
  vs.timer = undefined;
  let next = 4000;
  if (S.account && !S.accountsOffline && !vs.busy) {
    vs.busy = true;
    const sentAt = Date.now();
    const r = game.run;
    try {
      if (r?.opts?.versus && r.ready && !r.ended && vs.current) {
        // live score out, opponent's score back, in one request
        const res = await api.vsProgress(r.opts.versus.matchId, { score: Math.floor(r.score), combo: r.combo, health: r.health, accuracy: game.accuracyOf(r) });
        if (res.ok && res.data) apply(res.data, sentAt);
        const lead = Math.floor(r.score - vs.current.oppScore);
        const el = $('game.left.versus.lead');
        txt(el, lead >= 0 ? `+${formatNumber(lead)} AHEAD` : `${formatNumber(-lead)} BEHIND`);
        el.style.color = lead >= 0 ? T.green : T.red;
        next = 500;
      } else {
        const res = await api.vsPoll({ lobby: isOpen('versus'), match: vs.current && !vs.current.result ? vs.current.matchId : undefined });
        if (res.ok && res.data) apply(res.data, sentAt);
        else if (res.status === 401) signedOut();
        next = vs.current && !vs.current.result ? 1000 : isOpen('versus') || vs.incoming ? 2000 : 4000;
      }
    } finally {
      vs.busy = false;
    }
    if (document.hidden && !game.run) next = 10000;
  }
  vsSchedule(next);
}

/** poll again in `ms` (replaces any pending poll) */
export function vsSchedule(ms: number) {
  if (vs.timer) clearTimeout(vs.timer);
  vs.timer = window.setTimeout(() => void tick(), ms);
}

function bubble(i: number) {
  const b = $('game.left.versus.bubble');
  const text = REACTIONS[i - 1] ?? '';
  txt(b, text);
  b.style.opacity = '1';
  pop(b, 1.6, 0.25, ease.back);
  fade(b, 0, 0.3, 1.6);
  if (S.screen === 'results') showToast(`${vs.current?.opponent ?? 'Opponent'}: ${text}`);
}

export function vsReact(i: number) {
  const matchId = vs.current?.matchId;
  if (!matchId || performance.now() - vs.lastReact < 800) return;
  vs.lastReact = performance.now();
  void api.vsReact(matchId, i);
  txt($('game.left.versus.sent'), `you sent ${REACTIONS[i - 1]}`);
  if (S.screen === 'results') showToast(`You: ${REACTIONS[i - 1]}`);
}

export function vsFinal(r: Run, cleared: boolean) {
  const v = r.opts?.versus;
  if (!v) return;
  void api.vsFinal(v.matchId, Math.floor(r.score), cleared).then(res => {
    if (res.ok && res.data) apply({ now: serverNow(), match: res.data.match, events: [], incoming: null }, Date.now());
  });
  vsSchedule(1000);
}

export function vsAskForfeit() {
  const v = game.run?.opts?.versus;
  if (!v || !window.confirm(`Leave the 1v1 against ${v.opponent}? It counts as a loss.`)) return;
  void api.vsForfeit(v.matchId);
  vs.current = null;
  quitToSongs();
}

export function vsOnResults(on: boolean) { vs.onResults = on; }

export function vsBanner() {
  const label = $('results.panel.versus');
  const c = vs.current;
  if (!c || !vs.onResults) return html(label, '');
  const res = c.result;
  if (!res) return html(label, `<span style="color:${T.muted};font-size:15px">WAITING FOR ${escapeHtml(c.opponent.toUpperCase())}...</span>`);
  const head = res.outcome === 'win' ? `<span style="color:${T.green}">YOU WIN!</span>` : res.outcome === 'lose' ? `<span style="color:${T.red}">YOU LOSE</span>` : 'DRAW';
  const why = res.reason === 'forfeit' && res.outcome === 'win' ? '  (opponent left)' : res.reason === 'timeout' ? '  (timed out)' : '';
  html(label, `${head}<br><span style="color:${T.muted};font-size:13px;font-weight:600">${formatNumber(res.you)} vs ${formatNumber(res.them)}  ·  ${escapeHtml(c.opponent)}${why}</span>`);
}

/** leaving the results screen: a settled battle is done; an unsettled one keeps polling and toasts the result */
export function vsLeaveResults() {
  vs.onResults = false;
  if (vs.current?.result) vs.current = null;
}

export function vsReset() {
  vs.current = null;
  vs.incoming = null;
  showPopup();
}

function openLobby() {
  $('versus.status').dataset.sticky = '';
  txt($('versus.status'), S.account ? 'Looking for players...' : '');
  $('versus.list').replaceChildren();
  renderLobby();
  openModal($('versus'));
  vsSchedule(0);
}

export function initVersus() {
  onClick('home.versus', openLobby);
  onClick('versus.close', closeModal);
  onClick('versus.login', () => openAuth('login'));
  onClick('challenge.accept', () => void respond(true));
  onClick('challenge.decline', () => void respond(false));
  // pop-up countdown
  setInterval(() => {
    const inc = vs.incoming;
    if (!inc) return;
    const left = Math.ceil((inc.expiresAt - Date.now()) / 1000);
    if (left <= 0) { vs.incoming = null; showPopup(); return; }
    txt($('challenge.timer'), `${left}s`);
  }, 250);
}
