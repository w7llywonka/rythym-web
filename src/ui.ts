// Builds the whole interface as a 1100x640 "stage" that is scaled to fit the window, using the same
// positions, sizes, colors and type as the Roblox version. Elements are looked up by dotted path: $('home.play').
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

const label = (p: HTMLElement, name: string, o: Opts) => node(p, name, o);
const frame = (p: HTMLElement, name: string, o: Opts) => node(p, name, o);
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

function toggle(p: HTMLElement, w = 52, h = 28) {
  const t = node(p, 'toggle', { tag: 'button', ax: 1, ay: 0.5, x: [1, -14], y: [0.5, 0], w: w - 8, h: h - 4, bg: T.bg3, r: 'full', cls: 'toggle' });
  h -= 4;
  frame(t, 'knob', { ay: 0.5, x: 3, y: [0.5, 0], w: h - 6, h: h - 6, bg: '#FFFFFF', r: 'full', cls: 'knob' });
  return t;
}

function stepper(row: HTMLElement, prefix: string, rightOffset: number, valueWidth: number, size = 40, valueSize = 15) {
  button(row, prefix + 'minus', { text: '−', size: 16, ax: 1, ay: 0.5, x: [1, -(rightOffset + valueWidth + 8 + size)], y: [0.5, 0], w: size, h: size, r: 10, bg: T.bg1 });
  label(row, prefix + 'value', { text: '-', font: 'black', size: valueSize, align: 'center', ax: 1, ay: 0.5, x: [1, -(rightOffset + size + 4)], y: [0.5, 0], w: valueWidth, h: 40 });
  button(row, prefix + 'plus', { text: '+', size: 16, ax: 1, ay: 0.5, x: [1, -rightOffset], y: [0.5, 0], w: size, h: size, r: 10, bg: T.bg1 });
}

function panel(parent: HTMLElement, name: string, w: number, h: number) {
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
  const chartRow = frame(detail, 'chartrow', { x: 20, y: 262, w: 400, h: 40 });
  button(chartRow, 'base', { text: 'EASY', size: 14, x: 0, y: 0, w: 196, h: 40, r: 10 });
  button(chartRow, 'plus', { text: 'HARD +', size: 14, x: 204, y: 0, w: 196, h: 40, r: 10 });
  const best = frame(detail, 'best', { x: 20, y: 312, w: 400, h: 84, r: 12, stroke: T.line });
  label(best, 'header', { text: 'PERSONAL BEST', font: 'black', size: 10, color: T.muted, x: 16, y: 10, w: 200, h: 14 });
  button(best, 'top', { text: 'TOP 10 →', size: 10, x: 130, y: 6, w: 80, h: 22, r: 8, bg: T.bg1 });
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

  // settings
  const st = panel(overlay, 'settings', 660, 610);
  label(st, 'title', { text: 'Settings', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  const header = (p: HTMLElement, name: string, text: string, y: number) =>
    label(p, name, { text, font: 'black', size: 10, color: T.muted, x: 32, y, w: 300, h: 14 });
  header(st, 'h1', 'CONTROLS', 84);
  [T.cyan, T.pink, T.text].forEach((color, i) => {
    const row = frame(st, `key${i + 1}`, { x: 32 + i * 202, y: 106, w: 192, h: 60, bg: T.bg2, r: 12 });
    frame(row, 'dot', { ay: 0.5, x: 16, y: [0.5, 0], w: 12, h: 12, bg: color, r: 'full' });
    label(row, 'label', { text: ['Button 1', 'Button 2', 'Restart'][i], size: 15, x: 34, y: 0, w: 80, h: 60 });
    button(row, 'btn', { text: 'F', size: 14, ax: 1, ay: 0.5, x: [1, -10], y: [0.5, 0], w: 80, h: 40, r: 10, bg: T.bg1, stroke: i < 2 ? color : T.line });
  });
  label(st, 'keystatus', { text: 'Click a key, then press the new key.', font: 'med', size: 13, color: T.muted, x: 32, y: 172, w: 600, h: 18 });
  header(st, 'h2', 'GAMEPLAY', 204);
  const bigRow = (name: string, y: number, text: string, hint: string) => {
    const row = frame(st, name, { x: 32, y, w: 596, h: 62, bg: T.bg2, r: 12 });
    label(row, 'label', { text, size: 17, x: 18, y: 10, w: 300, h: 22 });
    label(row, 'hint', { text: hint, font: 'med', size: 12, color: T.muted, x: 18, y: 33, w: 330, h: 16 });
    button(row, 'minus', { text: '-', size: 22, ax: 1, ay: 0.5, x: [1, -176], y: [0.5, 0], w: 44, h: 42, r: 10, bg: T.bg1 });
    label(row, 'value', { text: '-', font: 'black', size: 18, align: 'center', ax: 1, ay: 0.5, x: [1, -62], y: [0.5, 0], w: 110, h: 42 });
    button(row, 'plus', { text: '+', size: 22, ax: 1, ay: 0.5, x: [1, -12], y: [0.5, 0], w: 44, h: 42, r: 10, bg: T.bg1 });
    return row;
  };
  bigRow('scroll', 226, 'Scroll speed', 'How fast lines fall');
  const off = bigRow('offset', 298, 'Audio offset', 'Late? lower it. Early? raise it.');
  button(off, 'calibrate', { text: 'CALIBRATE', size: 13, x: 232, y: 10, w: 120, h: 42, r: 10, bg: T.bg1 });
  header(st, 'h3', 'AUDIO & VISUALS', 374);
  const half = (name: string, x: number, text: string) => {
    const row = frame(st, name, { x, y: 396, w: 290, h: 62, bg: T.bg2, r: 12 });
    label(row, 'label', { text, size: 15, x: 18, y: 0, w: 110, h: 62 });
    stepper(row, '', 10, 66);
    return row;
  };
  half('volume', 32, 'Music volume');
  half('hitsound', 338, 'Hit sound');
  const tog = (name: string, x: number, text: string) => {
    const row = frame(st, name, { x, y: 468, w: 190, h: 62, bg: T.bg2, r: 12 });
    label(row, 'label', { text, size: 15, x: 16, y: 0, w: 110, h: 62 });
    toggle(row, 52, 28);
  };
  tog('effects', 32, 'Effects');
  tog('centerhud', 235, 'Center combo');
  tog('hitzone', 438, 'Hit zone');
  button(st, 'customize', { text: 'CUSTOMIZE COLORS & LINES', size: 13, x: 32, y: 540, w: 360, h: 48 });
  button(st, 'reset', { text: 'RESET DEFAULTS', size: 13, x: 404, y: 540, w: 224, h: 48, color: T.muted });

  // customize: lane / chord colors, line style and thickness, with a live preview
  const cp = panel(overlay, 'custom', 620, 624);
  label(cp, 'title', { text: 'Customize', font: 'black', size: 26, x: 32, y: 26, w: 400, h: 36 });
  label(cp, 'sub', { text: 'Colors and lines. Saved with your settings.', font: 'med', size: 13, color: T.muted, x: 32, y: 62, w: 400, h: 18 });
  frame(cp, 'preview', { x: 32, y: 96, w: 556, h: 150, bg: T.bg0, r: 14, stroke: T.line, clip: true });
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
  const stepRow = (name: string, y: number, text: string) => {
    const row = frame(cp, name, { x: 32, y, w: 556, h: 50, bg: T.bg2, r: 12 });
    label(row, 'label', { text, size: 14, x: 16, y: 0, w: 200, h: 50 });
    stepper(row, '', 10, 110, 34, 14);
  };
  stepRow('style', 436, 'Line style');
  stepRow('size', 494, 'Line thickness');
  button(cp, 'reset', { text: 'RESET LOOK', size: 13, x: 32, y: 558, w: 200, h: 44, color: T.muted });
  button(cp, 'done', { text: 'DONE', size: 15, ax: 1, x: 588, y: 558, w: 180, h: 44 }, 'primary');

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

  // profile
  const pp = panel(overlay, 'profile', 720, 600);
  label(pp, 'title', { text: 'Profile', font: 'black', size: 26, x: 32, y: 26, w: 160, h: 36 });
  label(pp, 'ptitle', { text: '', font: 'black', size: 14, color: T.gold, x: 200, y: 36, w: 220, h: 20 });
  button(pp, 'account', { text: 'ACCOUNT', size: 13, ax: 1, x: 620, y: 28, w: 110, h: 40 });
  const pst = frame(pp, 'stats', { x: 32, y: 80, w: 656, h: 140 });
  ([['level', 'LEVEL'], ['plays', 'PLAYS'], ['noteshit', 'NOTES HIT'], ['fullcombos', 'FULL COMBOS'], ['ssranks', 'SS RANKS'], ['playtime', 'PLAY TIME']] as const).forEach(([nm, title], i) => {
    const box = frame(pst, nm, { x: (i % 3) * 222, y: Math.floor(i / 3) * 72, w: 210, h: 64, bg: T.bg2, r: 12 });
    label(box, 'value', { text: '0', font: 'black', size: 22, x: 14, y: 8, w: 190, h: 28 });
    label(box, 'label', { text: title, size: 11, color: T.muted, x: 14, y: 38, w: 190, h: 14 });
  });
  label(pp, 'achheader', { text: 'Achievements  ·  click an unlocked one to wear its title', font: 'bold', size: 12, color: T.muted, x: 32, y: 236, w: 600, h: 14 });
  const grid = frame(pp, 'achievements', { x: 32, y: 258, w: 656, h: 320 });
  ACHIEVEMENTS.forEach((_, i) => {
    const a = button(grid, `ach${i + 1}`, { text: '', x: (i % 4) * 166, y: Math.floor(i / 4) * 106, w: 156, h: 98, r: 12 });
    label(a, 'name', { text: '?', font: 'black', size: 13, x: 10, y: 8, w: 136, h: 18 });
    label(a, 'desc', { text: '', font: 'med', size: 11, color: T.muted, wrap: true, valign: 'top', x: 10, y: 30, w: 136, h: 42 });
    label(a, 'state', { text: 'LOCKED', font: 'black', size: 10, color: T.dim, x: 10, y: 76, w: 136, h: 14 });
  });

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

  label(overlay, 'toast', { text: '', size: 15, align: 'center', ax: 0.5, ay: 1, x: [0.5, 0], y: [1, -24], w: 500, h: 40, bg: T.bg3, bgT: 0.05, r: 20, hidden: true, cls: 'toast' });
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

/** Scales the 1100x640 stages to fit the window (same rule as the Roblox UIScale). */
export function fitStage() {
  const s = Math.min(Math.max(Math.min(window.innerWidth / 1100, window.innerHeight / 640), 0.3), 1.6);
  document.documentElement.style.setProperty('--fit', String(s));
}
