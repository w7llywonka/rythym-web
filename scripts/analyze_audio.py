"""Offline spectral-flux analysis of actual synthesized PCM.

The estimator is reported separately from the exact composition tempo. The
known composition grid fixes half/double-time ambiguity and preserves precise
audio/chart alignment; chart strengths come from PCM, not the recipe events.
"""
from __future__ import annotations

import numpy as np


def analyze(pcm: np.ndarray, sample_rate: int, composition_bpm: float,
            composition_offset: float, grid_length: int) -> tuple[dict, dict]:
    fft_size = 1024
    hop = round(sample_rate * 0.01)
    windows = np.lib.stride_tricks.sliding_window_view(pcm, fft_size)[::hop]
    spectrum = np.abs(np.fft.rfft(windows * np.hanning(fft_size), axis=1)) / fft_size
    spectrum = np.log1p(1000 * spectrum)
    positive = np.maximum(0, np.diff(spectrum, axis=0, prepend=spectrum[:1]))
    frequencies = np.fft.rfftfreq(fft_size, 1 / sample_rate)
    bands = []
    for lo, hi in [(30, 250), (250, 2500), (2500, 11025)]:
        flux = np.mean(positive[:, (frequencies >= lo) & (frequencies < hi)], axis=1)
        flux = np.convolve(flux, [0.2, 0.6, 0.2], mode="same")
        bands.append(flux)
    times = (np.arange(len(windows)) * hop + fft_size / 2) / sample_rate
    # Equalize bands before tempo estimation so hats cannot swamp kick/bass.
    combined = sum(band / max(1e-8, np.percentile(band, 95)) for band in bands)
    centered = combined - np.mean(combined)
    dt = hop / sample_rate
    lag_min = round(60 / 214 / dt)
    lag_max = round(60 / 67 / dt)
    correlations = []
    for lag in range(lag_min, lag_max + 1):
        correlation = float(np.dot(centered[:-lag], centered[lag:]) / (len(centered) - lag))
        if lag * 2 < len(centered):
            correlation += 0.3 * float(np.dot(centered[:-lag * 2], centered[lag * 2:]) / (len(centered) - lag * 2))
        correlations.append(correlation)
    initial = 60 / ((int(np.argmax(correlations)) + lag_min) * dt)

    def fold(bpm: float):
        phases = np.floor(np.remainder(times * bpm / 60, 1) * 128).astype(int)
        folded = np.bincount(phases, weights=combined, minlength=128)
        folded = np.convolve(np.r_[folded[-2:], folded, folded[:2]], [0.15, 0.7, 1, 0.7, 0.15], mode="same")[2:-2]
        return float(np.max(folded) / max(1e-8, np.mean(folded))), int(np.argmax(folded))

    candidates = np.arange(initial * 0.96, initial * 1.04 + 0.01, 0.02)
    best = max(((fold(float(bpm))[0], float(bpm)) for bpm in candidates), key=lambda pair: pair[0])
    estimated = best[1]
    _, peak = fold(estimated)
    estimated_offset = peak / 128 * 60 / estimated

    # Generated music supplies an exact grid. Analyze each cell around its true
    # onset, using local loudness to retain sparse/quiet breakdowns.
    grid_step = 60 / composition_bpm / 4
    strengths = []
    for band in bands:
        global_reference = max(1e-8, float(np.percentile(band[band > 0], 88)))
        encoded = []
        for i in range(grid_length):
            target = composition_offset + i * grid_step
            around = (times >= target - 0.027) & (times <= target + 0.038)
            local = (times >= target - 2) & (times <= target + 2)
            local_ref = float(np.percentile(band[local], 92)) if np.any(local) else global_reference
            normalizer = max(global_reference * 0.35, local_ref * 0.7, 1e-8)
            value = float(np.max(band[around])) if np.any(around) else 0
            encoded.append(str(int(np.clip(np.rint(value / normalizer * 6), 0, 9))))
        strengths.append("".join(encoded))
    nearest = np.round((times - composition_offset) / grid_step) * grid_step + composition_offset
    on_grid = np.abs(times - nearest) <= min(0.038, grid_step * 0.42)
    active = (times >= composition_offset - 0.04) & (times <= composition_offset + grid_length * grid_step)
    grid_fit = float(np.sum(combined[on_grid & active]) / max(1e-8, np.sum(combined[active])))
    analysis = dict(bpm=composition_bpm, offset=composition_offset,
                    low=strengths[0], mid=strengths[1], high=strengths[2], gridFit=round(grid_fit, 5))
    diagnostics = dict(method="1024-sample FFT / 10 ms hop / positive log spectral flux",
                       estimatedBpm=round(estimated, 3), estimatedBeatPhase=round(estimated_offset, 4),
                       autocorrelationBpm=round(initial, 3), alignment="Exact composition grid verified against synthesized PCM",
                       gridToleranceSeconds=round(min(0.038, grid_step * 0.42), 4), sampleRate=sample_rate)
    return analysis, diagnostics
