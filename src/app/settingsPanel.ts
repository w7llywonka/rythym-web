// Settings: key binds, scroll speed, audio offset (+ calibration), volume, hit sound, toggles.
import { BLOCKED_KEYS, DEFAULT_KEYS, DEFAULT_SETTINGS, HIT_SOUNDS, KEY_LABELS, T } from '../config.ts';
import { keyName } from '../scoring.ts';
import { $, rgba, txt } from '../ui.ts';
import { openCalibration } from './calibration.ts';
import { openCustom } from './customize.ts';
import { refreshHome } from './home.ts';
import { queueSave } from './save.ts';
import { audio, game } from './services.ts';
import { closeModal, onClick, openModal, setToggle, showToast, signed } from './shell.ts';
import { S, settings } from './state.ts';

/** which key slot is waiting for a new key (null = none) */
let listening: number | null = null;
export const listeningForKey = () => listening !== null;

export function refreshSettings() {
  const s = settings();
  for (let i = 0; i < 3; i++) txt($(`settings.key${i + 1}.btn`), listening === i ? '...' : keyName(s.keys[i]));
  txt($('settings.scroll.value'), `${s.scrollSpeed.toFixed(1)}x`);
  txt($('settings.offset.value'), `${signed(s.offset)} ms`);
  txt($('settings.volume.value'), `${Math.round(s.musicVolume * 100)}%`);
  txt($('settings.hitsound.value'), s.hitSound);
  setToggle($('settings.effects.toggle'), s.effects);
  setToggle($('settings.centerhud.toggle'), s.centerHud);
  setToggle($('settings.hitzone.toggle'), s.hitZone);
  for (let i = 0; i < 2; i++) {
    const c = s.laneColors[i];
    $(`settings.key${i + 1}.dot`).style.backgroundColor = c;
    $(`settings.key${i + 1}.btn`).style.boxShadow = `0 0 0 1px ${rgba(c, 0.4)}`;
  }
  game.applyHudLayout();
  game.applyLook();
  audio.setVolume(s.musicVolume);
  refreshHome();
}

function setKeyStatus(text: string, error = false) {
  txt($('settings.keystatus'), text);
  $('settings.keystatus').style.color = error ? T.red : T.muted;
}

export function openSettings() {
  listening = null;
  setKeyStatus('Click a key, then press the new key.');
  openModal($('settings'));
  refreshSettings();
}

export function closeSettings() {
  listening = null;
  closeModal();
  queueSave();
  showToast('Settings saved');
}

/** the key press after clicking a bind button (swaps with another slot that already uses it) */
export function captureKey(e: KeyboardEvent) {
  if (listening === null) return;
  e.preventDefault();
  if (BLOCKED_KEYS.has(e.code)) return setKeyStatus(`${keyName(e.code)} can't be used. Try another key.`, true);
  const slot = listening, keys = settings().keys;
  let swapped: number | null = null;
  for (let j = 0; j < 3; j++) {
    if (j !== slot && keys[j] === e.code) { keys[j] = keys[slot]; swapped = j; }
  }
  keys[slot] = e.code;
  setKeyStatus(swapped !== null ? `Swapped with ${KEY_LABELS[swapped]}.` : `${KEY_LABELS[slot]} set to ${keyName(e.code)}.`);
  listening = null;
  refreshSettings();
}

export function initSettings() {
  for (let i = 0; i < 3; i++) onClick(`settings.key${i + 1}.btn`, () => {
    if (listening === i) { listening = null; setKeyStatus('Cancelled.'); }
    else { listening = i; setKeyStatus(`Press any key for ${KEY_LABELS[i]} (click again to cancel).`); }
    refreshSettings();
  });
  const stepper = (row: string, apply: (dir: number) => void) => {
    onClick(`settings.${row}.minus`, () => { apply(-1); refreshSettings(); });
    onClick(`settings.${row}.plus`, () => { apply(1); refreshSettings(); });
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  stepper('scroll', dir => { settings().scrollSpeed = clamp(Math.round((settings().scrollSpeed + dir * 0.1) * 10) / 10, 0.5, 3); });
  stepper('offset', dir => { settings().offset = clamp(settings().offset + dir * 5, -300, 300); });
  stepper('volume', dir => { settings().musicVolume = clamp(Math.round((settings().musicVolume + dir * 0.1) * 10) / 10, 0, 1); });
  stepper('hitsound', dir => {
    const i = HIT_SOUNDS.indexOf(settings().hitSound);
    settings().hitSound = HIT_SOUNDS[(i + dir + HIT_SOUNDS.length) % HIT_SOUNDS.length];
    setTimeout(() => audio.playHit(settings().hitSound), 150);
  });
  for (const key of ['effects', 'centerHud', 'hitZone'] as const) {
    onClick(`settings.${key.toLowerCase()}.toggle`, () => { settings()[key] = !settings()[key]; refreshSettings(); });
  }
  onClick('settings.offset.calibrate', openCalibration);
  onClick('settings.customize', openCustom);
  onClick('settings.reset', () => {
    // everything except the play style and modifiers (those live in the Style panel)
    const s = settings();
    S.data.settings = {
      ...DEFAULT_SETTINGS, keys: [...DEFAULT_KEYS], laneColors: [...DEFAULT_SETTINGS.laneColors],
      style: s.style, rate: s.rate, hidden: s.hidden, sudden: s.sudden, flashlight: s.flashlight, mirror: s.mirror, random: s.random, wave: s.wave, mines: s.mines,
    };
    listening = null;
    setKeyStatus('Everything reset to default.');
    refreshSettings();
  });
  onClick('settings.close', closeSettings);
}
