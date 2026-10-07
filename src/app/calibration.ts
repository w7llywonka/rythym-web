// Calibration: tap along to a clean track; the median error suggests an audio offset.
import { ease, pop } from '../anim.ts';
import type { Track } from '../types.ts';
import { $, html, txt } from '../ui.ts';
import { playPreview } from './preview.ts';
import { queueSave } from './save.ts';
import { audio } from './services.ts';
import { openSettings } from './settingsPanel.ts';
import { eventAge, onClick, openModal, showToast, signed } from './shell.ts';
import { S, settings } from './state.ts';

const TAPS = 20, SKIP = 4;
let calib: { track: Track; taps: number[]; running: boolean; result: number | null } | null = null;

export const calibrating = () => !!calib?.running;

async function start() {
  const track = S.tracksById.get('daybreak') ?? S.tracks[0];
  const my = ++audio.token;
  calib = { track, taps: [], running: false, result: null };
  txt($('calib.pad.count'), '...');
  html($('calib.result'), 'Loading the beat...');
  $('calib.apply').classList.add('disabled');
  await audio.unlock();
  const buffer = await audio.load(track.song);
  if (my !== audio.token || !calib) return;
  const at = track.previewStart;
  audio.start(buffer, audio.now + 0.05, at, 1, 0.9, { start: at, end: Math.min(buffer.duration, at + 30) });
  calib.running = true;
  txt($('calib.pad.count'), `0 / ${TAPS}`);
  html($('calib.result'), 'Tap on every beat you hear');
}

export function calibTap(age = 0) {
  pop($('calib.pad'), 0.9, 0.15, ease.back);
  if (!calib || !calib.running) return;
  const t = audio.position() - age;
  const beat = 60 / calib.track.bpm;
  const phase = (t - calib.track.offset) / beat;
  calib.taps.push((phase - Math.round(phase)) * beat); // seconds, negative = early
  txt($('calib.pad.count'), `${calib.taps.length} / ${TAPS}`);
  if (calib.taps.length < TAPS) return;
  const used = calib.taps.slice(SKIP).sort((a, b) => a - b);
  const median = used[Math.floor(used.length / 2)];
  const ms = Math.round(median * 1000);
  calib.result = Math.min(300, Math.max(-300, Math.round((median * 1000) / 5) * 5));
  calib.running = false;
  audio.fade(0, 0.3);
  txt($('calib.pad.count'), 'DONE');
  html($('calib.result'), `You tap <b>${Math.abs(ms)}ms ${ms < 0 ? 'early' : 'late'}</b> on average.<br>Suggested audio offset: <b>${signed(calib.result)} ms</b>`);
  $('calib.apply').classList.remove('disabled');
}

export function openCalibration() {
  calib = null;
  txt($('calib.pad.count'), `0 / ${TAPS}`);
  html($('calib.result'), `Current offset: ${signed(settings().offset)} ms`);
  $('calib.apply').classList.add('disabled');
  openModal($('calib'));
}

export function closeCalibration() {
  if (calib) calib.running = false;
  audio.stop();
  calib = null;
  openSettings();
  void playPreview(S.selectedSong[S.tab] ?? S.previewTrack);
}

export function initCalibration() {
  onClick('calib.start', () => void start());
  $('calib.pad').addEventListener('pointerdown', e => calibTap(eventAge(e)));
  onClick('calib.close', closeCalibration);
  onClick('calib.apply', () => {
    if (!calib || calib.result === null) return;
    settings().offset = calib.result;
    queueSave();
    showToast(`Audio offset set to ${signed(settings().offset)} ms`);
    closeCalibration();
  });
}
