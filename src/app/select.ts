// Song select: tier tabs (+ Recent), song cards, the detail panel with chart picker and personal
// best, and importing your own audio file.
import { K, MODES, STAR_COLORS, T, TAB_INFO, TAB_ORDER, type Pack, type Tab } from '../config.ts';
import { importSong } from '../custom.ts';
import { currentSet, fmtTime, formatNumber, gradeColor, setMultiplier, setSummary } from '../scoring.ts';
import { dropImportProgress } from '../storage.ts';
import { trackFromImport } from '../tracks.ts';
import type { Track } from '../types.ts';
import { $, rgba, show, txt } from '../ui.ts';
import { openBoard } from './board.ts';
import { openSettings } from './settingsPanel.ts';
import { startRun } from './play.ts';
import { playPreview } from './preview.ts';
import { audio } from './services.ts';
import { loadImportAudio, loadImports, removeImport, saveImport } from './importStore.ts';
import { queueSave } from './save.ts';
import { go, onClick, setAmbient, showToast } from './shell.ts';
import { S, bestKey, chartFor, packOf, setTracks, settings } from './state.ts';
import { openStyle } from './stylePanel.ts';

function songsFor(tab: Tab): Track[] {
  if (tab === 'Recent') {
    const out: Track[] = [];
    for (const e of S.data.recent) {
      const t = S.tracksById.get(e.id);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }
  return S.tracks.filter(t => t.difficulty === tab).sort((a, b) => a.level - b.level || a.displayBpm - b.displayBpm);
}

const songCleared = (id: string) => S.data.bests[id] !== undefined || S.data.bests[`${id}+`] !== undefined;
export function packProgress(pack: Pack) {
  let cleared = 0, total = 0;
  for (const id of pack.songs) {
    if (!S.tracksById.has(id)) continue;
    total++;
    if (songCleared(id)) cleared++;
  }
  return { cleared, total };
}

/** mastery stars: clear / A or better / S or better / full combo (own chart) */
function starFlags(t: Track) {
  const b = S.data.bests[t.id];
  if (!b) return [false, false, false, false];
  const g = b.grade;
  return [true, g === 'A' || g === 'S' || g === 'SS', g === 'S' || g === 'SS', b.fc];
}

// ---- song cards ----------------------------------------------------------------------------
let cards = new Map<Track, HTMLElement>();

function styleCards() {
  for (const [t, card] of cards) {
    const sel = S.selectedSong[S.tab] === t;
    card.classList.toggle('on', sel);
    card.style.setProperty('--accent', t.color1);
  }
}

function buildCard(t: Track): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'f card';
  const b = S.data.bests[t.id];
  const diff = S.selectedChart.get(t) ?? t.difficulty;
  const levelText = S.tab === 'Recent' && t.charts[diff] ? `${MODES[diff].label}  LV ${t.charts[diff]!.level}` : `LV ${t.level}`;
  const flags = starFlags(t);
  card.innerHTML = `
    <div class="cover" style="background:linear-gradient(135deg, ${t.color1}, ${t.color2})"><b></b><span>BPM</span></div>
    <div class="title"></div>
    <div class="sub"></div>
    <div class="level"></div>
    <div class="grade"></div>
    <div class="stars">${flags.map((on, i) => `<i style="background:${on ? STAR_COLORS[i] : T.bg3}"></i>`).join('')}</div>`;
  const q = (sel: string) => card.querySelector(sel) as HTMLElement;
  q('.cover b').textContent = String(t.displayBpm);
  q('.title').textContent = t.title;
  q('.sub').textContent = `${t.artist}  ·  ${t.genre}  ·  ${fmtTime(t.displayLength)}`;
  q('.level').textContent = levelText;
  q('.grade').textContent = b ? b.grade : '-';
  q('.grade').style.color = b ? gradeColor(b.grade, T) : T.dim;
  card.addEventListener('click', () => { void audio.unlock(); selectSong(t); });
  return card;
}

// ---- detail panel --------------------------------------------------------------------------
export function refreshStyleButton() {
  const set = currentSet(settings(), S.autoplay);
  const { mult, unranked } = setMultiplier(set);
  txt($('select.detail.style.value'), setSummary(set));
  txt($('select.detail.style.mult'), `${unranked ? 'NO SAVE' : `x${mult.toFixed(2)}`}  >`);
  $('select.detail.style.mult').style.color = unranked ? T.red : T.gold;
}

function updateDetail() {
  const t = S.selectedSong[S.tab];
  if (!t) return;
  const chart = chartFor(t);
  const mode = MODES[chart.diff];
  $('select.detail').style.setProperty('--accent', t.color1);
  if (S.screen === 'select' || S.transitioning) setAmbient(t.color1, t.color2);
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
    // licensed songs show their license (full credits on the home screen's CREDITS)
    const credit = t.song.credit;
    txt($('select.detail.pack'), t.custom ? 'YOUR IMPORT' : credit ? `${credit.license.toUpperCase()}  ·  ${credit.source.toUpperCase()}` : '');
    $('select.detail.pack').style.color = T.muted;
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

  // imports have no online board
  show($('select.detail.best.top'), !t.custom);
  show($('select.detail.best.remove'), !!t.custom);
  const b = S.data.bests[bestKey(t, chart.diff)];
  txt($('select.detail.best.score'), b ? formatNumber(b.score) : '-');
  txt($('select.detail.best.info'), b ? `${b.accuracy.toFixed(2)}%  ·  ${b.combo} max combo` : 'No clears yet. Go set a score!');
  txt($('select.detail.best.grade'), b ? b.grade : '-');
  $('select.detail.best.grade').style.color = b ? gradeColor(b.grade, T) : T.dim;
  show($('select.detail.best.fc'), !!b?.fc);
  refreshStyleButton();
}

function selectSong(t: Track) {
  S.selectedSong[S.tab] = t;
  S.practice.from = 0;
  S.practice.to = null;
  styleCards();
  updateDetail();
  cards.get(t)?.scrollIntoView({ block: 'nearest' });
  if (S.previewTrack !== t) void playPreview(t);
}

export function buildList() {
  const list = $('select.list');
  list.innerHTML = '';
  const holder = document.createElement('div');
  holder.className = 'cards';
  list.appendChild(holder);
  cards = new Map();
  if (S.tab === 'Recent') {
    for (let i = S.data.recent.length - 1; i >= 0; i--) {
      const t = S.tracksById.get(S.data.recent[i].id);
      if (t && t.charts[S.data.recent[i].chart]) S.selectedChart.set(t, S.data.recent[i].chart);
    }
  }
  const songs = songsFor(S.tab);
  if (!songs.includes(S.selectedSong[S.tab]!)) S.selectedSong[S.tab] = songs[0];
  const has = S.selectedSong[S.tab] !== undefined;
  show($('select.detail'), has);
  show($('select.empty'), !has);
  txt($('select.empty'), S.tab === 'Recent'
    ? 'Nothing here yet. Songs you play will show up here.'
    : `No ${S.tab} songs yet. Play a ${S.tab === 'Expert' ? 'Hard' : 'Expert'} song's "+" chart, or press + IMPORT to add your own track.`);
  const frag = document.createDocumentFragment();
  for (const t of songs) {
    const card = buildCard(t);
    frag.appendChild(card);
    cards.set(t, card);
  }
  holder.appendChild(frag);
  styleCards();
  updateDetail();
}

export function setTab(tab: Tab, instant = false) {
  S.tab = tab;
  const info = TAB_INFO[tab];
  const hl = $('select.tabs.highlight');
  if (instant) hl.style.transition = 'none';
  hl.style.left = `${6 + TAB_ORDER.indexOf(tab) * K.TAB_WIDTH}px`;
  hl.style.backgroundColor = rgba(info.color, 0.86);
  hl.style.boxShadow = `0 0 0 1px ${rgba(info.color, 0.6)}`;
  if (instant) requestAnimationFrame(() => { hl.style.transition = ''; });
  for (const name of TAB_ORDER) $(`select.tabs.${name.toLowerCase()}`).style.color = tab === name ? info.color : T.muted;
  txt($('select.hint'), info.hint);
  buildList();
  $('select.list').scrollTop = 0;
  const t = S.selectedSong[tab];
  if (t && S.previewTrack !== t && S.screen === 'select') void playPreview(t);
}

export function moveSelection(dir: number) {
  const list = songsFor(S.tab);
  if (!list.length) return;
  const idx = Math.max(0, list.indexOf(S.selectedSong[S.tab]!));
  selectSong(list[Math.min(list.length - 1, Math.max(0, idx + dir))]);
}

export function moveTab(dir: number) {
  const index = TAB_ORDER.indexOf(S.tab) + dir;
  setTab(TAB_ORDER[Math.min(TAB_ORDER.length - 1, Math.max(0, index))]);
}

export function playSelected() {
  const t = S.selectedSong[S.tab];
  if (t) void startRun(t, chartFor(t).diff);
}

// ---- importing your own song ---------------------------------------------------------------
async function importFile(file: File) {
  try {
    const ctx = await audio.unlock();
    const imported = await importSong(file, ctx, text => showToast(text));
    const t = trackFromImport(imported.song);
    if (!t.charts[t.difficulty]) throw new Error("Couldn't find enough beats to chart this track.");
    audio.registerBuffer(t.song.id, imported.buffer);
    // the same file again but charted for another tier: its old bests were for a different chart
    const old = S.tracksById.get(t.id);
    if (old && old.difficulty !== t.difficulty) {
      S.data = dropImportProgress(S.data, t.id);
      queueSave();
    }
    setTracks([...S.tracks.filter(x => x.id !== t.id), t]);
    S.selectedSong[t.difficulty] = t;
    setTab(t.difficulty);
    selectSong(t);
    // keep it on this computer so it's still here next time (nothing is uploaded)
    let kept = true;
    try { await saveImport(imported.song, file); } catch { kept = false; }
    showToast(imported.warning ?? (kept
      ? `${t.title} added to ${MODES[t.difficulty].label} and saved on this computer`
      : `${t.title} added to ${MODES[t.difficulty].label} (couldn't save it on this computer, so it's here until you close the tab)`));
  } catch (e) {
    showToast(e instanceof Error ? e.message : "Couldn't import that file.");
  }
}

/** bring back the songs imported on this computer */
async function restoreImports() {
  let saved: Track['song'][] = [];
  try { saved = await loadImports(); } catch { return; }
  if (!saved.length) return;
  const restored = saved.map(song => trackFromImport(song)).filter(t => t.charts[t.difficulty]);
  setTracks([...S.tracks.filter(t => !restored.some(r => r.id === t.id)), ...restored]);
  for (const tab of TAB_ORDER) S.selectedSong[tab] ??= songsFor(tab)[0];
  if (S.screen === 'select') buildList();
}

async function removeSelectedImport() {
  const t = S.selectedSong[S.tab];
  if (!t?.custom || !window.confirm(`Remove "${t.title}" from this computer? Its scores are removed too.`)) return;
  try { await removeImport(t.id); } catch { /* already gone */ }
  setTracks(S.tracks.filter(x => x !== t));
  S.data = dropImportProgress(S.data, t.id);
  for (const tab of TAB_ORDER) if (S.selectedSong[tab] === t) S.selectedSong[tab] = songsFor(tab)[0];
  queueSave();
  buildList();
  if (S.previewTrack?.id === t.id) {
    // its music is gone: stop it, then play this tab's next song (or Easy's if the tab is now empty, e.g. Recent)
    audio.token++;
    audio.stop();
    S.previewTrack = null;
    void playPreview(S.selectedSong[S.tab] ?? S.selectedSong.Easy);
  }
  showToast(`${t.title} removed`);
}

export function initSelect() {
  (['base', 'plus'] as const).forEach((name, i) => onClick(`select.detail.chartrow.${name}`, () => {
    const t = S.selectedSong[S.tab];
    if (t && t.chartList[i] && t.charts[t.chartList[i]]) {
      S.selectedChart.set(t, t.chartList[i]);
      S.practice.from = 0;
      S.practice.to = null;
      updateDetail();
    }
  }));
  onClick('select.back', () => { if (!S.transitioning) void go('home'); });
  onClick('select.settings', openSettings);
  for (const name of TAB_ORDER) onClick(`select.tabs.${name.toLowerCase()}`, () => setTab(name));
  onClick('select.detail.play', playSelected);
  onClick('select.detail.style', openStyle);
  onClick('select.detail.best.top', () => {
    const t = S.selectedSong[S.tab];
    if (t) openBoard(t, chartFor(t).diff);
  });

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  onClick('select.import', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importFile(file);
  });

  for (const tab of TAB_ORDER) S.selectedSong[tab] = songsFor(tab)[0];
  onClick('select.detail.best.remove', () => void removeSelectedImport());
  audio.localSource = loadImportAudio;
  void restoreImports();
}
