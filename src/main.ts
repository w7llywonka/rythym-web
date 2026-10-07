// LINE RUSH (web) - controller. Screens: Home -> Select -> Game -> Results, plus Pause / Settings / Style /
// Calibrate / Leaderboard / Profile / 1v1 / Account modals. Mirrors the Roblox client controller.
import './style.css';
import { api, validatePassword, validateUsername, type User } from './account.ts';
import { ease, fade, pop, tween } from './anim.ts';
import { AudioEngine } from './audio.ts';
import {
  ACHIEVEMENTS, BLOCKED_KEYS, DEFAULT_KEYS, DEFAULT_SETTINGS, DIFF_XP, HIT_SOUNDS, K, KEY_LABELS, MOD_INFO, MOD_ORDER, MODES,
  PACKS, RANK, RATES, STAR_COLORS, STYLE_ORDER, STYLES, T, TAB_INFO, TAB_ORDER, type Pack, type Tab,
} from './config.ts';
import { importSong } from './custom.ts';
import { Game, type Run, type RunOpts } from './game.ts';
import { currentSet, fmtTime, formatNumber, gradeColor, gradeFor, keyName, levelFromXp, rateText, setMultiplier, setSummary } from './scoring.ts';
import { load as loadLocal, sanitize, save as saveLocal } from './storage.ts';
import { soundtrack, trackFromImport } from './tracks.ts';
import type { Diff, Lane, PlaySet, SaveData, Track } from './types.ts';
import { $, buildUI, fitStage, html, rgba, show, txt } from './ui.ts';
import { currentWeek, pickWeekly, type WeeklyMods } from './weekly.ts';

const app = document.getElementById('app')!;
buildUI(app);
fitStage();
window.addEventListener('resize', fitStage);

const audio = new AudioEngine();
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
let data: SaveData = loadLocal();
let account: User | null = null;
let accountsOffline = false;
let autoplay = false; // session only, never saved
const practice: { from: number; to: number | null } = { from: 0, to: null };
let tracks: Track[] = soundtrack();
const byId = () => new Map(tracks.map(t => [t.id, t]));
let tracksById = byId();
const packOf = new Map<string, Pack>();
for (const pack of PACKS) for (const id of pack.songs) packOf.set(id, pack);

type Screen = 'home' | 'select' | 'game' | 'results';
let currentScreen: Screen = 'home';
let transitioning = false;
let modal: HTMLElement | null = null;
let currentTab: Tab = 'Easy';
const selectedSong: Partial<Record<Tab, Track>> = {};
const selectedChart = new Map<Track, Diff>();
let previewTrack: Track | null = null;
const feedLines: string[] = [];
let weekly: { week: number; ends: number; track: Track; mods: WeeklyMods } | null = null;
let lastSong: Track | null = null, lastChart: Diff | null = null, lastOpts: RunOpts | undefined;
let listeningKey: number | null = null;

const settings = () => data.settings;

// ---------------------------------------------------------------------------------------------
// Saving (guest -> localStorage, logged in -> your account on the server)
// ---------------------------------------------------------------------------------------------
let saveTimer: number | undefined;
let syncState = '';
function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    saveTimer = undefined;
    if (account) {
      const res = await api.putSave(data);
      syncState = res.ok ? 'Progress saved to your account' : `Couldn't sync: ${res.error}`;
      if (res.status === 401) handleSignedOut();
    } else {
      saveLocal(data);
    }
  }, 1200);
}
window.addEventListener('pagehide', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    if (account) void fetch('/api/save', { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'X-LineRush': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }).catch(() => {});
    else saveLocal(data);
  }
});

// ---------------------------------------------------------------------------------------------
// Screens, modals, toasts
// ---------------------------------------------------------------------------------------------
function showScreen(name: Screen) {
  for (const s of ['home', 'select', 'game', 'results'] as Screen[]) show($(s), s === name);
  currentScreen = name;
}

// fade to black, swap screens, fade back in
function go(name: Screen, setup?: () => void): Promise<void> {
  transitioning = true;
  const fader = $('fader');
  fader.style.opacity = '1';
  return new Promise(resolve => setTimeout(() => {
    showScreen(name);
    setup?.();
    fader.style.transition = 'opacity .3s';
    fader.style.opacity = '0';
    setTimeout(() => { fader.style.transition = ''; }, 320);
    transitioning = false;
    resolve();
  }, 160));
}

function openModal(panel: HTMLElement) {
  if (modal === panel) return;
  if (modal) show(modal, false);
  modal = panel;
  const dim = $('dimmer');
  show(dim, true);
  requestAnimationFrame(() => dim.classList.add('on'));
  show(panel, true);
  pop(panel, 0.92, 0.25, ease.back);
}

function closeModal() {
  if (!modal) return;
  show(modal, false);
  modal = null;
  const dim = $('dimmer');
  dim.classList.remove('on');
  setTimeout(() => { if (!modal) show(dim, false); }, 160);
}

const toastQueue: string[] = [];
let toastToken = 0;
function showToast(text: string) {
  const t = $('toast');
  const my = ++toastToken;
  txt(t, text);
  show(t, true);
  t.style.opacity = '1';
  setTimeout(() => {
    if (my !== toastToken) return;
    fade(t, 0, 0.3, 0, ease.quad, () => {
      if (my !== toastToken) return;
      show(t, false);
      const next = toastQueue.shift();
      if (next) showToast(next);
    });
  }, 2200);
}
// toasts that shouldn't overwrite each other (achievements, level ups)
function queueToast(text: string) {
  if (!$('toast').hidden) toastQueue.push(text); else showToast(text);
}

function setToggle(toggle: HTMLElement, on: boolean) {
  toggle.style.backgroundColor = on ? T.cyan : T.bg3;
  const knob = toggle.querySelector('.knob') as HTMLElement;
  knob.style.left = on ? `${toggle.offsetWidth - knob.offsetWidth - 3}px` : '3px';
  knob.style.backgroundColor = on ? T.bg0 : T.text;
}

function onClick(path: string, fn: (e: MouseEvent) => void) {
  $(path).addEventListener('click', e => { void audio.unlock(); fn(e); });
}

// ---------------------------------------------------------------------------------------------
// Audio: menu previews
// ---------------------------------------------------------------------------------------------
async function playPreview(track: Track | null | undefined) {
  if (!track) return;
  previewTrack = track;
  html($('home.nowplaying'), `NOW PLAYING &nbsp; <b>${escapeHtml(track.title)}</b> &nbsp;·&nbsp; ${escapeHtml(track.artist)}`);
  const my = ++audio.token;
  if (audio.playing) {
    audio.fade(0, 0.2);
    await new Promise(r => setTimeout(r, 200));
  }
  if (my !== audio.token || audio.ctx?.state !== 'running') return;
  let buffer: AudioBuffer;
  try { buffer = await audio.load(track.song); } catch { return; }
  if (my !== audio.token || game.run) return;
  const start = Math.min(track.previewStart, Math.max(0, buffer.duration - 5));
  const end = Math.min(buffer.duration, start + K.PREVIEW_LENGTH);
  audio.start(buffer, audio.now, start, 1, 0, { start, end });
  audio.fade(0.85, 1.2);
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------
function refreshHome() {
  html($('home.howto'), `Press <b class="c-cyan">${escapeHtml(keyName(settings().keys[0]))}</b> and <b class="c-pink">${escapeHtml(keyName(settings().keys[1]))}</b> (or tap the buttons) when the lines reach them`);
  const p = data.profile;
  const { level, rest, need } = levelFromXp(p.xp);
  txt($('home.chip.name'), account ? account.username : 'Guest');
  txt($('home.chip.level'), `LV ${level}`);
  $('home.chip.xp.fill').style.width = `${Math.min(1, rest / need) * 100}%`;
  const streak = p.streak > 0 ? `STREAK ${p.streak} DAY${p.streak === 1 ? '' : 'S'}` : 'Play today to start a streak';
  txt($('home.chip.streak'), streak + (p.title ? `  ·  ${p.title.toUpperCase()}` : ''));
}

function renderFeed() {
  for (let i = 1; i <= 6; i++) {
    const line = $(`home.feed.line${i}`);
    const text = feedLines[i - 1];
    if (i === 1 && !text) {
      html(line, 'Waiting for big plays...');
      line.style.color = T.muted;
    } else {
      html(line, text ?? '');
      line.style.color = T.text;
    }
  }
}
function pushFeed(markup: string) {
  feedLines.unshift(markup);
  feedLines.length = Math.min(feedLines.length, 6);
  renderFeed();
}

function refreshWeekly() {
  const { week, ends } = currentWeek();
  const pick = pickWeekly(week, tracks.filter(t => !t.custom));
  const w = $('home.weekly');
  if (!pick) { show(w, false); return; }
  weekly = { week, ends, track: pick.song, mods: pick.mods };
  txt($('home.weekly.song'), pick.song.title);
  txt($('home.weekly.mods'), `${MODES[pick.song.difficulty].label}  ·  ${pick.mods.label}`);
  const left = Math.max(0, ends - Date.now() / 1000);
  txt($('home.weekly.ends'), `ends in ${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`);
  txt($('home.weekly.king'), 'Offline right now');
  const mine = data.profile.weekly[String(week)];
  txt($('home.weekly.mine'), mine ? `Your best: ${formatNumber(mine)}` : '');
}

function weeklySet(mods: WeeklyMods): PlaySet {
  return {
    style: mods.style, rate: mods.rate, hidden: !!mods.hidden, sudden: false, flashlight: !!mods.flashlight,
    mirror: !!mods.mirror, random: false, wave: false, mines: false, auto: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Song select
// ---------------------------------------------------------------------------------------------
function songsFor(tab: Tab): Track[] {
  if (tab === 'Recent') {
    const out: Track[] = [];
    for (const e of data.recent) {
      const t = tracksById.get(e.id);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }
  return tracks.filter(t => t.difficulty === tab).sort((a, b) => a.level - b.level || a.displayBpm - b.displayBpm);
}

const bestKey = (t: Track, diff: Diff) => (diff === t.difficulty ? t.id : `${t.id}+`);
const songCleared = (id: string) => data.bests[id] !== undefined || data.bests[`${id}+`] !== undefined;
function packProgress(pack: Pack) {
  let cleared = 0, total = 0;
  for (const id of pack.songs) {
    if (!tracksById.has(id)) continue;
    total++;
    if (songCleared(id)) cleared++;
  }
  return { cleared, total };
}

function chartFor(t: Track) {
  const diff = selectedChart.get(t) ?? t.difficulty;
  return t.charts[diff] ?? t.charts[t.difficulty]!;
}

// mastery: clear / A or better / S or better / full combo (own chart)
function starFlags(t: Track) {
  const b = data.bests[t.id];
  if (!b) return [false, false, false, false];
  const g = b.grade;
  return [true, g === 'A' || g === 'S' || g === 'SS', g === 'S' || g === 'SS', b.fc];
}

let cards = new Map<Track, HTMLElement>();

function styleCards() {
  for (const [t, card] of cards) {
    const sel = selectedSong[currentTab] === t;
    show(card.querySelector('.accent') as HTMLElement, sel);
    (card.querySelector('.accent') as HTMLElement).style.backgroundColor = t.color1;
    card.style.boxShadow = `0 0 0 1px ${sel ? rgba(t.color1, 0.45) : T.line}`;
    card.style.backgroundColor = sel ? T.bg2 : T.bg1;
  }
}

function buildCard(t: Track): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'f card';
  card.style.backgroundColor = T.bg1;
  card.style.borderRadius = '14px';
  const b = data.bests[t.id];
  const diff = selectedChart.get(t) ?? t.difficulty;
  const levelText = currentTab === 'Recent' && t.charts[diff] ? `${MODES[diff].label}  LV ${t.charts[diff]!.level}` : `LV ${t.level}`;
  const flags = starFlags(t);
  card.innerHTML = `
    <div class="f accent" style="left:0;top:22px;width:3px;height:32px;border-radius:2px"></div>
    <div class="f" style="left:12px;top:10px;width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg, ${t.color1}, ${t.color2})">
      <div class="f t a-center v-center" style="left:0;top:11px;width:56px;height:22px;font-size:19px;font-weight:700;letter-spacing:-0.02em"><span class="tx"></span></div>
      <div class="f t a-center v-center" style="left:0;top:33px;width:56px;height:12px;font-size:9px;font-weight:600;letter-spacing:0.1em;color:rgba(255,255,255,.75)"><span class="tx">BPM</span></div>
    </div>
    <div class="f t trunc title" style="left:84px;top:15px;width:320px;height:24px;font-size:17px;font-weight:600;letter-spacing:-0.01em"><span class="tx"></span></div>
    <div class="f t trunc sub" style="left:84px;top:41px;width:320px;height:18px;font-size:12.5px;font-weight:500;color:${T.muted}"><span class="tx"></span></div>
    <div class="f t a-right level" style="right:18px;top:16px;width:180px;height:18px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:${T.muted}"><span class="tx"></span></div>
    <div class="f t a-right grade" style="right:18px;top:36px;width:60px;height:26px;font-size:20px;font-weight:700"><span class="tx"></span></div>
    <div class="f stars" style="right:86px;top:46px;width:50px;height:6px">${[0, 1, 2, 3].map(i => `<div class="f" style="left:${i * 12}px;top:0;width:6px;height:6px;border-radius:50%;background:${flags[i] ? STAR_COLORS[i] : T.bg3}"></div>`).join('')}</div>`;
  const tx = (sel: string) => card.querySelector(`${sel} .tx`) as HTMLElement;
  (card.children[1].children[0].querySelector('.tx') as HTMLElement).textContent = String(t.displayBpm);
  tx('.title').textContent = t.title;
  tx('.sub').textContent = `${t.artist}  ·  ${t.genre}  ·  ${fmtTime(t.displayLength)}`;
  tx('.level').textContent = levelText;
  tx('.grade').textContent = b ? b.grade : '-';
  (card.querySelector('.grade') as HTMLElement).style.color = b ? gradeColor(b.grade, T) : T.dim;
  card.addEventListener('mouseenter', () => { if (selectedSong[currentTab] !== t) card.style.backgroundColor = T.bg2; });
  card.addEventListener('mouseleave', styleCards);
  card.addEventListener('click', () => { void audio.unlock(); selectSong(t); });
  return card;
}

function refreshStyleButton() {
  const set = currentSet(settings(), autoplay);
  const { mult, unranked } = setMultiplier(set);
  txt($('select.detail.style.value'), setSummary(set));
  txt($('select.detail.style.mult'), `${unranked ? 'NO SAVE' : `x${mult.toFixed(2)}`}  >`);
  $('select.detail.style.mult').style.color = unranked ? T.red : T.gold;
}

function updateDetail() {
  const t = selectedSong[currentTab];
  if (!t) return;
  const chart = chartFor(t);
  const mode = MODES[chart.diff];
  $('select.detail.cover').style.backgroundImage = `linear-gradient(120deg, ${t.color1}, ${t.color2})`;
  txt($('select.detail.cover.genre'), t.genre.toUpperCase());
  txt($('select.detail.cover.bpm'), String(t.displayBpm));
  txt($('select.detail.cover.pill.text'), mode.label);
  txt($('select.detail.title'), t.title);
  txt($('select.detail.artist'), t.artist);
  const pack = packOf.get(t.id);
  if (pack) {
    const { cleared, total } = packProgress(pack);
    txt($('select.detail.pack'), cleared >= total ? `${pack.name}  ·  COMPLETE` : `${pack.name}  ·  ${cleared}/${total} CLEARED`);
    $('select.detail.pack').style.color = cleared >= total ? T.gold : T.muted;
  } else {
    txt($('select.detail.pack'), t.custom ? 'YOUR IMPORT' : '');
  }
  txt($('select.detail.stats.bpm.value'), String(t.displayBpm));
  txt($('select.detail.stats.length.value'), fmtTime(t.displayLength));
  txt($('select.detail.stats.notes.value'), String(chart.notes.length));
  txt($('select.detail.stats.level.value'), String(chart.level));

  // chart picker: the song's own tier, or one step harder
  (['base', 'plus'] as const).forEach((name, i) => {
    const diff = t.chartList[i];
    const btn = $(`select.detail.chartrow.${name}`);
    const available = diff !== undefined && t.charts[diff] !== undefined;
    show(btn, available);
    if (!available) return;
    const m = MODES[diff];
    const sel = chart.diff === diff;
    txt(btn, `${m.label}${i === 1 ? ' +' : ''}   LV ${t.charts[diff]!.level}`);
    btn.style.backgroundColor = sel ? rgba(m.color, 0.86) : T.bg1;
    btn.style.color = sel ? m.color : T.muted;
    btn.style.boxShadow = `0 0 0 1px ${sel ? rgba(m.color, 0.5) : T.line}`;
  });

  const b = data.bests[bestKey(t, chart.diff)];
  if (b) {
    txt($('select.detail.best.score'), formatNumber(b.score));
    txt($('select.detail.best.info'), `${b.accuracy.toFixed(2)}%  ·  ${b.combo} max combo`);
    txt($('select.detail.best.grade'), b.grade);
    $('select.detail.best.grade').style.color = gradeColor(b.grade, T);
    show($('select.detail.best.fc'), b.fc);
  } else {
    txt($('select.detail.best.score'), '-');
    txt($('select.detail.best.info'), 'No clears yet. Go set a score!');
    txt($('select.detail.best.grade'), '-');
    $('select.detail.best.grade').style.color = T.dim;
    show($('select.detail.best.fc'), false);
  }
  refreshStyleButton();
}

function selectSong(t: Track) {
  selectedSong[currentTab] = t;
  practice.from = 0;
  practice.to = null;
  styleCards();
  updateDetail();
  if (previewTrack !== t) void playPreview(t);
}

function buildList() {
  const list = $('select.list');
  list.innerHTML = '';
  const holder = document.createElement('div');
  holder.className = 'cards';
  list.appendChild(holder);
  cards = new Map();
  if (currentTab === 'Recent') {
    for (let i = data.recent.length - 1; i >= 0; i--) {
      const t = tracksById.get(data.recent[i].id);
      if (t && t.charts[data.recent[i].chart]) selectedChart.set(t, data.recent[i].chart);
    }
  }
  const songs = songsFor(currentTab);
  if (!songs.includes(selectedSong[currentTab]!)) selectedSong[currentTab] = songs[0];
  const has = selectedSong[currentTab] !== undefined;
  show($('select.detail'), has);
  show($('select.empty'), !has);
  txt($('select.empty'), currentTab === 'Recent'
    ? 'Nothing here yet. Songs you play will show up here.'
    : `No ${currentTab} songs yet. Play a ${currentTab === 'Expert' ? 'Hard' : 'Expert'} song's "+" chart, or press + IMPORT to add your own track.`);
  for (const t of songs) {
    const card = buildCard(t);
    holder.appendChild(card);
    cards.set(t, card);
  }
  styleCards();
  updateDetail();
}

function setTab(tab: Tab, instant = false) {
  currentTab = tab;
  const info = TAB_INFO[tab];
  const index = TAB_ORDER.indexOf(tab);
  const hl = $('select.tabs.highlight');
  if (instant) hl.style.transition = 'none';
  hl.style.left = `${6 + index * K.TAB_WIDTH}px`;
  hl.style.backgroundColor = rgba(info.color, 0.86);
  hl.style.boxShadow = `0 0 0 1px ${rgba(info.color, 0.6)}`;
  if (instant) requestAnimationFrame(() => { hl.style.transition = ''; });
  for (const name of TAB_ORDER) $(`select.tabs.${name.toLowerCase()}`).style.color = tab === name ? info.color : T.muted;
  txt($('select.hint'), info.hint);
  buildList();
  $('select.list').scrollTop = 0;
  const t = selectedSong[tab];
  if (t && previewTrack !== t && currentScreen === 'select') void playPreview(t);
}

function moveSelection(dir: number) {
  const list = songsFor(currentTab);
  if (!list.length) return;
  const idx = Math.max(0, list.indexOf(selectedSong[currentTab]!));
  selectSong(list[Math.min(list.length - 1, Math.max(0, idx + dir))]);
}

(['base', 'plus'] as const).forEach((name, i) => onClick(`select.detail.chartrow.${name}`, () => {
  const t = selectedSong[currentTab];
  if (t && t.chartList[i] && t.charts[t.chartList[i]]) {
    selectedChart.set(t, t.chartList[i]);
    practice.from = 0;
    practice.to = null;
    updateDetail();
  }
}));

// ---------------------------------------------------------------------------------------------
// Style modal
// ---------------------------------------------------------------------------------------------
function selectedChartLength() {
  const t = selectedSong[currentTab];
  return t ? chartFor(t).endTime - (t.chartStart ?? 0) : 60;
}

function refreshStylePanel() {
  for (const name of STYLE_ORDER) {
    const card = $(`style.styles.${name.toLowerCase()}`);
    const st = STYLES[name];
    const sel = settings().style === name;
    card.style.backgroundColor = sel ? T.bg2 : T.bg1;
    card.style.boxShadow = `0 0 0 1px ${sel ? rgba(T.text, 0.5) : T.line}`;
    txt($(`style.styles.${name.toLowerCase()}.mult`), st.unranked ? 'NO SAVE' : `x${st.mult.toFixed(2)}`);
    $(`style.styles.${name.toLowerCase()}.mult`).style.color = st.unranked ? T.red : T.gold;
  }
  txt($('style.speed.value'), rateText(settings().rate));
  // practice section (only used by the Practice style)
  const length = selectedChartLength();
  const to = Math.min(practice.to ?? length, length);
  practice.from = Math.min(Math.max(practice.from, 0), Math.max(0, to - 5));
  txt($('style.practice.fromvalue'), `from ${fmtTime(practice.from)}`);
  txt($('style.practice.tovalue'), `to ${fmtTime(to)}`);
  const on = settings().style === 'Practice';
  $('style.practice').style.opacity = on ? '1' : '0.55';
  for (const name of MOD_ORDER) {
    const key = MOD_INFO[name].key;
    setToggle($(`style.mods.${name.toLowerCase()}.toggle`), key === 'auto' ? autoplay : settings()[key]);
  }
  const { mult, unranked } = setMultiplier(currentSet(settings(), autoplay));
  txt($('style.footer.value'), `x${mult.toFixed(2)}`);
  txt($('style.footer.note'), unranked ? "Scores won't be saved" : '');
  refreshStyleButton();
}

for (const name of STYLE_ORDER) onClick(`style.styles.${name.toLowerCase()}`, () => { settings().style = name; refreshStylePanel(); });
const shiftRate = (dir: number) => {
  const i = RATES.indexOf(settings().rate);
  settings().rate = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
  refreshStylePanel();
};
onClick('style.speed.minus', () => shiftRate(-1));
onClick('style.speed.plus', () => shiftRate(1));
function shiftPractice(field: 'from' | 'to', dir: number) {
  const length = selectedChartLength();
  const to = practice.to ?? length;
  if (field === 'from') practice.from = Math.min(Math.max(practice.from + dir * 5, 0), Math.max(0, to - 5));
  else practice.to = Math.min(Math.max(to + dir * 5, practice.from + 5), length);
  if (settings().style !== 'Practice') settings().style = 'Practice';
  refreshStylePanel();
}
onClick('style.practice.fromminus', () => shiftPractice('from', -1));
onClick('style.practice.fromplus', () => shiftPractice('from', 1));
onClick('style.practice.tominus', () => shiftPractice('to', -1));
onClick('style.practice.toplus', () => shiftPractice('to', 1));
for (const name of MOD_ORDER) {
  const key = MOD_INFO[name].key;
  onClick(`style.mods.${name.toLowerCase()}.toggle`, () => {
    if (key === 'auto') autoplay = !autoplay; else settings()[key] = !settings()[key];
    refreshStylePanel();
  });
}
const closeStyle = () => { closeModal(); refreshStyleButton(); queueSave(); };
onClick('style.close', closeStyle);
onClick('style.footer.done', closeStyle);
onClick('select.detail.style', () => { openModal($('style')); refreshStylePanel(); });

// ---------------------------------------------------------------------------------------------
// Leaderboard (online boards aren't available on the web yet; shows your local best)
// ---------------------------------------------------------------------------------------------
function openBoard(t: Track, diff: Diff) {
  txt($('board.title'), 'LEADERBOARD');
  txt($('board.sub'), `${t.title}  ·  ${MODES[diff].label}`);
  for (let i = 1; i <= 10; i++) show($(`board.list.row${i}`), false);
  txt($('board.status'), 'Online leaderboards are offline right now. Your personal best is shown below.');
  const b = data.bests[bestKey(t, diff)];
  txt($('board.me.score'), b ? formatNumber(b.score) : '-');
  openModal($('board'));
}
onClick('board.close', closeModal);
onClick('select.detail.best.top', () => {
  const t = selectedSong[currentTab];
  if (t) openBoard(t, chartFor(t).diff);
});

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------
function refreshProfile() {
  const p = data.profile;
  txt($('profile.stats.level.value'), String(levelFromXp(p.xp).level));
  txt($('profile.stats.plays.value'), formatNumber(p.plays));
  txt($('profile.stats.noteshit.value'), formatNumber(p.notesHit));
  txt($('profile.stats.fullcombos.value'), formatNumber(p.fcs));
  txt($('profile.stats.ssranks.value'), formatNumber(p.ss));
  txt($('profile.stats.playtime.value'), `${Math.floor(p.playSeconds / 3600)}h ${Math.floor((p.playSeconds % 3600) / 60)}m`);
  txt($('profile.ptitle'), p.title ? p.title.toUpperCase() : '');
  txt($('profile.account'), account ? 'ACCOUNT' : 'LOG IN');
  ACHIEVEMENTS.forEach((a, i) => {
    const tile = $(`profile.achievements.ach${i + 1}`);
    const unlocked = p.achievements[a.id] === true;
    const wearing = unlocked && p.title === a.title;
    txt($(`profile.achievements.ach${i + 1}.name`), a.name);
    txt($(`profile.achievements.ach${i + 1}.desc`), `${a.desc}\nTitle: ${a.title}`);
    txt($(`profile.achievements.ach${i + 1}.state`), wearing ? 'WEARING' : unlocked ? 'UNLOCKED' : 'LOCKED');
    $(`profile.achievements.ach${i + 1}.state`).style.color = wearing ? T.gold : unlocked ? T.green : T.dim;
    $(`profile.achievements.ach${i + 1}.name`).style.color = unlocked ? T.text : T.dim;
    tile.style.backgroundColor = unlocked ? T.bg2 : T.bg1;
    tile.style.boxShadow = `0 0 0 1px ${wearing ? rgba(T.gold, 0.6) : T.line}`;
    tile.style.opacity = unlocked ? '1' : '0.6';
  });
}
ACHIEVEMENTS.forEach((a, i) => onClick(`profile.achievements.ach${i + 1}`, () => {
  if (!data.profile.achievements[a.id]) return;
  data.profile.title = data.profile.title === a.title ? '' : a.title;
  refreshProfile();
  refreshHome();
  queueSave();
}));
onClick('profile.close', closeModal);
onClick('home.profile', () => { refreshProfile(); openModal($('profile')); });
onClick('profile.account', () => {
  if (account) openAccount();
  else if (accountsOffline) showToast("Accounts aren't available on this server. Your progress is saved in this browser.");
  else openAuth();
});

// 1v1 lobby (needs the online server, which the web version doesn't have yet)
onClick('home.versus', () => {
  const t = selectedSong[currentTab] ?? selectedSong.Easy;
  txt($('versus.song.value'), t ? `${t.title}  ·  ${MODES[chartFor(t).diff].label}` : '-');
  txt($('versus.status'), '1v1 battles need the online server, which isn\'t available on the web version yet.');
  openModal($('versus'));
});
onClick('versus.close', closeModal);

// ---------------------------------------------------------------------------------------------
// Gameplay
// ---------------------------------------------------------------------------------------------
const game = new Game(audio, {
  settings,
  onFinish: (r, cleared) => { game.stop(); void showResults(r, cleared); },
  onLoadFail: () => { showToast("Couldn't load that song. Try again."); void go('select'); },
  showGame: (setup, quick) => {
    if (quick && currentScreen === 'game') { setup(); return Promise.resolve(); }
    return go('game', setup);
  },
});

async function startRun(t: Track | null | undefined, diff?: Diff | null, quick = false, opts?: RunOpts) {
  if (!t || (transitioning && !quick)) return;
  await audio.unlock();
  diff = (diff && t.charts[diff]) ? diff : t.difficulty;
  closeModal();
  lastSong = t; lastChart = diff; lastOpts = opts;
  // remember it in Recent (newest first, one entry per song)
  data.recent = [{ id: t.id, chart: diff }, ...data.recent.filter(e => e.id !== t.id)].slice(0, K.MAX_RECENT);
  queueSave();
  audio.token++;
  const set = opts?.set ?? currentSet(settings(), autoplay);
  const runOpts: RunOpts = { ...opts, practice: { from: practice.from, to: practice.to } };
  await game.start(t, diff, quick, runOpts, set);
}

function quickRestart() {
  const r = game.run;
  if (r && !transitioning) void startRun(r.track, r.chartDiff, true, r.opts);
}

function pauseRun() {
  if (game.pause()) openModal($('pause'));
}
onClick('game.left.pause', pauseRun);
onClick('pause.resume', () => { closeModal(); game.resume(); });
onClick('pause.restart', () => { const r = game.run; if (r) void startRun(r.track, r.chartDiff, true, r.opts); });
onClick('pause.quit', () => {
  closeModal();
  game.stop();
  void go('select', () => setTab(currentTab, true));
  void playPreview(selectedSong[currentTab]);
});

// receptors: mouse / touch
for (const lane of [1, 2] as Lane[]) {
  const rec = $(`game.pf.lane${lane}.rec`);
  rec.addEventListener('pointerdown', e => { e.preventDefault(); game.press(lane, eventAge(e)); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    rec.addEventListener(type, e => game.release(lane, eventAge(e)));
  }
}
function eventAge(e: Event) {
  return Math.min(0.1, Math.max(0, (performance.now() - e.timeStamp) / 1000));
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------
function buildGraph(r: Run) {
  const bars = $('results.panel.graph.bars');
  bars.innerHTML = '';
  const samples = r.samples;
  if (!samples.length) return;
  const n = Math.min(samples.length, 140);
  const per = samples.length / n;
  const missAt = new Set<number>();
  for (const idx of r.missMarks) missAt.add(Math.min(n, Math.max(1, Math.floor((idx - 1) / per) + 1)));
  for (let i = 1; i <= n; i++) {
    const a = Math.floor((i - 1) * per), b = Math.max(Math.floor(i * per), a + 1);
    let sum = 0, c = 0;
    for (let k = a; k < Math.min(b, samples.length); k++) { sum += samples[k]; c++; }
    const hp = c ? sum / c / 100 : 0;
    const bar = document.createElement('div');
    bar.className = 'gbar';
    bar.style.left = `${((i - 1) / n) * 100}%`;
    bar.style.width = `calc(${100 / n}% - 1px)`;
    bar.style.height = `${Math.max(hp, 0.04) * 100}%`;
    const miss = missAt.has(i);
    bar.style.background = rgba(miss ? T.red : hp > 0.5 ? T.green : hp > 0.25 ? T.gold : T.red, miss ? 0 : 0.4);
    bars.appendChild(bar);
  }
}

async function showResults(r: Run, cleared: boolean) {
  const t = r.track;
  const acc = game.accuracyOf(r);
  const grade = gradeFor(acc, cleared, r.counts);
  const fc = cleared && r.counts[3] === 0;
  const key = bestKey(t, r.chartDiff);
  const ranked = !r.unranked;
  const p = data.profile;

  // personal best
  const old = data.bests[key];
  const isBest = cleared && ranked && (!old || r.score > old.score);
  if (cleared && ranked) {
    if (isBest) data.bests[key] = { score: Math.floor(r.score), accuracy: acc, combo: r.maxCombo, grade, fc: fc || !!old?.fc };
    else if (fc && old && !old.fc) old.fc = true;
  }

  // profile: xp, stats, streak
  let xpGained = 0;
  const levelBefore = levelFromXp(p.xp).level;
  if (!r.auto) {
    const hits = r.counts[0] + r.counts[1] + r.counts[2];
    xpGained = Math.floor(hits * (0.5 + acc / 200) * DIFF_XP[r.chartDiff] * (cleared ? 1 : 0.4) * (ranked ? 1 : 0.25));
    p.xp += xpGained;
    p.plays++;
    p.notesHit += hits;
    p.playSeconds += Math.floor((performance.now() - r.playStart) / 1000);
    if (ranked && fc) p.fcs++;
    if (ranked && grade === 'SS') p.ss++;
    const today = Math.floor(Date.now() / 86400000);
    if (p.lastDay !== today) {
      p.streak = p.lastDay === today - 1 ? p.streak + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.lastDay = today;
    }
  }
  const levelAfter = levelFromXp(p.xp).level;
  if (levelAfter > levelBefore) queueToast(`LEVEL UP!  You're now level ${levelAfter}`);

  // song packs + achievements (ranked runs only)
  let packDone = false;
  if (ranked && cleared) {
    const pack = packOf.get(t.id);
    if (pack && !p.packs[pack.id]) {
      const { cleared: c, total } = packProgress(pack);
      if (c >= total) {
        p.packs[pack.id] = true;
        packDone = true;
        queueToast(`${pack.name} COMPLETE!`);
      }
    }
  }
  if (ranked) {
    const ctx = { cleared, grade, fc, rank: RANK[r.chartDiff], style: r.set.style, rate: r.set.rate, maxCombo: r.maxCombo, packComplete: packDone };
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements[a.id] && a.check(ctx)) {
        p.achievements[a.id] = true;
        queueToast(`ACHIEVEMENT: ${a.name}  (title: ${a.title})`);
      }
    }
  }

  // weekly best + feed (this browser's big plays)
  if (cleared && ranked) {
    if (r.weekly !== undefined) {
      const wk = String(r.weekly);
      if (!p.weekly[wk] || r.score > p.weekly[wk]) p.weekly[wk] = Math.floor(r.score);
      refreshWeekly();
    }
    const who = `<b>${escapeHtml(account?.username ?? 'You')}</b>`;
    const what = `${escapeHtml(t.title)} [${MODES[r.chartDiff].label}]`;
    if (grade === 'SS' && RANK[r.chartDiff] >= 2) pushFeed(`${who} got an SS on ${what}`);
    else if (fc && RANK[r.chartDiff] >= 3) pushFeed(`${who} full-comboed ${what}`);
    else if (RANK[r.chartDiff] >= 5) pushFeed(`${who} cleared ${what}!`);
    else if (isBest) pushFeed(`${who} set a new best on ${what}`);
  }
  queueSave();
  refreshHome();

  await go('results', () => {
    const mode = MODES[r.chartDiff];
    pop($('results.panel'), 0.94, 0.35, ease.back);
    const gc = gradeColor(grade, T);
    const g = $('results.panel.circle.grade');
    txt(g, grade);
    g.style.color = gc;
    g.style.fontSize = grade.length > 1 ? '120px' : '150px';
    $('results.panel.circle').style.boxShadow = `0 0 0 3px ${gc}, 0 0 60px ${rgba(gc, 0.85)}`;
    $('results.panel.circle').style.setProperty('--s', '0.4');
    setTimeout(() => pop($('results.panel.circle'), 0.4, 0.5, ease.back), 250);
    const [status, statusColor] = !cleared ? ['FAILED', T.red] : grade === 'SS' ? ['ALL PERFECT', T.gold] : fc ? ['FULL COMBO', T.gold] : ['CLEARED', T.green];
    txt($('results.panel.status'), status);
    $('results.panel.status').style.color = statusColor;
    show($('results.panel.newbest'), isBest);
    txt($('results.panel.title'), t.title);
    txt($('results.panel.info'), `${mode.label}  ·  ${r.summary}  ·  LV ${t.charts[r.chartDiff]!.level}`);
    txt($('results.panel.xp'), xpGained > 0 ? `+${formatNumber(xpGained)} XP  ·  LV ${levelAfter}` : '');
    html($('results.panel.versus'), '');
    const score = Math.floor(r.score);
    tween($('results.panel.score'), 'count', 0, score, 1.1, v => txt($('results.panel.score'), formatNumber(v)), ease.quart);
    txt($('results.panel.accuracy.value'), `${acc.toFixed(2)}%`);
    txt($('results.panel.maxcombo.value'), `${r.maxCombo} / ${r.objects}`);
    const total = Math.max(1, r.objects);
    (['perfect', 'great', 'good', 'miss'] as const).forEach((nm, i) => {
      txt($(`results.panel.breakdown.${nm}.value`), String(r.counts[i]));
      const fill = $(`results.panel.breakdown.${nm}.bar.fill`);
      fill.style.width = '0%';
      setTimeout(() => { fill.style.width = `${Math.min(1, r.counts[i] / total) * 100}%`; }, 200 + i * 80);
    });
    buildGraph(r);
    // timing feedback (and a hint for the audio offset setting)
    const avg = game.averageError(r);
    let avgText = '';
    if (r.unranked) avgText = 'Unranked run, score not saved';
    else if (avg !== null && r.errors.length >= 10) {
      const ms = Math.round(Math.abs(avg) * 1000);
      if (ms <= 12) avgText = `Avg timing ${ms}ms ${avg < 0 ? 'early' : 'late'}: right on the beat`;
      else {
        const suggest = Math.min(300, Math.max(-300, settings().offset + (avg < 0 ? -1 : 1) * Math.round(ms / 5) * 5));
        avgText = `You hit ${ms}ms ${avg < 0 ? 'early' : 'late'} on average. Try audio offset ${suggest >= 0 ? '+' : ''}${suggest} ms`;
      }
    }
    txt($('results.panel.avg'), avgText);
    txt($('results.panel.retry'), `RETRY  (${keyName(settings().keys[2])})`);
  });
  void playPreview(t);
}

onClick('results.panel.retry', () => void startRun(lastSong, lastChart, false, lastOpts));
onClick('results.panel.continue', () => {
  if (transitioning) return;
  if (lastOpts?.weekly !== undefined) void go('home');
  else void go('select', () => setTab(currentTab, true));
});

// ---------------------------------------------------------------------------------------------
// Calibration (tap along to a clean track, measure how late you hear/press)
// ---------------------------------------------------------------------------------------------
const CAL_TAPS = 20, CAL_SKIP = 4;
let calib: { track: Track; taps: number[]; running: boolean; result: number | null } | null = null;

async function calibStart() {
  const track = tracksById.get('daybreak') ?? tracks[0];
  const my = ++audio.token;
  calib = { track, taps: [], running: false, result: null };
  txt($('calib.pad.count'), '...');
  html($('calib.result'), 'Loading the beat...');
  $('calib.apply').classList.add('disabled');
  await audio.unlock();
  const buffer = await audio.load(track.song);
  if (my !== audio.token || !calib) return;
  const start = track.previewStart;
  audio.start(buffer, audio.now + 0.05, start, 1, 0.9, { start, end: Math.min(buffer.duration, start + 30) });
  calib.running = true;
  txt($('calib.pad.count'), `0 / ${CAL_TAPS}`);
  html($('calib.result'), 'Tap on every beat you hear');
}

function calibTap(age = 0) {
  pop($('calib.pad'), 0.9, 0.15, ease.back);
  if (!calib || !calib.running) return;
  const t = audio.position() - age;
  const beat = 60 / calib.track.bpm;
  const phase = (t - calib.track.offset) / beat;
  const err = (phase - Math.round(phase)) * beat; // seconds, negative = early
  calib.taps.push(err);
  txt($('calib.pad.count'), `${calib.taps.length} / ${CAL_TAPS}`);
  if (calib.taps.length >= CAL_TAPS) {
    const used = calib.taps.slice(CAL_SKIP).sort((a, b) => a - b);
    const median = used[Math.floor(used.length / 2)];
    const ms = Math.round(median * 1000);
    calib.result = Math.min(300, Math.max(-300, Math.round((median * 1000) / 5) * 5));
    calib.running = false;
    audio.fade(0, 0.3);
    txt($('calib.pad.count'), 'DONE');
    html($('calib.result'), `You tap <b>${Math.abs(ms)}ms ${ms < 0 ? 'early' : 'late'}</b> on average.<br>Suggested audio offset: <b>${calib.result >= 0 ? '+' : ''}${calib.result} ms</b>`);
    $('calib.apply').classList.remove('disabled');
  }
}

function openCalibration() {
  calib = null;
  txt($('calib.pad.count'), `0 / ${CAL_TAPS}`);
  html($('calib.result'), `Current offset: ${settings().offset >= 0 ? '+' : ''}${settings().offset} ms`);
  $('calib.apply').classList.add('disabled');
  openModal($('calib'));
}
function closeCalibration() {
  if (calib) calib.running = false;
  audio.stop();
  calib = null;
  openSettings();
  void playPreview(selectedSong[currentTab] ?? previewTrack);
}
onClick('calib.start', () => void calibStart());
$('calib.pad').addEventListener('pointerdown', e => calibTap(eventAge(e)));
onClick('calib.close', closeCalibration);
onClick('calib.apply', () => {
  if (calib?.result === null || !calib) return;
  settings().offset = calib.result;
  queueSave();
  showToast(`Audio offset set to ${settings().offset >= 0 ? '+' : ''}${settings().offset} ms`);
  closeCalibration();
});

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------
function refreshSettings() {
  for (let i = 0; i < 3; i++) txt($(`settings.key${i + 1}.btn`), listeningKey === i ? '...' : keyName(settings().keys[i]));
  txt($('settings.scroll.value'), `${settings().scrollSpeed.toFixed(1)}x`);
  txt($('settings.offset.value'), `${settings().offset >= 0 ? '+' : ''}${settings().offset} ms`);
  txt($('settings.volume.value'), `${Math.round(settings().musicVolume * 100)}%`);
  txt($('settings.hitsound.value'), settings().hitSound);
  setToggle($('settings.effects.toggle'), settings().effects);
  setToggle($('settings.centerhud.toggle'), settings().centerHud);
  setToggle($('settings.hitzone.toggle'), settings().hitZone);
  game.applyHudLayout();
  audio.setVolume(settings().musicVolume);
  refreshHome();
}
const setKeyStatus = (text: string, error = false) => {
  txt($('settings.keystatus'), text);
  $('settings.keystatus').style.color = error ? T.red : T.muted;
};
function openSettings() {
  listeningKey = null;
  setKeyStatus('Click a key, then press the new key.');
  openModal($('settings'));
  refreshSettings();
}
function closeSettings() {
  listeningKey = null;
  closeModal();
  queueSave();
  showToast('Settings saved');
}
for (let i = 0; i < 3; i++) onClick(`settings.key${i + 1}.btn`, () => {
  if (listeningKey === i) { listeningKey = null; setKeyStatus('Cancelled.'); }
  else { listeningKey = i; setKeyStatus(`Press any key for ${KEY_LABELS[i]} (click again to cancel).`); }
  refreshSettings();
});
const stepper = (row: string, apply: (dir: number) => void) => {
  onClick(`settings.${row}.minus`, () => { apply(-1); refreshSettings(); });
  onClick(`settings.${row}.plus`, () => { apply(1); refreshSettings(); });
};
stepper('scroll', dir => { settings().scrollSpeed = Math.min(3, Math.max(0.5, Math.round((settings().scrollSpeed + dir * 0.1) * 10) / 10)); });
stepper('offset', dir => { settings().offset = Math.min(300, Math.max(-300, settings().offset + dir * 5)); });
stepper('volume', dir => { settings().musicVolume = Math.min(1, Math.max(0, Math.round((settings().musicVolume + dir * 0.1) * 10) / 10)); });
stepper('hitsound', dir => {
  const i = HIT_SOUNDS.indexOf(settings().hitSound);
  settings().hitSound = HIT_SOUNDS[(i + dir + HIT_SOUNDS.length) % HIT_SOUNDS.length];
  setTimeout(() => audio.playHit(settings().hitSound), 150);
});
onClick('settings.effects.toggle', () => { settings().effects = !settings().effects; refreshSettings(); });
onClick('settings.centerhud.toggle', () => { settings().centerHud = !settings().centerHud; refreshSettings(); });
onClick('settings.hitzone.toggle', () => { settings().hitZone = !settings().hitZone; refreshSettings(); });
onClick('settings.offset.calibrate', openCalibration);
onClick('settings.reset', () => {
  const style = settings();
  data.settings = { ...DEFAULT_SETTINGS, keys: [...DEFAULT_KEYS], style: style.style, rate: style.rate,
    hidden: style.hidden, sudden: style.sudden, flashlight: style.flashlight, mirror: style.mirror, random: style.random, wave: style.wave, mines: style.mines };
  listeningKey = null;
  setKeyStatus('Everything reset to default.');
  refreshSettings();
});
onClick('settings.close', closeSettings);

// ---------------------------------------------------------------------------------------------
// Accounts (log in / sign up / manage)
// ---------------------------------------------------------------------------------------------
let authMode: 'login' | 'signup' = 'login';
const authInput = (name: string) => $(`auth.form.${name}`) as HTMLInputElement;

function setAuthMode(mode: 'login' | 'signup') {
  authMode = mode;
  $('auth.form.tabs.highlight').style.left = mode === 'login' ? '4px' : '200px';
  $('auth.form.tabs.login').style.color = mode === 'login' ? T.bg0 : T.muted;
  $('auth.form.tabs.signup').style.color = mode === 'signup' ? T.bg0 : T.muted;
  const signup = mode === 'signup';
  show($('auth.form.clabel'), signup);
  show(authInput('confirm'), signup);
  $('auth.form.error').style.top = signup ? '432px' : '360px';
  $('auth.form.submit').style.top = signup ? '470px' : '404px';
  $('auth.form.guest').style.top = signup ? '536px' : '474px';
  $('auth.form.note').style.top = signup ? '584px' : '524px';
  $('auth').style.height = signup ? '620px' : '560px';
  authInput('password').autocomplete = signup ? 'new-password' : 'current-password';
  authInput('password').placeholder = signup ? 'At least 10 characters' : 'Your password';
  txt($('auth.form.submit'), signup ? 'CREATE ACCOUNT' : 'LOG IN');
  txt($('auth.form.sub'), signup ? 'Make an account to keep your progress everywhere' : 'Log in to save your progress');
  txt($('auth.form.error'), '');
}

function openAuth(mode: 'login' | 'signup' = 'login') {
  setAuthMode(mode);
  authInput('password').value = '';
  authInput('confirm').value = '';
  openModal($('auth'));
  setTimeout(() => authInput('username').focus(), 50);
}

let authBusy = false;
async function submitAuth() {
  if (authBusy) return;
  const username = authInput('username').value.trim();
  const password = authInput('password').value;
  const err = (text: string) => txt($('auth.form.error'), text);
  const uErr = validateUsername(username);
  if (uErr) return err(uErr);
  if (authMode === 'signup') {
    const pErr = validatePassword(password, username);
    if (pErr) return err(pErr);
    if (password !== authInput('confirm').value) return err("Those passwords don't match.");
  } else if (!password) return err('Enter your password.');
  authBusy = true;
  err('');
  txt($('auth.form.submit'), authMode === 'signup' ? 'CREATING...' : 'LOGGING IN...');
  const res = authMode === 'signup' ? await api.register(username, password) : await api.login(username, password);
  authBusy = false;
  txt($('auth.form.submit'), authMode === 'signup' ? 'CREATE ACCOUNT' : 'LOG IN');
  if (!res.ok || !res.data) return err(res.error ?? 'Something went wrong.');
  authInput('password').value = '';
  authInput('confirm').value = '';
  await signedIn(res.data.user, authMode === 'signup');
}

async function signedIn(user: User, fresh: boolean) {
  account = user;
  // your account's save is the source of truth; a brand-new account adopts this browser's guest progress
  const res = await api.loadSave();
  if (res.ok && res.data && res.data.data) {
    data = sanitize(res.data.data);
  } else if (fresh || (res.ok && !res.data?.data)) {
    data = loadLocal();
    await api.putSave(data);
  }
  syncState = 'Progress is saved to your account';
  closeModal();
  showToast(fresh ? `Welcome to Line Rush, ${user.username}!` : `Welcome back, ${user.username}!`);
  afterDataChange();
}

function handleSignedOut() {
  account = null;
  data = loadLocal();
  afterDataChange();
}

function afterDataChange() {
  refreshSettings();
  refreshHome();
  refreshWeekly();
  if (currentScreen === 'select') buildList();
}

onClick('auth.form.tabs.login', () => setAuthMode('login'));
onClick('auth.form.tabs.signup', () => setAuthMode('signup'));
onClick('auth.form.submit', () => void submitAuth());
onClick('auth.form.guest', () => {
  try { localStorage.setItem('lineRush.guest', '1'); } catch { /* private mode */ }
  closeModal();
  void playPreview(previewTrack ?? selectedSong.Easy);
});
for (const name of ['username', 'password', 'confirm']) {
  authInput(name).addEventListener('keydown', e => { if (e.key === 'Enter') void submitAuth(); });
}

const acctInput = (name: string) => $(`account.${name}`) as HTMLInputElement;
function openAccount() {
  if (!account) return openAuth();
  txt($('account.user'), account.username);
  txt($('account.since'), `Member since ${new Date(account.createdAt).toLocaleDateString()}`);
  txt($('account.sync'), syncState);
  txt($('account.msg'), '');
  for (const n of ['current', 'next', 'confirm']) acctInput(n).value = '';
  openModal($('account'));
}
const acctMsg = (text: string, color = T.muted) => { txt($('account.msg'), text); $('account.msg').style.color = color; };
onClick('account.close', closeModal);
onClick('account.change', async () => {
  if (!account) return;
  const current = acctInput('current').value, next = acctInput('next').value;
  const pErr = validatePassword(next, account.username);
  if (!current) return acctMsg('Enter your current password.', T.red);
  if (pErr) return acctMsg(pErr, T.red);
  if (next !== acctInput('confirm').value) return acctMsg("The new passwords don't match.", T.red);
  acctMsg('Updating...');
  const res = await api.changePassword(current, next);
  if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
  for (const n of ['current', 'next', 'confirm']) acctInput(n).value = '';
  acctMsg('Password updated. Other devices were logged out.', T.green);
});
onClick('account.logout', async () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; await api.putSave(data); }
  await api.logout();
  closeModal();
  handleSignedOut();
  showToast('Logged out');
});
onClick('account.logoutall', async () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; await api.putSave(data); }
  const res = await api.logoutAll();
  if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
  closeModal();
  handleSignedOut();
  showToast('Logged out on every device');
});
onClick('account.delete', async () => {
  const password = acctInput('current').value;
  if (!password) return acctMsg('Type your current password above to delete your account.', T.red);
  if (!window.confirm('Delete your Line Rush account and all its progress? This cannot be undone.')) return;
  const res = await api.deleteAccount(password);
  if (!res.ok) return acctMsg(res.error ?? 'Something went wrong.', T.red);
  closeModal();
  handleSignedOut();
  showToast('Your account was deleted');
});

// ---------------------------------------------------------------------------------------------
// Custom imports
// ---------------------------------------------------------------------------------------------
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm';
fileInput.hidden = true;
document.body.appendChild(fileInput);
onClick('select.import', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const ctx = await audio.unlock();
    const imported = await importSong(file, ctx, text => showToast(text));
    const t = trackFromImport(imported.song);
    if (!t.charts[t.difficulty]) throw new Error("Couldn't find enough beats to chart this track.");
    audio.registerBuffer(t.song.id, imported.buffer);
    tracks = [...tracks.filter(x => x.id !== t.id), t];
    tracksById = byId();
    selectedSong[t.difficulty] = t;
    setTab(t.difficulty);
    selectSong(t);
    showToast(imported.warning ?? `${t.title} added to ${MODES[t.difficulty].label}`);
  } catch (e) {
    showToast(e instanceof Error ? e.message : "Couldn't import that file.");
  }
});

// ---------------------------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------------------------
const inField = () => document.activeElement instanceof HTMLInputElement;
window.addEventListener('keydown', e => {
  void audio.unlock();
  if (listeningKey !== null) {
    e.preventDefault();
    if (BLOCKED_KEYS.has(e.code)) return setKeyStatus(`${keyName(e.code)} can't be used. Try another key.`, true);
    const slot = listeningKey;
    let swapped: number | null = null;
    for (let j = 0; j < 3; j++) {
      if (j !== slot && settings().keys[j] === e.code) { settings().keys[j] = settings().keys[slot]; swapped = j; }
    }
    settings().keys[slot] = e.code;
    setKeyStatus(swapped !== null ? `Swapped with ${KEY_LABELS[swapped]}.` : `${KEY_LABELS[slot]} set to ${keyName(e.code)}.`);
    listeningKey = null;
    refreshSettings();
    return;
  }
  if (inField()) return;
  const keys = settings().keys;
  if (modal === $('calib')) {
    if (!e.repeat && (e.code === keys[0] || e.code === keys[1] || e.code === 'Space')) { e.preventDefault(); calibTap(eventAge(e)); }
    else if (e.code === 'Escape') closeCalibration();
    return;
  }
  if (currentScreen === 'game' && game.run) {
    const lane = e.code === keys[0] ? 1 : e.code === keys[1] ? 2 : 0;
    if (lane) {
      e.preventDefault();
      if (!e.repeat && !modal) game.press(lane as Lane, eventAge(e));
      return;
    }
    if (e.code === keys[2] && !e.repeat) { e.preventDefault(); quickRestart(); return; }
    if (e.code === 'Escape') { if (modal === $('pause')) { closeModal(); game.resume(); } else pauseRun(); return; }
  }
  if (e.code === 'Escape' && modal) {
    if (modal === $('settings')) closeSettings();
    else if (modal === $('style')) closeStyle();
    else if (modal !== $('pause')) closeModal();
    return;
  }
  if (modal || transitioning || e.repeat) return;
  if (currentScreen === 'select') {
    if (e.code === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const index = TAB_ORDER.indexOf(currentTab) + (e.code === 'ArrowLeft' ? -1 : 1);
      setTab(TAB_ORDER[Math.min(TAB_ORDER.length - 1, Math.max(0, index))]);
    } else if (e.code === 'Enter') {
      const t = selectedSong[currentTab];
      if (t) void startRun(t, chartFor(t).diff);
    }
  } else if (currentScreen === 'results' && e.code === keys[2]) {
    void startRun(lastSong, lastChart, false, lastOpts);
  } else if (currentScreen === 'home' && e.code === 'Enter') {
    void go('select', () => setTab(currentTab, true));
  }
});
window.addEventListener('keyup', e => {
  if (currentScreen !== 'game' || !game.run || inField()) return;
  const keys = settings().keys;
  const lane = e.code === keys[0] ? 1 : e.code === keys[1] ? 2 : 0;
  if (lane) game.release(lane as Lane, eventAge(e));
});
// leaving the tab / window pauses the game
window.addEventListener('blur', pauseRun);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseRun(); });

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------
onClick('home.play', () => {
  if (transitioning) return;
  void go('select', () => setTab(currentTab, true));
  if (previewTrack !== selectedSong[currentTab]) void playPreview(selectedSong[currentTab]);
});
onClick('home.settings', openSettings);
onClick('home.weekly.play', () => {
  if (weekly) void startRun(weekly.track, weekly.track.difficulty, false, { set: weeklySet(weekly.mods), weekly: weekly.week });
});
onClick('select.back', () => { if (!transitioning) void go('home'); });
onClick('select.settings', openSettings);
for (const name of TAB_ORDER) onClick(`select.tabs.${name.toLowerCase()}`, () => setTab(name));
onClick('select.detail.play', () => {
  const t = selectedSong[currentTab];
  if (t) void startRun(t, chartFor(t).diff);
});

// ---------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------
function frame() {
  game.step();
  // logo / playfield border pulse on the beat of whatever is playing
  let pulse = 0;
  const r = game.run;
  let t: number | null = null, track: Track | null = null;
  if (r && r.ready) { track = r.track; t = game.songTime(r) - r.offset; }
  else if (previewTrack && audio.playing && !calib) { track = previewTrack; t = audio.position(); }
  if (track && t !== null && t > 0 && settings().effects) {
    const phase = (((t - track.offset) / (60 / track.bpm)) % 1 + 1) % 1;
    pulse = Math.exp(-phase * 6);
  }
  if (currentScreen === 'home') $('home.logo').style.setProperty('--s', String(1 + 0.035 * pulse));
  else if (currentScreen === 'game') $('game.pf').style.setProperty('--pulse', String(0.15 + 0.55 * pulse));
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------------------------
$('fader').style.opacity = '1';
showScreen('home');
for (const tab of TAB_ORDER) selectedSong[tab] = songsFor(tab)[0];
setTab('Easy', true);
refreshSettings();
renderFeed();
refreshWeekly();
setInterval(refreshWeekly, 60000);
requestAnimationFrame(() => {
  $('fader').style.transition = 'opacity .6s';
  $('fader').style.opacity = '0';
});
requestAnimationFrame(frame);

// browsers only allow sound after a click/key: start the menu music on the first one
const firstGesture = () => {
  void audio.unlock().then(() => { if (!game.run && !audio.playing) void playPreview(previewTrack ?? selectedSong.Easy); });
  window.removeEventListener('pointerdown', firstGesture);
};
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('pointerdown', () => void audio.unlock(), { capture: true });
previewTrack = selectedSong.Easy ?? null;
if (previewTrack) html($('home.nowplaying'), `NOW PLAYING &nbsp; <b>${escapeHtml(previewTrack.title)}</b> &nbsp;·&nbsp; ${escapeHtml(previewTrack.artist)}`);

// restore an existing session, otherwise offer log in / sign up (or guest)
void (async () => {
  const res = await api.me();
  if (res.ok && res.data?.user) {
    await signedIn(res.data.user, false);
  } else if (res.status !== 401) {
    accountsOffline = true; // no account server here (static hosting / not configured): play as a guest
  } else if (!(() => { try { return localStorage.getItem('lineRush.guest'); } catch { return null; } })()) {
    openAuth('login');
  }
})();
