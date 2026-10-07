"""Compose Line Rush's ten original tracks and analyze the synthesized PCM.

Run `python scripts/generate_music.py` after installing scripts/requirements.txt.
Use --wav to additionally export listening copies into public/audio (not required
by the browser). Browser synthesis in src/synthesis.ts uses these same recipes.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import wave

import numpy as np

from analyze_audio import analyze

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 22050
LEAD_IN = 0.75

# All melodies, arrangements, oscillator voices and patterns are newly composed
# for this project. No samples, recordings or pre-existing melodies are used.
RECIPES = [
    dict(id="afterglow", title="Afterglow Avenue", genre="Chillwave", bpm=90, bars=18,
         root=45, minor=True, melody=[0,-1,7,-1,12,-1,7,-1,3,-1,10,-1,7,-1,3,-1],
         bass=[0,-1,-1,-1,-1,-1,7,-1,0,-1,-1,-1,3,-1,7,-1], kick=[0,8], color="#00D2FF", color2="#7874FF"),
    dict(id="glasshouse", title="Glasshouse", genre="Melodic house", bpm=100, bars=20,
         root=41, minor=True, melody=[7,-1,12,-1,15,-1,12,-1,10,-1,7,-1,3,-1,7,-1],
         bass=[0,-1,-1,-1,0,-1,-1,-1,7,-1,-1,-1,0,-1,7,-1], kick=[0,4,8,12], color="#9A7CFF", color2="#FF4FA0"),
    dict(id="orbit", title="Paper Satellites", genre="Synth pop", bpm=108, bars=22,
         root=43, minor=False, melody=[0,-1,4,-1,7,-1,12,-1,11,-1,7,-1,4,-1,2,-1],
         bass=[0,-1,0,-1,-1,-1,7,-1,0,-1,-1,-1,7,-1,12,-1], kick=[0,6,8], color="#FF4FA0", color2="#FFAA7A"),
    dict(id="prism", title="Prism Parade", genre="Electro funk", bpm=116, bars=24,
         root=40, minor=True, melody=[12,-1,7,10,-1,-1,3,-1,7,-1,12,15,-1,10,7,-1],
         bass=[0,-1,7,-1,-1,0,-1,12,0,-1,7,-1,-1,3,7,-1], kick=[0,7,8,14], color="#3DDC84", color2="#00D2FF"),
    dict(id="daybreak", title="Daybreak Circuit", genre="Arcade house", bpm=124, bars=26,
         root=38, minor=False, melody=[0,-1,7,-1,12,14,16,-1,19,-1,16,-1,14,12,7,-1],
         bass=[0,-1,7,-1,0,-1,7,-1,0,-1,12,-1,7,-1,4,-1], kick=[0,4,8,12], color="#FFD25A", color2="#FF785C"),
    dict(id="current", title="Voltage Current", genre="Breakbeat", bpm=138, bars=28,
         root=42, minor=True, melody=[0,7,12,-1,15,12,7,3,10,-1,7,12,15,10,7,-1],
         bass=[0,-1,0,7,-1,-1,12,-1,0,0,-1,7,-1,3,7,-1], kick=[0,3,8,10], color="#FF785C", color2="#FF4FA0"),
    dict(id="undertow", title="Midnight Undertow", genre="Liquid breaks", bpm=148, bars=30,
         root=45, minor=True, melody=[7,12,15,-1,19,15,12,10,7,3,7,-1,10,12,7,3],
         bass=[0,-1,-1,7,0,-1,12,-1,0,-1,7,-1,-1,3,-1,7], kick=[0,6,8,11], color="#4A99FF", color2="#9A7CFF"),
    dict(id="hyperlane", title="Hyperlane", genre="Cyber garage", bpm=158, bars=32,
         root=39, minor=True, melody=[0,12,7,15,12,-1,10,7,3,10,7,12,15,-1,12,7],
         bass=[0,-1,7,0,-1,12,-1,7,0,-1,3,7,-1,0,7,12], kick=[0,5,8,14], color="#C67BFF", color2="#00D2FF"),
    dict(id="redline", title="Redline Reverie", genre="Drum & bass", bpm=168, bars=34,
         root=41, minor=True, melody=[12,7,3,7,15,12,7,-1,10,7,3,7,12,15,19,-1],
         bass=[0,0,-1,7,-1,12,-1,7,0,-1,3,7,0,-1,7,-1], kick=[0,6,8,10], color="#FF4FA0", color2="#C67BFF"),
    dict(id="zenith", title="Zenith Overdrive", genre="Arcade DnB", bpm=178, bars=36,
         root=44, minor=True, melody=[0,7,12,15,19,15,12,7,10,14,17,14,12,10,7,3],
         bass=[0,-1,7,0,-1,12,7,-1,0,3,-1,7,0,-1,12,7], kick=[0,3,8,11,14], color="#FFD25A", color2="#FF4FA0"),
]


def hash_noise(length: int, seed: int) -> np.ndarray:
    x = np.arange(length, dtype=np.uint32) + np.uint32(seed)
    x ^= x >> np.uint32(16)
    x *= np.uint32(0x7FEB352D)
    x ^= x >> np.uint32(15)
    x *= np.uint32(0x846CA68B)
    x ^= x >> np.uint32(16)
    return x.astype(np.float64) / 2147483648.0 - 1.0


def events(recipe: dict):
    """Yield (voice, start, duration, midi pitch, gain, noise seed)."""
    beat = 60 / recipe["bpm"]
    step = beat / 4
    hard = recipe["bpm"] >= 138
    progression = [0, 5, 3 if recipe["minor"] else 4, 7]
    seed = recipe["seed"]
    for bar in range(recipe["bars"]):
        chord = progression[(bar // 2) % 4]
        breakdown = recipe["bars"] // 2 <= bar < recipe["bars"] // 2 + 2
        intro = bar < 2
        outro = bar == recipe["bars"] - 1
        pad_gain = 0.028 if hard else 0.04
        for tone in [0, 3 if recipe["minor"] else 4, 7]:
            yield ("pad", LEAD_IN + bar * 4 * beat, 3.7 * beat,
                   recipe["root"] + 24 + chord + tone, pad_gain, seed + bar)
        for slot in range(16):
            index = bar * 16 + slot
            time = LEAD_IN + index * step
            voice_seed = (seed + index * 131) & 0xFFFFFFFF
            if not breakdown and not (intro and bar == 0) and not (outro and slot >= 12):
                if slot in recipe["kick"]:
                    yield ("kick", time, 0.26, 0, 0.58, voice_seed)
                if slot in [4, 12]:
                    yield ("snare", time, 0.17, 0, 0.31, voice_seed + 7)
                if slot % (1 if hard else 2) == 0:
                    gain = 0.075 if slot % 4 == 2 else 0.048
                    yield ("hat", time, 0.055, 0, gain * (0.6 if intro else 1), voice_seed + 17)
                if hard and bar % 4 == 3 and slot in [13, 15]:
                    yield ("snare", time, 0.105, 0, 0.12, voice_seed + 27)
            elif breakdown and slot in [2, 10]:
                yield ("hat", time, 0.06, 0, 0.04, voice_seed + 17)
            bass = recipe["bass"][slot]
            if bass >= 0 and not (breakdown and slot % 8 != 0):
                yield ("bass", time, step * (1.45 if hard else 1.8),
                       recipe["root"] + chord + bass, 0.19 if hard else 0.16, voice_seed)
            melody = recipe["melody"][(slot + (8 if bar % 8 >= 4 else 0)) % 16]
            if melody >= 0 and not (intro and slot % 4 != 0) and not (outro and slot >= 8):
                yield ("pluck", time, step * (2.7 if breakdown else 1.65),
                       recipe["root"] + 24 + chord + melody,
                       0.09 if hard else 0.115, voice_seed)


def synthesize(recipe: dict) -> np.ndarray:
    duration = LEAD_IN + recipe["bars"] * 4 * 60 / recipe["bpm"] + 0.5
    output = np.zeros(math.ceil(duration * SAMPLE_RATE), dtype=np.float64)
    for kind, start, duration, midi, gain, seed in events(recipe):
        n = math.ceil(duration * SAMPLE_RATE)
        t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
        if kind == "kick":
            phase = 2 * math.pi * (52 * t + 104 * 0.025 * (1 - np.exp(-t / 0.025)))
            signal = np.sin(phase) * np.exp(-t / 0.07)
        elif kind in ("snare", "hat"):
            noise = hash_noise(n, seed & 0xFFFFFFFF)
            previous = np.concatenate(([0.0], noise[:-1]))
            if kind == "snare":
                signal = (noise * 0.75 + np.sin(2 * math.pi * 185 * t) * 0.25) * np.exp(-t / 0.035)
            else:
                signal = (noise - previous * 0.82) * np.exp(-t / 0.012)
        else:
            frequency = 440 * 2 ** ((midi - 69) / 12)
            phase = 2 * math.pi * frequency * t
            if kind == "bass":
                signal = (np.sin(phase) + 0.24 * np.sin(2 * phase) + 0.1 * np.sin(3 * phase))
                signal *= np.minimum(t / 0.003, 1) * np.exp(-t / (duration * 0.5))
            elif kind == "pluck":
                signal = (np.sin(phase) + 0.38 * np.sin(2 * phase) + 0.17 * np.sin(3 * phase))
                signal *= np.minimum(t / 0.002, 1) * np.exp(-t / (duration * 0.31))
            else:
                signal = (np.sin(phase) + 0.17 * np.sin(2 * phase))
                signal *= np.minimum(t / 0.075, 1) * np.minimum((duration - t) / 0.15, 1)
        # A short tail envelope avoids clicks when truncating voices.
        signal *= np.minimum((duration - t) / 0.009, 1)
        begin = round(start * SAMPLE_RATE)
        n = min(n, len(output) - begin)
        if n > 0:
            output[begin:begin + n] += signal[:n] * gain
    output = np.tanh(output * 1.45) * 0.78
    # Fade the full mix out smoothly, including pad tails.
    tail = min(len(output), round(SAMPLE_RATE * 0.65))
    output[-tail:] *= np.linspace(1, 0, tail, endpoint=True)
    return output.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", action="store_true", help="Also export original PCM as WAV listening copies")
    args = parser.parse_args()
    records = []
    for i, recipe in enumerate(RECIPES):
        recipe = dict(recipe, seed=81317 + i * 7243)
        pcm = synthesize(recipe)
        analysis, diagnostics = analyze(pcm, SAMPLE_RATE, recipe["bpm"], LEAD_IN, recipe["bars"] * 16)
        song = {k: recipe[k] for k in ["id", "title", "genre", "bpm", "color", "color2", "seed"]}
        song.update(artist="LINE RUSH ORIGINALS", duration=len(pcm) / SAMPLE_RATE,
                    level=(i + 2 if i < 5 else i + 3), difficulty="Easy" if i < 5 else "Hard",
                    audio="synthetic:" + recipe["id"], previewStart=LEAD_IN + 8 * 60 / recipe["bpm"],
                    analysis=analysis)
        records.append(dict(song=song, recipe=recipe, diagnostics=diagnostics))
        print(f'{song["title"]}: {song["duration"]:.1f}s, {recipe["bpm"]} BPM, grid fit {analysis["gridFit"]:.1%}, detector {diagnostics["estimatedBpm"]:.2f} BPM')
        if args.wav:
            destination = ROOT / "public" / "audio" / f'{recipe["id"]}.wav'
            destination.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(destination), "wb") as file:
                file.setnchannels(1)
                file.setsampwidth(2)
                file.setframerate(SAMPLE_RATE)
                file.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())
    (ROOT / "src" / "song-data.json").write_text(json.dumps(records, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
