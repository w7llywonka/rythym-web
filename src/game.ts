import type { Song, Settings, Note, Lane, Judgment, GameCallbacks } from './types.ts';
import { AudioEngine } from './audio.ts';
import { generateChart } from './chart.ts';
import { initialStats, applyJudgment, judge, windows, resultFor } from './scoring.ts';

export class Game {
  readonly song: Song;
  readonly settings: Settings;
  private audio: AudioEngine;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: GameCallbacks;
  private notes: Note[];
  private stats = initialStats();
  private state: 'loading' | 'playing' | 'paused' | 'failing' | 'finished' = 'loading';
  private raf = 0;
  private position = 0;
  private failAt = 0;
  private lastHud = -1;
  private flashes = [-10, -10];
  private rings: { lane: Lane; at: number; color: string }[] = [];
  private feedback: { judgment: Judgment; delta: number; at: number } | null = null;
  private width = 0;
  private height = 0;
  private observer: ResizeObserver;

  constructor(song: Song, settings: Settings, canvas: HTMLCanvasElement, audio: AudioEngine, callbacks: GameCallbacks) {
    this.song = song;
    this.settings = structuredClone(settings);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.audio = audio;
    this.callbacks = callbacks;
    this.notes = generateChart(song).map(note => ({ ...note }));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerdown', this.onPointer);
  }

  async start() {
    this.audio.setVolume(this.settings.volume);
    await this.audio.play(this.song, 0, 3, () => this.state !== 'finished');
    if (this.state === 'finished') return;
    this.state = 'playing';
    this.callbacks.onStats(this.stats, 0);
    this.frame();
  }

  private get time() {
    // Negative offsets bring the targets earlier; positive offsets delay them.
    return this.audio.time - this.settings.offsetMs / 1000;
  }
  private isFinished() { return this.state === 'finished'; }

  private resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = box.width;
    this.height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(box.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private onKey = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.state === 'playing') this.pause();
      return;
    }
    const index = this.settings.keys.indexOf(event.key.toLowerCase());
    if (index >= 0 && this.state === 'playing') {
      event.preventDefault();
      this.hit(index as Lane, event.timeStamp);
    }
  };
  private onPointer = (event: PointerEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-lane]');
    if (!button || this.state !== 'playing') return;
    event.preventDefault();
    this.hit(Number(button.dataset.lane) as Lane, event.timeStamp);
  };
  private onBlur = () => { if (this.state === 'playing') this.pause(); };
  private onVisibility = () => { if (document.hidden) this.onBlur(); };

  hit(lane: Lane, timestamp = performance.now()) {
    if (this.state !== 'playing' || this.audio.countdown > 0 || this.time < 0) return;
    const age = performance.now() - timestamp;
    const time = this.time - (age >= 0 && age < 1000 ? age / 1000 : 0);
    this.flashes[lane] = this.audio.clock;
    const button = document.querySelector<HTMLElement>(`[data-lane="${lane}"]`);
    button?.classList.add('pressed');
    this.expireNotes(time);
    if (this.state !== 'playing') return;
    const note = this.notes.find(note => note.lane === lane && !note.judged);
    if (!note) return;
    const delta = time - note.time;
    if (Math.abs(delta) > windows.Good) return;
    const judgment = judge(delta);
    note.judged = judgment;
    applyJudgment(this.stats, judgment);
    this.feedback = { judgment, delta, at: this.audio.clock };
    if (this.settings.effects) this.rings.push({ lane, at: this.audio.clock, color: colors[judgment] });
    this.callbacks.onStats(this.stats, Math.max(0, this.audio.time));
  }

  private expireNotes(time: number) {
    for (const note of this.notes) {
      if (note.time >= time - windows.Good) break;
      if (!note.judged) {
        note.judged = 'Miss';
        applyJudgment(this.stats, 'Miss');
        this.feedback = { judgment: 'Miss', delta: 0, at: this.audio.clock };
        if (this.stats.health <= 0) {
          this.state = 'failing';
          this.failAt = this.audio.clock;
          this.audio.fail();
          break;
        }
      }
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.position = this.audio.pause();
    this.state = 'paused';
    this.callbacks.onPause();
  }
  async resume() {
    if (this.state !== 'paused') return;
    this.state = 'loading';
    await this.audio.play(this.song, this.position, 2, () => this.state !== 'finished');
    if (this.isFinished()) return;
    this.state = 'playing';
  }
  private finish(failed: boolean) {
    if (this.state === 'finished') return;
    this.state = 'finished';
    const result = resultFor(this.stats, this.song.id, failed);
    this.dispose();
    this.callbacks.onResult(result);
  }

  private frame = () => {
    if (this.state === 'finished') return;
    if (this.state === 'playing') {
      if (this.audio.context?.state !== 'running') this.pause();
      else if (this.audio.countdown <= 0) {
        this.expireNotes(this.time);
        if (this.state === 'playing' && this.audio.time > this.song.duration + .35) this.finish(false);
      }
    }
    if (this.isFinished()) return;
    if (this.state === 'failing' && (this.audio.clock - this.failAt > 1.3 || this.audio.context?.state !== 'running')) { this.finish(true); return; }
    if (this.audio.clock - this.lastHud > .05) {
      this.callbacks.onStats(this.stats, Math.max(0, this.audio.time));
      this.lastHud = this.audio.clock;
    }
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const c = this.ctx, w = this.width, h = this.height;
    if (!w || !h) return;
    const time = this.time, clock = this.audio.clock;
    const hitY = h * .84;
    const margin = w * .095, gap = w * .045, laneW = (w - margin * 2 - gap) / 2;
    const fallTime = 2.2 / this.settings.scrollSpeed;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#080f20'; c.fillRect(0, 0, w, h);
    const beat = ((Math.max(0, time - this.song.analysis.offset) * this.song.bpm / 60) % 1);
    const pulse = this.settings.effects ? Math.pow(1 - beat, 5) : 0;
    const gradient = c.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(0,210,255,.01)'); gradient.addColorStop(1, 'rgba(0,210,255,.06)');
    for (let lane = 0; lane < 2; lane++) {
      const x = margin + lane * (laneW + gap);
      c.fillStyle = gradient; c.fillRect(x, 0, laneW, h);
      c.strokeStyle = lane ? '#30263c' : '#193647'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.moveTo(x + laneW, 0); c.lineTo(x + laneW, h); c.stroke();
      if (this.settings.effects && clock - this.flashes[lane] < .16) {
        const glow = c.createLinearGradient(0, hitY - h * .45, 0, h);
        glow.addColorStop(0, 'transparent'); glow.addColorStop(1, lane ? 'rgba(255,79,160,.2)' : 'rgba(0,210,255,.2)');
        c.fillStyle = glow; c.fillRect(x, 0, laneW, h);
      } else document.querySelector(`[data-lane="${lane}"]`)?.classList.remove('pressed');
    }
    for (let line = 0; line < 8; line++) {
      const y = ((line * h / 7 + time * 35) % h + h) % h;
      c.strokeStyle = 'rgba(130,153,187,.05)'; c.beginPath(); c.moveTo(margin, y); c.lineTo(w - margin, y); c.stroke();
    }
    if (this.stats.combo > 1) {
      c.textAlign = 'center'; c.fillStyle = 'rgba(158,183,217,.055)';
      c.font = `900 ${Math.min(w * .36, 150)}px system-ui`; c.fillText(String(this.stats.combo), w / 2, h * .48);
      c.font = '700 10px system-ui'; c.fillStyle = 'rgba(158,183,217,.18)'; c.fillText('COMBO', w / 2, h * .48 + 22);
    }
    for (const note of this.notes) {
      if (note.judged || note.time - time > fallTime || time - note.time > .2) continue;
      const y = (1 - (note.time - time) / fallTime) * hitY;
      const x = margin + note.lane * (laneW + gap) + 8;
      const color = note.chord ? '#ffd25a' : note.lane ? '#ff4fa0' : '#00d2ff';
      c.fillStyle = color; c.shadowColor = color; c.shadowBlur = this.settings.effects ? 16 : 0;
      c.beginPath(); c.roundRect(x, y - 12, laneW - 16, 24, 6); c.fill();
      c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(x + 7, y - 8, laneW - 30, 2);
    }
    c.lineWidth = 2;
    for (let lane = 0; lane < 2; lane++) {
      const x = margin + lane * (laneW + gap);
      c.strokeStyle = lane ? '#ff4fa0' : '#00d2ff'; c.shadowColor = c.strokeStyle; c.shadowBlur = this.settings.effects ? 12 : 0;
      c.beginPath(); c.moveTo(x, hitY); c.lineTo(x + laneW, hitY); c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = lane ? '#ff4fa0' : '#00d2ff'; c.textAlign = 'center'; c.font = '800 18px system-ui';
      c.fillText(this.settings.keys[lane].toUpperCase(), x + laneW / 2, hitY + 41);
    }
    this.rings = this.rings.filter(ring => clock - ring.at < .4);
    for (const ring of this.rings) {
      const age = (clock - ring.at) / .4;
      c.strokeStyle = ring.color; c.globalAlpha = 1 - age; c.lineWidth = 2;
      c.beginPath(); c.ellipse(margin + ring.lane * (laneW + gap) + laneW / 2, hitY, 16 + age * laneW / 2, 8 + age * 35, 0, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    if (this.feedback && clock - this.feedback.at < .65) {
      c.textAlign = 'center'; c.fillStyle = colors[this.feedback.judgment]; c.font = '900 23px system-ui';
      c.fillText(this.feedback.judgment.toUpperCase(), w / 2, h * .62);
      if (this.feedback.judgment !== 'Miss' && Math.abs(this.feedback.delta) > .012) {
        c.font = '700 10px system-ui'; c.fillStyle = '#8898b2';
        c.fillText(this.feedback.delta < 0 ? 'EARLY' : 'LATE', w / 2, h * .62 + 20);
      }
    }
    if (this.state === 'playing' && this.audio.countdown > 0) {
      c.fillStyle = 'rgba(5,10,22,.55)'; c.fillRect(0, 0, w, h);
      c.textAlign = 'center'; c.font = '900 100px system-ui'; c.fillStyle = '#fff';
      c.fillText(String(Math.ceil(this.audio.countdown)), w / 2, h * .48);
      c.font = '700 11px system-ui'; c.fillStyle = '#00d2ff'; c.fillText('FIND YOUR RHYTHM', w / 2, h * .48 + 37);
    }
    c.strokeStyle = `rgba(0,210,255,${.06 + pulse * .38})`; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
  }

  dispose() {
    this.state = 'finished';
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.observer.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerdown', this.onPointer);
  }
}
const colors: Record<Judgment, string> = { Perfect: '#ffd25a', Great: '#00d2ff', Good: '#3ddc84', Miss: '#ff5a6e' };
