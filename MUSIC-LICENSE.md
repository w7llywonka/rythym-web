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
