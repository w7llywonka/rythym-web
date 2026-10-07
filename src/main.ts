import './style.css';
import { UI } from './ui.ts';
import { songs } from './songs.ts';
import { AudioEngine } from './audio.ts';
import { Game } from './game.ts';
import { importSong } from './custom.ts';
import { loadSettings, saveSettings, loadBests, saveBest } from './storage.ts';
import type { Song } from './types.ts';

const root = document.querySelector<HTMLElement>('#app')!;
const audio = new AudioEngine();
let settings = loadSettings();
let bests = loadBests();
let game: Game | null = null;
let selected = songs[0];
let previewVersion = 0;
let playVersion = 0;
let cleanupCalibration: (() => void) | null = null;

const ui = new UI(root, songs, {
  play: song => { void play(song); },
  preview: song => {
    selected = song;
    const version = ++previewVersion;
    audio.setVolume(settings.volume);
    void audio.preview(song, () => version === previewVersion && !game).catch(() => {
      // Menus remain usable when sound is blocked until a user gesture.
    });
  },
  stopPreview: () => { ++previewVersion; audio.stopPreview(); cleanupCalibration?.(); },
  saveSettings: value => { settings = value; saveSettings(value); audio.setVolume(value.volume); },
  calibrate: () => { void calibrate(); },
  importSong: file => { void addCustomSong(file); },
  resume: () => {
    root.querySelector('.pause-overlay')?.remove();
    root.querySelector('#pause-overlay')?.remove();
    const current = game;
    void current?.resume().catch(error => { if (game === current) showError(error); });
  },
  restart: () => { void play(selected); },
  quit: () => {
    ++playVersion;
    game?.dispose(); game = null;
    ui.select(settings, bests, selected.id);
  },
});
root.addEventListener('game-pause-request', () => game?.pause());

async function addCustomSong(file: File) {
  const version = ++playVersion;
  ++previewVersion;
  cleanupCalibration?.();
  game?.dispose(); game = null;
  audio.stop();
  ui.loading('Listening for beats in your track…');
  try {
    const ctx = await audio.unlock();
    const imported = await importSong(file, ctx, message => {
      if (version === playVersion) {
        const description = root.querySelector('.loading-card p');
        if (description) description.textContent = message;
      }
    });
    if (version !== playVersion) return;
    const index = songs.findIndex(song => song.id === imported.song.id);
    if (index >= 0) songs[index] = imported.song;
    else songs.push(imported.song);
    audio.registerBuffer(imported.song, imported.buffer);
    selected = imported.song;
    ui.select(settings, bests, selected.id);
    if (imported.warning) {
      const warning = document.createElement('p');
      warning.className = 'custom-warning'; warning.role = 'status';
      warning.textContent = imported.warning;
      root.querySelector('main')?.prepend(warning);
    }
  } catch (error) { if (version === playVersion) showError(error); }
}

function showError(error: unknown) {
  game?.dispose(); game = null;
  ui.error(error instanceof Error ? error.message : 'Audio could not start. Please try again.');
}

async function play(song: Song) {
  const version = ++playVersion;
  ++previewVersion;
  cleanupCalibration?.();
  game?.dispose(); game = null;
  audio.stop();
  selected = song;
  ui.loading(`Preparing ${song.title}…`);
  try {
    // Unlock while still inside the click/keyboard gesture, before synthesis awaits.
    await audio.unlock();
    await audio.load(song);
    if (version !== playVersion) return;
    const canvas = ui.gameplay(song, settings);
    game = new Game(song, settings, canvas, audio, {
      onStats: (stats, time) => ui.updateStats(stats, time, song),
      onPause: () => ui.pause(),
      onResult: result => {
        result.newBest = saveBest(result);
        bests = loadBests();
        game = null;
        ui.results(result, song, bests);
      },
    });
    await game.start();
    if (document.hidden || !document.hasFocus()) game?.pause();
  } catch (error) { if (version === playVersion) showError(error); }
}

async function calibrate() {
  ++previewVersion;
  audio.stop();
  cleanupCalibration?.();
  const area = ui.calibration();
  const status = area.querySelector<HTMLElement>('#calibration-status')!;
  const count = area.querySelector<HTMLElement>('#calibration-count')!;
  const value = area.querySelector<HTMLElement>('#calibration-value')!;
  const startButton = area.querySelector<HTMLButtonElement>('#calibration-start')!;
  const applyButton = area.querySelector<HTMLButtonElement>('#calibration-apply')!;
  let ctx: AudioContext;
  let raf = 0;
  let running = false;
  let firstBeat = 0;
  let nextBeat = 0;
  let lastTapped = -1;
  let suggested = settings.offsetMs;
  let deltas: number[] = [];
  const scheduled: OscillatorNode[] = [];
  const clean = () => {
    running = false;
    cancelAnimationFrame(raf);
    for (const oscillator of scheduled) { try { oscillator.stop(); } catch { /* already stopped */ } }
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('blur', onBlur);
    cleanupCalibration = null;
  };
  cleanupCalibration = clean;
  const onBlur = () => {
    running = false;
    cancelAnimationFrame(raf);
    for (const oscillator of scheduled) { try { oscillator.stop(); } catch { /* already stopped */ } }
    startButton.disabled = false;
    status.textContent = 'Calibration paused. Start again when you’re ready.';
  };
  const tick = () => {
    if (!running || !area.isConnected) { clean(); return; }
    while (firstBeat + nextBeat * .5 < ctx.currentTime + .15 && nextBeat < 48) {
      const at = firstBeat + nextBeat * .5;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = nextBeat % 4 === 0 ? 1100 : 800;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.18 * settings.volume, at + .003);
      gain.gain.exponentialRampToValueAtTime(.001, at + .07);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(at); oscillator.stop(at + .08);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      scheduled.push(oscillator);
      nextBeat++;
    }
    const beat = (ctx.currentTime - firstBeat - audio.latency) / .5;
    area.style.setProperty('--tap-pulse', String(Math.max(0, 1 - ((beat % 1 + 1) % 1) * 4)));
    if (beat > 48) { onBlur(); status.textContent = 'Take another pass: tap once on each click.'; return; }
    raf = requestAnimationFrame(tick);
  };
  const tap = (timestamp: number) => {
    if (!running) return;
    const age = Math.max(0, Math.min(.5, (performance.now() - timestamp) / 1000));
    const audibleNow = ctx.currentTime - audio.latency - age;
    const beat = Math.round((audibleNow - firstBeat) / .5);
    if (beat < 2 || beat === lastTapped) return;
    lastTapped = beat;
    const delta = (audibleNow - (firstBeat + beat * .5)) * 1000;
    if (Math.abs(delta) > 230) { status.textContent = 'Follow the click and tap once per beat.'; return; }
    deltas.push(delta);
    count.textContent = `${deltas.length} / 16 taps`;
    if (deltas.length >= 16) {
      running = false; cancelAnimationFrame(raf);
      for (const oscillator of scheduled) { try { oscillator.stop(); } catch { /* already stopped */ } }
      const sorted = [...deltas].sort((a, b) => a - b).slice(2, -2);
      suggested = Math.max(-300, Math.min(300, Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length / 5) * 5));
      value.textContent = `${suggested > 0 ? '+' : ''}${suggested} ms`;
      status.textContent = 'Your timing is measured. Apply this offset or try another pass.';
      applyButton.disabled = false; startButton.disabled = false;
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (!event.repeat && [' ', ...settings.keys].includes(event.key.toLowerCase())) { event.preventDefault(); tap(event.timeStamp); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);
  area.querySelector('#calibration-tap')?.addEventListener('pointerdown', event => { event.preventDefault(); tap(event.timeStamp); });
  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    try {
      ctx = await audio.unlock();
      if (cleanupCalibration !== clean || !area.isConnected) return;
      deltas = []; nextBeat = 0; lastTapped = -1;
      firstBeat = ctx.currentTime + .6;
      count.textContent = '0 / 16 taps'; value.textContent = '— ms';
      status.textContent = 'Listen for two beats, then tap on each click. Space also works.';
      startButton.disabled = true; applyButton.disabled = true;
      running = true; tick();
    } catch (error) { if (cleanupCalibration === clean && area.isConnected) showError(error); }
  });
  applyButton.disabled = true;
  applyButton.addEventListener('click', () => {
    settings = { ...settings, offsetMs: suggested }; saveSettings(settings);
    clean(); ui.settings(settings, bests);
  });
  area.querySelector('#calibration-reset')?.addEventListener('click', () => {
    onBlur(); deltas = []; count.textContent = '0 / 16 taps'; value.textContent = '— ms'; applyButton.disabled = true;
  });
  area.querySelector('#calibration-back')?.addEventListener('click', clean);
}

// One shared spectrum loop stays independent of menu navigation.
let spectrum: HTMLCanvasElement | null = null;
let spectrumData = new Uint8Array(1024);
function drawSpectrum() {
  const logo = root.querySelector<HTMLElement>('.hero-title');
  if (logo) logo.style.transform = settings.effects ? `scale(${1 + audio.previewPulse * .012})` : '';
  const target = document.querySelector<HTMLCanvasElement>('#spectrum');
  if (target) {
    if (spectrum !== target) { spectrum = target; spectrum.width = 960; spectrum.height = 72; }
    const ctx = spectrum.getContext('2d')!;
    ctx.clearRect(0, 0, 960, 72);
    if (audio.analyser && settings.effects) {
      audio.analyser.getByteFrequencyData(spectrumData);
      for (let i = 0; i < 64; i++) {
        const bin = Math.round(Math.exp(i / 63 * Math.log(800)));
        const height = spectrumData[bin] / 255 * 60;
        ctx.fillStyle = i < 32 ? '#00d2ff' : '#ff4fa0'; ctx.globalAlpha = .15 + height / 100;
        ctx.fillRect(i * 15 + 3, 72 - height, 5, height);
      }
    }
  }
  requestAnimationFrame(drawSpectrum);
}
ui.home(settings, bests);
drawSpectrum();
