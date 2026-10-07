# Line Rush original music

The ten tracks bundled with this repository are original electronic compositions
created for Line Rush. Their melodies, chord arrangements, bass lines, drum
patterns, synthesis voices, and source recipes were created for this project.
They contain no external recordings, samples, imported melodies, or Roblox music.

The repository owner may use, modify, distribute, monetize, and publicly perform
these compositions and their synthesized recordings as part of this game or
other projects, without attribution or additional music fees. These project
assets are dedicated to the public domain under CC0 1.0 to the extent permitted
by law. This statement applies to the original music and synthesis recipes,
not to third-party software dependencies or their licenses.

## Reproducibility

`src/song-data.json` stores compact composition recipes and audio analysis.
`src/synthesis.ts` renders those recipes into a real mono AudioBuffer at 22,050 Hz
in the browser. No remote audio host is required. `scripts/generate_music.py`
renders the same voices and arrangement as actual PCM, runs the offline analysis,
and regenerates the JSON. Optional `--wav` exports are listening copies only.

The analysis measures positive log spectral flux from 1,024-sample FFT windows
at roughly 10 ms intervals, separately for low, mid, and high frequency bands.
It autocorrelates the combined onsets over 67–214 BPM, then refines tempo within
±4% at 0.02 BPM increments using beat-cycle folding. Raw detector estimates and
phases are retained in each record's diagnostics. The composition's exact tempo
and 0.75-second lead-in resolve tempo ambiguity and set the playable grid; the
per-step 0–9 strengths and grid-fit measurement come from rendered PCM.

To regenerate: install `scripts/requirements.txt`, then run
`python scripts/generate_music.py` from the repository root.

<!-- licensed-tracks -->
## Licensed tracks

These songs are by other artists and are used under the licenses below, not under this project's CC0 dedication. Each one was checked on its source page: only CC0 and CC BY are used (no NonCommercial, NoDerivatives or ShareAlike licenses, remixes or re-uploads). Their Expert / Extreme charts are generated from the audio. In the game, every song is credited on the home screen under CREDITS, and its license is shown on its song panel.

- **"Strap Yourselves In"** by congusbongus (Expert) — from [OpenGameArt](https://opengameart.org/content/strap-yourselves-in), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). File: `public/music/strap-yourselves-in.mp3`. Changes: Converted from OGG to MP3.
- **"Null Function"** by congusbongus (Expert) — from [OpenGameArt](https://opengameart.org/content/null-function), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). File: `public/music/null-function.mp3`. Changes: Converted from OGG to MP3.
- **"Cyborg Ninja"** by [Kevin MacLeod](https://incompetech.com) (Expert) — from [incompetech](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600008), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit as requested: "Cyborg Ninja" Kevin MacLeod (incompetech.com) · Licensed under Creative Commons: By Attribution 4.0 License · http://creativecommons.org/licenses/by/4.0/. File: `public/music/cyborg-ninja.mp3`. Changes: Re-encoded as 160 kbps MP3.
- **"Another Step Back"** by Of Far Different Nature (Expert) — from [OpenGameArt](https://opengameart.org/content/another-step-back), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). File: `public/music/another-step-back.mp3`. Changes: Re-encoded as 160 kbps MP3.
- **"Final Hour"** by isaiah658 (Extreme) — from [OpenGameArt](https://opengameart.org/content/final-hour), licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). File: `public/music/final-hour.mp3`. Changes: Shortened to a 62 s excerpt (1:03–2:05) and re-encoded as 160 kbps MP3.
- **"Shortcuts"** by Zane Little Music (Extreme) — from [OpenGameArt](https://opengameart.org/content/shortcuts), licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). File: `public/music/shortcuts.mp3`. Changes: Shortened to a 62 s excerpt (2:19–3:21) and re-encoded as 160 kbps MP3.
- **"Ripped Apart"** by Tricks & Traps (Extreme) — from [OpenGameArt](https://opengameart.org/content/free-rhythm-game-music-pack-2), licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). File: `public/music/ripped-apart.mp3`. Changes: Shortened to a 62 s excerpt (1:22–2:25) and converted from WAV to MP3.
- **"Psychic"** by Tricks & Traps (Extreme) — from [OpenGameArt](https://opengameart.org/content/free-rhythm-game-music-pack-1), licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). File: `public/music/psychic.mp3`. Changes: Shortened to a 62 s excerpt (1:37–2:39) and converted from WAV to MP3.
- **"Hard Boss Battle 1"** by MintoDog (Extreme) — from [OpenGameArt](https://opengameart.org/content/hard-boss-battle-1), licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). File: `public/music/hard-boss-battle.mp3`. Changes: Shortened to a 63 s excerpt (0:14–1:18) and re-encoded as 160 kbps MP3.
