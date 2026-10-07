// Leaderboard panel: top 10 for a chart (or this week's challenge) plus your own best and rank.
import { api, type Board } from '../api.ts';
import { MODES, T } from '../config.ts';
import { formatNumber } from '../scoring.ts';
import type { Diff, Track } from '../types.ts';
import { $, show, txt } from '../ui.ts';
import { closeModal, onClick, openModal } from './shell.ts';
import { S, bestKey } from './state.ts';

let request = 0;

function render(board: Board | null, localBest: number | undefined, error?: string) {
  const entries = board?.entries ?? [];
  for (let i = 1; i <= 10; i++) {
    const row = $(`board.list.row${i}`);
    const e = entries[i - 1];
    show(row, !!e);
    if (!e) continue;
    const me = S.account && e.name.toLowerCase() === S.account.username.toLowerCase();
    txt($(`board.list.row${i}.player`), e.title ? `${e.name}  ·  ${e.title}` : e.name);
    txt($(`board.list.row${i}.score`), formatNumber(e.score));
    row.style.boxShadow = me ? `0 0 0 1px ${T.cyan}` : 'none';
  }
  const status = $('board.status');
  txt(status, error ?? (entries.length ? '' : 'No scores yet. Be the first!'));
  show(status, !!error || !entries.length);
  const mine = board?.mine;
  txt($('board.me.label'), mine ? `YOUR BEST  ·  #${mine.rank}` : 'YOUR BEST');
  txt($('board.me.score'), mine ? formatNumber(mine.score) : localBest !== undefined ? formatNumber(localBest) : '-');
}

async function load(title: string, sub: string, fetchBoard: () => ReturnType<typeof api.board>, localBest?: number) {
  txt($('board.title'), title);
  txt($('board.sub'), sub);
  for (let i = 1; i <= 10; i++) show($(`board.list.row${i}`), false);
  openModal($('board'));
  if (S.accountsOffline) return render(null, localBest, 'Online leaderboards need the server, which isn\'t set up here.');
  txt($('board.status'), 'Loading...');
  show($('board.status'), true);
  const my = ++request;
  const res = await fetchBoard();
  if (my !== request) return;
  if (!res.ok || !res.data) return render(null, localBest, res.error ?? "Couldn't load the leaderboard.");
  render(res.data, localBest, S.account ? undefined : res.data.entries.length ? undefined : 'No scores yet. Log in and be the first!');
  if (!S.account && res.data.entries.length) {
    txt($('board.status'), 'Log in to put your scores on the board.');
    show($('board.status'), true);
  }
}

export function openBoard(t: Track, diff: Diff) {
  void load('Leaderboard', `${t.title}  ·  ${MODES[diff].label}`, () => api.board(t.id, diff), S.data.bests[bestKey(t, diff)]?.score);
}

export function openWeeklyBoard(songTitle: string, week: number) {
  void load('King of the Hill', `Weekly challenge  ·  ${songTitle}`, () => api.weeklyBoard(), S.data.profile.weekly[String(week)]);
}

export function initBoard() {
  onClick('board.close', closeModal);
}
