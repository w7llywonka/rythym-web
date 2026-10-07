// Global keyboard: lane keys + restart + pause in a run, 1v1 reactions, key binding capture,
// Escape for panels, and arrow / Enter navigation in the menus.
import { TAB_ORDER } from '../config.ts';
import type { Lane } from '../types.ts';
import { calibTap, closeCalibration } from './calibration.ts';
import { closeCustom } from './customize.ts';
import { pauseRun, quickRestart, resumeRun, retry } from './play.ts';
import { moveSelection, moveTab, playSelected, setTab } from './select.ts';
import { audio, game } from './services.ts';
import { captureKey, closeSettings, listeningForKey } from './settingsPanel.ts';
import { closeModal, eventAge, go, isOpen } from './shell.ts';
import { S, settings } from './state.ts';
import { closeStyle } from './stylePanel.ts';
import { VS_REACT_KEYS, vsActive, vsAskForfeit, vsReact } from './versus.ts';

const typing = () => document.activeElement instanceof HTMLInputElement;

function onKeyDown(e: KeyboardEvent) {
  void audio.unlock();
  if (listeningForKey()) return captureKey(e);
  if (typing()) return;
  const keys = settings().keys;

  if (isOpen('calib')) {
    if (!e.repeat && (e.code === keys[0] || e.code === keys[1] || e.code === 'Space')) { e.preventDefault(); calibTap(eventAge(e)); }
    else if (e.code === 'Escape') closeCalibration();
    return;
  }

  // 1v1 reactions (only keys that aren't bound to anything)
  if (vsActive() && (S.screen === 'game' || S.screen === 'results') && !keys.includes(e.code)) {
    const idx = VS_REACT_KEYS[e.code];
    if (idx && !e.repeat) { e.preventDefault(); vsReact(idx); return; }
  }

  if (S.screen === 'game' && game.run) {
    const lane = e.code === keys[0] ? 1 : e.code === keys[1] ? 2 : 0;
    if (lane) {
      e.preventDefault();
      if (!e.repeat && !S.modal) game.press(lane as Lane, eventAge(e));
      return;
    }
    if (e.code === keys[2] && !e.repeat) { e.preventDefault(); quickRestart(); return; }
    if (e.code === 'Escape') {
      if (game.run.opts?.versus) vsAskForfeit();
      else if (isOpen('pause')) resumeRun();
      else pauseRun();
      return;
    }
  }

  if (e.code === 'Escape' && S.modal) {
    if (isOpen('settings')) closeSettings();
    else if (isOpen('style')) closeStyle();
    else if (isOpen('custom')) closeCustom();
    else if (!isOpen('pause')) closeModal();
    return;
  }
  if (S.modal || S.transitioning || e.repeat) return;

  // menu shortcuts swallow their key so it doesn't also activate a focused button
  const handled = () => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); };
  if (S.screen === 'select') {
    if (e.code === 'ArrowUp') { handled(); moveSelection(-1); }
    else if (e.code === 'ArrowDown') { handled(); moveSelection(1); }
    else if (e.code === 'ArrowLeft') { handled(); moveTab(-1); }
    else if (e.code === 'ArrowRight') { handled(); moveTab(1); }
    else if (e.code === 'Enter') { handled(); playSelected(); }
  } else if (S.screen === 'results' && e.code === keys[2]) {
    handled();
    retry();
  } else if (S.screen === 'home' && e.code === 'Enter') {
    handled();
    void go('select', () => setTab(S.tab ?? TAB_ORDER[0], true));
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (S.screen !== 'game' || !game.run || typing()) return;
  const keys = settings().keys;
  const lane = e.code === keys[0] ? 1 : e.code === keys[1] ? 2 : 0;
  if (lane) game.release(lane as Lane, eventAge(e));
}

export function initKeyboard() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}
