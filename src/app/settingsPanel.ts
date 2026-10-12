// Settings, in four tabs: CONTROLS (keys, scroll speed, audio offset + calibration), AUDIO (music, hit
// sounds, menu music), VISUALS (effects, hit zone, lane dim, motion, hit effect, menu theme) and HUD
// (judgments, timing, timing bar, combo, FPS). Hit effects and themes you haven't unlocked show how to get them.
import { HIT_EFFECTS, THEMES, isUnlocked } from '../../shared/cosmetics.js';
import { ease, tween } from '../anim.ts';
import { BLOCKED_KEYS, HIT_SOUNDS, JUDGE_STYLES, JUDGMENTS, KEY_LABELS, T } from '../config.ts';
import { laneLook, playHitEffect, styleNote } from '../look.ts';
import { keyName } from '../scoring.ts';
import type { HitEffect } from '../types.ts';
import { $, html, rgba, show, txt } from '../ui.ts';
import { openCalibration } from './calibration.ts';
import { openCustom } from './customize.ts';
import { refreshHome } from './home.ts';
import { applyMenuMusic } from './preview.ts';
import { queueSave } from './save.ts';
import { audio, game } from './services.ts';
import {
  LOCK_ICON, SETTINGS_TABS, choiceHint, cycle, dimText, hudLook, percent, resetSettings, stepTenth, type SettingsTab,
} from './settingsView.ts';
import { applyTheme, closeModal, escapeHtml, isOpen, onClick, openModal, setReducedMotion, setToggle, showToast, signed } from './shell.ts';
import { S, settings } from './state.ts';
import { activeHitEffect, activeNoteStyle, activeTheme, unlockStats } from './unlocks.ts';

/** which key slot is waiting for a new key (null = none) */
let listening: number | null = null;
export const listeningForKey = () => listening !== null;

let tab: SettingsTab = 'controls';
/** a hit effect / theme being looked at: hovered with the mouse, or a locked one tapped (its hint shows) */
let fxHover: HitEffect | null = null;
let fxPicked: HitEffect | null = null;
let themePicked: string | null = null;
/** RESET DEFAULTS asks for a second click until this time */
let resetUntil = 0;
/** menu music as last applied, to start / stop the preview when it changes */
let menuMusicWas: boolean | undefined;

const V = 'settings.visuals', H = 'settings.hud';

export function refreshSettings() {
  const s = settings();
  // controls
  for (let i = 0; i < 3; i++) txt($(`settings.controls.key${i + 1}.btn`), listening === i ? '...' : keyName(s.keys[i]));
  for (let i = 0; i < 2; i++) {
    const c = s.laneColors[i];
    $(`settings.controls.key${i + 1}.dot`).style.backgroundColor = c;
    $(`settings.controls.key${i + 1}.btn`).style.boxShadow = `0 0 0 1px ${rgba(c, 0.4)}`;
  }
  txt($('settings.controls.scroll.value'), `${s.scrollSpeed.toFixed(1)}x`);
  txt($('settings.controls.offset.value'), `${signed(s.offset)} ms`);
  const key = (code: string) => `<b>${escapeHtml(keyName(code))}</b>`;
  html($('settings.controls.tips.text'), `${key(s.keys[2])} restarts a song right away and <b>Esc</b> pauses (so does leaving the window). `
    + 'In song select, <b>↑</b> <b>↓</b> pick a song, <b>←</b> <b>→</b> switch tiers and <b>Enter</b> plays.');
  // audio
  txt($('settings.audio.volume.value'), percent(s.musicVolume));
  txt($('settings.audio.hitsound.value'), s.hitSound);
  txt($('settings.audio.hitvolume.value'), s.hitSound === 'OFF' ? 'OFF' : percent(s.hitVolume));
  setToggle($('settings.audio.menumusic.toggle'), s.menuMusic);
  // visuals
  setToggle($(`${V}.effects.toggle`), s.effects);
  setToggle($(`${V}.hitzone.toggle`), s.hitZone);
  setToggle($(`${V}.motion.toggle`), s.reduceMotion);
  txt($(`${V}.lanedim.value`), dimText(s.laneDim));
  refreshChoices();
  refreshHud();

  game.applyHudLayout();
  game.applyLook();
  audio.setVolume(s.musicVolume);
  audio.setHitVolume(s.hitVolume);
  setReducedMotion(s.reduceMotion);
  applyTheme();
  if (menuMusicWas !== undefined && menuMusicWas !== s.menuMusic) applyMenuMusic();
  menuMusicWas = s.menuMusic;
  refreshHome();
}

/** a choice chip: its name (with a padlock when locked), worn or not */
function paintChip(el: HTMLElement, text: string, unlocked: boolean, on: boolean) {
  html(el, `${unlocked ? '' : LOCK_ICON}${escapeHtml(text)}`);
  el.classList.toggle('on', on);
  el.classList.toggle('locked', !unlocked);
}

/** the line under a picker: what the chosen one is, or (locked) how to get it, in gold with a padlock */
function setHint(el: HTMLElement, text: string, locked: boolean) {
  html(el, `${locked ? LOCK_ICON : ''}${escapeHtml(text)}`);
  el.style.color = locked ? T.gold : T.muted;
}

function refreshChoices() {
  const s = settings(), stats = unlockStats();
  const fx = activeHitEffect();
  HIT_EFFECTS.forEach((e, i) => paintChip($(`${V}.hiteffect.fx${i}`), e.label, isUnlocked(e.unlock, stats), e.id === fx));
  const look = HIT_EFFECTS.find(e => e.id === (fxHover ?? fxPicked ?? fx)) ?? HIT_EFFECTS[0];
  const lookOpen = isUnlocked(look.unlock, stats);
  if (!s.effects) setHint($(`${V}.hiteffect.hint`), 'Effects are off, so hits show nothing. Turn them on above.', false);
  else setHint($(`${V}.hiteffect.hint`), choiceHint(look, lookOpen), !lookOpen);

  const theme = activeTheme();
  THEMES.forEach((t, i) => {
    const chip = $(`${V}.theme.th${i}`);
    chip.style.setProperty('--ta', t.colors[0]);
    chip.style.setProperty('--tb', t.colors[1]);
    paintChip(chip, t.label, isUnlocked(t.unlock, stats), t.id === theme.id);
  });
  const shown = THEMES.find(t => t.id === themePicked) ?? theme;
  const shownOpen = isUnlocked(shown.unlock, stats);
  setHint($(`${V}.theme.hint`), choiceHint({ label: shown.label, desc: `${shown.label}  ·  The glow behind the menus`, unlock: shown.unlock }, shownOpen), !shownOpen);

  // the previews use the lane dim too
  const dim = laneLook(s.laneDim);
  $(`${V}.hiteffect.preview.lane`).style.background = dim.lane;
  $(`${V}.hiteffect.preview.line`).style.backgroundColor = s.laneColors[0];
}

/** judgments segmented control, the toggles, and the preview of what a song's HUD will look like */
function refreshHud() {
  const s = settings(), look = hudLook(s);
  const i = JUDGE_STYLES.indexOf(s.judgeStyle);
  const hl = $(`${H}.judge.seg.highlight`);
  hl.style.left = `${3 + i * 91}px`;
  hl.style.backgroundColor = rgba(T.gold, 0.86);
  hl.style.boxShadow = `0 0 0 1px ${rgba(T.gold, 0.6)}`;
  JUDGE_STYLES.forEach((j, k) => { $(`${H}.judge.seg.${j.toLowerCase()}`).style.color = k === i ? T.gold : T.muted; });
  setToggle($(`${H}.timing.toggle`), s.showTiming);
  setToggle($(`${H}.meter.toggle`), s.showMeter);
  setToggle($(`${H}.centerhud.toggle`), s.centerHud);
  setToggle($(`${H}.fps.toggle`), s.showFps);
  // the timing line goes with the judgments
  $(`${H}.timing`).classList.toggle('s-off', !look.judge);
  txt($(`${H}.timing.hint`), look.judge ? 'EARLY 12ms under each one' : 'Judgments are off');

  const p = `${H}.preview`, center = s.centerHud;
  show($(`${p}.pf.combo`), center);
  show($(`${p}.combo`), !center);
  show($(`${p}.pf.judgment`), center && look.judge);
  show($(`${p}.judgment`), !center && look.judge);
  show($(`${p}.pf.timing`), center && look.timing);
  show($(`${p}.timing`), !center && look.timing);
  // about half the size they are in a song
  $(`${p}.pf.judgment`).style.fontSize = `${Math.round(look.size.center * 0.45)}px`;
  $(`${p}.judgment`).style.fontSize = `${Math.round(look.size.side * 0.55)}px`;
  show($(`${p}.meter`), s.showMeter);
  show($(`${p}.fps`), s.showFps);
  const dim = laneLook(s.laneDim);
  $(`${p}.pf`).style.backgroundColor = dim.field;
  for (const n of [1, 2]) {
    const c = s.laneColors[n - 1];
    $(`${p}.pf.lane${n}`).style.background = dim.lane;
    $(`${p}.pf.lane${n}.line`).style.backgroundColor = c;
    const note = $(`${p}.pf.lane${n}.note`);
    note.style.background = `linear-gradient(180deg, ${rgba(c, 0.2)}, ${c})`;
    // with the combo in the lanes, the lines wait above it so the preview stays readable
    note.style.top = `${center ? [2, 9][n - 1] : [26, 58][n - 1]}px`;
  }
}

function setKeyStatus(text: string, error = false) {
  txt($('settings.controls.keystatus'), text);
  $('settings.controls.keystatus').style.color = error ? T.red : T.muted;
}

function setTab(t: SettingsTab, instant = false) {
  tab = t;
  const i = SETTINGS_TABS.findIndex(x => x.id === t), info = SETTINGS_TABS[i];
  const hl = $('settings.tabs.highlight');
  if (instant) hl.style.transition = 'none';
  hl.style.left = `${4 + i * 149}px`;
  hl.style.backgroundColor = rgba(info.color, 0.86);
  hl.style.boxShadow = `0 0 0 1px ${rgba(info.color, 0.6)}`;
  if (instant) requestAnimationFrame(() => { hl.style.transition = ''; });
  for (const x of SETTINGS_TABS) {
    $(`settings.tabs.${x.id}`).style.color = x.id === t ? info.color : T.muted;
    show($(`settings.${x.id}`), x.id === t);
  }
  if (t !== 'controls' && listening !== null) {
    listening = null;
    setKeyStatus('Click a key, then press the new key.');
  }
  refreshSettings();
  if (t === 'visuals') startDemo();
}

// ---- the hit effect preview: a line falls onto the button and hits it ----------------------------
let demoTimer = 0;

function dropDemoNote() {
  const s = settings();
  const lane = $(`${V}.hiteffect.preview.lane`), layer = $(`${V}.hiteffect.preview.layer`);
  const el = document.createElement('div');
  el.className = 'note';
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  styleNote(el, bar, s.laneColors[0], activeNoteStyle(), 12, s.effects);
  lane.appendChild(el);
  tween(el, 'fall', 0, 1, 0.5, k => { el.style.transform = `translate(-50%, -50%) translateY(${-16 + 96 * k}px)`; }, ease.linear, 0, () => {
    el.remove();
    if (!settings().effects) return;
    const kind = fxHover ?? fxPicked ?? activeHitEffect();
    playHitEffect(layer, kind, JUDGMENTS[0].color, { x: 80, y: 80, laneX: 41, laneW: 78, top: 0 }, true, 0.5);
  });
}

function demoTick() {
  if (!isOpen('settings') || tab !== 'visuals') {
    clearInterval(demoTimer);
    demoTimer = 0;
    return;
  }
  dropDemoNote();
}

/** loops while the Visuals tab is open; with reduce motion on, it only plays when you look at an effect */
function startDemo() {
  if (settings().reduceMotion) { clearInterval(demoTimer); demoTimer = 0; return dropDemoNote(); }
  if (demoTimer) return;
  demoTick();
  demoTimer = window.setInterval(demoTick, 1100);
}

function shake(el: HTMLElement) {
  el.classList.remove('s-shake');
  void el.offsetWidth;
  el.classList.add('s-shake');
}

function disarmReset() {
  resetUntil = 0;
  txt($('settings.reset'), 'RESET DEFAULTS');
  $('settings.reset').style.color = T.muted;
}

export function openSettings() {
  listening = null;
  fxHover = fxPicked = null;
  themePicked = null;
  disarmReset();
  setKeyStatus('Click a key, then press the new key.');
  openModal($('settings'));
  setTab(tab, true);
}

export function closeSettings() {
  listening = null;
  disarmReset();
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
  for (const t of SETTINGS_TABS) onClick(`settings.tabs.${t.id}`, () => { if (tab !== t.id) setTab(t.id); });

  // controls
  for (let i = 0; i < 3; i++) onClick(`settings.controls.key${i + 1}.btn`, () => {
    if (listening === i) { listening = null; setKeyStatus('Cancelled.'); }
    else { listening = i; setKeyStatus(`Press any key for ${KEY_LABELS[i]} (click again to cancel).`); }
    refreshSettings();
  });
  const stepper = (row: string, apply: (dir: number) => void) => {
    onClick(`${row}.minus`, () => { apply(-1); refreshSettings(); });
    onClick(`${row}.plus`, () => { apply(1); refreshSettings(); });
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  stepper('settings.controls.scroll', dir => { settings().scrollSpeed = clamp(Math.round((settings().scrollSpeed + dir * 0.1) * 10) / 10, 0.5, 3); });
  stepper('settings.controls.offset', dir => { settings().offset = clamp(settings().offset + dir * 5, -300, 300); });
  onClick('settings.controls.offset.calibrate', openCalibration);

  // audio: a hit sound plays when you change it or its volume, so you can hear it
  const hear = () => setTimeout(() => audio.playHit(settings().hitSound), 150);
  stepper('settings.audio.volume', dir => { settings().musicVolume = stepTenth(settings().musicVolume, dir); });
  stepper('settings.audio.hitsound', dir => { settings().hitSound = cycle(HIT_SOUNDS, settings().hitSound, dir); hear(); });
  stepper('settings.audio.hitvolume', dir => { settings().hitVolume = stepTenth(settings().hitVolume, dir); hear(); });
  onClick('settings.audio.menumusic.toggle', () => { settings().menuMusic = !settings().menuMusic; refreshSettings(); });
  onClick('settings.audio.tips.calibrate', openCalibration);

  // visuals
  const flip = (path: string, key: 'effects' | 'hitZone' | 'reduceMotion' | 'showTiming' | 'showMeter' | 'centerHud' | 'showFps') =>
    onClick(path, () => { settings()[key] = !settings()[key]; refreshSettings(); });
  flip(`${V}.effects.toggle`, 'effects');
  flip(`${V}.hitzone.toggle`, 'hitZone');
  flip(`${V}.motion.toggle`, 'reduceMotion');
  stepper(`${V}.lanedim`, dir => { settings().laneDim = stepTenth(settings().laneDim, dir, 0, 0.9); });
  HIT_EFFECTS.forEach((e, i) => {
    const chip = $(`${V}.hiteffect.fx${i}`);
    const id = e.id as HitEffect;
    onClick(chip.dataset.path!, () => {
      if (isUnlocked(e.unlock, unlockStats())) { settings().hitEffect = id; fxPicked = null; }
      else { fxPicked = id; shake(chip); }
      refreshSettings();
      dropDemoNote();
    });
    // looking at one with the mouse plays it in the preview (locked ones too: a taste of what's coming)
    chip.addEventListener('pointerenter', ev => {
      if (ev.pointerType !== 'mouse') return;
      fxHover = id;
      refreshChoices();
      if (settings().reduceMotion) dropDemoNote();
    });
    chip.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { fxHover = null; refreshChoices(); } });
  });
  THEMES.forEach((t, i) => {
    const chip = $(`${V}.theme.th${i}`);
    onClick(chip.dataset.path!, () => {
      if (isUnlocked(t.unlock, unlockStats())) { settings().theme = t.id; themePicked = null; }
      else { themePicked = t.id; shake(chip); }
      refreshSettings();
    });
  });

  // HUD
  JUDGE_STYLES.forEach(j => onClick(`${H}.judge.seg.${j.toLowerCase()}`, () => { settings().judgeStyle = j; refreshSettings(); }));
  flip(`${H}.timing.toggle`, 'showTiming');
  flip(`${H}.meter.toggle`, 'showMeter');
  flip(`${H}.centerhud.toggle`, 'centerHud');
  flip(`${H}.fps.toggle`, 'showFps');

  onClick('settings.customize', openCustom);
  onClick('settings.reset', () => {
    // a second click within 3 s resets: it covers a lot (keys, colors, skins, effects, theme...)
    if (Date.now() > resetUntil) {
      resetUntil = Date.now() + 3000;
      txt($('settings.reset'), 'CLICK AGAIN TO RESET');
      $('settings.reset').style.color = T.red;
      setTimeout(() => { if (resetUntil && Date.now() >= resetUntil) disarmReset(); }, 3050);
      return;
    }
    disarmReset();
    S.data.settings = resetSettings(settings());
    listening = null;
    fxPicked = null;
    themePicked = null;
    setKeyStatus('Click a key, then press the new key.');
    refreshSettings();
    showToast('Settings reset to default');
  });
  onClick('settings.close', closeSettings);
}
