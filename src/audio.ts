// Music + hit sounds on the Web Audio clock. The game reads song time straight from
// AudioContext.currentTime, so notes stay locked to what you hear.
import { renderSong } from './synthesis.ts';
import type { HitSound, Song } from './types.ts';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hitBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private hitBuffers = new Map<HitSound, AudioBuffer>();
  private volume = 0.8;
  /** ctx time at which `playOffset` of the track is heard, and the playback rate */
  private playStart = 0;
  private playOffset = 0;
  private rate = 1;
  private loopStart = 0;
  private loopLength = 0;
  playing = false;
  token = 0;

  async unlock(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.hitBus = this.ctx.createGain();
      this.hitBus.connect(this.ctx.destination);
      this.buildHitSounds();
      this.setVolume(this.volume);
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* resumes on the next gesture */ }
    }
    return this.ctx;
  }

  /** Resolves once the browser lets audio play (after the first click / key press). */
  whenRunning(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return Promise.resolve();
    return new Promise(resolve => {
      const check = () => { if (ctx.state === 'running') { ctx.removeEventListener('statechange', check); resolve(); } };
      ctx.addEventListener('statechange', check);
    });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // what you hear lags the audio clock by the processing (base) latency plus the device (output) latency
  get latency() { return this.ctx ? (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) : 0; }
  get now() { return this.ctx?.currentTime ?? 0; }

  load(song: Song): Promise<AudioBuffer> {
    let p = this.buffers.get(song.id);
    if (!p) {
      p = this.unlock().then(ctx => renderSong(song, ctx));
      this.buffers.set(song.id, p);
      p.catch(() => this.buffers.delete(song.id));
    }
    return p;
  }

  hasBuffer(id: string) { return this.buffers.has(id); }
  registerBuffer(id: string, buffer: AudioBuffer) { this.buffers.set(id, Promise.resolve(buffer)); }

  /** Starts `buffer` so that track position `offset` plays at ctx time `when`. */
  start(buffer: AudioBuffer, when: number, offset: number, rate = 1, gain = 1, loop?: { start: number; end: number }) {
    const ctx = this.ctx!;
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master!);
    if (loop) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
      this.loopStart = loop.start;
      this.loopLength = loop.end - loop.start;
    } else {
      this.loopLength = 0;
    }
    const startAt = Math.max(ctx.currentTime, when);
    // if we're already past `when`, skip ahead in the track instead of starting late
    const skip = Math.max(0, ctx.currentTime - when) * rate;
    src.start(startAt, Math.max(0, Math.min(buffer.duration - 0.01, offset + skip)));
    this.source = src;
    this.gainNode = g;
    this.playStart = when;
    this.playOffset = offset;
    this.rate = rate;
    this.playing = true;
  }

  /** Track position currently being heard (seconds of the song). */
  position(): number {
    if (!this.ctx || !this.playing) return this.playOffset;
    let p = this.playOffset + (this.ctx.currentTime - this.latency - this.playStart) * this.rate;
    if (this.loopLength > 0 && p > this.loopStart) p = this.loopStart + ((p - this.loopStart) % this.loopLength);
    return p;
  }

  fade(to: number, seconds: number) {
    if (!this.ctx || !this.gainNode) return;
    const g = this.gainNode.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (seconds <= 0) g.setValueAtTime(to, t); else g.linearRampToValueAtTime(to, t + seconds);
  }

  /** failure effect: the record slows down and fades out */
  failSlowdown(seconds: number) {
    if (!this.ctx || !this.source) return;
    const t = this.ctx.currentTime;
    const r = this.source.playbackRate;
    r.cancelScheduledValues(t);
    r.setValueAtTime(r.value, t);
    r.exponentialRampToValueAtTime(Math.max(0.05, r.value * 0.35), t + seconds);
    this.fade(0, seconds);
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already ended */ }
      this.source.disconnect();
      this.source = null;
    }
    this.gainNode?.disconnect();
    this.gainNode = null;
    this.playing = false;
  }

  // ---- hit sounds: synthesized so there are no third-party samples ----
  private buildHitSounds() {
    const ctx = this.ctx!;
    const make = (seconds: number, fn: (t: number) => number) => {
      const length = Math.ceil(seconds * ctx.sampleRate);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = fn(i / ctx.sampleRate);
      return { buffer };
    };
    const tick = make(0.05, t => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.008) * 0.8);
    const mania = make(0.09, t => Math.sign(Math.sin(2 * Math.PI * 880 * t)) * Math.exp(-t / 0.018) * 0.35);
    const kick = make(0.18, t => Math.sin(2 * Math.PI * (55 * t + 95 * 0.03 * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.06) * 0.9);
    let seed = 99;
    const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2147483648) - 1;
    const clapLength = Math.ceil(0.16 * ctx.sampleRate);
    const clap = ctx.createBuffer(1, clapLength, ctx.sampleRate);
    const cd = clap.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < clapLength; i++) {
      const t = i / ctx.sampleRate;
      // three quick bursts then a short tail, high-passed noise
      const burst = [0, 0.011, 0.022].reduce((a, s) => a + (t >= s ? Math.exp(-(t - s) / 0.006) : 0), 0) / 2 + Math.exp(-t / 0.05) * 0.5;
      const n = noise();
      cd[i] = (n - prev * 0.85) * burst * 0.45;
      prev = n;
    }
    this.hitBuffers.set('TICK', tick.buffer);
    this.hitBuffers.set('MANIA', mania.buffer);
    this.hitBuffers.set('KICK', kick.buffer);
    this.hitBuffers.set('CLAP', clap);
  }

  playHit(kind: HitSound) {
    if (kind === 'OFF' || !this.ctx || !this.hitBus) return;
    const buffer = this.hitBuffers.get(kind);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.hitBus);
    src.start();
  }
}
