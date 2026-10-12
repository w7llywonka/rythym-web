// The Locker: everything you can unlock (titles, tags, name colors, line skins, hit effects, themes),
// what you're wearing, and what's NEW. Click an unlocked card to wear it; titles and tags come off with a
// second click. Tags and name colors are sent to the server so they show on boards, the feed and 1v1.
import { describeRule, isUnlocked } from '../../shared/cosmetics.js';
import { api } from '../api.ts';
import { ease, pop } from '../anim.ts';
import { T } from '../config.ts';
import { styleNote } from '../look.ts';
import type { HitEffect, NoteStyle } from '../types.ts';
import { $, button, frame, has, label, node, panel, rgba, show, txt } from '../ui.ts';
import { refreshHome } from './home.ts';
import { LOCKER_TABS, cardState, keysToMarkSeen, lockerCounts, ruleProgress, startTab } from './lockerView.ts';
import { nameplateEl, renderNameplate } from './nameplate.ts';
import { queueSave } from './save.ts';
import { audio } from './services.ts';
import { closeModal, onClick, openModal, setAmbient } from './shell.ts';
import { S, settings } from './state.ts';
import {
  activeHitEffect, activeNoteStyle, activeTheme, allUnlockables, lookForServer, unlockStats, wornNameColor, wornTag,
  type UnlockCategory, type Unlockable,
} from './unlocks.ts';

const W = 880, H = 616;
const TAB_W = 136;
/** your name on the previews */
const myName = () => S.account?.username ?? 'You';

// ---- what the server shows next to your name ---------------------------------------------------
let lookTimer: number | undefined;
/** send what you wear to the server (debounced; it only takes ids it knows, and a failure is ignored) */
export function syncLook(delay = 1500) {
  if (lookTimer) clearTimeout(lookTimer);
  lookTimer = undefined;
  if (!S.account || S.accountsOffline) return;
  lookTimer = window.setTimeout(() => {
    lookTimer = undefined;
    if (S.account) void api.setLook(lookForServer());
  }, delay);
}

// ---- NEW counts on the PROFILE and LOCKER buttons ------------------------------------------------
export function lockerNewCount() {
  return lockerCounts(allUnlockables(), unlockStats(), S.data.profile.seen).all.fresh;
}

export function refreshLockerBadges() {
  const n = lockerNewCount();
  for (const path of ['profile.locker.badge', 'home.profile.badge']) {
    if (!has(path)) continue;
    txt($(path), n > 9 ? '9+' : String(n));
    show($(path), n > 0);
  }
}

// ---- previews --------------------------------------------------------------------------------
const div = (cls: string, text?: string) => {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** falling lines in that skin, in your lane colors (one for the small icon) */
function skinPreview(style: NoteStyle, size = 14, lanes = 2) {
  const box = div('lk-pv-skin');
  const s = settings();
  (lanes === 1 ? [20] : [18, 38]).forEach((y, i) => {
    const lane = div('lk-lane');
    const el = div('note');
    const bar = div('bar');
    el.append(bar);
    styleNote(el, bar, s.laneColors[i], style, size, s.effects);
    el.style.transform = `translate(-50%, -50%) translateY(${y}px)`;
    lane.append(el);
    box.append(lane);
  });
  return box;
}

/** a button's hit line with the effect looping over it */
function effectPreview(id: HitEffect) {
  const box = div(`lk-pv-fx fx-${id.toLowerCase()}`);
  box.style.setProperty('--c', settings().laneColors[0]);
  box.append(div('pad'));
  const parts = id === 'Sparks' ? 6 : id === 'Stars' ? 3 : id === 'None' ? 0 : 1;
  for (let i = 0; i < parts; i++) {
    const p = div(id === 'Stars' ? 'p star' : 'p', id === 'Stars' ? '✦' : undefined);
    p.style.setProperty('--i', String(i));
    box.append(p);
  }
  return box;
}

/** the menu glow in those colors, behind a tiny wordmark */
function themePreview(colors: [string, string]) {
  const box = div('lk-pv-theme');
  box.style.background = `radial-gradient(circle at 20% 25%, ${rgba(colors[0], 0.5)}, transparent 62%), radial-gradient(circle at 85% 85%, ${rgba(colors[1], 0.5)}, transparent 62%), ${T.bg0}`;
  const word = div('lk-word');
  const rush = document.createElement('span');
  rush.textContent = 'RUSH';
  rush.style.backgroundImage = `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`;
  word.append('LINE ', rush);
  box.append(word);
  return box;
}

function preview(u: Unlockable): HTMLElement {
  switch (u.category) {
    case 'title': return div('lk-pv-title', u.label.toUpperCase());
    case 'tag': return nameplateEl(myName(), { tag: u.id, color: lookForServer().color });
    case 'color': return nameplateEl(myName(), { color: u.id });
    case 'skin': return skinPreview(u.id as NoteStyle);
    case 'effect': return effectPreview(u.id as HitEffect);
    case 'theme': return themePreview(u.colors ?? ['#2BD4FF', '#FF5CA8']);
  }
}

const LOCK_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M4.5 7V5.5a3.5 3.5 0 1 1 7 0V7h.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5Zm1.6 0h3.8V5.5a1.9 1.9 0 1 0-3.8 0V7Z"/></svg>';

// ---- the panel ----------------------------------------------------------------------------------
let tab: UnlockCategory = 'title';
let lastTab: UnlockCategory = 'title';
/** keys that were NEW when their tab was opened this visit (they keep the badge until the Locker closes) */
let freshNow = new Set<string>();
let cards = new Map<string, { card: HTMLElement; u: Unlockable }>();

export function buildLockerUI() {
  const lp = panel($('overlay'), 'locker', W, H);
  label(lp, 'title', { text: 'Locker', font: 'black', size: 26, x: 32, y: 24, w: 200, h: 36 });
  label(lp, 'sub', { text: '', font: 'med', size: 13, color: T.muted, x: 32, y: 60, w: 600, h: 18 });
  label(lp, 'count', { html: '', font: 'black', size: 11, color: T.muted, align: 'right', ax: 1, x: 790, y: 30, w: 240, h: 14, cls: 'lk-count' });
  const bar = frame(lp, 'bar', { ax: 1, x: 790, y: 52, w: 240, h: 6, bg: T.bg3, r: 3, clip: true });
  frame(bar, 'fill', { w: [0, 0], h: [1, 0], r: 3, cls: 'lk-barfill' });

  // you, as other players see you, and what you play with (click a slot to jump to its tab)
  const me = frame(lp, 'me', { x: 32, y: 92, w: 816, h: 68, bg: T.bg2, r: 14, cls: 'lk-me' });
  label(me, 'name', { text: '', font: 'black', size: 20, truncate: true, x: 18, y: 10, w: 400, h: 28 });
  label(me, 'title', { text: '', font: 'black', size: 11, color: T.gold, truncate: true, x: 18, y: 42, w: 400, h: 14 });
  ([['skin', 'LINES'], ['effect', 'HITS'], ['theme', 'THEME']] as const).forEach(([cat, text], i) => {
    const slot = button(me, cat, { text: '', x: 424 + i * 130, y: 8, w: 122, h: 52, r: 10, bg: T.bg1, cls: 'lk-slot' });
    label(slot, 'label', { text, font: 'black', size: 9, color: T.dim, x: 12, y: 10, w: 70, h: 12 });
    label(slot, 'value', { text: '', font: 'black', size: 13, truncate: true, x: 12, y: 25, w: 68, h: 18 });
    frame(slot, 'icon', { ax: 1, ay: 0.5, x: [1, -8], y: [0.5, 0], w: 34, h: 40, cls: 'lk-icon nopointer' });
  });

  const tabs = frame(lp, 'tabs', { x: 32, y: 174, w: 816, h: 42, bg: T.bg2, r: 12 });
  frame(tabs, 'highlight', { x: 4, y: 4, w: TAB_W - 8, h: 34, r: 9, cls: 'slide' });
  LOCKER_TABS.forEach((t, i) => {
    const b = node(tabs, t.cat, { tag: 'button', text: t.label, font: 'black', size: 11, align: 'center', color: T.muted, x: i * TAB_W, y: 0, w: TAB_W, h: 42, cls: 'tab' });
    b.classList.add('lk-tab');
  });
  frame(lp, 'grid', { x: 32, y: 230, w: 830, h: 372, scroll: true, cls: 'lk-fade' });

  // a NEW count on the home screen's PROFILE button
  label($('home.profile'), 'badge', { text: '', font: 'black', size: 10, color: T.bg0, align: 'center', ax: 0.5, ay: 0.5, x: [1, -4], y: 4, w: 22, h: 18, bg: T.pink, r: 'full', hidden: true, cls: 'lk-badge' });
}

function equippedKeys(): Set<string> {
  const p = S.data.profile, stats = unlockStats();
  const keys = new Set<string>();
  const title = allUnlockables().find(u => u.category === 'title' && u.id === p.title && isUnlocked(u.unlock, stats));
  if (title) keys.add(title.key);
  const tag = wornTag();
  if (tag) keys.add(`tag:${tag.id}`);
  keys.add(`color:${wornNameColor().id}`);
  keys.add(`skin:${activeNoteStyle()}`);
  keys.add(`effect:${activeHitEffect()}`);
  keys.add(`theme:${activeTheme().id}`);
  return keys;
}

function buildCard(u: Unlockable): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `lk-card lk-${u.category}`;
  const prev = div('lk-prev');
  prev.append(preview(u));
  const lock = div('lk-lock');
  lock.innerHTML = LOCK_SVG; // a fixed icon
  prev.append(lock);
  const state = div('lk-state');
  state.append(div('lk-st'), div('lk-hov'), div('lk-prog'), div('lk-new', 'NEW'));
  (state.children[2] as HTMLElement).append(document.createElement('i'));
  card.append(prev, div('lk-name', u.label), div('lk-desc'), state);
  card.addEventListener('click', e => {
    void audio.unlock();
    if (e.detail > 0) card.blur();
    choose(u, card);
  });
  return card;
}

function paint(card: HTMLElement, u: Unlockable, equipped: boolean, stats = unlockStats()) {
  const unlocked = isUnlocked(u.unlock, stats);
  const state = cardState(unlocked, equipped);
  card.dataset.state = state;
  card.classList.toggle('new', freshNow.has(u.key));
  // titles say what to do ("Clear any song"), the rest what unlocks them until they're yours (name
  // colors and themes always: their own text is the same on every card)
  const desc = card.querySelector('.lk-desc') as HTMLElement;
  const ruleText = u.unlock.kind === 'always' ? 'Free for everyone' : describeRule(u.unlock);
  desc.textContent = u.category === 'title' || (unlocked && u.category !== 'color' && u.category !== 'theme') ? u.desc : ruleText;
  const [st, hov, prog] = Array.from(card.querySelector('.lk-state')!.children) as HTMLElement[];
  const off = u.category === 'title' || u.category === 'tag';
  const progress = unlocked ? null : ruleProgress(u.unlock, stats);
  st.textContent = state === 'equipped' ? '✓ EQUIPPED' : state === 'unlocked' ? 'UNLOCKED' : progress ? `${progress.have} / ${progress.need}` : 'LOCKED';
  hov.textContent = state === 'equipped' ? (off ? 'TAKE OFF' : '✓ EQUIPPED') : state === 'unlocked' ? 'EQUIP' : st.textContent;
  show(prog, !!progress);
  if (progress) (prog.firstChild as HTMLElement).style.width = `${(progress.have / progress.need) * 100}%`;
  card.title = unlocked ? '' : describeRule(u.unlock);
}

/** you, the counter, the tab dots and the NEW badges */
function repaint() {
  const stats = unlockStats();
  const eq = equippedKeys();
  for (const [key, { card, u }] of cards) paint(card, u, eq.has(key), stats);
  const { all, byCat } = lockerCounts(allUnlockables(), stats, S.data.profile.seen);
  $('locker.count').querySelector('.tx')!.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: String(all.unlocked) }), ` / ${all.total} UNLOCKED`);
  $('locker.bar.fill').style.width = `${(all.unlocked / Math.max(1, all.total)) * 100}%`;
  // a pink dot after the label: something new in there
  for (const t of LOCKER_TABS) $(`locker.tabs.${t.cat}`).classList.toggle('has-new', byCat[t.cat].fresh > 0);
  renderMe();
  refreshLockerBadges();
}

function renderMe() {
  const p = S.data.profile;
  renderNameplate($('locker.me.name'), myName(), lookForServer());
  const title = $('locker.me.title');
  txt(title, p.title ? p.title.toUpperCase() : 'NO TITLE');
  title.style.color = p.title ? T.gold : T.dim;
  const skin = activeNoteStyle(), fx = activeHitEffect(), theme = activeTheme();
  txt($('locker.me.skin.value'), skin);
  txt($('locker.me.effect.value'), fx);
  txt($('locker.me.theme.value'), theme.label);
  $('locker.me.skin.icon').replaceChildren(skinPreview(skin, 10, 1));
  $('locker.me.effect.icon').replaceChildren(effectPreview(fx));
  const dot = div('lk-swatch');
  dot.style.background = `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})`;
  $('locker.me.theme.icon').replaceChildren(dot);
}

function showTab(cat: UnlockCategory, instant = false) {
  tab = lastTab = cat;
  const i = LOCKER_TABS.findIndex(t => t.cat === cat);
  const info = LOCKER_TABS[i];
  const hl = $('locker.tabs.highlight');
  if (instant) hl.style.transition = 'none';
  hl.style.left = `${4 + i * TAB_W}px`;
  hl.style.backgroundColor = rgba(info.accent, 0.86);
  hl.style.boxShadow = `0 0 0 1px ${rgba(info.accent, 0.6)}`;
  if (instant) requestAnimationFrame(() => { hl.style.transition = ''; });
  for (const t of LOCKER_TABS) $(`locker.tabs.${t.cat}`).style.color = t.cat === cat ? t.accent : T.muted;
  const effectsOff = cat === 'effect' && !settings().effects;
  const guest = !S.account && !S.accountsOffline;
  txt($('locker.sub'), effectsOff ? 'Effects are off in Settings, so hits show no effect for now.' : (guest && info.guest) || info.hint);

  // what's new on this tab keeps its badge for this visit, and counts as seen from now on
  const p = S.data.profile;
  const marks = keysToMarkSeen(allUnlockables(), cat, unlockStats(), p.seen);
  for (const key of marks) { freshNow.add(key); p.seen[key] = true; }
  if (marks.length) queueSave();

  const grid = $('locker.grid');
  const holder = div('lk-grid');
  holder.style.setProperty('--accent', info.accent);
  cards = new Map();
  for (const u of allUnlockables().filter(x => x.category === cat)) {
    const card = buildCard(u);
    cards.set(u.key, { card, u });
    holder.append(card);
  }
  grid.replaceChildren(holder);
  grid.scrollTop = 0;
  repaint();
}

/** pop + flash on the card and on you, and your hit sound */
function celebrate(card: HTMLElement, cat: UnlockCategory) {
  card.classList.remove('lk-flash');
  void card.offsetWidth;
  card.classList.add('lk-flash');
  const target = cat === 'skin' || cat === 'effect' || cat === 'theme' ? $(`locker.me.${cat}`) : $('locker.me.name');
  pop(target, 0.9, 0.35, ease.back);
  audio.playHit(settings().hitSound);
}

function shake(card: HTMLElement) {
  card.classList.remove('lk-shake');
  void card.offsetWidth;
  card.classList.add('lk-shake');
}

function choose(u: Unlockable, card: HTMLElement) {
  if (!isUnlocked(u.unlock, unlockStats())) return shake(card);
  const p = S.data.profile, s = settings();
  const worn = equippedKeys().has(u.key);
  switch (u.category) {
    case 'title': p.title = worn ? '' : u.id; break;
    case 'tag': p.tag = worn ? '' : u.id; break;
    case 'color': p.nameColor = u.id === 'default' ? '' : u.id; break;
    case 'skin': s.noteStyle = u.id as NoteStyle; break;
    case 'effect': s.hitEffect = u.id as HitEffect; break;
    case 'theme':
      s.theme = u.id;
      if (S.screen === 'home') setAmbient(...activeTheme().colors);
      break;
  }
  queueSave();
  if (u.category === 'title' || u.category === 'tag' || u.category === 'color') syncLook();
  refreshHome();
  repaint();
  if (!worn || u.category === 'title' || u.category === 'tag') celebrate(card, u.category);
}

/** opens on the first tab with something new (else the last one you looked at) */
export function openLocker(cat?: UnlockCategory) {
  freshNow = new Set();
  const { byCat } = lockerCounts(allUnlockables(), unlockStats(), S.data.profile.seen);
  openModal($('locker'));
  showTab(cat ?? startTab(byCat, lastTab), true);
}

export function initLocker() {
  onClick('locker.close', closeModal);
  for (const t of LOCKER_TABS) onClick(`locker.tabs.${t.cat}`, () => { if (tab !== t.cat) showTab(t.cat); });
  for (const cat of ['skin', 'effect', 'theme'] as const) onClick(`locker.me.${cat}`, () => { if (tab !== cat) showTab(cat); });
}
