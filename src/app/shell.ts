// Screens, modals, toasts and small UI helpers shared by every panel.
import { ease, fade, pop } from '../anim.ts';
import { T } from '../config.ts';
import { $, show, txt } from '../ui.ts';
import { audio } from './services.ts';
import { S, type Screen } from './state.ts';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function showScreen(name: Screen) {
  for (const s of ['home', 'select', 'game', 'results'] as Screen[]) show($(s), s === name);
  S.screen = name;
  if (name === 'home') setAmbient(T.cyan, T.pink);
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

export function openModal(panel: HTMLElement) {
  if (S.modal === panel) return;
  if (S.modal) show(S.modal, false);
  S.modal = panel;
  const dim = $('dimmer');
  show(dim, true);
  requestAnimationFrame(() => dim.classList.add('on'));
  show(panel, true);
  pop(panel, 0.94, 0.25, ease.back);
}

export function closeModal() {
  if (!S.modal) return;
  show(S.modal, false);
  S.modal = null;
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
  knob.style.left = on ? `${toggle.offsetWidth - knob.offsetWidth - 3}px` : '3px';
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

/** recolor the background glows (they fade over ~1 s) */
export function setAmbient(a: string, b: string) {
  const bd = $('backdrop');
  bd.style.setProperty('--ga', a);
  bd.style.setProperty('--gb', b);
}
