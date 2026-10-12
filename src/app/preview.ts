// Menu music: the selected song's preview loops softly behind the menus (unless it's turned off in Settings).
import { K } from '../config.ts';
import type { Track } from '../types.ts';
import { $, html } from '../ui.ts';
import { audio, game } from './services.ts';
import { escapeHtml } from './shell.ts';
import { S, settings } from './state.ts';

export function showNowPlaying(track: Track) {
  if (!settings().menuMusic) return html($('home.nowplaying'), '');
  html($('home.nowplaying'), `NOW PLAYING &nbsp; <b>${escapeHtml(track.title)}</b> &nbsp;·&nbsp; ${escapeHtml(track.artist)}`);
}

export async function playPreview(track: Track | null | undefined) {
  if (!track) return;
  S.previewTrack = track;
  showNowPlaying(track);
  if (!settings().menuMusic) return;
  const my = ++audio.token;
  if (audio.playing) {
    audio.fade(0, 0.2);
    await new Promise(r => setTimeout(r, 200));
  }
  if (my !== audio.token || audio.ctx?.state !== 'running') return;
  let buffer: AudioBuffer;
  try { buffer = await audio.load(track.song); } catch { return; }
  if (my !== audio.token || game.run || !settings().menuMusic) return;
  const start = Math.min(track.previewStart, Math.max(0, buffer.duration - 5));
  const end = Math.min(buffer.duration, start + K.PREVIEW_LENGTH);
  audio.start(buffer, audio.now, start, 1, 0, { start, end });
  audio.fade(0.85, 1.2);
}

/** menu music switched in Settings: fade the preview out, or start it again */
export function applyMenuMusic() {
  if (game.run) return;
  const track = S.previewTrack ?? S.selectedSong.Easy;
  if (settings().menuMusic) {
    if (!audio.playing) void playPreview(track);
    return;
  }
  if (track) showNowPlaying(track);
  const my = ++audio.token;
  if (!audio.playing) return;
  audio.fade(0, 0.3);
  setTimeout(() => { if (my === audio.token && !game.run) audio.stop(); }, 320);
}

/** browsers only allow sound after a click or key press: start the menu music on the first one */
export function initPreview() {
  const first = () => {
    window.removeEventListener('pointerdown', first);
    window.removeEventListener('keydown', first);
    void audio.unlock().then(() => { if (!game.run && !audio.playing) void playPreview(S.previewTrack ?? S.selectedSong.Easy); });
  };
  window.addEventListener('pointerdown', first);
  window.addEventListener('keydown', first);
  window.addEventListener('pointerdown', () => void audio.unlock(), { capture: true });
}
