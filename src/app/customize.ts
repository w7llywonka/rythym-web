// Customize: lane / chord colors, line style and thickness, with a live preview.
import { DEFAULT_SETTINGS } from '../config.ts';
import { NOTE_SIZE, NOTE_STYLES, SWATCHES, styleNote } from '../look.ts';
import { $, rgba, txt } from '../ui.ts';
import { queueSave } from './save.ts';
import { openSettings, refreshSettings } from './settingsPanel.ts';
import { onClick, openModal } from './shell.ts';
import { settings } from './state.ts';

type Row = 'lane1' | 'lane2' | 'chord';
const ROWS: Row[] = ['lane1', 'lane2', 'chord'];
const colorOf = (row: Row) => (row === 'chord' ? settings().chordColor : settings().laneColors[row === 'lane1' ? 0 : 1]);

function renderPreview() {
  const box = $('custom.preview');
  const s = settings();
  const laneW = 150, gap = 12, x0 = (556 - (laneW * 2 + gap)) / 2;
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
    styleNote(el, bar, color, s.noteStyle, s.noteSize, s.effects);
    lanes[lane].appendChild(el);
  };
  note(0, 22, s.chordColor);
  note(1, 22, s.chordColor);
  note(0, 62, s.laneColors[0]);
  note(1, 92, s.laneColors[1]);
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
  txt($('custom.style.value'), settings().noteStyle);
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
  openModal($('custom'));
  refresh();
}

export function closeCustom() {
  queueSave();
  openSettings();
}

export function initCustomize() {
  for (const row of ROWS) {
    SWATCHES.forEach((c, i) => onClick(`custom.${row}.sw${i}`, () => setColor(row, c)));
    $(`custom.${row}.pick`).addEventListener('input', e => setColor(row, (e.target as HTMLInputElement).value));
  }
  const shiftStyle = (dir: number) => {
    const i = NOTE_STYLES.indexOf(settings().noteStyle);
    settings().noteStyle = NOTE_STYLES[(i + dir + NOTE_STYLES.length) % NOTE_STYLES.length];
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
    s.noteStyle = DEFAULT_SETTINGS.noteStyle;
    s.noteSize = DEFAULT_SETTINGS.noteSize;
    refresh();
    refreshSettings();
  });
  onClick('custom.done', closeCustom);
  onClick('custom.close', closeCustom);
}
