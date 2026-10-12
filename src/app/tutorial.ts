// The first-time tutorial: a one-minute song of its own that teaches taps, both buttons, chords and
// holds, with cues on the game screen as it plays. Also the welcome card that offers it, its own end
// screen, and what new / returning players see at startup. The song, chart, cue text and the rules
// for who sees what are in src/onboarding.ts.
import { TAGS } from '../../shared/cosmetics.js';
import { ease, pop } from '../anim.ts';
import { LATEST } from '../changelog.ts';
import { DEFAULT_SETTINGS, T } from '../config.ts';
import type { Run } from '../game.ts';
import {
  INTRO_CUE, STAGES, TUTORIAL_ID, TUTORIAL_RECIPE, TUTORIAL_SET, cueAt, friendlyName, isFirstTimer, onboardingStep,
  stageVerdict, tutorialCanStart, tutorialChart, tutorialTrack, tutorialVerdict, type Cue,
} from '../onboarding.ts';
import { formatNumber, keyName } from '../scoring.ts';
import { renderRecipe } from '../synthesis.ts';
import type { Track } from '../types.ts';
import { $, button, frame, label, panel, show, txt } from '../ui.ts';
import { desktop } from './desktop.ts';
import { refreshHome } from './home.ts';
import { syncLook } from './locker.ts';
import { startRun } from './play.ts';
import { playPreview } from './preview.ts';
import { accountReady, queueSave } from './save.ts';
import { setTab } from './select.ts';
import { audio, game } from './services.ts';
import { closeModal, go, isOpen, onClick, openModal, showToast } from './shell.ts';
import { S, settings } from './state.ts';
import { announceNewUnlocks, unlockedKeys } from './unlocks.ts';
import { markWhatsNewSeen, openWhatsNew, seenVersion } from './whatsnew.ts';

const OFFERED_KEY = 'lineRush.tutorialOffered';
const GRADUATE = TAGS.find(t => t.id === 'graduate')!;
const offered = () => { try { return localStorage.getItem(OFFERED_KEY) === '1'; } catch { return false; } };
const markOffered = () => { try { localStorage.setItem(OFFERED_KEY, '1'); } catch { /* private mode */ } };
const motion = () => !settings().reduceMotion;

/** a greeting with a long name in it gets smaller until it fits on its line (measured, so it needs to be shown) */
function fitName(el: HTMLElement, size: number) {
  const tx = el.querySelector(':scope > .tx') as HTMLElement;
  const fit = () => {
    let s = size;
    el.style.fontSize = `${s}px`;
    while (s > 18 && tx.scrollWidth > tx.clientWidth) {
      s = Math.max(18, Math.min(s - 1, Math.floor((s * tx.clientWidth) / tx.scrollWidth)));
      el.style.fontSize = `${s}px`;
    }
  };
  fit();
  // and again once the font has loaded, if it hadn't yet
  void document.fonts?.ready.then(fit);
}

/** the computer's account name in the app ("Alex"), '' on the website */
let osName = '';
/** who to greet: the account name, else the computer's, else nobody */
const playerName = () => S.account?.username ?? osName;

// ---- building ------------------------------------------------------------------------------------

/** the little playfield on the welcome card: lines fall to two buttons on a loop (all CSS) */
function buildMini(parent: HTMLElement) {
  const mini = frame(parent, 'mini', { x: 32, y: 32, w: 176, h: 376, r: 16, bg: T.bg0, stroke: T.line, clip: true, cls: 'tut-mini' });
  const el = (cls: string, host: HTMLElement = mini) => host.appendChild(Object.assign(document.createElement('div'), { className: cls }));
  // line delays (s) per lane: a short pattern that ends on a gold chord (CSS has the matching button flashes)
  const lines: [number, number[], number[]][] = [[1, [0, 1.2, 4.2], [2.4]], [2, [0.6, 1.8, 3.6], [2.4]]];
  for (const [lane, plain, chord] of lines) {
    const l = el(`ml-lane ml-lane${lane}`);
    const rec = el('ml-rec', l);
    el('ml-glow', rec);
    el('ml-bar', rec);
    el('ml-key', rec);
    for (const [d, cls] of [...plain.map(d => [d, 'ml-line']), ...chord.map(d => [d, 'ml-line chord'])] as [number, string][]) {
      const line = el(cls, l);
      line.style.animationDelay = `${d}s`;
      // where it rests with less motion: spread down the lane in the same order
      line.style.setProperty('--rest', `${Math.round(20 + (d / 4.8) * 230)}px`);
    }
  }
}

export function buildTutorialUI() {
  const overlay = $('overlay');

  // welcome card for first-time players
  const w = panel(overlay, 'welcome', 660, 440);
  buildMini(w);
  label(w, 'kicker', { text: 'NICE TO MEET YOU', font: 'black', size: 11, color: T.cyan, x: 240, y: 44, w: 360, h: 14 });
  label(w, 'hello', { text: 'Welcome to Line Rush,', font: 'black', size: 28, truncate: true, x: 240, y: 64, w: 390, h: 36 });
  label(w, 'name', { text: '', font: 'black', size: 44, truncate: true, x: 238, y: 98, w: 392, h: 54, cls: 'gradtext' });
  label(w, 'about', {
    text: 'Two buttons, real beats. Lines fall down two lanes, and you hit each one as it reaches its button.',
    font: 'med', size: 15, wrap: true, valign: 'top', x: 240, y: 170, w: 380, h: 44,
  });
  label(w, 'offer', {
    text: "A one-minute tutorial shows you everything: taps, chords and holds. It has its own song, and nothing counts against you.",
    font: 'med', size: 14, color: T.muted, wrap: true, valign: 'top', x: 240, y: 228, w: 380, h: 60,
  });
  button(w, 'start', { text: 'START TUTORIAL', size: 24, x: 240, y: 312, w: 222, h: 54, r: 14 }, 'primary');
  button(w, 'skip', { text: 'SKIP FOR NOW', size: 13, x: 474, y: 312, w: 156, h: 54, r: 14 });
  label(w, 'note', { text: 'You can replay it any time from the home screen.', font: 'med', size: 12, color: T.dim, x: 240, y: 380, w: 390, h: 16 });

  // cues on the game screen, over the empty space below the song info
  const card = frame($('game'), 'tut', { x: 40, y: 262, w: 316, h: 212, bg: T.bg1, r: 16, clip: true, hidden: true, cls: 'tut-card' });
  frame(card, 'accent', { x: 0, y: 0, w: 4, h: [1, 0] });
  label(card, 'step', { text: '', font: 'black', size: 10, color: T.muted, x: 22, y: 18, w: 180, h: 14 });
  const dots = frame(card, 'dots', { ax: 1, x: [1, -20], y: 21, w: 96, h: 8, cls: 'tut-dots' });
  STAGES.forEach((_, i) => frame(dots, `d${i}`, { x: i * 15, y: 1, w: 6, h: 6, r: 3 }));
  label(card, 'title', { text: '', font: 'black', size: 22, truncate: true, x: 22, y: 40, w: 280, h: 30 });
  label(card, 'body', { text: '', font: 'med', size: 15, wrap: true, valign: 'top', x: 22, y: 76, w: 280, h: 84, cls: 'tut-body' });
  frame(card, 'pips', { x: 22, y: 176, w: 200, h: 16, cls: 'tut-pips' });
  label(card, 'count', { text: '', font: 'black', size: 13, color: T.muted, align: 'right', ax: 1, x: [1, -20], y: 174, w: 80, h: 20 });
  // the lane being taught glows
  for (const lane of [1, 2]) frame($('game.pf'), `tutspot${lane}`, { x: lane === 1 ? 12 : 176, y: 12, w: 156, h: 576, r: 14, hidden: true, cls: 'tut-spot nopointer' });

  // the tutorial's own end screen
  const e = panel(overlay, 'tutend', 720, 604);
  label(e, 'kicker', { text: 'TUTORIAL COMPLETE', font: 'black', size: 11, color: T.cyan, x: 32, y: 32, w: 300, h: 14 });
  label(e, 'title', { text: '', font: 'black', size: 34, truncate: true, x: 32, y: 50, w: 610, h: 44 });
  label(e, 'sub', { text: '', font: 'med', size: 15, color: T.muted, truncate: true, x: 32, y: 98, w: 656, h: 20 });
  const stats = frame(e, 'stats', { x: 32, y: 136, w: 656, h: 72 });
  ([['hits', 'HITS'], ['accuracy', 'ACCURACY'], ['combo', 'BEST COMBO']] as const).forEach(([nm, text], i) => {
    const box = frame(stats, nm, { x: i * 222, y: 0, w: 212, h: 72, bg: T.bg2, r: 12 });
    label(box, 'value', { text: '-', font: 'black', size: 26, x: 16, y: 10, w: 180, h: 32 });
    label(box, 'label', { text, font: 'black', size: 10, color: T.muted, x: 16, y: 46, w: 180, h: 14 });
  });
  const un = frame(e, 'unlock', { x: 32, y: 222, w: 656, h: 60, bg: T.bg2, r: 12, cls: 'tut-unlock' });
  label(un, 'tag', { text: GRADUATE.label, font: 'black', size: 11, align: 'center', ay: 0.5, x: 16, y: [0.5, 0], w: 100, h: 26, r: 7, cls: 'tut-tag' });
  label(un, 'text', { text: '', font: 'med', size: 14, wrap: true, x: 132, y: 0, w: 360, h: 60 });
  button(un, 'wear', { text: 'WEAR IT', size: 13, ax: 1, ay: 0.5, x: [1, -12], y: [0.5, 0], w: 132, h: 38, r: 10, bg: T.bg1 });
  label(e, 'tipsheader', { text: 'GOOD TO KNOW', font: 'black', size: 10, color: T.muted, x: 32, y: 302, w: 300, h: 14 });
  const tips = frame(e, 'tips', { x: 32, y: 322, w: 656, h: 180 });
  [T.cyan, T.pink, T.gold, T.green].forEach((color, i) => {
    const c = frame(tips, `tip${i + 1}`, { x: (i % 2) * 334, y: Math.floor(i / 2) * 92, w: 322, h: 84, bg: T.bg2, r: 12 });
    const icon = label(c, 'icon', { text: String(i + 1), font: 'black', size: 13, align: 'center', x: 14, y: 14, w: 26, h: 26, r: 8, cls: 'tut-tipicon' });
    icon.style.setProperty('--c', color);
    label(c, 'text', { text: '', font: 'med', size: 13, wrap: true, valign: 'top', x: 52, y: 14, w: 256, h: 62, cls: 'tut-tiptext' });
  });
  button(e, 'home', { text: 'HOME', size: 15, x: 32, y: 524, w: 180, h: 52 });
  button(e, 'play', { text: 'PLAY YOUR FIRST SONG', size: 24, ax: 1, x: 688, y: 524, w: 320, h: 52 }, 'primary');

  // replay any time
  button($('home'), 'tutorial', { text: 'TUTORIAL', size: 10, ay: 1, x: 150, y: [1, -14], w: 92, h: 28, r: 8 });
}

// ---- the song ------------------------------------------------------------------------------------

let track: Track | null = null;
let rendering: Promise<void> | null = null;

/** renders the tutorial's music once (it needs no sound permission, so it can start before any click) */
function prepareAudio(): Promise<void> {
  if (audio.hasBuffer(TUTORIAL_ID)) return Promise.resolve();
  rendering ??= renderRecipe(TUTORIAL_RECIPE, {
    createBuffer: (channels: number, length: number, sampleRate: number) =>
      audio.ctx?.createBuffer(channels, length, sampleRate) ?? new AudioBuffer({ numberOfChannels: channels, length, sampleRate }),
  }).then(buffer => audio.registerBuffer(TUTORIAL_ID, buffer)).finally(() => { rendering = null; });
  return rendering;
}

let starting = false;
export async function startTutorial() {
  if (starting || S.transitioning || game.run) return;
  starting = true;
  markOffered();
  closeModal();
  try {
    if (!audio.hasBuffer(TUTORIAL_ID)) showToast('Getting the tutorial ready...');
    await prepareAudio();
    // the menus keep working while it renders: if they've moved on (a song, another screen or panel), leave them be
    if (!tutorialCanStart({ screen: S.screen, running: !!game.run, transitioning: S.transitioning, panel: !!S.modal })) {
      if (!game.run) showToast('The tutorial is ready. Press TUTORIAL to start it.');
      return;
    }
    track ??= tutorialTrack();
    await startRun(track, 'Easy', false, { tutorial: true, set: TUTORIAL_SET });
  } catch {
    showToast("Couldn't get the tutorial ready. Try again.");
  } finally {
    starting = false;
  }
}

/** QUIT from the pause menu: back home, not marked as done */
export function leaveTutorial() {
  closeModal();
  game.stop();
  void go('home');
  void playPreview(S.previewTrack ?? S.selectedSong.Easy);
  showToast('No problem. Press TUTORIAL any time to try it again.');
}

// ---- cues while it plays -------------------------------------------------------------------------

const chart = tutorialChart();
let current: Run | null = null;
let shown = '';
let pipState = '';

type NoteState = 'hit' | 'miss' | 'holding' | 'wait';
/** how one line of the lesson went (a chord is two notes: both have to be hit) */
function lineState(r: Run, idx: number[]): NoteState {
  const notes = idx.map(i => r.notes[i]).filter(Boolean);
  if (notes.some(n => n.judged && n.removeAt !== undefined)) return 'miss';
  if (notes.some(n => n.holding)) return 'holding';
  return notes.length && notes.every(n => n.judged) ? 'hit' : 'wait';
}

const stageColor = (spot: number) => {
  const s = settings();
  return spot === 3 ? s.chordColor : spot ? s.laneColors[spot - 1] : '';
};

function setCueText(cue: Cue) {
  txt($('game.tut.title'), cue.title);
  const s = settings();
  const body = $('game.tut.body');
  const tx = body.querySelector(':scope > .tx') ?? body;
  tx.replaceChildren(...cue.body.map(part => {
    if (typeof part === 'string') return document.createTextNode(part);
    const key = document.createElement('span');
    key.className = 'tut-key';
    key.textContent = keyName(s.keys[part.key]);
    key.style.setProperty('--k', s.laneColors[part.key]);
    return key;
  }));
}

function setSpot(spot: number) {
  for (const lane of [1, 2] as const) {
    const el = $(`game.pf.tutspot${lane}`);
    const on = spot === lane || spot === 3;
    show(el, on);
    el.classList.toggle('still', !motion());
    if (on) el.style.setProperty('--c', spot === 3 ? settings().chordColor : settings().laneColors[lane - 1]);
  }
}

function showCue(r: Run, stage: number, done: boolean) {
  const card = $('game.tut');
  const s = settings();
  const st = STAGES[stage];
  const last = stage === STAGES.length - 1;
  const accent = $('game.tut.accent');
  const color = st ? stageColor(st.spot) : '';
  accent.style.background = color || `linear-gradient(180deg, ${s.laneColors[0]}, ${s.laneColors[1]})`;
  txt($('game.tut.step'), !st ? 'GET READY' : done && last ? 'TUTORIAL COMPLETE' : `STEP ${stage + 1} OF ${STAGES.length}`);
  STAGES.forEach((_, i) => {
    const d = $(`game.tut.dots.d${i}`);
    d.className = `f ${i < stage || (i === stage && done) ? 'done' : i === stage ? 'on' : ''}`;
    d.style.setProperty('--c', color || s.laneColors[0]);
  });
  const title = $('game.tut.title');
  if (!st) {
    setCueText(INTRO_CUE);
    title.style.color = T.text;
  } else if (!done) {
    // "Gold lines are chords" only if they are gold
    setCueText(st.recolored && s.chordColor.toUpperCase() !== DEFAULT_SETTINGS.chordColor.toUpperCase() ? st.recolored : st);
    title.style.color = T.text;
  } else {
    const lines = chart.groups[stage];
    const hit = lines.filter(idx => lineState(r, idx) === 'hit').length;
    const verdict = stageVerdict(stage, hit, lines.length);
    setCueText(verdict);
    title.style.color = verdict.title === 'Keep going' ? T.text : hit === lines.length ? T.gold : T.green;
  }
  setSpot(st && !done ? st.spot : 0);
  // a fresh set of progress pips for this stage's lines
  const pips = $('game.tut.pips');
  pips.replaceChildren(...(st ? chart.groups[stage] : []).map(idx => {
    const pip = document.createElement('i');
    const note = chart.notes[idx[0]];
    pip.style.setProperty('--c', note.chord ? s.chordColor : s.laneColors[note.lane - 1]);
    return pip;
  }));
  pipState = '';
  show($('game.tut.count'), !!st);
  if (motion()) {
    pop(card, 0.96, 0.3, ease.back);
    card.classList.remove('in');
    void card.offsetWidth; // restart the fade-in
    card.classList.add('in');
  }
}

function updatePips(r: Run, stage: number) {
  const lines = chart.groups[stage];
  const states = lines.map(idx => lineState(r, idx));
  const key = states.join();
  if (key === pipState) return;
  pipState = key;
  const pips = $('game.tut.pips').children;
  states.forEach((st, i) => { if (pips[i]) pips[i].className = st; });
  const hit = states.filter(st => st === 'hit').length;
  const count = $('game.tut.count');
  txt(count, `${hit} / ${lines.length}`);
  count.style.color = hit === lines.length ? T.gold : T.muted;
}

function enterRun(r: Run) {
  current = r;
  shown = '';
  show($('game.tut'), true);
  $('game.tut').classList.toggle('still', !motion());
  const style = $('game.left.style');
  txt(style, "TUTORIAL  ·  CAN'T FAIL");
  style.style.color = T.cyan;
  // you can't fail it, so no health bar draining away
  show($('game.health'), false);
}

function leaveRun() {
  current = null;
  show($('game.tut'), false);
  show($('game.health'), true);
  setSpot(0);
}

function tick() {
  requestAnimationFrame(tick);
  const r = game.run;
  if (!r?.opts?.tutorial || S.screen !== 'game') {
    if (current) leaveRun();
    return;
  }
  if (r !== current) enterRun(r);
  const t = r.ready ? game.songTime(r) - r.offset : -Infinity;
  const { stage, done } = cueAt(t);
  const key = `${stage}:${done}`;
  if (key !== shown) {
    shown = key;
    showCue(r, stage, done);
  }
  if (stage >= 0) updatePips(r, stage);
}

// ---- the end screen ------------------------------------------------------------------------------

function refreshWear() {
  const worn = S.data.profile.tag === GRADUATE.id;
  const b = $('tutend.unlock.wear');
  txt(b, worn ? 'WEARING ✓' : 'WEAR IT');
  b.style.color = worn ? T.gold : T.text;
}

/** the run is over (results.ts sends tutorial runs here): it's done, nothing else from it is saved */
export function finishTutorial(r: Run) {
  const p = S.data.profile;
  const first = !p.tutorialDone;
  const before = unlockedKeys();
  p.tutorialDone = true;
  markOffered();
  queueSave();
  const name = playerName();
  const hits = r.counts[0] + r.counts[1] + r.counts[2];
  txt($('tutend.title'), first ? `You're ready${name ? `, ${name}` : ''}!` : `Nicely done${name ? `, ${name}` : ''}!`);
  txt($('tutend.sub'), tutorialVerdict(hits, r.objects));
  txt($('tutend.stats.hits.value'), `${hits} / ${r.objects}`);
  txt($('tutend.stats.accuracy.value'), `${game.accuracyOf(r).toFixed(1)}%`);
  txt($('tutend.stats.combo.value'), formatNumber(r.maxCombo));
  const tag = $('tutend.unlock.tag');
  tag.style.setProperty('--c', GRADUATE.color);
  txt($('tutend.unlock.text'), first
    ? 'New tag unlocked! It shows next to your name on the leaderboards, in the feed and in 1v1s.'
    : `Your ${GRADUATE.label} tag is waiting in the Locker.`);
  refreshWear();
  const keys = settings().keys;
  const tips = [
    'Songs come in tiers, Easy to Extreme, and each one has a harder “+” chart one tier up.',
    'Tap STYLE on a song for Hardcore or Sudden Death, or add modifiers like Hidden and Mirror for a bigger score.',
    `Press ${keyName(keys[2])} to restart a song instantly, and Esc to pause.`,
    'Make it yours: Settings → Customize for colors and lines, and the Locker in your profile for what you unlock.',
  ];
  tips.forEach((text, i) => txt($(`tutend.tips.tip${i + 1}.text`), text));
  txt($('tutend.play'), first ? 'PLAY YOUR FIRST SONG' : 'PLAY A SONG');
  void go('home', () => {
    openModal($('tutend'));
    fitName($('tutend.title'), 34);
  });
  // the end screen shows off the GRADUATE tag itself: toast anything else this unlocked
  before.add(`tag:${GRADUATE.id}`);
  announceNewUnlocks(before);
  refreshHome();
  void playPreview(S.previewTrack ?? S.selectedSong.Easy);
}

// ---- who sees what at startup --------------------------------------------------------------------

/** a logged-in player's save counts only once the account's own copy has loaded */
const saveKnown = () => !S.account || accountReady();

export function openWelcome() {
  const name = playerName();
  txt($('welcome.hello'), name ? 'Welcome to Line Rush,' : 'Welcome to');
  txt($('welcome.name'), name ? `${name}!` : 'Line Rush!');
  const mini = $('welcome.mini');
  const s = settings();
  mini.style.setProperty('--c1', s.laneColors[0]);
  mini.style.setProperty('--c2', s.laneColors[1]);
  mini.style.setProperty('--cc', s.chordColor);
  mini.querySelectorAll('.ml-key').forEach((k, i) => { k.textContent = keyName(s.keys[i]); });
  mini.classList.toggle('still', !motion());
  markOffered();
  openModal($('welcome'));
  fitName($('welcome.name'), 44);
  // have the song ready by the time they click START
  void prepareAudio().catch(() => {});
}

let waiting: number | undefined;
/** first-timer when startup settled (null until then): they don't get What's New later, even after a song */
let startedNew: boolean | null = null;

/** never over a run, a 1v1 challenge, another panel or a toast ("Welcome back!"), or anywhere but home */
const quiet = () => S.screen === 'home' && !S.modal && !S.transitioning && !game.run && $('challenge').hidden && $('toast').hidden && !starting;

function onboard() {
  if (startedNew === null && !isOpen('auth')) startedNew = saveKnown() && isFirstTimer(S.data.profile);
  if (startedNew === null || !quiet()) return;
  clearInterval(waiting);
  const p = S.data.profile;
  const step = onboardingStep({
    plays: p.plays, tutorialDone: p.tutorialDone, offered: offered(), saveLoaded: saveKnown(),
    seenVersion: seenVersion(), latest: LATEST.version,
  });
  if (step.markSeen || startedNew) markWhatsNewSeen();
  if (step.show === 'welcome') openWelcome();
  else if (step.show === 'whatsnew' && !startedNew) openWhatsNew();
}

/** after startup and the session restore: offer the tutorial to first-timers, show what's new to others */
export function startOnboarding() {
  if (waiting !== undefined) return;
  waiting = window.setInterval(onboard, 400);
}

export function initTutorial() {
  onClick('welcome.start', () => void startTutorial());
  onClick('welcome.skip', () => { closeModal(); showToast("No problem. It's under TUTORIAL whenever you want it."); });
  onClick('welcome.close', closeModal);
  onClick('home.tutorial', () => void startTutorial());
  onClick('tutend.close', closeModal);
  onClick('tutend.home', closeModal);
  onClick('tutend.play', () => {
    closeModal();
    void go('select', () => setTab('Easy', true));
  });
  onClick('tutend.unlock.wear', () => {
    const p = S.data.profile;
    p.tag = p.tag === GRADUATE.id ? '' : GRADUATE.id;
    queueSave();
    refreshWear();
    refreshHome();
    syncLook(0);
  });
  // sits right of the APP / GET THE APP button (narrower in the app)
  const app = $('home.app');
  $('home.tutorial').style.left = `${app.hidden ? 30 : 30 + (parseFloat(app.style.width) || 110) + 10}px`;
  void desktop?.info().then(i => { osName = friendlyName(i.userName); }).catch(() => {});
  requestAnimationFrame(tick);
}
