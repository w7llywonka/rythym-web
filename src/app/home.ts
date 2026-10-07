// Home: player chip, weekly challenge (King of the Hill), live feed of big plays, how-to.
import { api, type FeedItem } from '../api.ts';
import { MODES, T } from '../config.ts';
import { formatNumber, keyName, levelFromXp } from '../scoring.ts';
import type { PlaySet, Track } from '../types.ts';
import { $, html, show, txt } from '../ui.ts';
import { currentWeek, pickWeekly, type WeeklyMods } from '../weekly.ts';
import { openWeeklyBoard } from './board.ts';
import { openSettings } from './settingsPanel.ts';
import { startRun } from './play.ts';
import { playPreview } from './preview.ts';
import { setTab } from './select.ts';
import { escapeHtml, go, onClick } from './shell.ts';
import { S, settings } from './state.ts';

export let weekly: { week: number; ends: number; track: Track; mods: WeeklyMods } | null = null;

export function refreshHome() {
  const [c1, c2] = settings().laneColors;
  const key = (i: number) => escapeHtml(keyName(settings().keys[i]));
  html($('home.howto'), `Press <b style="color:${c1}">${key(0)}</b> and <b style="color:${c2}">${key(1)}</b> (or tap the buttons) when the lines reach them`);
  const p = S.data.profile;
  const { level, rest, need } = levelFromXp(p.xp);
  txt($('home.chip.name'), S.account ? S.account.username : 'Guest');
  txt($('home.chip.level'), `LV ${level}`);
  $('home.chip.xp.fill').style.width = `${Math.min(1, rest / need) * 100}%`;
  const streak = p.streak > 0 ? `STREAK ${p.streak} DAY${p.streak === 1 ? '' : 'S'}` : 'Play today to start a streak';
  txt($('home.chip.streak'), streak + (p.title ? `  ·  ${p.title.toUpperCase()}` : ''));
}

// ---- weekly challenge ----------------------------------------------------------------------
function weeklySet(mods: WeeklyMods): PlaySet {
  return {
    style: mods.style, rate: mods.rate, hidden: !!mods.hidden, sudden: false, flashlight: !!mods.flashlight,
    mirror: !!mods.mirror, random: false, wave: false, mines: false, auto: false,
  };
}

export function refreshWeekly() {
  const { week, ends } = currentWeek();
  const pick = pickWeekly(week, S.tracks.filter(t => !t.custom));
  show($('home.weekly'), !!pick);
  if (!pick) return;
  weekly = { week, ends, track: pick.song, mods: pick.mods };
  txt($('home.weekly.song'), pick.song.title);
  txt($('home.weekly.mods'), `${MODES[pick.song.difficulty].label}  ·  ${pick.mods.label}`);
  const left = Math.max(0, ends - Date.now() / 1000);
  txt($('home.weekly.ends'), `ends in ${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`);
  const local = S.data.profile.weekly[String(week)];
  if (S.accountsOffline) {
    txt($('home.weekly.king'), 'Offline right now');
    txt($('home.weekly.mine'), local ? `Your best: ${formatNumber(local)}` : '');
    return;
  }
  void api.weeklyBoard().then(res => {
    if (!res.ok || !res.data) return txt($('home.weekly.king'), "Couldn't load the board");
    const [king] = res.data.entries;
    txt($('home.weekly.king'), king ? `${king.name}  ·  ${formatNumber(king.score)}` : 'Nobody yet. Claim it!');
    const mine = res.data.mine;
    txt($('home.weekly.mine'), mine ? `Your best: ${formatNumber(mine.score)}  ·  #${mine.rank}` : local ? `Your best: ${formatNumber(local)}` : '');
  });
}

// ---- live feed -----------------------------------------------------------------------------
const localFeed: string[] = [];
const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
function feedLine(i: FeedItem) {
  const who = `<b>${escapeHtml(i.user)}</b>`, what = `${escapeHtml(i.song)} <span style="color:${T.muted}">[${escapeHtml(i.diff)}]</span>`;
  const text = i.kind === 'top' ? `${who} took <b style="color:${T.gold}">#1</b> on ${what}`
    : i.kind === 'king' ? `${who} is the new <b style="color:${T.gold}">King of the Hill</b>!`
      : i.kind === 'ss' ? `${who} got an <b style="color:${T.gold}">SS</b> on ${what}`
        : i.kind === 'fc' ? `${who} full-comboed ${what}`
          : `${who} cleared ${what}!`;
  return `${text} <span style="color:${T.dim}">${ago(i.at)}</span>`;
}

function renderFeed(lines: string[]) {
  for (let i = 1; i <= 6; i++) {
    const el = $(`home.feed.line${i}`);
    const text = lines[i - 1];
    html(el, text ?? (i === 1 ? 'Waiting for big plays...' : ''));
    el.style.color = text ? T.text : T.muted;
  }
}

export async function refreshFeed() {
  if (S.accountsOffline) return renderFeed(localFeed);
  const res = await api.feed();
  if (res.ok && res.data) renderFeed(res.data.items.map(feedLine));
}

/** without the server, the feed shows this browser's own big plays */
export function pushLocalFeed(markup: string) {
  localFeed.unshift(markup);
  localFeed.length = Math.min(localFeed.length, 6);
  if (S.accountsOffline) renderFeed(localFeed);
}

export function initHome() {
  onClick('home.play', () => {
    if (S.transitioning) return;
    void go('select', () => setTab(S.tab, true));
    if (S.previewTrack !== S.selectedSong[S.tab]) void playPreview(S.selectedSong[S.tab]);
  });
  onClick('home.settings', openSettings);
  onClick('home.weekly.board', () => { if (weekly) openWeeklyBoard(weekly.track.title, weekly.week); });
  onClick('home.weekly.play', () => {
    if (weekly) void startRun(weekly.track, weekly.track.difficulty, false, { set: weeklySet(weekly.mods), weekly: weekly.week });
  });
  renderFeed([]);
  refreshWeekly();
  void refreshFeed();
  // the board and feed refresh while the home screen is up
  setInterval(() => {
    if (document.hidden || S.screen !== 'home') return;
    refreshWeekly();
    void refreshFeed();
  }, 20_000);
}
