// What's New: the newest changelog entry (src/changelog.ts), shown once per version on each device
// after an update (first-time players skip it, see tutorial.ts), and any time from WHAT'S NEW on home.
import { CHANGELOG, LATEST, formatDate, type ChangeEntry } from '../changelog.ts';
import { T } from '../config.ts';
import { $, button, frame, label, panel, txt } from '../ui.ts';
import { closeModal, onClick, openModal } from './shell.ts';

const SEEN_KEY = 'lineRush.seenVersion';

/** the last version whose notes were shown on this device (blocked storage counts as seen: never nag) */
export function seenVersion(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return LATEST.version; }
}

export function markWhatsNewSeen() {
  try { localStorage.setItem(SEEN_KEY, LATEST.version); } catch { /* private mode */ }
}

const el = (tag: string, cls: string, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

function entry(e: ChangeEntry, older: boolean) {
  const box = el('div', older ? 'wn-entry older' : 'wn-entry');
  if (older) box.append(el('div', 'wn-old', `${e.version}  ·  ${formatDate(e.date)}`), el('div', 'wn-oldhead', e.headline));
  for (const s of e.sections) {
    const sec = el('div', 'wn-section');
    sec.append(el('div', 'wn-title', s.title));
    for (const item of s.items) sec.append(el('div', 'wn-item', item));
    box.append(sec);
  }
  return box;
}

function render() {
  txt($('whatsnew.title'), `Line Rush ${LATEST.version}`);
  txt($('whatsnew.date'), formatDate(LATEST.date));
  txt($('whatsnew.headline'), LATEST.headline);
  const older = CHANGELOG.slice(1);
  $('whatsnew.list').replaceChildren(
    entry(LATEST, false),
    ...(older.length ? [el('div', 'wn-earlier', 'EARLIER'), ...older.map(e => entry(e, true))] : []),
  );
  $('whatsnew.list').scrollTop = 0;
}

export function openWhatsNew() {
  render();
  markWhatsNewSeen();
  openModal($('whatsnew'));
}

export function buildWhatsNewUI() {
  const p = panel($('overlay'), 'whatsnew', 620, 590);
  label(p, 'kicker', { text: "WHAT'S NEW", font: 'black', size: 11, color: T.cyan, x: 32, y: 32, w: 200, h: 14 });
  label(p, 'title', { text: '', font: 'black', size: 30, x: 32, y: 50, w: 420, h: 40 });
  label(p, 'date', { text: '', font: 'med', size: 13, color: T.muted, x: 32, y: 92, w: 400, h: 18 });
  label(p, 'headline', { text: '', font: 'med', size: 16, wrap: true, valign: 'top', x: 32, y: 124, w: 556, h: 44 });
  frame(p, 'list', { x: 32, y: 158, w: 562, h: 340, scroll: true, cls: 'wn-list' });
  button(p, 'done', { text: "LET'S GO", size: 24, ax: 1, x: 588, y: 514, w: 180, h: 50 }, 'primary');
  // left of CREDITS
  button($('home'), 'whatsnew', { text: "WHAT'S NEW", size: 10, ax: 1, ay: 1, x: [1, -124], y: [1, -14], w: 100, h: 28, r: 8 });
}

export function initWhatsNew() {
  onClick('whatsnew.close', closeModal);
  onClick('whatsnew.done', closeModal);
  onClick('home.whatsnew', openWhatsNew);
}
