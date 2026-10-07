import type { Song } from './types.ts';
import { renderSong } from './synthesis.ts';

export class AudioEngine {
  context: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private startAt = 0;
  private position = 0;
  private heldTime = 0;
  private active = false;
  private isPreview = false;
  private volume = .7;
  private previewAt = 0;
  private previewPhase = 0;
  private previewBpm = 120;

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = .8;
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
    this.setVolume(this.volume);
    return this.context;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.context && this.master) this.master.gain.setTargetAtTime(volume, this.context.currentTime, .03);
  }

  async load(song: Song) {
    const ctx = await this.unlock();
    let buffer = this.buffers.get(song.id);
    if (!buffer) {
      buffer = renderSong(song, ctx);
      this.buffers.set(song.id, buffer);
      buffer.catch(() => this.buffers.delete(song.id));
    }
    return buffer;
  }
  registerBuffer(song: Song, buffer: AudioBuffer) {
    this.buffers.set(song.id, Promise.resolve(buffer));
  }

  private attach(buffer: AudioBuffer) {
    const ctx = this.context!;
    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.gain = ctx.createGain();
    this.source.connect(this.gain);
    this.gain.connect(this.master!);
    return this.source;
  }

  async play(song: Song, position = 0, countdown = 3, stillWanted = () => true) {
    const buffer = await this.load(song);
    if (!stillWanted()) return;
    this.stop();
    const ctx = this.context!;
    const source = this.attach(buffer);
    this.position = position;
    this.startAt = ctx.currentTime + countdown;
    this.heldTime = position - countdown - this.latency;
    this.active = true;
    this.isPreview = false;
    source.start(this.startAt, Math.max(0, position));
  }

  async preview(song: Song, stillWanted: () => boolean) {
    const buffer = await this.load(song);
    if (!stillWanted()) return;
    this.stop();
    const source = this.attach(buffer);
    const begin = Math.min(song.previewStart, buffer.duration - 1);
    source.loop = true;
    source.loopStart = begin;
    source.loopEnd = Math.min(begin + 16, buffer.duration);
    this.gain!.gain.value = .4;
    this.isPreview = true;
    this.previewAt = this.context!.currentTime;
    this.previewPhase = begin - song.analysis.offset;
    this.previewBpm = song.bpm;
    source.start(0, begin);
  }
  get previewPulse() {
    if (!this.isPreview || !this.context) return 0;
    const phase = ((this.context.currentTime - this.previewAt + this.previewPhase - this.latency) * this.previewBpm / 60 % 1 + 1) % 1;
    return Math.pow(1 - phase, 5);
  }

  get latency() { return this.context?.outputLatency || this.context?.baseLatency || 0; }
  get time() {
    return this.active && this.context ? this.position + this.context.currentTime - this.startAt - this.latency : this.heldTime;
  }
  get countdown() { return this.active && this.context ? Math.max(0, this.startAt - this.context.currentTime) : 0; }
  get rawTime() { return this.context ? this.position + this.context.currentTime - this.startAt : 0; }
  get clock() { return this.context?.currentTime || 0; }
  pause() {
    const position = Math.max(this.position, this.rawTime);
    this.heldTime = this.time;
    this.stopSource();
    this.active = false;
    return position;
  }
  fail() {
    if (!this.context || !this.source || !this.gain) return;
    const time = this.context.currentTime;
    this.source.playbackRate.exponentialRampToValueAtTime(.3, time + 1.1);
    this.gain.gain.setValueAtTime(1, time);
    this.gain.gain.linearRampToValueAtTime(0, time + 1.2);
  }
  private stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch { /* An already-ended source is harmless. */ }
      this.source.disconnect();
      this.source = null;
    }
    this.gain?.disconnect();
    this.gain = null;
  }
  stop() { this.stopSource(); this.active = false; this.isPreview = false; }
  stopPreview() { if (this.isPreview) this.stop(); }
}
