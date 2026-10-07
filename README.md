# Line Rush

Two keys. One rhythm. A browser rhythm arcade with ten original electronic tracks, a canvas playfield, and responsive HTML menus.

## Play

Press **F** for the cyan lane and **J** for the pink lane when a bar crosses the target line. You can also tap the two lane buttons. Gold bars are chords: hit both lanes together. **Escape** pauses. Leaving the window pauses the game automatically.

Choose from five Easy and five Hard tracks. Settings include keybinds, scroll speed (0.5–3×), music volume, visual effects, and an audio offset (±300 ms). Calibration measures sixteen taps against a metronome and suggests an offset. Negative offsets bring targets earlier; positive offsets delay them.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. To check the production build:

```sh
npm test
npm run build
npm run preview
```

## Deploy to Vercel

Import **w7llywonka/rythym-web** into Vercel. Use the **Vite** preset, build command **npm run build**, and output directory **dist**. The included configuration sets these values. No environment variables or backend are required.

## Scoring

Perfect: ±45 ms, 300 points. Great: ±90 ms, 200 points. Good: ±140 ms, 100 points. Miss: 0 points. The 10th, 25th, and 50th consecutive hits begin ×2, ×3, and ×4 multipliers. Misses reset the combo and remove ten health. Perfect/Great/Good restore 3/2/1 health up to 100.

Accuracy weights are 100%, 70%, 40%, and 0%. All Perfect earns SS; otherwise S ≥95%, A ≥90%, B ≥80%, C ≥70%, D below 70%. Failure earns F. A full combo means clearing with no misses.

Settings and personal records save in this browser's localStorage. There is no account system or leaderboard; records do not synchronize across devices. Browsers may require the first click to enable music.

## Custom tracks

Use **Import your track** in the track library to choose an MP3, WAV, OGG, or another audio file your browser supports. For **“Waste My Time” by kevinhilfiger**, choose your own copy of the recording. Nothing is uploaded to GitHub or a server.

The importer decodes the audio, measures actual low/mid/high onsets, estimates tempo and phase, and generates a **Hard / level 10** chart with a denser note target and more chords. Half-time estimates below 105 BPM are doubled to use a fast grid. Tracks with loose grid alignment show a timing warning. Import supports files up to 40 MB and recordings from 10 seconds to 15 minutes. Imported audio lasts for this open session; reimport the same file after refreshing to recover its saved personal best.

## Audio and charts

All ten tracks are original synthesized arrangements. They use compact deterministic recipes rendered into Web Audio `AudioBuffer`s locally; no external samples, Roblox music, streaming service, or large audio downloads are required. See [MUSIC-LICENSE.md](MUSIC-LICENSE.md).

The offline scripts render the same arrangements, analyze actual PCM using band-separated spectral flux, estimate tempo and phase, and quantize onset strength onto sixteenth notes. Committed analysis lets each chart generate deterministically at load time. Kick/bass energy favors the left lane, snare/hat energy the right; fast notes alternate and strong simultaneous hits produce gold chords.

Gameplay uses `AudioContext.currentTime`, accounts for output latency, and schedules a three-second lead-in. Input event age corrects keyboard/touch timestamps; animation frames only render the current audio-clock position. Resume schedules a fresh two-second countdown. Failure ramps playback speed down and fades the music.

To regenerate the music analysis:

```sh
python -m pip install -r scripts/requirements.txt
python scripts/generate_music.py
```

## Source

- `src/main.ts`: navigation, audio lifecycle, calibration, spectrum
- `src/game.ts`: input, canvas rendering, countdown, pause, and failure
- `src/audio.ts`: audio-clock playback and previews
- `src/ui.ts`, `src/style.css`: menus and responsive layout
- `src/synthesis.ts`, `src/songs.ts`, `src/song-data.json`: original soundtrack
- `src/chart.ts`: deterministic charts
- `src/scoring.ts`, `src/storage.ts`: judgments and local records
- `scripts/`: reproducible music generation and analysis
- `tests/`: scoring, storage, and chart checks

Code is MIT licensed. The original music recipes and generated audio are dedicated to CC0.
