// Gameplay: one run of a chart. Port of the Roblox run loop (holds, mines, modifiers, judgments, HUD).
// Song time comes from the Web Audio clock so notes follow exactly what you hear.
import { cancel, ease, fade, pop, tween } from './anim.ts';
import type { AudioEngine } from './audio.ts';
import { JUDGMENTS, K, MINE_HIT, MISS, MODES, STYLES, T, type Judgment, type Mode, type Style } from './config.ts';
import { styleHold, styleNote } from './look.ts';
import { comboMultiplier, fmtTime, formatNumber, keyName, setMultiplier, setSummary } from './scoring.ts';
import type { Diff, Lane, PlaySet, Settings, Track } from './types.ts';
import { $, rgba, show, txt } from './ui.ts';

export interface RunOpts { set?: PlaySet; weekly?: number; practice?: { from: number; to: number | null } }

interface RunNote {
  time: number; lane: Lane; chord: boolean; endTime?: number; mine?: boolean;
  judged?: boolean; holding?: boolean; removeAt?: number;
  el?: HTMLElement; bar?: HTMLElement; body?: HTMLElement;
}

export interface Run {
  track: Track; chartDiff: Diff; opts?: RunOpts; set: PlaySet; mode: Mode; style: Style;
  chartEnd: number; startAt: number; practice: boolean; weekly?: number; summary: string;
  mult: number; unranked: boolean; auto: boolean; rate: number; beatLen: number;
  windows: [number, number, number]; damage: number; ghostPenalty: number;
  notes: RunNote[]; objects: number; fallSong: number; offset: number;
  spawnIndex: number; active: Record<number, RunNote[]>; holds: Record<number, RunNote | undefined>;
  errors: number[]; samples: number[]; missMarks: number[]; lastSample: number; playStart: number;
  score: number; combo: number; maxCombo: number; counts: [number, number, number, number]; judged: number; accSum: number; health: number;
  ready: boolean; paused: boolean; pausedAt: number; resumeAt?: number; ended: boolean; musicStarted: boolean;
  anchorPos: number; anchorCtx: number; buffer?: AudioBuffer;
}

export interface GameHooks {
  settings: () => Settings;
  onFinish: (run: Run, cleared: boolean) => void;
  onLoadFail: () => void;
  showGame: (setup: () => void, quick: boolean) => Promise<void>;
}

const LANE_X: Record<number, number> = { 1: 12, 2: 176 };
const LANE_W = 156;
const HIT_Y = 576 - 14 - 104 / 2; // receptor centre inside the lane
const LIGHTEN = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

export class Game {
  run: Run | null = null;
  private busy = false;
  private hudCenter = false;
  private judgeEl!: HTMLElement;
  private timingEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private held: Record<number, boolean> = { 1: false, 2: false };
  private cue: Record<number, number> = { 1: -1, 2: -1 };

  constructor(private audio: AudioEngine, private hooks: GameHooks) {
    this.applyHudLayout();
  }

  private laneColor(lane: Lane) { return this.hooks.settings().laneColors[lane - 1]; }

  /** paints buttons, beams and hit zones in the chosen lane colors */
  applyLook() {
    for (const lane of [1, 2] as Lane[]) {
      const c = this.laneColor(lane);
      const p = `game.pf.lane${lane}`;
      $(`${p}.rec`).style.boxShadow = `0 0 0 1.5px ${rgba(c, 0.45)}`;
      $(`${p}.rec.glow`).style.backgroundColor = c;
      $(`${p}.rec.heldglow`).style.backgroundColor = c;
      $(`${p}.beam`).style.backgroundImage = `linear-gradient(180deg, ${rgba(c, 1)} 0%, ${rgba(c, 0.85)} 55%, ${rgba(c, 0)} 100%)`;
      $(`${p}.held`).style.backgroundImage = `linear-gradient(180deg, ${rgba(c, 1)} 0%, ${rgba(c, 0.9)} 60%, ${rgba(c, 0.6)} 100%)`;
      for (const nm of ['good', 'great', 'perfect']) $(`${p}.zone.${nm}`).style.backgroundColor = c;
      this.cue[lane] = -1;
      this.setCue(lane, 0);
    }
  }

  // ---- clock ----
  songTime(r: Run): number {
    if (r.paused) return r.pausedAt;
    return r.anchorPos + (this.audio.now - this.audio.latency - r.anchorCtx) * r.rate;
  }

  // ---- HUD pieces ----
  applyHudLayout() {
    this.hudCenter = this.hooks.settings().centerHud;
    const center = { judgment: $('game.pf.judgment'), timing: $('game.pf.timing'), combo: $('game.pf.combo') };
    const side = { judgment: $('game.right.sidejudgment'), timing: $('game.right.sidetiming'), combo: $('game.right.sidecombo') };
    const on = this.hudCenter ? center : side, off = this.hudCenter ? side : center;
    this.judgeEl = on.judgment; this.timingEl = on.timing; this.comboEl = on.combo;
    for (const el of [on.judgment, on.timing, on.combo]) show(el, true);
    for (const el of [off.judgment, off.timing, off.combo]) show(el, false);
  }

  private setCountdown(text: string, small = false) {
    const el = $('game.pf.countdown');
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    txt(el, text);
    el.style.fontSize = small ? '34px' : '110px';
    if (text && !small) pop(el, 1.4, 0.25, ease.back);
  }

  private showJudgment(j: { name: string; color: string }, timing?: string, timingColor = T.muted, hold = 0.45) {
    const el = this.judgeEl, tel = this.timingEl;
    txt(el, j.name);
    el.style.color = j.color;
    el.style.opacity = '1';
    pop(el, 1.3, 0.12);
    txt(tel, timing ?? '');
    tel.style.color = timingColor;
    tel.style.opacity = '1';
    fade(el, 0, 0.3, hold);
    fade(tel, 0, 0.3, hold);
  }

  private setCombo(c: number, popIt = false) {
    const value = $(this.comboEl.dataset.path + '.value'), label = $(this.comboEl.dataset.path + '.label');
    if (c >= 3) {
      txt(value, String(c));
      show(label, true);
      value.style.color = rgba(c >= 100 ? T.pink : c >= 50 ? T.gold : T.text, this.hudCenter ? 0.55 : 0);
      if (popIt) pop(this.comboEl, c % 50 === 0 ? 1.45 : 1.1, 0.18);
    } else {
      txt(value, '');
      show(label, false);
    }
  }

  private accuracy(r: Run) { return r.judged === 0 ? 100 : r.accSum / r.judged; }

  private updateHud(r: Run) {
    txt($('game.right.score'), formatNumber(r.score));
    txt($('game.right.accuracy'), `${this.accuracy(r).toFixed(2)}%`);
    const mult = comboMultiplier(r.combo);
    const mf = $('game.right.mult');
    txt($('game.right.mult.text'), `x${mult}`);
    mf.style.backgroundColor = mult >= 4 ? T.gold : mult >= 2 ? T.bg3 : T.bg2;
    $('game.right.mult.text').style.color = mult >= 4 ? T.bg0 : T.text;
    (['perfect', 'great', 'good', 'miss'] as const).forEach((nm, i) => txt($(`game.right.counts.${nm}.value`), String(r.counts[i])));
    const hp = Math.min(1, Math.max(0, r.health / 100));
    const fill = $('game.health.fill');
    fill.style.height = `${hp * 100}%`;
    fill.style.backgroundColor = hp > 0.5 ? T.green : hp > 0.25 ? T.gold : T.red;
  }

  averageError(r: Run) {
    if (!r.errors.length) return null;
    return r.errors.reduce((a, b) => a + b, 0) / r.errors.length;
  }

  private setupMeter(r: Run) {
    $('game.right.timing.bar.ticks').innerHTML = '';
    $('game.right.timing.bar.great').style.width = `${(r.windows[1] / r.windows[2]) * 100}%`;
    $('game.right.timing.bar.perfect').style.width = `${(r.windows[0] / r.windows[2]) * 100}%`;
    txt($('game.right.timing.avg'), '');
  }

  private addTick(r: Run, errReal: number, color: string) {
    const ticks = $('game.right.timing.bar.ticks');
    if (ticks.children.length >= K.MAX_TICKS) ticks.firstElementChild?.remove();
    const tick = document.createElement('div');
    tick.className = 'tickmark';
    tick.style.left = `${Math.min(0.98, Math.max(0.02, 0.5 + errReal / (2 * r.windows[2]))) * 100}%`;
    tick.style.background = color;
    ticks.appendChild(tick);
    fade(tick, 0, 2.5, 0, ease.quad, () => tick.remove());
    const avg = this.averageError(r);
    if (avg !== null) {
      const ms = Math.round(Math.abs(avg) * 1000);
      txt($('game.right.timing.avg'), ms <= 3 ? 'avg on point' : `avg ${ms}ms ${avg < 0 ? 'early' : 'late'}`);
    }
  }

  private ring(lane: Lane, color: string) {
    if (!this.hooks.settings().effects) return;
    const r = document.createElement('div');
    r.className = 'ring';
    r.style.left = `${LANE_X[lane] + LANE_W / 2}px`;
    r.style.top = `${12 + HIT_Y}px`;
    $('game.pf.effects').appendChild(r);
    tween(r, 'ring', 0, 1, 0.35, k => {
      const size = 90 + 100 * k;
      r.style.width = r.style.height = `${size}px`;
      r.style.boxShadow = `0 0 0 ${6 - 5 * k}px ${rgba(color, k)}`;
    }, ease.quad, 0, () => r.remove());
  }

  pressFx(lane: Lane) {
    const rec = $(`game.pf.lane${lane}.rec`);
    pop(rec, 0.92, 0.15, ease.back);
    const glow = $(`game.pf.lane${lane}.rec.glow`);
    glow.style.opacity = '0.45';
    fade(glow, 0, 0.25);
    if (this.hooks.settings().effects) {
      const beam = $(`game.pf.lane${lane}.beam`);
      beam.style.opacity = '0.5';
      fade(beam, 0, 0.3);
    }
  }

  private flashReceptor(lane: Lane, color: string) {
    const rec = $(`game.pf.lane${lane}.rec`);
    const base = this.laneColor(lane);
    rec.style.boxShadow = `0 0 0 1.5px ${color}`;
    tween(rec, 'stroke', 0, 1, 0.35, () => {}, ease.quad, 0, () => { rec.style.boxShadow = `0 0 0 1.5px ${rgba(base, 0.45)}`; });
  }

  /** pixels per real second of timing error at the hit line */
  private pxPerSecond(r: Run) { return (HIT_Y / r.fallSong) * r.rate; }

  private setupZone(r: Run) {
    const on = this.hooks.settings().hitZone;
    const px = this.pxPerSecond(r);
    for (const lane of [1, 2] as Lane[]) {
      show($(`game.pf.lane${lane}.zone`), on);
      (['perfect', 'great', 'good'] as const).forEach((nm, i) => {
        $(`game.pf.lane${lane}.zone.${nm}`).style.height = `${Math.max(4, 2 * r.windows[i] * px)}px`;
      });
      this.cue[lane] = -1;
      this.setHeld(lane, false);
    }
  }

  private setHeld(lane: Lane, on: boolean) {
    this.held[lane] = on;
    $(`game.pf.lane${lane}`).classList.toggle('held', on);
  }

  /** the button's target line lights up as the next line enters the hit window */
  private setCue(lane: Lane, k: number) {
    const q = Math.round(k * 20) / 20;
    if (q === this.cue[lane]) return;
    this.cue[lane] = q;
    const target = $(`game.pf.lane${lane}.rec.target`);
    const color = this.laneColor(lane);
    target.style.height = `${3 + 2 * q}px`;
    target.style.backgroundColor = q > 0 ? LIGHTEN(color, 0.6 * q) : color;
    target.style.boxShadow = `0 0 ${8 + 14 * q}px ${rgba(color, 0.4 - 0.5 * q)}`;
    $(`game.pf.lane${lane}.rec`).style.backgroundColor = rgba(color, 0.94 - 0.08 * q);
  }

  /** a short mark where the line actually was when you hit it: above the button line = early, below = late */
  private hitMarker(lane: Lane, y: number, color: string) {
    if (!this.hooks.settings().hitZone) return;
    const m = document.createElement('div');
    m.className = 'marker';
    m.style.left = `${LANE_X[lane] + LANE_W / 2}px`;
    m.style.top = `${12 + y}px`;
    m.style.width = `${LANE_W - 30}px`;
    m.style.background = color;
    m.style.boxShadow = `0 0 10px ${color}`;
    $('game.pf.effects').appendChild(m);
    fade(m, 0, 0.45, 0.15, ease.quad, () => m.remove());
  }

  private makeNote(n: RunNote) {
    const lane = $(`game.pf.lane${n.lane}.notes`);
    const s = this.hooks.settings();
    const color = n.mine ? '#FF283C' : n.chord ? s.chordColor : this.laneColor(n.lane);
    const effects = s.effects;
    if (n.endTime !== undefined) {
      const body = document.createElement('div');
      body.className = 'hold';
      const cap = document.createElement('div');
      cap.className = 'cap';
      styleHold(body, cap, color, s.noteStyle);
      body.appendChild(cap);
      lane.appendChild(body);
      n.body = body;
    }
    const el = document.createElement('div');
    el.className = 'note';
    const bar = document.createElement('div');
    bar.className = 'bar';
    styleNote(el, bar, color, s.noteStyle, s.noteSize, effects);
    if (n.mine) {
      bar.style.background = 'linear-gradient(180deg, #5A000F, #280008)';
      bar.style.boxShadow = `0 0 0 2.5px ${color}`;
      const x = document.createElement('div');
      x.className = 'x';
      x.textContent = 'X X X';
      x.style.color = color;
      bar.appendChild(x);
    }
    el.appendChild(bar);
    el.style.transform = 'translate(-50%, -50%) translateY(-60px)';
    lane.appendChild(el);
    n.el = el;
    n.bar = bar;
  }

  private destroyNote(n: RunNote) {
    n.el?.remove();
    n.body?.remove();
    n.el = n.body = undefined;
  }

  private popNote(n: RunNote, y = HIT_Y) {
    const el = n.el;
    n.body?.remove();
    n.el = n.body = undefined;
    if (!el) return;
    el.style.transform = `translate(-50%, -50%) translateY(${y}px)`;
    tween(el, 'pop', 0, 1, 0.15, k => {
      el.style.transform = `translate(-50%, -50%) translateY(${y}px) scale(${1 + 0.14 * k}, ${1 + 0.6 * k})`;
      el.style.opacity = String(1 - k);
    }, ease.quad, 0, () => el.remove());
  }

  private fadeMissed(n: RunNote) {
    if (n.bar) { n.bar.style.background = T.red; n.bar.style.boxShadow = 'none'; }
    if (n.el) fade(n.el, 0, 0.25);
    if (n.body) { n.body.style.backgroundColor = rgba(T.red, 0.3); fade(n.body, 0, 0.25); }
  }

  // ---- scoring ----
  private scoreHit(r: Run, lane: Lane, level: number): Judgment {
    const j = JUDGMENTS[level];
    r.counts[level]++;
    r.judged++;
    r.accSum += j.acc;
    r.combo++;
    r.maxCombo = Math.max(r.maxCombo, r.combo);
    r.score += j.score * comboMultiplier(r.combo) * r.mult;
    if (!r.style.noHeal) r.health = Math.min(100, r.health + r.mode.heal[level]);
    this.setCombo(r.combo, true);
    this.ring(lane, j.color);
    this.updateHud(r);
    return j;
  }

  private scoreMiss(r: Run, damage: number) {
    r.counts[3]++;
    r.judged++;
    r.combo = 0;
    r.health -= damage;
    if (r.style.suddenDeath) r.health = 0;
    r.missMarks.push(r.samples.length + 1);
    this.showJudgment(MISS);
    this.setCombo(0);
    this.updateHud(r);
  }

  private judgeNote(r: Run, lane: Lane, n: RunNote, idx: number, t: number) {
    const errReal = (t - (n.time + r.offset)) / r.rate; // negative = early
    const ad = Math.abs(errReal);
    const level = ad <= r.windows[0] ? 0 : ad <= r.windows[1] ? 1 : 2;
    n.judged = true;
    const j = this.scoreHit(r, lane, level);
    if (!r.auto) {
      r.errors.push(errReal);
      this.addTick(r, errReal, j.color);
    }
    const ms = Math.round(ad * 1000);
    const timing = ms === 0 ? 'ON TIME' : `${errReal < 0 ? 'EARLY' : 'LATE'}  ${ms}ms`;
    this.showJudgment(j, timing, level === 0 ? T.muted : errReal < 0 ? T.cyan : T.pink);
    // where the line was when you pressed (it keeps falling, so late hits sit below the button line)
    const y = HIT_Y + errReal * this.pxPerSecond(r);
    if (!r.auto) this.hitMarker(lane, y, j.color);
    if (n.endTime !== undefined) {
      // hold: keep it in the lane until the tail passes the button
      n.holding = true;
      r.holds[lane] = n;
      return;
    }
    r.active[lane].splice(idx, 1);
    this.popNote(n, y);
  }

  private completeHold(r: Run, lane: Lane, n: RunNote) {
    n.holding = false;
    r.holds[lane] = undefined;
    const i = r.active[lane].indexOf(n);
    if (i >= 0) r.active[lane].splice(i, 1);
    const j = this.scoreHit(r, lane, 0);
    this.showJudgment(j, 'HOLD', T.gold);
    this.popNote(n);
  }

  private failHold(r: Run, lane: Lane, n: RunNote, t: number) {
    n.holding = false;
    r.holds[lane] = undefined;
    n.removeAt = t + 0.25 * r.rate;
    this.fadeMissed(n);
    this.flashReceptor(lane, T.red);
    this.scoreMiss(r, r.damage * 0.5);
  }

  private missNote(r: Run, n: RunNote, t: number) {
    n.judged = true;
    n.removeAt = t + 0.25 * r.rate;
    this.fadeMissed(n);
    this.flashReceptor(n.lane, T.red);
    this.scoreMiss(r, r.damage);
  }

  private explodeMine(r: Run, lane: Lane, mine: RunNote) {
    mine.judged = true;
    const i = r.active[lane].indexOf(mine);
    if (i >= 0) r.active[lane].splice(i, 1);
    this.destroyNote(mine);
    r.combo = 0;
    r.health -= K.MINE_DAMAGE;
    r.missMarks.push(r.samples.length + 1);
    this.showJudgment(MINE_HIT);
    this.setCombo(0);
    this.ring(lane, T.red);
    this.flashReceptor(lane, T.red);
    this.updateHud(r);
  }

  /** a press with no line in reach. `early` = seconds before the next line's window when one is close */
  private ghostPress(r: Run, early?: number) {
    if (early !== undefined) {
      this.showJudgment({ name: 'TOO EARLY', color: T.muted }, `${Math.round(early * 1000)}ms early`, T.cyan);
    }
    if (r.ghostPenalty <= 0) return;
    r.combo = 0;
    r.health -= r.ghostPenalty;
    if (early === undefined) this.showJudgment(MISS);
    this.setCombo(0);
    this.updateHud(r);
  }

  /** ageSeconds: how long ago the key actually went down (event timestamp correction) */
  press(lane: Lane, ageSeconds = 0) {
    // feedback first, before any judging work: sound + light on every press
    if (this.run?.ready && !this.run.paused && !this.run.auto) this.audio.playHit(this.hooks.settings().hitSound);
    this.setHeld(lane, true);
    this.pressFx(lane);
    const r = this.run;
    if (!r || !r.ready || r.paused || r.ended || r.auto) return;
    const t = this.songTime(r) - ageSeconds * r.rate;
    if (t < r.startAt) return;
    const list = r.active[lane];
    let target: RunNote | undefined, idx = -1, mine: RunNote | undefined;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.judged) continue;
      if (n.mine) {
        if (!mine && Math.abs(t - (n.time + r.offset)) / r.rate <= K.MINE_WINDOW) mine = n;
      } else if (!target) {
        target = n; idx = i;
      }
      if (target && (mine || (n.time + r.offset - t) / r.rate > 0.3)) break;
    }
    const targetErr = target ? Math.abs(t - (target.time + r.offset)) / r.rate : Infinity;
    const targetOk = target !== undefined && targetErr <= r.windows[2];
    if (mine && (!targetOk || Math.abs(t - (mine.time + r.offset)) / r.rate < targetErr)) this.explodeMine(r, lane, mine);
    else if (targetOk && target) this.judgeNote(r, lane, target, idx, t);
    else {
      const ahead = target ? (target.time + r.offset - t) / r.rate : Infinity;
      this.ghostPress(r, ahead > 0 && ahead <= 0.3 ? ahead : undefined);
    }
  }

  release(lane: Lane, ageSeconds = 0) {
    this.setHeld(lane, false);
    const r = this.run;
    if (!r || !r.ready || r.paused || r.ended || r.auto) return;
    const h = r.holds[lane];
    if (h && h.holding && h.endTime !== undefined) {
      const t = this.songTime(r) - ageSeconds * r.rate;
      if (t >= h.endTime + r.offset - r.mode.tailTol * r.rate) this.completeHold(r, lane, h);
      else this.failHold(r, lane, h, t);
    }
  }

  // ---- lifecycle ----
  stop() {
    const r = this.run;
    this.run = null;
    for (const lane of [1, 2] as Lane[]) {
      $(`game.pf.lane${lane}.notes`).innerHTML = '';
      this.setHeld(lane, false);
      this.setCue(lane, 0);
    }
    $('game.pf.effects').innerHTML = '';
    $('game.right.timing.bar.ticks').innerHTML = '';
    show($('game.pf.flashlight'), false);
    this.setCountdown('');
    if (r) this.audio.stop();
  }

  private buildRunNotes(track: Track, diff: Diff, set: PlaySet, from: number, to: number) {
    const chart = track.charts[diff]!;
    const notes: RunNote[] = [];
    const rng = Math.random;
    const holdUntil: Record<number, number> = { 1: -Infinity, 2: -Infinity };
    for (const n of chart.notes) {
      if (n.time < from - 0.001 || n.time > to + 0.001) continue;
      let lane = n.lane;
      if (set.mirror) lane = (3 - lane) as Lane;
      if (set.random && !n.chord) {
        lane = (rng() < 0.5 ? 1 : 2) as Lane;
        // never drop a note under a hold that's still going
        if (n.time <= holdUntil[lane]) lane = (3 - lane) as Lane;
      }
      const copy: RunNote = { time: n.time, lane, chord: n.chord, endTime: n.endTime };
      if (copy.endTime !== undefined) holdUntil[lane] = copy.endTime;
      notes.push(copy);
    }
    if (set.mines) {
      const s16 = 60 / track.bpm / 4;
      const mines: RunNote[] = [];
      for (const lane of [1, 2] as Lane[]) {
        const list = notes.filter(n => n.lane === lane);
        for (let i = 0; i < list.length - 1; i++) {
          const a = list[i], b = list[i + 1];
          const aEnd = a.endTime ?? a.time;
          if (b.time - aEnd >= 0.5 && rng() < 0.4) {
            const mid = (aEnd + b.time) / 2;
            const snapped = track.offset + Math.round((mid - track.offset) / s16) * s16;
            if (snapped - aEnd >= 0.18 && b.time - snapped >= 0.18) mines.push({ time: snapped, lane, chord: false, mine: true });
          }
        }
      }
      notes.push(...mines);
      notes.sort((x, y) => x.time - y.time);
    }
    const objects = notes.reduce((sum, n) => sum + (n.mine ? 0 : n.endTime !== undefined ? 2 : 1), 0);
    return { notes, objects };
  }

  async start(track: Track, diff: Diff, quick: boolean, opts: RunOpts | undefined, set: PlaySet) {
    if (this.busy) return;
    const chart = track.charts[diff] ?? track.charts[track.difficulty]!;
    diff = chart.diff;
    this.busy = true;
    this.stop();
    const settings = this.hooks.settings();
    const mode = MODES[diff];
    const style = STYLES[set.style];
    const { mult, unranked } = setMultiplier(set);
    const rate = set.rate;
    const windows = mode.windows.map(w => w * (style.windowScale ?? 1)) as [number, number, number];
    let ghost = mode.ghostPenalty;
    if (style.ghostMin) ghost = Math.max(ghost, style.ghostMin);
    if (style.noGhost) ghost = 0;

    const chartStart = track.chartStart ?? 0;
    let from = chartStart, to = Infinity;
    if (style.practice) {
      const length = chart.endTime - chartStart;
      from = chartStart + Math.min(Math.max(opts?.practice?.from ?? 0, 0), length);
      to = chartStart + Math.min(opts?.practice?.to ?? length, length);
    }
    const { notes, objects } = this.buildRunNotes(track, diff, set, from, to);
    const lastNote = notes[notes.length - 1];
    let chartEnd = lastNote ? (lastNote.endTime ?? lastNote.time) : chart.endTime;
    if (style.practice) chartEnd = Math.min(chartEnd, to);

    const r: Run = {
      track, chartDiff: diff, opts, set, mode, style, chartEnd,
      startAt: style.practice ? Math.max(0, from - 0.5) : chartStart,
      practice: !!style.practice, weekly: opts?.weekly,
      summary: (opts?.weekly !== undefined ? 'WEEKLY  ·  ' : '') + setSummary(set),
      mult, unranked, auto: set.auto, rate, beatLen: 60 / track.bpm, windows,
      damage: mode.missDamage * (style.damageScale ?? 1), ghostPenalty: ghost,
      notes, objects, fallSong: (mode.fall / settings.scrollSpeed) * rate, offset: (settings.offset / 1000) * rate,
      spawnIndex: 0, active: { 1: [], 2: [] }, holds: {},
      errors: [], samples: [], missMarks: [], lastSample: 0, playStart: performance.now(),
      score: 0, combo: 0, maxCombo: 0, counts: [0, 0, 0, 0], judged: 0, accSum: 0, health: 100,
      ready: false, paused: false, pausedAt: 0, ended: false, musicStarted: false, anchorPos: 0, anchorCtx: 0,
    };
    this.run = r;

    const setupHud = () => {
      txt($('game.left.title'), track.title);
      txt($('game.left.artist'), `${track.artist}  ·  ${Math.round(track.displayBpm * rate)} BPM`);
      $('game.left.pill').style.backgroundColor = mode.color;
      txt($('game.left.pill.text'), mode.label);
      txt($('game.left.style'), r.summary);
      $('game.left.style').style.color = unranked ? T.red : r.weekly !== undefined ? T.gold : T.muted;
      $('game.left.progress.fill').style.width = '0%';
      txt($('game.left.time'), `0:00 / ${fmtTime(chartEnd - r.startAt)}`);
      for (const lane of [1, 2] as Lane[]) {
        txt($(`game.pf.lane${lane}.rec.key`), keyName(settings.keys[lane - 1]));
        if (lane === 1) this.applyLook();
      }
      show($('game.pf.flashlight'), set.flashlight);
      show($('game.left.versus'), false);
      this.applyHudLayout();
      this.setCombo(0);
      txt(this.judgeEl, '');
      txt(this.timingEl, '');
      this.setupMeter(r);
      this.setupZone(r);
      this.updateHud(r);
      this.setCountdown('LOADING', true);
    };
    await this.hooks.showGame(setupHud, quick);
    this.busy = false;
    if (this.run !== r) return;

    let buffer: AudioBuffer;
    try {
      buffer = await this.audio.load(track.song);
    } catch {
      if (this.run === r) { this.stop(); this.hooks.onLoadFail(); }
      return;
    }
    if (this.run !== r) return;
    if (this.audio.ctx?.state !== 'running') {
      // browsers block sound until the player clicks or presses a key
      this.setCountdown('CLICK TO START', true);
      await this.audio.whenRunning();
      if (this.run !== r) return;
    }
    r.buffer = buffer;
    // a quick restart skips most of the countdown
    const lead = quick ? 1.5 : K.LEAD_IN;
    r.anchorPos = r.startAt;
    r.anchorCtx = this.audio.now + lead;
    this.audio.start(buffer, r.anchorCtx, r.startAt, rate, 1);
    r.musicStarted = true;
    r.ready = true;
  }

  pause(): boolean {
    const r = this.run;
    if (!r || !r.ready || r.ended) return false;
    if (r.paused && r.resumeAt === undefined) return false;
    if (!r.paused) {
      r.pausedAt = this.songTime(r);
      r.paused = true;
      // be generous: holds in progress count as completed
      for (const lane of [1, 2] as Lane[]) {
        const h = r.holds[lane];
        if (h && h.holding) this.completeHold(r, lane, h);
      }
    }
    r.resumeAt = undefined;
    this.audio.stop();
    this.setCountdown('');
    this.setHeld(1, false);
    this.setHeld(2, false);
    return true;
  }

  resume() {
    const r = this.run;
    if (!r || !r.paused) return;
    r.resumeAt = performance.now() / 1000 + 1.5;
  }

  /** called every animation frame */
  step() {
    const r = this.run;
    if (!r || !r.ready) return;
    let t = this.songTime(r);

    if (r.paused) {
      // resume countdown after unpausing
      if (r.resumeAt !== undefined) {
        const left = r.resumeAt - performance.now() / 1000;
        if (left <= 0) {
          r.resumeAt = undefined;
          r.paused = false;
          r.anchorPos = r.pausedAt;
          r.anchorCtx = this.audio.now + this.audio.latency;
          if (r.buffer) this.audio.start(r.buffer, this.audio.now, r.pausedAt, r.rate, 1);
          this.setCountdown('');
          t = this.songTime(r);
        } else {
          this.setCountdown(String(Math.ceil(left / 0.5)));
        }
      }
    } else {
      if (t < r.startAt) this.setCountdown(String(Math.ceil((r.startAt - t) / r.rate)));
      else if (t < r.startAt + 0.5 * r.rate) this.setCountdown(r.practice ? 'PRACTICE' : 'GO!', r.practice);
      else this.setCountdown('');
      // health samples for the results graph
      if (t >= r.startAt && performance.now() - r.lastSample >= 250) {
        r.lastSample = performance.now();
        r.samples.push(Math.min(100, Math.max(0, r.health)));
      }
    }

    // spawn lines entering the top of the lanes
    while (r.spawnIndex < r.notes.length) {
      const n = r.notes[r.spawnIndex];
      if (n.time + r.offset - r.fallSong > t) break;
      this.makeNote(n);
      r.active[n.lane].push(n);
      r.spawnIndex++;
    }

    // autoplay hits each line exactly on time (and holds every hold)
    if (r.auto && !r.paused && !r.ended) {
      for (const lane of [1, 2] as Lane[]) {
        const list = r.active[lane];
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.judged || n.mine) continue;
          const nt = n.time + r.offset;
          if (t >= nt) {
            this.pressFx(lane);
            this.audio.playHit(this.hooks.settings().hitSound);
            this.judgeNote(r, lane, n, i, nt);
          }
          break;
        }
      }
    }

    // move lines, finish holds, catch misses
    const effects = this.hooks.settings().effects;
    for (const lane of [1, 2] as Lane[]) {
      const list = r.active[lane];
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        const nt = n.time + r.offset;
        if (n.mine) {
          if (!n.judged && (t - nt) / r.rate > K.MINE_WINDOW) { n.judged = true; n.removeAt = t; }
        } else if (!n.judged && (t - nt) / r.rate > r.windows[2]) {
          this.missNote(r, n, t);
        }
        if (n.holding && n.endTime !== undefined && t >= n.endTime + r.offset) {
          this.completeHold(r, lane, n);
        } else if (n.removeAt !== undefined && t >= n.removeAt) {
          this.destroyNote(n);
          list.splice(i, 1);
        } else if (n.el) {
          const progress = 1 - (nt - t) / r.fallSong;
          let y = n.holding ? HIT_Y : progress * HIT_Y;
          if (r.set.wave && !n.holding) y += Math.sin((t / r.beatLen) * Math.PI) * 26 * Math.min(1, Math.max(0, 1 - progress));
          n.el.style.transform = `translate(-50%, -50%) translateY(${y}px)`;
          if (n.body && n.endTime !== undefined) {
            const tailY = (1 - (n.endTime + r.offset - t) / r.fallSong) * HIT_Y;
            n.body.style.transform = `translateX(-50%) translateY(${tailY}px)`;
            n.body.style.height = `${Math.max(0, y - tailY)}px`;
          }
          if ((r.set.hidden || r.set.sudden) && !n.judged) {
            let vis = 1;
            if (r.set.hidden) vis *= 1 - Math.min(1, Math.max(0, (progress - 0.4) / 0.22));
            if (r.set.sudden) vis *= Math.min(1, Math.max(0, (progress - 0.3) / 0.2));
            n.el.style.opacity = String(vis);
            if (n.body) n.body.style.opacity = String(vis);
          }
        }
      }
      // approach cue on the button's target line
      let cue = 0;
      if (r.holds[lane]) cue = 1;
      else if (!r.paused) {
        const next = list.find(n => !n.judged && !n.mine);
        if (next) cue = Math.max(0, 1 - Math.abs(t - (next.time + r.offset)) / r.rate / r.windows[2]);
      }
      this.setCue(lane, cue);
      // a held lane stays lit
      if (r.holds[lane]) {
        const glow = $(`game.pf.lane${lane}.rec.glow`);
        cancel(glow);
        glow.style.opacity = '0.35';
        if (effects) {
          const beam = $(`game.pf.lane${lane}.beam`);
          cancel(beam);
          beam.style.opacity = '0.3';
        }
      }
    }

    const total = r.chartEnd + r.offset;
    $('game.left.progress.fill').style.width = `${Math.min(1, Math.max(0, (t - r.startAt) / (total - r.startAt))) * 100}%`;
    txt($('game.left.time'), `${fmtTime(t - r.startAt)} / ${fmtTime(r.chartEnd - r.startAt)}`);

    if (r.health <= 0 && !r.style.noFail) {
      r.health = 0;
      this.updateHud(r);
      this.finish(r, false);
    } else if (r.spawnIndex >= r.notes.length && !r.active[1].length && !r.active[2].length && t > total + 0.3 * r.rate) {
      this.finish(r, true);
    }
  }

  private finish(r: Run, cleared: boolean) {
    if (r.ended) return;
    r.ended = true;
    if (r.practice) {
      // practice loops the section until you quit
      this.showJudgment({ name: 'LOOP', color: T.cyan }, `again from ${fmtTime(r.startAt - (r.track.chartStart ?? 0))}`, T.muted, 0.6);
      setTimeout(() => { if (this.run === r) void this.start(r.track, r.chartDiff, true, r.opts, r.set); }, 900);
      return;
    }
    if (cleared) {
      const fc = r.counts[3] === 0;
      this.showJudgment({ name: fc ? 'FULL COMBO!' : 'CLEAR!', color: fc ? T.gold : T.green }, undefined, T.muted, 2);
      this.audio.fade(0, 1.5);
    } else {
      this.showJudgment({ name: 'FAILED', color: T.red }, `press ${keyName(this.hooks.settings().keys[2])} to retry`, T.muted, 2);
      this.audio.failSlowdown(1.4);
    }
    setTimeout(() => {
      if (this.run !== r) return;
      this.hooks.onFinish(r, cleared);
    }, 1700);
  }

  accuracyOf(r: Run) { return this.accuracy(r); }
}
