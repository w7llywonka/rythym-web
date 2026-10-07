// Play style panel: style presets, song speed, practice section and modifiers.
import { MOD_INFO, MOD_ORDER, RATES, STYLE_ORDER, STYLES, T } from '../config.ts';
import { currentSet, fmtTime, rateText, setMultiplier } from '../scoring.ts';
import { $, rgba, txt } from '../ui.ts';
import { queueSave } from './save.ts';
import { refreshStyleButton } from './select.ts';
import { closeModal, onClick, openModal, setToggle } from './shell.ts';
import { S, chartFor, settings } from './state.ts';

function chartLength() {
  const t = S.selectedSong[S.tab];
  return t ? chartFor(t).endTime - (t.chartStart ?? 0) : 60;
}

function refresh() {
  for (const name of STYLE_ORDER) {
    const id = `style.styles.${name.toLowerCase()}`;
    const st = STYLES[name];
    const sel = settings().style === name;
    $(id).style.backgroundColor = sel ? T.bg2 : T.bg1;
    $(id).style.boxShadow = `0 0 0 1px ${sel ? rgba(T.text, 0.5) : T.line}`;
    txt($(`${id}.mult`), st.unranked ? 'NO SAVE' : `x${st.mult.toFixed(2)}`);
    $(`${id}.mult`).style.color = st.unranked ? T.red : T.gold;
  }
  txt($('style.speed.value'), rateText(settings().rate));
  // practice section (only used by the Practice style)
  const length = chartLength();
  const to = Math.min(S.practice.to ?? length, length);
  S.practice.from = Math.min(Math.max(S.practice.from, 0), Math.max(0, to - 5));
  txt($('style.practice.fromvalue'), `from ${fmtTime(S.practice.from)}`);
  txt($('style.practice.tovalue'), `to ${fmtTime(to)}`);
  $('style.practice').style.opacity = settings().style === 'Practice' ? '1' : '0.55';
  for (const name of MOD_ORDER) {
    const key = MOD_INFO[name].key;
    setToggle($(`style.mods.${name.toLowerCase()}.toggle`), key === 'auto' ? S.autoplay : settings()[key]);
  }
  const { mult, unranked } = setMultiplier(currentSet(settings(), S.autoplay));
  txt($('style.footer.value'), `x${mult.toFixed(2)}`);
  txt($('style.footer.note'), unranked ? "Scores won't be saved" : '');
  refreshStyleButton();
}

export function openStyle() {
  openModal($('style'));
  refresh();
}

export function closeStyle() {
  closeModal();
  refreshStyleButton();
  queueSave();
}

function shiftPractice(field: 'from' | 'to', dir: number) {
  const length = chartLength();
  const to = S.practice.to ?? length;
  if (field === 'from') S.practice.from = Math.min(Math.max(S.practice.from + dir * 5, 0), Math.max(0, to - 5));
  else S.practice.to = Math.min(Math.max(to + dir * 5, S.practice.from + 5), length);
  settings().style = 'Practice';
  refresh();
}

export function initStylePanel() {
  for (const name of STYLE_ORDER) onClick(`style.styles.${name.toLowerCase()}`, () => { settings().style = name; refresh(); });
  const shiftRate = (dir: number) => {
    const i = RATES.indexOf(settings().rate);
    settings().rate = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
    refresh();
  };
  onClick('style.speed.minus', () => shiftRate(-1));
  onClick('style.speed.plus', () => shiftRate(1));
  onClick('style.practice.fromminus', () => shiftPractice('from', -1));
  onClick('style.practice.fromplus', () => shiftPractice('from', 1));
  onClick('style.practice.tominus', () => shiftPractice('to', -1));
  onClick('style.practice.toplus', () => shiftPractice('to', 1));
  for (const name of MOD_ORDER) {
    const key = MOD_INFO[name].key;
    onClick(`style.mods.${name.toLowerCase()}.toggle`, () => {
      if (key === 'auto') S.autoplay = !S.autoplay; else settings()[key] = !settings()[key];
      refresh();
    });
  }
  onClick('style.close', closeStyle);
  onClick('style.footer.done', closeStyle);
}
