import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSong } from '../src/synthesis.ts';
import { songs } from '../src/songs.ts';

test('browser PCM matches the original offline recording used for analysis', async () => {
  const context = {
    createBuffer(channels: number, length: number, sampleRate: number) {
      assert.equal(channels, 1);
      const pcm = new Float32Array(length);
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => pcm };
    },
  } as unknown as AudioContext;
  const buffer = await renderSong(songs[0], context);
  assert.equal(buffer.sampleRate, 22050);
  assert.equal(buffer.length, 1085963);
  const pcm = buffer.getChannelData(0);
  // These reference samples were rendered by scripts/generate_music.py, before
  // FFT analysis, and verify shared pitches, envelopes, gain and grid timing.
  const reference = new Map([
    [17003, 0.18336735665798187], [18293, -0.097658172249794],
    [25311, 0.10808701068162918], [33878, 0.03334043174982071],
    [65432, -0.01517362892627716], [100123, 0.05935763195157051],
    [334543, 0.09332168847322464], [776655, 0.08494557440280914],
    [1000000, 0.06181329861283302],
  ]);
  for (const [index, expected] of reference) {
    assert.ok(Math.abs(pcm[index] - expected) < 0.00001, `PCM sample ${index}: ${pcm[index]} vs ${expected}`);
  }
  assert.equal(pcm[0], 0);
  assert.equal(pcm[pcm.length - 1], 0);
  let energy = 0;
  for (const value of pcm) {
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 0.78);
    energy += value * value;
  }
  assert.ok(Math.abs(Math.sqrt(energy / pcm.length) - 0.10007044025807417) < 0.00001);
});
