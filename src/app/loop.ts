// The frame loop: steps the run and pulses the logo / playfield border on the beat.
import type { Track } from '../types.ts';
import { $ } from '../ui.ts';
import { calibrating } from './calibration.ts';
import { audio, game } from './services.ts';
import { S, settings } from './state.ts';

let lastPulse = -1;

function frame() {
  game.step();
  let pulse = 0;
  const r = game.run;
  let t: number | null = null, track: Track | null = null;
  if (r?.ready) { track = r.track; t = game.songTime(r) - r.offset; }
  else if (S.previewTrack && audio.playing && !calibrating()) { track = S.previewTrack; t = audio.position(); }
  if (track && t !== null && t > 0 && settings().effects) {
    const phase = (((t - track.offset) / (60 / track.bpm)) % 1 + 1) % 1;
    pulse = Math.exp(-phase * 6);
  }
  // only touch the DOM when the value visibly changes
  const q = Math.round(pulse * 40) / 40;
  if (q !== lastPulse) {
    lastPulse = q;
    if (S.screen === 'home') $('home.logo').style.setProperty('--s', String(1 + 0.035 * q));
    else if (S.screen === 'game') $('game.pf.pulse').style.opacity = String(0.15 + 0.85 * q);
    // the background glows breathe with the beat on every screen (Roblox GlowA / GlowB)
    $('backdrop').style.setProperty('--beat', String(q));
  }
  requestAnimationFrame(frame);
}

export function startLoop() {
  requestAnimationFrame(frame);
}
