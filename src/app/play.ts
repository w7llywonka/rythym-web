// Starting and controlling a run: start / quick restart / pause / quit, and touch input on the buttons.
import { K } from '../config.ts';
import type { RunOpts } from '../game.ts';
import { currentSet } from '../scoring.ts';
import type { Diff, Lane, Track } from '../types.ts';
import { $ } from '../ui.ts';
import { playPreview } from './preview.ts';
import { queueSave } from './save.ts';
import { setTab } from './select.ts';
import { audio, game } from './services.ts';
import { closeModal, eventAge, go, onClick, openModal } from './shell.ts';
import { S, settings } from './state.ts';
import { vsAskForfeit } from './versus.ts';

export async function startRun(t: Track | null | undefined, diff?: Diff | null, quick = false, opts?: RunOpts) {
  if (!t || (S.transitioning && !quick)) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  await audio.unlock();
  diff = (diff && t.charts[diff]) ? diff : t.difficulty;
  closeModal();
  S.last = { song: t, chart: diff, opts: opts?.versus ? undefined : opts };
  // remember it in Recent (newest first, one entry per song)
  S.data.recent = [{ id: t.id, chart: diff }, ...S.data.recent.filter(e => e.id !== t.id)].slice(0, K.MAX_RECENT);
  queueSave();
  audio.token++;
  const set = opts?.set ?? currentSet(settings(), S.autoplay);
  await game.start(t, diff, quick, { ...opts, practice: { ...S.practice } }, set);
}

export function retry() {
  void startRun(S.last.song, S.last.chart, false, S.last.opts);
}

export function quickRestart() {
  const r = game.run;
  if (r && !S.transitioning && !r.opts?.versus) void startRun(r.track, r.chartDiff, true, r.opts);
}

export function pauseRun() {
  if (game.pause()) openModal($('pause'));
}

export function resumeRun() {
  closeModal();
  game.resume();
}

export function quitToSongs() {
  closeModal();
  game.stop();
  void go('select', () => setTab(S.tab, true));
  void playPreview(S.selectedSong[S.tab]);
}

export function initPlay() {
  onClick('game.left.pause', () => {
    // no pausing in a 1v1: the button forfeits instead
    if (game.run?.opts?.versus) vsAskForfeit();
    else pauseRun();
  });
  onClick('pause.resume', resumeRun);
  onClick('pause.restart', () => { const r = game.run; if (r) void startRun(r.track, r.chartDiff, true, r.opts); });
  onClick('pause.quit', quitToSongs);

  // the buttons themselves: mouse / touch
  for (const lane of [1, 2] as Lane[]) {
    const rec = $(`game.pf.lane${lane}.rec`);
    rec.addEventListener('pointerdown', e => {
      e.preventDefault();
      rec.setPointerCapture?.(e.pointerId);
      game.press(lane, eventAge(e));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      rec.addEventListener(type, e => game.release(lane, eventAge(e)));
    }
  }

  // leaving the tab / window pauses the game
  window.addEventListener('blur', pauseRun);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseRun(); });
}
