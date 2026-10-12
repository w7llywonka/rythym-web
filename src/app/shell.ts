// Screens, modals, toasts and small UI helpers shared by every panel.
import { ease, fade, pop } from '../anim.ts';
import { T } from '../config.ts';
import { $, show, txt } from '../ui.ts';
import { audio } from './services.ts';
import { S, type Screen } from './state.ts';
import { activeTheme } from './unlocks.ts';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function showScreen(name: Screen) {
  for (const s of ['home', 'select', 'game', 'results'] as Screen[]) show($(s), s === name);
  S.screen = name;
  if (name === 'home') applyTheme();
  // on results the toast sits above the button row (RETRY, CONTINUE, NEW IN YOUR LOCKER), not over it
  $('toast').style.top = name === 'results' ? '540px' : 'calc(100% - 24px)';
}

/** the home screen's glow in the menu theme (Settings → Visuals, or the Locker) */
export function applyTheme() {
  if (S.screen === 'home') setAmbient(...activeTheme().colors);
}

/** Settings → Reduce motion: CSS (style.css, .reduce-motion) holds still what pops, slides and pulses in the menus */
export function setReducedMotion(on: boolean) {
  document.documentElement.classList.toggle('reduce-motion', on);
}

let fadeTimer: number | undefined;
/** fade to black, swap screens, fade back in. A second call while fading replaces the first. */
export function go(name: Screen, setup?: () => void): Promise<void> {
  S.transitioning = true;
  const fader = $('fader');
  fader.style.transition = 'opacity .15s';
  fader.style.opacity = '1';
  if (fadeTimer) clearTimeout(fadeTimer);
  return new Promise(resolve => {
    fadeTimer = window.setTimeout(() => {
      fadeTimer = undefined;
      showScreen(name);
      setup?.();
      fader.style.transition = 'opacity .3s';
      fader.style.opacity = '0';
      S.transitioning = false;
      resolve();
    }, 160);
  });
}

// what a panel does whenever it goes away, however that happens (its own button, Escape, another
// panel opening over it, a 1v1 starting...)
const closeHooks = new Map<HTMLElement, () => void>();
export const onPanelClose = (panel: HTMLElement, fn: () => void) => { closeHooks.set(panel, fn); };

export function openModal(panel: HTMLElement) {
  if (S.modal === panel) return;
  if (S.modal) { show(S.modal, false); closeHooks.get(S.modal)?.(); }
  S.modal = panel;
  const dim = $('dimmer');
  show(dim, true);
  requestAnimationFrame(() => dim.classList.add('on'));
  show(panel, true);
  pop(panel, 0.94, 0.25, ease.back);
}

export function closeModal() {
  if (!S.modal) return;
  const was = S.modal;
  show(was, false);
  S.modal = null;
  closeHooks.get(was)?.();
  const dim = $('dimmer');
  dim.classList.remove('on');
  setTimeout(() => { if (!S.modal) show(dim, false); }, 160);
}

export const isOpen = (path: string) => S.modal === $(path);

const toastQueue: string[] = [];
let toastToken = 0;
export function showToast(text: string) {
  const t = $('toast');
  const my = ++toastToken;
  txt(t, text);
  show(t, true);
  t.style.opacity = '1';
  pop(t, 0.92, 0.2, ease.back);
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
/** toasts that shouldn't overwrite each other (achievements, level ups) */
export function queueToast(text: string) {
  if (!$('toast').hidden) toastQueue.push(text); else showToast(text);
}

export function setToggle(toggle: HTMLElement, on: boolean) {
  toggle.style.backgroundColor = on ? T.cyan : T.bg3;
  const knob = toggle.querySelector('.knob') as HTMLElement;
  // sizes from the layout, or (in a hidden tab, which has none) from the sizes it was built with
  const w = toggle.offsetWidth || parseFloat(toggle.style.width), kw = knob.offsetWidth || parseFloat(knob.style.width);
  knob.style.left = on ? `${w - kw - 3}px` : '3px';
  knob.style.backgroundColor = on ? T.bg0 : T.text;
}

/**
 * click handler that also unlocks audio (browsers need a gesture first). Mouse clicks drop focus
 * afterwards, so a later Enter / Space (or a lane key) can't "click" that button again.
 */
export function onClick(path: string, fn: (e: MouseEvent) => void) {
  const el = $(path);
  el.addEventListener('click', e => {
    void audio.unlock();
    if (e.detail > 0) el.blur();
    fn(e);
  });
}

/** how long ago an input event really happened (keyboard/touch timestamp correction), capped */
export const eventAge = (e: Event) => Math.min(0.1, Math.max(0, (performance.now() - e.timeStamp) / 1000));

export const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** recolor the background glows (they fade over ~1 s), and the light behind the home logo */
export function setAmbient(a: string, b: string) {
  for (const el of [$('backdrop'), $('home.logoglow')]) {
    el.style.setProperty('--ga', a);
    el.style.setProperty('--gb', b);
  }
}
