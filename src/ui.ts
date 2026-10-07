import type { Bests, Result, Settings, Song, Stats } from './types';
import { isBindableKey } from './storage.ts';
import { generateChart } from './chart';

export interface UIActions {
  play(song: Song): void;
  preview(song: Song): void;
  stopPreview(): void;
  saveSettings(settings: Settings): void;
  calibrate(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  importSong?(file: File): void;
}

const icons = {
  play: '<path d="m9 5 11 7-11 7V5Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  settings: '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4V9Zm12-1c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M4 11a8 8 0 1 1 2 7M4 4v7h7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trophy: '<path d="M8 4h8v5c0 4-2 6-4 6s-4-2-4-6V4Zm0 2H4v2c0 3 2 4 5 4m7-6h4v2c0 3-2 4-5 4m-3 3v5m-4 0h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v8H4v-8Zm13 0h3v8h-3v-8Z"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
const keyName = (key: string) => key === ' ' ? 'SPACE' : key.replace(/^arrow/i, '').toUpperCase();
const number = (value: number) => Math.round(value).toLocaleString('en-US');

export class UI {
  private preferences: Settings = { keys: ['f', 'j'], scrollSpeed: 1, offsetMs: 0, volume: 0.7, effects: true };
  private bests: Bests = {};
  private selected?: Song;
  private difficulty: 'Easy' | 'Hard' = 'Easy';
  private soundEnabled = false;
  private keyListener?: (event: KeyboardEvent) => void;
  private animation = 0;

  constructor(private root: HTMLElement, private songs: Song[], private actions: UIActions) {}

  private reset() {
    this.actions.stopPreview();
    cancelAnimationFrame(this.animation);
    if (this.keyListener) window.removeEventListener('keydown', this.keyListener);
    this.keyListener = undefined;
    this.root.className = 'app';
    this.root.classList.toggle('reduced-effects', !this.preferences.effects);
    this.root.innerHTML = '';
  }

  private remember(settings: Settings, bests: Bests) {
    this.preferences = { ...settings, keys: [...settings.keys] };
    this.bests = bests;
  }

  private header(active = '', back?: string) {
    return `<header class="topbar"><button class="brand" data-action="home" aria-label="Line Rush home"><span class="brand-mark"><i></i><i></i><i></i></span><span>LINE<span>RUSH</span></span></button>${back ? `<button class="back-link" data-action="back">${icon('back')}${back}</button>` : `<nav class="main-nav" aria-label="Main navigation"><button class="${active === 'home' ? 'active' : ''}" data-action="home">Overview</button><button class="${active === 'select' ? 'active' : ''}" data-action="select">Track library<span class="nav-count">${this.songs.length}</span></button></nav>`}<div class="header-right"><span class="local-status"><i></i> LOCAL BESTS SAVED</span><button class="icon-button ${active === 'settings' ? 'active' : ''}" data-action="settings" aria-label="Settings">${icon('settings')}</button></div></header>`;
  }

  private footer() {
    return `<footer class="page-footer"><span><i class="live-dot"></i> FIND YOUR FLOW</span><canvas id="spectrum" aria-hidden="true"></canvas><span>BUILT FOR THE BEAT <b>↗</b></span></footer>`;
  }

  private bindNavigation(back: () => void = () => this.home(this.preferences, this.bests)) {
    this.root.querySelectorAll<HTMLElement>('[data-action="home"]').forEach((b) => b.onclick = () => this.home(this.preferences, this.bests));
    this.root.querySelectorAll<HTMLElement>('[data-action="select"]').forEach((b) => b.onclick = () => this.select(this.preferences, this.bests));
    this.root.querySelectorAll<HTMLElement>('[data-action="settings"]').forEach((b) => b.onclick = () => this.settings(this.preferences, this.bests));
    this.root.querySelectorAll<HTMLElement>('[data-action="back"]').forEach((b) => b.onclick = back);
  }

  home(settings: Settings, bests: Bests) {
    this.remember(settings, bests);
    this.reset();
    const featured = this.songs[0];
    this.root.innerHTML = `${this.header('home')}<main class="home-main"><div class="hero-copy"><div class="eyebrow"><span class="mini-bars"><i></i><i></i><i></i></span> TWO KEYS. ONE RHYTHM.</div><h1 class="hero-title">LINE<br><span>RUSH<span class="title-period">.</span></span></h1><p class="hero-description">Less thinking.<br>More <em>feeling the beat.</em></p><p class="hero-detail">Two lanes. Ten tracks. One perfect moment.<br>Hit the line, chase the combo, find your flow.</p><div class="hero-actions"><button class="button primary big" data-action="select">LET'S PLAY ${icon('arrow')}</button><button class="button secondary big" data-action="settings">${icon('settings')} Settings</button></div><div class="how-to"><span class="keycap cyan">${esc(keyName(settings.keys[0]))}</span><span class="keycap pink">${esc(keyName(settings.keys[1]))}</span><span>Press when the lines meet the target.<br><b>Click or tap works, too.</b></span></div></div><div class="hero-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="hero-top-tag"><i></i> IN THE ZONE <span>×4</span></div><div class="hero-playfield"><div class="lane-label"><span>01 / LOW</span><span>02 / HIGH</span></div><div class="demo-lanes"><div class="demo-lane"><i class="demo-note cyan n1"></i><i class="demo-note cyan n2"></i><i class="demo-note gold n3"></i><i class="demo-note cyan n4"></i></div><div class="demo-lane"><i class="demo-note pink n5"></i><i class="demo-note gold n3"></i><i class="demo-note pink n6"></i><i class="demo-note pink n7"></i></div><div class="demo-combo"><span>PERFECT</span><strong>128</strong><span>COMBO</span></div><div class="demo-target"><span></span><span></span></div><div class="demo-keys"><b>${esc(keyName(settings.keys[0]))}</b><b>${esc(keyName(settings.keys[1]))}</b></div></div></div><div class="floating-stat"><span class="float-icon">${icon('trophy')}</span><span>THE NEXT PERFECT RUN<br><b>Could be yours.</b></span><span>↗</span></div><div class="hero-coordinate">SYNC / LOCKED<br>120.00 BPM</div></div></main><section class="home-bottom"><div class="track-preview">${featured ? this.cover(featured, 'tiny') : ''}<div><span class="small-label">ON THE DECK</span><strong>${featured ? esc(featured.title) : 'Ready when you are'}</strong><span>${featured ? esc(featured.artist) + ' · ' + featured.bpm + ' BPM' : 'Pick a track to begin'}</span></div><button class="sound-button" id="enable-sound">${icon('sound')}<span>${this.soundEnabled ? 'SOUND ON' : 'ENABLE SOUND'}</span></button></div><div class="home-facts"><div><strong>02</strong><span>LANES</span></div><div><strong>10</strong><span>ORIGINAL TRACKS</span></div><div><strong>∞</strong><span>ONE MORE TRY</span></div></div></section>${this.footer()}`;
    this.bindNavigation();
    this.root.querySelector<HTMLButtonElement>('#enable-sound')!.onclick = () => {
      if (featured) this.actions.preview(featured);
      this.soundEnabled = true;
      this.root.querySelector('#enable-sound span')!.textContent = 'SOUND ON';
    };
    if (this.soundEnabled && featured) this.actions.preview(featured);
  }

  private cover(song: Song, size = '') {
    const shape = song.seed % 4;
    return `<div class="track-cover ${size} cover-${shape}" style="--cover-a:${song.color};--cover-b:${song.color2}"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="cover-${esc(song.id)}-${size}" x2="1" y2="1"><stop stop-color="${song.color}"/><stop offset="1" stop-color="${song.color2}"/></linearGradient></defs><rect width="200" height="200" fill="url(#cover-${esc(song.id)}-${size})"/><circle cx="100" cy="100" r="70" fill="none" stroke="#080d20" stroke-width="30" opacity=".65"/><circle cx="100" cy="100" r="35" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/><path d="m-20 150 110-140 35 115 80-125M-15 170 95 30l35 115L210 20" fill="none" stroke="#fff" stroke-width="8" opacity=".75"/><circle cx="100" cy="100" r="8" fill="#080d20"/></svg><span>LR / ${String(this.songs.indexOf(song) + 1).padStart(2, '0')}</span></div>`;
  }

  select(settings: Settings, bests: Bests, selectedId?: string) {
    this.remember(settings, bests);
    this.reset();
    if (selectedId) this.selected = this.songs.find((song) => song.id === selectedId);
    if (this.selected) this.difficulty = this.selected.difficulty;
    this.selected = this.selected ?? this.songs.find((song) => song.difficulty === this.difficulty) ?? this.songs[0];
    this.renderSelect();
    if (this.selected) this.actions.preview(this.selected);
  }

  private renderSelect() {
    const selected = this.selected;
    if (!selected) return this.error('No tracks were found.');
    const best = this.bests[selected.id];
    const tracks = this.songs.filter((song) => song.difficulty === this.difficulty);
    const easyCount = String(this.songs.filter(song => song.difficulty === 'Easy').length).padStart(2, '0');
    const hardCount = String(this.songs.filter(song => song.difficulty === 'Hard').length).padStart(2, '0');
    const analyzedNotes = generateChart(selected).length;
    this.root.innerHTML = `${this.header('select')}<main class="select-main"><div class="section-heading"><div><div class="eyebrow">THE TRACK LIBRARY</div><h1>Pick your <span>pulse.</span></h1><p>Find a track. Feel the rhythm. Make it yours.</p></div><div class="library-total"><strong>${this.songs.length}</strong><span>TRACKS<br>ZERO SKIPS</span></div></div><div class="library-layout"><section class="track-list-panel"><div class="library-toolbar"><div class="difficulty-tabs" role="tablist" aria-label="Difficulty"><button role="tab" aria-selected="${this.difficulty === 'Easy'}" class="${this.difficulty === 'Easy' ? 'active' : ''}" data-difficulty="Easy">Easy <span>${easyCount}</span></button><button role="tab" aria-selected="${this.difficulty === 'Hard'}" class="${this.difficulty === 'Hard' ? 'active' : ''}" data-difficulty="Hard">Hard <span>${hardCount}</span></button></div><span class="small-label">${this.difficulty === 'Easy' ? 'EASE INTO THE FLOW' : 'TURN UP THE CHALLENGE'}</span></div><div class="track-list">${tracks.map((song, index) => `<button class="track-card ${song.id === selected.id ? 'selected' : ''}" data-song="${esc(song.id)}" aria-pressed="${song.id === selected.id}"><span class="track-number">${String(index + 1).padStart(2, '0')}</span>${this.cover(song, 'small')}<span class="track-info"><strong>${esc(song.title)}</strong><span>${esc(song.artist)} <i>·</i> ${esc(song.genre)}</span></span><span class="track-bpm"><b>${song.bpm}</b><span>BPM</span></span><span class="track-level">LV. <b>${String(song.level).padStart(2, '0')}</b></span><span class="track-grade ${this.bests[song.id] ? 'has-best' : ''}">${this.bests[song.id]?.grade ?? '—'}</span>${song.id === selected.id ? `<span class="playing-bars"><i></i><i></i><i></i></span>` : `<span class="track-arrow">↗</span>`}</button>`).join('')}</div><div class="library-note">${icon('headphones')} Select any track to hear a preview. <span>HEADPHONES RECOMMENDED</span></div>${this.customUpload()}</section><aside class="song-detail"><div class="detail-cover-wrap">${this.cover(selected, 'large')}<span class="cover-difficulty">${selected.difficulty.toUpperCase()} / LEVEL ${String(selected.level).padStart(2, '0')}</span><span class="cover-preview"><i></i> PREVIEW</span></div><div class="detail-content"><span class="small-label">${esc(selected.genre.toUpperCase())}</span><h2>${esc(selected.title)}</h2><p>${esc(selected.artist)}</p><div class="song-metrics"><div><strong>${selected.bpm}</strong><span>BPM</span></div><div><strong>${clock(selected.duration)}</strong><span>LENGTH</span></div><div><strong>${analyzedNotes || Math.round(selected.duration * selected.bpm / 120)}</strong><span>NOTES</span></div></div><div class="personal-best"><div class="best-title">${icon('trophy')} PERSONAL BEST ${best?.fullCombo ? '<span class="fc-tag">FULL COMBO</span>' : ''}</div>${best ? `<div class="best-values"><div><strong>${number(best.score)}</strong><span>SCORE</span></div><div><strong>${best.accuracy.toFixed(1)}<small>%</small></strong><span>ACCURACY</span></div><div><strong>${best.maxCombo}</strong><span>COMBO</span></div></div>` : '<p class="no-best">A blank slate. Leave your mark.</p>'}</div><button class="button primary play-track" id="play-song">${icon('play')} PLAY TRACK <span>${esc(keyName(this.preferences.keys[0]))} + ${esc(keyName(this.preferences.keys[1]))}</span></button></div></aside></div></main>${this.footer()}`;
    this.bindNavigation();
    this.root.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) => button.onclick = () => {
      this.difficulty = button.dataset.difficulty as 'Easy' | 'Hard';
      this.selected = this.songs.find((song) => song.difficulty === this.difficulty);
      this.renderSelect();
      if (this.selected) this.actions.preview(this.selected);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-song]').forEach((button) => button.onclick = () => {
      this.selected = this.songs.find((song) => song.id === button.dataset.song)!;
      this.soundEnabled = true;
      this.renderSelect();
      this.actions.preview(this.selected!);
    });
    this.root.querySelector<HTMLButtonElement>('#play-song')!.onclick = () => this.actions.play(selected);
    const importInput = this.root.querySelector<HTMLInputElement>('#import-audio');
    this.root.querySelector<HTMLButtonElement>('#import-track')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (file) this.actions.importSong?.(file);
    });
  }

  private customUpload() {
    return `<section class="custom-import"><span class="custom-import-icon">${icon('sound')}</span><div class="custom-import-copy"><h3>Your track. Your rush.</h3><p>Choose an audio file from your device. An extra-hard chart is made from its beats. Audio stays on this device for this session.</p><span>ON YOUR PLAYLIST: <b>Waste My Time — kevinhilfiger</b></span></div><button id="import-track" class="button secondary">IMPORT YOUR TRACK <span>+</span></button><input id="import-audio" class="visually-hidden" type="file" accept="audio/*" aria-label="Import an audio file"></section>`;
  }

  settings(settings: Settings, bests: Bests) {
    this.remember(settings, bests);
    this.reset();
    this.root.innerHTML = `${this.header('settings', 'Back to the flow')}<main class="settings-main"><div class="section-heading"><div><div class="eyebrow">MAKE IT FEEL RIGHT</div><h1>Your game.<br><span>Your rhythm.</span></h1><p>Fine-tune the little things. Find your perfect timing.</p></div><span class="settings-heading-icon">${icon('settings')}</span></div><div class="settings-layout"><section class="settings-card"><div class="setting-row keybind-row"><div><span class="setting-index">01</span><h2>Your two keys</h2><p>Click a key, then press its replacement.<br>Choosing the other key swaps the pair.</p></div><div class="keybinds"><div><button id="key-0" class="bind-key cyan">${esc(keyName(settings.keys[0]))}</button><span>LEFT LANE</span></div><div><button id="key-1" class="bind-key pink">${esc(keyName(settings.keys[1]))}</button><span>RIGHT LANE</span></div></div></div><p id="keybind-message" class="keybind-message" role="status">Escape is reserved for pause. / is reserved for shortcuts.</p>${this.slider('speed', '02', 'Scroll speed', 'How fast the lines fall. Timing stays the same.', settings.scrollSpeed, 0.5, 3, 0.1, settings.scrollSpeed.toFixed(1) + '×', '0.5×', '3.0×')}${this.slider('offset', '03', 'Audio offset', 'Negative values make notes arrive earlier.', settings.offsetMs, -300, 300, 5, (settings.offsetMs > 0 ? '+' : '') + settings.offsetMs + ' ms', '−300 ms', '+300 ms')}${this.slider('volume', '04', 'Music volume', 'A little room for the rest of the world.', settings.volume, 0, 1, 0.01, Math.round(settings.volume * 100) + '%', '0%', '100%')}<div class="setting-row effects-row"><div><span class="setting-index">05</span><h2>Visual effects</h2><p>Hit sparks, lane flashes, and a little extra energy.</p></div><button id="effects-toggle" class="toggle ${settings.effects ? 'on' : ''}" role="switch" aria-checked="${settings.effects}" aria-label="Visual effects"><span></span></button></div></section><aside class="settings-aside"><div class="calibration-card"><span class="aside-icon">${icon('headphones')}</span><div class="eyebrow">IN PERFECT SYNC</div><h2>Trust your ears. <span>Then tap.</span></h2><p>Every device is a little different. Tap along to a beat and we'll help you find your audio offset.</p><button class="button secondary" id="calibrate">Calibrate timing ${icon('arrow')}</button><span class="calibration-time">TAKES ABOUT 15 SECONDS</span></div><div class="save-note"><span>${icon('check')}</span><div><strong>Saved as you go.</strong><p>Your settings and records stay in this browser.</p></div></div><button class="reset-settings" id="reset-settings">${icon('restart')} Reset to defaults</button></aside></div></main>${this.footer()}`;
    this.bindNavigation();
    const save = () => this.actions.saveSettings({ ...this.preferences, keys: [...this.preferences.keys] });
    [0, 1].forEach((lane) => this.root.querySelector<HTMLButtonElement>(`#key-${lane}`)!.onclick = () => {
      if (this.keyListener) window.removeEventListener('keydown', this.keyListener);
      this.root.querySelectorAll('.bind-key').forEach((b, index) => { b.textContent = keyName(this.preferences.keys[index]); b.classList.remove('listening'); });
      const button = this.root.querySelector<HTMLButtonElement>(`#key-${lane}`)!;
      button.textContent = '…';
      button.classList.add('listening');
      this.root.querySelector('#keybind-message')!.textContent = 'Press a key to bind it. Escape or / will cancel.';
      this.keyListener = (event) => {
        event.preventDefault();
        if (event.repeat) return;
        const chosen = event.key.toLowerCase();
        if (isBindableKey(chosen)) {
          const other = lane === 0 ? 1 : 0;
          if (chosen === this.preferences.keys[other]) this.preferences.keys[other] = this.preferences.keys[lane];
          this.preferences.keys[lane] = chosen;
          save();
        }
        if (this.keyListener) window.removeEventListener('keydown', this.keyListener);
        this.keyListener = undefined;
        this.root.querySelectorAll('.bind-key').forEach((b, index) => { b.textContent = keyName(this.preferences.keys[index]); b.classList.remove('listening'); });
        this.root.querySelector('#keybind-message')!.textContent = 'Escape is reserved for pause. / is reserved for shortcuts.';
      };
      window.addEventListener('keydown', this.keyListener);
    });
    const sliders: [string, keyof Settings][] = [['speed', 'scrollSpeed'], ['offset', 'offsetMs'], ['volume', 'volume']];
    sliders.forEach(([id, field]) => this.root.querySelector<HTMLInputElement>(`#${id}`)!.oninput = (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      if (field === 'scrollSpeed' || field === 'offsetMs' || field === 'volume') this.preferences[field] = value;
      this.root.querySelector(`#${id}-value`)!.textContent = id === 'speed' ? value.toFixed(1) + '×' : id === 'volume' ? Math.round(value * 100) + '%' : (value > 0 ? '+' : '') + value + ' ms';
      save();
    });
    this.root.querySelector<HTMLButtonElement>('#effects-toggle')!.onclick = (event) => {
      this.preferences.effects = !this.preferences.effects;
      const toggle = event.currentTarget as HTMLButtonElement;
      toggle.classList.toggle('on', this.preferences.effects);
      toggle.setAttribute('aria-checked', String(this.preferences.effects));
      save();
    };
    this.root.querySelector<HTMLButtonElement>('#calibrate')!.onclick = () => this.actions.calibrate();
    this.root.querySelector<HTMLButtonElement>('#reset-settings')!.onclick = () => {
      this.preferences = { keys: ['f', 'j'], scrollSpeed: 1, offsetMs: 0, volume: 0.7, effects: true };
      save();
      this.settings(this.preferences, this.bests);
    };
  }

  private slider(id: string, index: string, title: string, description: string, value: number, min: number, max: number, step: number, display: string, start: string, end: string) {
    return `<div class="setting-row slider-row"><div><span class="setting-index">${index}</span><h2><label for="${id}">${title}</label></h2><p>${description}</p></div><div class="slider-control"><output id="${id}-value" for="${id}">${display}</output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="range-labels"><span>${start}</span><span>${end}</span></div></div></div>`;
  }

  gameplay(song: Song, settings: Settings): HTMLCanvasElement {
    this.preferences = settings;
    this.selected = song;
    this.reset();
    this.root.classList.add('game-app');
    this.root.innerHTML = `<header class="game-topbar"><span class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span>LINE<span>RUSH</span></span></span><span class="game-top-title">FIND YOUR FLOW</span><button class="icon-button" id="pause-game" aria-label="Pause game">${icon('pause')}</button></header><main class="game-layout"><aside class="game-song-panel"><span class="small-label">NOW PLAYING</span>${this.cover(song, 'game-cover')}<h1>${esc(song.title)}</h1><p>${esc(song.artist)}</p><span class="difficulty-pill ${song.difficulty.toLowerCase()}">${song.difficulty.toUpperCase()} <i>·</i> LV. ${String(song.level).padStart(2, '0')}</span><div class="game-song-metadata"><span>${song.bpm} <b>BPM</b></span><span>${clock(song.duration)} <b>LENGTH</b></span></div><div class="progress-label"><span id="elapsed-time">0:00</span><span>${clock(song.duration)}</span></div><div class="song-progress-track"><div id="song-progress"></div></div><div class="game-tip">${icon('headphones')} Stay in the moment.<br><span>Let the rhythm lead.</span></div><button class="pause-text" id="pause-left">${icon('pause')} Pause <kbd>ESC</kbd></button></aside><section class="playfield-shell"><canvas id="game-canvas" aria-label="Two-lane rhythm playfield"></canvas><div class="lane-buttons"><button data-lane="0" class="lane-button cyan" aria-label="Left lane, ${esc(keyName(settings.keys[0]))}"><span>${esc(keyName(settings.keys[0]))}</span><small>01 / LEFT</small></button><button data-lane="1" class="lane-button pink" aria-label="Right lane, ${esc(keyName(settings.keys[1]))}"><span>${esc(keyName(settings.keys[1]))}</span><small>02 / RIGHT</small></button></div></section><aside class="game-stats-panel"><div class="live-score"><span class="small-label">SCORE</span><strong id="live-score">0</strong></div><div class="live-main-stats"><div><span class="small-label">ACCURACY</span><strong><span id="live-accuracy">100.0</span><small>%</small></strong></div><div><span class="small-label">MULTIPLIER</span><strong class="cyan-text" id="live-multiplier">×1</strong></div></div><div class="combo-stat"><span class="small-label">CURRENT COMBO</span><strong id="live-combo">0</strong><span>KEEP IT GOING</span></div><div class="judgment-stats">${(['Perfect', 'Great', 'Good', 'Miss'] as const).map((judgment) => `<div class="${judgment.toLowerCase()}"><span><i></i>${judgment.toUpperCase()}</span><strong id="count-${judgment.toLowerCase()}">0</strong></div>`).join('')}</div><div class="health-block"><span class="small-label">ENERGY</span><div class="health-track"><div id="health-bar"></div></div><span id="health-value">100%</span></div></aside></main><div class="game-bottom"><span>${esc(keyName(settings.keys[0]))} + ${esc(keyName(settings.keys[1]))} <i>·</i> HIT THE CENTER LINE</span><canvas id="spectrum" aria-hidden="true"></canvas><span>SCROLL ${settings.scrollSpeed.toFixed(1)}×</span></div>`;
    this.root.querySelector<HTMLButtonElement>('#pause-game')!.onclick = () => this.pause();
    this.root.querySelector<HTMLButtonElement>('#pause-left')!.onclick = () => this.pause();
    return this.root.querySelector<HTMLCanvasElement>('#game-canvas')!;
  }

  updateStats(stats: Stats, time: number, song: Song) {
    const set = (id: string, value: string) => { const element = this.root.querySelector('#' + id); if (element) element.textContent = value; };
    set('live-score', number(stats.score));
    set('live-accuracy', stats.accuracy.toFixed(1));
    set('live-combo', String(stats.combo));
    set('live-multiplier', '×' + stats.multiplier);
    set('elapsed-time', clock(time));
    set('health-value', Math.round(stats.health) + '%');
    Object.entries(stats.counts).forEach(([judgment, count]) => set('count-' + judgment.toLowerCase(), String(count)));
    const progress = this.root.querySelector<HTMLElement>('#song-progress');
    if (progress) progress.style.width = Math.max(0, Math.min(100, time / song.duration * 100)) + '%';
    const health = this.root.querySelector<HTMLElement>('#health-bar');
    if (health) { health.style.height = stats.health + '%'; health.classList.toggle('low', stats.health < 30); }
  }

  pause() {
    if (this.root.querySelector('.pause-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `<section class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span class="pause-symbol">${icon('pause')}</span><div class="eyebrow">TAKE A BREATHER</div><h1 id="pause-title">Beat on <span>hold.</span></h1><p>Your rhythm will be right here.</p><button class="button primary" id="resume-game">${icon('play')} RESUME</button><button class="button secondary" id="restart-game">${icon('restart')} Restart track</button><button class="quiet-button" id="quit-game">Back to track library ${icon('arrow')}</button></section>`;
    this.root.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>('#resume-game')!.onclick = () => { overlay.remove(); this.actions.resume(); };
    overlay.querySelector<HTMLButtonElement>('#restart-game')!.onclick = () => { overlay.remove(); this.actions.restart(); };
    overlay.querySelector<HTMLButtonElement>('#quit-game')!.onclick = () => { overlay.remove(); this.actions.quit(); };
    overlay.querySelector<HTMLButtonElement>('#resume-game')!.focus();
    this.root.dispatchEvent(new CustomEvent('game-pause-request', { bubbles: true }));
  }

  results(result: Result, song: Song, bests: Bests) {
    this.bests = bests;
    this.reset();
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0) || 1;
    const status = result.failed ? 'TRACK FAILED' : result.fullCombo ? 'FULL COMBO' : 'TRACK CLEARED';
    this.root.innerHTML = `${this.header('', 'Track library')}<main class="results-main"><div class="results-heading"><div class="eyebrow">${result.failed ? 'EVERY RUN IS A NEW START' : 'THAT WAS YOUR MOMENT'}</div><h1>${result.failed ? 'Back for ' : 'Feel that '}<span>${result.failed ? 'more?' : 'rush.'}</span></h1><p>${esc(song.title)} <i>·</i> ${esc(song.artist)} <span class="difficulty-pill ${song.difficulty.toLowerCase()}">${song.difficulty.toUpperCase()}</span></p></div><section class="results-card"><div class="grade-panel"><div class="grade-orbit"></div><div class="grade-circle grade-${result.grade.toLowerCase()}"><span>GRADE</span><strong>${result.grade}</strong></div><span class="result-status ${result.failed ? 'failed' : ''}">${result.failed ? icon('close') : icon('check')} ${status}</span><p>${result.failed ? 'Take a breath. Find the beat.<br>Your next run starts here.' : result.fullCombo ? 'Every note. One unbroken rhythm.<br>Now that\'s a perfect connection.' : 'Another track. Another level up.<br>Keep chasing your perfect run.'}</p></div><div class="result-detail"><div class="result-score-head"><span class="small-label">FINAL SCORE</span>${result.newBest ? `<span class="new-best">${icon('trophy')} NEW BEST</span>` : ''}</div><strong id="result-score">0</strong><div class="result-metrics"><div><span>ACCURACY</span><strong>${result.accuracy.toFixed(2)}<small>%</small></strong></div><div><span>MAX COMBO</span><strong>${result.maxCombo}<small>×</small></strong></div></div><div class="result-breakdown">${(['Perfect', 'Great', 'Good', 'Miss'] as const).map((judgment) => `<div class="result-judgment ${judgment.toLowerCase()}"><span>${judgment.toUpperCase()}</span><div><i style="width:${result.counts[judgment] / total * 100}%"></i></div><strong>${result.counts[judgment]}</strong></div>`).join('')}</div></div></section><div class="results-actions"><button class="button secondary big" id="retry-song">${icon('restart')} One more run</button><button class="button primary big" id="continue-results">NEXT TRACK ${icon('arrow')}</button></div><p class="result-saved">${icon('check')} Your best is saved in this browser.</p></main>${this.footer()}`;
    this.bindNavigation(() => this.select(this.preferences, this.bests, song.id));
    this.root.querySelector<HTMLButtonElement>('#retry-song')!.onclick = () => this.actions.play(song);
    this.root.querySelector<HTMLButtonElement>('#continue-results')!.onclick = () => this.select(this.preferences, this.bests, song.id);
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 1100);
      const target = this.root.querySelector('#result-score');
      if (!target) return;
      target.textContent = number(result.score * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) this.animation = requestAnimationFrame(animate);
    };
    this.animation = requestAnimationFrame(animate);
  }

  loading(message: string) {
    this.reset();
    this.root.innerHTML = `${this.header()}<main class="message-screen"><div class="loading-orbit"><i></i><i></i></div><div class="eyebrow">GETTING IN SYNC</div><h1>${esc(message)}</h1><p>One moment. A good beat is worth the wait.</p></main>${this.footer()}`;
  }

  error(message: string) {
    this.reset();
    this.root.innerHTML = `${this.header()}<main class="message-screen"><span class="error-icon">${icon('close')}</span><div class="eyebrow">A LITTLE OFFBEAT</div><h1>Let's try that again.</h1><p role="alert">${esc(message)}</p><button class="button primary" data-action="select">Back to tracks ${icon('arrow')}</button></main>${this.footer()}`;
    this.bindNavigation();
  }

  calibration(): HTMLElement {
    this.actions.stopPreview();
    this.reset();
    this.root.innerHTML = `${this.header('settings', 'Back to settings')}<main class="calibration-main"><div class="eyebrow">GET IN SYNC</div><h1>Find your <span>timing.</span></h1><p>Listen to the metronome. Tap along with each beat.<br>Use your left key or the circle below.</p><section id="calibration-area" class="calibration-area"><div id="calibration-status" class="calibration-status" role="status">Ready when you are.</div><button id="calibration-tap" class="calibration-tap" aria-label="Tap to the beat"><span class="calibration-ripple"></span><span class="tap-label">TAP</span><span class="tap-key">${esc(keyName(this.preferences.keys[0]))}</span></button><div class="calibration-readout"><div><span>TAPS</span><strong id="calibration-count">0 / 16</strong></div><div><span>SUGGESTED OFFSET</span><strong id="calibration-value">— ms</strong></div></div><div class="calibration-actions"><button id="calibration-start" class="button primary">${icon('play')} Start metronome</button><button id="calibration-apply" class="button secondary" disabled>${icon('check')} Apply offset</button><button id="calibration-reset" class="quiet-button">${icon('restart')} Start again</button></div><p class="calibration-help">For best results, use the same headphones or speakers you play with.</p><button id="calibration-back" class="quiet-button">${icon('back')} Back to settings</button></section></main>${this.footer()}`;
    this.bindNavigation(() => this.settings(this.preferences, this.bests));
    this.root.querySelector<HTMLButtonElement>('#calibration-back')!.onclick = () => this.settings(this.preferences, this.bests);
    return this.root.querySelector<HTMLElement>('#calibration-area')!;
  }
}
