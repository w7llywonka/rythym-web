// Builds the whole interface as a 1100x640 "stage" that is scaled to fit the window, using the same
// positions, sizes, colors and type as the Roblox version. Elements are looked up by dotted path: $('home.play').
import { HIT_EFFECTS, THEMES } from '../shared/cosmetics.js';
import { ACHIEVEMENTS, MOD_INFO, MOD_ORDER, STYLE_CARDS, STYLE_ORDER, SWATCHES, T, TAB_ORDER } from './config.ts';

type UD = number | [number, number]; // pixels, or [scale, pixels] like Roblox's UDim
export interface Opts {
  x?: UD; y?: UD; w?: UD; h?: UD; ax?: number; ay?: number;
  bg?: string; bgT?: number; grad?: string; r?: number | 'full'; stroke?: string; strokeW?: number; strokeT?: number;
  text?: string; html?: string; size?: number; font?: 'black' | 'bold' | 'med'; color?: string; textT?: number;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'center'; wrap?: boolean; truncate?: boolean;
  clip?: boolean; z?: number; hidden?: boolean; cls?: string; tag?: 'div' | 'button' | 'input'; scroll?: boolean;
}

const registry = new Map<string, HTMLElement>();

export function $(path: string): HTMLElement {
  const el = registry.get(path);
  if (!el) throw new Error(`UI element not found: ${path}`);
  return el;
}
export const has = (path: string) => registry.has(path);

const ud = (v: UD) => (typeof v === 'number' ? `${v}px` : v[0] === 0 ? `${v[1]}px` : v[1] === 0 ? `${v[0] * 100}%` : `calc(${v[0] * 100}% + ${v[1]}px)`);

export function rgba(hex: string, transparency = 0): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${(1 - transparency).toFixed(3)})`;
}

export function node(parent: HTMLElement, name: string, o: Opts = {}): HTMLElement {
  const el = document.createElement(o.tag ?? 'div');
  el.className = 'f' + (o.cls ? ' ' + o.cls : '');
  const s = el.style;
  if (o.x !== undefined) s.left = ud(o.x);
  if (o.y !== undefined) s.top = ud(o.y);
  if (o.w !== undefined) s.width = ud(o.w);
  if (o.h !== undefined) s.height = ud(o.h);
  if (o.ax || o.ay) s.setProperty('--ax', `${-(o.ax ?? 0) * 100}%`), s.setProperty('--ay', `${-(o.ay ?? 0) * 100}%`);
  if (o.bg) s.backgroundColor = rgba(o.bg, o.bgT ?? 0);
  if (o.grad) s.backgroundImage = o.grad;
  if (o.r !== undefined) s.borderRadius = o.r === 'full' ? '9999px' : `${o.r}px`;
  if (o.stroke) s.boxShadow = `0 0 0 ${o.strokeW ?? 1}px ${rgba(o.stroke, o.strokeT ?? 0)}`;
  if (o.clip) s.overflow = 'hidden';
  if (o.scroll) el.classList.add('scroll');
  if (o.z !== undefined) s.zIndex = String(o.z);
  if (o.hidden) el.hidden = true;
  if (o.text !== undefined || o.html !== undefined) {
    el.classList.add('t', `a-${o.align ?? 'left'}`, `v-${o.valign ?? 'center'}`);
    if (o.wrap) el.classList.add('wrap');
    if (o.truncate) el.classList.add('trunc');
    const size = o.size ?? 18;
    s.fontSize = `${size}px`;
    s.fontWeight = o.font === 'black' ? (size >= 40 ? '800' : '700') : o.font === 'med' ? '500' : '600';
    // ALL-CAPS labels get tracking; big display type gets tightened
    const caps = !!o.text && /[A-Z]/.test(o.text) && !/[a-z]/.test(o.text);
    if (size >= 40) s.letterSpacing = '-0.035em';
    else if (caps) s.letterSpacing = size <= 14 ? '0.08em' : size <= 20 ? '0.05em' : '0.02em';
    else if (size >= 22) s.letterSpacing = '-0.02em';
    s.color = rgba(o.color ?? T.text, o.textT ?? 0);
    const span = document.createElement('span');
    span.className = 'tx';
    if (o.html !== undefined) span.innerHTML = o.html; else span.textContent = o.text ?? '';
    el.appendChild(span);
  }
  if (o.tag === 'button') (el as HTMLButtonElement).type = 'button';
  const parentPath = parent.dataset.path;
  const path = parentPath ? `${parentPath}.${name}` : name;
  el.dataset.path = path;
  registry.set(path, el);
  parent.appendChild(el);
  return el;
}

/** set plain text on a label made by node() */
export function txt(el: HTMLElement, text: string) {
  const span = el.querySelector(':scope > .tx') as HTMLElement | null;
  if (span) { if (span.textContent !== text) span.textContent = text; } else el.textContent = text;
}
export function html(el: HTMLElement, markup: string) {
  const span = el.querySelector(':scope > .tx') as HTMLElement | null;
  (span ?? el).innerHTML = markup;
}
export const show = (el: HTMLElement, on: boolean) => { el.hidden = !on; };

// label / frame / button / toggle / stepper / panel are exported so a feature can build its own panel
// in its own module (after buildUI): panel($('overlay'), 'locker', 720, 600)
export const label = (p: HTMLElement, name: string, o: Opts) => node(p, name, o);
export const frame = (p: HTMLElement, name: string, o: Opts) => node(p, name, o);
export function button(p: HTMLElement, name: string, o: Opts, style: 'primary' | 'secondary' = 'secondary') {
  // one restrained button scale: big calls to action 17px, everything else 15px or smaller
  const size = (o.size ?? 15) >= 24 ? 17 : Math.min(o.size ?? 15, 15);
  const b = node(p, name, {
    font: 'black', align: 'center', r: 12, ...o, size, tag: 'button',
    ...(style === 'primary'
      ? { bg: T.text, color: T.bg0 }
      : { bg: o.bg, stroke: o.stroke ?? T.line, color: o.color ?? T.text }),
  });
  b.classList.add('btn', style);
  return b;
}

export function toggle(p: HTMLElement, w = 52, h = 28) {
  const t = node(p, 'toggle', { tag: 'button', ax: 1, ay: 0.5, x: [1, -14], y: [0.5, 0], w: w - 8, h: h - 4, bg: T.bg3, r: 'full', cls: 'toggle' });
  h -= 4;
  frame(t, 'knob', { ay: 0.5, x: 3, y: [0.5, 0], w: h - 6, h: h - 6, bg: '#FFFFFF', r: 'full', cls: 'knob' });
  return t;
}

export function stepper(row: HTMLElement, prefix: string, rightOffset: number, valueWidth: number, size = 40, valueSize = 15) {
  button(row, prefix + 'minus', { text: '−', size: 16, ax: 1, ay: 0.5, x: [1, -(rightOffset + valueWidth + 8 + size)], y: [0.5, 0], w: size, h: size, r: 10, bg: T.bg1 });
  label(row, prefix + 'value', { text: '-', font: 'black', size: valueSize, align: 'center', ax: 1, ay: 0.5, x: [1, -(rightOffset + size + 4)], y: [0.5, 0], w: valueWidth, h: 40 });
  button(row, prefix + 'plus', { text: '+', size: 16, ax: 1, ay: 0.5, x: [1, -rightOffset], y: [0.5, 0], w: size, h: size, r: 10, bg: T.bg1 });
}

export function panel(parent: HTMLElement, name: string, w: number, h: number) {
  const p = frame(parent, name, { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w, h, bg: T.bg1, r: 20, stroke: T.line, hidden: true, cls: 'panel pop' });
  button(p, 'close', { text: '✕', size: 14, ax: 1, x: w - 24, y: 24, w: 36, h: 36, r: 10, color: T.muted, cls: 'iconbtn' });
  return p;
}

export function buildUI(app: HTMLElement) {
  app.innerHTML = '';
  app.dataset.path = '';
  const backdrop = frame(app, 'backdrop', { cls: 'fill backdrop', bg: '#000000' });
  frame(backdrop, 'glowa', { cls: 'glow glowa' });
  frame(backdrop, 'glowb', { cls: 'glow glowb' });
  const root = frame(app, 'root', { cls: 'stage' });
  root.dataset.path = ''; // screens are addressed directly: 'home.play', 'select.list', ...

  // HOME ---------------------------------------------------------------
  const home = frame(root, 'home', { cls: 'fill' });
  frame(home, 'logoglow', { ax: 0.5, x: [0.5, 0], y: 52, w: 900, h: 250, cls: 'logoglow' });
  const logo = frame(home, 'logo', { ax: 0.5, x: [0.5, 0], y: 92, w: 700, h: 170, cls: 'pop' });
  label(logo, 'line', { text: 'LINE', font: 'black', size: 116, align: 'right', w: 330, h: 140 });
  label(logo, 'rush', { text: 'RUSH', font: 'black', size: 116, x: 352, w: 360, h: 140, cls: 'gradtext' });
  label(home, 'tagline', { text: "Two buttons. Real beats. Don't miss.", font: 'med', size: 17, color: T.muted, align: 'center', ax: 0.5, x: [0.5, 0], y: 268, w: 700, h: 26 });
  button(home, 'play', { text: 'PLAY', size: 30, ax: 0.5, x: [0.5, 0], y: 350, w: 300, h: 64, r: 16 }, 'primary');
  button(home, 'settings', { text: 'SETTINGS', size: 13, ax: 0.5, x: [0.5, 0], y: 426, w: 300, h: 50, r: 14 });
  label(home, 'howto', { html: '', font: 'med', size: 14, color: T.muted, align: 'center', wrap: true, ax: 0.5, x: [0.5, 0], y: 492, w: 340, h: 40 });
  button(home, 'credits', { text: 'CREDITS', size: 10, ax: 1, ay: 1, x: [1, -30], y: [1, -14], w: 84, h: 28, r: 8 });
  // the desktop app's panel (APP), or a download link on the website (GET THE APP)
  button(home, 'app', { text: 'GET THE APP', size: 10, ay: 1, x: 30, y: [1, -14], w: 110, h: 28, r: 8, hidden: true });
  label(home, 'nowplaying', { html: '', font: 'med', size: 14, color: T.dim, align: 'center', ax: 0.5, ay: 1, x: [0.5, 0], y: [1, -18], w: 800, h: 20 });
  const chip = frame(home, 'chip', { x: 30, y: 24, w: 300, h: 64, r: 14 });
  label(chip, 'name', { text: 'Player', font: 'black', size: 16, truncate: true, x: 14, y: 8, w: 180, h: 20 });
  label(chip, 'level', { text: 'LV 1', font: 'black', size: 14, color: T.gold, align: 'right', ax: 1, x: [1, -14], y: 8, w: 90, h: 20 });
  const xp = frame(chip, 'xp', { x: 14, y: 35, w: 272, h: 4, bg: T.bg3, r: 2, clip: true });
  frame(xp, 'fill', { w: [0, 0], h: [1, 0], r: 2, bg: T.gold });
  label(chip, 'streak', { text: '', size: 11, color: T.muted, x: 14, y: 44, w: 272, h: 14, truncate: true });
  button(home, 'versus', { text: '1V1', size: 13, ax: 1, x: 930, y: 24, w: 90, h: 44 });
  button(home, 'profile', { text: 'PROFILE', size: 13, ax: 1, x: 1070, y: 24, w: 130, h: 44 });

  const weekly = frame(home, 'weekly', { x: 40, y: 340, w: 320, h: 236, r: 16, stroke: T.line });
  label(weekly, 'header', { text: 'WEEKLY CHALLENGE', font: 'black', size: 11, color: T.gold, x: 16, y: 14, w: 200, h: 14 });
  label(weekly, 'ends', { text: '', size: 11, color: T.muted, align: 'right', ax: 1, x: [1, -16], y: 14, w: 120, h: 14 });
  label(weekly, 'song', { text: '-', font: 'black', size: 20, truncate: true, x: 16, y: 36, w: 288, h: 26 });
  label(weekly, 'mods', { text: '', size: 12, color: T.muted, x: 16, y: 64, w: 288, h: 16 });
  label(weekly, 'kinglabel', { text: 'KING OF THE HILL', font: 'black', size: 9, color: T.dim, x: 16, y: 92, w: 200, h: 12 });
  button(weekly, 'board', { text: 'TOP 10 →', size: 10, ax: 1, x: [1, -16], y: 86, w: 76, h: 24, r: 8, bg: T.bg2 });
  label(weekly, 'king', { text: 'Nobody yet. Claim it!', size: 14, truncate: true, x: 16, y: 106, w: 288, h: 18 });
  label(weekly, 'mine', { text: '', font: 'med', size: 12, color: T.muted, x: 16, y: 128, w: 288, h: 16 });
  button(weekly, 'play', { text: 'PLAY WEEKLY', size: 13, x: 16, y: 172, w: 288, h: 46, color: T.gold });

  const feed = frame(home, 'feed', { x: 740, y: 340, w: 320, h: 236, r: 16, stroke: T.line });
  label(feed, 'header', { text: 'LIVE FEED', font: 'black', size: 11, color: T.muted, x: 16, y: 14, w: 200, h: 14 });
  frame(feed, 'dot', { x: 96, y: 18, w: 6, h: 6, bg: T.red, r: 'full', cls: 'livedot' });
  for (let i = 1; i <= 6; i++) {
    label(feed, `line${i}`, { html: '', font: 'med', size: 12, wrap: true, valign: 'top', x: 16, y: 36 + (i - 1) * 32, w: 288, h: 30 });
  }

  // SONG SELECT ---------------------------------------------------------
  const select = frame(root, 'select', { cls: 'fill', hidden: true });
  button(select, 'back', { text: '← BACK', size: 13, x: 30, y: 28, w: 110, h: 44 });
  label(select, 'title', { text: 'Select a song', font: 'black', size: 28, x: 158, y: 28, w: 400, h: 44 });
  label(select, 'hint', { text: '', font: 'med', size: 13, color: T.muted, x: 400, y: 28, w: 380, h: 44 });
  button(select, 'settings', { text: 'SETTINGS', size: 13, ax: 1, x: 1070, y: 28, w: 130, h: 44 });
  button(select, 'import', { text: '+ IMPORT', size: 13, ax: 1, x: 930, y: 28, w: 110, h: 44 });
  const tabs = frame(select, 'tabs', { x: 30, y: 92, w: 558, h: 46, r: 12 });
  frame(tabs, 'highlight', { x: 6, y: 4, w: 106, h: 38, r: 9, cls: 'slide' });
  TAB_ORDER.forEach((tab, i) => {
    node(tabs, tab.toLowerCase(), { tag: 'button', text: tab.toUpperCase(), font: 'black', size: 12, align: 'center', color: T.muted, x: 4 + i * 110, y: 0, w: 110, h: 46, cls: 'tab' });
  });
  frame(select, 'list', { x: 30, y: 152, w: 570, h: 462, scroll: true });
  label(select, 'empty', { text: '', size: 18, color: T.muted, align: 'center', wrap: true, x: 30, y: 250, w: 570, h: 80, hidden: true });

  const detail = frame(select, 'detail', { x: 630, y: 92, w: 440, h: 522, bg: T.bg1, r: 20, stroke: T.line, cls: 'detail-glow' });
  const cover = frame(detail, 'cover', { x: 20, y: 20, w: 400, h: 100, r: 14 });
  label(cover, 'genre', { text: 'GENRE', font: 'black', size: 13, textT: 0.15, x: 18, y: 14, w: 300, h: 16 });
  const pill = frame(cover, 'pill', { x: 18, y: 36, w: 86, h: 24, bg: T.bg0, bgT: 0.35, r: 12 });
  label(pill, 'text', { text: 'EASY', font: 'black', size: 12, align: 'center', w: [1, 0], h: [1, 0] });
  label(cover, 'bpmlabel', { text: 'BPM', font: 'black', size: 14, textT: 0.25, x: 18, y: 72, w: 100, h: 18 });
  label(cover, 'bpm', { text: '120', font: 'black', size: 60, textT: 0.1, align: 'right', ax: 1, ay: 1, x: [1, -18], y: [1, -4], w: 260, h: 70 });
  label(detail, 'title', { text: 'Song', font: 'black', size: 28, truncate: true, x: 20, y: 132, w: 400, h: 34 });
  label(detail, 'artist', { text: 'Artist', font: 'med', size: 15, color: T.muted, x: 20, y: 166, w: 400, h: 20 });
  label(detail, 'pack', { text: '', font: 'black', size: 11, color: T.muted, align: 'right', x: 20, y: 168, w: 400, h: 16 });
  const stats = frame(detail, 'stats', { x: 20, y: 194, w: 400, h: 56 });
  ['bpm', 'length', 'notes', 'level'].forEach((nm, i) => {
    const box = frame(stats, nm, { x: i * 103, y: 0, w: 91, h: 56, r: 10, bg: T.bg2 });
    label(box, 'value', { text: '-', font: 'black', size: 19, align: 'center', x: 0, y: 9, w: 91, h: 24 });
    label(box, 'label', { text: nm.toUpperCase(), size: 10, color: T.muted, align: 'center', x: 0, y: 33, w: 91, h: 14 });
  });
  // imports: halve / double the tempo when the beatmapper counted it the wrong way
  button(stats, 'half', { text: '½×', size: 10, x: 7, y: 33, w: 37, h: 17, r: 6, bg: T.bg1, hidden: true });
  button(stats, 'double', { text: '2×', size: 10, x: 47, y: 33, w: 37, h: 17, r: 6, bg: T.bg1, hidden: true });
  const chartRow = frame(detail, 'chartrow', { x: 20, y: 262, w: 400, h: 40 });
  button(chartRow, 'base', { text: 'EASY', size: 14, x: 0, y: 0, w: 196, h: 40, r: 10 });
  button(chartRow, 'plus', { text: 'HARD +', size: 14, x: 204, y: 0, w: 196, h: 40, r: 10 });
  const best = frame(detail, 'best', { x: 20, y: 312, w: 400, h: 84, r: 12, stroke: T.line });
  label(best, 'header', { text: 'PERSONAL BEST', font: 'black', size: 10, color: T.muted, x: 16, y: 10, w: 200, h: 14 });
  button(best, 'top', { text: 'TOP 10 →', size: 10, x: 130, y: 6, w: 80, h: 22, r: 8, bg: T.bg1 });
  button(best, 'remove', { text: 'REMOVE IMPORT', size: 10, x: 130, y: 6, w: 110, h: 22, r: 8, bg: T.bg1, color: T.red, hidden: true });
  label(best, 'score', { text: '-', font: 'black', size: 26, x: 16, y: 26, w: 260, h: 30 });
  label(best, 'info', { text: '', font: 'med', size: 14, color: T.muted, x: 16, y: 58, w: 270, h: 18 });
  label(best, 'grade', { text: '-', font: 'black', size: 46, color: T.dim, align: 'right', ax: 1, x: [1, -18], y: 6, w: 100, h: 52 });
  const fc = frame(best, 'fc', { ax: 1, x: [1, -16], y: 58, w: 98, h: 18, bg: T.gold, r: 10, hidden: true });
  label(fc, 'text', { text: 'FULL COMBO', font: 'black', size: 11, color: T.bg0, align: 'center', w: [1, 0], h: [1, 0] });
  const sb = button(detail, 'style', { text: '', x: 20, y: 406, w: 400, h: 40, r: 10 });
  label(sb, 'label', { text: 'STYLE', font: 'black', size: 10, color: T.muted, x: 16, y: 0, w: 60, h: 40 });
  label(sb, 'value', { text: 'CLASSIC', font: 'black', size: 13, truncate: true, x: 70, y: 0, w: 230, h: 40 });
  label(sb, 'mult', { text: 'x1.00  >', font: 'black', size: 13, color: T.gold, align: 'right', ax: 1, x: [1, -16], y: 0, w: 100, h: 40 });
  button(detail, 'play', { text: 'PLAY', size: 26, x: 20, y: 456, w: 400, h: 50, r: 16 }, 'primary');

  // GAME ---------------------------------------------------------------
  const game = frame(root, 'game', { cls: 'fill', hidden: true });
  const pf = frame(game, 'pf', { ax: 0.5, x: [0.5, 0], y: 20, w: 344, h: 600, bg: T.bg1, r: 20, cls: 'pf' });
  frame(pf, 'pulse', { cls: 'fill pfpulse', r: 20 });
  for (const i of [1, 2]) {
    const color = i === 1 ? T.cyan : T.pink;
    const lane = frame(pf, `lane${i}`, { x: i === 1 ? 12 : 176, y: 12, w: 156, h: 576, r: 14, clip: true, cls: 'lane' });
    frame(lane, 'beam', { cls: 'fill beam', grad: `linear-gradient(180deg, ${rgba(color, 1)} 0%, ${rgba(color, 0.85)} 55%, ${rgba(color, 0)} 100%)` }).style.opacity = '0';
    // lit while the key is held down
    frame(lane, 'held', { cls: 'fill beam heldbeam', grad: `linear-gradient(180deg, ${rgba(color, 1)} 0%, ${rgba(color, 0.9)} 60%, ${rgba(color, 0.6)} 100%)` });
    // the button: a tinted pad with one glowing hit line through its middle
    const rec = node(lane, 'rec', { tag: 'button', ax: 0.5, ay: 1, x: [0.5, 0], y: [1, -14], w: 132, h: 104, bg: color, bgT: 0.94, r: 18, stroke: color, strokeW: 1.5, strokeT: 0.45, cls: 'rec pop' });
    frame(rec, 'glow', { cls: 'fill', bg: color, r: 18 }).style.opacity = '0';
    frame(rec, 'heldglow', { cls: 'fill heldglow', bg: color, r: 18 });
    frame(rec, 'target', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [1, -28], h: 3, bg: color, r: 2, cls: 'target' });
    label(rec, 'key', { text: i === 1 ? 'F' : 'J', font: 'black', size: 15, color: T.text, textT: 0.25, align: 'center', ax: 0.5, ay: 1, x: [0.5, 0], y: [1, -12], w: [1, -20], h: 20 });
    label(rec, 'name', { text: `BUTTON ${i}`, size: 10, color: T.muted, align: 'center', ax: 0.5, x: [0.5, 0], y: 12, w: [1, 0], h: 14, hidden: true });
    // hit zone: where Good / Great / Perfect count (sized per run from the timing windows), drawn over the button
    const zone = frame(lane, 'zone', { cls: 'fill nopointer', z: 3 });
    for (const nm of ['good', 'great', 'perfect']) {
      frame(zone, nm, { ax: 0.5, ay: 0.5, x: [0.5, 0], y: 510, w: 120, h: 0, bg: color, r: 10, cls: `zoneband ${nm}` });
    }
    frame(zone, 'line', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: 510, w: 104, h: 1, bg: '#FFFFFF', cls: 'hitline' });
    frame(lane, 'notes', { cls: 'fill nopointer', z: 4 });
  }
  frame(pf, 'flashlight', { cls: 'fill', hidden: true, grad: 'linear-gradient(180deg, #000 0%, #000 50%, rgba(0,0,0,0) 72%)', r: 20 });
  frame(pf, 'effects', { cls: 'fill nopointer' });
  const combo = frame(pf, 'combo', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.3, 0], w: 300, h: 110, cls: 'pop nopointer' });
  label(combo, 'value', { text: '', font: 'black', size: 72, textT: 0.55, align: 'center', w: 300, h: 80 });
  label(combo, 'label', { text: 'COMBO', font: 'black', size: 14, textT: 0.6, align: 'center', x: 0, y: 78, w: 300, h: 18, hidden: true });
  label(pf, 'judgment', { text: '', font: 'black', size: 38, align: 'center', ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.58, 0], w: 320, h: 46, cls: 'pop nopointer stroked' });
  label(pf, 'timing', { text: '', size: 14, align: 'center', ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.58, 30], w: 320, h: 18, cls: 'nopointer' });
  label(pf, 'countdown', { text: '', font: 'black', size: 110, align: 'center', ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.42, 0], w: 340, h: 130, cls: 'pop nopointer stroked' });

  const health = frame(game, 'health', { x: 738, y: 20, w: 6, h: 600, bg: T.bg2, r: 3, clip: true });
  frame(health, 'fill', { ay: 1, x: 0, y: [1, 0], w: [1, 0], h: [1, 0], bg: T.green, r: 3, cls: 'anchor-bottom' });

  const left = frame(game, 'left', { x: 40, y: 20, w: 330, h: 600 });
  button(left, 'pause', { text: '❚❚', size: 11, x: 0, y: 10, w: 48, h: 48 });
  label(left, 'title', { text: 'Song', font: 'black', size: 26, truncate: true, x: 0, y: 86, w: 320, h: 32 });
  label(left, 'artist', { text: 'Artist', font: 'med', size: 15, color: T.muted, x: 0, y: 118, w: 320, h: 20 });
  const dp = frame(left, 'pill', { x: 0, y: 148, w: 86, h: 24, bg: T.green, r: 8 });
  label(dp, 'text', { text: 'EASY', font: 'black', size: 11, color: T.bg0, align: 'center', w: [1, 0], h: [1, 0] });
  label(left, 'style', { text: '', font: 'black', size: 11, color: T.muted, truncate: true, x: 98, y: 148, w: 230, h: 24 });
  const prog = frame(left, 'progress', { x: 0, y: 192, w: 300, h: 4, bg: T.bg2, r: 2, clip: true });
  frame(prog, 'fill', { w: [1, 0], h: [1, 0], r: 2, bg: T.text, cls: 'scalex' });
  label(left, 'time', { text: '0:00 / 0:00', size: 13, color: T.muted, x: 0, y: 204, w: 300, h: 16 });
  const vs = frame(left, 'versus', { x: 0, y: 240, w: 320, h: 150, bg: T.bg1, r: 14, stroke: T.line, hidden: true });
  label(vs, 'label', { text: 'VS', font: 'black', size: 12, color: T.pink, x: 14, y: 10, w: 40, h: 14 });
  label(vs, 'opponent', { text: 'Opponent', font: 'black', size: 16, truncate: true, x: 14, y: 26, w: 190, h: 20 });
  label(vs, 'lead', { text: '', font: 'black', size: 11, align: 'right', ax: 1, x: [1, -14], y: 10, w: 140, h: 14 });
  label(vs, 'score', { text: '0', font: 'black', size: 26, x: 14, y: 50, w: 200, h: 30 });
  label(vs, 'combo', { text: '', font: 'bold', size: 12, color: T.muted, align: 'right', ax: 1, x: [1, -14], y: 58, w: 120, h: 16 });
  const vh = frame(vs, 'health', { x: 14, y: 88, w: 292, h: 4, bg: T.bg3, r: 2, clip: true });
  frame(vh, 'fill', { w: [1, 0], h: [1, 0], bg: T.green, r: 2 });
  label(vs, 'reactions', { text: '1 🔥   2 😂   3 😤   4 GG', font: 'bold', size: 11, color: T.dim, x: 14, y: 102, w: 292, h: 16 });
  label(vs, 'sent', { text: '', font: 'bold', size: 12, color: T.muted, x: 14, y: 122, w: 292, h: 16 });
  label(vs, 'bubble', { text: '', font: 'black', size: 30, align: 'center', ay: 0.5, x: [1, 12], y: [0.35, 0], w: 90, h: 44, cls: 'pop' });

  const right = frame(game, 'right', { x: 770, y: 20, w: 290, h: 600 });
  label(right, 'score', { text: '0', font: 'black', size: 46, align: 'right', x: 0, y: 10, w: 290, h: 52 });
  label(right, 'accuracy', { text: '100.00%', font: 'black', size: 22, color: T.muted, align: 'right', x: 0, y: 62, w: 290, h: 28 });
  const mult = frame(right, 'mult', { ax: 1, x: 290, y: 100, w: 52, h: 24, bg: T.bg2, r: 8, stroke: T.line });
  label(mult, 'text', { text: 'x1', font: 'black', size: 12, align: 'center', w: [1, 0], h: [1, 0] });
  const counts = frame(right, 'counts', { x: 110, y: 150, w: 180, h: 120 });
  [['perfect', T.gold], ['great', T.cyan], ['good', T.green], ['miss', T.red]].forEach(([nm, color], i) => {
    const row = frame(counts, nm, { x: 0, y: i * 28, w: 180, h: 24 });
    label(row, 'name', { text: nm.toUpperCase(), font: 'black', size: 11, color, w: 100, h: 24 });
    label(row, 'value', { text: '0', font: 'black', size: 15, align: 'right', w: 180, h: 24 });
  });
  const meter = frame(right, 'timing', { x: 110, y: 278, w: 180, h: 52 });
  label(meter, 'label', { text: 'TIMING', font: 'black', size: 10, color: T.muted, w: 100, h: 14 });
  label(meter, 'avg', { text: '', size: 11, color: T.muted, align: 'right', w: 180, h: 14 });
  const bar = frame(meter, 'bar', { x: 0, y: 20, w: 180, h: 12, bg: T.bg2, r: 6, clip: true });
  frame(bar, 'good', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [1, 0], h: [0.5, 0], bg: T.green, bgT: 0.7 });
  frame(bar, 'great', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [0.6, 0], h: [0.5, 0], bg: T.cyan, bgT: 0.6 });
  frame(bar, 'perfect', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [0.3, 0], h: [0.5, 0], bg: T.gold, bgT: 0.45 });
  frame(bar, 'center', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: 2, h: [1, 0], bg: '#FFFFFF' });
  frame(bar, 'ticks', { cls: 'fill' });
  label(meter, 'legend', { text: 'EARLY                              LATE', size: 9, color: T.dim, x: 0, y: 38, w: 180, h: 12, cls: 'pre' });
  const sideCombo = frame(right, 'sidecombo', { x: 40, y: 350, w: 250, h: 76, cls: 'pop' });
  label(sideCombo, 'label', { text: 'COMBO', font: 'black', size: 12, color: T.muted, align: 'right', w: 250, h: 14, hidden: true });
  label(sideCombo, 'value', { text: '', font: 'black', size: 52, align: 'right', x: 0, y: 14, w: 250, h: 58 });
  label(right, 'sidejudgment', { text: '', font: 'black', size: 30, align: 'right', x: 40, y: 436, w: 250, h: 36, cls: 'pop' });
  label(right, 'sidetiming', { text: '', size: 13, align: 'right', x: 40, y: 472, w: 250, h: 18 });

  // RESULTS ------------------------------------------------------------
  const results = frame(root, 'results', { cls: 'fill', hidden: true });
  const rp = frame(results, 'panel', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: 860, h: 610, bg: T.bg1, r: 24, stroke: T.line, cls: 'pop panel' });
  label(rp, 'versus', { html: '', font: 'black', size: 22, align: 'center', wrap: true, x: 40, y: 30, w: 300, h: 50 });
  const gc = frame(rp, 'circle', { ax: 0.5, ay: 0.5, x: 190, y: 200, w: 230, h: 230, bg: T.bg2, r: 'full', stroke: T.gold, strokeW: 3, cls: 'pop' });
  label(gc, 'grade', { text: 'S', font: 'black', size: 150, align: 'center', w: [1, 0], h: [1, 0] });
  label(rp, 'status', { text: 'CLEARED', font: 'black', size: 18, align: 'center', x: 40, y: 344, w: 300, h: 30 });
  const nb = frame(rp, 'newbest', { ax: 0.5, x: 190, y: 380, w: 130, h: 26, bg: T.gold, r: 8, hidden: true });
  label(nb, 'text', { text: 'NEW BEST!', font: 'black', size: 12, color: T.bg0, align: 'center', w: [1, 0], h: [1, 0] });
  label(rp, 'avg', { text: '', size: 13, color: T.muted, align: 'center', wrap: true, x: 40, y: 414, w: 300, h: 34 });
  label(rp, 'title', { text: 'Song', font: 'black', size: 28, truncate: true, x: 380, y: 34, w: 440, h: 36 });
  label(rp, 'info', { text: '', size: 14, color: T.muted, truncate: true, x: 380, y: 72, w: 440, h: 18 });
  label(rp, 'scorelabel', { text: 'SCORE', font: 'black', size: 10, color: T.muted, x: 380, y: 110, w: 200, h: 14 });
  label(rp, 'xp', { text: '', font: 'black', size: 14, color: T.gold, align: 'right', ax: 1, x: 820, y: 110, w: 300, h: 16 });
  label(rp, 'score', { text: '0', font: 'black', size: 54, x: 378, y: 124, w: 440, h: 60 });
  label(rp, 'rank', { text: '', font: 'black', size: 12, color: T.cyan, align: 'right', ax: 1, x: 820, y: 154, w: 300, h: 16 });
  ['accuracy', 'maxcombo'].forEach((nm, i) => {
    const box = frame(rp, nm, { x: 380 + i * 226, y: 196, w: 214, h: 70, r: 12, bg: T.bg2 });
    label(box, 'label', { text: nm === 'maxcombo' ? 'MAX COMBO' : 'ACCURACY', font: 'black', size: 10, color: T.muted, x: 16, y: 12, w: 180, h: 14 });
    label(box, 'value', { text: '-', font: 'black', size: 28, x: 16, y: 28, w: 190, h: 32 });
  });
  const bd = frame(rp, 'breakdown', { x: 380, y: 284, w: 440, h: 120 });
  [['perfect', T.gold], ['great', T.cyan], ['good', T.green], ['miss', T.red]].forEach(([nm, color], i) => {
    const row = frame(bd, nm, { x: 0, y: i * 30, w: 440, h: 24 });
    label(row, 'name', { text: nm.toUpperCase(), font: 'black', size: 11, color, w: 90, h: 24 });
    const b = frame(row, 'bar', { x: 96, y: 10, w: 270, h: 4, bg: T.bg2, r: 2, clip: true });
    frame(b, 'fill', { w: [0, 0], h: [1, 0], bg: color, r: 2, cls: 'grow' });
    label(row, 'value', { text: '0', font: 'black', size: 16, align: 'right', w: 440, h: 24 });
  });
  const graph = frame(rp, 'graph', { x: 40, y: 458, w: 780, h: 66, r: 12, stroke: T.line, clip: true });
  label(graph, 'label', { text: 'HEALTH', font: 'black', size: 9, color: T.dim, x: 10, y: 4, w: 100, h: 12 });
  frame(graph, 'bars', { x: 8, y: 6, w: [1, -16], h: [1, -10] });
  button(rp, 'retry', { text: 'RETRY', size: 18, x: 380, y: 538, w: 200, h: 56 });
  button(rp, 'continue', { text: 'CONTINUE', size: 20, x: 596, y: 538, w: 224, h: 56 }, 'primary');

  // OVERLAY ------------------------------------------------------------
  frame(app, 'dimmer', { cls: 'fill dimmer', bg: '#000000', hidden: true });
  const overlay = frame(app, 'overlay', { cls: 'stage nopointer-self' });
  overlay.dataset.path = ''; // panels are addressed directly: 'settings', 'pause.resume', ...

  const pause = panel(overlay, 'pause', 400, 340);
  $('pause.close').hidden = true;
  label(pause, 'title', { text: 'Paused', font: 'black', size: 30, align: 'center', x: 0, y: 30, w: 400, h: 40 });
  button(pause, 'resume', { text: 'RESUME', size: 20, x: 40, y: 96, w: 320, h: 58 }, 'primary');
  button(pause, 'restart', { text: 'RESTART', size: 16, x: 40, y: 170, w: 320, h: 50 });
  button(pause, 'quit', { text: 'QUIT TO SONGS', size: 16, x: 40, y: 234, w: 320, h: 50 });

  // settings: four tabs (controls, audio, visuals, HUD), then customize / reset
  buildSettingsPanel(overlay);

  // customize: lane / chord colors, line style (every skin, locked ones too) and thickness, with a live preview
  buildCustomPanel(overlay);

  // style
  const sp = panel(overlay, 'style', 700, 600);
  label(sp, 'title', { text: 'Play style', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(sp, 'h1', { text: 'STYLE', font: 'black', size: 10, color: T.muted, x: 32, y: 84, w: 300, h: 14 });
  const styles = frame(sp, 'styles', { x: 32, y: 104, w: 636, h: 132 });
  STYLE_ORDER.forEach((name, i) => {
    const [title, desc] = STYLE_CARDS[name];
    const c = button(styles, name.toLowerCase(), { text: '', x: i * 129, y: 0, w: 120, h: 132, r: 14 });
    label(c, 'name', { text: title, font: 'black', size: 13, x: 12, y: 12, w: 100, h: 18 });
    label(c, 'desc', { text: desc, font: 'med', size: 11, color: T.muted, wrap: true, valign: 'top', x: 12, y: 36, w: 98, h: 64 });
    label(c, 'mult', { text: 'x1.00', font: 'black', size: 13, color: T.gold, x: 12, y: 106, w: 100, h: 16 });
  });
  label(sp, 'h2', { text: 'MODIFIERS', font: 'black', size: 10, color: T.muted, x: 32, y: 250, w: 300, h: 14 });
  const speed = frame(sp, 'speed', { x: 32, y: 270, w: 636, h: 52, bg: T.bg2, r: 12 });
  label(speed, 'label', { text: 'Song speed', size: 16, x: 16, y: 6, w: 300, h: 20 });
  label(speed, 'hint', { text: 'Faster = harder (higher pitch). Slower = practice.', font: 'med', size: 11, color: T.muted, x: 16, y: 28, w: 360, h: 14 });
  stepper(speed, '', 10, 84);
  const prac = frame(sp, 'practice', { x: 32, y: 330, w: 636, h: 52, bg: T.bg2, r: 12 });
  label(prac, 'label', { text: 'Practice section', size: 16, x: 16, y: 6, w: 240, h: 20 });
  label(prac, 'hint', { text: 'Used by the Practice style', font: 'med', size: 11, color: T.muted, x: 16, y: 28, w: 240, h: 14 });
  stepper(prac, 'to', 10, 84);
  stepper(prac, 'from', 190, 84);
  const mods = frame(sp, 'mods', { x: 32, y: 390, w: 636, h: 112 });
  MOD_ORDER.forEach((name, i) => {
    const m = frame(mods, name.toLowerCase(), { x: (i % 4) * 162, y: Math.floor(i / 4) * 60, w: 150, h: 52, bg: T.bg2, r: 12 });
    label(m, 'label', { text: name, size: 14, x: 12, y: 7, w: 90, h: 18 });
    label(m, 'hint', { text: MOD_INFO[name].hint, font: 'med', size: 10, color: T.muted, wrap: true, valign: 'top', x: 12, y: 27, w: 86, h: 22 });
    toggle(m, 42, 24);
  });
  const footer = frame(sp, 'footer', { x: 32, y: 516, w: 636, h: 64, bg: T.bg2, r: 14 });
  label(footer, 'label', { text: 'SCORE MULTIPLIER', font: 'black', size: 11, color: T.muted, x: 18, y: 10, w: 200, h: 14 });
  label(footer, 'value', { text: 'x1.00', font: 'black', size: 24, color: T.gold, x: 18, y: 26, w: 120, h: 28 });
  label(footer, 'note', { text: '', font: 'med', size: 13, color: T.red, x: 140, y: 26, w: 280, h: 28 });
  button(footer, 'done', { text: 'DONE', size: 18, ax: 1, ay: 0.5, x: [1, -10], y: [0.5, 0], w: 170, h: 46 }, 'primary');

  // calibration
  const cal = panel(overlay, 'calib', 540, 470);
  label(cal, 'title', { text: 'Calibrate', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(cal, 'info', { text: 'Press START, then tap any lane key (or the circle) on every beat you HEAR. Close your eyes if it helps.', font: 'med', size: 14, color: T.muted, wrap: true, valign: 'top', x: 32, y: 80, w: 476, h: 44 });
  const pad = button(cal, 'pad', { text: '', ax: 0.5, ay: 0.5, x: 270, y: 226, w: 150, h: 150, r: 'full', stroke: T.cyan, strokeW: 2 });
  pad.classList.add('pop');
  label(pad, 'count', { text: '0 / 20', font: 'black', size: 26, align: 'center', w: [1, 0], h: [1, 0] });
  label(cal, 'result', { html: '', size: 16, align: 'center', wrap: true, x: 32, y: 316, w: 476, h: 50 });
  button(cal, 'start', { text: 'START', size: 18, x: 32, y: 382, w: 230, h: 56 }, 'primary');
  button(cal, 'apply', { text: 'APPLY', size: 18, x: 278, y: 382, w: 230, h: 56 });

  // leaderboard
  const bp = panel(overlay, 'board', 560, 590);
  label(bp, 'title', { text: 'Leaderboard', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 34 });
  label(bp, 'sub', { text: '', size: 14, color: T.muted, x: 32, y: 62, w: 420, h: 18 });
  const bl = frame(bp, 'list', { x: 32, y: 96, w: 496, h: 410 });
  for (let i = 1; i <= 10; i++) {
    const row = frame(bl, `row${i}`, { x: 0, y: (i - 1) * 41, w: 496, h: 36, bg: T.bg2, r: 8, hidden: true });
    label(row, 'rank', { text: `#${i}`, font: 'black', size: 15, color: i === 1 ? T.gold : i <= 3 ? T.cyan : T.muted, x: 12, w: 44, h: 36 });
    label(row, 'player', { text: '-', size: 15, truncate: true, x: 60, w: 260, h: 36 });
    label(row, 'score', { text: '', font: 'black', size: 15, align: 'right', ax: 1, x: [1, -12], w: 160, h: 36 });
  }
  label(bp, 'status', { text: '', font: 'med', size: 14, color: T.muted, align: 'center', wrap: true, x: 32, y: 230, w: 496, h: 40 });
  const me = frame(bp, 'me', { x: 32, y: 516, w: 496, h: 48, bg: T.bg2, r: 12, stroke: T.line });
  label(me, 'label', { text: 'YOUR BEST', font: 'black', size: 12, color: T.muted, x: 14, w: 100, h: 48 });
  label(me, 'score', { text: '-', font: 'black', size: 18, align: 'right', ax: 1, x: [1, -14], w: 300, h: 48 });

  // profile: your nameplate (tag + name color) and title, stats, the Locker, achievements
  const pp = panel(overlay, 'profile', 720, 600);
  label(pp, 'title', { text: 'Profile', font: 'black', size: 26, x: 32, y: 26, w: 160, h: 36 });
  const lb = button(pp, 'locker', { text: 'LOCKER', size: 13, ax: 1, x: 500, y: 28, w: 120, h: 40 });
  label(lb, 'badge', { text: '', font: 'black', size: 10, color: T.bg0, align: 'center', ax: 0.5, ay: 0.5, x: [1, -4], y: 4, w: 22, h: 18, bg: T.pink, r: 'full', hidden: true, cls: 'lk-badge' });
  button(pp, 'account', { text: 'ACCOUNT', size: 13, ax: 1, x: 620, y: 28, w: 110, h: 40 });
  const card = frame(pp, 'me', { x: 32, y: 82, w: 656, h: 72, bg: T.bg2, r: 14, cls: 'lk-me' });
  label(card, 'name', { text: '', font: 'black', size: 24, truncate: true, x: 18, y: 10, w: 380, h: 32 });
  label(card, 'title', { text: '', font: 'black', size: 11, color: T.gold, truncate: true, x: 18, y: 46, w: 380, h: 14 });
  label(card, 'since', { text: '', font: 'med', size: 12, color: T.muted, align: 'right', ax: 1, x: [1, -18], y: 16, w: 240, h: 16 });
  label(card, 'more', { text: '', font: 'med', size: 12, color: T.muted, align: 'right', ax: 1, x: [1, -18], y: 40, w: 240, h: 16 });
  const pst = frame(pp, 'stats', { x: 32, y: 166, w: 656, h: 58 });
  ([['level', 'LEVEL'], ['plays', 'PLAYS'], ['noteshit', 'NOTES HIT'], ['fullcombos', 'FULL COMBOS'], ['ssranks', 'SS RANKS'], ['playtime', 'PLAY TIME']] as const).forEach(([nm, title], i) => {
    const box = frame(pst, nm, { x: i * 110, y: 0, w: 106, h: 58, bg: T.bg2, r: 12 });
    label(box, 'value', { text: '0', font: 'black', size: 19, x: 12, y: 8, w: 88, h: 24 });
    label(box, 'label', { text: title, size: 9, color: T.muted, x: 12, y: 36, w: 92, h: 12 });
  });
  label(pp, 'achheader', { text: 'ACHIEVEMENTS', font: 'black', size: 10, color: T.muted, x: 32, y: 240, w: 300, h: 14 });
  label(pp, 'achhint', { text: 'Click an unlocked one to wear its title', font: 'med', size: 12, color: T.dim, align: 'right', ax: 1, x: 688, y: 240, w: 340, h: 14 });
  // all of them, scrolling
  const grid = frame(pp, 'achievements', { x: 32, y: 262, w: 666, h: 322, scroll: true, cls: 'lk-fade' });
  ACHIEVEMENTS.forEach((_, i) => {
    const a = button(grid, `ach${i + 1}`, { text: '', x: 1 + (i % 4) * 166, y: 1 + Math.floor(i / 4) * 110, w: 155, h: 100, r: 12 });
    label(a, 'name', { text: '?', font: 'black', size: 13, truncate: true, x: 12, y: 10, w: 131, h: 18 });
    label(a, 'desc', { text: '', font: 'med', size: 11, color: T.muted, wrap: true, valign: 'top', x: 12, y: 30, w: 131, h: 44, cls: 'lk-lines' });
    label(a, 'state', { text: 'LOCKED', font: 'black', size: 10, color: T.dim, truncate: true, x: 12, y: 78, w: 131, h: 14 });
  });
  // room below the last row, so it clears the fade at the bottom
  frame(grid, 'end', { x: 0, y: 1 + Math.ceil(ACHIEVEMENTS.length / 4) * 110, w: 1, h: 24 });

  // 1v1 lobby
  const vp = panel(overlay, 'versus', 560, 540);
  label(vp, 'title', { text: '1v1 battle', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(vp, 'info', { text: "Challenge someone who's online right now. You both play the same chart at the same moment. Highest score wins.", font: 'med', size: 13, color: T.muted, wrap: true, valign: 'top', x: 32, y: 72, w: 496, h: 36 });
  const songRow = frame(vp, 'song', { x: 32, y: 118, w: 496, h: 56, bg: T.bg2, r: 12 });
  label(songRow, 'label', { text: 'SONG', font: 'black', size: 11, color: T.muted, x: 16, w: 60, h: 56 });
  label(songRow, 'value', { text: '-', font: 'black', size: 16, truncate: true, x: 70, w: 300, h: 56 });
  label(songRow, 'hint', { text: 'pick it in Song Select', font: 'med', size: 11, color: T.dim, align: 'right', ax: 1, x: [1, -16], w: 140, h: 56 });
  label(vp, 'listheader', { text: 'PLAYERS ONLINE', font: 'black', size: 10, color: T.muted, x: 32, y: 190, w: 300, h: 14 });
  frame(vp, 'list', { x: 32, y: 210, w: 496, h: 268, scroll: true });
  label(vp, 'status', { text: '', font: 'med', size: 14, color: T.muted, align: 'center', wrap: true, x: 32, y: 486, w: 496, h: 36 });
  button(vp, 'login', { text: 'LOG IN TO BATTLE', size: 14, ax: 0.5, x: [0.5, 0], y: 330, w: 240, h: 48, hidden: true }, 'primary');

  // incoming challenge: slides in at the top, doesn't block the screen
  const ch = frame(overlay, 'challenge', { ax: 0.5, x: [0.5, 0], y: 20, w: 440, h: 122, bg: T.bg1, r: 16, stroke: T.pink, strokeT: 0.4, hidden: true, z: 50, cls: 'panel' });
  label(ch, 'title', { text: 'CHALLENGE!', font: 'black', size: 11, color: T.pink, x: 18, y: 14, w: 200, h: 14 });
  label(ch, 'timer', { text: '', font: 'bold', size: 11, color: T.dim, align: 'right', ax: 1, x: [1, -18], y: 14, w: 80, h: 14 });
  label(ch, 'text', { html: '', font: 'med', size: 14, wrap: true, valign: 'top', x: 18, y: 34, w: 404, h: 36 });
  button(ch, 'accept', { text: 'ACCEPT', size: 13, x: 18, y: 74, w: 196, h: 36, r: 10 }, 'primary');
  button(ch, 'decline', { text: 'DECLINE', size: 13, x: 226, y: 74, w: 196, h: 36, r: 10 });

  // credits for licensed music
  const cr = panel(overlay, 'credits', 620, 560);
  label(cr, 'title', { text: 'Credits', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(cr, 'sub', { text: 'Songs by other artists, used under their licenses. Thank you!', font: 'med', size: 13, color: T.muted, x: 32, y: 62, w: 520, h: 18 });
  frame(cr, 'list', { x: 32, y: 96, w: 556, h: 432, scroll: true });

  // account (login / sign up / manage)
  buildAccountPanels(overlay, app);
  buildAppPanel(overlay);

  // z: above every panel, including ones features add after buildUI
  label(overlay, 'toast', { text: '', size: 15, align: 'center', ax: 0.5, ay: 1, x: [0.5, 0], y: [1, -24], w: 500, h: 40, bg: T.bg3, bgT: 0.05, r: 20, hidden: true, cls: 'toast', z: 100 });
  frame(app, 'fader', { cls: 'fill fader nopointer', bg: '#000000' });
}

function buildAccountPanels(overlay: HTMLElement, _app: HTMLElement) {
  const input = (p: HTMLElement, name: string, y: number, placeholder: string, type: string, autocomplete: string) => {
    const el = node(p, name, { tag: 'input', x: 40, y, w: 400, h: 52, bg: T.bg2, r: 12, stroke: T.line, cls: 'input' }) as HTMLInputElement;
    el.type = type;
    el.placeholder = placeholder;
    el.autocomplete = autocomplete as AutoFill;
    el.spellcheck = false;
    el.maxLength = type === 'password' ? 128 : 20;
    return el;
  };
  const auth = frame(overlay, 'auth', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: 480, h: 560, bg: T.bg1, r: 20, stroke: T.line, hidden: true, cls: 'panel pop' });
  const form = node(auth, 'form', { cls: 'fill', tag: 'div' });
  label(form, 'logo', { html: 'LINE <span class="gradtext">RUSH</span>', font: 'black', size: 40, align: 'center', x: 0, y: 34, w: 480, h: 54 });
  label(form, 'sub', { text: 'Log in to save your progress', font: 'med', size: 15, color: T.muted, align: 'center', x: 0, y: 92, w: 480, h: 20 });
  const tabs = frame(form, 'tabs', { x: 40, y: 134, w: 400, h: 44, bg: T.bg2, r: 12 });
  frame(tabs, 'highlight', { x: 4, y: 4, w: 196, h: 36, r: 9, bg: T.text, cls: 'slide' });
  node(tabs, 'login', { tag: 'button', text: 'LOG IN', font: 'black', size: 12, align: 'center', x: 0, y: 0, w: 200, h: 44, color: T.bg0, cls: 'tab' });
  node(tabs, 'signup', { tag: 'button', text: 'SIGN UP', font: 'black', size: 12, align: 'center', x: 200, y: 0, w: 200, h: 44, color: T.muted, cls: 'tab' });
  label(form, 'ulabel', { text: 'USERNAME', font: 'black', size: 10, color: T.muted, x: 40, y: 196, w: 200, h: 14 });
  input(form, 'username', 214, '3-20 letters, numbers or _', 'text', 'username');
  label(form, 'plabel', { text: 'PASSWORD', font: 'black', size: 10, color: T.muted, x: 40, y: 278, w: 200, h: 14 });
  input(form, 'password', 296, 'At least 10 characters', 'password', 'current-password');
  label(form, 'clabel', { text: 'CONFIRM PASSWORD', font: 'black', size: 10, color: T.muted, x: 40, y: 360, w: 200, h: 14, hidden: true });
  input(form, 'confirm', 378, 'Type it again', 'password', 'new-password').hidden = true;
  label(form, 'error', { text: '', font: 'med', size: 13, color: T.red, align: 'center', wrap: true, x: 40, y: 360, w: 400, h: 36 });
  button(form, 'submit', { text: 'LOG IN', size: 18, x: 40, y: 404, w: 400, h: 56 }, 'primary');
  button(form, 'guest', { text: 'PLAY AS GUEST', size: 13, x: 40, y: 474, w: 400, h: 44 });
  label(form, 'note', { text: 'Guest progress stays in this browser only.', font: 'med', size: 11, color: T.dim, align: 'center', x: 40, y: 524, w: 400, h: 16 });

  const acct = panel(overlay, 'account', 520, 560);
  label(acct, 'title', { text: 'Account', font: 'black', size: 26, x: 32, y: 26, w: 300, h: 36 });
  label(acct, 'user', { text: '', font: 'black', size: 18, color: T.text, x: 32, y: 72, w: 440, h: 22 });
  label(acct, 'since', { text: '', font: 'med', size: 12, color: T.muted, x: 32, y: 96, w: 440, h: 16 });
  label(acct, 'sync', { text: '', font: 'med', size: 12, color: T.muted, x: 32, y: 114, w: 440, h: 16 });
  label(acct, 'h1', { text: 'CHANGE PASSWORD', font: 'black', size: 10, color: T.muted, x: 32, y: 146, w: 300, h: 14 });
  const ai = (name: string, y: number, ph: string, ac: string) => {
    const el = node(acct, name, { tag: 'input', x: 32, y, w: 456, h: 46, bg: T.bg2, r: 12, stroke: T.line, cls: 'input' }) as HTMLInputElement;
    el.type = 'password'; el.placeholder = ph; el.autocomplete = ac as AutoFill; el.maxLength = 128;
    return el;
  };
  ai('current', 166, 'Current password', 'current-password');
  ai('next', 220, 'New password (10+ characters)', 'new-password');
  ai('confirm', 274, 'Confirm new password', 'new-password');
  label(acct, 'msg', { text: '', font: 'med', size: 13, color: T.muted, align: 'center', wrap: true, x: 32, y: 324, w: 456, h: 32 });
  button(acct, 'change', { text: 'UPDATE PASSWORD', size: 15, x: 32, y: 360, w: 456, h: 48 }, 'primary');
  button(acct, 'logout', { text: 'LOG OUT', size: 15, x: 32, y: 420, w: 220, h: 48 });
  button(acct, 'logoutall', { text: 'LOG OUT EVERYWHERE', size: 12, x: 268, y: 420, w: 220, h: 48 });
  button(acct, 'delete', { text: 'DELETE ACCOUNT', size: 12, x: 32, y: 482, w: 456, h: 44, color: T.red, bg: T.bg1, stroke: T.line });
}

/** the desktop app's own settings: fullscreen, frame rate, Discord, server, Songs folder, updates */
function buildAppPanel(overlay: HTMLElement) {
  const ap = panel(overlay, 'app', 580, 600);
  label(ap, 'title', { text: 'App', font: 'black', size: 26, x: 32, y: 26, w: 300, h: 36 });
  label(ap, 'sub', { text: 'Extras you only get in the Line Rush app.', font: 'med', size: 13, color: T.muted, x: 32, y: 62, w: 480, h: 18 });
  const header = (name: string, text: string, y: number) =>
    label(ap, name, { text, font: 'black', size: 10, color: T.muted, x: 32, y, w: 300, h: 14 });
  const row = (name: string, y: number, text: string, hint: string, withToggle = true) => {
    const r = frame(ap, name, { x: 32, y, w: 516, h: 60, bg: T.bg2, r: 12 });
    label(r, 'label', { text, size: 16, x: 18, y: 10, w: 400, h: 20 });
    label(r, 'hint', { text: hint, font: 'med', size: 12, color: T.muted, x: 18, y: 32, w: 420, h: 16 });
    if (withToggle) toggle(r, 52, 28);
    return r;
  };
  header('h1', 'DISPLAY', 96);
  row('fullscreen', 116, 'Fullscreen', 'F11 or Alt+Enter. Escape still pauses the song.');
  row('fps', 184, 'Unlocked frame rate', 'Turns off V-Sync for less input lag. Restarts the app.');
  header('h2', 'ONLINE', 260);
  row('discord', 280, 'Discord status', "Shows the song you're playing on your Discord profile.");
  const server = frame(ap, 'server', { x: 32, y: 348, w: 516, h: 52, bg: T.bg2, r: 12 });
  const input = node(server, 'input', { tag: 'input', x: 6, y: 6, w: 400, h: 40, bg: T.bg1, r: 9, cls: 'input' }) as HTMLInputElement;
  input.placeholder = 'Server address (https://...)';
  input.spellcheck = false;
  input.maxLength = 200;
  button(server, 'save', { text: 'SAVE', size: 13, ax: 1, x: [1, -6], y: 6, w: 98, h: 40, r: 9, bg: T.bg1 });
  label(ap, 'servermsg', { text: '', font: 'med', size: 12, color: T.muted, x: 34, y: 406, w: 512, h: 16, truncate: true });
  header('h3', 'SONGS & SCREENSHOTS', 438);
  button(ap, 'songs', { text: 'OPEN SONGS FOLDER', size: 13, x: 32, y: 458, w: 252, h: 46 });
  button(ap, 'shots', { text: 'SCREENSHOTS  (F12)', size: 13, x: 296, y: 458, w: 252, h: 46 });
  label(ap, 'songsnote', { text: 'Audio files (or folders of them) in the Songs folder are added when you open song select.', font: 'med', size: 12, color: T.muted, wrap: true, x: 32, y: 512, w: 516, h: 18 });
  label(ap, 'version', { text: '', font: 'med', size: 12, color: T.dim, x: 32, y: 556, w: 280, h: 20 });
  button(ap, 'check', { text: 'CHECK FOR UPDATES', size: 12, ax: 1, x: 548, y: 548, w: 220, h: 36, r: 10, hidden: true });
  button(ap, 'update', { text: 'RESTART TO UPDATE', size: 12, ax: 1, x: 548, y: 548, w: 220, h: 36, r: 10, hidden: true }, 'primary');
}

/**
 * Settings: tabs over four pages (settings.controls / .audio / .visuals / .hud), each 596x390 at y 138,
 * then CUSTOMIZE COLORS & LINES and RESET DEFAULTS. src/app/settingsPanel.ts fills them in.
 */
function buildSettingsPanel(overlay: HTMLElement) {
  const st = panel(overlay, 'settings', 660, 610);
  label(st, 'title', { text: 'Settings', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  const tabs = frame(st, 'tabs', { x: 32, y: 78, w: 596, h: 44, bg: T.bg2, r: 12 });
  frame(tabs, 'highlight', { x: 4, y: 4, w: 141, h: 36, r: 9, cls: 'slide' });
  ['controls', 'audio', 'visuals', 'hud'].forEach((id, i) => {
    node(tabs, id, { tag: 'button', text: id.toUpperCase(), font: 'black', size: 12, align: 'center', color: T.muted, x: i * 149, y: 0, w: 149, h: 44, cls: 'tab' });
  });
  const page = (name: string) => frame(st, name, { x: 32, y: 138, w: 596, h: 390, hidden: true });
  // a row: a name, and a hint under it when there is one
  const row = (p: HTMLElement, name: string, x: number, y: number, w: number, h: number, text: string, hint?: string, textW = w - 36) => {
    const r = frame(p, name, { x, y, w, h, bg: T.bg2, r: 12 });
    label(r, 'label', { text, size: hint === undefined ? 15 : 16, x: 18, y: hint === undefined ? 0 : 11, w: textW, h: hint === undefined ? h : 20 });
    if (hint !== undefined) label(r, 'hint', { text: hint, font: 'med', size: 12, color: T.muted, truncate: true, x: 18, y: 33, w: textW, h: 16 });
    return r;
  };
  const bigRow = (p: HTMLElement, name: string, y: number, text: string, hint: string) => {
    const r = row(p, name, 0, y, 596, 62, text, hint, 200);
    button(r, 'minus', { text: '-', size: 22, ax: 1, ay: 0.5, x: [1, -176], y: [0.5, 0], w: 44, h: 42, r: 10, bg: T.bg1 });
    label(r, 'value', { text: '-', font: 'black', size: 18, align: 'center', ax: 1, ay: 0.5, x: [1, -62], y: [0.5, 0], w: 110, h: 42 });
    button(r, 'plus', { text: '+', size: 22, ax: 1, ay: 0.5, x: [1, -12], y: [0.5, 0], w: 44, h: 42, r: 10, bg: T.bg1 });
    return r;
  };
  const togRow = (p: HTMLElement, name: string, x: number, y: number, w: number, text: string, hint: string) => {
    const r = row(p, name, x, y, w, 62, text, hint, w - 96);
    toggle(r, 52, 28);
    return r;
  };

  // CONTROLS: key binds, scroll speed, audio offset, and the keys worth knowing
  const ctl = page('controls');
  [T.cyan, T.pink, T.text].forEach((color, i) => {
    const r = frame(ctl, `key${i + 1}`, { x: i * 202, y: 0, w: 192, h: 60, bg: T.bg2, r: 12 });
    frame(r, 'dot', { ay: 0.5, x: 16, y: [0.5, 0], w: 12, h: 12, bg: color, r: 'full' });
    label(r, 'label', { text: ['Button 1', 'Button 2', 'Restart'][i], size: 15, x: 34, y: 0, w: 80, h: 60 });
    button(r, 'btn', { text: 'F', size: 14, ax: 1, ay: 0.5, x: [1, -10], y: [0.5, 0], w: 80, h: 40, r: 10, bg: T.bg1, stroke: i < 2 ? color : T.line });
  });
  label(ctl, 'keystatus', { text: 'Click a key, then press the new key.', font: 'med', size: 13, color: T.muted, x: 2, y: 68, w: 594, h: 18 });
  bigRow(ctl, 'scroll', 98, 'Scroll speed', 'How fast lines fall');
  const off = bigRow(ctl, 'offset', 170, 'Audio offset', 'Late? lower it. Early? raise it.');
  button(off, 'calibrate', { text: 'CALIBRATE', size: 13, x: 232, y: 10, w: 120, h: 42, r: 10, bg: T.bg1 });
  const tips = frame(ctl, 'tips', { x: 0, y: 254, w: 596, h: 92, r: 12, stroke: T.line });
  label(tips, 'header', { text: 'GOOD TO KNOW', font: 'black', size: 10, color: T.muted, x: 18, y: 14, w: 300, h: 14 });
  label(tips, 'text', { html: '', font: 'med', size: 13, color: T.muted, wrap: true, valign: 'top', x: 18, y: 34, w: 560, h: 50 });

  // AUDIO
  const au = page('audio');
  bigRow(au, 'volume', 0, 'Music volume', 'Songs and the menu music');
  bigRow(au, 'hitsound', 72, 'Hit sound', 'Plays on every press');
  bigRow(au, 'hitvolume', 144, 'Hit sound volume', 'Separate from the music');
  togRow(au, 'menumusic', 0, 216, 596, 'Menu music', 'Song previews play behind the menus');
  const atips = frame(au, 'tips', { x: 0, y: 300, w: 596, h: 76, r: 12, stroke: T.line });
  label(atips, 'header', { text: 'HITS FEEL LATE?', font: 'black', size: 10, color: T.muted, x: 18, y: 14, w: 300, h: 14 });
  label(atips, 'text', { text: 'Wireless headphones and some speakers add a delay. Tap along once and the game will match it.', font: 'med', size: 13, color: T.muted, wrap: true, valign: 'top', x: 18, y: 32, w: 400, h: 36 });
  button(atips, 'calibrate', { text: 'CALIBRATE', size: 13, ax: 1, ay: 0.5, x: [1, -16], y: [0.5, 0], w: 120, h: 42, r: 10, bg: T.bg2 });

  // VISUALS: effects, hit zone, lane dim, motion, then the hit effect and menu theme pickers
  const vis = page('visuals');
  togRow(vis, 'effects', 0, 0, 293, 'Effects', 'Glows, beams and hit effects');
  togRow(vis, 'hitzone', 303, 0, 293, 'Hit zone', 'Where Perfect and Good count');
  const dim = row(vis, 'lanedim', 0, 72, 293, 62, 'Lane dim', 'Darker lanes', 110);
  stepper(dim, '', 10, 56, 34, 14);
  togRow(vis, 'motion', 303, 72, 293, 'Reduce motion', 'Fewer pops and pulses');
  const fx = row(vis, 'hiteffect', 0, 144, 596, 126, 'Hit effect', '', 390);
  HIT_EFFECTS.forEach((e, i) => {
    node(fx, `fx${i}`, { tag: 'button', text: e.label, font: 'bold', size: 12, align: 'center', x: 18 + (i % 3) * 132, y: 56 + Math.floor(i / 3) * 34, w: 124, h: 28, r: 8, cls: 'schip' });
  });
  // a line falls onto a button and hits it, over and over, in the effect you're looking at
  const fxp = frame(fx, 'preview', { x: 424, y: 12, w: 160, h: 102, bg: T.bg0, r: 10, stroke: T.line, clip: true });
  frame(fxp, 'lane', { ax: 0.5, x: [0.5, 0], y: 0, w: 78, h: 102, cls: 'lane nopointer' });
  frame(fxp, 'line', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: 80, w: 60, h: 3, r: 2, bg: T.cyan });
  frame(fxp, 'layer', { cls: 'fill nopointer' });
  const th = row(vis, 'theme', 0, 280, 596, 104, 'Menu theme', '', 560);
  THEMES.forEach((t, i) => {
    node(th, `th${i}`, { tag: 'button', text: t.label, font: 'bold', size: 11, align: 'center', x: 18 + i * 80, y: 58, w: 74, h: 32, r: 9, cls: 'schip theme' });
  });

  // HUD: judgments, timing, timing bar, combo position, FPS, and a preview of all of it
  const hud = page('hud');
  const jr = row(hud, 'judge', 0, 0, 596, 62, 'Judgments', 'PERFECT, GREAT, GOOD and MISS on each hit', 280);
  const seg = frame(jr, 'seg', { ax: 1, ay: 0.5, x: [1, -12], y: [0.5, 0], w: 276, h: 42, bg: T.bg1, r: 10 });
  frame(seg, 'highlight', { x: 3, y: 3, w: 88, h: 36, r: 8, cls: 'slide' });
  ['full', 'minimal', 'off'].forEach((id, i) => {
    node(seg, id, { tag: 'button', text: id.toUpperCase(), font: 'black', size: 11, align: 'center', color: T.muted, x: 2 + i * 91, y: 0, w: 90, h: 42, cls: 'tab' });
  });
  togRow(hud, 'timing', 0, 72, 293, 'Timing (ms)', 'EARLY 12ms under each one');
  togRow(hud, 'meter', 303, 72, 293, 'Timing bar', 'Early / late, on the right');
  togRow(hud, 'centerhud', 0, 144, 293, 'Center combo', 'In the middle of the lanes');
  togRow(hud, 'fps', 303, 144, 293, 'FPS counter', 'Frames per second in a song');
  const hp = frame(hud, 'preview', { x: 0, y: 216, w: 596, h: 164, bg: T.bg0, r: 12, stroke: T.line, clip: true });
  label(hp, 'caption', { text: 'PREVIEW', font: 'black', size: 10, color: T.dim, x: 18, y: 16, w: 120, h: 14 });
  label(hp, 'note', { text: 'How it looks in a song', font: 'med', size: 12, color: T.muted, x: 18, y: 34, w: 180, h: 16 });
  const mpf = frame(hp, 'pf', { x: 222, y: 12, w: 152, h: 140, bg: T.bg1, r: 10 });
  for (const i of [1, 2]) {
    const ln = frame(mpf, `lane${i}`, { x: i === 1 ? 6 : 78, y: 6, w: 68, h: 128, r: 7, cls: 'lane' });
    frame(ln, 'note', { ax: 0.5, x: [0.5, 0], y: i === 1 ? 26 : 58, w: 54, h: 9, r: 5 });
    frame(ln, 'line', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: 108, w: 50, h: 2, r: 1 });
  }
  const cc = frame(mpf, 'combo', { ax: 0.5, x: [0.5, 0], y: 26, w: 150, h: 44 });
  label(cc, 'value', { text: '48', font: 'black', size: 30, textT: 0.55, align: 'center', w: 150, h: 32 });
  label(cc, 'label', { text: 'COMBO', font: 'black', size: 8, textT: 0.6, align: 'center', y: 31, w: 150, h: 10 });
  label(mpf, 'judgment', { text: 'PERFECT', font: 'black', size: 17, color: T.gold, align: 'center', ax: 0.5, x: [0.5, 0], y: 74, w: 150, h: 22, cls: 'stroked' });
  label(mpf, 'timing', { text: 'EARLY 12ms', size: 9, color: T.cyan, align: 'center', ax: 0.5, x: [0.5, 0], y: 96, w: 150, h: 12 });
  const meter = frame(hp, 'meter', { x: 432, y: 18, w: 140, h: 32 });
  label(meter, 'label', { text: 'TIMING', font: 'black', size: 8, color: T.muted, w: 60, h: 10 });
  const mb = frame(meter, 'bar', { x: 0, y: 15, w: 140, h: 8, bg: T.bg2, r: 4, clip: true });
  frame(mb, 'good', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [1, 0], h: [0.5, 0], bg: T.green, bgT: 0.7 });
  frame(mb, 'great', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [0.6, 0], h: [0.5, 0], bg: T.cyan, bgT: 0.6 });
  frame(mb, 'perfect', { ax: 0.5, ay: 0.5, x: [0.5, 0], y: [0.5, 0], w: [0.3, 0], h: [0.5, 0], bg: T.gold, bgT: 0.45 });
  frame(mb, 'center', { ax: 0.5, x: [0.5, 0], w: 2, h: [1, 0], bg: '#FFFFFF' });
  [[52, T.gold], [61, T.gold], [83, T.cyan], [44, T.cyan]].forEach(([x, c], i) => frame(mb, `tick${i}`, { x: x as number, w: 2, h: [1, 0], bg: c as string }));
  const sc = frame(hp, 'combo', { x: 392, y: 54, w: 180, h: 40 });
  label(sc, 'label', { text: 'COMBO', font: 'black', size: 8, color: T.muted, align: 'right', w: 180, h: 10 });
  label(sc, 'value', { text: '48', font: 'black', size: 26, align: 'right', y: 9, w: 180, h: 30 });
  label(hp, 'judgment', { text: 'PERFECT', font: 'black', size: 16, color: T.gold, align: 'right', x: 392, y: 98, w: 180, h: 22 });
  label(hp, 'timing', { text: 'EARLY 12ms', size: 9, color: T.cyan, align: 'right', x: 392, y: 121, w: 180, h: 12 });
  label(hp, 'fps', { text: '60 FPS', font: 'black', size: 9, color: T.muted, align: 'right', ax: 1, ay: 1, x: [1, -16], y: [1, -12], w: 80, h: 12 });

  button(st, 'customize', { text: 'CUSTOMIZE COLORS & LINES', size: 13, x: 32, y: 540, w: 360, h: 48 });
  button(st, 'reset', { text: 'RESET DEFAULTS', size: 13, x: 404, y: 540, w: 224, h: 48, color: T.muted });
}

/** Customize: the preview (with the skin's name and how to unlock it), color rows, line style and thickness */
function buildCustomPanel(overlay: HTMLElement) {
  const cp = panel(overlay, 'custom', 620, 624);
  label(cp, 'title', { text: 'Customize', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(cp, 'sub', { text: 'Colors and lines. Play to unlock more line skins.', font: 'med', size: 13, color: T.muted, x: 32, y: 62, w: 440, h: 18 });
  frame(cp, 'preview', { x: 32, y: 96, w: 556, h: 150, bg: T.bg0, r: 14, stroke: T.line, clip: true });
  // over the preview's empty left side: which skin it is, and what it is / how to get it
  label(cp, 'skinname', { text: '', font: 'black', size: 18, truncate: true, x: 52, y: 114, w: 150, h: 24, cls: 'nopointer' });
  label(cp, 'skindesc', { html: '', font: 'med', size: 12, color: T.muted, wrap: true, valign: 'top', x: 52, y: 140, w: 140, h: 60, cls: 'nopointer' });
  label(cp, 'locked', { text: 'LOCKED', font: 'black', size: 10, color: T.gold, align: 'center', x: 52, y: 208, w: 72, h: 22, r: 11, bg: T.gold, bgT: 0.86, hidden: true, cls: 'nopointer' });
  const swatchRow = (name: string, y: number, text: string) => {
    const row = frame(cp, name, { x: 32, y, w: 556, h: 50, bg: T.bg2, r: 12 });
    label(row, 'label', { text, size: 14, x: 16, y: 0, w: 130, h: 50 });
    SWATCHES.forEach((c, i) => node(row, `sw${i}`, { tag: 'button', ay: 0.5, x: 150 + i * 40, y: [0.5, 0], w: 26, h: 26, bg: c, r: 'full', cls: 'swatch' }));
    const pick = node(row, 'pick', { tag: 'input', ay: 0.5, x: 150 + 8 * 40 + 8, y: [0.5, 0], w: 26, h: 26, r: 'full', cls: 'colorpick' }) as HTMLInputElement;
    pick.type = 'color';
    pick.title = 'Pick any color';
  };
  swatchRow('lane1', 262, 'Button 1');
  swatchRow('lane2', 320, 'Button 2');
  swatchRow('chord', 378, 'Chords');
  const style = frame(cp, 'style', { x: 32, y: 436, w: 556, h: 50, bg: T.bg2, r: 12 });
  label(style, 'label', { text: 'Line style', size: 14, x: 16, y: 8, w: 200, h: 18 });
  label(style, 'hint', { text: '', font: 'med', size: 11, color: T.muted, x: 16, y: 27, w: 300, h: 14 });
  stepper(style, '', 10, 110, 34, 14);
  const size = frame(cp, 'size', { x: 32, y: 494, w: 556, h: 50, bg: T.bg2, r: 12 });
  label(size, 'label', { text: 'Line thickness', size: 14, x: 16, y: 0, w: 200, h: 50 });
  stepper(size, '', 10, 110, 34, 14);
  button(cp, 'reset', { text: 'RESET LOOK', size: 13, x: 32, y: 558, w: 200, h: 44, color: T.muted });
  button(cp, 'done', { text: 'DONE', size: 15, ax: 1, x: 588, y: 558, w: 180, h: 44 }, 'primary');
}

/** Scales the 1100x640 stages to fit the window (same rule as the Roblox UIScale). */
export function fitStage() {
  const s = Math.min(Math.max(Math.min(window.innerWidth / 1100, window.innerHeight / 640), 0.3), 1.6);
  document.documentElement.style.setProperty('--fit', String(s));
}
