// Customize: lane / chord colors, line style and thickness, with a live preview. The line style goes
// through every skin: ones you haven't unlocked yet show in the preview with how to get them. Stepping
// only browses; the skin you leave on is used if it's unlocked, else you keep the one you had.
import { NOTE_SKINS, describeRule, isUnlocked } from '../../shared/cosmetics.js';
import { DEFAULT_SETTINGS, T } from '../config.ts';
import { NOTE_SIZE, NOTE_STYLES, SWATCHES, styleHold, styleNote } from '../look.ts';
import type { NoteStyle } from '../types.ts';
import { $, html, rgba, show, txt } from '../ui.ts';
import { queueSave } from './save.ts';
import { openSettings, refreshSettings } from './settingsPanel.ts';
import { LOCK_ICON, cycle, keptSkin, skinHint } from './settingsView.ts';
import { escapeHtml, onClick, onPanelClose, openModal } from './shell.ts';
import { settings } from './state.ts';
import { activeNoteStyle, unlockStats } from './unlocks.ts';

type Row = 'lane1' | 'lane2' | 'chord';
const ROWS: Row[] = ['lane1', 'lane2', 'chord'];
const colorOf = (row: Row) => (row === 'chord' ? settings().chordColor : settings().laneColors[row === 'lane1' ? 0 : 1]);

/** the skin the style stepper is on (it can be a locked one; the setting only changes when you leave) */
let browse: NoteStyle = 'Glow';
const skinOf = (id: NoteStyle) => NOTE_SKINS.find(x => x.id === id) ?? NOTE_SKINS[0];
const skinOpen = (id: NoteStyle) => isUnlocked(skinOf(id).unlock, unlockStats());

function renderPreview() {
  const box = $('custom.preview');
  const s = settings();
  // the lanes sit right of centre: the skin's name and how to get it are on the left
  const laneW = 150, gap = 12, x0 = 190;
  const lanes = [0, 1].map(i => {
    const lane = document.createElement('div');
    lane.className = 'prevlane';
    lane.style.cssText = `left:${x0 + i * (laneW + gap)}px;top:10px;width:${laneW}px;height:130px`;
    const c = s.laneColors[i];
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:16px;right:16px;top:110px;height:3px;border-radius:2px;background:${c};box-shadow:0 0 10px ${rgba(c, 0.5)}`;
    lane.appendChild(line);
    return lane;
  });
  const note = (lane: number, y: number, color: string) => {
    const el = document.createElement('div');
    el.className = 'note';
    el.style.transform = `translate(-50%, -50%) translateY(${y}px)`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    el.appendChild(bar);
    styleNote(el, bar, color, browse, s.noteSize, s.effects);
    lanes[lane].appendChild(el);
  };
  // a hold: its trail from `tail` down to the head at `head`
  const hold = (lane: number, tail: number, head: number, color: string) => {
    const body = document.createElement('div');
    body.className = 'hold';
    const cap = document.createElement('div');
    cap.className = 'cap';
    styleHold(body, cap, color, browse);
    body.appendChild(cap);
    body.style.transform = `translateX(-50%) translateY(${tail}px)`;
    body.style.height = `${head - tail}px`;
    lanes[lane].appendChild(body);
    note(lane, head, color);
  };
  note(0, 24, s.chordColor);
  note(1, 24, s.chordColor);
  note(0, 76, s.laneColors[0]);
  hold(1, 50, 98, s.laneColors[1]);
  box.replaceChildren(...lanes);
}

function refresh() {
  for (const row of ROWS) {
    const current = colorOf(row).toUpperCase();
    let matched = false;
    SWATCHES.forEach((c, i) => {
      const on = c.toUpperCase() === current;
      matched ||= on;
      $(`custom.${row}.sw${i}`).classList.toggle('on', on);
    });
    const pick = $(`custom.${row}.pick`) as HTMLInputElement;
    pick.value = current.toLowerCase();
    pick.classList.toggle('on', !matched);
    pick.style.background = matched ? '' : current;
  }
  const skin = skinOf(browse), open = skinOpen(browse), stats = unlockStats();
  html($('custom.style.value'), `${open ? '' : LOCK_ICON}${escapeHtml(skin.label)}`);
  $('custom.style.value').style.color = open ? T.text : T.muted;
  const count = NOTE_SKINS.filter(x => isUnlocked(x.unlock, stats)).length;
  txt($('custom.style.hint'), skinHint(open, skinOf(activeNoteStyle()).label, count, NOTE_SKINS.length));
  $('custom.style.hint').style.color = open ? T.muted : T.text;
  txt($('custom.skinname'), skin.label);
  html($('custom.skindesc'), open ? escapeHtml(skin.desc) : `${LOCK_ICON}${escapeHtml(describeRule(skin.unlock))}`);
  $('custom.skindesc').style.color = open ? T.muted : T.gold;
  show($('custom.locked'), !open);
  txt($('custom.size.value'), `${settings().noteSize} px`);
  renderPreview();
}

function setColor(row: Row, color: string) {
  const s = settings();
  const c = color.toUpperCase();
  if (row === 'chord') s.chordColor = c;
  else s.laneColors = row === 'lane1' ? [c, s.laneColors[1]] : [s.laneColors[0], c];
  refresh();
  refreshSettings();
}

export function openCustom() {
  browse = activeNoteStyle();
  openModal($('custom'));
  refresh();
}

/** the skin you stopped on is used if it's unlocked; otherwise you keep the one you had */
function applySkin() {
  const had = activeNoteStyle(), next = keptSkin(browse, skinOpen(browse), had);
  if (next !== had) settings().noteStyle = next;
  queueSave();
}

export function closeCustom() {
  openSettings(); // leaving the panel applies the skin (onPanelClose below)
}

export function initCustomize() {
  for (const row of ROWS) {
    SWATCHES.forEach((c, i) => onClick(`custom.${row}.sw${i}`, () => setColor(row, c)));
    $(`custom.${row}.pick`).addEventListener('input', e => setColor(row, (e.target as HTMLInputElement).value));
  }
  // every skin, locked ones too (shown, not used); skins you only pass over aren't used either
  const shiftStyle = (dir: number) => {
    browse = cycle(NOTE_STYLES, browse, dir);
    refresh();
  };
  const shiftSize = (dir: number) => {
    settings().noteSize = Math.min(NOTE_SIZE.max, Math.max(NOTE_SIZE.min, settings().noteSize + dir * NOTE_SIZE.step));
    refresh();
  };
  onClick('custom.style.minus', () => shiftStyle(-1));
  onClick('custom.style.plus', () => shiftStyle(1));
  onClick('custom.size.minus', () => shiftSize(-1));
  onClick('custom.size.plus', () => shiftSize(1));
  onClick('custom.reset', () => {
    const s = settings();
    s.laneColors = [...DEFAULT_SETTINGS.laneColors];
    s.chordColor = DEFAULT_SETTINGS.chordColor;
    s.noteStyle = browse = DEFAULT_SETTINGS.noteStyle;
    s.noteSize = DEFAULT_SETTINGS.noteSize;
    refresh();
    refreshSettings();
  });
  onClick('custom.done', closeCustom);
  onClick('custom.close', closeCustom);
  onPanelClose($('custom'), applySkin);
}
